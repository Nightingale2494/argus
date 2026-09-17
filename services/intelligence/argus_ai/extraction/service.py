from __future__ import annotations
import re
import csv
from datetime import datetime
from pathlib import Path
from typing import Union
from ..contracts import (DocumentClassification, DocumentType, ExtractedFactDraft,
                         Operator, RequirementType, TenderRequirementDraft)
from ..parsing.service import parse_document
import logging
from ..model_gateway.gateway import ModelGateway, TransientProviderError, ModelProviderUnavailableError
from ..contracts import TenderExtractionResponse, DocumentExtractionResponse

logger = logging.getLogger(__name__)

_CLASSIFIERS = ((r"gstin|goods and services tax", DocumentType.GST_CERT), (r"udyam", DocumentType.UDYAM_CERT), (r"permanent account number|\bpan\b", DocumentType.PAN_CERT), (r"turnover|financial statement", DocumentType.TURNOVER_CERT), (r"experience|work order", DocumentType.EXPERIENCE_CERT))
def classify_document(file_path: Union[str, Path]) -> DocumentClassification:
    text = "\n".join(page for _, page in parse_document(file_path)).lower()
    for pattern, kind in _CLASSIFIERS:
        if re.search(pattern, text): return DocumentClassification(document_type=kind, confidence=.8, rationale=f"matched document marker: {pattern}")
    return DocumentClassification(document_type=DocumentType.OTHER, confidence=.3, rationale="no supported document marker found")

_UNIT_SCALE_MAP: dict[str, int] = {
    "crore": 10000000,
    "crores": 10000000,
    "cr": 10000000,
    "cr.": 10000000,
    "lakh": 100000,
    "lakhs": 100000,
    "lac": 100000,
    "lacs": 100000,
    "thousand": 1000,
    "k": 1000,
    "million": 1000000,
    "billion": 1000000000,
}


def _parse_money_amount(raw_text: str) -> Optional[int]:
    """Parse monetary amounts including Indian scale notations (crore, lakh) to integer INR."""
    clean = raw_text.lower().replace(",", "").strip()
    for token in ("inr", "rs.", "rs", "\u20b9"):
        clean = clean.replace(token, "").strip()
    match = re.search(r"([\d.]+)\s*([a-z.]+)?", clean)
    if not match:
        return None
    num_str, scale_str = match.group(1), match.group(2)
    try:
        val = float(num_str)
        if scale_str and scale_str in _UNIT_SCALE_MAP:
            val = val * _UNIT_SCALE_MAP[scale_str]
        return int(round(val))
    except (ValueError, TypeError):
        return None


def _extract_deterministic_facts(
    text: str,
    pages: list[tuple[int, str]],
    document_id: str,
    bidder_id: str,
    file_path: Union[str, Path],
    provider: str = "deterministic",
    model: str = "regex-v1",
) -> list[ExtractedFactDraft]:
    facts: list[ExtractedFactDraft] = []

    # 1. Company Name / Legal Name
    comp_match = re.search(
        r"(?:company\s+name|bidder\s+name)[\s:\n]+([A-Za-z0-9\s.,&-]+?)(?:\n\s*(?:bidder|gstin|pan|cin|page|\d+\.)|$)",
        text,
        re.I,
    )
    if comp_match:
        c_val = comp_match.group(1).strip()
        if c_val and len(c_val) > 2 and not c_val.lower().startswith("field"):
            page = next((p for p, body in pages if c_val in body), 1)
            facts.append(ExtractedFactDraft(
                document_id=document_id,
                bidder_id=bidder_id,
                field="corporate.legal_name",
                value=c_val,
                normalized_value=c_val,
                source_page=page,
                source_text=_sentence(text, comp_match.start(), comp_match.end()),
                confidence=0.92,
                provider=provider,
                model=model,
            ))

    # 2. Tax, PAN, CIN, Registrations
    id_patterns = (
        ("tax.gstin", r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z]\d\b", 0.98),
        ("identity.pan", r"\b[A-Z]{5}\d{4}[A-Z]\b", 0.98),
        ("corporate.cin", r"\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b", 0.95),
        ("registration.udyam", r"\bUDYAM-[A-Z]{2}-\d{2}-\d{6,8}\b", 0.95),
        ("labour.epfo_registration", r"\b(?:EPFO|PF)\s*(?:code|registration)?\s*[:#-]?\s*([A-Z]{2,5}[A-Z0-9/-]{4,})", 0.90),
        ("labour.esic_registration", r"\b(?:ESIC|ESI)\s*(?:code|registration)?\s*[:#-]?\s*(\d{10,17})", 0.90),
    )
    for field, pattern, conf in id_patterns:
        match = re.search(pattern, text, re.I if "epfo" in field or "esic" in field else 0)
        if match:
            value = match.group(1) if match.lastindex else match.group()
            page = next((p for p, body in pages if match.group() in body), 1)
            facts.append(ExtractedFactDraft(
                document_id=document_id,
                bidder_id=bidder_id,
                field=field,
                value=value,
                normalized_value=value.upper(),
                source_page=page,
                source_text=match.group(),
                confidence=conf,
                provider=provider,
                model=model,
            ))

    # 3. Financial turnover
    turnover_match = re.search(
        r"(?:(?:average\s+)?(?:annual\s+)?turnover)[\s:\n-]{0,40}?(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?\s*(?:crore|crores|cr\.?|lakh|lakhs|lac|lacs|thousand|million|billion)?)",
        text,
        re.I,
    )
    if turnover_match:
        val = _parse_money_amount(turnover_match.group(1))
        if val is not None:
            page = next((p for p, body in pages if turnover_match.group() in body), 1)
            facts.append(ExtractedFactDraft(
                document_id=document_id,
                bidder_id=bidder_id,
                field="financial.average_annual_turnover",
                value=val,
                normalized_value=val,
                source_page=page,
                source_text=_sentence(text, turnover_match.start(), turnover_match.end()),
                confidence=0.88,
                provider=provider,
                model=model,
            ))

    # 4. OEM authorization
    oem_match = re.search(
        r"(?:oem\s+(?:/\s*provider\s+)?authorization)[^\n:]{0,40}[:\n\s]*([^\n.]+)",
        text,
        re.I,
    )
    if oem_match:
        oem_val = oem_match.group(1).strip()
        if oem_val and not oem_val.lower().startswith("field"):
            page = next((p for p, body in pages if oem_val in body), 1)
            facts.append(ExtractedFactDraft(
                document_id=document_id,
                bidder_id=bidder_id,
                field="compliance.oem_authorization",
                value=oem_val,
                normalized_value=oem_val,
                source_page=page,
                source_text=_sentence(text, oem_match.start(), oem_match.end()),
                confidence=0.90,
                provider=provider,
                model=model,
            ))

    # 5. Experience years (explicit duration text only - user rule 1)
    exp_match = re.search(
        r"(?:(?:minimum\s+)?experience[^.\n]{0,80}?(\d+)\s*(?:years?|yrs?)|(?:minimum\s+of\s+)?(\d+)\s*(?:years?|yrs?)[^.\n]{0,80}?experience)",
        text,
        re.I,
    )
    if exp_match:
        years = int(exp_match.group(1) or exp_match.group(2))
        page = next((p for p, body in pages if str(years) in body), 1)
        facts.append(ExtractedFactDraft(
            document_id=document_id,
            bidder_id=bidder_id,
            field="experience.years",
            value=years,
            normalized_value=years,
            source_page=page,
            source_text=_sentence(text, exp_match.start(), exp_match.end()),
            confidence=0.80,
            provider=provider,
            model=model,
        ))

    # 6. Expiry date
    expiry = re.search(r"(?:valid\s+(?:up\s+)?to|expiry\s*date|expires?)\s*[:.-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", text, re.I)
    if expiry:
        parsed = _parse_date(expiry.group(1))
        if parsed:
            page = next((p for p, body in pages if expiry.group() in body), 1)
            facts.append(ExtractedFactDraft(
                document_id=document_id,
                bidder_id=bidder_id,
                field="document.expiry_date",
                value=parsed,
                normalized_value=parsed,
                source_page=page,
                source_text=expiry.group(),
                confidence=0.84,
                provider=provider,
                model=model,
            ))

    # 7. CSV support
    if Path(file_path).suffix.lower() == ".csv":
        facts.extend(_extract_csv_facts(Path(file_path), document_id, bidder_id, provider=provider, model=model))

    return _deduplicate_facts(facts)


def extract_document(file_path: Union[str, Path], *, document_id: str, bidder_id: str, gateway: ModelGateway = None) -> list[ExtractedFactDraft]:
    """Deterministic extraction baseline with model-backed extraction and truthful fallback."""
    pages = parse_document(file_path)
    text = "\n".join(t for _, t in pages)
    if gateway and gateway.provider:
        try:
            output = gateway.extract_structured("Extract factual claims only. Do not decide eligibility, compliance, or qualification. Preserve source page/text. Return facts matching the schema.", text, DocumentExtractionResponse)
            return [fact.model_copy(update={"document_id": document_id, "bidder_id": bidder_id}) for fact in output.facts]
        except TransientProviderError as tpe:
            logger.warning("Upstream model provider transient failure: %s. Falling back to deterministic baseline.", tpe)
            facts = _extract_deterministic_facts(
                text=text,
                pages=pages,
                document_id=document_id,
                bidder_id=bidder_id,
                file_path=file_path,
                provider="DETERMINISTIC_FALLBACK",
                model="deterministic-rules-v1",
            )
            if not facts:
                raise ModelProviderUnavailableError(
                    "Model provider unavailable and deterministic fallback produced zero usable facts."
                ) from tpe
            return facts

    return _extract_deterministic_facts(
        text=text,
        pages=pages,
        document_id=document_id,
        bidder_id=bidder_id,
        file_path=file_path,
        provider="deterministic",
        model="regex-v1",
    )

def _extract_csv_facts(path: Path, document_id: str, bidder_id: str, provider: str = "deterministic", model: str = "csv-table-v1") -> list[ExtractedFactDraft]:
    aliases = {
        "gstin": "tax.gstin",
        "gst": "tax.gstin",
        "pan": "identity.pan",
        "udyam": "registration.udyam",
        "turnover": "financial.average_annual_turnover",
        "annual_turnover": "financial.average_annual_turnover",
        "experience_years": "experience.years",
        "experience": "experience.years",
        "expiry_date": "document.expiry_date",
        "epfo": "labour.epfo_registration",
        "esic": "labour.esic_registration",
        "cin": "corporate.cin",
        "blacklisted": "legal.blacklisted",
    }
    extracted: list[ExtractedFactDraft] = []
    with path.open(encoding="utf-8", errors="replace", newline="") as handle:
        for row_number, row in enumerate(csv.DictReader(handle), 2):
            for column, field in aliases.items():
                value = row.get(column)
                if not value or not value.strip(): continue
                normalized: Any = value.strip()
                if field in {"financial.average_annual_turnover", "experience.years"}:
                    try: normalized = int(re.sub(r"[^0-9]", "", value))
                    except ValueError: continue
                if field == "document.expiry_date":
                    normalized = _parse_date(value.strip())
                    if not normalized: continue
                extracted.append(ExtractedFactDraft(document_id=document_id, bidder_id=bidder_id, field=field, value=normalized, normalized_value=normalized, source_page=1, source_text="CSV row %d, column %s: %s" % (row_number, column, value), confidence=.90, provider=provider, model=model))
    return extracted

def _deduplicate_facts(facts: list[ExtractedFactDraft]) -> list[ExtractedFactDraft]:
    seen, unique = set(), []
    for fact in facts:
        key = (fact.field, str(fact.normalized_value if fact.normalized_value is not None else fact.value))
        if key not in seen: seen.add(key); unique.append(fact)
    return unique

def _parse_date(value: str):
    for pattern in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try: return datetime.strptime(value, pattern).date().isoformat()
        except ValueError: pass
    return None

def _find_clause_for_pos(text: str, pos: int) -> str:
    prefix = text[:pos]
    matches = list(re.finditer(r"(?m)^\s*(\d+(?:\.\d+)+)\s+", prefix))
    if matches:
        return matches[-1].group(1)
    clause_match = re.search(r"(?m)^\s*(\d+(?:\.\d+)*)\s*[).:-]", text)
    return clause_match.group(1) if clause_match else "UNNUMBERED"

def extract_tender(file_path: Union[str, Path], gateway: ModelGateway = None) -> list[TenderRequirementDraft]:
    """Extract machine-readable eligibility requirements with exact clause and page provenance."""
    pages = parse_document(file_path)
    if gateway and gateway.provider:
        content = "\n\n".join("PAGE %s:\n%s" % page for page in pages)
        output = gateway.extract_structured("Extract machine-readable tender eligibility requirements only. Never decide bidder qualification or PASS/FAIL. If a clause is ambiguous, omit it rather than guessing.", content, TenderExtractionResponse)
        return output.requirements
    requirements: list[TenderRequirementDraft] = []
    for page, text in pages:
        match = re.search(r"(?:minimum\s+)?(?:annual\s+)?turnover[^\n.]{0,100}?(?:INR|Rs\.?|₹)\s*([\d,]+)", text, re.I)
        if match:
            clause = _find_clause_for_pos(text, match.start())
            requirements.append(TenderRequirementDraft(clause=clause, requirement_type=RequirementType.TURNOVER, field="financial.average_annual_turnover", operator=Operator.GTE, expected_value=int(match.group(1).replace(",", "")), unit="INR", source_page=page, source_text=match.group(), confidence=.75, requires_verification=True))
        simple_requirements = (
            (r"\bgstin\b|\bgst registration\b", RequirementType.GST, "tax.gstin", Operator.EXISTS, True),
            (r"\budyam\b", RequirementType.UDYAM, "registration.udyam", Operator.EXISTS, True),
            (r"\bepfo\b", RequirementType.EPFO, "labour.epfo_registration", Operator.EXISTS, True),
            (r"\besic\b", RequirementType.ESIC, "labour.esic_registration", Operator.EXISTS, True),
            (r"\bmca\b|\bministry of corporate affairs\b", RequirementType.MCA, "corporate.mca_registration", Operator.EXISTS, True),
            (r"(?:not|no)\s+(?:be\s+)?blacklisted|non[ -]blacklisted", RequirementType.BLACK_LIST, "legal.blacklisted", Operator.EQ, False),
        )
        for pattern, kind, field, operator, expected in simple_requirements:
            marker = re.search(pattern, text, re.I)
            if marker:
                clause = _find_clause_for_pos(text, marker.start())
                requirements.append(TenderRequirementDraft(clause=clause, requirement_type=kind, field=field, operator=operator, expected_value=expected, source_page=page, source_text=_sentence(text, marker.start(), marker.end()), confidence=.82, requires_verification=True))
        exp_match = re.search(r"(?:(?:minimum\s+)?experience[^.\n]{0,100}?(\d+)\s*(?:years?|yrs?)|(?:minimum\s+of\s+)?(\d+)\s*(?:years?|yrs?)[^.\n]{0,100}?experience)", text, re.I)
        if exp_match:
            years = int(exp_match.group(1) or exp_match.group(2))
            clause = _find_clause_for_pos(text, exp_match.start())
            requirements.append(TenderRequirementDraft(clause=clause, requirement_type=RequirementType.EXPERIENCE, field="experience.years", operator=Operator.GTE, expected_value=years, unit="years", source_page=page, source_text=_sentence(text, exp_match.start(), exp_match.end()), confidence=.78, requires_verification=True))

    # Deduplicate keeping highest-precedence/earliest occurrence per requirement type & field
    seen: set[tuple[RequirementType, str]] = set()
    unique: list[TenderRequirementDraft] = []
    for r in requirements:
        key = (r.requirement_type, r.field)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique

def _sentence(text: str, start: int, end: int) -> str:
    """Small source excerpt for audit evidence; avoids returning a whole document page."""
    left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start)) + 1
    right_options = [position for position in (text.find(".", end), text.find("\n", end)) if position != -1]
    right = min(right_options) if right_options else len(text)
    return text[left:right].strip()

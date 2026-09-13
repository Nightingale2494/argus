import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_principal
from app.schemas.canonical import (
    AuthenticatedPrincipal,
    RAGExplainRequest,
    RAGExplainResponse,
    RAGQueryRequest,
    RAGQueryResponse,
)
from app.services.rag_adapter import RAGServiceAdapter

router = APIRouter(prefix="/rag", tags=["RAG Evidence Retrieval"])
rag_adapter = RAGServiceAdapter()


@router.post("/query", response_model=RAGQueryResponse)
async def query_rag_evidence(
    payload: RAGQueryRequest,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
):
    response = await rag_adapter.retrieve(payload)
    return response


# ---------------------------------------------------------------------------
# Procurement-Specific Query Expansion & Intent Classification
# ---------------------------------------------------------------------------

PROCUREMENT_SYNONYMS = {
    "emd": ["emd", "earnest money", "earnest money deposit", "bid security", "bid securing declaration"],
    "msme": ["msme", "mse", "micro and small enterprise", "micro and small", "udyam", "msmed"],
    "experience": ["past experience", "similar work", "similar projects", "work experience", "executed contracts", "past performance"],
    "jv": ["joint venture", "jv", "consortium", "consortia", "association of persons"],
    "turnover": ["annual turnover", "financial turnover", "revenue", "average turnover"],
    "oem": ["oem", "original equipment manufacturer", "manufacturer authorization", "maf"],
    "gst": ["gst", "gstin", "goods and services tax", "tax registration"],
    "warranty": ["warranty", "guarantee", "defect liability", "comprehensive warranty"],
}

PROCEDURAL_WORDS = {
    "what", "is", "the", "are", "for", "to", "in", "of", "and", "or", "a", "an",
    "this", "that", "it", "at", "by", "from", "on", "as", "how", "does", "do",
    "can", "tell", "me", "about", "give", "show", "please", "applicable", "requirement",
    "requirements", "criteria", "tender", "bid", "bidders", "procurement", "clause",
    "section", "rule", "document", "documents", "qualification", "eligibility",
    "evaluation", "compliance", "mandatory", "specified", "allowed", "permitted",
    "much", "rate", "fee", "threshold", "thresholds", "penalty", "liquidated",
    "damages", "delivery", "delayed", "delay", "period", "schedule", "exact",
    "terms", "conditions", "contract", "general", "special", "payment", "statutory",
    "central", "state", "government", "rules", "law", "act", "provisions", "submission",
    "technical", "financial", "specification", "specifications", "scope", "work",
    "standards", "standard", "guidelines", "instructions", "performance", "completion",
    "order", "orders", "validity", "time", "date", "timeline", "milestone", "milestones",
    "year", "years", "month", "months", "day", "days", "project", "projects", "value",
    "crore", "crores", "lakh", "lakhs", "amount", "number"
}


def expand_procurement_query(query: str) -> str:
    """Expands query with canonical procurement synonyms for vector and full-text retrieval.
    Preserves original query for intent and slot verification.
    """
    q_lower = query.lower()
    expanded_terms = [query]
    for key, syns in PROCUREMENT_SYNONYMS.items():
        if key in q_lower or any(s in q_lower for s in syns):
            for s in syns:
                if s not in q_lower:
                    expanded_terms.append(s)
    return " ".join(expanded_terms)


def extract_subject_domain_terms(query: str) -> set[str]:
    """Extracts non-procedural entity/domain terms from query (e.g. 'aircraft engines', 'solar equipment')."""
    words = re.findall(r"[a-z0-9]+", query.lower())
    domain_words = {w for w in words if w not in PROCEDURAL_WORDS and len(w) > 2}

    # Remove known procurement policy keywords from domain terms
    for key, syns in PROCUREMENT_SYNONYMS.items():
        domain_words.discard(key)
        for s in syns:
            for part in s.split():
                domain_words.discard(part)
    domain_words.discard("exemption")
    domain_words.discard("relaxation")
    domain_words.discard("waiver")
    domain_words.discard("amount")
    domain_words.discard("period")
    domain_words.discard("minimum")
    domain_words.discard("maximum")
    return domain_words


def classify_query_intent(query: str) -> dict:
    """Classifies the specific procurement intent and required answer slots."""
    q = query.lower()

    is_emd = any(t in q for t in ["emd", "earnest money", "bid security"])
    is_msme = any(t in q for t in ["msme", "mse", "udyam", "micro and small", "micro", "small enterprise"])
    is_exemption = any(t in q for t in ["exempt", "exemption", "relax", "relaxation", "waiver", "waive"])
    is_amount = any(t in q for t in ["amount", "how much", "fee", "value", "rate", "what is the emd", "deposit"])
    is_experience = any(t in q for t in ["experience", "similar work", "past performance", "similar project", "track record"])
    is_warranty = any(t in q for t in ["warranty", "guarantee", "defect liability"])
    is_jv = any(t in q for t in ["joint venture", "consortium", "jv", "consortia"])
    is_numeric = any(t in q for t in ["how much", "what is the amount", "minimum amount", "percentage", "years", "deadline", "duration", "threshold", "period"])

    if is_emd and is_exemption:
        intent = "EMD_EXEMPTION"
    elif is_emd and (is_amount or not is_exemption):
        intent = "EMD_AMOUNT"
    elif is_msme and is_exemption:
        intent = "MSME_EXEMPTION"
    elif is_msme:
        intent = "MSME_GENERAL"
    elif is_experience:
        intent = "PAST_EXPERIENCE_THRESHOLD"
    elif is_warranty:
        intent = "WARRANTY"
    elif is_jv:
        intent = "JV_CONSORTIUM"
    elif is_numeric:
        intent = "GENERAL_NUMERIC"
    else:
        intent = "GENERAL"

    return {
        "intent": intent,
        "is_emd": is_emd,
        "is_msme": is_msme,
        "is_exemption": is_exemption,
        "is_amount": is_amount,
        "is_experience": is_experience,
        "is_warranty": is_warranty,
        "is_jv": is_jv,
        "is_numeric": is_numeric,
    }


def evaluate_evidence_sufficiency(
    query: str,
    intent_info: dict,
    query_domain_terms: set[str],
    chunk: EvidenceRead,
) -> tuple[bool, bool, str]:
    """Evaluates whether a chunk meets DIRECT_EVIDENCE or RELATED_CONTEXT criteria.

    Returns:
        (is_direct, is_related, rationale)
    """
    snippet = chunk.snippet
    text_lower = snippet.lower()
    meta = chunk.location_metadata or {}
    score = float(meta.get("relevance_score", 0.0))
    intent = intent_info["intent"]

    # 1. Domain / Entity Mismatch Check
    if query_domain_terms:
        combined_text = f"{text_lower} {str(meta.get('title', '')).lower()}"
        matched_domain = {w for w in query_domain_terms if w in combined_text}
        if not matched_domain:
            # Complete domain mismatch (e.g. aircraft engines in IT hardware tender)
            return False, False, f"Domain mismatch: query requested {query_domain_terms}, absent from evidence"

    # Numeric monetary / percentage pattern
    monetary_pattern = re.compile(r"(inr|rs\.?|₹)\s*[\d,]+(\.\d+)?|\b\d+([,.]\d+)?\s*(lakh|crore|thousand|percent|%)\b|\b\d{4,}\b", re.IGNORECASE)
    # Threshold pattern (years, projects, percentage, amount)
    threshold_pattern = re.compile(r"\b\d+\s*(years?|yrs?|months?|days?|projects?|works?|contracts?|orders?|crore|lakh|%)\b|(inr|rs\.?|₹)\s*[\d,]+", re.IGNORECASE)
    # Exemption / waiver keywords
    exemption_pattern = re.compile(r"\b(exempt|exemption|relax|relaxation|waiv|waiver|not applicable|exempted|relaxed)\b", re.IGNORECASE)

    # 2. Intent-Specific Answer Slot Validation
    if intent == "EMD_AMOUNT":
        has_emd = any(w in text_lower for w in ["emd", "earnest money", "bid security"])
        has_amount = bool(monetary_pattern.search(text_lower))
        if has_emd and has_amount:
            return True, True, "Matches EMD amount with monetary figure"
        if has_emd:
            return False, True, "Mentions EMD but lacks monetary amount"
        return False, False, "Lacks EMD context"

    elif intent == "EMD_EXEMPTION":
        has_emd = any(w in text_lower for w in ["emd", "earnest money", "bid security"])
        has_exemption = bool(exemption_pattern.search(text_lower)) or "bid securing declaration" in text_lower
        if has_emd and has_exemption:
            return True, True, "Matches EMD exemption clause"
        if has_emd:
            return False, True, "Mentions EMD amount/rule without explicit exemption"
        return False, False, "Lacks EMD context"

    elif intent == "MSME_EXEMPTION":
        has_msme = any(w in text_lower for w in ["msme", "mse", "udyam", "micro and small", "micro", "small enterprise"])
        has_exemption = bool(exemption_pattern.search(text_lower))

        # Pure document upload or registration without exemption clause is only RELATED_CONTEXT
        if has_msme and has_exemption:
            return True, True, "Explicit MSME exemption clause"
        if has_msme:
            return False, True, "Udyam/MSME registration requirement without explicit exemption clause"
        return False, False, "Lacks MSME context"

    elif intent == "PAST_EXPERIENCE_THRESHOLD":
        has_exp = any(w in text_lower for w in ["experience", "similar work", "past performance", "similar project", "executed"])
        has_thresh = bool(threshold_pattern.search(text_lower))
        if has_exp and has_thresh:
            return True, True, "Contains past experience requirement with concrete threshold"
        if has_exp:
            return False, True, "Mentions experience without explicit threshold"
        return False, False, "Lacks experience context"

    elif intent == "WARRANTY":
        has_warranty = any(w in text_lower for w in ["warranty", "guarantee", "defect liability"])
        if has_warranty:
            return True, True, "Matches warranty requirement in valid domain"
        return False, False, "Lacks warranty context"

    elif intent == "JV_CONSORTIUM":
        has_jv = any(w in text_lower for w in ["joint venture", "consortium", "jv", "consortia", "association of persons"])
        if has_jv:
            return True, True, "Matches JV/Consortium eligibility clause"
        return False, False, "Lacks JV context"

    elif intent == "GENERAL_NUMERIC":
        has_numeric = bool(threshold_pattern.search(text_lower)) or bool(monetary_pattern.search(text_lower))
        if has_numeric and score >= 0.30:
            return True, True, "Matches numeric criteria slot"
        return False, score >= 0.20, "Lacks required numeric slot"

    # Default fallback
    if score >= 0.45:
        return True, True, "High relevance score general evidence"
    elif score >= 0.20:
        return False, True, "Moderate relevance background context"
    return False, False, "Low relevance"


@router.post("/explain", response_model=RAGExplainResponse)
async def explain_policy_or_clause(
    payload: RAGExplainRequest,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
):
    """Provides advisory policy explanation and clause intelligence for procurement officers.

    Strict Invariants:
    - Purely advisory: does NOT mutate compliance state, bidder status, or qualification outcome.
    - All citations scoped strictly to specified tender_id or public policy documents.
    - direct_answer synthesized ONLY from validated direct_citations.
    """
    now = datetime.now(timezone.utc)
    expanded_query = expand_procurement_query(payload.query)

    query_req = RAGQueryRequest(
        query=expanded_query,
        tender_id=payload.tender_id,
        top_k=payload.top_k,
    )
    rag_res = await rag_adapter.retrieve(query_req)

    intent_info = classify_query_intent(payload.query)
    query_domain_terms = extract_subject_domain_terms(payload.query)

    if not rag_res.results:
        msg = "ARGUS could not find an indexed clause that directly answers this question."
        return RAGExplainResponse(
            query=payload.query,
            explanation=msg,
            direct_answer=msg,
            related_context=None,
            result_class="INSUFFICIENT_RETRIEVAL_EVIDENCE",
            citations=[],
            related_citations=[],
            is_advisory=True,
            retrieved_at=now,
            error_code=rag_res.error_code or "INSUFFICIENT_RETRIEVAL_EVIDENCE",
            error_message=rag_res.error_message or msg,
        )

    direct_citations: list[EvidenceRead] = []
    related_citations: list[EvidenceRead] = []

    for item in rag_res.results:
        is_direct, is_related, rationale = evaluate_evidence_sufficiency(
            payload.query, intent_info, query_domain_terms, item
        )
        if is_direct:
            direct_citations.append(item)
        elif is_related:
            related_citations.append(item)

    if direct_citations:
        result_class = "DIRECT_EVIDENCE"
        top_direct = direct_citations[0]
        direct_answer = top_direct.snippet.split("\n")[0].strip()
        if len(direct_answer) > 300:
            direct_answer = direct_answer[:297] + "..."

        if related_citations:
            top_rel = related_citations[0]
            related_context = top_rel.snippet.split("\n")[0].strip()
            if len(related_context) > 200:
                related_context = related_context[:197] + "..."
            explanation = f"{direct_answer} Related context: {related_context}"
        else:
            related_context = None
            explanation = direct_answer
    elif related_citations:
        result_class = "RELATED_CONTEXT"
        if intent_info["intent"] == "MSME_EXEMPTION":
            direct_answer = "ARGUS could not find an indexed clause explicitly granting a turnover exemption."
        elif intent_info["intent"] == "EMD_AMOUNT":
            direct_answer = "ARGUS could not find an indexed clause explicitly specifying the EMD amount."
        else:
            direct_answer = "ARGUS could not find an indexed clause that directly answers this question."

        top_rel = related_citations[0]
        related_context = top_rel.snippet.split("\n")[0].strip()
        if len(related_context) > 200:
            related_context = related_context[:197] + "..."
        explanation = f"{direct_answer} Related context: {related_context}"
    else:
        result_class = "INSUFFICIENT_RETRIEVAL_EVIDENCE"
        direct_answer = "ARGUS could not find an indexed clause that directly answers this question."
        related_context = None
        explanation = direct_answer

    return RAGExplainResponse(
        query=payload.query,
        explanation=explanation,
        direct_answer=direct_answer,
        related_context=related_context,
        result_class=result_class,
        citations=direct_citations,
        related_citations=related_citations,
        is_advisory=True,
        retrieved_at=now,
    )

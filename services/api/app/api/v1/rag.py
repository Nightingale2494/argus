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


def _extract_intent_keywords(query: str) -> set[str]:
    q = query.lower()
    keywords = set()
    topic_map = {
        "msme": {"msme", "micro", "small", "udyam", "exemption", "relaxation"},
        "turnover": {"turnover", "annual", "financial", "revenue"},
        "experience": {"experience", "past", "similar", "work", "execution"},
        "emd": {"emd", "earnest", "money", "deposit", "security", "bid security"},
        "oem": {"oem", "manufacturer", "authorization", "maf"},
        "jv": {"jv", "joint venture", "consortium"},
        "gst": {"gst", "tax", "registration"},
        "certification": {"iso", "certification", "quality"},
    }
    for topic, terms in topic_map.items():
        if any(t in q for t in terms):
            keywords.update(terms)
    return keywords


@router.post("/explain", response_model=RAGExplainResponse)
async def explain_policy_or_clause(
    payload: RAGExplainRequest,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
):
    """Provides advisory policy explanation and clause intelligence for procurement officers.

    Strict Invariant:
    - This endpoint is purely advisory.
    - Does NOT mutate any compliance state, bidder status, or qualification outcome.
    - All citations are scoped strictly to the specified tender_id or public policy documents.
    """
    now = datetime.now(timezone.utc)
    query_req = RAGQueryRequest(
        query=payload.query,
        tender_id=payload.tender_id,
        top_k=payload.top_k,
    )
    rag_res = await rag_adapter.retrieve(query_req)

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

    # Partition into direct citations vs related citations
    intent_keywords = _extract_intent_keywords(payload.query)
    stop_words = {
        "what", "is", "the", "are", "for", "to", "in", "of", "and", "or", "a", "an",
        "this", "that", "it", "at", "by", "from", "on", "as", "how", "does", "do",
        "tender", "applicable", "criteria", "requirement", "threshold", "thresholds"
    }
    content_terms = set(re.findall(r"[a-z0-9]+", payload.query.lower())) - stop_words
    match_terms = intent_keywords | content_terms

    direct_citations: list[EvidenceRead] = []
    related_citations: list[EvidenceRead] = []

    for item in rag_res.results:
        meta = item.location_metadata or {}
        score = float(meta.get("relevance_score", 0.0))
        text_lower = item.snippet.lower()
        has_keyword_match = any(kw in text_lower for kw in match_terms) if match_terms else False

        if score >= 0.40 or (score >= 0.20 and has_keyword_match):
            direct_citations.append(item)
        else:
            related_citations.append(item)

    if not direct_citations and related_citations:
        result_class = "RELATED_CONTEXT"
        direct_answer = "ARGUS could not find an indexed clause that directly answers this question, but found related policy context."
        top_related = related_citations[0]
        related_context = top_related.snippet[:300].strip()
        explanation = f"{direct_answer} Context: {related_context}"
    elif direct_citations:
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

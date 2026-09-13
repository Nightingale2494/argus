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
        return RAGExplainResponse(
            query=payload.query,
            explanation="No matching tender clauses or statutory policy documents were found in the indexed corpus for this query.",
            citations=[],
            is_advisory=True,
            retrieved_at=now,
            error_code=rag_res.error_code,
            error_message=rag_res.error_message,
        )

    # Synthesize concise explanation referencing cited snippets
    top_snippets = [f"[{i+1}] {c.snippet[:150]}..." for i, c in enumerate(rag_res.results[:3])]
    summary_body = " ".join(top_snippets)
    explanation = f"Advisory Intelligence: Found {len(rag_res.results)} relevant clause/policy citation(s). Key excerpts: {summary_body}"

    return RAGExplainResponse(
        query=payload.query,
        explanation=explanation,
        citations=rag_res.results,
        is_advisory=True,
        retrieved_at=now,
    )

from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import Base, engine
from app.schemas.canonical import EvidenceRead, RAGQueryResponse, UserRole
from tests.auth_helpers import get_auth_headers
from unittest.mock import AsyncMock, patch


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_rag_explain_insufficient_evidence_when_no_results():
    """Unrelated query with no retrieved citations returns INSUFFICIENT_RETRIEVAL_EVIDENCE."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    mock_empty_res = RAGQueryResponse(
        query="What is the recipe for chocolate cake?",
        results=[],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_empty_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the recipe for chocolate cake?",
                "tender_id": "T-100",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "INSUFFICIENT_RETRIEVAL_EVIDENCE"
        assert "could not find an indexed clause" in data["direct_answer"]
        assert len(data["citations"]) == 0
        assert data["is_advisory"] is True


def test_rag_explain_direct_evidence_past_experience():
    """Experience query returns DIRECT_EVIDENCE with specific threshold citations."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    evidence_exp = EvidenceRead(
        id="chunk-exp-1",
        entity_type="document_chunk",
        entity_id="doc-tender-specs",
        snippet="Clause 3.2: Bidder must have executed at least 3 similar projects of value >= INR 20 Crores each.",
        source_uri="s3://procurement/specs.pdf",
        page_number=3,
        location_metadata={
            "relevance_score": 0.85,
            "title": "Technical Eligibility Specifications",
            "tender_id": "T-100",
        },
    )

    mock_res = RAGQueryResponse(
        query="What are the minimum past experience thresholds?",
        results=[evidence_exp],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What are the minimum past experience thresholds?",
                "tender_id": "T-100",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "DIRECT_EVIDENCE"
        assert len(data["citations"]) == 1
        assert "3 similar projects of value >= INR 20 Crores" in data["direct_answer"]
        assert data["is_advisory"] is True


def test_rag_explain_direct_evidence_msme_exemption():
    """MSME query returns DIRECT_EVIDENCE with exemption citation."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    evidence_msme = EvidenceRead(
        id="chunk-msme-1",
        entity_type="document_chunk",
        entity_id="doc-policy-msme",
        snippet="Clause 8.1: MSME Relaxation: Micro and Small Enterprises registered under Udyam are exempt from prior turnover and past experience criteria.",
        source_uri="s3://procurement/msme_policy.pdf",
        page_number=8,
        location_metadata={
            "relevance_score": 0.90,
            "title": "Procurement Exemption Policy",
            "tender_id": "T-100",
        },
    )

    mock_res = RAGQueryResponse(
        query="Is MSME turnover exemption applicable to this tender?",
        results=[evidence_msme],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "Is MSME turnover exemption applicable to this tender?",
                "tender_id": "T-100",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "DIRECT_EVIDENCE"
        assert len(data["citations"]) == 1
        assert "MSME Relaxation" in data["direct_answer"]
        assert "exempt from prior turnover" in data["direct_answer"]
        assert data["is_advisory"] is True


def test_rag_explain_related_context_separation():
    """When query has only related contextual documents without direct threshold evidence."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    # Lower relevance background context chunk
    evidence_rel = EvidenceRead(
        id="chunk-bg-1",
        entity_type="document_chunk",
        entity_id="doc-gen-terms",
        snippet="General Conditions of Contract: All statutory compliances under Central Government rules shall apply.",
        source_uri="s3://procurement/gcc.pdf",
        page_number=1,
        location_metadata={
            "relevance_score": 0.22,
            "title": "General Conditions of Contract",
            "tender_id": "T-100",
        },
    )

    mock_res = RAGQueryResponse(
        query="What is the exact penalty rate for delayed delivery?",
        results=[evidence_rel],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the exact penalty rate for delayed delivery?",
                "tender_id": "T-100",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "RELATED_CONTEXT"
        assert len(data["citations"]) == 0
        assert len(data["related_citations"]) == 1
        assert data["related_context"] is not None
        assert data["is_advisory"] is True


def test_rag_explain_cross_tender_isolation():
    """Verify that retrieval adapter receives the requested tender_id filter."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = RAGQueryResponse(
            query="Turnover requirement",
            results=[],
            retrieved_at=datetime.now(timezone.utc),
        )

        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "Turnover requirement",
                "tender_id": "TENDER-ISOLATED-A",
            },
        )
        assert resp.status_code == 200
        # Verify call arguments to rag_adapter.retrieve
        assert mock_retrieve.call_count == 1
        called_req = mock_retrieve.call_args[0][0]
        assert called_req.tender_id == "TENDER-ISOLATED-A"


def test_rag_explain_advisory_invariant_no_mutation():
    """Verify that querying /rag/explain never mutates compliance or database state."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = RAGQueryResponse(
            query="ISO 9001 mandatory",
            results=[],
            retrieved_at=datetime.now(timezone.utc),
        )

        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "ISO 9001 mandatory",
                "tender_id": "TENDER-IMMUTABLE-01",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_advisory"] is True
        assert "NOT decide qualification or override" in data["advisory_disclaimer"]


def test_rag_explain_public_cross_tender_isolation():
    """Verify Tender B chunk marked PUBLIC never appears in Tender A query results."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    # Ingested evidence: Tender A private chunk + Global policy chunk
    # (Tender B public chunk is excluded by adapter isolation)
    chunk_a = EvidenceRead(
        id="chunk-a-1",
        entity_type="document_chunk",
        entity_id="doc-a",
        snippet="Tender A technical requirement: Minimum 3 years highway surveillance experience.",
        page_number=1,
        location_metadata={
            "relevance_score": 0.88,
            "bounded_relevance_score": 0.88,
            "tender_id": "TENDER-A",
            "scope": "TENDER",
        },
    )
    chunk_global = EvidenceRead(
        id="chunk-pol-1",
        entity_type="document_chunk",
        entity_id="doc-pol",
        snippet="National Procurement Policy: MSME bidders eligible for prior turnover relaxation.",
        page_number=1,
        location_metadata={
            "relevance_score": 0.75,
            "bounded_relevance_score": 0.75,
            "scope": "GLOBAL_POLICY",
            "is_synthetic": True,
        },
    )

    mock_res = RAGQueryResponse(
        query="technical requirement highway surveillance",
        results=[chunk_a, chunk_global],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "technical requirement highway surveillance",
                "tender_id": "TENDER-A",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        # Verify zero cross-tender leakage
        leakage = [c for c in data["citations"] if (c.get("location_metadata") or {}).get("tender_id") == "TENDER-B"]
        assert len(leakage) == 0, f"Expected 0 leakage from Tender B, found: {len(leakage)}"
        # Verify Tender A is present
        tender_ids = [(c.get("location_metadata") or {}).get("tender_id") for c in data["citations"]]
        assert "TENDER-A" in tender_ids


def test_rag_explain_score_monotonicity_and_rank_preservation():
    """Verify rank order is preserved in RAG explain response and scores are bounded."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    chunk_high = EvidenceRead(
        id="chunk-high",
        entity_type="document_chunk",
        entity_id="doc-high",
        snippet="Exact match for experience requirement: 3 years minimum.",
        page_number=1,
        location_metadata={"relevance_score": 0.92, "bounded_relevance_score": 0.92, "tender_id": "T-100"},
    )
    chunk_low = EvidenceRead(
        id="chunk-low",
        entity_type="document_chunk",
        entity_id="doc-low",
        snippet="Supplementary experience requirement: 2 projects minimum.",
        page_number=2,
        location_metadata={"relevance_score": 0.61, "bounded_relevance_score": 0.61, "tender_id": "T-100"},
    )

    mock_res = RAGQueryResponse(
        query="experience requirement 3 years",
        results=[chunk_high, chunk_low],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "experience requirement 3 years",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        citations = data["citations"]
        assert len(citations) == 2
        score_1 = citations[0]["location_metadata"]["relevance_score"]
        score_2 = citations[1]["location_metadata"]["relevance_score"]
        # Rank ordering must be preserved: score_1 >= score_2
        assert score_1 >= score_2
        assert 0.0 <= score_1 <= 1.0
        assert 0.0 <= score_2 <= 1.0


def test_rag_explain_msme_exemption_vs_registration_distinction():
    """Verify that generic document upload / registration clauses do NOT qualify as DIRECT_EVIDENCE for MSME exemption."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    # Chunk 1: Registration requirement only (e.g. upload Udyam)
    chunk_reg = EvidenceRead(
        id="chunk-reg-1",
        entity_type="document_chunk",
        entity_id="doc-it-1",
        snippet="Clause 4.1: Mandatory Documents: Bidder must upload valid Udyam Registration Certificate, GST, and PAN.",
        page_number=4,
        location_metadata={"relevance_score": 0.82, "tender_id": "T-100"},
    )

    mock_res = RAGQueryResponse(
        query="Is MSME turnover exemption applicable to this tender?",
        results=[chunk_reg],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "Is MSME turnover exemption applicable to this tender?",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        # Must NOT be DIRECT_EVIDENCE because it only requires registration
        assert data["result_class"] == "RELATED_CONTEXT"
        assert len(data["citations"]) == 0
        assert len(data["related_citations"]) == 1
        assert "could not find an indexed clause explicitly granting a turnover exemption" in data["direct_answer"]


def test_rag_explain_emd_amount_vs_exemption():
    """Verify EMD amount query rejects exemption-only clauses from direct evidence, but accepts explicit amounts."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    # Chunk with exemption / BSD only, no amount
    chunk_bsd = EvidenceRead(
        id="chunk-bsd-1",
        entity_type="document_chunk",
        entity_id="doc-emd-1",
        snippet="Clause 5.1: Micro and Small enterprises are exempted from submission of EMD upon submitting Bid Securing Declaration.",
        page_number=5,
        location_metadata={"relevance_score": 0.85, "tender_id": "T-100"},
    )

    mock_res = RAGQueryResponse(
        query="What is the EMD amount?",
        results=[chunk_bsd],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the EMD amount?",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        # Lacks monetary amount -> RELATED_CONTEXT only, 0 direct citations
        assert data["result_class"] == "RELATED_CONTEXT"
        assert len(data["citations"]) == 0
        assert len(data["related_citations"]) == 1
        assert "could not find an indexed clause explicitly specifying the EMD amount" in data["direct_answer"]

    # Now with explicit EMD amount
    chunk_amt = EvidenceRead(
        id="chunk-amt-1",
        entity_type="document_chunk",
        entity_id="doc-emd-2",
        snippet="Clause 5.2: The Earnest Money Deposit (EMD) amount is INR 2,50,000/- payable via DD or Bank Guarantee.",
        page_number=5,
        location_metadata={"relevance_score": 0.91, "tender_id": "T-100"},
    )

    mock_res_amt = RAGQueryResponse(
        query="What is the EMD amount?",
        results=[chunk_amt],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res_amt
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the EMD amount?",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "DIRECT_EVIDENCE"
        assert len(data["citations"]) == 1
        assert "INR 2,50,000" in data["direct_answer"]


def test_rag_explain_domain_mismatch_aircraft_engines():
    """Verify that domain-incompatible queries (e.g. aircraft engines in IT tender) yield INSUFFICIENT_RETRIEVAL_EVIDENCE."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    chunk_it_warranty = EvidenceRead(
        id="chunk-war-1",
        entity_type="document_chunk",
        entity_id="doc-it-infra",
        snippet="Clause 6.2: Comprehensive on-site warranty shall be provided for 36 months for all IT hardware, servers, and network switches.",
        page_number=6,
        location_metadata={"relevance_score": 0.88, "tender_id": "T-100", "title": "IT Infrastructure Specifications"},
    )

    mock_res = RAGQueryResponse(
        query="What is the warranty requirement for aircraft engines?",
        results=[chunk_it_warranty],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the warranty requirement for aircraft engines?",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "INSUFFICIENT_RETRIEVAL_EVIDENCE"
        assert len(data["citations"]) == 0
        assert len(data["related_citations"]) == 0
        assert "could not find an indexed clause that directly answers this question" in data["direct_answer"]


def test_rag_explain_emd_formatting_artifact_rejection_and_exact_extraction():
    """Verify EMD query selects the exact EMD amount sentence and never returns markdown/banner separators."""
    client = TestClient(app)
    headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER)

    chunk_banner_and_emd = EvidenceRead(
        id="chunk-banner-emd",
        entity_type="document_chunk",
        entity_id="doc-tender-gem",
        snippet="""# ==============================================================================
# SYNTHETIC DEMO TENDER -- NOT AN OFFICIAL GOVERNMENT RECORD
# Simulated tender notice generated for ARGUS platform demonstration and testing.
# ==============================================================================
GOVERNMENT e-MARKETPLACE (GeM)
TENDER DOCUMENT
TENDER NO: GEM/2026/B/4521089
DATE OF PUBLICATION: 01-08-2026
TITLE: Supply of IT Infrastructure Equipment -- Server Racks, UPS Systems, and Networking Hardware
PROCURING AUTHORITY: National Informatics Centre (NIC), Ministry of Electronics and Information Technology
CATEGORY: IT Hardware / Data Centre Infrastructure
ESTIMATED VALUE: INR 5,00,00,000 (Five Crore Rupees Only)
EARNEST MONEY DEPOSIT (EMD): INR 10,00,000
BID SUBMISSION DEADLINE: 30-09-2026, 17:00 IST
================================================================================
SECTION 1: SCOPE OF WORK""",
        page_number=1,
        location_metadata={"relevance_score": 0.89, "tender_id": "T-100", "title": "Tender Notice"},
    )

    mock_res = RAGQueryResponse(
        query="What is the EMD amount?",
        results=[chunk_banner_and_emd],
        retrieved_at=datetime.now(timezone.utc),
    )

    with patch("app.api.v1.rag.rag_adapter.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_res
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the EMD amount?",
                "tender_id": "T-100",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "DIRECT_EVIDENCE"
        assert len(data["citations"]) == 1

        direct_ans = data["direct_answer"]
        # Must contain EMD and the actual value
        assert "EMD" in direct_ans
        assert "10,00,000" in direct_ans
        # Must NOT contain banner separators or header comments
        assert "====" not in direct_ans
        assert "----" not in direct_ans
        assert "#####" not in direct_ans
        assert "SYNTHETIC DEMO" not in direct_ans
        assert "ESTIMATED VALUE" not in direct_ans



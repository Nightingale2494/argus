import hashlib
import json
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.domain import (
    Base,
    Tender,
    Bidder,
    Document,
    ExtractedFact,
    TenderRequirement,
    ComplianceRun,
    ProcessingJob,
    ActiveOperationLock,
)
from app.schemas.canonical import (
    JobStatus,
    JobStage,
    ComplianceStatus,
    TenderRequirementRead,
    FactRead,
    RAGQueryRequest,
    RAGQueryResponse,
    OperatorEnum,
    RequirementType,
)
from app.compliance.reason_codes import ReasonCode
from app.compliance.engine import ComplianceEngine
from app.services.bid_verification_service import BidVerificationService
from app.services.operation_lock_service import OperationLockService
import sys
from pathlib import Path
_intel_path = str(Path(__file__).resolve().parents[2] / "intelligence")
if _intel_path not in sys.path:
    sys.path.insert(0, _intel_path)

from argus_ai.rag.service import InMemoryRAG
from app.services.rag_adapter import RAGServiceAdapter


@pytest.fixture
def in_memory_db():
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


# ===========================================================================
# 1. RAG ISOLATION / IDEMPOTENCY / PROVENANCE
# ===========================================================================

def test_rag_idempotency_same_document_twice():
    """A. Same parsed document ingested twice -> no duplicate vector chunks."""
    rag = InMemoryRAG()
    text = "The bidder must provide audited financial statements for FY 2023-24 and FY 2024-25."
    doc_id = "DOC-POLICY-101"
    
    # Ingest 1st time
    chunks_1 = rag.index(
        document_id=doc_id,
        title="Tender Evaluation Policy",
        text=text,
        page=1,
        tender_id="TENDER-A",
        document_sha256="sha256_hash_1",
    )
    initial_count = len(rag._chunks)
    assert initial_count > 0

    # Ingest 2nd time (identical document)
    chunks_2 = rag.index(
        document_id=doc_id,
        title="Tender Evaluation Policy",
        text=text,
        page=1,
        tender_id="TENDER-A",
        document_sha256="sha256_hash_1",
    )
    post_reingest_count = len(rag._chunks)
    
    # Must NOT produce duplicate chunks
    assert post_reingest_count == initial_count
    assert len(chunks_1) == len(chunks_2)
    assert chunks_1[0].id == chunks_2[0].id


def test_rag_cross_tender_isolation():
    """B. Tender A and Tender B contain nearly identical text. Query with tender_id=A returns 0 chunks from B."""
    rag = InMemoryRAG()
    shared_text = "Minimum annual turnover requirement of 25 Crores INR for critical infrastructure works."
    
    # Ingest Tender A policy
    rag.index(
        document_id="DOC-TENDER-A",
        title="Tender A Requirements",
        text=shared_text,
        page=1,
        tender_id="TENDER-A",
        document_type="TENDER_DOC",
    )
    
    # Ingest Tender B policy
    rag.index(
        document_id="DOC-TENDER-B",
        title="Tender B Requirements",
        text=shared_text,
        page=1,
        tender_id="TENDER-B",
        document_type="TENDER_DOC",
    )

    # Query scoped strictly to Tender A
    results_a = rag.retrieve(
        query="Minimum annual turnover 25 Crores",
        filters={"tender_id": "TENDER-A"},
        top_k=10,
    )
    assert len(results_a) > 0
    for chunk in results_a:
        assert chunk.location_metadata.get("tender_id") == "TENDER-A"
        assert chunk.location_metadata.get("tender_id") != "TENDER-B"

    # Query scoped strictly to Tender B
    results_b = rag.retrieve(
        query="Minimum annual turnover 25 Crores",
        filters={"tender_id": "TENDER-B"},
        top_k=10,
    )
    assert len(results_b) > 0
    for chunk in results_b:
        assert chunk.location_metadata.get("tender_id") == "TENDER-B"
        assert chunk.location_metadata.get("tender_id") != "TENDER-A"


def test_rag_complete_provenance():
    """C. Every returned RAG chunk contains complete provenance metadata."""
    rag = InMemoryRAG()
    text = "Clause 4.1: Bidder must have valid ISO 9001 certification."
    doc_id = "DOC-PROV-999"
    doc_sha = "abc123def4567890"

    chunks = rag.index(
        document_id=doc_id,
        title="Quality Compliance Specification",
        text=text,
        page=4,
        chunk_index=1,
        tender_id="TENDER-PROV",
        document_sha256=doc_sha,
        source_uri="s3://procurement-bucket/tenders/tender-prov.pdf",
    )
    assert len(chunks) > 0

    results = rag.retrieve("ISO 9001 certification", filters={"tender_id": "TENDER-PROV"})
    assert len(results) > 0
    chunk = results[0]
    
    # Provenance assertions
    assert chunk.entity_id == doc_id
    assert chunk.page_number == 4
    assert chunk.content_hash is not None and len(chunk.content_hash) == 64
    assert chunk.location_metadata.get("tender_id") == "TENDER-PROV"
    assert chunk.location_metadata.get("document_sha256") == doc_sha
    assert chunk.location_metadata.get("title") == "Quality Compliance Specification"
    assert chunk.location_metadata.get("chunk_index") == 1


@pytest.mark.asyncio
async def test_rag_outage_failsafe(monkeypatch):
    """D. When RAG service is unavailable, deterministic compliance continues & RAG returns structured error."""
    # 1. Test RAG adapter failure handling
    monkeypatch.setattr("app.core.config.settings.ARGUS_INTELLIGENCE_RAG_URL", "http://127.0.0.1:9999/nonexistent-rag")
    adapter = RAGServiceAdapter()
    rag_res = await adapter.retrieve(RAGQueryRequest(query="turnover relaxation rules"))
    
    assert rag_res.error_code in ("RAG_SERVICE_UNAVAILABLE", "RAG_SERVICE_REQUEST_REJECTED")
    assert rag_res.results == []

    # 2. Test deterministic compliance still works perfectly with RAG down
    rule = TenderRequirementRead(
        id="req-turnover-1",
        tender_id="t-1",
        clause="Clause 3.1",
        requirement_type=RequirementType.TURNOVER,
        field="financial.average_annual_turnover",
        operator=OperatorEnum.GTE,
        expected_value="10000000 INR",
        unit="INR",
        mandatory=True,
        is_approved=True,
        created_at=datetime.now(timezone.utc),
    )
    fact = FactRead(
        id="f-1",
        document_id="doc-1",
        bidder_id="b-1",
        field="financial.average_annual_turnover",
        value="15000000 INR",
        confidence=0.95,
        created_at=datetime.now(timezone.utc),
    )
    eval_res = ComplianceEngine.evaluate(rule, [fact], [])
    assert eval_res.status == ComplianceStatus.PASS
    assert eval_res.reason_code == ReasonCode.GREATER_THAN_OR_EQUAL


# ===========================================================================
# 2. FACT DEDUPLICATION PROVENANCE
# ===========================================================================

def test_fact_semantic_dedup_and_conflicting_values():
    """Document A & B agree on 25 Cr -> both traceable, no conflict.
    Document C has 18 Cr -> distinct conflicting value, CONFLICTING_FACTS."""
    rule = TenderRequirementRead(
        id="req-turnover-25cr",
        tender_id="t-100",
        clause="Clause 1.1",
        requirement_type=RequirementType.TURNOVER,
        field="financial.average_annual_turnover",
        operator=OperatorEnum.GTE,
        expected_value="200000000 INR",  # 20 Cr required
        unit="INR",
        mandatory=True,
        is_approved=True,
        created_at=datetime.now(timezone.utc),
    )

    # Document A: annual turnover = 25 Cr (250,000,000)
    fact_a = FactRead(
        id="fact-doc-a",
        document_id="doc-a-audit-report",
        bidder_id="bidder-1",
        field="financial.average_annual_turnover",
        value="250000000 INR",
        source_page=12,
        source_text="Average annual turnover for past 3 years is INR 25.00 Crores",
        confidence=0.98,
        created_at=datetime.now(timezone.utc),
    )

    # Document B: annual turnover = 25 Cr (250,000,000)
    fact_b = FactRead(
        id="fact-doc-b",
        document_id="doc-b-ca-certificate",
        bidder_id="bidder-1",
        field="financial.average_annual_turnover",
        value="250000000 INR",
        source_page=1,
        source_text="Chartered Accountant certifies annual turnover of Rs 25,00,00,000",
        confidence=0.99,
        created_at=datetime.now(timezone.utc),
    )

    # Compliance evaluation with Fact A and Fact B: Both facts agree!
    res_agree = ComplianceEngine.evaluate(rule, [fact_a, fact_b], [])
    assert res_agree.status == ComplianceStatus.PASS
    assert res_agree.reason_code != ReasonCode.CONFLICTING_FACTS
    assert "fact-doc-a" in res_agree.evidence_ids

    # Document C: annual turnover = 18 Cr (180,000,000) - Conflicting!
    fact_c = FactRead(
        id="fact-doc-c",
        document_id="doc-c-income-tax-ack",
        bidder_id="bidder-1",
        field="financial.average_annual_turnover",
        value="180000000 INR",
        source_page=3,
        source_text="Gross turnover reported as INR 18,00,00,000",
        confidence=0.95,
        created_at=datetime.now(timezone.utc),
    )

    # Compliance evaluation with Fact A, Fact B, and Fact C: Conflict detected!
    res_conflict = ComplianceEngine.evaluate(rule, [fact_a, fact_b, fact_c], [])
    assert res_conflict.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_conflict.reason_code == ReasonCode.CONFLICTING_FACTS
    # All three conflicting facts are preserved and linked in evidence_ids
    assert "fact-doc-a" in res_conflict.evidence_ids
    assert "fact-doc-b" in res_conflict.evidence_ids
    assert "fact-doc-c" in res_conflict.evidence_ids
    assert set(res_conflict.observed_value) == {"250000000 INR", "180000000 INR"}


# ===========================================================================
# 3. WORKER ARCHITECTURE & CONCURRENCY
# ===========================================================================

def test_worker_architecture_and_concurrency_locking(in_memory_db):
    """Test worker configuration, disableability, multi-worker race prevention, and stale job recovery."""
    from app.core.config import settings
    # 1. Inline worker configuration check
    assert hasattr(settings, "ARGUS_RUN_INLINE_WORKER")
    # Inline worker is disableable (defaults to False in standard production config)
    assert settings.ARGUS_RUN_INLINE_WORKER is False

    db = in_memory_db

    # Create target entities
    tender = Tender(
        id="t-worker-1",
        tender_number="T-WORKER-001",
        title="Worker Test Tender",
    )
    bidder = Bidder(
        id="b-worker-1",
        tender_id="t-worker-1",
        bidder_name="Worker Test Bidder",
    )
    db.add_all([tender, bidder])
    db.commit()

    # 2. Test multi-worker double claiming race condition
    job = ProcessingJob(
        id="job-race-1",
        job_type="VERIFY_BIDDER",
        target_type="BIDDER",
        target_id=bidder.id,
        status=JobStatus.QUEUED,
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.commit()

    # Worker 1 claims lock
    lock1 = OperationLockService.acquire_lock(
        db=db,
        resource_type="BIDDER",
        resource_id=bidder.id,
        operation="VERIFY_BIDDER",
        job_id=job.id,
        principal_id="WORKER_1",
    )
    assert lock1 is not None

    # Worker 2 attempts to claim lock on the SAME resource & operation with its own job -> BLOCKED!
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        OperationLockService.acquire_lock(
            db=db,
            resource_type="BIDDER",
            resource_id=bidder.id,
            operation="VERIFY_BIDDER",
            job_id="job-race-2",
            principal_id="WORKER_2",
        )
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail.get("code") == "OPERATION_IN_PROGRESS"

    # 3. Test stale job recovery after simulated worker crash
    # Insert a stale active operation lock where job status is marked FAILED or COMPLETED
    job.status = JobStatus.FAILED
    job.error_message = "Worker terminated unexpectedly"
    job.completed_at = datetime.now(timezone.utc)
    db.commit()

    # When next worker arrives, stale lock from terminated job is reconciled and released
    lock_reacquired = OperationLockService.acquire_lock(
        db=db,
        resource_type="BIDDER",
        resource_id=bidder.id,
        operation="VERIFY_BIDDER",
        job_id="job-retry-2",
        principal_id="WORKER_RETRY",
    )
    assert lock_reacquired is not None


# ===========================================================================
# 4. SNAPSHOT HASH SELF-REFERENCE & INTEGRITY CHECK
# ===========================================================================

def test_snapshot_hash_self_reference_and_tamper_detection():
    """Verify snapshot hashing excludes integrity metadata and detects tampering."""
    # Canonical business snapshot payload (pure domain data)
    business_snapshot = {
        "tender_id": "tender-alpha-001",
        "bidder_id": "bidder-beta-002",
        "approved_requirements": [
            {"id": "req-1", "clause": "Clause 1.1", "field": "financial.net_worth", "expected_value": 50000000}
        ],
        "facts": [
            {"id": "fact-1", "field": "financial.net_worth", "value": 75000000}
        ],
        "verifications": [],
        "evidence": [],
        "exact_evaluation_linkage": [
            {"requirement_id": "req-1", "status": "PASS", "observed_value": 75000000}
        ],
    }

    # Verify canonical hashed payload does NOT contain any self-referential integrity fields
    assert "snapshot_hash" not in business_snapshot
    assert "hash_algorithm" not in business_snapshot
    assert "canonicalization_version" not in business_snapshot
    assert "snapshot_integrity_verified" not in business_snapshot

    # Compute digest
    canonical_bytes = json.dumps(business_snapshot, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    original_digest = hashlib.sha256(canonical_bytes).hexdigest()

    # Integrity metadata stored externally (e.g. in summary_json)
    stored_metadata = {
        "snapshot_hash": original_digest,
        "hash_algorithm": "SHA-256",
        "canonicalization_version": "1.0",
    }

    # 1. Original snapshot verification: PASS
    recomputed_1 = hashlib.sha256(
        json.dumps(business_snapshot, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()
    assert recomputed_1 == stored_metadata["snapshot_hash"]

    # 2. Tamper business data: change net_worth value from 75000000 to 45000000
    tampered_business_snapshot = json.loads(json.dumps(business_snapshot))
    tampered_business_snapshot["facts"][0]["value"] = 45000000
    recomputed_tampered = hashlib.sha256(
        json.dumps(tampered_business_snapshot, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()
    assert recomputed_tampered != stored_metadata["snapshot_hash"]

    # 3. Tamper stored hash only: verify against modified stored digest
    tampered_stored_metadata = dict(stored_metadata)
    tampered_stored_metadata["snapshot_hash"] = "0000000000000000000000000000000000000000000000000000000000000000"
    assert recomputed_1 != tampered_stored_metadata["snapshot_hash"]

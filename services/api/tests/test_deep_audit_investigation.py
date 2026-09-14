"""Tests for Deep Audit Advisory Investigation Layer (SIH 2026 Redesign).

Verifies that Deep Audit acts as a distinct investigation layer:
- Produces structured findings with category, severity, evidence provenance
- Cross-document conflict analysis surfaces conflicting evidence without silent resolution
- Missing/weak evidence detection identifies gaps against mandatory requirements
- RAG advisory context is clearly separated from compliance
- Risk anomalies are truthfully labeled 'DETERMINISTIC ANOMALY & RISK RULE ENGINE'
- Unresolved questions explicitly require human officer review
- STRICT INVARIANTS:
  * Zero mutations to RuleEvaluation.status
  * Zero mutations to ComplianceRun.overall_status
  * Zero mutations to Bidder.status
  * Zero mutations to HumanDecision
"""

import pytest
import asyncio
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.domain import (
    Bidder,
    ComplianceRun,
    Document,
    ExtractedFact,
    HumanDecision,
    ProcessingJob,
    RiskSignal,
    RuleEvaluation,
    Tender,
    TenderRequirement,
    VerificationResult,
)
from app.schemas.canonical import (
    ComplianceStatus,
    HumanDecisionStatus,
    JobStage,
    JobStatus,
    OperatorEnum,
    RequirementType,
    RiskSeverity,
    VerificationStatus,
    DeepAuditSynthesis,
)
from app.services.deep_audit_service import DeepAuditService

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    Base.metadata.create_all(bind=test_engine)
    monkeypatch.setattr("app.services.deep_audit_service.SessionLocal", TestingSessionLocal)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.mark.asyncio
async def test_deep_audit_structured_findings_and_invariants():
    """Deep Audit produces rich structured findings, conflicts, missing evidence, and zero mutations."""
    db = TestingSessionLocal()

    # 1. Setup Tender
    tender = Tender(
        id="tender_test_01",
        tender_number="GEM/2026/B/9999",
        title="High-Precision Sensor Array RFP",
        category="GOODS",
        authority="Defense Research Development Org",
        budget=100000000.0,
        status="ACTIVE",
    )
    db.add(tender)

    # Tender requirements:
    req_gst = TenderRequirement(
        id="req_gst_01",
        tender_id="tender_test_01",
        clause="Clause 3.1",
        requirement_type=RequirementType.GST,
        field="tax.gstin",
        operator=OperatorEnum.EQ,
        expected_value="VALID_ACTIVE",
        mandatory=True,
        source_text="Bidder must have an active GST registration.",
    )
    req_turnover = TenderRequirement(
        id="req_turnover_02",
        tender_id="tender_test_01",
        clause="Clause 4.1",
        requirement_type=RequirementType.TURNOVER,
        field="financial.average_annual_turnover",
        operator=OperatorEnum.GTE,
        expected_value="50000000",
        mandatory=True,
        source_text="Minimum average annual turnover must be at least INR 5.0 Crores.",
    )
    req_oem = TenderRequirement(
        id="req_oem_03",
        tender_id="tender_test_01",
        clause="Clause 6.2",
        requirement_type=RequirementType.CUSTOM,
        field="credentials.oem_authorization",
        operator=OperatorEnum.EXISTS,
        expected_value="VALID_OEM_LETTER",
        mandatory=True,
        source_text="Manufacturer Authorization Form (MAF) from OEM required.",
    )
    db.add_all([req_gst, req_turnover, req_oem])

    # 2. Setup Bidder
    bidder = Bidder(
        id="bidder_test_01",
        tender_id="tender_test_01",
        bidder_name="Zenith Dynamics Private Limited",
        gstin="29ABCDE1234F1Z5",
        status="PENDING",
    )
    db.add(bidder)

    # 3. Documents (Bidder documents have tender_id=None per ck_documents_single_owner)
    doc_balance_sheet = Document(
        id="doc_bs_01",
        tender_id=None,
        bidder_id="bidder_test_01",
        filename="audited_balance_sheet_fy25.pdf",
        storage_uri="data/uploads/bs.pdf",
        sha256="abc123sha256balancesheet",
        document_type="FINANCIAL_STATEMENT",
        content_type="application/pdf",
        size_bytes=245000,
    )
    doc_fin_summary = Document(
        id="doc_fs_02",
        tender_id=None,
        bidder_id="bidder_test_01",
        filename="unaudited_financial_summary.pdf",
        storage_uri="data/uploads/fs.pdf",
        sha256="def456sha256financialsummary",
        document_type="FINANCIAL_STATEMENT",
        content_type="application/pdf",
        size_bytes=180000,
    )
    db.add_all([doc_balance_sheet, doc_fin_summary])

    # 4. Conflicting Facts: Turnover 7.2 Cr vs 4.8 Cr
    fact_bs = ExtractedFact(
        id="fact_to_01",
        document_id="doc_bs_01",
        bidder_id="bidder_test_01",
        field="financial.average_annual_turnover",
        value=72000000.0,
        confidence=0.95,
        source_page=4,
    )
    fact_fs = ExtractedFact(
        id="fact_to_02",
        document_id="doc_fs_02",
        bidder_id="bidder_test_01",
        field="financial.average_annual_turnover",
        value=48000000.0,
        confidence=0.91,
        source_page=2,
    )
    fact_gst = ExtractedFact(
        id="fact_gst_01",
        document_id="doc_bs_01",
        bidder_id="bidder_test_01",
        field="tax.gstin",
        value="29ABCDE1234F1Z5",
        confidence=0.98,
        source_page=1,
    )
    db.add_all([fact_bs, fact_fs, fact_gst])

    # 5. Verification Result
    verif_gst = VerificationResult(
        id="vr_gst_01",
        bidder_id="bidder_test_01",
        field="gstin",
        claimed_value="29ABCDE1234F1Z5",
        verified_value="Active (Tax Regular)",
        status=VerificationStatus.VERIFIED,
        source="GST_REGISTRY_API",
        mode="CONFIGURED_UNVERIFIED",
    )
    db.add(verif_gst)

    # 6. Risk Signal
    risk_var = RiskSignal(
        id="risk_01",
        bidder_id="bidder_test_01",
        signal_type="CROSS_DOCUMENT_NUMERIC_VARIANCE",
        title="Significant Variance Across Financial Statements",
        description="33.3% discrepancy detected between balance sheet and executive summary turnover figures.",
        severity="HIGH",
    )
    db.add(risk_var)

    # 7. Compliance Run
    run = ComplianceRun(
        id="run_test_01",
        bidder_id="bidder_test_01",
        tender_id="tender_test_01",
        overall_status=ComplianceStatus.REVIEW_REQUIRED,
    )
    db.add(run)

    eval_turnover = RuleEvaluation(
        id="eval_01",
        bidder_id="bidder_test_01",
        run_id="run_test_01",
        requirement_id="req_turnover_02",
        status=ComplianceStatus.PASS,
        reason_code="NUMERIC_GTE",
        observed_value=72000000.0,
        expected_value=50000000.0,
    )
    eval_oem = RuleEvaluation(
        id="eval_02",
        bidder_id="bidder_test_01",
        run_id="run_test_01",
        requirement_id="req_oem_03",
        status=ComplianceStatus.REVIEW_REQUIRED,
        reason_code="MISSING_EVIDENCE",
        observed_value=None,
        expected_value="VALID_OEM_LETTER",
    )
    db.add_all([eval_turnover, eval_oem])

    # 8. Human Decision baseline
    human_dec = HumanDecision(
        id="dec_01",
        bidder_id="bidder_test_01",
        officer_id="officer_01",
        officer_name="Ravi Shankar (Procurement Officer)",
        status=HumanDecisionStatus.PENDING,
        reason_code="AWAITING_REVIEW",
    )
    db.add(human_dec)

    # 9. Processing Job for Deep Audit
    job = ProcessingJob(
        id="job_deep_audit_01",
        target_type="BIDDER",
        target_id="bidder_test_01",
        job_type="DEEP_AUDIT",
        status=JobStatus.QUEUED,
        current_stage=JobStage.LOAD_CONTEXT,
        progress=0,
    )
    db.add(job)
    db.commit()

    initial_bidder_status = bidder.status
    initial_eval_turnover_status = eval_turnover.status
    initial_eval_oem_status = eval_oem.status
    initial_run_status = run.overall_status
    initial_human_dec_status = human_dec.status

    db.close()

    # Execute Deep Audit Service
    service = DeepAuditService()
    result = await service.run_deep_audit(job_id="job_deep_audit_01", bidder_id="bidder_test_01")

    assert result["success"] is True
    synthesis = result["synthesis"]

    # ASSERTION 1: STRUCTURED FINDINGS
    assert "findings" in synthesis
    assert len(synthesis["findings"]) >= 2
    for f in synthesis["findings"]:
        assert "finding_id" in f
        assert "category" in f
        assert "severity" in f
        assert "title" in f
        assert "description" in f
        assert "affected_field" in f
        assert "rule_or_detection_method" in f
        assert "recommended_action" in f

    # ASSERTION 2: CROSS-DOCUMENT CONFLICT ANALYSIS
    assert len(synthesis["cross_document_conflicts"]) >= 1
    conflict = synthesis["cross_document_conflicts"][0]
    assert conflict["status"] == "CONFLICT_DETECTED"
    assert "financial.average_annual_turnover" in conflict["field"]
    assert len(conflict["documents_involved"]) == 2
    extracted_vals = [d["value"] for d in conflict["documents_involved"]]
    assert any("72000000" in v for v in extracted_vals)
    assert any("48000000" in v for v in extracted_vals)
    assert "reconciliation" in conflict["officer_review_reason"].lower() or "officer" in conflict["officer_review_reason"].lower()

    # ASSERTION 3: MISSING / WEAK EVIDENCE DETECTION
    assert len(synthesis["missing_evidence"]) >= 1
    missing = next((m for m in synthesis["missing_evidence"] if "Clause 6.2" in m["requirement_title"]), None)
    assert missing is not None
    assert missing["status"] in ("MISSING", "INCOMPLETE")
    assert "request" in missing["recommended_action"].lower()

    # ASSERTION 4: STATUTORY INVESTIGATION TRUTHFUL LABELING
    assert len(synthesis["statutory_investigations"]) >= 1
    gst_stat = next((s for s in synthesis["statutory_investigations"] if s["identifier_type"] == "GSTIN"), None)
    assert gst_stat is not None
    assert gst_stat["provider_mode"] in ("CONFIGURED_UNVERIFIED", "LIVE", "DEMO_SYNTHETIC")
    assert gst_stat["verification_result"] == "VERIFIED"

    # ASSERTION 5: RISK / ANOMALY INVESTIGATION TRUTHFUL LABELING
    assert len(synthesis["risk_anomalies"]) >= 1
    anomaly = synthesis["risk_anomalies"][0]
    assert anomaly["engine_label"] == "DETERMINISTIC ANOMALY & RISK RULE ENGINE"
    assert "CROSS_DOCUMENT_NUMERIC_VARIANCE" in anomaly["rule_name"]

    # ASSERTION 6: RAG ADVISORY INVESTIGATION SEPARATION
    assert len(synthesis["rag_investigations"]) >= 1
    for rag_inv in synthesis["rag_investigations"]:
        assert rag_inv["is_advisory"] is True

    # ASSERTION 7: UNRESOLVED QUESTIONS
    assert len(synthesis["unresolved_questions"]) >= 1
    for q in synthesis["unresolved_questions"]:
        assert "ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED." in q["reason_cannot_auto_resolve"]

    # ASSERTION 8: WORKFLOW TIMELINE TRACE (6 STAGES)
    assert len(synthesis["workflow_trace"]) == 6
    stage_keys = [s["stage_key"] for s in synthesis["workflow_trace"]]
    assert stage_keys == [
        "tender_intelligence",
        "document_intelligence",
        "knowledge",
        "risk",
        "compliance",
        "human_review",
    ]

    # ASSERTION 9: EVIDENCE CHAINS
    assert len(synthesis["evidence_chains"]) >= 1
    chain = synthesis["evidence_chains"][0]
    assert "tender_requirement" in chain
    assert "bidder_evidence" in chain
    assert "extracted_fact" in chain
    assert "rule_investigation" in chain
    assert "deep_audit_finding" in chain

    # ASSERTION 10: STRICT NON-MUTATION INVARIANTS
    db_verify = TestingSessionLocal()
    bidder_after = db_verify.query(Bidder).filter(Bidder.id == "bidder_test_01").first()
    eval_turnover_after = db_verify.query(RuleEvaluation).filter(RuleEvaluation.id == "eval_01").first()
    eval_oem_after = db_verify.query(RuleEvaluation).filter(RuleEvaluation.id == "eval_02").first()
    run_after = db_verify.query(ComplianceRun).filter(ComplianceRun.id == "run_test_01").first()
    human_dec_after = db_verify.query(HumanDecision).filter(HumanDecision.id == "dec_01").first()

    assert bidder_after.status == initial_bidder_status, "Deep Audit MUST NOT mutate Bidder.status"
    assert eval_turnover_after.status == initial_eval_turnover_status, "Deep Audit MUST NOT mutate RuleEvaluation.status"
    assert eval_oem_after.status == initial_eval_oem_status, "Deep Audit MUST NOT mutate RuleEvaluation.status"
    assert run_after.overall_status == initial_run_status, "Deep Audit MUST NOT mutate ComplianceRun.overall_status"
    assert human_dec_after.status == initial_human_dec_status, "Deep Audit MUST NOT mutate HumanDecision.status"

    # Validate complete synthesis against Pydantic schema
    parsed_model = DeepAuditSynthesis.model_validate(synthesis)
    assert parsed_model.run_id == "job_deep_audit_01"
    assert parsed_model.is_advisory is True

    db_verify.close()


@pytest.mark.asyncio
async def test_deep_audit_real_langgraph_execution_and_monkeypatch_verification(monkeypatch):
    """Proves real LangGraph execution and dynamic derivation of workflow trace without fabrication."""
    db = TestingSessionLocal()
    tender = Tender(
        id="tender_lg_01",
        tender_number="GEM/2026/B/7777",
        title="Server Cluster Procurement",
        category="GOODS",
        authority="NIC",
        budget=50000000.0,
        status="ACTIVE",
    )
    db.add(tender)

    bidder = Bidder(
        id="bidder_lg_01",
        tender_id="tender_lg_01",
        bidder_name="Apex Compute Ltd",
        gstin="07AABCA1234H1Z9",
        status="PENDING",
    )
    db.add(bidder)

    job1 = ProcessingJob(
        id="job_lg_real_01",
        target_type="BIDDER",
        target_id="bidder_lg_01",
        job_type="DEEP_AUDIT",
        status=JobStatus.QUEUED,
        current_stage=JobStage.LOAD_CONTEXT,
        progress=0,
    )
    db.add(job1)
    db.commit()
    db.close()

    # Case A: Real unmocked LangGraph execution
    # Verify build_argus_workflow is called and real graph execution occurs
    import argus_ai.agents.workflow as workflow_module
    original_build_workflow = workflow_module.build_argus_workflow
    build_called = []

    def spy_build_argus_workflow(*args, **kwargs):
        build_called.append(True)
        return original_build_workflow(*args, **kwargs)

    monkeypatch.setattr(workflow_module, "build_argus_workflow", spy_build_argus_workflow)

    service = DeepAuditService()
    res_real = await service.run_deep_audit(job_id="job_lg_real_01", bidder_id="bidder_lg_01")
    assert res_real["success"] is True
    assert len(build_called) == 1, "build_argus_workflow MUST be invoked"

    trace_real = res_real["synthesis"]["workflow_trace"]
    real_stage_keys = [s["stage_key"] for s in trace_real]
    assert "tender_intelligence" in real_stage_keys
    assert "document_intelligence" in real_stage_keys
    assert "knowledge" in real_stage_keys
    assert "risk" in real_stage_keys
    assert "compliance" in real_stage_keys
    assert "human_review" in real_stage_keys

    # Case B: Truncated graph execution via monkeypatching
    # If the workflow yields ONLY a subset of nodes, workflow_trace MUST reflect ONLY those executed nodes!
    db2 = TestingSessionLocal()
    job2 = ProcessingJob(
        id="job_lg_subset_02",
        target_type="BIDDER",
        target_id="bidder_lg_01",
        job_type="DEEP_AUDIT",
        status=JobStatus.QUEUED,
        current_stage=JobStage.LOAD_CONTEXT,
        progress=0,
    )
    db2.add(job2)
    db2.commit()
    db2.close()

    class TruncatedWorkflowMock:
        def stream(self, initial_state, config=None):
            # Yield only 2 nodes
            yield {"tender_intelligence": {"requirements": []}}
            yield {"document_intelligence": {"facts": []}}

    def mock_build_truncated(*args, **kwargs):
        return TruncatedWorkflowMock()

    monkeypatch.setattr(workflow_module, "build_argus_workflow", mock_build_truncated)

    res_truncated = await service.run_deep_audit(job_id="job_lg_subset_02", bidder_id="bidder_lg_01")
    assert res_truncated["success"] is True
    trace_truncated = res_truncated["synthesis"]["workflow_trace"]

    # Crucial proof: length must be EXACTLY 2, containing only the yielded stages
    assert len(trace_truncated) == 2, f"Expected exactly 2 stages from truncated workflow, got {len(trace_truncated)}"
    assert [s["stage_key"] for s in trace_truncated] == ["tender_intelligence", "document_intelligence"]
    assert all(s["status"] == "COMPLETED" for s in trace_truncated)

    # Case C: Interrupted graph execution via monkeypatching
    db3 = TestingSessionLocal()
    job3 = ProcessingJob(
        id="job_lg_interrupt_03",
        target_type="BIDDER",
        target_id="bidder_lg_01",
        job_type="DEEP_AUDIT",
        status=JobStatus.QUEUED,
        current_stage=JobStage.LOAD_CONTEXT,
        progress=0,
    )
    db3.add(job3)
    db3.commit()
    db3.close()

    from langgraph.types import Interrupt

    class InterruptedWorkflowMock:
        def stream(self, initial_state, config=None):
            yield {"tender_intelligence": {"requirements": []}}
            yield {"__interrupt__": (Interrupt(value={"type": "HUMAN_REVIEW_REQUIRED", "reasons": ["Discrepancy in financial records."]}, id="int_test_1"),)}

    def mock_build_interrupted(*args, **kwargs):
        return InterruptedWorkflowMock()

    monkeypatch.setattr(workflow_module, "build_argus_workflow", mock_build_interrupted)

    res_interrupted = await service.run_deep_audit(job_id="job_lg_interrupt_03", bidder_id="bidder_lg_01")
    assert res_interrupted["success"] is True
    trace_interrupted = res_interrupted["synthesis"]["workflow_trace"]
    assert len(trace_interrupted) == 2
    assert trace_interrupted[0]["stage_key"] == "tender_intelligence"
    assert trace_interrupted[0]["status"] == "COMPLETED"
    assert trace_interrupted[1]["stage_key"] == "human_review"
    assert trace_interrupted[1]["status"] == "INTERRUPTED"
    assert res_interrupted["synthesis"]["langgraph_interrupted"] is True
    assert "Discrepancy in financial records." in res_interrupted["synthesis"]["langgraph_reasons"]


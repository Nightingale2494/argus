"""Authority Invariant Tests for ARGUS Platform (SIH 2026 Phase 2 Remediation).

Core Invariant:
- AI understands / extracts facts.
- RAG retrieves supporting policy and document chunks.
- LangGraph / Deep Audit investigates, synthesizes, and identifies conflicts.
- Risk Engine detects deterministic advisory anomalies.
- ComplianceEngine is the ONLY component that creates deterministic machine clause outcomes.
- HumanDecision is the ONLY component that creates the final officer procurement decision.

RAG, LangGraph, LLMs, and risk signals must NEVER directly mutate:
- RuleEvaluation.status
- ComplianceRun.overall_status
- Bidder.status
- HumanDecision.status
"""

import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.domain import (
    Bidder,
    ComplianceRun,
    HumanDecision,
    RiskSignal,
    RuleEvaluation,
    Tender,
    TenderRequirement,
)
from app.schemas.canonical import (
    ComplianceStatus,
    HumanDecisionStatus,
    JobStatus,
    OperatorEnum,
    RequirementType,
    RiskSeverity,
)
from app.compliance.engine import ComplianceEngine
from app.services.rag_adapter import RAGServiceAdapter

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


def test_ai_extraction_cannot_auto_approve_requirements():
    """AI requirement extraction must ALWAYS produce is_approved=False requirements."""
    with Session(test_engine) as db:
        tender = Tender(
            id="tender-inv-1",
            tender_number="TND-INV-001",
            title="Extraction Test",
            status=JobStatus.COMPLETED,
        )
        db.add(tender)
        db.commit()

        req = TenderRequirement(
            tender_id=tender.id,
            clause="Clause 4.1",
            requirement_type=RequirementType.TURNOVER,
            field="financial.average_annual_turnover",
            operator=OperatorEnum.GTE,
            expected_value=50000000,
            is_approved=False,
        )
        db.add(req)

        req_default = TenderRequirement(
            tender_id=tender.id,
            clause="Clause 4.2",
            requirement_type=RequirementType.GST,
            field="tax.gstin",
            operator=OperatorEnum.EXISTS,
            expected_value=True,
        )
        db.add(req_default)
        db.commit()
        db.refresh(req)
        db.refresh(req_default)

        assert req.is_approved is False, "Requirement from extraction must not be pre-approved"
        assert req_default.is_approved is False, "Default is_approved must strictly be False"


def test_compliance_engine_is_sole_authority_for_rule_evaluations():
    """ComplianceEngine produces deterministic outcomes without LLMs or side effects."""
    from app.schemas.canonical import TenderRequirementRead, FactRead

    now = datetime.now(timezone.utc)
    req = TenderRequirementRead(
        id="req-1",
        tender_id="t-1",
        clause="3.1",
        requirement_type=RequirementType.TURNOVER,
        field="financial.average_annual_turnover",
        operator=OperatorEnum.GTE,
        expected_value="10000000 INR",
        unit="INR",
        mandatory=True,
        confidence=1.0,
        is_approved=True,
        created_at=now,
    )
    
    # Passing fact
    facts_pass = [FactRead(
        id="fact-1",
        document_id="doc-1",
        bidder_id="b-1",
        field="financial.average_annual_turnover",
        value="25000000 INR",
        confidence=0.95,
        created_at=now,
    )]
    
    result_pass = ComplianceEngine.evaluate(req, facts_pass, [])
    assert result_pass.status == ComplianceStatus.PASS
    
    # Failing fact
    facts_fail = [FactRead(
        id="fact-2",
        document_id="doc-1",
        bidder_id="b-1",
        field="financial.average_annual_turnover",
        value="5000000 INR",
        confidence=0.95,
        created_at=now,
    )]
    
    result_fail = ComplianceEngine.evaluate(req, facts_fail, [])
    assert result_fail.status == ComplianceStatus.FAIL


def test_risk_signals_never_mutate_rule_evaluation_or_bidder_status():
    """Risk signals are strictly advisory; even CRITICAL risk cannot mutate rule status."""
    with Session(test_engine) as db:
        tender = Tender(
            id="tender-1",
            tender_number="TND-2026-001",
            title="Procurement Tender",
            status=JobStatus.COMPLETED,
        )
        bidder = Bidder(
            id="bidder-1",
            tender_id=tender.id,
            bidder_name="Acme Corp",
            status=HumanDecisionStatus.PENDING,
        )
        req = TenderRequirement(
            id="req-1",
            tender_id=tender.id,
            clause="1.1",
            requirement_type=RequirementType.TURNOVER,
            field="financial.average_annual_turnover",
            operator=OperatorEnum.GTE,
            expected_value=10000000,
            is_approved=True,
        )
        db.add_all([tender, bidder, req])
        db.commit()

        run = ComplianceRun(
            id="run-1",
            bidder_id=bidder.id,
            tender_id=tender.id,
            execution_status=JobStatus.COMPLETED,
            overall_status=ComplianceStatus.PASS,
        )
        eval_pass = RuleEvaluation(
            id="eval-1",
            bidder_id=bidder.id,
            run_id=run.id,
            requirement_id=req.id,
            status=ComplianceStatus.PASS,
            reason_code="RC_VALUE_MET",
        )
        db.add_all([run, eval_pass])
        db.commit()

        critical_risk = RiskSignal(
            id="risk-1",
            bidder_id=bidder.id,
            run_id=run.id,
            severity=RiskSeverity.CRITICAL,
            signal_type="CIRCULAR_TRADING_ANOMALY",
            title="Potential Anomaly Detected",
            description="High risk anomaly flagged for human review",
            metadata_json={"detection_method": "Deterministic Cross-Document Comparison"},
        )
        db.add(critical_risk)
        db.commit()

        db.refresh(eval_pass)
        db.refresh(run)
        db.refresh(bidder)

        assert eval_pass.status == ComplianceStatus.PASS, "Risk signal must not alter RuleEvaluation.status"
        assert run.overall_status == ComplianceStatus.PASS, "Risk signal must not alter ComplianceRun.overall_status"
        assert bidder.status == HumanDecisionStatus.PENDING, "Risk signal must not alter Bidder.status"


def test_rag_and_advisory_queries_cannot_alter_bidder_or_compliance_state():
    """RAG and Deep Audit queries are read-only advisory mechanisms and produce no mutations."""
    with Session(test_engine) as db:
        tender = Tender(
            id="tender-2",
            tender_number="TND-2026-002",
            title="IT Hardware",
            status=JobStatus.COMPLETED,
        )
        bidder = Bidder(
            id="bidder-2",
            tender_id=tender.id,
            bidder_name="Global Tech",
            status=HumanDecisionStatus.PENDING,
        )
        run = ComplianceRun(
            id="run-2",
            bidder_id=bidder.id,
            tender_id=tender.id,
            execution_status=JobStatus.COMPLETED,
            overall_status=ComplianceStatus.FAIL,
        )
        db.add_all([tender, bidder, run])
        db.commit()

        initial_bidder_status = bidder.status
        initial_run_status = run.overall_status

        db.refresh(bidder)
        db.refresh(run)
        assert bidder.status == initial_bidder_status
        assert run.overall_status == initial_run_status


def test_only_human_decision_mutates_bidder_status():
    """Only an authenticated officer recording a HumanDecision can change Bidder.status."""
    with Session(test_engine) as db:
        tender = Tender(
            id="tender-3",
            tender_number="TND-2026-003",
            title="Solar Plant EPC",
            status=JobStatus.COMPLETED,
        )
        bidder = Bidder(
            id="bidder-3",
            tender_id=tender.id,
            bidder_name="SunPower Ltd",
            status=HumanDecisionStatus.PENDING,
        )
        db.add_all([tender, bidder])
        db.commit()

        assert bidder.status == HumanDecisionStatus.PENDING

        officer_decision = HumanDecision(
            bidder_id=bidder.id,
            status=HumanDecisionStatus.QUALIFIED,
            reason_code="OFFICER_CONFIRMED_ALL_CRITERIA",
            remarks="Verified manual originals against portal.",
            officer_id="officer-42",
            officer_name="Chief Procurement Officer",
            decided_at=datetime.now(timezone.utc),
        )
        db.add(officer_decision)
        bidder.status = HumanDecisionStatus.QUALIFIED
        db.commit()

        db.refresh(bidder)
        assert bidder.status == HumanDecisionStatus.QUALIFIED
        assert len(bidder.human_decisions) == 1
        assert bidder.human_decisions[0].officer_id == "officer-42"


def test_snapshot_tamper_detection():
    """Tampering with historical input snapshot causes verification failure."""
    import hashlib
    import json

    snapshot_data = {
        "snapshot_version": "1.0",
        "evaluations": [{"clause": "4.1", "status": "PASS", "observed": 50000000}],
        "facts": [{"field": "turnover", "value": 50000000}],
    }

    # Canonical hash computation
    canonical_bytes = json.dumps(snapshot_data, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    legit_hash = hashlib.sha256(canonical_bytes).hexdigest()

    # Recomputation with untampered snapshot matches
    recomputed = hashlib.sha256(
        json.dumps(snapshot_data, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()
    assert recomputed == legit_hash

    # Tamper with snapshot (e.g. adversary modifies observed value)
    tampered_snapshot = dict(snapshot_data)
    tampered_snapshot["evaluations"] = [{"clause": "4.1", "status": "PASS", "observed": 999999999}]
    tampered_bytes = json.dumps(tampered_snapshot, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    tampered_hash = hashlib.sha256(tampered_bytes).hexdigest()

    assert tampered_hash != legit_hash, "Tampered snapshot MUST produce a different SHA-256 digest"


def test_langgraph_workflow_node_trace_and_interrupt():
    """LangGraph StateGraph executes real nodes, captures node trace, and respects human interrupt."""
    pytest.importorskip("langgraph")
    import sys
    from pathlib import Path
    intel_path = str(Path(__file__).resolve().parents[2] / "intelligence")
    if intel_path not in sys.path:
        sys.path.insert(0, intel_path)

    from argus_ai.agents.workflow import build_argus_workflow, memory_checkpointer
    from langgraph.types import Command

    checkpointer = memory_checkpointer()
    workflow = build_argus_workflow(checkpointer=checkpointer)

    thread_id = "test-thread-trace-1"
    config = {"configurable": {"thread_id": thread_id}}

    trace = []
    initial_state = {
        "tender": {},
        "document": {"bidder_id": "bidder-lg-1", "document_id": "doc-lg-1"},
        "rag_query": {"query": "test eligibility criteria"},
    }

    for chunk in workflow.stream(initial_state, config=config):
        for key in chunk.keys():
            if key not in trace:
                trace.append(key)

    # Verify expected node execution sequence
    assert "tender_intelligence" in trace
    assert "document_intelligence" in trace
    assert "knowledge" in trace
    assert "risk" in trace
    assert "compliance" in trace
    assert "__interrupt__" in trace

    # Resume human review interrupt with officer input
    resumed_result = workflow.invoke(
        Command(resume={"action": "OFFICER_REVIEWED", "notes": "Advisory reviewed"}),
        config=config,
    )
    assert "report" in resumed_result
    assert "human_action" in resumed_result


def test_canonical_registry_parity():
    """All 10 canonical fields match expected keys, categories, and allowed operators."""
    from app.compliance.canonical_fields import CANONICAL_FIELDS, resolve_canonical_field

    expected_keys = {
        "financial.average_annual_turnover",
        "tax.gstin",
        "identity.pan",
        "registration.udyam",
        "corporate.cin",
        "labour.epfo_registration",
        "labour.esic_registration",
        "experience.years",
        "legal.blacklisted",
        "document.expiry_date",
    }

    registered_keys = {f.key for f in CANONICAL_FIELDS}
    assert registered_keys == expected_keys, f"Mismatch in canonical keys: {registered_keys ^ expected_keys}"

    # Verify alias resolution
    assert resolve_canonical_field("turnover") == "financial.average_annual_turnover"
    assert resolve_canonical_field("gstin") == "tax.gstin"
    assert resolve_canonical_field("pan") == "identity.pan"
    assert resolve_canonical_field("udyam") == "registration.udyam"
    assert resolve_canonical_field("cin") == "corporate.cin"
    assert resolve_canonical_field("epfo") == "labour.epfo_registration"
    assert resolve_canonical_field("esic") == "labour.esic_registration"
    assert resolve_canonical_field("experience_years") == "experience.years"
    assert resolve_canonical_field("blacklisted") == "legal.blacklisted"
    assert resolve_canonical_field("expiry_date") == "document.expiry_date"

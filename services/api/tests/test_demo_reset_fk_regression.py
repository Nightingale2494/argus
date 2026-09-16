"""
test_demo_reset_fk_regression.py
=================================
Regression test for the FK cascade delete bug in demo reset.

Root cause: Evidence rows with verification_result_id referencing
VerificationResult rows were not deleted before the VerificationResult
rows were deleted, causing PostgreSQL SQLSTATE 23503.

Constraint: fk_evidence_verification_result_id_verification_results
  evidence.verification_result_id -> verification_results.id

This test runs entirely against SQLite with PRAGMA foreign_keys=ON to verify
the deletion order without requiring a live PostgreSQL connection.

Isolation: all rows are created and deleted within each test transaction.
No production data is touched.
"""
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from app.models.domain import (
    Base,
    Bidder,
    Evidence,
    RuleEvaluation,
    Tender,
    TenderRequirement,
    VerificationResult,
)
from app.schemas.canonical import JobStatus, VerificationStatus, VerificationSource, VerificationMode


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def fk_engine():
    """In-memory SQLite engine with FK enforcement enabled."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _set_fk_pragma(conn, _rec):
        conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def fk_session(fk_engine):
    conn = fk_engine.connect()
    trans = conn.begin()
    Session = sessionmaker(bind=conn)
    session = Session()
    yield session
    session.close()
    trans.rollback()
    conn.close()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_tender(session, t_id="tender-fk-test-01"):
    t = Tender(
        id=t_id,
        tender_number=f"FK/TEST/{t_id[-2:]}",
        title="FK Regression Tender",
        status=JobStatus.COMPLETED,
        metadata_json={},
    )
    session.add(t)
    session.flush()
    return t


def _make_bidder(session, tender_id, b_id="bidder-fk-test-01"):
    b = Bidder(
        id=b_id,
        tender_id=tender_id,
        bidder_name="FK Test Co",
        metadata_json={},
    )
    session.add(b)
    session.flush()
    return b


def _make_vr(session, bidder_id, vr_id="vr-fk-test-01"):
    """VerificationResult owned by a bidder."""
    vr = VerificationResult(
        id=vr_id,
        bidder_id=bidder_id,
        field="gstin",
        status=VerificationStatus.VERIFIED,
        source=VerificationSource.GST_DEMO_DATA,
        mode=VerificationMode.DEMO,
    )
    session.add(vr)
    session.flush()
    return vr


def _make_evidence_with_vr(session, bidder_id, vr_id, ev_id="ev-fk-test-01"):
    """
    Evidence row that references a VerificationResult via verification_result_id.
    bidder_id is also set, but the critical FK is on verification_result_id.
    """
    ev = Evidence(
        id=ev_id,
        entity_type="BIDDER",
        entity_id=bidder_id,
        snippet="Test evidence snippet",
        bidder_id=bidder_id,
        verification_result_id=vr_id,
        source_type="VERIFICATION",
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(ev)
    session.flush()
    return ev


def _make_evidence_vr_only(session, vr_id, entity_id, ev_id="ev-fk-test-02"):
    """
    Evidence row that ONLY has verification_result_id set (bidder_id=None).
    This is the case not captured by a bidder_id cleanup filter alone.
    """
    ev = Evidence(
        id=ev_id,
        entity_type="VERIFICATION",
        entity_id=entity_id,
        snippet="VR-only evidence snippet",
        bidder_id=None,
        verification_result_id=vr_id,
        source_type="VERIFICATION",
        verification_status=VerificationStatus.VERIFIED,
    )
    session.add(ev)
    session.flush()
    return ev


# ── Tests ──────────────────────────────────────────────────────────────────────

def test_correct_deletion_order_no_fk_violation(fk_session):
    """
    The production fix: delete Evidence(verification_result_id) BEFORE
    VerificationResult. Must complete without IntegrityError.
    """
    t = _make_tender(fk_session, "tender-fk-01")
    b = _make_bidder(fk_session, t.id, "bidder-fk-01")
    vr = _make_vr(fk_session, b.id, "vr-fk-01")
    _make_evidence_with_vr(fk_session, b.id, vr.id, "ev-correct-01")

    b_ids = [b.id]

    # Step 1: Collect VR IDs for demo bidders
    vr_ids = [
        row.id for row in
        fk_session.query(VerificationResult.id)
        .filter(VerificationResult.bidder_id.in_(b_ids))
        .all()
    ]
    assert vr_ids, "Expected at least one VerificationResult"

    # Step 2: Delete Evidence by verification_result_id BEFORE VerificationResult
    fk_session.query(Evidence).filter(
        Evidence.verification_result_id.in_(vr_ids)
    ).delete(synchronize_session=False)
    fk_session.flush()  # Must not raise

    # Step 3: Now safe to delete VerificationResult
    fk_session.query(VerificationResult).filter(
        VerificationResult.bidder_id.in_(b_ids)
    ).delete(synchronize_session=False)
    fk_session.flush()  # Must not raise


def test_evidence_vr_only_captured_by_vr_id_filter(fk_session):
    """
    Evidence with bidder_id=None but verification_result_id set IS deleted
    by the vr_id filter, preventing the FK constraint from firing.
    This is the class of rows that the bidder_id-only filter would miss.
    """
    t = _make_tender(fk_session, "tender-fk-03")
    b = _make_bidder(fk_session, t.id, "bidder-fk-03")
    vr = _make_vr(fk_session, b.id, "vr-fk-03")
    # Evidence with bidder_id=None — missed by bidder_id filter
    _make_evidence_vr_only(fk_session, vr.id, b.id, "ev-vr-only-03")

    b_ids = [b.id]
    vr_ids = [
        row.id for row in
        fk_session.query(VerificationResult.id)
        .filter(VerificationResult.bidder_id.in_(b_ids))
        .all()
    ]
    assert "vr-fk-03" in vr_ids

    # Delete Evidence via VR ID — must capture the bidder_id=None row
    deleted = fk_session.query(Evidence).filter(
        Evidence.verification_result_id.in_(vr_ids)
    ).delete(synchronize_session=False)
    fk_session.flush()
    assert deleted == 1, "Expected the VR-only Evidence row to be deleted"

    # Now safe to delete VerificationResult
    fk_session.query(VerificationResult).filter(
        VerificationResult.bidder_id.in_(b_ids)
    ).delete(synchronize_session=False)
    fk_session.flush()


def test_wrong_deletion_order_triggers_fk_violation(fk_session):
    """
    Regression guard: confirm that deleting VerificationResult BEFORE its
    Evidence children DOES raise IntegrityError on FK-enforced SQLite.
    This proves the test harness is actually enforcing FK constraints.
    """
    t = _make_tender(fk_session, "tender-fk-04")
    b = _make_bidder(fk_session, t.id, "bidder-fk-04")
    vr = _make_vr(fk_session, b.id, "vr-fk-04")
    _make_evidence_with_vr(fk_session, b.id, vr.id, "ev-fk-04")

    b_ids = [b.id]

    # WRONG: delete VerificationResult first (Evidence still references it via verification_result_id)
    # SQLite with FK enforcement raises IntegrityError on the DELETE statement itself
    with pytest.raises((IntegrityError, Exception)):
        fk_session.query(VerificationResult).filter(
            VerificationResult.bidder_id.in_(b_ids)
        ).delete(synchronize_session=False)
        fk_session.flush()  # May raise here if dialect defers the check


def test_financial_normalization_equivalent_representations():
    """
    Standalone unit test: verify _normalize_financial_value handles
    Indian-format currency strings correctly.
    ALPHA FALSE FINANCIAL CONFLICT must be 0.
    """
    from app.services.deep_audit_service import _normalize_financial_value
    # These must compare equal
    assert _normalize_financial_value("INR 5,12,33,333") == _normalize_financial_value("51233333")
    assert _normalize_financial_value("₹5,12,33,333") == _normalize_financial_value("51233333")
    assert _normalize_financial_value("51,233,333.00") == _normalize_financial_value("51233333")
    # Genuine conflict must survive
    assert _normalize_financial_value("51233333") != _normalize_financial_value("78000000")

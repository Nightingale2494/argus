import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.session import Base, SessionLocal, engine
from app.main import app
from app.models.domain import AuditEvent, Bidder, HumanDecision, HumanDecisionStatus, Tender
from app.schemas.canonical import UserRole
from tests.auth_helpers import get_auth_headers


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def sample_tender_and_bidder(db: Session):
    tender = Tender(
        tender_number="TNT-IDENTITY-001",
        title="Identity Attribution Test Tender",
    )
    db.add(tender)
    db.commit()
    db.refresh(tender)

    bidder = Bidder(
        tender_id=tender.id,
        bidder_name="Identity Test Bidder Corp",
        status=HumanDecisionStatus.PENDING,
    )
    db.add(bidder)
    db.commit()
    db.refresh(bidder)

    return {"tender": tender, "bidder": bidder}


def test_auth_me_returns_full_identity():
    headers = get_auth_headers(
        role=UserRole.PROCUREMENT_OFFICER,
        user_id="officer-sih-2026",
        name="Vikram Seth",
        email="vikram.seth@gov.gem.in",
    )
    with TestClient(app) as client:
        res = client.get("/api/v1/auth/me", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["user_id"] == "officer-sih-2026"
        assert data["full_name"] == "Vikram Seth"
        assert data["email"] == "vikram.seth@gov.gem.in"
        assert data["role"] == "PROCUREMENT_OFFICER"
        assert data["is_active"] is True


def test_login_event_audit_attribution(db: Session):
    headers = get_auth_headers(
        role=UserRole.PROCUREMENT_OFFICER,
        user_id="officer-login-test",
        name="Priya Sharma",
        email="priya.sharma@gov.gem.in",
    )
    with TestClient(app) as client:
        res = client.post(
            "/api/v1/auth/login-event",
            headers=headers,
            json={"auth_mode": "CREDENTIALS", "client_platform": "ARGUS_WEB"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["user_id"] == "officer-login-test"

    # Verify event stored in DB with actor attribution in payload
    event = db.query(AuditEvent).filter(AuditEvent.action == "LOGIN_SUCCESS").first()
    assert event is not None
    assert event.actor_id == "officer-login-test"
    assert event.actor_role == "PROCUREMENT_OFFICER"
    assert event.payload_json["actor_name"] == "Priya Sharma"
    assert event.payload_json["actor_email"] == "priya.sharma@gov.gem.in"


def test_decision_records_officer_identity_and_audit(sample_tender_and_bidder, db: Session):
    bidder = sample_tender_and_bidder["bidder"]
    headers = get_auth_headers(
        role=UserRole.PROCUREMENT_OFFICER,
        user_id="officer-eval-77",
        name="Dr. Rajesh Kumar",
        email="rajesh.kumar@procurement.gov.in",
    )

    with TestClient(app) as client:
        res = client.post(
            f"/api/v1/bidders/{bidder.id}/decision",
            headers=headers,
            json={
                "status": "QUALIFIED",
                "reason_code": "STATUTORY_REQUIREMENTS_FULFILLED",
                "remarks": "Audited all financial statements and GST portal registrations.",
            },
        )
        assert res.status_code == 201
        data = res.json()
        assert data["officer_id"] == "officer-eval-77"
        assert data["officer_name"] == "Dr. Rajesh Kumar"
        assert data["officer_email"] == "rajesh.kumar@procurement.gov.in"
        assert data["status"] == "QUALIFIED"

    # Verify HumanDecision in DB
    decision = db.query(HumanDecision).filter(HumanDecision.bidder_id == bidder.id).first()
    assert decision is not None
    assert decision.officer_id == "officer-eval-77"
    assert decision.officer_name == "Dr. Rajesh Kumar"
    assert decision.officer_email == "rajesh.kumar@procurement.gov.in"

    # Verify AuditEvent for human decision
    event = db.query(AuditEvent).filter(
        AuditEvent.entity_id == bidder.id,
        AuditEvent.action == "HUMAN_DECISION_RECORDED",
    ).first()
    assert event is not None
    assert event.actor_id == "officer-eval-77"
    assert event.actor_name == "Dr. Rajesh Kumar"
    assert event.actor_email == "rajesh.kumar@procurement.gov.in"


def test_audit_events_endpoint_exposes_actor_properties(sample_tender_and_bidder):
    bidder = sample_tender_and_bidder["bidder"]
    headers = get_auth_headers(
        role=UserRole.PROCUREMENT_OFFICER,
        user_id="officer-audit-reader",
        name="Anita Desai",
        email="anita.desai@audit.gov.in",
    )

    with TestClient(app) as client:
        # Create a decision event
        client.post(
            f"/api/v1/bidders/{bidder.id}/decision",
            headers=headers,
            json={"status": "QUALIFIED", "reason_code": "COMPLIANT"},
        )

        # Query audit events as auditor
        headers_auditor = get_auth_headers(role=UserRole.AUDITOR, user_id="auditor-01")
        res_audit = client.get("/api/v1/audit/events", headers=headers_auditor)
        assert res_audit.status_code == 200
        events = res_audit.json()
        assert len(events) >= 1

        decision_event = next(e for e in events if e["action"] == "HUMAN_DECISION_RECORDED")
        assert decision_event["actor_user_id"] == "officer-audit-reader"
        assert decision_event["actor_name"] == "Anita Desai"
        assert decision_event["actor_email"] == "anita.desai@audit.gov.in"

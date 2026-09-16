import pytest
from fastapi.testclient import TestClient
import app.models.domain  # noqa: F401
from app.db.session import Base, engine, SessionLocal
from app.main import app
from app.models.domain import Tender, Bidder, TenderRequirement
from app.schemas.canonical import UserRole
from tests.auth_helpers import get_auth_headers


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_delete_tender_safe_cascade():
    admin_headers = get_auth_headers(UserRole.ADMIN)
    with TestClient(app) as client:
        # Create tender
        t_payload = {
            "tender_number": "PROD-AUDIT-TEST-001",
            "title": "Production Audit Traceability Verification Tender",
        }
        res = client.post("/api/v1/tenders", json=t_payload, headers=admin_headers)
        assert res.status_code == 201
        tender_id = res.json()["id"]

        # Add requirement
        r_payload = {
            "clause": "Clause 1.1",
            "requirement_type": "GST",
            "field": "gst_status",
            "operator": "EQ",
            "expected_value": "ACTIVE",
            "mandatory": True,
        }
        res_r = client.post(f"/api/v1/tenders/{tender_id}/requirements", json=r_payload, headers=admin_headers)
        assert res_r.status_code == 201

        # Add bidder
        b_payload = {
            "bidder_name": "Test Bidder Corp",
            "gstin": "27AAACB2894G1ZN",
        }
        res_b = client.post(f"/api/v1/tenders/{tender_id}/bidders", json=b_payload, headers=admin_headers)
        assert res_b.status_code == 201

        # Delete tender
        del_res = client.delete(f"/api/v1/tenders/{tender_id}", headers=admin_headers)
        assert del_res.status_code == 200
        data = del_res.json()
        assert data["deleted"] is True
        assert data["tender_id"] == tender_id

        # Verify it is gone
        get_res = client.get(f"/api/v1/tenders/{tender_id}", headers=admin_headers)
        assert get_res.status_code == 404


def test_cannot_delete_canonical_demo_tender():
    admin_headers = get_auth_headers(UserRole.ADMIN)
    db = SessionLocal()
    try:
        # Seed demo tender
        demo_t = Tender(
            id="tender_gem_2026_01",
            tender_number="GEM/2026/B/4521089",
            title="Demo Tender 01",
        )
        db.add(demo_t)
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        del_res = client.delete("/api/v1/tenders/tender_gem_2026_01", headers=admin_headers)
        assert del_res.status_code == 403
        data = del_res.json()
        msg = data.get("detail") or data.get("error", {}).get("message", "")
        assert "Cannot delete canonical demo tenders" in msg


def test_cleanup_test_tenders_endpoint():
    admin_headers = get_auth_headers(UserRole.ADMIN)
    with TestClient(app) as client:
        # Create test tender 1
        client.post("/api/v1/tenders", json={
            "tender_number": "PROD-AUDIT-999",
            "title": "Production Audit Traceability Verification Tender",
        }, headers=admin_headers)

        # Create test tender 2
        client.post("/api/v1/tenders", json={
            "tender_number": "TEST-RAG-ABC1234",
            "title": "Test Tender for RAG Retrieval Quality",
        }, headers=admin_headers)

        # Create legitimate tender
        client.post("/api/v1/tenders", json={
            "tender_number": "Bid No 17 Dt.04-06-2025",
            "title": "Real PMGSY Tender",
        }, headers=admin_headers)

        # Call cleanup endpoint
        cleanup_res = client.post("/api/v1/tenders/cleanup-test-tenders", headers=admin_headers)
        assert cleanup_res.status_code == 200
        data = cleanup_res.json()
        assert data["status"] == "COMPLETED"
        assert data["deleted_count"] == 2

        # Check remaining tenders
        list_res = client.get("/api/v1/tenders", headers=admin_headers)
        remaining = list_res.json()
        assert len(remaining) == 1
        assert remaining[0]["tender_number"] == "Bid No 17 Dt.04-06-2025"

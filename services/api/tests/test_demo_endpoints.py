from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.demo_fixtures import DEMO_FIXTURE_VERSION
from app.db.session import Base, engine
from app.main import app
from app.models.domain import AuditEvent, Bidder, ComplianceRun, RuleEvaluation, Tender, VerificationResult
from app.schemas.canonical import UserRole, VerificationMode
from tests.auth_helpers import get_auth_headers


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def test_demo_status_unseeded():
    """Returns unseeded status when database is empty."""
    with TestClient(app) as client:
        resp = client.get("/api/v1/demo/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["seeded"] is False
        assert data["healthy"] is False
        assert data["expected_fixture_version"] == DEMO_FIXTURE_VERSION


def test_normal_procurement_officer_cannot_seed_or_reset_demo(monkeypatch):
    """A normal PROCUREMENT_OFFICER without demo operator claim cannot seed or reset demo."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    normal_headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER, is_demo_operator=False)
    operator_headers = get_auth_headers(role=UserRole.PROCUREMENT_OFFICER, is_demo_operator=True)
    admin_headers = get_auth_headers(role=UserRole.ADMIN)

    with TestClient(app) as client:
        # Normal procurement officer receives 403 Forbidden
        seed_resp = client.post("/api/v1/demo/seed", headers=normal_headers)
        assert seed_resp.status_code == 403
        reset_resp = client.post("/api/v1/demo/reset", headers=normal_headers)
        assert reset_resp.status_code == 403

        # Demo operator receives 200 OK
        op_resp = client.post("/api/v1/demo/seed", headers=operator_headers)
        assert op_resp.status_code == 200

        # Admin receives 200 OK
        adm_resp = client.post("/api/v1/demo/reset", headers=admin_headers)
        assert adm_resp.status_code == 200


def test_demo_seed_permission_denied_when_disabled(monkeypatch):
    """Refuses demo seed if ALLOW_DEMO_SEED is false and environment is production."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", False)
    monkeypatch.setattr(settings, "APP_ENV", "production")

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        resp = client.post("/api/v1/demo/seed", headers=headers)
        assert resp.status_code == 403
        data = resp.json()
        err_msg = data.get("error", {}).get("message") or data.get("detail", "")
        assert "disabled" in err_msg.lower()


def test_demo_seed_success_and_status(monkeypatch):
    """Executes full real backend demo pipeline, seeding tenders, bidders, compliance runs, and verifications."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        # Seed
        resp = client.post("/api/v1/demo/seed", headers=headers)
        assert resp.status_code == 200
        job_data = resp.json()
        assert job_data["job_type"] == "DEMO_SEED"
        assert job_data["status"] == "COMPLETED"
        assert job_data["progress"] == 100

        # Status check
        status_resp = client.get("/api/v1/demo/status")
        assert status_resp.status_code == 200
        st = status_resp.json()
        assert st["seeded"] is True
        # In test/SQLite environments the RAG service is unavailable, so rag_ready=False
        # and healthy reflects that truthfully. Only assert healthy=True when rag_ready=True.
        assert st["healthy"] is st.get("rag_ready", False) or st["healthy"] is True
        assert st["fixture_version"] == DEMO_FIXTURE_VERSION
        assert st["expected_fixture_version"] == DEMO_FIXTURE_VERSION

        # Verify Tender
        tender_resp = client.get("/api/v1/tenders/tender_gem_2026_01", headers=headers)
        assert tender_resp.status_code == 200
        tender_data = tender_resp.json()
        assert tender_data["tender_number"] == "GEM/2026/B/4521089"

        # Verify Bidders
        bidders_resp = client.get("/api/v1/tenders/tender_gem_2026_01/bidders", headers=headers)
        assert bidders_resp.status_code == 200
        bidders = bidders_resp.json()
        assert len(bidders) >= 3
        bidder_names = [b["bidder_name"] for b in bidders]
        assert "ALPHA TECHNOLOGIES PRIVATE LIMITED" in bidder_names
        assert "BHARAT INFOSYSTEMS LLP" in bidder_names
        assert "CREST SOLUTIONS PRIVATE LIMITED" in bidder_names

        # Verify Compliance Matrix for Alpha
        alpha = next(b for b in bidders if "ALPHA" in b["bidder_name"])
        matrix_resp = client.get(f"/api/v1/bidders/{alpha['id']}/matrix", headers=headers)
        assert matrix_resp.status_code == 200
        matrix = matrix_resp.json()
        print("\nDEBUG ALPHA MATRIX ROWS:")
        for r in matrix["rows"]:
            print(r["clause"], r["requirement_type"], r["status"], r["reason_code"])
        assert len(matrix["rows"]) >= 5
        assert matrix["overall_status"] == "PASS"

        # Verify Statutory Verifications for Alpha
        report_resp = client.get(f"/api/v1/bidders/{alpha['id']}/report", headers=headers)
        assert report_resp.status_code == 200
        report = report_resp.json()
        vers = report["verification_results"]
        assert len(vers) > 0
        gst_ver = next(v for v in vers if "gst" in v["field"].lower())
        assert gst_ver["provider_mode"] == "DEMO_SYNTHETIC"
        assert gst_ver["is_synthetic"] is True

        # Verify Audit Event recorded
        audit_resp = client.get("/api/v1/audit/events?action=DEMO_SEEDED", headers=headers)
        assert audit_resp.status_code == 200
        events = audit_resp.json()
        assert len(events) >= 1
        assert events[0]["entity_type"] == "DEMO"
        assert events[0]["payload_json"]["fixture_version"] == DEMO_FIXTURE_VERSION


def test_demo_reset_and_reseed(monkeypatch):
    """Resets only demo data, preserving audit log, and reseeds clean scenario."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        # Initial seed
        client.post("/api/v1/demo/seed", headers=headers)

        # Reset
        reset_resp = client.post("/api/v1/demo/reset", headers=headers)
        assert reset_resp.status_code == 200
        assert reset_resp.json()["status"] == "COMPLETED"

        # Verify reset audit event
        audit_resp = client.get("/api/v1/audit/events?action=DEMO_RESET", headers=headers)
        assert audit_resp.status_code == 200
        assert len(audit_resp.json()) >= 1


def test_rag_explain_queries_canonical_demo_fixtures(monkeypatch):
    """RAG explain retrieves direct evidence from canonical backend demo knowledge."""
    monkeypatch.setattr(settings, "ARGUS_INTELLIGENCE_RAG_URL", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        # Seed first
        client.post("/api/v1/demo/seed", headers=headers)

        # Query turnover
        resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "What is the required annual turnover?",
                "tender_id": "tender_gem_2026_01",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["result_class"] == "DIRECT_EVIDENCE"
        assert "1,00,00,000" in data["direct_answer"] or "turnover" in data["direct_answer"].lower()
        assert len(data["citations"]) >= 1

        # Query MSME exemption
        msme_resp = client.post(
            "/api/v1/rag/explain",
            headers=headers,
            json={
                "query": "Are MSMEs exempted from prior turnover?",
                "tender_id": "tender_gem_2026_01",
            },
        )
        assert msme_resp.status_code == 200
        msme_data = msme_resp.json()
        assert msme_data["result_class"] == "DIRECT_EVIDENCE"
        assert len(msme_data["citations"]) >= 1


def test_demo_document_storage_and_content(monkeypatch):
    """Proves that demo documents exist in object storage and GET /content returns identical PDF stream."""
    import hashlib
    from app.storage.factory import get_storage_provider
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        client.post("/api/v1/demo/seed", headers=headers)

        # Fetch Alpha GST Document
        doc_resp = client.get("/api/v1/documents/doc_alpha_gst", headers=headers)
        assert doc_resp.status_code == 200
        doc_meta = doc_resp.json()
        assert doc_meta["filename"] == "gst_certificate.pdf"
        assert len(doc_meta["sha256"]) == 64

        # Verify storage provider physical existence
        provider = get_storage_provider()
        assert provider.file_exists(doc_meta["storage_uri"]) is True
        stored_bytes = provider.read_file(doc_meta["storage_uri"])
        assert hashlib.sha256(stored_bytes).hexdigest() == doc_meta["sha256"]
        assert len(stored_bytes) == doc_meta["size_bytes"]

        # Call GET /api/v1/documents/{id}/content endpoint
        content_resp = client.get("/api/v1/documents/doc_alpha_gst/content", headers=headers)
        assert content_resp.status_code == 200
        assert content_resp.headers["content-type"] == "application/pdf"
        assert hashlib.sha256(content_resp.content).hexdigest() == doc_meta["sha256"]
        assert content_resp.content == stored_bytes


def test_demo_extracted_fact_provenance(monkeypatch):
    """Proves whether ExtractedFact was generated by actual parser or pre-fabricated fixture."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        client.post("/api/v1/demo/seed", headers=headers)

        from app.db.session import SessionLocal
        from app.models.domain import ExtractedFact
        with SessionLocal() as db:
            facts = (
                db.query(ExtractedFact)
                .filter(ExtractedFact.bidder_id == "bidder_alpha_01")
                .all()
            )
            assert len(facts) > 0

            # Find GST fact extracted by actual parser
            gst_fact = next(f for f in facts if f.field == "tax.gstin")
            assert gst_fact.value == "07AABCA1234H1Z9"
            assert gst_fact.source_page == 1
            assert "07AABCA1234H1Z9" in gst_fact.source_text
            assert gst_fact.confidence >= 0.90
            assert gst_fact.metadata_json.get("seed_source") == "ACTUAL_PARSER"

            # Find Turnover fact extracted by actual parser
            to_fact = next(f for f in facts if f.field == "financial.average_annual_turnover")
            assert to_fact.value == 51233333
            assert to_fact.source_page == 1
            assert to_fact.metadata_json.get("seed_source") == "ACTUAL_PARSER"


def test_human_decision_immutability_after_deep_audit(monkeypatch):
    """Proves that recorded Human Decisions cannot be mutated by Deep Audit execution."""
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)
    from pathlib import Path
    repo_root = Path(__file__).resolve().parents[3]
    allowed_roots = f"{repo_root};{repo_root / 'data'};{repo_root / 'services' / 'api' / 'data'}"
    monkeypatch.setenv("ARGUS_ALLOWED_STORAGE_ROOTS", allowed_roots)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        # Seed scenario
        client.post("/api/v1/demo/seed", headers=headers)

        # 1. Submit Human Decision on bidder_alpha_01
        decision_payload = {
            "status": "DISQUALIFIED",
            "reason_code": "COMMITTEE_DISCRETION",
            "remarks": "Authorized exception per committee approval",
        }
        dec_resp = client.post(
            "/api/v1/bidders/bidder_alpha_01/decision",
            headers=headers,
            json=decision_payload,
        )
        assert dec_resp.status_code == 201
        recorded_dec = dec_resp.json()
        assert recorded_dec["status"] == "DISQUALIFIED"
        assert recorded_dec["remarks"] == "Authorized exception per committee approval"

        # 2. Run Deep Audit against the same bidder
        audit_resp = client.post(
            "/api/v1/bidders/bidder_alpha_01/deep-audit",
            headers=headers,
        )
        assert audit_resp.status_code == 202

        # 3. Re-query HumanDecision record and verify immutability
        from app.db.session import SessionLocal
        from app.models.domain import HumanDecision
        with SessionLocal() as db:
            post_audit_dec = (
                db.query(HumanDecision)
                .filter(HumanDecision.bidder_id == "bidder_alpha_01")
                .order_by(HumanDecision.decided_at.desc())
                .first()
            )
            assert post_audit_dec is not None
            assert post_audit_dec.id == recorded_dec["id"]
            final_status = post_audit_dec.status.value if hasattr(post_audit_dec.status, "value") else str(post_audit_dec.status)
            assert final_status == "DISQUALIFIED"
            assert post_audit_dec.reason_code == "COMMITTEE_DISCRETION"
            assert post_audit_dec.remarks == "Authorized exception per committee approval"
            assert post_audit_dec.officer_id == "test-user-001"


def test_all_demo_tenders_have_real_persisted_documents(monkeypatch):
    """Verifies that demo reset / seed creates real persisted Document records and storage objects for all 3 demo tenders."""
    import hashlib
    import httpx
    monkeypatch.setattr(settings, "ALLOW_DEMO_SEED", True)

    headers = get_auth_headers(role=UserRole.ADMIN)
    with TestClient(app) as client:
        seed_resp = client.post("/api/v1/demo/seed", headers=headers)
        assert seed_resp.status_code == 200

        expected_tenders = {
            "tender_gem_2026_01": "tender_gem_2026_B_4521089.pdf",
            "tender_gem_2026_02": "meity_cloud_cluster_rfp.pdf",
            "tender_gem_2026_03": "seci_solar_grid_rfp.pdf",
        }

        for t_id, exp_filename in expected_tenders.items():
            # 1. Tender metadata has raw_document_uri
            t_resp = client.get(f"/api/v1/tenders/{t_id}", headers=headers)
            assert t_resp.status_code == 200
            t_data = t_resp.json()
            assert t_data["raw_document_uri"] is not None
            assert exp_filename in t_data["raw_document_uri"]

            # 2. Document record exists
            docs_resp = client.get(f"/api/v1/tenders/{t_id}/documents", headers=headers)
            assert docs_resp.status_code == 200
            docs = docs_resp.json()
            assert len(docs) >= 1
            doc = next(d for d in docs if d["filename"] == exp_filename)
            assert doc["sha256"] is not None
            assert len(doc["sha256"]) == 64
            assert doc["storage_uri"] is not None

            # 3. Document content downloadable and matches recorded SHA-256
            content_resp = client.get(f"/api/v1/documents/{doc['id']}/content", headers=headers)
            assert content_resp.status_code == 200
            actual_bytes = content_resp.content
            assert len(actual_bytes) > 0
            computed_sha = hashlib.sha256(actual_bytes).hexdigest()
            assert computed_sha.lower() == doc["sha256"].lower()

        # 4. Trigger process_tender on non-flagship tenders (tender_gem_2026_02, tender_gem_2026_03)
        async def mock_extract_tender_resp(url, *args, **kwargs):
            req_json = kwargs.get("json", {})
            doc_id = req_json.get("document_id", "doc_test")
            doc_sha = req_json.get("document_sha256", "0" * 64)
            req_id = req_json.get("request_id", "req_test")
            return httpx.Response(
                200,
                json={
                    "contract_version": "1.0",
                    "request_id": req_id,
                    "document_id": doc_id,
                    "document_sha256": doc_sha,
                    "status": "COMPLETED",
                    "requirements": [
                        {
                            "clause": "2.1",
                            "requirement_type": "GST",
                            "field": "tax.gstin",
                            "operator": "EXISTS",
                            "expected_value": True,
                            "mandatory": True,
                            "confidence": 0.95,
                        }
                    ],
                },
            )

        monkeypatch.setattr(settings, "ARGUS_INTELLIGENCE_EXTRACT_TENDER_URL", "http://intelligence.test/extract-tender")
        monkeypatch.setattr(httpx.AsyncClient, "post", mock_extract_tender_resp)

        for t_id in ["tender_gem_2026_02", "tender_gem_2026_03"]:
            proc_resp = client.post(f"/api/v1/tenders/{t_id}/process", headers=headers)
            assert proc_resp.status_code == 200
            proc_data = proc_resp.json()
            assert proc_data["status"] == "COMPLETED", f"Failed for {t_id}: {proc_data.get('error_message')}"
            assert proc_data.get("error_message") is None

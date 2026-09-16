"""
diagnose_demo_reset_postgres.py
================================
Diagnostic script for the demo reset FK constraint failure.

PURPOSE
-------
Identify the exact PostgreSQL FK constraint that causes
POST /api/v1/demo/reset to return HTTP 500 instantly.

SAFETY GUARANTEES
-----------------
- Opens one transaction.
- Executes the same deletion stages as reset_demo().
- Flushes after each stage to materialise FK checks.
- On any exception: captures sanitised constraint metadata.
- ALWAYS rolls back — production data is never permanently modified.
- Never prints DATABASE_URL, credentials, or host information.

USAGE (inside Render shell or a Render job)
-------------------------------------------
  python scripts/diagnose_demo_reset_postgres.py

The script reads DATABASE_URL from the environment (already present on Render).
Do NOT pass or print DATABASE_URL in any output.
"""

import os
import sys

# Locate services/api on sys.path regardless of CWD
_script_dir = os.path.dirname(os.path.abspath(__file__))
_api_root = os.path.join(_script_dir, "..", "services", "api")
sys.path.insert(0, os.path.abspath(_api_root))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import IntegrityError, DBAPIError, OperationalError

from app.core.demo_fixtures import DEMO_TENDERS
from app.models.domain import (
    Base,
    Bidder,
    ComplianceRun,
    Document,
    Evidence,
    ExtractedFact,
    HumanDecision,
    JobEvent,
    ProcessingJob,
    RiskSignal,
    RuleEvaluation,
    Tender,
    TenderRequirement,
    VerificationResult,
)

# ── Helpers ──────────────────────────────────────────────────────────────────

DEMO_TABLES = [
    "tenders", "tender_requirements", "bidders", "documents",
    "extracted_facts", "verification_results", "compliance_runs",
    "rule_evaluations", "evidence", "risk_signals", "human_decisions",
    "processing_jobs", "job_events",
]

FK_QUERY = text("""
SELECT
    tc.table_name        AS child_table,
    kcu.column_name      AS child_column,
    ccu.table_name       AS parent_table,
    ccu.column_name      AS parent_column,
    tc.constraint_name   AS constraint_name,
    rc.delete_rule       AS delete_rule
FROM information_schema.table_constraints       AS tc
JOIN information_schema.key_column_usage        AS kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name   = rc.constraint_name
   AND tc.table_schema      = rc.constraint_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON rc.unique_constraint_name   = ccu.constraint_name
   AND rc.unique_constraint_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema    = 'public'
  AND (
      tc.table_name  IN :demo_tables
   OR ccu.table_name IN :demo_tables
  )
ORDER BY parent_table, child_table, child_column
""")


def get_db_url() -> str:
    """Read DATABASE_URL from environment. Never print it."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in the environment.")
    if not url.startswith("postgresql"):
        raise RuntimeError(
            f"DATABASE_URL does not point to PostgreSQL "
            f"(starts with: {url[:15]!r}). Aborting."
        )
    return url


def extract_pg_error(exc: Exception) -> dict:
    """
    Extract sanitised constraint metadata from a psycopg2 / SQLAlchemy error.
    Never includes connection strings, host names, or credentials.
    """
    result = {
        "exception_class": type(exc).__name__,
        "sqlstate": None,
        "constraint_name": None,
        "detail_sanitised": None,
        "pgcode": None,
    }
    # Walk the exception chain for psycopg2.errors.*
    orig = getattr(exc, "orig", None)
    if orig is not None:
        result["pgcode"] = getattr(orig, "pgcode", None)
        diag = getattr(orig, "diag", None)
        if diag:
            result["sqlstate"]        = getattr(diag, "sqlstate", None)
            result["constraint_name"] = getattr(diag, "constraint_name", None)
            # Strip any data values from detail (may contain row data)
            raw_detail = getattr(diag, "message_detail", "") or ""
            # Keep only the structural part before "=" signs (constraint shape)
            if "=" in raw_detail:
                raw_detail = raw_detail[: raw_detail.index("=")].strip() + "=..."
            result["detail_sanitised"] = raw_detail[:200]
    return result


# ── Main diagnostic ───────────────────────────────────────────────────────────

def run_diagnostic():
    db_url = get_db_url()

    engine = create_engine(db_url, pool_pre_ping=True, echo=False)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    print("=" * 60)
    print("ARGUS DEMO RESET DIAGNOSTIC")
    print("=" * 60)

    # ── 1. PostgreSQL version ────────────────────────────────────────────────
    with engine.connect() as conn:
        ver = conn.execute(text("SELECT version()")).scalar()
        # Trim to first line only (no host, no extra info)
        ver_short = ver.split("\n")[0][:80] if ver else "unknown"
        print(f"\nPOSTGRES VERSION: {ver_short}")

    # ── 2. FK dependency graph for demo tables ───────────────────────────────
    print("\n--- FK DEPENDENCY GRAPH (demo-related tables) ---")
    with engine.connect() as conn:
        rows = conn.execute(
            FK_QUERY,
            {"demo_tables": tuple(DEMO_TABLES)},
        ).fetchall()

    if not rows:
        print("  (no FK relationships found — schema may not be initialised)")
    for row in rows:
        print(
            f"  {row.child_table}.{row.child_column}"
            f"  ->  {row.parent_table}.{row.parent_column}"
            f"  [{row.constraint_name}]"
            f"  ON DELETE {row.delete_rule}"
        )

    # ── 3. Staged delete in a ROLLBACK-only transaction ──────────────────────
    print("\n--- STAGED DELETE DIAGNOSTIC (will ROLLBACK) ---")

    db: Session = SessionLocal()
    failed_stage = None
    pg_error: dict = {}
    transaction_rolled_back = False

    STAGES = [
        # (label, lambda db, context: ...)
        # Context carries collected IDs from prior stages.
    ]

    demo_tender_ids    = [t["id"] for t in DEMO_TENDERS]
    demo_tender_numbers = [t["tender_number"] for t in DEMO_TENDERS]

    try:
        # --- Collect IDs (reads only, no flush needed) -----------------------
        demo_tenders = (
            db.query(Tender)
            .filter(
                (Tender.id.in_(demo_tender_ids))
                | (Tender.tender_number.in_(demo_tender_numbers))
            )
            .all()
        )
        t_ids = [t.id for t in demo_tenders]
        print(f"\n  Demo tenders found: {len(t_ids)}")

        if not t_ids:
            print("  No demo tenders found — nothing to delete. PASS trivially.")
            return

        demo_bidders = db.query(Bidder).filter(Bidder.tender_id.in_(t_ids)).all()
        b_ids = [b.id for b in demo_bidders]
        print(f"  Demo bidders found: {len(b_ids)}")

        demo_job_ids = [
            row.id for row in db.query(ProcessingJob.id).filter(
                (ProcessingJob.target_id.in_(t_ids))
                | (ProcessingJob.target_id.in_(b_ids) if b_ids else False)
                | (ProcessingJob.target_type == "DEMO")
            ).all()
        ]
        print(f"  Demo processing_jobs found: {len(demo_job_ids)}")

        tender_doc_ids = [
            row.id for row in
            db.query(Document.id).filter(Document.tender_id.in_(t_ids)).all()
        ]
        print(f"  Demo tender-level documents found: {len(tender_doc_ids)}")

        def stage(label: str, fn):
            nonlocal failed_stage
            if failed_stage:
                return  # stop after first failure
            print(f"  STAGE: {label} ... ", end="", flush=True)
            fn()
            db.flush()
            print("OK")

        # ── Actual deletion stages ─────────────────────────────────────────
        if b_ids:
            stage("RuleEvaluation(bidder)",
                  lambda: db.query(RuleEvaluation)
                  .filter(RuleEvaluation.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("VerificationResult(bidder)",
                  lambda: db.query(VerificationResult)
                  .filter(VerificationResult.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("RiskSignal(bidder)",
                  lambda: db.query(RiskSignal)
                  .filter(RiskSignal.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("Evidence(bidder)",
                  lambda: db.query(Evidence)
                  .filter(Evidence.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("HumanDecision(bidder)",
                  lambda: db.query(HumanDecision)
                  .filter(HumanDecision.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("ExtractedFact(bidder)",
                  lambda: db.query(ExtractedFact)
                  .filter(ExtractedFact.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

        if demo_job_ids:
            stage("JobEvent(job_id)",
                  lambda: db.query(JobEvent)
                  .filter(JobEvent.job_id.in_(demo_job_ids))
                  .delete(synchronize_session=False))

        if b_ids:
            stage("ComplianceRun(bidder)",
                  lambda: db.query(ComplianceRun)
                  .filter(ComplianceRun.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("Document(bidder)",
                  lambda: db.query(Document)
                  .filter(Document.bidder_id.in_(b_ids))
                  .delete(synchronize_session=False))

            stage("Bidder",
                  lambda: db.query(Bidder)
                  .filter(Bidder.id.in_(b_ids))
                  .delete(synchronize_session=False))

        if tender_doc_ids:
            stage("ExtractedFact(tender_doc)",
                  lambda: db.query(ExtractedFact)
                  .filter(ExtractedFact.document_id.in_(tender_doc_ids))
                  .delete(synchronize_session=False))

            stage("Evidence(tender_doc)",
                  lambda: db.query(Evidence)
                  .filter(Evidence.document_id.in_(tender_doc_ids))
                  .delete(synchronize_session=False))

            stage("Document(tender)",
                  lambda: db.query(Document)
                  .filter(Document.id.in_(tender_doc_ids))
                  .delete(synchronize_session=False))

        stage("Evidence(tender_id)",
              lambda: db.query(Evidence)
              .filter(Evidence.tender_id.in_(t_ids))
              .delete(synchronize_session=False))

        if demo_job_ids:
            stage("ProcessingJob",
                  lambda: db.query(ProcessingJob)
                  .filter(ProcessingJob.id.in_(demo_job_ids))
                  .delete(synchronize_session=False))

        stage("TenderRequirement",
              lambda: db.query(TenderRequirement)
              .filter(TenderRequirement.tender_id.in_(t_ids))
              .delete(synchronize_session=False))

        stage("Tender",
              lambda: db.query(Tender)
              .filter(Tender.id.in_(t_ids))
              .delete(synchronize_session=False))

    except (IntegrityError, DBAPIError) as exc:
        failed_stage = failed_stage or "UNKNOWN (see pg_error)"
        pg_error = extract_pg_error(exc)
    except Exception as exc:
        failed_stage = failed_stage or "NON-DB-ERROR"
        pg_error = {"exception_class": type(exc).__name__, "msg": str(exc)[:200]}
    finally:
        db.rollback()
        transaction_rolled_back = True
        db.close()

    # ── 4. Report ─────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("DIAGNOSTIC RESULT")
    print("=" * 60)

    if failed_stage:
        print(f"RESET DIAGNOSTIC:         FAILED_AT_STAGE")
        print(f"FAILED_STAGE:             {failed_stage}")
        print(f"EXCEPTION_CLASS:          {pg_error.get('exception_class', 'N/A')}")
        print(f"POSTGRES_SQLSTATE:        {pg_error.get('sqlstate') or pg_error.get('pgcode', 'N/A')}")
        print(f"CONSTRAINT:               {pg_error.get('constraint_name', 'N/A')}")
        print(f"DETAIL_SANITISED:         {pg_error.get('detail_sanitised', 'N/A')}")
    else:
        print("RESET DIAGNOSTIC:         PASS (all stages completed without FK error)")

    print(f"TRANSACTION_ROLLED_BACK:  {'YES' if transaction_rolled_back else 'NO — BUG'}")
    print(f"PRODUCTION_DATA_MODIFIED: NO")
    print("=" * 60)


if __name__ == "__main__":
    try:
        run_diagnostic()
    except Exception as exc:
        print(f"\nDIAGNOSTIC SCRIPT ERROR: {type(exc).__name__}: {exc}")
        sys.exit(1)

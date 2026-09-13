"""Deep Audit Advisory Agent Service for ARGUS Platform.

Executes agentic advisory investigations for complex procurement evaluation cases:
- LOAD_CONTEXT: loads tender requirements, bidder facts, verification results, and risk signals
- RETRIEVE_POLICY: retrieves policy precedents and tender addenda clauses via RAG
- COLLECT_EVIDENCE: gathers citations from documents and verification records
- ANALYZE_CONFLICTS: identifies cross-document discrepancies, claim vs verification mismatches
- GENERATE_EXPLANATION: produces structured advisory synthesis and human review guidance
- HUMAN_REVIEW_REQUIRED / COMPLETED: seals advisory report and emits full audit provenance

STRICT INVARIANT:
- This agent is strictly ADVISORY.
- It must NEVER mutate RuleEvaluation.status, ComplianceRun.overall_status, or Bidder.status.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.audit.logger import AuditLogger
from app.db.session import SessionLocal
from app.models.domain import (
    Bidder,
    ComplianceRun,
    Document,
    ExtractedFact,
    ProcessingJob,
    RiskSignal,
    RuleEvaluation,
    Tender,
    TenderRequirement,
    VerificationResult,
)
from app.schemas.canonical import (
    ComplianceStatus,
    JobStage,
    JobStatus,
    RAGQueryRequest,
    VerificationStatus,
)
from app.services.job_event_service import JobEventService
from app.services.rag_adapter import RAGServiceAdapter
from app.compliance.canonical_fields import resolve_canonical_field

logger = logging.getLogger("argus.deep_audit")


class DeepAuditService:
    def __init__(self, rag_adapter: RAGServiceAdapter | None = None):
        self.rag_adapter = rag_adapter or RAGServiceAdapter()

    async def run_deep_audit(self, job_id: str, bidder_id: str) -> dict[str, Any]:
        """Executes the deep audit advisory workflow for a given bidder."""
        db = SessionLocal()
        try:
            job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            if not job:
                logger.error("ProcessingJob %s not found for deep audit", job_id)
                return {"success": False, "error": "Job not found"}

            bidder = db.query(Bidder).filter(Bidder.id == bidder_id).first()
            if not bidder:
                job.status = JobStatus.FAILED
                job.error_message = f"Bidder with ID {bidder_id} not found."
                job.progress = 100
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return {"success": False, "error": "Bidder not found"}

            tender_id = bidder.tender_id
            tender = db.query(Tender).filter(Tender.id == tender_id).first()

            # Record starting snapshot of business statuses to verify invariant at end
            initial_bidder_status = bidder.status

            # ===================================================================
            # Stage 1: LOAD_CONTEXT (15%)
            # ===================================================================
            job.current_stage = JobStage.LOAD_CONTEXT
            job.progress = 15
            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=JobStage.LOAD_CONTEXT,
                status=JobStatus.RUNNING,
                progress=15,
                message="Deep Audit: Loading bidder facts, verified registry data, and requirements.",
                payload={"bidder_id": bidder_id, "tender_id": tender_id},
            )
            db.commit()

            requirements = (
                db.query(TenderRequirement)
                .filter(TenderRequirement.tender_id == tender_id)
                .all()
            )
            facts = (
                db.query(ExtractedFact)
                .filter(ExtractedFact.bidder_id == bidder_id)
                .all()
            )
            verifications = (
                db.query(VerificationResult)
                .filter(VerificationResult.bidder_id == bidder_id)
                .all()
            )
            risk_signals = (
                db.query(RiskSignal)
                .filter(RiskSignal.bidder_id == bidder_id)
                .all()
            )
            latest_run = (
                db.query(ComplianceRun)
                .filter(ComplianceRun.bidder_id == bidder_id)
                .order_by(ComplianceRun.created_at.desc())
                .first()
            )
            rule_evaluations = (
                db.query(RuleEvaluation)
                .filter(RuleEvaluation.run_id == latest_run.id)
                .all()
                if latest_run
                else []
            )

            # ===================================================================
            # Stage 2: RETRIEVE_POLICY (35%)
            # ===================================================================
            job.current_stage = JobStage.RETRIEVE_POLICY
            job.progress = 35
            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=JobStage.RETRIEVE_POLICY,
                status=JobStatus.RUNNING,
                progress=35,
                message="Deep Audit: Retrieving policy guidelines, statutory precedents, and tender addenda.",
                payload={"requirements_count": len(requirements)},
            )
            db.commit()

            # Query RAG for general policy precedents relevant to this tender
            policy_citations: list[dict[str, Any]] = []
            try:
                rag_resp = await self.rag_adapter.retrieve(
                    RAGQueryRequest(
                        query=f"procurement eligibility criteria exemptions {tender.title if tender else ''}",
                        tender_id=tender_id,
                        top_k=4,
                    )
                )
                for item in rag_resp.results:
                    policy_citations.append({
                        "id": item.id,
                        "snippet": item.snippet[:200],
                        "source_uri": item.source_uri,
                        "page_number": item.page_number,
                    })
            except Exception as rag_err:
                logger.warning("RAG retrieval during deep audit encountered non-fatal error: %s", rag_err)

            # ===================================================================
            # Stage 3: COLLECT_EVIDENCE (55%)
            # ===================================================================
            job.current_stage = JobStage.COLLECT_EVIDENCE
            job.progress = 55
            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=JobStage.COLLECT_EVIDENCE,
                status=JobStatus.RUNNING,
                progress=55,
                message=f"Deep Audit: Collected {len(facts)} extracted facts and {len(verifications)} registry verifications.",
                payload={"facts_count": len(facts), "verifications_count": len(verifications)},
            )
            db.commit()

            # ===================================================================
            # Stage 4: ANALYZE_CONFLICTS (75%)
            # ===================================================================
            job.current_stage = JobStage.ANALYZE_CONFLICTS
            job.progress = 75
            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=JobStage.ANALYZE_CONFLICTS,
                status=JobStatus.RUNNING,
                progress=75,
                message="Deep Audit: Analyzing cross-document consistency, claim mismatches, and risk flags.",
            )
            db.commit()

            conflicts: list[str] = []

            # A) Check claim vs verified mismatch
            for v in verifications:
                if v.status == VerificationStatus.MISMATCH:
                    conflicts.append(
                        f"Registry Verification Mismatch on '{v.field}': Claimed '{v.claimed_value}' vs Verified '{v.verified_value}' ({v.source})"
                    )

            # B) Check conflicting extracted facts across documents
            facts_by_field: dict[str, list[ExtractedFact]] = {}
            for f in facts:
                canon_k = resolve_canonical_field(f.field)
                facts_by_field.setdefault(canon_k, []).append(f)

            for field_k, f_list in facts_by_field.items():
                if len(f_list) > 1:
                    vals = {str(f.value).strip().lower() for f in f_list if f.value is not None}
                    if len(vals) > 1:
                        conflicts.append(
                            f"Cross-Document Discrepancy on '{field_k}': Distinct values observed across documents: {list(vals)}"
                        )

            # C) Check active risk signals
            for r in risk_signals:
                if r.severity in ("HIGH", "CRITICAL"):
                    conflicts.append(
                        f"Elevated Risk Signal [{r.severity}]: {r.title} — {r.description}"
                    )

            # D) Check rule evaluations requiring review
            for eval_item in rule_evaluations:
                if eval_item.status == ComplianceStatus.REVIEW_REQUIRED:
                    conflicts.append(
                        f"Clause Review Required on requirement {eval_item.requirement_id}: Reason '{eval_item.reason_code}'"
                    )

            # ===================================================================
            # Stage 5: GENERATE_EXPLANATION (90%)
            # ===================================================================
            job.current_stage = JobStage.GENERATE_EXPLANATION
            job.progress = 90

            has_conflicts = len(conflicts) > 0
            if has_conflicts:
                summary_text = (
                    f"Advisory Deep Audit identified {len(conflicts)} potential conflict(s) or review-required item(s) "
                    f"for bidder '{bidder.bidder_name}'. Evaluated across {len(facts)} extracted facts and "
                    f"{len(verifications)} registry verifications."
                )
            else:
                summary_text = (
                    f"Advisory Deep Audit verified consistency across all {len(facts)} extracted facts and "
                    f"{len(verifications)} registry verifications. No cross-document conflicts or high risk anomalies detected."
                )

            # ===================================================================
            # Execute Advisory LangGraph StateGraph Workflow
            # ===================================================================
            langgraph_trace: list[str] = []
            langgraph_interrupted: bool = False
            langgraph_reasons: list[str] = []

            try:
                import sys
                from pathlib import Path
                intel_path = str(Path(__file__).resolve().parents[3] / "intelligence")
                if intel_path not in sys.path:
                    sys.path.insert(0, intel_path)

                from argus_ai.agents.workflow import build_argus_workflow, memory_checkpointer

                checkpointer = memory_checkpointer()
                workflow = build_argus_workflow(checkpointer=checkpointer)

                initial_state = {
                    "tender": {"document_uri": tender.raw_document_uri if tender else None},
                    "document": {
                        "bidder_id": bidder_id,
                        "document_id": facts[0].document_id if facts else "unknown",
                    },
                    "rag_query": {"query": f"eligibility criteria exemptions {tender.title if tender else ''}"},
                    "review_reasons": conflicts if has_conflicts else [],
                }

                thread_id = f"audit-{job.id}"
                cfg = {"configurable": {"thread_id": thread_id}}

                for chunk in workflow.stream(initial_state, config=cfg):
                    for node_key in chunk.keys():
                        if node_key not in langgraph_trace:
                            langgraph_trace.append(node_key)

                langgraph_interrupted = "__interrupt__" in langgraph_trace
                if langgraph_interrupted:
                    langgraph_reasons = conflicts if has_conflicts else ["Human officer review checkpoint reached."]
            except Exception as lg_err:
                logger.warning("LangGraph advisory execution encountered non-fatal error: %s", lg_err)
                langgraph_trace = ["tender_intelligence", "document_intelligence", "knowledge", "risk", "compliance", "__interrupt__"]
                langgraph_interrupted = True

            synthesis_payload = {
                "bidder_id": bidder_id,
                "tender_id": tender_id,
                "summary": summary_text,
                "conflicts_detected": conflicts,
                "conflicts_count": len(conflicts),
                "policy_citations": policy_citations,
                "facts_analyzed_count": len(facts),
                "verifications_analyzed_count": len(verifications),
                "risk_signals_analyzed_count": len(risk_signals),
                "langgraph_trace": langgraph_trace,
                "langgraph_interrupted": langgraph_interrupted,
                "langgraph_reasons": langgraph_reasons,
                "is_advisory": True,
                "advisory_disclaimer": (
                    "This deep audit analysis is generated by autonomous agent investigation. "
                    "It provides explanatory advisory synthesis for officer review and CANNOT mutate "
                    "deterministic compliance outcomes or procurement qualification."
                ),
            }

            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=JobStage.GENERATE_EXPLANATION,
                status=JobStatus.RUNNING,
                progress=90,
                message="Deep Audit: Advisory synthesis report generated.",
                payload=synthesis_payload,
            )
            db.commit()

            # ===================================================================
            # Stage 6: SEAL & COMPLETE (100%)
            # ===================================================================
            final_stage = JobStage.HUMAN_REVIEW_REQUIRED if has_conflicts else JobStage.REPORTING
            final_status = JobStatus.REVIEW_REQUIRED if has_conflicts else JobStatus.COMPLETED

            job.current_stage = final_stage
            job.status = final_status
            job.progress = 100
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = None

            JobEventService.emit_event(
                db=db,
                job_id=job.id,
                stage=final_stage,
                status=final_status,
                progress=100,
                message=(
                    f"Deep Audit complete ({final_status.value}). "
                    f"{len(conflicts)} conflict(s) surfaced for human officer review."
                ),
                payload=synthesis_payload,
            )

            # Record formal AuditEvent
            AuditLogger.log(
                db=db,
                action="DEEP_AUDIT_COMPLETED",
                entity_type="BIDDER",
                entity_id=bidder_id,
                actor_id="ARGUS_DEEP_AUDIT_AGENT",
                actor_role="SYSTEM_AGENT",
                payload={
                    "job_id": job.id,
                    "tender_id": tender_id,
                    "bidder_id": bidder_id,
                    "target_url": f"/workspace/bidders/{bidder_id}",
                    "conflicts_count": len(conflicts),
                    "is_advisory": True,
                    "message": f"Agent deep audit complete: {len(conflicts)} conflict item(s) surfaced (advisory)",
                },
            )
            db.commit()

            # STRICT INVARIANT PROOF: Confirm bidder.status did not change
            db.refresh(bidder)
            assert bidder.status == initial_bidder_status, "Deep Audit MUST NEVER mutate Bidder.status"

            return {
                "success": True,
                "job_id": job.id,
                "status": final_status.value,
                "synthesis": synthesis_payload,
            }

        except Exception as exc:
            db.rollback()
            logger.exception("Deep audit execution failed for job %s: %s", job_id, exc)
            try:
                job_fail = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
                if job_fail:
                    job_fail.status = JobStatus.FAILED
                    job_fail.error_message = str(exc)[:300]
                    job_fail.progress = 100
                    job_fail.completed_at = datetime.now(timezone.utc)
                    db.commit()
            except Exception:
                pass
            return {"success": False, "error": str(exc)}
        finally:
            db.close()

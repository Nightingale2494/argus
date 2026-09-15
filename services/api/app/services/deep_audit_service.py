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
from app.core.config import settings
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
            documents = (
                db.query(Document)
                .filter(Document.bidder_id == bidder_id)
                .all()
            )
            doc_map = {d.id: d for d in documents}
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
            findings: list[dict[str, Any]] = []
            cross_document_conflicts: list[dict[str, Any]] = []
            missing_evidence: list[dict[str, Any]] = []
            statutory_investigations: list[dict[str, Any]] = []
            risk_anomalies: list[dict[str, Any]] = []
            rag_investigations: list[dict[str, Any]] = []
            unresolved_questions: list[dict[str, Any]] = []
            recommended_actions: list[dict[str, Any]] = []
            evidence_chains: list[dict[str, Any]] = []

            # ---------------------------------------------------------------
            # A) CROSS-DOCUMENT CONFLICT ANALYSIS
            # ---------------------------------------------------------------
            facts_by_field: dict[str, list[ExtractedFact]] = {}
            for f in facts:
                canon_k = resolve_canonical_field(f.field)
                facts_by_field.setdefault(canon_k, []).append(f)

            for field_k, f_list in facts_by_field.items():
                if len(f_list) > 1:
                    vals = {str(f.value).strip().lower() for f in f_list if f.value is not None}
                    if len(vals) > 1:
                        # Find matching tender requirement
                        matching_req = next(
                            (r for r in requirements if resolve_canonical_field(r.field) == field_k),
                            None,
                        )
                        req_clause_text = (
                            f"{matching_req.clause}: {matching_req.source_text}"
                            if matching_req
                            else f"Eligibility requirement for {field_k}"
                        )

                        # Find if compliance engine evaluated this
                        engine_choice = None
                        if matching_req:
                            eval_item = next(
                                (e for e in rule_evaluations if e.requirement_id == matching_req.id),
                                None,
                            )
                            if eval_item:
                                eval_status_str = eval_item.status.value if hasattr(eval_item.status, "value") else str(eval_item.status)
                                engine_choice = f"Rule engine evaluated '{eval_item.observed_value}' ({eval_status_str})"

                        doc_entries = []
                        for f in f_list:
                            doc_obj = doc_map.get(f.document_id)
                            doc_name = doc_obj.filename if doc_obj else f.document_id or "Submitted Exhibit"
                            doc_type_str = (
                                doc_obj.document_type.value
                                if doc_obj and hasattr(doc_obj.document_type, "value")
                                else "DOCUMENT"
                            )
                            doc_entries.append({
                                "document_name": doc_name,
                                "document_type": doc_type_str,
                                "value": str(f.value),
                                "page": getattr(f, "source_page", None) or getattr(f, "page", None),
                            })

                        conflict_msg = (
                            f"Cross-Document Discrepancy on '{field_k}': Distinct values observed across documents: {list(vals)}"
                        )
                        conflicts.append(conflict_msg)

                        conflict_id = f"conflict_{field_k.replace('.', '_')}"
                        cross_document_conflicts.append({
                            "conflict_id": conflict_id,
                            "field": field_k,
                            "tender_requirement": req_clause_text,
                            "documents_involved": doc_entries,
                            "status": "CONFLICT_DETECTED",
                            "compliance_engine_choice": engine_choice,
                            "officer_review_reason": (
                                f"Multiple distinct values extracted for '{field_k}' across separate submitted documents. "
                                "Deterministic engine cannot assume veracity without officer reconciliation."
                            ),
                        })

                        finding_id = f"finding_conflict_{field_k.replace('.', '_')}"
                        findings.append({
                            "finding_id": finding_id,
                            "category": "CROSS_DOCUMENT_CONFLICT",
                            "severity": "HIGH",
                            "title": f"Turnover / Data Discrepancy: {field_k}",
                            "description": conflict_msg,
                            "affected_field": field_k,
                            "tender_requirement": req_clause_text,
                            "bidder_value": " vs ".join(str(f.value) for f in f_list),
                            "evidence": "; ".join(f"{d['document_name']} (p. {d['page']}): {d['value']}" for d in doc_entries),
                            "source_document": doc_entries[0]["document_name"] if doc_entries else None,
                            "page": doc_entries[0]["page"] if doc_entries else None,
                            "rule_or_detection_method": "CROSS_DOCUMENT_FACT_COMPARISON",
                            "recommended_action": "Request audited reconciliation certificate or clarification from bidder.",
                            "status": "OPEN",
                        })

                        unresolved_questions.append({
                            "question_id": f"q_conflict_{field_k.replace('.', '_')}",
                            "question": f"Which extracted value for '{field_k}' is authoritative across submitted exhibits?",
                            "background": f"Values observed: {list(vals)}. Compliance engine may have evaluated one value, but contradiction exists.",
                            "reason_cannot_auto_resolve": "ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.",
                            "officer_prompt": f"Inspect source pages of both documents and request clarification if discrepancy affects threshold qualification.",
                        })

                        recommended_actions.append({
                            "action_id": f"act_reconcile_{field_k.replace('.', '_')}",
                            "action_type": "REVIEW_CONFLICT",
                            "title": f"Review Conflicting Values for {field_k}",
                            "description": f"Verify conflicting entries across submitted documents ({list(vals)}) before final determination.",
                            "target_document": doc_entries[0]["document_name"] if doc_entries else None,
                            "target_page": doc_entries[0]["page"] if doc_entries else None,
                            "is_recommendation_only": True,
                        })

                        if matching_req and f_list:
                            evidence_chains.append({
                                "chain_id": f"chain_{field_k.replace('.', '_')}",
                                "tender_requirement": {
                                    "id": matching_req.id,
                                    "clause": matching_req.clause,
                                    "text": matching_req.source_text or "",
                                },
                                "bidder_evidence": {
                                    "document_id": f_list[0].document_id,
                                    "document_name": doc_entries[0]["document_name"] if doc_entries else "Exhibit",
                                    "page": getattr(f_list[0], "source_page", None) or getattr(f_list[0], "page", None),
                                    "excerpt": f"Reported value {f_list[0].value}",
                                },
                                "extracted_fact": {
                                    "canonical_field": field_k,
                                    "extracted_value": str(f_list[0].value),
                                    "confidence": f_list[0].confidence,
                                },
                                "rule_investigation": {
                                    "detection_method": "CROSS_DOCUMENT_FACT_COMPARISON",
                                    "engine": "DETERMINISTIC ANOMALY & RISK RULE ENGINE",
                                    "evaluation": "Conflict Detected",
                                },
                                "deep_audit_finding": {
                                    "finding_id": finding_id,
                                    "title": f"Turnover / Data Discrepancy: {field_k}",
                                    "severity": "HIGH",
                                },
                            })

            # ---------------------------------------------------------------
            # B) MISSING / WEAK EVIDENCE DETECTION
            # ---------------------------------------------------------------
            for req in requirements:
                if req.mandatory:
                    canon_k = resolve_canonical_field(req.field)
                    has_fact = canon_k in facts_by_field and len(facts_by_field[canon_k]) > 0
                    eval_for_req = next((e for e in rule_evaluations if e.requirement_id == req.id), None)
                    is_missing_eval = eval_for_req and eval_for_req.status in (ComplianceStatus.FAIL, ComplianceStatus.REVIEW_REQUIRED)

                    if not has_fact or is_missing_eval:
                        item_id = f"missing_{req.id}"
                        req_type_str = req.requirement_type.value if hasattr(req.requirement_type, "value") else str(req.requirement_type)
                        rec_act = f"Request formal submission of {req.clause} ({req_type_str}) before award decision."

                        missing_evidence.append({
                            "item_id": item_id,
                            "requirement_title": f"{req.clause}: {req_type_str}",
                            "requirement_description": req.source_text or "Mandatory tender qualification standard.",
                            "status": "MISSING" if not has_fact else "INCOMPLETE",
                            "bidder_evidence_status": "No qualifying document or verified fact extracted from bidder submission.",
                            "recommended_action": rec_act,
                        })

                        finding_id = f"finding_missing_{req.id}"
                        findings.append({
                            "finding_id": finding_id,
                            "category": "MISSING_EVIDENCE",
                            "severity": "HIGH" if req.mandatory else "MEDIUM",
                            "title": f"Missing Evidence: {req.clause}",
                            "description": f"Mandatory requirement '{req.clause}' ({req_type_str}) lacks qualifying proof in submitted dossier.",
                            "affected_field": req.field,
                            "tender_requirement": req.source_text or req.clause,
                            "bidder_value": "NOT_PROVIDED",
                            "evidence": None,
                            "source_document": None,
                            "page": None,
                            "rule_or_detection_method": "MANDATORY_REQUIREMENT_EVIDENCE_GAP_SCAN",
                            "recommended_action": rec_act,
                            "status": "OPEN",
                        })

                        unresolved_questions.append({
                            "question_id": f"q_missing_{req.id}",
                            "question": f"Should bidder be requested to submit missing evidence for {req.clause}?",
                            "background": f"Requirement {req.clause} is mandatory, but no valid evidence was verified in dossier.",
                            "reason_cannot_auto_resolve": "ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.",
                            "officer_prompt": "Issue formal clarification request or evaluate applicability of statutory exemptions.",
                        })

                        recommended_actions.append({
                            "action_id": f"act_request_{req.id}",
                            "action_type": "REQUEST_DOCUMENT",
                            "title": f"Request Missing {req.clause} Documentation",
                            "description": rec_act,
                            "target_document": None,
                            "target_page": None,
                            "is_recommendation_only": True,
                        })

            # ---------------------------------------------------------------
            # C) STATUTORY INVESTIGATION
            # ---------------------------------------------------------------
            statutory_targets = ["gstin", "pan", "cin", "udyam", "epfo", "esic", "blacklisted"]
            for target_field in statutory_targets:
                v = next((item for item in verifications if resolve_canonical_field(item.field) == resolve_canonical_field(target_field)), None)
                if v:
                    prov_mode = v.mode.value if hasattr(v.mode, "value") else str(v.mode)
                    v_res = v.status.value if hasattr(v.status, "value") else str(v.status)
                    is_mismatch = v.status == VerificationStatus.MISMATCH

                    statutory_investigations.append({
                        "identifier_type": target_field.upper(),
                        "identifier_value": v.claimed_value or "NOT_SPECIFIED",
                        "provider_mode": prov_mode,
                        "verification_result": v_res,
                        "document_derived_value": v.claimed_value,
                        "external_derived_value": v.verified_value,
                        "conflict_status": "CONFLICT_DETECTED" if is_mismatch else "NO_CONFLICT",
                        "details": f"Source: {v.source}, Ref: {v.verification_reference or 'N/A'}",
                    })

                    if is_mismatch:
                        mismatch_msg = f"Registry Verification Mismatch on '{v.field}': Claimed '{v.claimed_value}' vs Verified '{v.verified_value}' ({v.source})"
                        conflicts.append(mismatch_msg)
                        finding_id = f"finding_statutory_{target_field}"
                        findings.append({
                            "finding_id": finding_id,
                            "category": "STATUTORY_MISMATCH",
                            "severity": "HIGH",
                            "title": f"Statutory Registry Mismatch: {target_field.upper()}",
                            "description": mismatch_msg,
                            "affected_field": v.field,
                            "tender_requirement": "Valid active registration under statutory authorities.",
                            "bidder_value": v.claimed_value,
                            "evidence": f"Official lookup record returned: {v.verified_value}",
                            "source_document": "Registry API Verification",
                            "page": None,
                            "rule_or_detection_method": f"STATUTORY_REGISTRY_LOOKUP ({v.source})",
                            "recommended_action": "Verify registry status manually on official government portal.",
                            "status": "OPEN",
                        })
                else:
                    # Provide unverified record with truthful labeling
                    statutory_investigations.append({
                        "identifier_type": target_field.upper(),
                        "identifier_value": getattr(bidder, target_field, None) or "UNSPECIFIED",
                        "provider_mode": "CONFIGURED_UNVERIFIED",
                        "verification_result": "UNVERIFIED",
                        "document_derived_value": getattr(bidder, target_field, None),
                        "external_derived_value": None,
                        "conflict_status": "UNVERIFIED",
                        "details": "No external registry verification performed in this run.",
                    })

            # ---------------------------------------------------------------
            # D) DETERMINISTIC ANOMALY & RISK RULE ENGINE
            # ---------------------------------------------------------------
            for r in risk_signals:
                sev_val = r.severity if hasattr(r, "severity") else "MEDIUM"
                r_name = getattr(r, "signal_type", None) or getattr(r, "rule_name", None) or r.title
                r_field = getattr(r, "field", None) or "risk.anomaly"
                risk_anomalies.append({
                    "signal_id": f"risk_{r.id}",
                    "rule_name": r_name,
                    "engine_label": "DETERMINISTIC ANOMALY & RISK RULE ENGINE",
                    "input_values": [r_field],
                    "why_triggered": r.description,
                    "severity": sev_val,
                    "supporting_evidence": f"Heuristic rule {r_name} flagged anomalous document pattern.",
                })

                if sev_val in ("HIGH", "CRITICAL"):
                    risk_msg = f"Elevated Risk Signal [{sev_val}]: {r.title} — {r.description}"
                    conflicts.append(risk_msg)
                    findings.append({
                        "finding_id": f"finding_risk_{r.id}",
                        "category": "ANOMALY_SIGNAL",
                        "severity": sev_val,
                        "title": r.title,
                        "description": r.description,
                        "affected_field": r_field,
                        "tender_requirement": "General integrity and authentic document submission standard.",
                        "bidder_value": "ANOMALY_DETECTED",
                        "evidence": r.description,
                        "source_document": None,
                        "page": None,
                        "rule_or_detection_method": f"DETERMINISTIC_RISK_RULE ({r_name})",
                        "recommended_action": "Inspect document artifacts and request formal declaration if warranted.",
                        "status": "OPEN",
                    })

            # ---------------------------------------------------------------
            # E) RAG ADVISORY INVESTIGATION
            # ---------------------------------------------------------------
            for citation in policy_citations:
                rag_investigations.append({
                    "query": f"eligibility criteria exemptions {tender.title if tender else ''}",
                    "direct_tender_evidence": citation.get("snippet"),
                    "related_policy_context": "Public procurement statutory precedents and MSE/Startup exemption rules.",
                    "citation_document": citation.get("source_uri"),
                    "citation_page": citation.get("page_number"),
                    "advisory_result": "Advisory context surfaced for officer guidance. RAG never determines compliance directly.",
                    "is_advisory": True,
                })

            if not rag_investigations:
                rag_investigations.append({
                    "query": f"eligibility criteria exemptions {tender.title if tender else ''}",
                    "direct_tender_evidence": "No explicit exemption clause found in indexed tender corpus.",
                    "related_policy_context": "Standard General Financial Rules (GFR) 2017.",
                    "citation_document": None,
                    "citation_page": None,
                    "advisory_result": "General procurement guidelines apply; no custom relaxation detected.",
                    "is_advisory": True,
                })

            # Check rule evaluations requiring review
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
                    f"Advisory Deep Audit identified {len(findings)} investigative finding(s) "
                    f"({len(cross_document_conflicts)} conflict(s), {len(missing_evidence)} evidence gap(s)) "
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
            workflow_trace_items: list[dict[str, Any]] = []
            langgraph_trace: list[str] = []
            langgraph_interrupted: bool = False
            langgraph_reasons: list[str] = []

            stage_configs = {
                "tender_intelligence": {
                    "label": "Tender Intelligence",
                    "short_description": f"Analyzed {len(requirements)} tender requirement(s) and evaluation criteria.",
                    "findings_produced": 0,
                    "evidence_used": len(requirements),
                },
                "document_intelligence": {
                    "label": "Document Intelligence",
                    "short_description": f"Extracted and mapped {len(facts)} fact(s) from {len(documents)} submitted document(s).",
                    "findings_produced": len(cross_document_conflicts),
                    "evidence_used": len(facts),
                },
                "knowledge": {
                    "label": "Knowledge / RAG Investigation",
                    "short_description": f"Retrieved {len(policy_citations)} statutory precedent citation(s) and tender policy addenda.",
                    "findings_produced": len(policy_citations),
                    "evidence_used": len(policy_citations),
                },
                "risk": {
                    "label": "Risk / Anomaly Analysis",
                    "short_description": "Deterministic Anomaly & Risk Rule Engine evaluated document patterns and risk signals.",
                    "findings_produced": len(risk_signals),
                    "evidence_used": len(risk_signals),
                },
                "compliance": {
                    "label": "Compliance Cross-Check",
                    "short_description": f"Cross-checked {len(rule_evaluations)} machine compliance evaluations against extracted evidence.",
                    "findings_produced": len([e for e in rule_evaluations if e.status == ComplianceStatus.REVIEW_REQUIRED]),
                    "evidence_used": len(rule_evaluations),
                },
                "human_review": {
                    "label": "Human Review Handoff",
                    "short_description": "Packaged advisory findings, cross-document conflicts, and unresolved questions for officer review.",
                    "findings_produced": 0,
                    "evidence_used": 0,
                },
                "report": {
                    "label": "Advisory Synthesis",
                    "short_description": "Generated final advisory synthesis report.",
                    "findings_produced": len(findings),
                    "evidence_used": len(facts) + len(verifications),
                },
            }

            import os
            import sys
            import time
            from pathlib import Path
            repo_root = Path(__file__).resolve().parents[3]
            intel_path = str(repo_root / "intelligence")
            if intel_path not in sys.path:
                sys.path.insert(0, intel_path)

            if not os.environ.get("ARGUS_ALLOWED_STORAGE_ROOTS") and settings.APP_ENV.lower() != "production":
                data_roots = [
                    str((repo_root / "data").resolve()),
                    str(Path(settings.ARGUS_STORAGE_LOCAL_PATH).resolve()),
                ]
                os.environ["ARGUS_ALLOWED_STORAGE_ROOTS"] = ";".join(data_roots)

            from argus_ai.agents.workflow import build_argus_workflow, memory_checkpointer

            checkpointer = memory_checkpointer()
            workflow = build_argus_workflow(checkpointer=checkpointer)

            tender_doc_uri = None
            if tender and tender.raw_document_uri:
                raw_path = Path(tender.raw_document_uri)
                if raw_path.is_absolute() and raw_path.exists():
                    tender_doc_uri = str(raw_path)
                else:
                    cand = repo_root / tender.raw_document_uri
                    if cand.exists():
                        tender_doc_uri = str(cand.resolve())
                    elif raw_path.exists():
                        tender_doc_uri = str(raw_path.resolve())

            initial_state = {
                "tender": {"document_uri": tender_doc_uri},
                "document": {
                    "bidder_id": bidder_id,
                    "document_id": facts[0].document_id if facts else "unknown",
                },
                "rag_query": {"query": f"eligibility criteria exemptions {tender.title if tender else ''}"},
                "review_reasons": conflicts if has_conflicts else [],
            }

            thread_id = f"audit-{job.id}"
            cfg = {"configurable": {"thread_id": thread_id}}

            t_prev = time.perf_counter()
            for chunk in workflow.stream(initial_state, config=cfg):
                t_now = time.perf_counter()
                elapsed_ms = max(1, int((t_now - t_prev) * 1000))
                t_prev = t_now

                for node_key, chunk_val in chunk.items():
                    if node_key not in langgraph_trace:
                        langgraph_trace.append(node_key)

                    if node_key == "__interrupt__":
                        langgraph_interrupted = True
                        interrupt_val = chunk_val[0].value if chunk_val and hasattr(chunk_val[0], "value") else {}
                        if isinstance(interrupt_val, dict) and "reasons" in interrupt_val:
                            langgraph_reasons = interrupt_val["reasons"]
                        else:
                            langgraph_reasons = conflicts if has_conflicts else ["Human officer review checkpoint reached."]

                        meta = stage_configs.get("human_review", {})
                        workflow_trace_items.append({
                            "stage_key": "human_review",
                            "label": meta.get("label", "Human Review Handoff"),
                            "status": "INTERRUPTED",
                            "short_description": meta.get("short_description", "Human review checkpoint reached."),
                            "findings_produced": meta.get("findings_produced", 0),
                            "evidence_used": meta.get("evidence_used", 0),
                            "duration_ms": elapsed_ms,
                        })
                    else:
                        meta = stage_configs.get(node_key, {})
                        workflow_trace_items.append({
                            "stage_key": node_key,
                            "label": meta.get("label", node_key.replace("_", " ").title()),
                            "status": "COMPLETED",
                            "short_description": meta.get("short_description", f"Completed stage {node_key}."),
                            "findings_produced": meta.get("findings_produced", 0),
                            "evidence_used": meta.get("evidence_used", 0),
                            "duration_ms": elapsed_ms,
                        })

            high_priority_count = sum(1 for f in findings if f.get("severity") == "HIGH")
            review_req_count = sum(1 for f in findings if f.get("category") in ("CROSS_DOCUMENT_CONFLICT", "MISSING_EVIDENCE"))
            info_count = sum(1 for f in findings if f.get("severity") in ("INFO", "LOW"))

            synthesis_payload = {
                "run_id": job.id,
                "started_at": job.started_at.isoformat() if job.started_at else datetime.now(timezone.utc).isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
                "tender_id": tender_id,
                "bidder_id": bidder_id,
                "tender_title": tender.title if tender else None,
                "bidder_name": bidder.bidder_name,
                "is_advisory": True,
                "advisory_disclaimer": "ADVISORY INVESTIGATION. HUMAN DECISION REQUIRED.",
                "summary": summary_text,
                "summary_text": summary_text,
                "total_findings_count": len(findings),
                "high_priority_count": high_priority_count,
                "review_required_count": review_req_count,
                "informational_count": info_count,
                "unresolved_questions_count": len(unresolved_questions),
                "conflicts_count": len(cross_document_conflicts),
                "missing_evidence_count": len(missing_evidence),
                "workflow_trace": workflow_trace_items,
                "findings": findings,
                "cross_document_conflicts": cross_document_conflicts,
                "missing_evidence": missing_evidence,
                "statutory_investigations": statutory_investigations,
                "risk_anomalies": risk_anomalies,
                "rag_investigations": rag_investigations,
                "unresolved_questions": unresolved_questions,
                "recommended_actions": recommended_actions,
                "evidence_chains": evidence_chains,
                # Legacy compatibility fields
                "conflicts_detected": conflicts,
                "policy_citations": policy_citations,
                "facts_analyzed_count": len(facts),
                "verifications_analyzed_count": len(verifications),
                "risk_signals_analyzed_count": len(risk_signals),
                "langgraph_trace": langgraph_trace,
                "langgraph_interrupted": langgraph_interrupted,
                "langgraph_reasons": langgraph_reasons,
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
            final_status = JobStatus.COMPLETED

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
                    "target_url": f"/workspace/bidders/{bidder_id}/deep-audit",
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

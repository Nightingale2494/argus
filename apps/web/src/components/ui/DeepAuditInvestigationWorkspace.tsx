"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  AlertTriangle,
  FileSearch,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Scale,
  FileText,
  Building,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  Cpu,
  Compass,
  ArrowUpRight,
  Filter,
} from "lucide-react";
import { formatDisplayValue } from "@/lib/formatters";
import { api } from "@/services/api";
import type {
  DeepAuditSynthesis,
  DeepAuditStatusResponse,
  DeepAuditFinding,
} from "@/services/types";

interface DeepAuditInvestigationWorkspaceProps {
  bidderId: string;
  bidderName?: string;
  tenderId?: string;
  isDemo?: boolean;
}

export function DeepAuditInvestigationWorkspace({
  bidderId,
  bidderName: initialBidderName,
  tenderId: _initialTenderId,
  isDemo = false,
}: DeepAuditInvestigationWorkspaceProps) {
  const [synthesis, setSynthesis] = useState<DeepAuditSynthesis | null>(null);
  const [status, setStatus] = useState<string>("LOADING");
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("ALL");
  const [expandedChainId, setExpandedChainId] = useState<string | null>(null);

  const querySuffix = isDemo ? "?mode=demo" : "";

  const fetchInvestigation = useCallback(async () => {
    if (!bidderId) return;
    setError(null);
    try {
      const res: DeepAuditStatusResponse = await api.getLatestDeepAudit(bidderId);
      setStatus(res.status || "NOT_STARTED");
      if (res.synthesis) {
        setSynthesis(res.synthesis);
      }
      if (res.status === "RUNNING" || res.status === "QUEUED") {
        setRunning(true);
      } else {
        setRunning(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Deep Audit synthesis");
      setStatus("FAILED");
    }
  }, [bidderId]);

  useEffect(() => {
    fetchInvestigation();
  }, [fetchInvestigation]);

  // Polling for running jobs
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(async () => {
      try {
        const res: DeepAuditStatusResponse = await api.getLatestDeepAudit(bidderId);
        setStatus(res.status || "RUNNING");
        if (res.synthesis) setSynthesis(res.synthesis);

        if (res.status === "COMPLETED") {
          setRunning(false);
          clearInterval(interval);
        } else if (res.status === "FAILED") {
          setRunning(false);
          setError("Investigation execution failed");
          clearInterval(interval);
        }
      } catch {
        setRunning(false);
        clearInterval(interval);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [running, bidderId]);

  const handleTriggerAudit = async () => {
    setError(null);
    setRunning(true);
    setStatus("RUNNING");
    try {
      await api.triggerDeepAudit(bidderId);
      const res: DeepAuditStatusResponse = await api.getLatestDeepAudit(bidderId);
      setStatus(res.status || "RUNNING");
      if (res.synthesis) setSynthesis(res.synthesis);
      if (res.status === "COMPLETED") {
        setRunning(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to trigger Deep Audit");
      setRunning(false);
      setStatus("FAILED");
    }
  };

  // Normalized findings list
  const findings: DeepAuditFinding[] = useMemo(() => {
    if (!synthesis) return [];
    if (synthesis.findings && synthesis.findings.length > 0) {
      return synthesis.findings;
    }
    // Backward compatibility with legacy syntheses
    const fallbackList: DeepAuditFinding[] = [];
    if (synthesis.conflicts_detected && Array.isArray(synthesis.conflicts_detected)) {
      synthesis.conflicts_detected.forEach((c, idx) => {
        fallbackList.push({
          finding_id: `legacy_conflict_${idx}`,
          category: "CROSS_DOCUMENT_CONFLICT",
          severity: c.severity === "CRITICAL" ? "HIGH" : "MEDIUM",
          title: c.conflict_type || "Document Discrepancy",
          description: c.description || "",
          affected_fields: [c.clause_reference || "clause"],
          evidence_provenance: [],
          detection_method: "HISTORICAL_RECORD",
          recommended_action: "Officer review required.",
        });
      });
    }
    return fallbackList;
  }, [synthesis]);

  // Filtered findings
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      const matchCat = selectedCategory === "ALL" || f.category === selectedCategory;
      const matchSev = selectedSeverity === "ALL" || f.severity === selectedSeverity;
      return matchCat && matchSev;
    });
  }, [findings, selectedCategory, selectedSeverity]);

  const resolvedBidderName = synthesis?.bidder_name || initialBidderName || bidderId;
  const resolvedTenderTitle = synthesis?.tender_title || "Procurement Tender Assessment";

  return (
    <div className="space-y-8 pb-16">
      {/* ADVISORY MANDATORY BANNER */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold tracking-wide text-amber-300">
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                Advisory Investigation Layer
              </span>
              <span>• Strictly Advisory • Non-Mutating • Human Officer Retains Final Authority</span>
            </div>
            <p className="text-sm text-amber-200/90 leading-relaxed">
              Deep Audit uncovers hidden document discrepancies, missing evidence chains, and advisory policy precedents.
              It <strong>does not alter</strong> deterministic compliance outcomes, qualify/disqualify bidders, or override
              statutory procurement officer discretion.
            </p>
          </div>
        </div>
      </div>

      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Autonomous Advisory Investigation
            </span>
            <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300 border border-indigo-500/30">
              {isDemo ? "DEMO MODE (100% Client-Side)" : "AUTHENTIC WORKFLOW"}
            </span>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-mono font-medium text-slate-300 border border-slate-700">
              Status: {status}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <FileSearch className="h-7 w-7 text-indigo-400" />
            Deep Audit Investigation
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
            <div>
              Bidder: <span className="font-semibold text-slate-200">{resolvedBidderName}</span>
            </div>
            <span>•</span>
            <div>
              Tender: <span className="font-medium text-slate-300">{resolvedTenderTitle}</span>
            </div>
            {synthesis?.completed_at && (
              <>
                <span>•</span>
                <div className="text-xs text-slate-500">
                  Completed: {new Date(synthesis.completed_at).toLocaleString()}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTriggerAudit}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Investigating..." : "Re-run Deep Audit"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TOP SUMMARY METRICS CARDS */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Findings</div>
          <div className="mt-2 text-3xl font-bold text-white">
            {synthesis?.total_findings_count ?? findings.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Advisory observations</div>
        </div>

        <div className="rounded-xl border border-red-900/30 bg-red-950/20 p-4">
          <div className="text-xs font-medium text-red-400 uppercase tracking-wider">High Priority</div>
          <div className="mt-2 text-3xl font-bold text-red-300">
            {synthesis?.high_priority_count ?? findings.filter((f) => f.severity === "HIGH").length}
          </div>
          <div className="mt-1 text-xs text-red-400/70">Potential blockers</div>
        </div>

        <div className="rounded-xl border border-amber-900/30 bg-amber-950/20 p-4">
          <div className="text-xs font-medium text-amber-400 uppercase tracking-wider">Review Required</div>
          <div className="mt-2 text-3xl font-bold text-amber-300">
            {synthesis?.review_required_count ?? findings.filter((f) => f.severity === "MEDIUM").length}
          </div>
          <div className="mt-1 text-xs text-amber-400/70">Officer clarification</div>
        </div>

        <div className="rounded-xl border border-purple-900/30 bg-purple-950/20 p-4">
          <div className="text-xs font-medium text-purple-400 uppercase tracking-wider">Doc Conflicts</div>
          <div className="mt-2 text-3xl font-bold text-purple-300">
            {synthesis?.conflicts_count ?? (synthesis?.cross_document_conflicts?.length || 0)}
          </div>
          <div className="mt-1 text-xs text-purple-400/70">Cross-filing variances</div>
        </div>

        <div className="rounded-xl border border-rose-900/30 bg-rose-950/20 p-4">
          <div className="text-xs font-medium text-rose-400 uppercase tracking-wider">Missing Evidence</div>
          <div className="mt-2 text-3xl font-bold text-rose-300">
            {synthesis?.missing_evidence_count ?? (synthesis?.missing_evidence?.length || 0)}
          </div>
          <div className="mt-1 text-xs text-rose-400/70">Unindexed or weak docs</div>
        </div>

        <div className="rounded-xl border border-blue-900/30 bg-blue-950/20 p-4">
          <div className="text-xs font-medium text-blue-400 uppercase tracking-wider">Unresolved Qs</div>
          <div className="mt-2 text-3xl font-bold text-blue-300">
            {synthesis?.unresolved_questions_count ?? (synthesis?.unresolved_questions?.length || 0)}
          </div>
          <div className="mt-1 text-xs text-blue-400/70">Requires human judgment</div>
        </div>
      </div>

      {/* EXECUTIVE SYNTHESIS SUMMARY */}
      {synthesis?.summary && (
        <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-indigo-300">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            Executive Synthesis & Key Takeaways
          </div>
          <p className="text-base text-slate-200 leading-relaxed">
            {synthesis.summary}
          </p>
        </div>
      )}

      {/* 6-STAGE INVESTIGATION WORKFLOW TIMELINE */}
      {synthesis?.workflow_trace && synthesis.workflow_trace.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-400" />
              Investigation Execution Trace (6-Stage Pipeline)
            </h2>
            <span className="text-xs text-slate-400">Deterministic workflow sequence</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {synthesis.workflow_trace.map((stage, idx) => (
              <div
                key={stage.stage_key}
                className="relative flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 hover:border-slate-700 transition"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500 font-mono mb-1">
                    <span>Stage 0{idx + 1}</span>
                    <span className="flex items-center gap-1 text-emerald-400 font-sans font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Done
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-200">{stage.label}</div>
                  <p className="mt-1 text-xs text-slate-400 line-clamp-3 leading-normal">
                    {stage.short_description}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>{stage.findings_produced} findings</span>
                  <span>{stage.duration_ms ? `${stage.duration_ms}ms` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CROSS-DOCUMENT CONFLICTS (THE PRIMARY DIFFERENTIATOR) */}
      <div className="rounded-xl border border-purple-900/40 bg-purple-950/10 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-purple-200 flex items-center gap-2">
              <Scale className="h-5 w-5 text-purple-400" />
              Cross-Document Conflict Analysis
            </h2>
            <p className="text-sm text-slate-400">
              Detects internal contradictions across multiple files submitted by the same bidder that standard single-document evaluation fails to catch.
            </p>
          </div>
          <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300 border border-purple-500/30">
            {synthesis?.cross_document_conflicts?.length || 0} Conflict(s) Identified
          </span>
        </div>

        {synthesis?.cross_document_conflicts && synthesis.cross_document_conflicts.length > 0 ? (
          <div className="space-y-4">
            {synthesis.cross_document_conflicts.map((conflict, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-purple-800/50 bg-slate-900/80 p-5 space-y-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300 uppercase">
                      {conflict.severity}
                    </span>
                    <span className="text-sm font-semibold text-slate-200">
                      Field: <code className="text-purple-300 font-mono">{conflict.field_name}</code>
                    </span>
                  </div>
                  <div className="text-xs text-amber-300/90 font-medium">
                    ⚠️ Evaluation Pipeline Divergence Flagged
                  </div>
                </div>

                {/* Comparative Document Table */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                      <span className="text-indigo-400 flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" /> Primary Submission Filing
                      </span>
                      <span>Page {conflict.document_a_page ?? "—"}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-200">{conflict.document_a_name}</div>
                    <div className="rounded bg-slate-900 p-2 text-sm font-mono text-emerald-400 font-bold">
                      Reported: {conflict.document_a_value}
                    </div>
                    <div className="text-xs text-emerald-400/80 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Met baseline compliance threshold
                    </div>
                  </div>

                  <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-amber-400 font-medium">
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Conflicting Submission Filing
                      </span>
                      <span>Page {conflict.document_b_page ?? "—"}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-200">{conflict.document_b_name}</div>
                    <div className="rounded bg-slate-900 p-2 text-sm font-mono text-rose-400 font-bold">
                      Reported: {conflict.document_b_value}
                    </div>
                    <div className="text-xs text-rose-400/80 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Discrepancy breaches minimum threshold
                    </div>
                  </div>
                </div>

                <div className="space-y-2 rounded-md bg-slate-950/40 p-3 border border-slate-800/80 text-sm">
                  <div className="text-slate-300 leading-relaxed">
                    <strong>Variance Analysis:</strong> {conflict.difference_description}
                  </div>
                  <div className="text-amber-200/90 leading-relaxed">
                    <strong>Procurement Officer Advisory:</strong> {conflict.officer_review_reason}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            No cross-document discrepancies detected between submitted filings.
          </div>
        )}
      </div>

      {/* MISSING & WEAK EVIDENCE RADAR */}
      <div className="rounded-xl border border-rose-900/40 bg-rose-950/10 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-rose-200 flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-rose-400" />
              Missing & Weak Evidence Radar
            </h2>
            <p className="text-sm text-slate-400">
              Identifies gaps where mandatory criteria are satisfied with ambiguous, incomplete, or indirect evidence.
            </p>
          </div>
          <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-300 border border-rose-500/30">
            {synthesis?.missing_evidence?.length || 0} Gap(s) Flagged
          </span>
        </div>

        {synthesis?.missing_evidence && synthesis.missing_evidence.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {synthesis.missing_evidence.map((item) => (
              <div
                key={item.item_id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-rose-300 rounded bg-rose-500/20 px-2 py-0.5 uppercase">
                      Status: {item.status}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-200">{item.requirement_title}</h3>
                  <p className="text-xs text-slate-400">{item.requirement_description}</p>
                  <div className="rounded bg-slate-950/80 p-2.5 text-xs text-slate-300 border border-slate-800">
                    <span className="text-slate-400 font-medium">Observed Filing: </span>
                    {item.bidder_evidence_status}
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800/80 text-xs text-amber-300 flex items-start gap-1.5">
                  <ArrowRight className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span><strong>Recommended:</strong> {item.recommended_action}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            All mandatory tender requirements have complete direct evidence attachments.
          </div>
        )}
      </div>

      {/* STATUTORY REGISTRY INVESTIGATION */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Building className="h-5 w-5 text-indigo-400" />
              Statutory Registry Investigation
            </h2>
            <p className="text-sm text-slate-400">
              Cross-checks company identities against government databases with truthful provider disclosure.
            </p>
          </div>
        </div>

        {synthesis?.statutory_investigations && synthesis.statutory_investigations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Identifier</th>
                  <th className="py-3 px-4">Claimed Value</th>
                  <th className="py-3 px-4">Provider Mode</th>
                  <th className="py-3 px-4">Registry Result</th>
                  <th className="py-3 px-4">Conflict Status</th>
                  <th className="py-3 px-4">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                {synthesis.statutory_investigations.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 font-bold text-slate-200">{item.identifier_type}</td>
                    <td className="py-3 px-4 text-slate-300">{item.identifier_value}</td>
                    <td className="py-3 px-4 font-sans">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                        item.provider_mode === "LIVE"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : item.provider_mode === "DEMO_SYNTHETIC"
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          : "bg-slate-700/50 text-slate-300"
                      }`}>
                        {item.provider_mode}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        item.verification_result === "VERIFIED" || item.verification_result === "CLEARED"
                          ? "text-emerald-400"
                          : item.verification_result === "MISMATCH" || item.verification_result === "FLAGGED"
                          ? "text-rose-400"
                          : "text-slate-400"
                      }`}>
                        {item.verification_result === "VERIFIED" && <CheckCircle2 className="h-3 w-3" />}
                        {item.verification_result}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans">
                      <span className={`text-[11px] font-medium ${
                        item.conflict_status === "NO_CONFLICT"
                          ? "text-slate-400"
                          : "text-amber-400 font-bold"
                      }`}>
                        {item.conflict_status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-300 max-w-xs">{item.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            No statutory registry checks recorded.
          </div>
        )}
      </div>

      {/* DETERMINISTIC ANOMALY & RISK RULE ENGINE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">
                Deterministic Anomaly & Risk Rule Engine
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Evaluated strictly via deterministic heuristics and mathematical variance thresholds (No opaque ML claims).
            </p>
          </div>
          <span className="rounded bg-indigo-500/10 px-2.5 py-1 text-xs font-mono font-medium text-indigo-300 border border-indigo-500/20">
            DETERMINISTIC HEURISTICS
          </span>
        </div>

        {synthesis?.risk_anomalies && synthesis.risk_anomalies.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {synthesis.risk_anomalies.map((sig) => (
              <div
                key={sig.signal_id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-indigo-300">
                    {sig.rule_name}
                  </span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    sig.severity === "HIGH"
                      ? "bg-red-500/20 text-red-300"
                      : sig.severity === "MEDIUM"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-slate-700/50 text-slate-300"
                  }`}>
                    {sig.severity}
                  </span>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">{sig.why_triggered}</p>
                <div className="rounded bg-slate-950 p-2.5 text-xs font-mono text-slate-400 space-y-1">
                  <div><strong>Inputs:</strong> {sig.input_values.join(" | ")}</div>
                  <div><strong>Evidence:</strong> {sig.supporting_evidence}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            0 risk anomaly signals triggered by deterministic rules.
          </div>
        )}
      </div>

      {/* ADVISORY RAG & POLICY INVESTIGATION */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Compass className="h-5 w-5 text-indigo-400" />
              Advisory RAG & Tender Policy Retrieval
            </h2>
            <p className="text-sm text-slate-400">
              Retrieves governing tender clauses and external procurement policy precedents (GFR / MSME / SECI guidelines).
            </p>
          </div>
          <span className="rounded bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 border border-amber-500/20">
            SEPARATED FROM COMPLIANCE
          </span>
        </div>

        {synthesis?.rag_investigations && synthesis.rag_investigations.length > 0 ? (
          <div className="space-y-3">
            {synthesis.rag_investigations.map((rag, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-3"
              >
                <div className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                  <span>Query: &ldquo;{rag.query}&rdquo;</span>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                  {rag.direct_tender_evidence && (
                    <div className="rounded bg-slate-950 p-3 border border-slate-800 space-y-1">
                      <div className="font-semibold text-slate-400 uppercase tracking-wider">
                        Direct Tender Clause Evidence ({rag.citation_document || "RFP"}, p.{rag.citation_page || "—"})
                      </div>
                      <div className="text-slate-200">{rag.direct_tender_evidence}</div>
                    </div>
                  )}

                  {rag.related_policy_context && (
                    <div className="rounded bg-slate-950 p-3 border border-slate-800 space-y-1">
                      <div className="font-semibold text-amber-400 uppercase tracking-wider">
                        Related Public Policy Precedent
                      </div>
                      <div className="text-slate-200">{rag.related_policy_context}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            No advisory policy RAG inquiries registered for this bidder.
          </div>
        )}
      </div>

      {/* UNRESOLVED QUESTIONS (OFFICER REVIEW REQUIRED) */}
      <div className="rounded-xl border border-blue-900/40 bg-blue-950/10 p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-blue-200 flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-400" />
              Unresolved Questions for Procurement Committee
            </h2>
            <p className="text-sm text-slate-400">
              Ambiguities that ARGUS cannot safely resolve automatically. Human officer discretion required.
            </p>
          </div>
        </div>

        {synthesis?.unresolved_questions && synthesis.unresolved_questions.length > 0 ? (
          <div className="space-y-4">
            {synthesis.unresolved_questions.map((q) => (
              <div
                key={q.question_id}
                className="rounded-lg border border-blue-800/50 bg-slate-900/90 p-5 space-y-3"
              >
                <div className="text-base font-bold text-white leading-snug">
                  {q.question}
                </div>
                <div className="text-sm text-slate-300 leading-relaxed">
                  <span className="text-slate-400 font-medium">Context: </span>
                  {q.background}
                </div>
                <div className="text-xs text-slate-400">
                  <span className="text-slate-500 font-medium">Why system cannot auto-resolve: </span>
                  {q.reason_cannot_auto_resolve}
                </div>
                <div className="rounded-md bg-blue-950/60 p-3 border border-blue-800 text-xs font-semibold text-blue-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-400 flex-shrink-0" />
                  <span>{q.officer_prompt}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            All submission points resolved without pending advisory questions.
          </div>
        )}
      </div>

      {/* RECOMMENDED ACTIONS */}
      {synthesis?.recommended_actions && synthesis.recommended_actions.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            Recommended Human Procurement Officer Actions
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {synthesis.recommended_actions.map((act) => (
              <div
                key={act.action_id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[11px] font-bold text-indigo-300 font-mono">
                    {act.action_type}
                  </span>
                  <h3 className="text-sm font-bold text-slate-200">{act.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{act.description}</p>
                </div>
                {act.target_document && (
                  <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500">
                    Ref: {act.target_document} {act.target_page ? `(p.${act.target_page})` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EVIDENCE CHAIN BREADCRUMBS (INTERACTIVE) */}
      {synthesis?.evidence_chains && synthesis.evidence_chains.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Compass className="h-5 w-5 text-indigo-400" />
                Evidence Provenance Chains
              </h2>
              <p className="text-sm text-slate-400">
                End-to-end breadcrumb trace connecting Tender Requirement → Bidder Filing → Extracted Fact → Rule Evaluation → Deep Audit Finding.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {synthesis.evidence_chains.map((chain) => {
              const isExpanded = expandedChainId === chain.chain_id;
              return (
                <div
                  key={chain.chain_id}
                  className="rounded-lg border border-slate-800 bg-slate-900/80 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedChainId(isExpanded ? null : chain.chain_id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-bold text-indigo-300 font-mono">
                        {chain.tender_requirement.clause}
                      </span>
                      <span className="text-sm font-semibold text-slate-200">
                        {chain.deep_audit_finding.title}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.2 rounded ${
                        chain.deep_audit_finding.severity === "HIGH" ? "bg-red-500/20 text-red-300" : "bg-indigo-500/20 text-indigo-300"
                      }`}>
                        {chain.deep_audit_finding.severity}
                      </span>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </button>

                  {isExpanded && (
                    <div className="p-4 pt-0 border-t border-slate-800/60 bg-slate-950/40 space-y-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center justify-between text-xs">
                        {/* Step 1: Requirement */}
                        <div className="flex-1 rounded border border-slate-800 bg-slate-900 p-3 space-y-1">
                          <div className="font-semibold text-slate-400 uppercase">1. Tender Requirement</div>
                          <div className="font-medium text-slate-200">{chain.tender_requirement.clause}</div>
                          <div className="text-slate-400 text-[11px]">{chain.tender_requirement.text}</div>
                        </div>

                        <ArrowRight className="hidden lg:block h-4 w-4 text-slate-600 flex-shrink-0" />

                        {/* Step 2: Evidence */}
                        <div className="flex-1 rounded border border-slate-800 bg-slate-900 p-3 space-y-1">
                          <div className="font-semibold text-slate-400 uppercase">2. Bidder Document</div>
                          <div className="font-medium text-slate-200">{chain.bidder_evidence.document_name}</div>
                          <div className="text-slate-400 text-[11px] italic">&ldquo;{chain.bidder_evidence.excerpt}&rdquo;</div>
                        </div>

                        <ArrowRight className="hidden lg:block h-4 w-4 text-slate-600 flex-shrink-0" />

                        {/* Step 3: Fact */}
                        <div className="flex-1 rounded border border-slate-800 bg-slate-900 p-3 space-y-1">
                          <div className="font-semibold text-slate-400 uppercase">3. Extracted Fact</div>
                          <div className="font-mono text-emerald-400 font-bold">{chain.extracted_fact.extracted_value}</div>
                          <div className="text-slate-500 font-mono text-[11px]">{chain.extracted_fact.canonical_field}</div>
                        </div>

                        <ArrowRight className="hidden lg:block h-4 w-4 text-slate-600 flex-shrink-0" />

                        {/* Step 4: Rule Investigation */}
                        <div className="flex-1 rounded border border-slate-800 bg-slate-900 p-3 space-y-1">
                          <div className="font-semibold text-slate-400 uppercase">4. Rule Engine</div>
                          <div className="text-slate-300 font-medium">{chain.rule_investigation.detection_method}</div>
                          <div className="text-slate-400 text-[11px]">{chain.rule_investigation.evaluation}</div>
                        </div>

                        <ArrowRight className="hidden lg:block h-4 w-4 text-slate-600 flex-shrink-0" />

                        {/* Step 5: Deep Audit Finding */}
                        <div className="flex-1 rounded border border-indigo-800 bg-indigo-950/40 p-3 space-y-1">
                          <div className="font-semibold text-indigo-300 uppercase">5. Deep Audit Finding</div>
                          <div className="font-bold text-white">{chain.deep_audit_finding.title}</div>
                          <div className="text-indigo-300/80 text-[11px]">Severity: {chain.deep_audit_finding.severity}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FILTERABLE FINDINGS LIST */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Filter className="h-5 w-5 text-indigo-400" />
              Categorized Investigation Findings ({filteredFindings.length})
            </h2>
            <p className="text-xs text-slate-400">Filter findings by category or severity level</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
            >
              <option value="ALL">All Categories</option>
              <option value="CROSS_DOCUMENT_CONFLICT">Cross-Document Conflict</option>
              <option value="MISSING_EVIDENCE">Missing Evidence</option>
              <option value="STATUTORY_MISMATCH">Statutory Mismatch</option>
              <option value="ANOMALY_SIGNAL">Anomaly Signal</option>
              <option value="RAG_CONTEXT">RAG Context</option>
            </select>

            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
            >
              <option value="ALL">All Severities</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="INFO">Info</option>
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {filteredFindings.length > 0 ? (
            filteredFindings.map((finding) => (
              <div
                key={finding.finding_id}
                className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                      finding.severity === "HIGH"
                        ? "bg-red-500/20 text-red-300"
                        : finding.severity === "MEDIUM"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-blue-500/20 text-blue-300"
                    }`}>
                      {finding.severity}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                      {finding.category}
                    </span>
                    <h3 className="text-sm font-bold text-slate-200">{finding.title}</h3>
                  </div>
                  <span className="text-xs font-mono text-slate-500">{finding.detection_method}</span>
                </div>

                <p className="text-sm text-slate-300 leading-relaxed">{finding.description}</p>

                {finding.evidence_provenance && finding.evidence_provenance.length > 0 && (
                  <div className="rounded bg-slate-950 p-2 text-xs font-mono text-slate-400 flex flex-wrap gap-3">
                    {finding.evidence_provenance.map((ev, i) => (
                      <span key={i}>
                        Doc: <strong className="text-slate-300">{ev.document_name}</strong> (p.{ev.page ?? "—"}): &ldquo;{formatDisplayValue(ev.raw_value)}&rdquo;
                      </span>
                    ))}
                  </div>
                )}

                {finding.recommended_action && (
                  <div className="text-xs text-amber-300/90 flex items-center gap-1.5 pt-1">
                    <ArrowRight className="h-3 w-3 flex-shrink-0" />
                    <span><strong>Action:</strong> {finding.recommended_action}</span>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
              No findings match the selected filters.
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM WORKFLOW NAVIGATION CARDS */}
      <div className="border-t border-slate-800 pt-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
          Supporting Workflows & Human Officer Execution
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link
            href={`/workspace/bidders/${bidderId}/matrix${querySuffix}`}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700 hover:bg-slate-900 transition group"
          >
            <div>
              <div className="text-xs text-slate-400 font-mono">Workflow 01</div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-white">Compliance Matrix</div>
              <div className="text-xs text-slate-500">Deterministic rule-by-rule pass/fail</div>
            </div>
            <ArrowUpRight className="h-5 w-5 text-slate-500 group-hover:text-indigo-400 transition" />
          </Link>

          <Link
            href={`/workspace/bidders/${bidderId}/review${querySuffix}`}
            className="flex items-center justify-between rounded-xl border border-amber-900/30 bg-amber-950/10 p-4 hover:border-amber-700/50 hover:bg-amber-950/20 transition group"
          >
            <div>
              <div className="text-xs text-amber-400 font-mono">Workflow 02</div>
              <div className="text-sm font-bold text-amber-200 group-hover:text-amber-100">Human Officer Review</div>
              <div className="text-xs text-amber-400/70">Exclusive authority for final qualification</div>
            </div>
            <ArrowUpRight className="h-5 w-5 text-amber-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
          </Link>

          <Link
            href={`/workspace/bidders/${bidderId}/report${querySuffix}`}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700 hover:bg-slate-900 transition group"
          >
            <div>
              <div className="text-xs text-slate-400 font-mono">Workflow 03</div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-white">Audit Report</div>
              <div className="text-xs text-slate-500">Official evaluation summary export</div>
            </div>
            <ArrowUpRight className="h-5 w-5 text-slate-500 group-hover:text-indigo-400 transition" />
          </Link>
        </div>
      </div>
    </div>
  );
}

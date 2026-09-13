"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  Bot, AlertTriangle, Scale, CheckCircle2, 
  HelpCircle, ArrowRight, ShieldAlert, Sparkles, RefreshCw
} from "lucide-react";
import { api } from "@/services/api";
import { demoStore } from "@/services/demo-store";
import type { DeepAuditSynthesis, DeepAuditStatusResponse } from "@/services/types";

interface DeepAuditPanelProps {
  bidderId: string;
  bidderName?: string;
  isDemo?: boolean;
  onCompleted?: () => void;
}

const STAGES = [
  { key: "LOAD_CONTEXT", label: "Load Context" },
  { key: "RETRIEVE_POLICY", label: "Retrieve Policy" },
  { key: "COLLECT_EVIDENCE", label: "Collect Evidence" },
  { key: "ANALYZE_CONFLICTS", label: "Analyze Conflicts" },
  { key: "GENERATE_EXPLANATION", label: "Generate Explanation" },
  { key: "HUMAN_REVIEW_REQUIRED", label: "Human Review Required" },
];

export function DeepAuditPanel({
  bidderId,
  bidderName,
  isDemo = false,
  onCompleted,
}: DeepAuditPanelProps) {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("LOAD_CONTEXT");
  const [progress, setProgress] = useState<number>(0);
  const [synthesis, setSynthesis] = useState<DeepAuditSynthesis | null>(null);
  const [_status, setStatus] = useState<string>("NOT_STARTED");
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!bidderId) return;
    try {
      if (isDemo) {
        const saved = demoStore.getDemoState().deepAuditSyntheses?.[bidderId];
        if (saved) {
          setStatus("COMPLETED");
          setSynthesis(saved);
        } else {
          setStatus("NOT_STARTED");
        }
        return;
      }

      const res: DeepAuditStatusResponse = await api.getLatestDeepAudit(bidderId);
      setStatus(res.status);
      if (res.stage) setCurrentStage(res.stage);
      if (res.progress !== undefined) setProgress(res.progress);
      if (res.synthesis) setSynthesis(res.synthesis);

      if (res.status === "RUNNING" || res.status === "QUEUED") {
        setRunning(true);
      } else {
        setRunning(false);
      }
    } catch {
      // Ignore initial load error if no audit yet
    }
  }, [bidderId, isDemo]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling for live authentic jobs
  useEffect(() => {
    if (!running || isDemo) return;

    const interval = setInterval(async () => {
      try {
        const res: DeepAuditStatusResponse = await api.getLatestDeepAudit(bidderId);
        setStatus(res.status);
        if (res.stage) setCurrentStage(res.stage);
        if (res.progress !== undefined) setProgress(res.progress);

        if (res.status === "COMPLETED") {
          setRunning(false);
          setSynthesis(res.synthesis ?? null);
          clearInterval(interval);
          onCompleted?.();
        } else if (res.status === "FAILED") {
          setRunning(false);
          setError("Deep Audit execution encountered an error.");
          clearInterval(interval);
        }
      } catch (err: unknown) {
        setRunning(false);
        setError(err instanceof Error ? err.message : "Polling failed");
        clearInterval(interval);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [running, bidderId, isDemo, onCompleted]);

  const handleStartDeepAudit = async () => {
    setError(null);
    setLoading(true);

    if (isDemo) {
      setRunning(true);
      setStatus("RUNNING");
      setLoading(false);

      // Simulate multi-stage advisory workflow in client-side state
      for (let i = 0; i < STAGES.length; i++) {
        setCurrentStage(STAGES[i].key);
        setProgress(Math.round(((i + 1) / STAGES.length) * 100));
        await new Promise((r) => setTimeout(r, 450));
      }

      const syntheticSynthesis: DeepAuditSynthesis = {
        summary: `Autonomous advisory audit completed for bidder ${bidderName || bidderId}. Identified 1 high-priority conflict regarding turnover reconciliation and 1 valid statutory exemption applicable under Demo Policy Fixture P-153 (Synthetic Procurement Policy — MSME Exemption).`,
        conflicts_detected: [
          {
            clause_reference: "Clause 3.1 vs Clause 4.2",
            conflict_type: "TURNOVER_THRESHOLD_AMBIGUITY",
            description: "General tender financial requirement mandates ₹5.0 Cr turnover, but Clause 4.2 grants MSE exemption for Udyam-registered micro-enterprises.",
            severity: "WARNING",
          },
        ],
        policy_precedents: [
          {
            clause_reference: "Demo Policy Fixture P-153 (Synthetic Procurement Policy — MSME Exemption)",
            precedent_id: "SYN-FIXTURE-P153",
            source: "Synthetic Procurement Policy Context • Demo Only",
            similarity_score: 0.94,
            ruling_summary: "Procuring entities may not reject MSE bidders meeting technical parameters solely on failure of minimum turnover thresholds.",
          },
          {
            clause_reference: "Demo Policy Fixture P-2014 (Synthetic Startup & MSE Experience Relaxation)",
            precedent_id: "SYN-FIXTURE-P2014",
            source: "Synthetic Procurement Policy Context • Demo Only",
            similarity_score: 0.88,
            ruling_summary: "Prior experience criteria relaxation is applicable to registered startups and MSEs in all public goods/service tenders.",
          },
        ],
        evidence_synthesis: "Bidder submitted valid Udyam Registration (UDYAM-MH-02-0049281) and CA turnover certificate. Deterministic statutory verification confirmed active GSTIN status. Exemption is verified and eligible for officer sign-off.",
        recommended_human_inquiries: [
          "Confirm whether bidder qualifies under Micro or Small category on the National Udyam Portal.",
          "Verify that manufacturing/service provision domain matches Tender Item Classification Schedule.",
          "Record formal officer discretion in compliance determination memo.",
        ],
        disclaimer: "Advisory Analysis: Deep Audit provides investigation assistance. Final qualification decisions remain solely with the human procurement officer.",
        is_advisory: true,
      };

      demoStore.recordDeepAuditSynthesis(bidderId, syntheticSynthesis);
      setSynthesis(syntheticSynthesis);
      setStatus("COMPLETED");
      setRunning(false);
      onCompleted?.();
      return;
    }

    try {
      await api.triggerDeepAudit(bidderId);
      setRunning(true);
      setStatus("RUNNING");
      setProgress(10);
      setCurrentStage("LOAD_CONTEXT");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to trigger Deep Audit.");
    } finally {
      setLoading(false);
    }
  };

  const getStageIndex = (stageKey: string) => {
    const idx = STAGES.findIndex((s) => s.key === stageKey);
    return idx === -1 ? 0 : idx;
  };

  const currentStageIndex = getStageIndex(currentStage);

  return (
    <div className="rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-950/50">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mt-0.5">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">Deep Audit Autonomous Investigation</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Advisory Only
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              LangGraph-coordinated multi-stage evidence synthesis, conflict analysis, and policy precedent retrieval.
            </p>
          </div>
        </div>

        <button
          onClick={handleStartDeepAudit}
          disabled={loading || running}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 shadow-md shadow-indigo-950/40"
        >
          {running ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Investigating...</span>
            </>
          ) : synthesis ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Re-run Deep Audit</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Run Deep Audit</span>
            </>
          )}
        </button>
      </div>

      {/* Advisory Banner */}
      <div className="px-5 py-2.5 bg-indigo-950/30 border-b border-indigo-900/40 text-indigo-300 text-xs flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <span>
          <strong>Invariant:</strong> Deep Audit produces advisory insights and precedent references. It does not alter deterministic rule outcomes or bidder status.
        </span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-rose-950/30 border-b border-rose-900/50 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Execution Progress Bar & Stage Indicator */}
      {running && (
        <div className="p-5 bg-zinc-950/70 border-b border-zinc-800 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-300">
              Stage: <span className="text-indigo-400 font-mono">{currentStage}</span>
            </span>
            <span className="font-mono text-zinc-400">{progress}%</span>
          </div>

          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>

          {/* Stepper */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-1">
            {STAGES.map((s, idx) => {
              const isPast = idx < currentStageIndex;
              const isCurrent = idx === currentStageIndex;
              return (
                <div
                  key={s.key}
                  className={`p-2 rounded border text-[11px] font-medium flex items-center gap-1.5 ${
                    isCurrent
                      ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-300"
                      : isPast
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-zinc-900/40 border-zinc-800 text-zinc-500"
                  }`}
                >
                  {isPast ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  ) : isCurrent ? (
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-zinc-700 mx-1 flex-shrink-0" />
                  )}
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Synthesis Display */}
      {synthesis ? (
        <div className="p-5 space-y-6">
          {/* Executive Summary */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Bot className="w-4 h-4 text-indigo-400" />
              <span>Investigation Executive Summary</span>
            </div>
            <p className="text-sm text-zinc-200 leading-relaxed bg-zinc-950 p-4 rounded-lg border border-zinc-800 font-sans">
              {synthesis.summary}
            </p>
          </div>

          {/* Conflicts Detected */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Potential Conflicts & Ambiguities ({synthesis.conflicts_detected.length})</span>
            </div>
            {synthesis.conflicts_detected.length === 0 ? (
              <p className="text-xs text-zinc-400 bg-zinc-950 p-3 rounded border border-zinc-800/60">
                No policy or cross-clause contradictions detected across bidder evidence.
              </p>
            ) : (
              <div className="grid gap-2.5">
                {synthesis.conflicts_detected.map((conf, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-200">{conf.clause_reference}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          conf.severity === "CRITICAL"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : conf.severity === "WARNING"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        }`}
                      >
                        {conf.severity}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-zinc-400">{conf.conflict_type}</div>
                    <p className="text-xs text-zinc-300">{conf.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Policy Precedents */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
              <Scale className="w-4 h-4 text-blue-400" />
              <span>Policy Precedents & Legal Context ({synthesis.policy_precedents.length})</span>
            </div>
            {synthesis.policy_precedents.length === 0 ? (
              <p className="text-xs text-zinc-400 bg-zinc-950 p-3 rounded border border-zinc-800/60">
                No external policy precedent required.
              </p>
            ) : (
              <div className="grid gap-2.5">
                {synthesis.policy_precedents.map((prec, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-blue-300">{prec.clause_reference}</span>
                      {prec.similarity_score && (
                        <span className="text-[10px] font-mono text-zinc-400">
                          Match: {Math.round(prec.similarity_score * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      Source: {prec.source} ({prec.precedent_id})
                    </div>
                    <p className="text-xs text-zinc-300 leading-normal">{prec.ruling_summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recommended Inquiries for Officer */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <HelpCircle className="w-4 h-4 text-emerald-400" />
              <span>Recommended Inquiries for Procurement Officer</span>
            </div>
            <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 space-y-2">
              {synthesis.recommended_human_inquiries.map((inq, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs text-zinc-200">
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span>{inq}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Synthesis Footer */}
          {synthesis.evidence_synthesis && (
            <div className="text-xs text-zinc-400 bg-zinc-950/60 p-3.5 rounded-lg border border-zinc-800/60 space-y-1">
              <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[10px] block">
                Evidence Synthesis Trail
              </span>
              <p>{synthesis.evidence_synthesis}</p>
            </div>
          )}

          {/* LangGraph State Machine Execution Provenance */}
          {synthesis.langgraph_trace && synthesis.langgraph_trace.length > 0 && (
            <div className="p-3.5 bg-zinc-950/80 rounded-lg border border-indigo-900/40 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-indigo-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                  <Bot className="w-3.5 h-3.5 text-indigo-400" /> LangGraph StateMachine Node Trace
                </span>
                {synthesis.langgraph_interrupted && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Human Interrupt Checkpoint
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                {synthesis.langgraph_trace.map((node, i) => (
                  <React.Fragment key={i}>
                    <span className={`px-2 py-0.5 rounded border ${
                      node === "__interrupt__"
                        ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
                        : "bg-zinc-900 border-zinc-800 text-zinc-300"
                    }`}>
                      {node}
                    </span>
                    {i < (synthesis.langgraph_trace?.length ?? 0) - 1 && (
                      <span className="text-zinc-600">&rarr;</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        !running && (
          <div className="p-8 text-center space-y-3">
            <Bot className="w-8 h-8 text-zinc-600 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-300">No Deep Audit Completed Yet</p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Trigger an autonomous multi-stage investigation to analyze complex clauses, cross-reference policy guidelines, and uncover hidden document contradictions.
              </p>
            </div>
            <button
              onClick={handleStartDeepAudit}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg border border-zinc-700 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Start Investigation
            </button>
          </div>
        )
      )}
    </div>
  );
}

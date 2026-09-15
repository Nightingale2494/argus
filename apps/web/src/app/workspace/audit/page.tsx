"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { 
  ShieldCheck, RefreshCw, Filter, Search, Clock, 
  CheckCircle, XCircle, AlertCircle, ExternalLink, Database, Sparkles,
  Scale, UserCheck, ArrowUpRight
} from "lucide-react";
import { api } from "@/services/api";
import { AuditEventRead } from "@/services/types";
import { SessionRequired } from "@/components/ui/SessionRequired";
import { useAuth } from "@/hooks/useAuth";

export default function AuditPage() {
  const { isAuthenticated, isDemoPreview } = useAuth();
  const [events, setEvents] = useState<AuditEventRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [modeFilter, setModeFilter] = useState<"ALL" | "AUTHENTIC" | "DEMO">("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const loadAuditEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!isAuthenticated && !isDemoPreview) {
      setLoading(false);
      return;
    }

    try {
      const data = await api.getAuditEvents();
      setEvents(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load authoritative audit event log.");
    } finally {
      setLoading(false);
    }
  }, [isDemoPreview, isAuthenticated]);

  useEffect(() => {
    loadAuditEvents();
  }, [loadAuditEvents]);

  const filteredEvents = events.filter((ev) => {
    const evMode = ev.mode || (isDemoPreview ? "DEMO" : "AUTHENTIC");
    if (modeFilter !== "ALL" && evMode !== modeFilter) return false;
    if (categoryFilter !== "ALL" && ev.event_category !== categoryFilter) return false;
    if (stageFilter !== "ALL") {
      const evStage = ev.pipeline_stage || ev.stage;
      if (evStage !== stageFilter) return false;
    }
    if (statusFilter !== "ALL") {
      const s = (ev.status || "").toUpperCase();
      if (statusFilter === "SUCCESS" && s !== "SUCCESS" && s !== "COMPLETED") return false;
      if (statusFilter === "FAILED" && s !== "FAILED" && s !== "ERROR") return false;
      if (statusFilter === "RUNNING" && s !== "RUNNING") return false;
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const msgMatch = ev.message?.toLowerCase().includes(q);
      const stageMatch = (ev.pipeline_stage || ev.stage)?.toLowerCase().includes(q);
      const jobMatch = ev.job_id?.toLowerCase().includes(q);
      const actionMatch = ev.action?.toLowerCase().includes(q);
      const entityMatch = ev.entity_id?.toLowerCase().includes(q) || ev.entity_type?.toLowerCase().includes(q);
      const actorMatch = ev.actor?.toLowerCase().includes(q);
      const clauseMatch = ev.clause_reference?.toLowerCase().includes(q);
      if (!msgMatch && !stageMatch && !jobMatch && !actionMatch && !entityMatch && !actorMatch && !clauseMatch) return false;
    }
    return true;
  });

  const formatTimestamp = (ts?: string | null) => {
    if (!ts || ts === "—" || ts === "undefined" || ts === "null") return "Time unavailable";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return "Time unavailable";
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } catch {
      return "Time unavailable";
    }
  };

  const getModeBadge = (mode?: string, source?: string) => {
    const isDemo = mode === "DEMO";
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
          isDemo
            ? "bg-amber-950/60 text-amber-300 border-amber-800/60"
            : "bg-emerald-950/60 text-emerald-300 border-emerald-800/60"
        }`}
        title={`Source: ${source || (isDemo ? "DEMO_STORE / SYNTHETIC" : "BACKEND / DATABASE")}`}
      >
        {isDemo ? <Sparkles className="w-2.5 h-2.5 text-amber-400" /> : <Database className="w-2.5 h-2.5 text-emerald-400" />}
        {isDemo ? "DEMO" : "AUTHENTIC"}
      </span>
    );
  };

  const getCategoryBadge = (category?: string) => {
    switch (category) {
      case 'PROVIDER_HEALTH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60">PROVIDER</span>;
      case 'COMPLIANCE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">COMPLIANCE</span>;
      case 'PIPELINE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-950/80 text-blue-300 border border-blue-800/60">PIPELINE</span>;
      case 'HUMAN_DECISION':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">DECISION</span>;
      case 'TENDER':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60">TENDER</span>;
      case 'BIDDER':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">BIDDER</span>;
      case 'AUTH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800/60">AUTH</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">{category || 'EVENT'}</span>;
    }
  };

  const getStatusBadge = (status?: string | null) => {
    if (!status || status === "—") {
      return <span className="text-zinc-500 font-mono text-xs">—</span>;
    }
    switch (status) {
      case "COMPLETED":
      case "SUCCESS":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3 h-3" /> SUCCESS</span>;
      case "RUNNING":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"><Clock className="w-3 h-3 animate-spin" /> RUNNING</span>;
      case "FAILED":
      case "ERROR":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20"><XCircle className="w-3 h-3" /> FAILED</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">{status}</span>;
    }
  };

  if (!isAuthenticated && !isDemoPreview) {
    return (
      <SessionRequired
        title="Session Required"
        description="To inspect the immutable audit ledger and telemetry logs from the live FastAPI backend, connect an authorized Bearer token or explore in the Demo Workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
            Authoritative Audit Log
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Immutable pipeline event streams, OCR extractions, and verification telemetry.
          </p>
        </div>
        <button
          onClick={loadAuditEvents}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-colors border border-zinc-700"
        >
          <RefreshCw className="w-4 h-4" /> Refresh Audit Trail
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search audit events, clauses, or Job IDs..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-zinc-400" />
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as "ALL" | "AUTHENTIC" | "DEMO")}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="ALL">All Modes</option>
              <option value="AUTHENTIC">Authentic Mode</option>
              <option value="DEMO">Demo Preview</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="ALL">All Categories</option>
              <option value="COMPLIANCE">Compliance Engine</option>
              <option value="PIPELINE">Pipeline Execution</option>
              <option value="PROVIDER_HEALTH">Provider Health</option>
              <option value="TENDER">Tender Governance</option>
              <option value="BIDDER">Bidder Management</option>
              <option value="DOCUMENT">Document Lifecycle</option>
              <option value="HUMAN_DECISION">Human Decisions</option>
              <option value="AUTH">Authentication</option>
              <option value="SYSTEM">System</option>
            </select>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="ALL">All Stages</option>
              <option value="UPLOAD">UPLOAD</option>
              <option value="PARSING">PARSING</option>
              <option value="OCR">OCR</option>
              <option value="EXTRACTION">EXTRACTION</option>
              <option value="VERIFICATION">VERIFICATION</option>
              <option value="COMPLIANCE">COMPLIANCE</option>
              <option value="RISK_ANALYSIS">RISK_ANALYSIS</option>
              <option value="REPORTING">REPORTING</option>
              <option value="SYSTEM / PROVIDER">SYSTEM / PROVIDER</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS / COMPLETED</option>
              <option value="RUNNING">RUNNING</option>
              <option value="FAILED">FAILED / ERROR</option>
            </select>
          </div>
        </div>
        <div className="text-xs text-zinc-400">
          Showing <span className="font-semibold text-zinc-200">{filteredEvents.length}</span> events
        </div>
      </div>

      {/* Events Table */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            <p className="text-zinc-400 text-xs">Streaming audit telemetry...</p>
          </div>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="p-12 text-center rounded-xl bg-zinc-900/40 border border-zinc-800/80">
          <ShieldCheck className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-zinc-300">No Audit Events Logged</h3>
          <p className="text-sm text-zinc-500 mt-1">Actions performed across pipelines and reviews are streamed directly into this ledger.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-900/40">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-400 font-semibold bg-zinc-950/40">
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Mode</th>
                <th className="px-5 py-3">Category / Stage</th>
                <th className="px-5 py-3">Job ID</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Progress</th>
                <th className="px-5 py-3">Message & Action Traces</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredEvents.map((ev, i) => {
                const stageDisplay = ev.pipeline_stage || ev.stage;
                const payload = (ev.payload_json || {}) as Record<string, unknown>;
                const isClauseEval = ev.action === "CLAUSE_EVALUATED";
                const isDecision = ev.action === "HUMAN_DECISION_RECORDED";

                return (
                  <tr key={ev.id || i} className="hover:bg-zinc-800/30 transition-colors group">
                    <td className="px-5 py-3.5 font-mono text-xs text-zinc-400 whitespace-nowrap">
                      {formatTimestamp(ev.timestamp)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {getModeBadge(ev.mode, ev.source)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {getCategoryBadge(ev.event_category)}
                        {stageDisplay && String(stageDisplay) !== "—" ? (
                          <span className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                            {stageDisplay}
                          </span>
                        ) : (
                          <span className="text-zinc-500 font-mono text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-zinc-500 truncate max-w-[120px]" title={ev.job_id ?? undefined}>
                      {ev.job_id || "—"}
                    </td>
                    <td className="px-5 py-3.5">{getStatusBadge(ev.status)}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-blue-400">
                      {ev.progress != null ? `${ev.progress}%` : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-zinc-300">
                      {/* 1. Specialized Presentation: CLAUSE_EVALUATED */}
                      {isClauseEval ? (
                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-indigo-900/40 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono font-semibold text-zinc-200">
                              <Scale className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                              <span>{String(payload.clause_reference || ev.clause_reference || "Clause")}</span>
                              <span className="text-zinc-500 font-normal text-[11px]">
                                ({String(payload.field || "criterion")})
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                                payload.status === "PASS" || payload.status === "SATISFIED"
                                  ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                                  : payload.status === "FAIL" || payload.status === "FAILED"
                                  ? "bg-rose-950/80 text-rose-300 border-rose-800/60"
                                  : "bg-amber-950/80 text-amber-300 border-amber-800/60"
                              }`}
                            >
                              {String(payload.status || "EVALUATED")}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-zinc-400 grid grid-cols-1 sm:grid-cols-2 gap-1 bg-zinc-900/60 p-2 rounded border border-zinc-800/60">
                            <div>
                              <span className="text-zinc-500">Expected: </span>
                              <span className="text-zinc-300">{String(payload.operator || "=")} {String(payload.expected_value ?? "—")}</span>
                            </div>
                            <div>
                              <span className="text-zinc-500">Observed: </span>
                              <span className="text-zinc-200 font-semibold">{String(payload.observed_value ?? "—")}</span>
                            </div>
                          </div>
                          {ev.target_url && (
                            <div className="pt-1 flex justify-end">
                              <Link
                                href={ev.target_url}
                                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-mono transition-colors"
                              >
                                <span>Inspect Rule in Matrix</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </Link>
                            </div>
                          )}
                        </div>
                      ) : isDecision ? (
                        /* 2. Specialized Presentation: HUMAN_DECISION_RECORDED */
                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-emerald-900/40 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 font-mono font-semibold text-zinc-200">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              <span>Decision: {String(payload.officer_decision || payload.status || "DETERMINED")}</span>
                              {payload.decision_type === "OVERRIDE" && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800/60">
                                  OVERRIDE
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-zinc-400">
                              By: {String(payload.officer_name || ev.actor || "Officer")}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-300 bg-zinc-900/60 p-2 rounded border border-zinc-800/60">
                            <span className="text-zinc-500 font-mono">Remarks: </span>
                            <span>{String(payload.remarks || "No remarks provided.")}</span>
                          </div>
                          {ev.target_url && (
                            <div className="pt-1 flex justify-end">
                              <Link
                                href={ev.target_url}
                                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-mono transition-colors"
                              >
                                <span>Open Human Review</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </Link>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* 3. General Event Presentation with Target Navigation */
                        <div>
                          <div>{ev.message || "—"}</div>
                          {(ev.action || ev.entity_type) && (
                            <div className="text-[11px] font-mono text-zinc-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {ev.action && <span className="text-zinc-400">{ev.action}</span>}
                              {ev.entity_type && <span>• {ev.entity_type}:{ev.entity_id}</span>}
                              {ev.actor && <span>• actor:{ev.actor}</span>}
                              {ev.target_url && (
                                <Link
                                  href={ev.target_url}
                                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors ml-1"
                                >
                                  <span>View Resource</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

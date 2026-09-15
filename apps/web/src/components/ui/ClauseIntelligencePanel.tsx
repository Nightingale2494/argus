"use client";

import React, { useState } from "react";
import { Search, Sparkles, BookOpen, AlertCircle, FileText, Info } from "lucide-react";
import { api } from "@/services/api";
import type { RAGExplainResponse } from "@/services/types";

interface ClauseIntelligencePanelProps {
  tenderId: string;
  isDemo?: boolean;
}

const QUICK_QUERIES = [
  "Is MSME turnover exemption applicable to this tender?",
  "What are the minimum past experience thresholds?",
  "What are the EMD and bid security requirements?",
  "Are joint ventures or consortia eligible to bid?",
];

export function ClauseIntelligencePanel({ tenderId, isDemo = false }: ClauseIntelligencePanelProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RAGExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;
    setLoading(true);
    setError(null);

    try {
      const resp = await api.explainRAG({
        query: q,
        tender_id: tenderId,
        top_k: 5,
      });
      setResult(resp);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to query policy intelligence";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  return (
    <div className="space-y-6">
      {/* Advisory Header Banner */}
      <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 text-purple-300 flex items-start gap-3">
        <Info className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-purple-200">
            Advisory Retrieval-Augmented Generation (RAG) Intelligence
          </p>
          <p className="text-purple-300/90 leading-relaxed">
            This module retrieves supporting tender document clauses, addenda, and statutory procurement guidelines (GFR 2017, CVC, MSME orders) strictly scoped to this tender.
            <span className="font-semibold text-purple-200"> Invariant: </span>
            RAG context is strictly advisory and can <span className="underline">never</span> override or mutate deterministic compliance rules or officer procurement decisions.
          </p>
        </div>
      </div>

      {/* Query Bar */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-5 space-y-4">
        <form onSubmit={onSubmit} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a policy, clause, or exemption question about this tender..."
              className="w-full pl-11 pr-4 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/70"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? "Searching..." : "Analyze"}
          </button>
        </form>

        {/* Quick Question Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-zinc-500 font-medium mr-1">Suggested inquiries:</span>
          {QUICK_QUERIES.map((q, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setQuery(q);
                handleSearch(q);
              }}
              className="text-xs px-3 py-1 rounded-full bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border border-zinc-700/50 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search Results */}
      {result && (
        <div className="space-y-5">
          {/* No Answer / Insufficient Evidence State */}
          {result.result_class === "INSUFFICIENT_RETRIEVAL_EVIDENCE" && (
            <div className="p-5 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-200 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Insufficient Retrieval Evidence</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-900/60 text-amber-300 border border-amber-700/50">
                  NO DIRECT CLAUSE FOUND
                </span>
              </div>
              <p className="text-sm text-amber-300/90 leading-relaxed">
                {result.direct_answer || "ARGUS could not find an indexed clause that directly answers this question."}
              </p>
              <p className="text-xs text-amber-400/70 pt-1">
                Recommendation: Verify if the requested requirement is specified in a non-indexed annexure, addendum, or general statutory procurement guidelines.
              </p>
            </div>
          )}

          {/* Direct Answer Card */}
          {result.result_class !== "INSUFFICIENT_RETRIEVAL_EVIDENCE" && (
            <div className="p-5 rounded-xl bg-zinc-900/70 border border-purple-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-semibold text-zinc-200">Direct Clause Answer</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800/60 font-semibold">
                    DIRECT EVIDENCE
                  </span>
                  <span className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                    isDemo
                      ? "bg-amber-950/80 text-amber-300 border-amber-800/60"
                      : "bg-purple-950 text-purple-300 border border-purple-800/50"
                  }`}>
                    {isDemo ? "SYNTHETIC POLICY CONTEXT • DEMO ONLY" : "ADVISORY CONTEXT ONLY"}
                  </span>
                </div>
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed font-normal">
                {result.direct_answer || result.explanation}
              </p>
              <p className="text-[11px] text-zinc-500 italic pt-2 border-t border-zinc-800/60">
                {result.advisory_disclaimer}
              </p>
            </div>
          )}

          {/* Related Context Card */}
          {result.related_context && (
            <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-zinc-300 font-medium text-xs">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  <span>Related Policy Context (Supplementary)</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                  SUPPLEMENTARY
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {result.related_context}
              </p>
            </div>
          )}

          {/* Direct Citations List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Direct Cited Clauses ({result.citations.length})
              </h4>
              <span className="text-[11px] text-zinc-500">Sorted by relevance score</span>
            </div>

            {result.citations.length === 0 ? (
              <div className="p-6 text-center text-sm text-zinc-500 bg-zinc-900/30 rounded-xl border border-zinc-800/40">
                No direct clause excerpts qualified above the relevance threshold for this query.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.citations.map((cite, i) => {
                  const meta = (cite.location_metadata || {}) as Record<string, unknown>;
                  const relScore = typeof meta.relevance_score === 'number' ? meta.relevance_score : null;
                  const relLabel = relScore !== null
                    ? relScore >= 0.75
                      ? `Relevance: High (${relScore.toFixed(2)})`
                      : `Relevance: Moderate (${relScore.toFixed(2)})`
                    : null;

                  return (
                    <div
                      key={cite.id || i}
                      className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 transition-colors space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
                          <FileText className="w-3.5 h-3.5 text-blue-400" />
                          <span>{String(meta.title || `Citation [${i + 1}]`)}</span>
                        </div>
                        {relLabel && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-purple-300 border border-purple-900/50 font-semibold">
                            {relLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        {cite.page_number && <span>Page {cite.page_number}</span>}
                        {Boolean(meta.clause_reference) && <span>• {String(meta.clause_reference)}</span>}
                        <span>• ID: {cite.entity_id}</span>
                      </div>

                      <blockquote className="text-zinc-300 bg-zinc-950/50 p-2.5 rounded border border-zinc-800/50 font-mono text-[11px] leading-relaxed">
                        &ldquo;{cite.snippet}&rdquo;
                      </blockquote>

                      {Boolean(meta.match_rationale) && (
                        <p className="text-[10px] text-zinc-500 italic">
                          Match: {String(meta.match_rationale)}
                        </p>
                      )}

                      {Boolean(meta.synthetic) && (
                        <div className="pt-1">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-950/60 text-amber-400 border border-amber-800/50">
                            SYNTHETIC POLICY CONTEXT • DEMO ONLY
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Related Citations List (if any) */}
          {result.related_citations && result.related_citations.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Related Context Citations ({result.related_citations.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.related_citations.map((cite, i) => {
                  const meta = (cite.location_metadata || {}) as Record<string, unknown>;
                  const relScore = typeof meta.relevance_score === 'number' ? meta.relevance_score : null;

                  return (
                    <div
                      key={cite.id || `rel-${i}`}
                      className="p-3.5 rounded-xl bg-zinc-900/20 border border-zinc-800/60 space-y-2 text-xs opacity-90"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400 font-medium">{String(meta.title || `Related Context [${i + 1}]`)}</span>
                        {relScore !== null && (
                          <span className="text-[10px] font-mono text-zinc-500">
                            Relevance: {relScore.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <blockquote className="text-zinc-400 bg-zinc-950/30 p-2 rounded border border-zinc-850 font-mono text-[11px] leading-relaxed">
                        &ldquo;{cite.snippet}&rdquo;
                      </blockquote>
                      {Boolean(meta.synthetic) && (
                        <span className="text-[9px] font-mono text-amber-500/80">
                          SYNTHETIC POLICY CONTEXT • DEMO ONLY
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

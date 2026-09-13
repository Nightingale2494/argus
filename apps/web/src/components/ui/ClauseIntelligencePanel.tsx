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
  "What are the EMD and bid security requirements?",
  "What are the minimum past experience thresholds?",
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
      if (isDemo) {
        // Pure synthetic client-side response — zero backend network calls
        await new Promise((r) => setTimeout(r, 400));
        const syntheticRes: RAGExplainResponse = {
          query: q,
          explanation: q.toLowerCase().includes("msme")
            ? "[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Advisory Policy Intelligence: In simulated demo mode, policy fixtures indicate that Udyam-registered Micro & Small Enterprises may qualify for exemption from prior turnover requirements. In live authentic mode, exact clauses and precedents are retrieved directly from the uploaded tender RFP and verified gazette rules."
            : `[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Advisory Policy Intelligence: Retrieved simulated policy excerpts matching '${q}'. In live authentic mode, citations are retrieved strictly from parsed tender RFP text.`,
          citations: [
            {
              id: "ev-rag-demo-1",
              entity_type: "document_chunk",
              entity_id: "tender-doc-rfp",
              snippet: "Clause 4.2: Exemption from prior experience and turnover criteria shall be granted to Micro & Small Enterprises (MSEs) registered with Udyam, as per GFR 2017.",
              page_number: 7,
              source_uri: "storage://tenders/rfp_document.pdf",
              location_metadata: null,
              created_at: new Date().toISOString(),
            },
            {
              id: "ev-rag-demo-2",
              entity_type: "document_chunk",
              entity_id: "policy-gfr-153",
              snippet: "GFR Rule 153: In procurement of Goods and Services, where technical competency is established, procuring entities may relax condition of prior turnover and experience for MSEs.",
              page_number: 1,
              source_uri: "public://policy/gfr_rule_153.pdf",
              location_metadata: null,
              created_at: new Date().toISOString(),
            },
          ],
          is_advisory: true,
          advisory_disclaimer: "This explanation is purely advisory context generated from retrieved policy clauses. It does NOT decide qualification or override deterministic compliance rules.",
          retrieved_at: new Date().toISOString(),
        };
        setResult(syntheticRes);
      } else {
        const resp = await api.explainRAG({
          query: q,
          tender_id: tenderId,
          top_k: 5,
        });
        setResult(resp);
      }
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
        <div className="space-y-4">
          {/* Explanation Card */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-purple-800/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Advisory Clause Synthesis</h3>
              </div>
              <span className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                isDemo
                  ? "bg-amber-950/80 text-amber-300 border-amber-800/60"
                  : "bg-purple-950 text-purple-300 border border-purple-800/50"
              }`}>
                {isDemo ? "SYNTHETIC POLICY CONTEXT • DEMO ONLY" : "ADVISORY CONTEXT ONLY"}
              </span>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {result.explanation}
            </p>
            <p className="text-[11px] text-zinc-500 italic pt-1 border-t border-zinc-800/60">
              {result.advisory_disclaimer}
            </p>
          </div>

          {/* Citations List */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Cited Document Chunks ({result.citations.length})
            </h4>
            {result.citations.length === 0 ? (
              <div className="p-6 text-center text-sm text-zinc-500 bg-zinc-900/30 rounded-xl border border-zinc-800/40">
                No matching excerpts indexed for this query.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.citations.map((cite, i) => (
                  <div
                    key={cite.id || i}
                    className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 transition-colors space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span>Citation [{i + 1}]</span>
                        {cite.page_number && (
                          <span className="text-zinc-500">• Page {cite.page_number}</span>
                        )}
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                        {cite.entity_type}
                      </span>
                    </div>
                    <blockquote className="text-zinc-300 bg-zinc-950/50 p-2.5 rounded border border-zinc-800/50 font-mono text-[11px] leading-relaxed">
                      &ldquo;{cite.snippet}&rdquo;
                    </blockquote>
                    {cite.source_uri && (
                      <p className="text-[10px] text-zinc-500 truncate">
                        Source: {cite.source_uri}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

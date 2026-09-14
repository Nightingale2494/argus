"use client";

import React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, FileSearch, ShieldCheck } from "lucide-react";
import { demoStore } from "@/services/demo-store";
import { useAuth } from "@/hooks/useAuth";
import { DeepAuditInvestigationWorkspace } from "@/components/ui/DeepAuditInvestigationWorkspace";
import { SessionRequired } from "@/components/ui/SessionRequired";

export default function DeepAuditPage() {
  const params = useParams();
  const bidderId = params?.bidderId as string;
  const { isAuthenticated, isDemoPreview } = useAuth();

  const storedDemoBidder = bidderId ? demoStore.getBidder(bidderId) : null;
  const isDemo = isDemoPreview || Boolean(storedDemoBidder);

  const querySuffix = isDemo ? "?mode=demo" : "";

  if (!isDemo && !isAuthenticated) {
    return (
      <SessionRequired
        title="Session Required"
        description="To access Deep Audit investigation findings and cross-document reconciliation, connect an authorized Bearer token or explore in the Demo Workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb Header */}
      <div>
        <Link
          href={`/workspace/bidders/${bidderId}${querySuffix}`}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Bidder Evaluation
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
              <FileSearch className="w-6 h-6 text-indigo-400" />
              Deep Audit Investigation
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Autonomous advisory investigation layer uncovering cross-document conflicts, missing evidence, and statutory gaps.
            </p>
          </div>
        </div>
      </div>

      {/* Bidder Sub-Navigation Tabs (Uniform 4-tab bar) */}
      <div className="border-b border-zinc-800 flex gap-4 text-xs font-mono">
        <Link
          href={`/workspace/bidders/${bidderId}/matrix${querySuffix}`}
          className="pb-2.5 font-medium border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
        >
          <FileText className="w-3.5 h-3.5" /> Compliance Matrix
        </Link>
        <Link
          href={`/workspace/bidders/${bidderId}/deep-audit${querySuffix}`}
          className="pb-2.5 font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-1.5"
        >
          <FileSearch className="w-3.5 h-3.5" /> Deep Audit
        </Link>
        <Link
          href={`/workspace/bidders/${bidderId}/review${querySuffix}`}
          className="pb-2.5 font-medium border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Human Officer Review
        </Link>
        <Link
          href={`/workspace/bidders/${bidderId}/report${querySuffix}`}
          className="pb-2.5 font-medium border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
        >
          Audit Report
        </Link>
      </div>

      {/* Main Autonomous Investigation Workspace */}
      <DeepAuditInvestigationWorkspace
        bidderId={bidderId}
        bidderName={storedDemoBidder?.bidder_name}
        tenderId={storedDemoBidder?.tender_id}
        isDemo={isDemo}
      />
    </div>
  );
}

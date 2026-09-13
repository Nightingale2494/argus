/**
 * Re-export and alias domain models for UI components.
 * Strict TypeScript: zero 'any'.
 */
export * from '@/types/api';

import type {
  TenderRequirementRead,
  TenderRequirementCreate,
  IntegrationsHealthResponse,
  JobStage,
  JobStatus,
  EvidenceRead,
} from '@/types/api';

export type RequirementRead = TenderRequirementRead;
export type RequirementCreate = TenderRequirementCreate;
export type HealthRead = { status: string };
export type IntegrationHealthRead = IntegrationsHealthResponse;

export interface RawAuditEvent {
  id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  actor_id?: string;
  actor_role?: string;
  payload_json?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  job_id?: string;
  stage?: JobStage | string;
  status?: JobStatus | string;
  progress?: number;
  message?: string;
  timestamp?: string;
  created_at?: string;
  tender_id?: string | null;
  bidder_id?: string | null;
  run_id?: string | null;
  requirement_id?: string | null;
  clause_reference?: string | null;
  target_url?: string | null;
  mode?: 'AUTHENTIC' | 'DEMO';
  source?: 'BACKEND / DATABASE' | 'DEMO_STORE / SYNTHETIC';
}

export type AuditEventCategory =
  | 'PIPELINE'
  | 'PROVIDER_HEALTH'
  | 'AUTH'
  | 'DOCUMENT'
  | 'TENDER'
  | 'BIDDER'
  | 'COMPLIANCE'
  | 'HUMAN_DECISION'
  | 'SYSTEM'
  | 'OTHER';

export interface AuditEventRead {
  id?: string;
  job_id?: string | null;
  stage?: JobStage | string | null;
  status?: JobStatus | string | null;
  progress?: number | null;
  message?: string | null;
  timestamp?: string | null;
  event_category?: AuditEventCategory;
  pipeline_stage?: string | null;
  action?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  actor?: string | null;
  mode?: 'AUTHENTIC' | 'DEMO';
  source?: 'BACKEND / DATABASE' | 'DEMO_STORE / SYNTHETIC';
  target_url?: string | null;
  tender_id?: string | null;
  bidder_id?: string | null;
  run_id?: string | null;
  requirement_id?: string | null;
  clause_reference?: string | null;
  payload_json?: Record<string, unknown> | null;
}

export interface RAGExplainRequest {
  query: string;
  tender_id?: string | null;
  clause?: string | null;
  field?: string | null;
  top_k?: number;
}

export interface RAGExplainResponse {
  query: string;
  explanation: string;
  citations: EvidenceRead[];
  is_advisory: boolean;
  advisory_disclaimer: string;
  retrieved_at: string;
  error_code?: string | null;
  error_message?: string | null;
}

export interface DeepAuditConflict {
  clause_reference: string;
  conflict_type: string;
  description: string;
  severity: 'CRITICAL' | 'WARNING' | 'ADVISORY' | string;
}

export interface DeepAuditPrecedent {
  clause_reference: string;
  precedent_id: string;
  source: string;
  similarity_score?: number;
  ruling_summary: string;
}

export interface DeepAuditSynthesis {
  summary: string;
  conflicts_detected: DeepAuditConflict[];
  policy_precedents: DeepAuditPrecedent[];
  evidence_synthesis: string;
  recommended_human_inquiries: string[];
  disclaimer: string;
  is_advisory: boolean;
  langgraph_trace?: string[];
  langgraph_interrupted?: boolean;
  langgraph_reasons?: string[];
}

export interface DeepAuditStatusResponse {
  status: 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | string;
  stage?: string | null;
  progress?: number;
  job_id?: string | null;
  completed_at?: string | null;
  synthesis?: DeepAuditSynthesis | null;
}


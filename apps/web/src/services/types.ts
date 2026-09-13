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


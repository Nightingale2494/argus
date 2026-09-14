/**
 * Centralized, Persistent Synthetic Demo Store for ARGUS.
 * Handles localStorage persistence, per-tender data isolation, synthetic pipeline execution,
 * and deterministic demo data reset without touching production backend architecture.
 */
import type {
  TenderRead,
  TenderCreate,
  TenderRequirementRead,
  BidderRead,
  BidderCreate,
  ComplianceMatrixRead,
  ComplianceMatrixRow,
  ReportRead,
  VerificationResultRead,
  HumanDecisionStatus,
  JobRead,
  JobEventRead,
  JobStage,
  JobStatus,
  DocumentRead,
  FactRead,
} from '@/types/api';
import type { AuditEventRead, DeepAuditSynthesis, RAGExplainResponse } from '@/services/types';
import { parsePdfText, extractBidderFacts, inferDocumentType, computeSha256 } from './pdf-parser';
import { queryDemoRAG } from './demo-rag';

export interface DemoAttachedFile {
  filename: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: string;
}

export interface DemoTender extends TenderRead {
  attached_file?: DemoAttachedFile | null;
}

export interface DemoBidderDocument extends DocumentRead {
  status?: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  facts_count?: number;
  extracted_facts?: FactRead[];
  is_scanned?: boolean;
  ocr_used?: boolean;
  ocr_engine?: string;
  mismatches?: Array<{
    field: string;
    existing_value: string;
    extracted_value: string;
  }>;
}

export interface UploadBidderDocumentResult {
  document: DemoBidderDocument;
  extractedFacts: FactRead[];
  enrichedCount: number;
  mismatches: Array<{
    field: string;
    existing_value: string;
    extracted_value: string;
  }>;
  factsCount: number;
}

export interface DemoState {
  version?: number;
  tenders: DemoTender[];
  requirements: Record<string, TenderRequirementRead[]>; // tender_id -> requirements
  bidders: Record<string, BidderRead[]>; // tender_id -> bidders
  complianceMatrices: Record<string, ComplianceMatrixRead>; // bidder_id -> matrix
  verifications: Record<string, VerificationResultRead[]>; // bidder_id -> verifications
  humanDecisions: Record<string, HumanDecisionStatus>; // bidder_id -> decision
  auditEvents: AuditEventRead[];
  jobs: Record<string, JobRead>; // job_id -> job
  bidderDocuments?: Record<string, DemoBidderDocument[]>; // bidder_id -> documents
  extractedFacts?: Record<string, FactRead[]>; // bidder_id -> facts
  complianceStale?: Record<string, boolean>; // bidder_id -> stale flag
  deepAuditSyntheses?: Record<string, DeepAuditSynthesis>; // bidder_id -> synthesis
}

const DEMO_STORAGE_KEY = 'argus_demo_store_v1';
const CURRENT_DEMO_VERSION = 2;

// ---------------------------------------------------------------------------
// CANONICAL DEFAULT DEMO SCENARIOS
// ---------------------------------------------------------------------------

const DEFAULT_DEMO_STATE: DemoState = {
  version: CURRENT_DEMO_VERSION,
  tenders: [
    {
      id: 'tender_gem_2026_01',
      tender_number: 'GEM/2026/B/4521089',
      title: 'Comprehensive Highway Surveillance & IT Infrastructure Modernization',
      category: 'GOODS_AND_SERVICES',
      authority: 'National Highways Authority of India',
      budget: 50000000,
      deadline: '2026-10-15T18:00:00Z',
      status: 'COMPLETED',
      created_at: '2026-08-01T10:00:00Z',
      updated_at: '2026-08-01T10:00:00Z',
      attached_file: {
        filename: 'highway_surveillance_rfp_2026.pdf',
        size_bytes: 1245000,
        content_type: 'application/pdf',
        uploaded_at: '2026-08-01T10:01:00Z',
      },
    },
    {
      id: 'tender_gem_2026_02',
      tender_number: 'GEM/2026/B/4521090',
      title: 'National Digital Identity Verification & Cloud Backup Cluster',
      category: 'IT_INFRASTRUCTURE',
      authority: 'Ministry of Electronics & Information Technology',
      budget: 120000000,
      deadline: '2026-11-01T17:00:00Z',
      status: 'COMPLETED',
      created_at: '2026-08-10T11:30:00Z',
      updated_at: '2026-08-10T11:30:00Z',
      attached_file: {
        filename: 'meity_cloud_cluster_rfp.pdf',
        size_bytes: 2410000,
        content_type: 'application/pdf',
        uploaded_at: '2026-08-10T11:31:00Z',
      },
    },
    {
      id: 'tender_gem_2026_03',
      tender_number: 'GEM/2026/B/4521091',
      title: 'Smart Solar Grid Micro-Inverter Deployment (Phase IV)',
      category: 'RENEWABLE_ENERGY',
      authority: 'Solar Energy Corporation of India',
      budget: 85000000,
      deadline: '2026-12-01T12:00:00Z',
      status: 'REVIEW_REQUIRED',
      created_at: '2026-08-20T09:15:00Z',
      updated_at: '2026-08-20T09:15:00Z',
      attached_file: {
        filename: 'seci_solar_grid_rfp.pdf',
        size_bytes: 3150000,
        content_type: 'application/pdf',
        uploaded_at: '2026-08-20T09:16:00Z',
      },
    },
  ],
  requirements: {
    tender_gem_2026_01: [
      {
        id: 'req_01',
        tender_id: 'tender_gem_2026_01',
        clause: 'Clause 4.1.1',
        requirement_type: 'GST',
        field: 'tax.gstin',
        operator: 'EQ',
        expected_value: 'VALID_ACTIVE',
        unit: null,
        mandatory: true,
        source_page: 4,
        source_text: 'Bidder must possess a valid, active GSTIN registration in India.',
        confidence: 0.98,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-01T10:05:00Z',
      },
      {
        id: 'req_02',
        tender_id: 'tender_gem_2026_01',
        clause: 'Clause 4.2.3',
        requirement_type: 'TURNOVER',
        field: 'financial.average_annual_turnover',
        operator: 'GTE',
        expected_value: 50000000,
        unit: 'INR',
        mandatory: true,
        source_page: 5,
        source_text: 'Minimum average annual turnover shall be INR 5,00,00,000 for the last 3 financial years.',
        confidence: 0.95,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-01T10:05:00Z',
      },
      {
        id: 'req_03',
        tender_id: 'tender_gem_2026_01',
        clause: 'Clause 4.3.1',
        requirement_type: 'EXPERIENCE',
        field: 'experience.years',
        operator: 'GTE',
        expected_value: 3,
        unit: 'YEARS',
        mandatory: true,
        source_page: 7,
        source_text: 'Bidder must have at least 3 years of continuous operating experience in IT infrastructure.',
        confidence: 0.92,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-01T10:05:00Z',
      },
    ],
    tender_gem_2026_02: [
      {
        id: 'req_b01',
        tender_id: 'tender_gem_2026_02',
        clause: 'Clause 3.1.2',
        requirement_type: 'GST',
        field: 'tax.gstin',
        operator: 'EQ',
        expected_value: 'VALID_ACTIVE',
        unit: null,
        mandatory: true,
        source_page: 3,
        source_text: 'Bidder must be registered under GST Act.',
        confidence: 0.99,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-10T11:35:00Z',
      },
      {
        id: 'req_b02',
        tender_id: 'tender_gem_2026_02',
        clause: 'Clause 3.2.1',
        requirement_type: 'TURNOVER',
        field: 'financial.average_annual_turnover',
        operator: 'GTE',
        expected_value: 120000000,
        unit: 'INR',
        mandatory: true,
        source_page: 6,
        source_text: 'Minimum annual turnover must exceed INR 12,00,00,000.',
        confidence: 0.96,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-10T11:35:00Z',
      },
      {
        id: 'req_b03',
        tender_id: 'tender_gem_2026_02',
        clause: 'Clause 3.3.4',
        requirement_type: 'EXPERIENCE',
        field: 'experience.years',
        operator: 'GTE',
        expected_value: 5,
        unit: 'YEARS',
        mandatory: true,
        source_page: 9,
        source_text: 'At least 5 years operating cloud data centers in India.',
        confidence: 0.94,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-10T11:35:00Z',
      },
    ],
    tender_gem_2026_03: [
      {
        id: 'req_c01',
        tender_id: 'tender_gem_2026_03',
        clause: 'Clause 2.1',
        requirement_type: 'GST',
        field: 'tax.gstin',
        operator: 'EQ',
        expected_value: 'VALID_ACTIVE',
        unit: null,
        mandatory: true,
        source_page: 2,
        source_text: 'Valid GSTIN required.',
        confidence: 0.97,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-20T09:20:00Z',
      },
      {
        id: 'req_c02',
        tender_id: 'tender_gem_2026_03',
        clause: 'Clause 2.4',
        requirement_type: 'TURNOVER',
        field: 'financial.average_annual_turnover',
        operator: 'GTE',
        expected_value: 85000000,
        unit: 'INR',
        mandatory: true,
        source_page: 4,
        source_text: 'Annual turnover of INR 8.5 Crores or higher.',
        confidence: 0.93,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: '2026-08-20T09:20:00Z',
      },
      {
        id: 'req_c03',
        tender_id: 'tender_gem_2026_03',
        clause: 'Clause 5.2',
        requirement_type: 'CUSTOM',
        field: 'credentials.oem_authorization',
        operator: 'EXISTS',
        expected_value: 'VALID_OEM_LETTER',
        unit: null,
        mandatory: true,
        source_page: 11,
        source_text: 'Original Equipment Manufacturer (OEM) authorization certificate required.',
        confidence: 0.82,
        requires_verification: true,
        is_approved: false,
        metadata_json: {},
        created_at: '2026-08-20T09:20:00Z',
      },
    ],
  },
  bidders: {
    tender_gem_2026_01: [
      {
        id: 'bidder_alpha_01',
        tender_id: 'tender_gem_2026_01',
        bidder_name: 'Alpha Infotech Private Limited',
        gstin: '07AABCA1234H1Z9',
        pan: 'AABCA1234H',
        udyam_number: 'UDYAM-DL-01-0012345',
        cin: 'U72200DL2018PTC123456',
        status: 'QUALIFIED',
        metadata_json: {},
        created_at: '2026-08-15T14:20:00Z',
        documents: [
          {
            id: 'doc_alpha_gst',
            tender_id: 'tender_gem_2026_01',
            bidder_id: 'bidder_alpha_01',
            filename: 'gst_certificate.pdf',
            storage_uri: 'data/uploads/gst_alpha.pdf',
            sha256: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
            document_type: 'GST_CERT',
            content_type: 'application/pdf',
            size_bytes: 452100,
            created_at: '2026-08-15T14:21:00Z',
          },
          {
            id: 'doc_alpha_turnover',
            tender_id: 'tender_gem_2026_01',
            bidder_id: 'bidder_alpha_01',
            filename: 'ca_turnover_certificate.pdf',
            storage_uri: 'data/uploads/turnover_alpha.pdf',
            sha256: 'b2c3d4e5f6a178901234567890abcdef1234567890abcdef1234567890abcdef',
            document_type: 'FINANCIAL_STATEMENT',
            content_type: 'application/pdf',
            size_bytes: 812400,
            created_at: '2026-08-15T14:22:00Z',
          },
        ],
      },
    ],
    tender_gem_2026_02: [
      {
        id: 'bidder_crest_02',
        tender_id: 'tender_gem_2026_02',
        bidder_name: 'Crest Enterprises',
        gstin: '33AABCC9999P1Z1',
        pan: 'AABCC9999P',
        udyam_number: null,
        cin: null,
        status: 'DISQUALIFIED',
        metadata_json: {},
        created_at: '2026-08-17T11:45:00Z',
        documents: [],
      },
    ],
    tender_gem_2026_03: [
      {
        id: 'bidder_bharat_03',
        tender_id: 'tender_gem_2026_03',
        bidder_name: 'Bharat Tech Solutions LLP',
        gstin: '27AAGCB5678K1Z3',
        pan: 'AAGCB5678K',
        udyam_number: 'UDYAM-MH-02-0054321',
        cin: null,
        status: 'PENDING',
        metadata_json: {},
        created_at: '2026-08-16T10:10:00Z',
        documents: [
          {
            id: 'doc_bharat_balance_sheet',
            tender_id: 'tender_gem_2026_03',
            bidder_id: 'bidder_bharat_03',
            filename: 'audited_balance_sheet_fy25.pdf',
            storage_uri: 'data/uploads/audited_balance_sheet_fy25.pdf',
            sha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
            document_type: 'FINANCIAL_STATEMENT',
            content_type: 'application/pdf',
            size_bytes: 284000,
            created_at: '2026-08-16T10:15:00Z',
          },
          {
            id: 'doc_bharat_financial_summary',
            tender_id: 'tender_gem_2026_03',
            bidder_id: 'bidder_bharat_03',
            filename: 'unaudited_financial_summary.pdf',
            storage_uri: 'data/uploads/unaudited_financial_summary.pdf',
            sha256: 'b2c3d4e5f6a17890123456789abcdef0123456789abcdef0123456789abcdef1',
            document_type: 'FINANCIAL_STATEMENT',
            content_type: 'application/pdf',
            size_bytes: 142000,
            created_at: '2026-08-16T10:16:00Z',
          },
          {
            id: 'doc_bharat_dist_letter',
            tender_id: 'tender_gem_2026_03',
            bidder_id: 'bidder_bharat_03',
            filename: 'SolarDist_Distributor_Letter.pdf',
            storage_uri: 'data/uploads/SolarDist_Distributor_Letter.pdf',
            sha256: 'c3d4e5f6a1b27890123456789abcdef0123456789abcdef0123456789abcdef2',
            document_type: 'OEM_AUTHORIZATION',
            content_type: 'application/pdf',
            size_bytes: 98000,
            created_at: '2026-08-16T10:17:00Z',
          },
        ],
      },
    ],
  },
  complianceMatrices: {
    bidder_alpha_01: {
      bidder_id: 'bidder_alpha_01',
      tender_id: 'tender_gem_2026_01',
      overall_status: 'PASS',
      run_id: 'run_eval_2026_001',
      historical_limitations_notice: 'Evaluated under deterministic synthetic rules with immutable provenance.',
      rows: [
        {
          requirement_id: 'req_01',
          clause: 'Clause 4.1.1',
          requirement_type: 'GST',
          field: 'tax.gstin',
          operator: 'EQ',
          expected_value: 'VALID_ACTIVE',
          observed_value: 'VALID_ACTIVE',
          status: 'PASS',
          reason_code: 'EXACT_MATCH',
          evidence_ids: ['ev_gst_01'],
          review_required: false,
        },
        {
          requirement_id: 'req_02',
          clause: 'Clause 4.2.3',
          requirement_type: 'TURNOVER',
          field: 'financial.average_annual_turnover',
          operator: 'GTE',
          expected_value: 50000000,
          observed_value: 65000000,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          evidence_ids: ['ev_to_01'],
          review_required: false,
        },
        {
          requirement_id: 'req_03',
          clause: 'Clause 4.3.1',
          requirement_type: 'EXPERIENCE',
          field: 'experience.years',
          operator: 'GTE',
          expected_value: 3,
          observed_value: 5,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          evidence_ids: ['ev_exp_01'],
          review_required: false,
        },
      ],
    },
    bidder_crest_02: {
      bidder_id: 'bidder_crest_02',
      tender_id: 'tender_gem_2026_02',
      overall_status: 'FAIL',
      run_id: 'run_eval_2026_002',
      historical_limitations_notice: 'Mandatory financial turnover threshold not satisfied.',
      rows: [
        {
          requirement_id: 'req_b01',
          clause: 'Clause 3.1.2',
          requirement_type: 'GST',
          field: 'tax.gstin',
          operator: 'EQ',
          expected_value: 'VALID_ACTIVE',
          observed_value: 'VALID_ACTIVE',
          status: 'PASS',
          reason_code: 'EXACT_MATCH',
          evidence_ids: ['ev_gst_b01'],
          review_required: false,
        },
        {
          requirement_id: 'req_b02',
          clause: 'Clause 3.2.1',
          requirement_type: 'TURNOVER',
          field: 'financial.average_annual_turnover',
          operator: 'GTE',
          expected_value: 120000000,
          observed_value: 80000000,
          status: 'FAIL',
          reason_code: 'NUMERIC_LT_THRESHOLD',
          evidence_ids: ['ev_to_b02'],
          review_required: false,
        },
        {
          requirement_id: 'req_b03',
          clause: 'Clause 3.3.4',
          requirement_type: 'EXPERIENCE',
          field: 'experience.years',
          operator: 'GTE',
          expected_value: 5,
          observed_value: 6,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          evidence_ids: ['ev_exp_b03'],
          review_required: false,
        },
      ],
    },
    bidder_bharat_03: {
      bidder_id: 'bidder_bharat_03',
      tender_id: 'tender_gem_2026_03',
      overall_status: 'REVIEW_REQUIRED',
      run_id: 'run_eval_2026_003',
      historical_limitations_notice: 'Manual procurement officer validation required for OEM accreditation.',
      rows: [
        {
          requirement_id: 'req_c01',
          clause: 'Clause 2.1',
          requirement_type: 'GST',
          field: 'tax.gstin',
          operator: 'EQ',
          expected_value: 'VALID_ACTIVE',
          observed_value: 'VALID_ACTIVE',
          status: 'PASS',
          reason_code: 'EXACT_MATCH',
          evidence_ids: ['ev_gst_c01'],
          review_required: false,
        },
        {
          requirement_id: 'req_c02',
          clause: 'Clause 2.4',
          requirement_type: 'TURNOVER',
          field: 'financial.average_annual_turnover',
          operator: 'GTE',
          expected_value: 85000000,
          observed_value: 92000000,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          evidence_ids: ['ev_to_c02'],
          review_required: false,
        },
        {
          requirement_id: 'req_c03',
          clause: 'Clause 5.2',
          requirement_type: 'CUSTOM',
          field: 'credentials.oem_authorization',
          operator: 'EXISTS',
          expected_value: 'VALID_OEM_LETTER',
          observed_value: 'UNVERIFIED_LETTER_ATTACHED',
          status: 'REVIEW_REQUIRED',
          reason_code: 'MANUAL_DOCUMENT_VERIFICATION_REQUIRED',
          evidence_ids: ['ev_oem_c03'],
          review_required: true,
        },
      ],
    },
  },
  verifications: {
    bidder_alpha_01: [
      {
        id: 'vr_01',
        bidder_id: 'bidder_alpha_01',
        field: 'gstin',
        claimed_value: '07AABCA1234H1Z9',
        verified_value: 'Active (Tax Regular)',
        status: 'VERIFIED',
        source: 'GST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:00Z',
        verification_reference: 'DEMO-GSTN-8492019',
      },
      {
        id: 'vr_02',
        bidder_id: 'bidder_alpha_01',
        field: 'udyam_number',
        claimed_value: 'UDYAM-DL-01-0012345',
        verified_value: 'Small Enterprise (Manufacturing)',
        status: 'VERIFIED',
        source: 'UDYAM_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:10Z',
        verification_reference: 'DEMO-UDYAM-55219',
      },
    ],
    bidder_crest_02: [
      {
        id: 'vr_b01',
        bidder_id: 'bidder_crest_02',
        field: 'gstin',
        claimed_value: '33AABCC9999P1Z1',
        verified_value: 'Active (Tax Regular)',
        status: 'VERIFIED',
        source: 'GST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:00Z',
        verification_reference: 'DEMO-GSTN-999120',
      },
    ],
    bidder_bharat_03: [
      {
        id: 'vr_c01',
        bidder_id: 'bidder_bharat_03',
        field: 'gstin',
        claimed_value: '27AAGCB5678K1Z3',
        verified_value: 'Active (Tax Regular)',
        status: 'VERIFIED',
        source: 'GST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:00Z',
        verification_reference: 'DEMO-GSTN-567812',
      },
      {
        id: 'vr_c02',
        bidder_id: 'bidder_bharat_03',
        field: 'pan',
        claimed_value: 'AAGCB5678K',
        verified_value: 'Valid (LLP/Firm)',
        status: 'VERIFIED',
        source: 'MCA_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:05Z',
        verification_reference: 'DEMO-PAN-5678K',
      },
      {
        id: 'vr_c03',
        bidder_id: 'bidder_bharat_03',
        field: 'udyam_number',
        claimed_value: 'UDYAM-MH-02-0054321',
        verified_value: 'Small Enterprise (Solar Equipment)',
        status: 'VERIFIED',
        source: 'UDYAM_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:10Z',
        verification_reference: 'DEMO-UDYAM-54321',
      },
      {
        id: 'vr_c04',
        bidder_id: 'bidder_bharat_03',
        field: 'epfo',
        claimed_value: 'Not Claimed / Unregistered',
        verified_value: 'Unverified',
        status: 'UNVERIFIED',
        source: 'EPFO_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:15Z',
        verification_reference: null,
      },
      {
        id: 'vr_c05',
        bidder_id: 'bidder_bharat_03',
        field: 'esic',
        claimed_value: 'Not Claimed / Unregistered',
        verified_value: 'Unverified',
        status: 'UNVERIFIED',
        source: 'ESIC_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:20Z',
        verification_reference: null,
      },
      {
        id: 'vr_c06',
        bidder_id: 'bidder_bharat_03',
        field: 'blacklisted',
        claimed_value: 'Clean / No Record',
        verified_value: 'Cleared across CPPP, GeM & Debarment lists',
        status: 'VERIFIED',
        source: 'BLACKLIST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: '2026-08-20T11:58:25Z',
        verification_reference: 'DEMO-DEBAR-CLEAN',
      },
    ],
  },
  humanDecisions: {
    bidder_alpha_01: 'QUALIFIED',
    bidder_crest_02: 'DISQUALIFIED',
    bidder_bharat_03: 'PENDING',
  },
  deepAuditSyntheses: {
    bidder_alpha_01: {
      run_id: 'run_deep_audit_alpha_01',
      started_at: '2026-08-20T12:05:00Z',
      completed_at: '2026-08-20T12:05:12Z',
      status: 'COMPLETED',
      tender_id: 'tender_gem_2026_01',
      bidder_id: 'bidder_alpha_01',
      tender_title: 'Comprehensive Highway Surveillance & IT Infrastructure Modernization',
      bidder_name: 'Alpha Infotech Private Limited',
      is_advisory: true,
      advisory_disclaimer: 'Advisory Analysis Only: Deep Audit provides investigation assistance. It does not mutate deterministic compliance evaluations or override officer authority.',
      summary: 'Autonomous advisory audit completed for Alpha Infotech Private Limited. Deterministic compliance verified all 3 mandatory requirements as PASS. Advisory investigation confirms active statutory registration across GSTIN and Udyam. MSME turnover exemption guidance verified applicable under Public Procurement Policy 2012 as an advisory reference.',
      total_findings_count: 2,
      high_priority_count: 0,
      review_required_count: 0,
      informational_count: 2,
      unresolved_questions_count: 1,
      conflicts_count: 0,
      missing_evidence_count: 0,
      workflow_trace: [
        { stage_key: 'tender_intelligence', label: 'Tender Intelligence', status: 'COMPLETED', short_description: '3 criteria indexed, 0 ambiguities in baseline RFP.', findings_produced: 0, evidence_used: 3, duration_ms: 120 },
        { stage_key: 'document_intelligence', label: 'Document Intelligence', status: 'COMPLETED', short_description: '2 documents parsed (GST Certificate, CA Turnover Certificate). OCR confidence 97%.', findings_produced: 0, evidence_used: 2, duration_ms: 340 },
        { stage_key: 'knowledge', label: 'Knowledge & Precedents', status: 'COMPLETED', short_description: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Precedent indexed for MSE exemption advisory context.', findings_produced: 1, evidence_used: 1, duration_ms: 210 },
        { stage_key: 'risk', label: 'Deterministic Risk & Anomalies', status: 'COMPLETED', short_description: 'Deterministic risk heuristics scanned. 0 fraud or debarment signals.', findings_produced: 0, evidence_used: 4, duration_ms: 180 },
        { stage_key: 'compliance', label: 'Compliance Synthesis', status: 'COMPLETED', short_description: 'Cross-document fact consistency verified across all filings.', findings_produced: 1, evidence_used: 3, duration_ms: 250 },
        { stage_key: 'human_review', label: 'Advisory Summary for Officer', status: 'COMPLETED', short_description: 'Advisory synthesis compiled. 0 blocking flags for officer review.', findings_produced: 0, evidence_used: 2, duration_ms: 90 },
      ],
      findings: [
        {
          finding_id: 'find_alpha_01',
          category: 'RAG_CONTEXT',
          severity: 'INFO',
          title: 'Advisory MSME Turnover Exemption Precedent Available',
          description: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Synthetic Procurement Precedent permits exemption from prior turnover/experience criteria for Micro & Small Enterprises meeting technical specifications.',
          affected_fields: ['financial.average_annual_turnover'],
          evidence_provenance: [{ document_name: 'ca_turnover_certificate.pdf', page: 1, field: 'financial.average_annual_turnover', raw_value: '₹6.50 Cr' }],
          detection_method: 'POLICY_PRECEDENT_RETRIEVAL',
          recommended_action: 'Note exemption applicability for record; bidder independently meets turnover threshold (₹6.50 Cr vs ₹5.00 Cr requirement).',
        },
        {
          finding_id: 'find_alpha_02',
          category: 'STATUTORY_MISMATCH',
          severity: 'INFO',
          title: 'Statutory Registry Synchronization Verified',
          description: 'Active GSTIN and Udyam registrations match claimed corporate credentials with 100% field parity.',
          affected_fields: ['tax.gstin', 'enterprise.udyam'],
          evidence_provenance: [{ document_name: 'gst_certificate.pdf', page: 1, field: 'tax.gstin', raw_value: '07AABCA1234H1Z9' }],
          detection_method: 'REGISTRY_CROSS_CHECK',
          recommended_action: 'No officer action required.',
        },
      ],
      cross_document_conflicts: [],
      missing_evidence: [],
      statutory_investigations: [
        { identifier_type: 'GSTIN', identifier_value: '07AABCA1234H1Z9', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: '07AABCA1234H1Z9', external_derived_value: '07AABCA1234H1Z9 (Active Taxpayer)', conflict_status: 'NO_CONFLICT', details: 'Active regular taxpayer under Delhi GST ward 01.' },
        { identifier_type: 'PAN', identifier_value: 'AABCA1234H', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'AABCA1234H', external_derived_value: 'AABCA1234H (Valid - Company)', conflict_status: 'NO_CONFLICT', details: 'Valid corporate PAN registered with Income Tax Department.' },
        { identifier_type: 'UDYAM', identifier_value: 'UDYAM-DL-01-0012345', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'UDYAM-DL-01-0012345', external_derived_value: 'UDYAM-DL-01-0012345 (Small Enterprise)', conflict_status: 'NO_CONFLICT', details: 'Small Enterprise in IT Infrastructure & Software Services.' },
        { identifier_type: 'CIN', identifier_value: 'U72200DL2018PTC123456', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'U72200DL2018PTC123456', external_derived_value: 'U72200DL2018PTC123456 (Active)', conflict_status: 'NO_CONFLICT', details: 'Active Private Limited company registered with RoC Delhi.' },
        { identifier_type: 'EPFO', identifier_value: 'DL/CPM/0045210/000', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'DL/CPM/0045210/000', external_derived_value: 'DL/CPM/0045210/000 (Active - 42 Contrib.)', conflict_status: 'NO_CONFLICT', details: 'Regular EPFO monthly returns filed.' },
        { identifier_type: 'ESIC', identifier_value: '11000452100001001', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: '11000452100001001', external_derived_value: '11000452100001001 (Active)', conflict_status: 'NO_CONFLICT', details: 'ESIC compliance active.' },
        { identifier_type: 'BLACKLIST', identifier_value: 'Alpha Infotech Private Limited', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'CLEARED', document_derived_value: 'Alpha Infotech Private Limited', external_derived_value: 'No Debarment Record', conflict_status: 'NO_CONFLICT', details: 'Clean across CPPP, GeM Incident Management, and Central Debarment lists.' },
      ],
      risk_anomalies: [
        { signal_id: 'sig_alpha_01', rule_name: 'REVENUE_STABILITY_SCAN', engine_label: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE', input_values: ['Turnover: ₹6.50 Cr', 'Threshold: ₹5.00 Cr'], why_triggered: 'Positive margin (30% above mandatory tender threshold). No negative variances detected.', severity: 'INFO', supporting_evidence: 'ca_turnover_certificate.pdf (Page 1)' },
      ],
      rag_investigations: [
        { query: 'Is MSME turnover exemption applicable to this tender?', direct_tender_evidence: 'Clause 4.2.3 mandates INR 5.00 Cr turnover without explicit MSE waiver mention in Section IV.', related_policy_context: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Synthetic Procurement Precedent: Order permits exemption from prior turnover/experience for MSEs subject to meeting quality and technical specifications.', citation_document: 'highway_surveillance_rfp_2026.pdf', citation_page: 5, advisory_result: 'ADVISORY_POLICY_APPLICABLE', is_advisory: true },
      ],
      unresolved_questions: [
        { question_id: 'uq_alpha_01', question: 'Should the procurement committee formally record the MSE exemption status in the evaluation summary?', background: 'Bidder independently passes financial turnover criteria without relying on the exemption.', reason_cannot_auto_resolve: 'Policy recording convention depends on procuring authority administrative guidelines.', officer_prompt: 'ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.' },
      ],
      recommended_actions: [
        { action_id: 'rec_alpha_01', action_type: 'CONFIRM_EXEMPTION', title: 'Acknowledge Statutory MSE Certificate', description: 'Record verified Small Enterprise status in tender evaluation minutes for statutory reporting compliance.', is_recommendation_only: true },
      ],
      evidence_chains: [
        {
          chain_id: 'chain_alpha_01',
          tender_requirement: { id: 'req_02', clause: 'Clause 4.2.3', text: 'Minimum average annual turnover shall be INR 5,00,00,000 for the last 3 financial years.' },
          bidder_evidence: { document_id: 'doc_alpha_turnover', document_name: 'ca_turnover_certificate.pdf', page: 1, excerpt: 'Average Annual Turnover for FY 2022-23, 2023-24, 2024-25 is INR 6,50,00,000.' },
          extracted_fact: { canonical_field: 'financial.average_annual_turnover', extracted_value: '65000000', confidence: 0.95 },
          rule_investigation: { detection_method: 'NUMERIC_GTE', engine: 'DETERMINISTIC COMPLIANCE RULE ENGINE', evaluation: 'Observed 65,000,000 >= Expected 50,000,000. Verified PASS.' },
          deep_audit_finding: { finding_id: 'find_alpha_01', title: 'Turnover Satisfied with 30% Headroom', severity: 'INFO' },
        },
      ],
      conflicts_detected: [
        {
          clause_reference: 'Clause 3.1 vs Clause 4.2',
          conflict_type: 'TURNOVER_THRESHOLD_AMBIGUITY',
          description: 'General tender financial requirement mandates ₹5.0 Cr turnover, but Clause 4.2 grants MSE exemption for Udyam-registered micro-enterprises.',
          severity: 'WARNING',
        },
      ],
      policy_precedents: [
        {
          clause_reference: 'Demo Policy Fixture P-153 (Synthetic Procurement Policy — MSME Exemption)',
          precedent_id: 'SYN-FIXTURE-P153',
          source: 'SYNTHETIC POLICY CONTEXT • DEMO ONLY',
          similarity_score: 0.94,
          ruling_summary: 'Procuring entities may not reject MSE bidders meeting technical parameters solely on failure of minimum turnover thresholds.',
        },
      ],
      evidence_synthesis: 'Bidder submitted valid Udyam Registration (UDYAM-DL-01-0012345) and CA turnover certificate. Deterministic statutory verification confirmed active GSTIN status. Exemption is verified and eligible for officer sign-off.',
      recommended_human_inquiries: [
        'Confirm whether bidder qualifies under Micro or Small category on the National Udyam Portal.',
        'Verify that manufacturing/service provision domain matches Tender Item Classification Schedule.',
      ],
      disclaimer: 'Advisory Analysis: Deep Audit provides investigation assistance. Final qualification decisions remain solely with the human procurement officer.',
    },
    bidder_bharat_03: {
      run_id: 'run_deep_audit_bharat_03',
      started_at: '2026-08-20T14:10:00Z',
      completed_at: '2026-08-20T14:10:18Z',
      status: 'COMPLETED',
      tender_id: 'tender_gem_2026_03',
      bidder_id: 'bidder_bharat_03',
      tender_title: 'Smart Solar Grid Micro-Inverter Deployment (Phase IV)',
      bidder_name: 'Bharat Tech Solutions LLP',
      is_advisory: true,
      advisory_disclaimer: 'Advisory Analysis Only: Deep Audit provides supplemental investigation assistance and anomaly detection. It does not alter compliance evaluations, mutate bidder statuses, or override procurement officer authority. Final decision remains with the human procurement officer.',
      summary: 'Deep Audit investigation identified a significant 17.9% cross-document turnover discrepancy between the Audited Balance Sheet (₹9.20 Cr) and the Unaudited Financial Summary Statement (₹7.80 Cr, which falls below the mandatory ₹8.50 Cr threshold). Furthermore, Tender Clause 5.2 requires a direct OEM Manufacturer Authorization Form (MAF), but only a Tier-2 distributor authorization letter was submitted without direct manufacturer serial commitments. 2 unresolved questions require officer review.',
      total_findings_count: 5,
      high_priority_count: 2,
      review_required_count: 2,
      informational_count: 1,
      unresolved_questions_count: 2,
      conflicts_count: 1,
      missing_evidence_count: 1,
      workflow_trace: [
        { stage_key: 'tender_intelligence', label: 'Tender Intelligence', status: 'COMPLETED', short_description: '3 mandatory criteria indexed: GSTIN, Turnover (₹8.50 Cr), Direct OEM Authorization.', findings_produced: 0, evidence_used: 3, duration_ms: 110 },
        { stage_key: 'document_intelligence', label: 'Document Intelligence', status: 'COMPLETED', short_description: '2 documents parsed (Audited Balance Sheet, Unaudited Financial Summary). OCR confidence 94%.', findings_produced: 1, evidence_used: 2, duration_ms: 420 },
        { stage_key: 'knowledge', label: 'Knowledge & Precedents', status: 'COMPLETED', short_description: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Synthetic OEM authorization and MSE exemption guidelines retrieved.', findings_produced: 1, evidence_used: 2, duration_ms: 260 },
        { stage_key: 'risk', label: 'Deterministic Risk & Anomalies', status: 'COMPLETED', short_description: 'Deterministic risk heuristics flagged 17.9% turnover discrepancy and Tier-2 reseller authorization gap.', findings_produced: 2, evidence_used: 4, duration_ms: 230 },
        { stage_key: 'compliance', label: 'Compliance Synthesis', status: 'COMPLETED', short_description: 'Uncovered cross-document conflict between audited filing and internal summary statement.', findings_produced: 1, evidence_used: 3, duration_ms: 310 },
        { stage_key: 'human_review', label: 'Advisory Summary for Officer', status: 'COMPLETED', short_description: 'Synthesized 2 critical advisory findings and 2 unresolved questions for procurement committee.', findings_produced: 0, evidence_used: 2, duration_ms: 110 },
      ],
      findings: [
        {
          finding_id: 'find_bharat_01',
          category: 'CROSS_DOCUMENT_CONFLICT',
          severity: 'HIGH',
          title: 'Cross-Document Turnover Discrepancy (17.9% Variance)',
          description: 'Audited Balance Sheet FY 2024-25 reports ₹9.20 Cr turnover (qualifying), but Unaudited Financial Summary Statement reports ₹7.80 Cr (below the mandatory ₹8.50 Cr threshold). Compliance matrix evaluated the Balance Sheet as PASS, but Deep Audit reveals conflicting internal figures.',
          affected_fields: ['financial.average_annual_turnover'],
          evidence_provenance: [
            { document_name: 'Audited Balance Sheet (FY 2024-25)', page: 4, field: 'financial.average_annual_turnover', raw_value: '₹9.20 Cr (INR 92,000,000)' },
            { document_name: 'Unaudited Financial Summary Statement', page: 1, field: 'financial.average_annual_turnover', raw_value: '₹7.80 Cr (INR 78,000,000)' },
          ],
          detection_method: 'CROSS_DOCUMENT_RECONCILIATION',
          recommended_action: 'Seek written clarification and audited segment breakdown from statutory auditor to verify which figure governs.',
        },
        {
          finding_id: 'find_bharat_02',
          category: 'MISSING_EVIDENCE',
          severity: 'HIGH',
          title: 'Missing Direct OEM Manufacturer Authorization (Tier-2 Letter Provided)',
          description: 'Clause 5.2 mandates direct authorization from the micro-inverter manufacturer. Bidder submitted an authorization issued by SolarDist Inc. (Tier-2 distributor) without direct manufacturer back-to-back warranty guarantee.',
          affected_fields: ['credentials.oem_authorization'],
          evidence_provenance: [
            { document_name: 'SolarDist_Distributor_Letter.pdf', page: 1, field: 'credentials.oem_authorization', raw_value: 'SolarDist Partner Authorization Letter' },
          ],
          detection_method: 'CRITERIA_EVIDENCE_GAP_SCAN',
          recommended_action: 'Issue formal clarification notice requesting direct OEM Manufacturer Authorization Form (MAF) as prescribed in Clause 5.2 Annexure IV.',
        },
        {
          finding_id: 'find_bharat_03',
          category: 'ANOMALY_SIGNAL',
          severity: 'MEDIUM',
          title: 'Deterministic Anomaly: Intra-Filing Turnover Contradiction',
          description: 'Rule FINANCIAL_TURNOVER_DISCREPANCY triggered: variance between primary filing (₹9.20 Cr) and secondary summary (₹7.80 Cr) exceeds 15% safety tolerance.',
          affected_fields: ['financial.average_annual_turnover'],
          evidence_provenance: [
            { document_name: 'Audited Balance Sheet', page: 4, field: 'financial.average_annual_turnover', raw_value: '92000000' },
            { document_name: 'Unaudited Financial Summary', page: 1, field: 'financial.average_annual_turnover', raw_value: '78000000' },
          ],
          detection_method: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE',
          recommended_action: 'Review supporting trial balance and GST GSTR-3B filings to independently corroborate annual turnover.',
        },
        {
          finding_id: 'find_bharat_04',
          category: 'STATUTORY_MISMATCH',
          severity: 'INFO',
          title: 'Statutory Registry Verification Cleared (LLP Entity Structure)',
          description: 'GSTIN, PAN, and Udyam registrations match claimed credentials. Corporate CIN is legitimately absent because bidder is an LLP registered under MCA LLPIN portal.',
          affected_fields: ['tax.gstin', 'tax.pan', 'enterprise.udyam', 'corporate.cin'],
          evidence_provenance: [
            { document_name: 'gst_certificate.pdf', page: 1, field: 'tax.gstin', raw_value: '27AAGCB5678K1Z3' },
          ],
          detection_method: 'REGISTRY_CROSS_CHECK',
          recommended_action: 'Confirm LLP partnership deed and designated partner authority.',
        },
        {
          finding_id: 'find_bharat_05',
          category: 'RAG_CONTEXT',
          severity: 'INFO',
          title: 'Advisory Precedent on OEM Authorization Legality',
          description: 'General Financial Rules 2017 Rule 144(xi) and SECI Standard Bidding Documents stipulate that intermediary authorizations must carry explicit manufacturer endorsement.',
          affected_fields: ['credentials.oem_authorization'],
          evidence_provenance: [
            { document_name: 'seci_solar_grid_rfp.pdf', page: 11, field: 'credentials.oem_authorization', raw_value: 'Clause 5.2' },
          ],
          detection_method: 'POLICY_PRECEDENT_RETRIEVAL',
          recommended_action: 'Procurement officer should assess whether Tier-2 authorization can be accepted subject to direct OEM guarantee before contract award.',
        },
      ],
      cross_document_conflicts: [
        {
          field_name: 'financial.average_annual_turnover',
          document_a_id: 'doc_bharat_balance_sheet',
          document_a_name: 'Audited Balance Sheet (FY 2024-25)',
          document_a_page: 4,
          document_a_value: '₹9.20 Cr (INR 92,000,000)',
          document_b_id: 'doc_bharat_financial_summary',
          document_b_name: 'Unaudited Financial Summary Statement',
          document_b_page: 1,
          document_b_value: '₹7.80 Cr (INR 78,000,000)',
          difference_description: '17.9% variance detected between submitted documents. While the Audited Balance Sheet meets the tender threshold of ₹8.50 Cr, the Unaudited Financial Summary statement indicates ₹7.80 Cr, which is below the qualifying threshold.',
          severity: 'HIGH',
          officer_review_reason: 'Tender evaluation pipeline evaluated the Audited Balance Sheet and marked the rule as PASS. Deep Audit reveals conflicting internal figures. Procurement officer must seek written clarification regarding which turnover figure governs.',
        },
      ],
      missing_evidence: [
        {
          item_id: 'me_bharat_01',
          requirement_title: 'Direct OEM Manufacturer Authorization Form (MAF)',
          requirement_description: 'Clause 5.2 mandates direct authorization from the micro-inverter manufacturer guaranteeing supply and warranty.',
          status: 'WEAK',
          bidder_evidence_status: 'Tier-2 distributor letter submitted (SolarDist Inc.); missing direct manufacturer OEM authorization with tender-specific serial commitment.',
          recommended_action: 'Issue clarification notice requesting direct OEM authorization under Clause 5.2 Annexure IV.',
        },
      ],
      statutory_investigations: [
        { identifier_type: 'GSTIN', identifier_value: '27AAGCB5678K1Z3', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: '27AAGCB5678K1Z3', external_derived_value: '27AAGCB5678K1Z3 (Active Taxpayer)', conflict_status: 'NO_CONFLICT', details: 'Active regular taxpayer under Maharashtra GST ward 02.' },
        { identifier_type: 'PAN', identifier_value: 'AAGCB5678K', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'AAGCB5678K', external_derived_value: 'AAGCB5678K (Valid - LLP/Firm)', conflict_status: 'NO_CONFLICT', details: 'Valid LLP PAN registered with Income Tax Department.' },
        { identifier_type: 'CIN', identifier_value: 'Not Applicable (LLP)', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'CLEARED', document_derived_value: 'Not Applicable', external_derived_value: 'LLP Registered under MCA LLPIN portal', conflict_status: 'NO_CONFLICT', details: 'Entity is registered as a Limited Liability Partnership (LLPIN: AAG-5678); corporate CIN is not applicable.' },
        { identifier_type: 'UDYAM', identifier_value: 'UDYAM-MH-02-0054321', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', document_derived_value: 'UDYAM-MH-02-0054321', external_derived_value: 'UDYAM-MH-02-0054321 (Small Enterprise)', conflict_status: 'NO_CONFLICT', details: 'Small Enterprise in Solar Equipment & Clean Energy Systems.' },
        { identifier_type: 'EPFO', identifier_value: 'Not Claimed / Unregistered', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'UNVERIFIED', document_derived_value: null, external_derived_value: null, conflict_status: 'UNVERIFIED', details: 'No EPFO establishment code provided in bidder submission pack.' },
        { identifier_type: 'ESIC', identifier_value: 'Not Claimed / Unregistered', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'UNVERIFIED', document_derived_value: null, external_derived_value: null, conflict_status: 'UNVERIFIED', details: 'No ESIC registration code provided in bidder submission pack.' },
        { identifier_type: 'BLACKLIST', identifier_value: 'Bharat Tech Solutions LLP', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'CLEARED', document_derived_value: 'Bharat Tech Solutions LLP', external_derived_value: 'No Debarment Record', conflict_status: 'NO_CONFLICT', details: 'Clean across CPPP, GeM Incident Management, and Central Debarment lists.' },
      ],
      risk_anomalies: [
        {
          signal_id: 'sig_bharat_01',
          rule_name: 'FINANCIAL_TURNOVER_DISCREPANCY',
          engine_label: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE',
          input_values: ['Audited Balance Sheet: ₹9.20 Cr', 'Unaudited Summary: ₹7.80 Cr', 'Mandatory Threshold: ₹8.50 Cr'],
          why_triggered: 'Turnover variance between primary filing (₹9.20 Cr) and secondary summary (₹7.80 Cr) is 17.9%, exceeding 15% threshold. Secondary figure breaches minimum threshold.',
          severity: 'HIGH',
          supporting_evidence: 'Audited Balance Sheet (Page 4) vs Unaudited Financial Summary (Page 1)',
        },
        {
          signal_id: 'sig_bharat_02',
          rule_name: 'INDIRECT_OEM_AUTHORIZATION_CHAIN',
          engine_label: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE',
          input_values: ['SolarDist Inc. Authorization Letter', 'OEM: InvertoSolar Technologies'],
          why_triggered: 'Authorization issued by intermediary reseller without explicit direct back-to-back OEM warranty commitment.',
          severity: 'MEDIUM',
          supporting_evidence: 'Document credentials.oem_authorization (Page 1)',
        },
      ],
      rag_investigations: [
        {
          query: 'What are the tender conditions for OEM authorization letters?',
          direct_tender_evidence: 'Clause 5.2: Bidders must furnish Manufacturer Authorization Form directly signed by the micro-inverter OEM guaranteeing 10-year replacement warranty and supply commitment.',
          related_policy_context: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Synthetic Precedent Note: Sub-contracting and intermediary authorizations must be authenticated by the primary manufacturer to ensure product warranty enforceability.',
          citation_document: 'seci_solar_grid_rfp.pdf',
          citation_page: 11,
          advisory_result: 'ADVISORY_CONTEXT',
          is_advisory: true,
        },
        {
          query: 'Can MSME turnover exemption override Clause 2.4 turnover criteria for solar EPC works?',
          direct_tender_evidence: 'Clause 2.4 sets mandatory ₹8.50 Cr turnover without unconditional MSE waiver.',
          related_policy_context: '[SYNTHETIC POLICY CONTEXT • DEMO ONLY] Synthetic SECI Policy Guidelines Note: In complex infrastructure procurement involving grid stability, procuring authority may restrict MSE turnover waivers where public safety is implicated.',
          citation_document: 'seci_solar_grid_rfp.pdf',
          citation_page: 4,
          advisory_result: 'ADVISORY_CONTEXT',
          is_advisory: true,
        },
      ],
      unresolved_questions: [
        {
          question_id: 'uq_bharat_01',
          question: 'Can the officer verify whether the unaudited ₹7.80 Cr statement reflects non-solar revenue exclusions or an accounting discrepancy?',
          background: 'Audited Balance sheet reports ₹9.20 Cr total turnover, while Unaudited Summary statement reports ₹7.80 Cr (below the ₹8.50 Cr threshold).',
          reason_cannot_auto_resolve: 'Requires commercial intent verification and CA reconciliation note.',
          officer_prompt: 'ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.',
        },
        {
          question_id: 'uq_bharat_02',
          question: 'Is the Tier-2 distributor authorization supported by an authentic back-to-back OEM manufacturer commitment?',
          background: 'Bidder submitted distributor letter from SolarDist Inc. Tender Clause 5.2 specifies direct OEM authorization.',
          reason_cannot_auto_resolve: 'Distributor reseller authorization legality requires officer verification of OEM warranty backing.',
          officer_prompt: 'ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.',
        },
      ],
      recommended_actions: [
        {
          action_id: 'rec_bharat_01',
          action_type: 'REQUEST_CLARIFICATION',
          title: 'Seek Formal Turnover Reconciliation from Auditor',
          description: 'Require bidder to furnish a CA certificate explaining the ₹1.40 Cr variance between Audited Balance Sheet (₹9.20 Cr) and Financial Summary (₹7.80 Cr).',
          target_document: 'Audited Balance Sheet (FY 2024-25)',
          target_page: 4,
          is_recommendation_only: true,
        },
        {
          action_id: 'rec_bharat_02',
          action_type: 'REQUEST_DOCUMENT',
          title: 'Demand Direct OEM Manufacturer Authorization Form',
          description: 'Require bidder to submit OEM Manufacturer Authorization directly from InvertoSolar Technologies as mandated in Clause 5.2 Annexure IV.',
          target_document: 'seci_solar_grid_rfp.pdf',
          target_page: 11,
          is_recommendation_only: true,
        },
        {
          action_id: 'rec_bharat_03',
          action_type: 'MANUAL_VERIFY',
          title: 'Review MCA LLPIN Corporate Status',
          description: 'Verify designated partners and active status on MCA portal under LLPIN AAG-5678.',
          is_recommendation_only: true,
        },
      ],
      evidence_chains: [
        {
          chain_id: 'chain_bharat_01',
          tender_requirement: { id: 'req_c02', clause: 'Clause 2.4', text: 'Annual turnover of INR 8.5 Crores or higher.' },
          bidder_evidence: { document_id: 'doc_bharat_balance_sheet', document_name: 'Audited Balance Sheet (FY 2024-25)', page: 4, excerpt: 'Total Revenue from Operations: ₹9,20,45,000' },
          extracted_fact: { canonical_field: 'financial.average_annual_turnover', extracted_value: '92000000', confidence: 0.95 },
          rule_investigation: { detection_method: 'CROSS_DOCUMENT_RECONCILIATION', engine: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE', evaluation: 'Conflicted by secondary document Unaudited Financial Summary showing ₹7.80 Cr (17.9% drop)' },
          deep_audit_finding: { finding_id: 'find_bharat_01', title: 'Cross-Document Turnover Discrepancy (17.9% Variance)', severity: 'HIGH' },
        },
        {
          chain_id: 'chain_bharat_02',
          tender_requirement: { id: 'req_c03', clause: 'Clause 5.2', text: 'Original Equipment Manufacturer (OEM) authorization certificate required.' },
          bidder_evidence: { document_id: 'doc_bharat_dist_letter', document_name: 'SolarDist_Distributor_Letter.pdf', page: 1, excerpt: 'SolarDist confirms Bharat Tech Solutions is an authorized Tier-2 reseller.' },
          extracted_fact: { canonical_field: 'credentials.oem_authorization', extracted_value: 'TIER_2_DISTRIBUTOR_LETTER', confidence: 0.88 },
          rule_investigation: { detection_method: 'CRITERIA_EVIDENCE_GAP_SCAN', engine: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE', evaluation: 'Missing direct OEM Manufacturer Authorization Form with manufacturer seal' },
          deep_audit_finding: { finding_id: 'find_bharat_02', title: 'Missing Direct OEM Manufacturer Authorization', severity: 'HIGH' },
        },
      ],
      conflicts_detected: [
        {
          clause_reference: 'Audited Balance Sheet (p.4) vs Financial Summary (p.1)',
          conflict_type: 'FINANCIAL_TURNOVER_DISCREPANCY',
          description: 'Audited Balance Sheet reports ₹9.20 Cr turnover, but Unaudited Financial Summary Statement reports ₹7.80 Cr (below ₹8.50 Cr threshold).',
          severity: 'CRITICAL',
        },
      ],
      policy_precedents: [
        {
          clause_reference: 'Demo Policy Fixture P-144XI (Synthetic Procurement Precedent — OEM Authorization)',
          precedent_id: 'SYN-FIXTURE-P144XI',
          source: 'SYNTHETIC POLICY CONTEXT • DEMO ONLY',
          similarity_score: 0.91,
          ruling_summary: 'Intermediary distributor authorizations must carry direct manufacturer endorsement to ensure product warranty enforceability.',
        },
      ],
      evidence_synthesis: 'Deep Audit identified a 17.9% cross-document conflict on turnover and an indirect Tier-2 distributor authorization where direct OEM MAF is required. Final qualification determination requires officer review.',
      recommended_human_inquiries: [
        'Require statutory auditor reconciliation between audited ₹9.20 Cr and unaudited ₹7.80 Cr turnover figures.',
        'Obtain authentic back-to-back OEM manufacturer authorization letter directly from InvertoSolar Technologies.',
      ],
      disclaimer: 'Advisory Analysis Only: Deep Audit provides supplemental investigation assistance. It does not alter deterministic compliance evaluations or override human officer authority.',
    },
  },
  auditEvents: [
    {
      id: 'evt_01',
      job_id: 'job_extract_01',
      stage: 'EXTRACTION',
      status: 'COMPLETED',
      progress: 100,
      action: 'TENDER_EXTRACTION_COMPLETED',
      entity_type: 'TENDER',
      entity_id: 'tender_01',
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      target_url: '/workspace/tenders/tender_01?mode=demo#criteria',
      message: 'Tender requirements extracted and candidate rules prepared.',
      timestamp: '2026-08-01T10:06:00Z',
    },
    {
      id: 'evt_02',
      job_id: 'job_verify_alpha',
      stage: 'VERIFICATION',
      status: 'COMPLETED',
      progress: 100,
      action: 'STATUTORY_CHECKS_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: 'bidder_alpha',
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      target_url: '/workspace/bidders/bidder_alpha?mode=demo',
      message: 'Registry verification and multi-document fact validation completed.',
      timestamp: '2026-08-20T11:58:00Z',
    },
    {
      id: 'evt_03',
      job_id: 'job_compliance_alpha',
      stage: 'COMPLIANCE',
      status: 'COMPLETED',
      progress: 100,
      action: 'COMPLIANCE_EVALUATION_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: 'bidder_alpha',
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      target_url: '/workspace/bidders/bidder_alpha/matrix?mode=demo',
      message: 'Deterministic compliance evaluation passed (3/3 rules satisfied).',
      timestamp: '2026-08-20T12:00:00Z',
    },
  ],
  jobs: {},
  bidderDocuments: {},
  extractedFacts: {},
  complianceStale: {},
};

// ---------------------------------------------------------------------------
// STORE HELPERS
// ---------------------------------------------------------------------------

function getDefaultState(): DemoState {
  return JSON.parse(JSON.stringify(DEFAULT_DEMO_STATE));
}

function loadFromStorage(): DemoState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<DemoState> & { version?: number };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tenders)) {
      return getDefaultState();
    }

    const now = new Date().toISOString();

    // Sanitize any orphaned RUNNING jobs from older unclosed sessions
    const sanitizedJobs: Record<string, JobRead> = {};
    if (parsed.jobs && typeof parsed.jobs === 'object') {
      for (const [jId, job] of Object.entries(parsed.jobs)) {
        if (job && typeof job === 'object') {
          if (job.status === 'RUNNING') {
            sanitizedJobs[jId] = {
              ...job,
              status: 'FAILED',
              error_message: 'Demo job execution interrupted.',
              completed_at: now,
            };
          } else {
            sanitizedJobs[jId] = job;
          }
        }
      }
    }

    // Sanitize any orphaned RUNNING tenders to REVIEW_REQUIRED (semantically safe)
    let addedAuditLogs = false;
    const recoveryAuditEvents: AuditEventRead[] = [];
    const sanitizedTenders = parsed.tenders.map((t) => {
      if (t.status === 'RUNNING') {
        addedAuditLogs = true;
        recoveryAuditEvents.push({
          id: `evt_recover_${t.id}_${Date.now()}`,
          job_id: `job_${t.id}`,
          stage: 'EXTRACTION',
          status: 'FAILED',
          progress: 0,
          message: `Previous demo processing session was interrupted. Re-run processing for tender "${t.title}".`,
          timestamp: now,
        });
        return { ...t, status: 'REVIEW_REQUIRED' as const, updated_at: now };
      }
      return t;
    });

    const rawStoredAuditEvents = Array.isArray(parsed.auditEvents) ? parsed.auditEvents : DEFAULT_DEMO_STATE.auditEvents;
    const migratedAuditEvents: AuditEventRead[] = rawStoredAuditEvents.map((ev) => {
      let targetUrl = ev.target_url;
      if (targetUrl && !targetUrl.includes('mode=demo')) {
        targetUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}mode=demo`;
      }
      return {
        ...ev,
        mode: 'DEMO' as const,
        source: 'DEMO_STORE / SYNTHETIC' as const,
        target_url: targetUrl,
      };
    });
    const finalAuditEvents = addedAuditLogs ? [...recoveryAuditEvents, ...migratedAuditEvents] : migratedAuditEvents;

    return {
      version: CURRENT_DEMO_VERSION,
      tenders: sanitizedTenders,
      requirements: parsed.requirements && typeof parsed.requirements === 'object' ? parsed.requirements : DEFAULT_DEMO_STATE.requirements,
      bidders: parsed.bidders && typeof parsed.bidders === 'object' ? parsed.bidders : DEFAULT_DEMO_STATE.bidders,
      complianceMatrices: parsed.complianceMatrices && typeof parsed.complianceMatrices === 'object' ? parsed.complianceMatrices : DEFAULT_DEMO_STATE.complianceMatrices,
      verifications: parsed.verifications && typeof parsed.verifications === 'object' ? parsed.verifications : DEFAULT_DEMO_STATE.verifications,
      humanDecisions: parsed.humanDecisions && typeof parsed.humanDecisions === 'object' ? parsed.humanDecisions : DEFAULT_DEMO_STATE.humanDecisions,
      auditEvents: finalAuditEvents,
      jobs: sanitizedJobs,
      bidderDocuments: parsed.bidderDocuments && typeof parsed.bidderDocuments === 'object' ? parsed.bidderDocuments : {},
      extractedFacts: parsed.extractedFacts && typeof parsed.extractedFacts === 'object' ? parsed.extractedFacts : {},
      complianceStale: parsed.complianceStale && typeof parsed.complianceStale === 'object' ? parsed.complianceStale : {},
      deepAuditSyntheses: parsed.deepAuditSyntheses && typeof parsed.deepAuditSyntheses === 'object' ? parsed.deepAuditSyntheses : DEFAULT_DEMO_STATE.deepAuditSyntheses,
    };
  } catch {
    return getDefaultState();
  }
}

function saveToStorage(state: DemoState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save demo store to localStorage:', err);
  }
}

export const demoStore = {
  getDemoState(): DemoState {
    return loadFromStorage();
  },

  saveDemoState(state: DemoState): void {
    saveToStorage(state);
  },

  resetDemoState(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(DEMO_STORAGE_KEY);
    }
  },

  // -------------------------------------------------------------------------
  // TENDERS
  // -------------------------------------------------------------------------
  getTenders(): DemoTender[] {
    const state = loadFromStorage();
    return state.tenders;
  },

  getTender(id: string): DemoTender | null {
    const state = loadFromStorage();
    return state.tenders.find((t) => t.id === id || t.tender_number === id) || null;
  },

  createTender(data: TenderCreate, rfpFile?: File): DemoTender {
    const state = loadFromStorage();
    const tenderId = `tender_demo_${Date.now()}`;
    const now = new Date().toISOString();

    let attachedFile: DemoAttachedFile | null = null;
    if (rfpFile) {
      attachedFile = {
        filename: rfpFile.name,
        size_bytes: rfpFile.size,
        content_type: rfpFile.type || 'application/pdf',
        uploaded_at: now,
      };
    }

    const newTender: DemoTender = {
      id: tenderId,
      tender_number: data.tender_number,
      title: data.title,
      category: data.category || 'GOODS_AND_SERVICES',
      authority: data.authority || 'Procurement Authority',
      budget: data.budget || null,
      deadline: data.deadline || null,
      status: rfpFile ? 'RUNNING' : 'QUEUED',
      created_at: now,
      updated_at: now,
      attached_file: attachedFile,
    };

    state.tenders = [newTender, ...state.tenders];
    state.requirements[tenderId] = [];
    state.bidders[tenderId] = [];

    // Log audit events
    const createEvt: AuditEventRead = {
      id: `evt_${Date.now()}_1`,
      job_id: `job_${tenderId}`,
      stage: 'UPLOAD',
      status: 'COMPLETED',
      progress: 100,
      message: `Procurement tender "${data.title}" registered in demo workspace.`,
      timestamp: now,
    };

    state.auditEvents = [createEvt, ...state.auditEvents];
    saveToStorage(state);
    return newTender;
  },

  updateTenderStatus(tenderId: string, status: DemoTender['status']): void {
    const state = loadFromStorage();
    const index = state.tenders.findIndex((t) => t.id === tenderId || t.tender_number === tenderId);
    if (index !== -1) {
      state.tenders[index].status = status;
      state.tenders[index].updated_at = new Date().toISOString();
      saveToStorage(state);
    }
  },

  // -------------------------------------------------------------------------
  // REQUIREMENTS & AI EXTRACTION SIMULATION
  // -------------------------------------------------------------------------
  getRequirements(tenderId: string): TenderRequirementRead[] {
    const state = loadFromStorage();
    const tender = this.getTender(tenderId);
    const key = tender ? tender.id : tenderId;
    return state.requirements[key] || state.requirements[tenderId] || [];
  },

  setRequirements(tenderId: string, reqs: TenderRequirementRead[]): void {
    const state = loadFromStorage();
    const tender = this.getTender(tenderId);
    const key = tender ? tender.id : tenderId;
    state.requirements[key] = reqs;
    saveToStorage(state);
  },

  generateSyntheticRequirements(tenderId: string, budget?: number | null): TenderRequirementRead[] {
    const now = new Date().toISOString();
    const formattedBudget = budget ? `₹ ${(budget * 0.5).toLocaleString('en-IN')}` : 'INR 1,00,00,000';
    const turnoverVal = budget ? Math.round(budget * 0.5) : 10000000;

    return [
      {
        id: `req_${tenderId}_gst`,
        tender_id: tenderId,
        clause: 'Clause 1.1 (GST)',
        requirement_type: 'GST',
        field: 'tax.gstin',
        operator: 'EQ',
        expected_value: 'VALID_ACTIVE',
        unit: null,
        mandatory: true,
        source_page: 1,
        source_text: 'Bidder must possess a valid and active GSTIN registration in India. (Synthetic Demo Extraction)',
        confidence: 0.98,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: now,
      },
      {
        id: `req_${tenderId}_turnover`,
        tender_id: tenderId,
        clause: 'Clause 2.3 (Turnover)',
        requirement_type: 'TURNOVER',
        field: 'financial.average_annual_turnover',
        operator: 'GTE',
        expected_value: turnoverVal,
        unit: 'INR',
        mandatory: true,
        source_page: 3,
        source_text: `Minimum average annual turnover of at least ${formattedBudget} over the past 3 financial years. (Synthetic Demo Extraction)`,
        confidence: 0.95,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: now,
      },
      {
        id: `req_${tenderId}_experience`,
        tender_id: tenderId,
        clause: 'Clause 3.2 (Experience)',
        requirement_type: 'EXPERIENCE',
        field: 'experience.years',
        operator: 'GTE',
        expected_value: 3,
        unit: 'YEARS',
        mandatory: true,
        source_page: 5,
        source_text: 'Minimum 3 years of continuous operating experience in relevant project execution. (Synthetic Demo Extraction)',
        confidence: 0.92,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: now,
      },
      {
        id: `req_${tenderId}_oem`,
        tender_id: tenderId,
        clause: 'Clause 4.1 (Certification)',
        requirement_type: 'CUSTOM',
        field: 'credentials.oem_authorization',
        operator: 'EXISTS',
        expected_value: 'VALID_OEM_LETTER',
        unit: null,
        mandatory: true,
        source_page: 7,
        source_text: 'Original Equipment Manufacturer (OEM) authorization certificate / Technical certification required. (Synthetic Demo Extraction)',
        confidence: 0.89,
        requires_verification: true,
        is_approved: true,
        metadata_json: {},
        created_at: now,
      },
    ];
  },

  mergeRequirements(existing: TenderRequirementRead[], newReqs: TenderRequirementRead[]): TenderRequirementRead[] {
    const resultMap = new Map<string, TenderRequirementRead>();
    for (const item of existing) {
      resultMap.set(item.id, item);
      resultMap.set(`field:${item.field}`, item);
    }
    for (const item of newReqs) {
      const fieldKey = `field:${item.field}`;
      if (resultMap.has(fieldKey)) {
        const existingItem = resultMap.get(fieldKey)!;
        resultMap.set(existingItem.id, { ...existingItem, ...item, id: existingItem.id });
      } else if (resultMap.has(item.id)) {
        resultMap.set(item.id, item);
      } else {
        resultMap.set(item.id, item);
        resultMap.set(fieldKey, item);
      }
    }
    const finalReqs: TenderRequirementRead[] = [];
    const seenIds = new Set<string>();
    for (const item of resultMap.values()) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        finalReqs.push(item);
      }
    }
    return finalReqs;
  },

  extractCriteria(
    tenderId: string,
    customJobId?: string,
    onProgress?: (stage: string, progress: number) => void
  ): Promise<TenderRequirementRead[]> {
    const tender = this.getTender(tenderId);
    const resolvedTenderId = tender ? tender.id : tenderId;
    const jobId = customJobId || `job_extract_${Date.now()}`;

    this.createJob(jobId, 'UPLOAD', 'RUNNING', 0, resolvedTenderId);

    return new Promise((resolve, reject) => {
      try {
        const steps: {
          stage: JobStage;
          pct: number;
          status: JobStatus;
          action: string;
          msg: string;
        }[] = [
          { stage: 'UPLOAD', pct: 15, status: 'RUNNING', action: 'DOCUMENT_UPLOADED', msg: 'Tender RFP document uploaded for analysis.' },
          { stage: 'UPLOAD', pct: 25, status: 'RUNNING', action: 'PROCESSING_STARTED', msg: 'Synthetic criteria extraction pipeline started.' },
          { stage: 'PARSING', pct: 45, status: 'RUNNING', action: 'PARSING_COMPLETED', msg: 'Document text, sections, and tables parsed.' },
          { stage: 'EXTRACTION', pct: 65, status: 'RUNNING', action: 'EXTRACTION_COMPLETED', msg: 'AI extraction identified statutory and technical criteria.' },
          { stage: 'VERIFICATION', pct: 85, status: 'RUNNING', action: 'VERIFICATION_COMPLETED', msg: 'Rule definitions and mandatory flags verified.' },
          { stage: 'COMPLIANCE', pct: 95, status: 'RUNNING', action: 'COMPLIANCE_COMPLETED', msg: 'Compliance matrix initialized with extracted criteria.' },
          { stage: 'REPORTING', pct: 100, status: 'COMPLETED', action: 'PROCESSING_COMPLETED', msg: 'Synthetic extraction pipeline completed successfully.' },
        ];

        let stepIdx = 0;
        const interval = setInterval(() => {
          try {
            if (stepIdx < steps.length) {
              const step = steps[stepIdx];
              if (onProgress) onProgress(step.stage, step.pct);

              this.updateJob(jobId, {
                current_stage: step.stage,
                status: step.status,
                progress: step.pct,
              });

              const evt: AuditEventRead = {
                id: `evt_${Date.now()}_${stepIdx}_${Math.floor(Math.random() * 1000)}`,
                job_id: jobId,
                stage: step.stage,
                status: step.status === 'COMPLETED' ? 'COMPLETED' : 'RUNNING',
                progress: step.pct,
                message: step.msg,
                timestamp: new Date().toISOString(),
              };
              this.addAuditEvent(evt);
              stepIdx++;
            } else {
              clearInterval(interval);

              const generated = this.generateSyntheticRequirements(resolvedTenderId, tender?.budget);
              const existing = this.getRequirements(resolvedTenderId);
              const merged = this.mergeRequirements(existing, generated);

              this.setRequirements(resolvedTenderId, merged);
              this.updateTenderStatus(resolvedTenderId, 'COMPLETED');

              resolve(merged);
            }
          } catch (err: unknown) {
            clearInterval(interval);
            const errMsg = err instanceof Error ? err.message : 'Extraction step execution failed.';
            this.updateJob(jobId, {
              status: 'FAILED',
              error_message: errMsg,
            });
            const failEvt: AuditEventRead = {
              id: `evt_${Date.now()}_fail`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'FAILED',
              progress: 0,
              message: `Synthetic extraction failed: ${errMsg}`,
              timestamp: new Date().toISOString(),
            };
            this.addAuditEvent(failEvt);
            reject(err instanceof Error ? err : new Error(errMsg));
          }
        }, 300);
      } catch (outerErr: unknown) {
        const errMsg = outerErr instanceof Error ? outerErr.message : 'Extraction initialization failed.';
        this.updateJob(jobId, {
          status: 'FAILED',
          error_message: errMsg,
        });
        reject(outerErr instanceof Error ? outerErr : new Error(errMsg));
      }
    });
  },

  // -------------------------------------------------------------------------
  // BIDDERS
  // -------------------------------------------------------------------------
  getBidders(tenderId: string): BidderRead[] {
    const state = loadFromStorage();
    return state.bidders[tenderId] || [];
  },

  getBidder(bidderId: string): BidderRead | null {
    const state = loadFromStorage();
    for (const list of Object.values(state.bidders)) {
      const found = list.find((b) => b.id === bidderId);
      if (found) return found;
    }
    return null;
  },

  getVerifications(bidderId: string): VerificationResultRead[] {
    const state = loadFromStorage();
    return state.verifications[bidderId] || [];
  },

  getBidderDocuments(bidderId: string): DemoBidderDocument[] {
    const state = loadFromStorage();
    return state.bidderDocuments?.[bidderId] || [];
  },

  getBidderFacts(bidderId: string): FactRead[] {
    const state = loadFromStorage();
    return state.extractedFacts?.[bidderId] || [];
  },

  isComplianceStale(bidderId: string): boolean {
    const state = loadFromStorage();
    return Boolean(state.complianceStale?.[bidderId]);
  },

  async uploadBidderDocument(bidderId: string, file: File): Promise<UploadBidderDocumentResult> {
    const bidder = this.getBidder(bidderId);
    if (!bidder) {
      throw new Error(`Bidder not found: ${bidderId}`);
    }

    const state = loadFromStorage();
    if (!state.bidderDocuments) state.bidderDocuments = {};
    if (!state.extractedFacts) state.extractedFacts = {};
    if (!state.complianceStale) state.complianceStale = {};

    const existingDocs = state.bidderDocuments[bidderId] || [];

    // Read file bytes
    const buffer = await file.arrayBuffer();
    const sha256 = await computeSha256(buffer);

    // 12. DUPLICATE DOCUMENT HANDLING
    const isDuplicate = existingDocs.some((d) => d.sha256 === sha256);
    if (isDuplicate) {
      throw new Error(`Duplicate document detected: This exact document ("${file.name}") has already been uploaded for this bidder.`);
    }

    const now = new Date().toISOString();
    const docId = `doc_demo_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const jobId = `job_doc_${docId}`;

    // Audit Event 1: BIDDER_DOCUMENT_UPLOADED
    const uploadEvt: AuditEventRead = {
      id: `evt_${Date.now()}_up`,
      job_id: jobId,
      stage: 'UPLOAD',
      status: 'COMPLETED',
      progress: 20,
      message: `BIDDER_DOCUMENT_UPLOADED: Document "${file.name}" (${(file.size / 1024).toFixed(1)} KB) uploaded for bidder "${bidder.bidder_name}".`,
      timestamp: now,
    };
    state.auditEvents = [uploadEvt, ...state.auditEvents];

    // Audit Event 2: BIDDER_DOCUMENT_PROCESSING_STARTED
    const procStartEvt: AuditEventRead = {
      id: `evt_${Date.now()}_start`,
      job_id: jobId,
      stage: 'PARSING',
      status: 'RUNNING',
      progress: 40,
      message: `BIDDER_DOCUMENT_PROCESSING_STARTED: Starting text extraction and statutory fact identification for "${file.name}".`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [procStartEvt, ...state.auditEvents];

    // Parse PDF text client-side
    let fullText = '';
    let pages = [{ page: 1, text: '' }];
    try {
      if (file.name.toLowerCase().endsWith('.pdf') || file.type.includes('pdf')) {
        const parsed = await parsePdfText(buffer);
        fullText = parsed.fullText;
        pages = parsed.pages;
      } else {
        const decoder = new TextDecoder('utf-8');
        fullText = decoder.decode(buffer);
        pages = [{ page: 1, text: fullText }];
      }
    } catch (parseErr: unknown) {
      const parseErrMsg = parseErr instanceof Error ? parseErr.message : 'PDF text parsing failed';
      const failEvt: AuditEventRead = {
        id: `evt_${Date.now()}_fail`,
        job_id: jobId,
        stage: 'PARSING',
        status: 'FAILED',
        progress: 0,
        message: `BIDDER_DOCUMENT_PARSING_FAILED: Could not parse text-layer from "${file.name}": ${parseErrMsg}`,
        timestamp: new Date().toISOString(),
      };
      state.auditEvents = [failEvt, ...state.auditEvents];
      saveToStorage(state);
      throw new Error(`Failed to parse document text: ${parseErrMsg}`);
    }

    // Audit Event 3: BIDDER_DOCUMENT_PARSED
    const parsedEvt: AuditEventRead = {
      id: `evt_${Date.now()}_parsed`,
      job_id: jobId,
      stage: 'PARSING',
      status: 'RUNNING',
      progress: 60,
      message: `BIDDER_DOCUMENT_PARSED: Successfully parsed text-layer PDF "${file.name}" (${pages.length} pages, ${fullText.length} characters).`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [parsedEvt, ...state.auditEvents];

    // Extract facts
    const candidates = extractBidderFacts({ numPages: pages.length, fullText, pages });
    const docType = inferDocumentType(file.name, fullText);

    const extractedFacts: FactRead[] = [];
    const mismatches: Array<{ field: string; existing_value: string; extracted_value: string }> = [];
    let enrichedCount = 0;

    // Track profile enrichment changes
    const enrichedFields: Partial<BidderRead> = {};

    candidates.forEach((cand, idx) => {
      const factId = `fact_${Date.now()}_${idx}`;
      let reconStatus: 'MATCH' | 'ENRICHED' | 'MISMATCH' | 'NEW_DOCUMENT_FACT' = 'MATCH';

      if (cand.field === 'company_name') {
        const existingVal = bidder.bidder_name || '';
        const normExisting = existingVal.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normExtracted = cand.value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!existingVal || existingVal === 'Not Registered') {
          enrichedFields.bidder_name = cand.value;
          enrichedCount++;
          reconStatus = 'ENRICHED';
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_enr_company`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_PROFILE_ENRICHED_FROM_DOCUMENT: Populated missing bidder company name with "${cand.value}".`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        } else if (normExisting === normExtracted || normExisting.includes(normExtracted) || normExtracted.includes(normExisting)) {
          reconStatus = 'MATCH';
        } else {
          reconStatus = 'MISMATCH';
          mismatches.push({ field: 'Company Name', existing_value: existingVal, extracted_value: cand.value });
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_mis_company`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_DOCUMENT_MISMATCH_DETECTED: Conflicting Company Name: claimed "${existingVal}" vs document "${cand.value}". Original preserved.`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        }
      } else if (cand.field === 'gstin') {
        const existingVal = bidder.gstin || '';
        if (!existingVal || existingVal.trim() === 'Not Registered') {
          enrichedFields.gstin = cand.value;
          enrichedCount++;
          reconStatus = 'ENRICHED';
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_enr_gstin`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_PROFILE_ENRICHED_FROM_DOCUMENT: Populated missing GSTIN with "${cand.value}".`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        } else if (existingVal.trim().toUpperCase() === cand.value.trim().toUpperCase()) {
          reconStatus = 'MATCH';
        } else {
          reconStatus = 'MISMATCH';
          mismatches.push({ field: 'GSTIN', existing_value: existingVal, extracted_value: cand.value });
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_mis_gstin`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_DOCUMENT_MISMATCH_DETECTED: Conflicting GSTIN: claimed "${existingVal}" vs document "${cand.value}". Original preserved.`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        }
      } else if (cand.field === 'pan') {
        const existingVal = bidder.pan || '';
        if (!existingVal || existingVal.trim() === 'Not Registered') {
          enrichedFields.pan = cand.value;
          enrichedCount++;
          reconStatus = 'ENRICHED';
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_enr_pan`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_PROFILE_ENRICHED_FROM_DOCUMENT: Populated missing PAN with "${cand.value}".`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        } else if (existingVal.trim().toUpperCase() === cand.value.trim().toUpperCase()) {
          reconStatus = 'MATCH';
        } else {
          reconStatus = 'MISMATCH';
          mismatches.push({ field: 'PAN', existing_value: existingVal, extracted_value: cand.value });
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_mis_pan`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_DOCUMENT_MISMATCH_DETECTED: Conflicting PAN: claimed "${existingVal}" vs document "${cand.value}". Original preserved.`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        }
      } else if (cand.field === 'cin') {
        const existingVal = bidder.cin || '';
        if (!existingVal || existingVal.trim() === 'Not Registered') {
          enrichedFields.cin = cand.value;
          enrichedCount++;
          reconStatus = 'ENRICHED';
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_enr_cin`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_PROFILE_ENRICHED_FROM_DOCUMENT: Populated missing CIN with "${cand.value}".`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        } else if (existingVal.trim().toUpperCase() === cand.value.trim().toUpperCase()) {
          reconStatus = 'MATCH';
        } else {
          reconStatus = 'MISMATCH';
          mismatches.push({ field: 'CIN', existing_value: existingVal, extracted_value: cand.value });
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_mis_cin`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_DOCUMENT_MISMATCH_DETECTED: Conflicting CIN: claimed "${existingVal}" vs document "${cand.value}". Original preserved.`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        }
      } else if (cand.field === 'udyam_number') {
        const existingVal = bidder.udyam_number || '';
        if (!existingVal || existingVal.trim() === 'Not Registered') {
          enrichedFields.udyam_number = cand.value;
          enrichedCount++;
          reconStatus = 'ENRICHED';
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_enr_udyam`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_PROFILE_ENRICHED_FROM_DOCUMENT: Populated missing UDYAM Number with "${cand.value}".`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        } else if (existingVal.trim().toUpperCase() === cand.value.trim().toUpperCase()) {
          reconStatus = 'MATCH';
        } else {
          reconStatus = 'MISMATCH';
          mismatches.push({ field: 'UDYAM Number', existing_value: existingVal, extracted_value: cand.value });
          state.auditEvents = [
            {
              id: `evt_${Date.now()}_mis_udyam`,
              job_id: jobId,
              stage: 'EXTRACTION',
              status: 'RUNNING',
              progress: 80,
              message: `BIDDER_DOCUMENT_MISMATCH_DETECTED: Conflicting UDYAM: claimed "${existingVal}" vs document "${cand.value}". Original preserved.`,
              timestamp: new Date().toISOString(),
            },
            ...state.auditEvents,
          ];
        }
      } else if (cand.field === 'bidder_reference') {
        reconStatus = 'NEW_DOCUMENT_FACT';
      }

      // Audit Event 4: BIDDER_FACT_EXTRACTED
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_fact_${idx}`,
          job_id: jobId,
          stage: 'EXTRACTION',
          status: 'RUNNING',
          progress: 85,
          message: `BIDDER_FACT_EXTRACTED: Extracted ${cand.label} (${cand.field}) = "${cand.value}" [${reconStatus}].`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];

      extractedFacts.push({
        id: factId,
        document_id: docId,
        bidder_id: bidderId,
        field: cand.field,
        value: cand.value,
        source_page: cand.sourcePage,
        source_text: cand.sourceText,
        confidence: cand.confidence,
        metadata_json: {
          provenance: 'DOCUMENT_DEMO_DATA',
          source_document: file.name,
          reconciliation_status: reconStatus,
        } as unknown as Record<string, never>,
        created_at: now,
      });
    });

    const demoDoc: DemoBidderDocument = {
      id: docId,
      bidder_id: bidderId,
      tender_id: bidder.tender_id,
      filename: file.name,
      document_type: docType,
      content_type: file.type || 'application/pdf',
      size_bytes: file.size,
      sha256: sha256,
      storage_uri: `demo://documents/${bidderId}/${file.name}`,
      status: 'PROCESSED',
      facts_count: extractedFacts.length,
      extracted_facts: extractedFacts,
      mismatches,
      created_at: now,
      metadata_json: {},
    };

    // Update bidder in state.bidders
    for (const [tenderId, list] of Object.entries(state.bidders)) {
      const idx = list.findIndex((b) => b.id === bidderId);
      if (idx !== -1) {
        const existing = list[idx];
        const existingDocs = existing.documents || [];
        state.bidders[tenderId][idx] = {
          ...existing,
          ...enrichedFields,
          documents: [demoDoc, ...existingDocs],
        };
        break;
      }
    }

    state.bidderDocuments[bidderId] = [demoDoc, ...(state.bidderDocuments[bidderId] || [])];
    state.extractedFacts[bidderId] = [...extractedFacts, ...(state.extractedFacts[bidderId] || [])];

    // 9. COMPLIANCE INVALIDATION: mark compliance stale without modifying humanDecisions
    state.complianceStale[bidderId] = true;

    // Audit Event 5: BIDDER_DOCUMENT_PROCESSING_COMPLETED
    const compEvt: AuditEventRead = {
      id: `evt_${Date.now()}_complete`,
      job_id: jobId,
      stage: 'EXTRACTION',
      status: 'COMPLETED',
      progress: 100,
      message: `BIDDER_DOCUMENT_PROCESSING_COMPLETED: Finished processing "${file.name}". ${extractedFacts.length} facts extracted.${enrichedCount > 0 ? ` ${enrichedCount} profile identifier(s) enriched.` : ''}`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [compEvt, ...state.auditEvents];

    saveToStorage(state);

    return {
      document: demoDoc,
      extractedFacts,
      enrichedCount,
      mismatches,
      factsCount: extractedFacts.length,
    };
  },

  createBidder(tenderId: string, data: BidderCreate): BidderRead {
    const state = loadFromStorage();
    const bidderId = `bidder_demo_${Date.now()}`;
    const now = new Date().toISOString();

    const newBidder: BidderRead = {
      id: bidderId,
      tender_id: tenderId,
      bidder_name: data.bidder_name,
      gstin: data.gstin || null,
      pan: data.pan || null,
      udyam_number: data.udyam_number || null,
      cin: data.cin || null,
      status: 'PENDING',
      metadata_json: {},
      created_at: now,
      documents: [],
    };

    if (!state.bidders[tenderId]) {
      state.bidders[tenderId] = [];
    }
    state.bidders[tenderId] = [newBidder, ...state.bidders[tenderId]];

    // Ensure verifications array exists
    if (!state.verifications) state.verifications = {};
    state.verifications[bidderId] = [];

    // Default pending decision
    if (!state.humanDecisions) state.humanDecisions = {};
    state.humanDecisions[bidderId] = 'PENDING';

    // Compliance matrix linked to tender's actual extracted requirements
    if (!state.complianceMatrices) state.complianceMatrices = {};
    const tenderReqs = state.requirements[tenderId] || [];
    if (tenderReqs.length > 0) {
      state.complianceMatrices[bidderId] = {
        bidder_id: bidderId,
        tender_id: tenderId,
        overall_status: 'REVIEW_REQUIRED',
        run_id: `run_init_${Date.now()}`,
        historical_limitations_notice: 'Pending compliance evaluation against extracted tender criteria.',
        rows: tenderReqs.map((req) => ({
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value,
          observed_value: 'PENDING_EVALUATION',
          status: 'REVIEW_REQUIRED' as const,
          reason_code: 'AWAITING_EVALUATION',
          evidence_ids: [],
          review_required: true,
        })),
      };
    } else {
      state.complianceMatrices[bidderId] = {
        bidder_id: bidderId,
        tender_id: tenderId,
        overall_status: 'REVIEW_REQUIRED',
        run_id: `run_init_${Date.now()}`,
        historical_limitations_notice: 'Pending criteria extraction and compliance evaluation.',
        rows: [],
      };
    }

    // Log audit event
    const evt: AuditEventRead = {
      id: `evt_${Date.now()}_bidder`,
      job_id: `job_bidder_${bidderId}`,
      stage: 'UPLOAD',
      status: 'COMPLETED',
      progress: 100,
      message: `Bidder "${data.bidder_name}" registered for tender in demo workspace.`,
      timestamp: now,
    };
    state.auditEvents = [evt, ...state.auditEvents];

    saveToStorage(state);
    return newBidder;
  },

  // -------------------------------------------------------------------------
  // STATUTORY CHECKS (SYNTHETIC PIPELINE)
  // -------------------------------------------------------------------------
  runStatutoryChecks(bidderId: string): Promise<VerificationResultRead[]> {
    const bidder = this.getBidder(bidderId);
    if (!bidder) {
      return Promise.reject(new Error(`Bidder not found: ${bidderId}`));
    }

    const state = loadFromStorage();
    const now = new Date().toISOString();
    const results: VerificationResultRead[] = [];

    // Audit event: STATUTORY_CHECKS_STARTED
    const startEvt: AuditEventRead = {
      id: `evt_${Date.now()}_stat_start`,
      job_id: `job_verify_${bidderId}`,
      stage: 'VERIFICATION',
      status: 'RUNNING',
      progress: 10,
      action: 'STATUTORY_CHECKS_STARTED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}?mode=demo`,
      message: `STATUTORY_CHECKS_STARTED: Statutory verification initiated for bidder "${bidder.bidder_name}".`,
      timestamp: now,
    };
    state.auditEvents = [startEvt, ...state.auditEvents];

    // 1. GSTIN Check
    if (bidder.gstin && bidder.gstin.trim() && bidder.gstin.trim() !== 'Not Registered') {
      results.push({
        id: `vr_${bidderId}_gstin`,
        bidder_id: bidderId,
        field: 'gstin',
        claimed_value: bidder.gstin,
        verified_value: 'Active (Tax Regular)',
        status: 'VERIFIED',
        source: 'GST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: `DEMO-GSTN-${Date.now().toString().slice(-7)}`,
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_gst`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 30,
          action: 'GST_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `GST_VERIFICATION_COMPLETED: GSTIN ${bidder.gstin} verified as Active (Tax Regular).`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    } else {
      results.push({
        id: `vr_${bidderId}_gstin`,
        bidder_id: bidderId,
        field: 'gstin',
        claimed_value: 'Not Registered',
        verified_value: 'No GSTIN record found',
        status: 'UNAVAILABLE',
        source: 'GST_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: 'DEMO-GSTN-NOT-FOUND',
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_gst`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 30,
          action: 'GST_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `GST_VERIFICATION_COMPLETED: GSTIN not registered or unavailable.`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    }

    // 2. PAN Check
    if (bidder.pan && bidder.pan.trim() && bidder.pan.trim() !== 'Not Registered') {
      results.push({
        id: `vr_${bidderId}_pan`,
        bidder_id: bidderId,
        field: 'pan',
        claimed_value: bidder.pan,
        verified_value: 'Active and Operative (CBDT)',
        status: 'VERIFIED',
        source: 'MCA_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: `DEMO-CBDT-${Date.now().toString().slice(-7)}`,
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_pan`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 55,
          action: 'PAN_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `PAN_VERIFICATION_COMPLETED: PAN ${bidder.pan} verified as Active and Operative (CBDT).`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    } else {
      results.push({
        id: `vr_${bidderId}_pan`,
        bidder_id: bidderId,
        field: 'pan',
        claimed_value: 'Not Registered',
        verified_value: 'No PAN record provided',
        status: 'UNAVAILABLE',
        source: 'MCA_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: 'DEMO-CBDT-NOT-FOUND',
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_pan`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 55,
          action: 'PAN_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `PAN_VERIFICATION_COMPLETED: PAN not registered or unavailable.`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    }

    // 3. CIN Check
    if (bidder.cin && bidder.cin.trim() && bidder.cin.trim() !== 'Not Registered') {
      results.push({
        id: `vr_${bidderId}_cin`,
        bidder_id: bidderId,
        field: 'cin',
        claimed_value: bidder.cin,
        verified_value: 'Active (Incorporated - RoC MCA)',
        status: 'VERIFIED',
        source: 'MCA_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: `DEMO-MCA-${Date.now().toString().slice(-7)}`,
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_cin`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 75,
          action: 'CIN_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `CIN_VERIFICATION_COMPLETED: Corporate Identity ${bidder.cin} verified (RoC MCA).`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    } else {
      results.push({
        id: `vr_${bidderId}_cin`,
        bidder_id: bidderId,
        field: 'cin',
        claimed_value: 'Not Registered',
        verified_value: 'No MCA/CIN record found',
        status: 'UNAVAILABLE',
        source: 'MCA_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: 'DEMO-MCA-NOT-FOUND',
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_cin`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 75,
          action: 'CIN_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `CIN_VERIFICATION_COMPLETED: CIN not registered or unavailable.`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    }

    // 4. UDYAM Check (only if registered or appropriate synthetic result)
    if (bidder.udyam_number && bidder.udyam_number.trim() && bidder.udyam_number.trim() !== 'Not Registered') {
      results.push({
        id: `vr_${bidderId}_udyam`,
        bidder_id: bidderId,
        field: 'udyam_number',
        claimed_value: bidder.udyam_number,
        verified_value: 'Micro / Small Enterprise (MSME Udyam Verified)',
        status: 'VERIFIED',
        source: 'UDYAM_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: `DEMO-UDYAM-${Date.now().toString().slice(-6)}`,
      });
      state.auditEvents = [
        {
          id: `evt_${Date.now()}_udyam`,
          job_id: `job_verify_${bidderId}`,
          stage: 'VERIFICATION',
          status: 'RUNNING',
          progress: 90,
          action: 'UDYAM_VERIFICATION_COMPLETED',
          entity_type: 'BIDDER',
          entity_id: bidderId,
          mode: 'DEMO',
          source: 'DEMO_STORE / SYNTHETIC',
          bidder_id: bidderId,
          target_url: `/workspace/bidders/${bidderId}?mode=demo`,
          message: `UDYAM_VERIFICATION_COMPLETED: UDYAM ${bidder.udyam_number} verified as MSME Registered.`,
          timestamp: new Date().toISOString(),
        },
        ...state.auditEvents,
      ];
    } else {
      // UDYAM is Not Registered: DO NOT fabricate VERIFIED.
      results.push({
        id: `vr_${bidderId}_udyam`,
        bidder_id: bidderId,
        field: 'udyam_number',
        claimed_value: 'Not Registered',
        verified_value: 'Not Registered / Exemption Verification Required',
        status: 'UNAVAILABLE',
        source: 'UDYAM_DEMO_DATA',
        mode: 'DEMO',
        checked_at: now,
        verification_reference: 'DEMO-UDYAM-NOT-REGISTERED',
      });
    }

    // Final Audit: STATUTORY_CHECKS_COMPLETED
    const completeEvt: AuditEventRead = {
      id: `evt_${Date.now()}_stat_done`,
      job_id: `job_verify_${bidderId}`,
      stage: 'VERIFICATION',
      status: 'COMPLETED',
      progress: 100,
      action: 'STATUTORY_CHECKS_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}?mode=demo`,
      message: `STATUTORY_CHECKS_COMPLETED: Statutory verification checks completed (${results.length} checks recorded) for bidder "${bidder.bidder_name}".`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [completeEvt, ...state.auditEvents];

    if (!state.verifications) state.verifications = {};
    state.verifications[bidderId] = results;
    saveToStorage(state);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(results);
      }, 300);
    });
  },

  // -------------------------------------------------------------------------
  // COMPLIANCE MATRIX & REPORTS
  // -------------------------------------------------------------------------
  evaluateCompliance(bidderId: string): Promise<ComplianceMatrixRead> {
    const bidder = this.getBidder(bidderId);
    if (!bidder) {
      return Promise.reject(new Error(`Bidder not found: ${bidderId}`));
    }

    const state = loadFromStorage();
    const tenderId = bidder.tender_id;
    let requirements = state.requirements[tenderId] || [];

    if (requirements.length === 0) {
      const tender = this.getTender(tenderId);
      requirements = this.generateSyntheticRequirements(tenderId, tender?.budget);
      state.requirements[tenderId] = requirements;
    }

    const verifications = state.verifications[bidderId] || [];
    const gstVer = verifications.find((v) => v.field === 'gstin');
    const panVer = verifications.find((v) => v.field === 'pan');
    const cinVer = verifications.find((v) => v.field === 'cin');

    const tender = this.getTender(tenderId);
    const budget = tender?.budget || 50000000;

    // Audit: COMPLIANCE_EVALUATION_STARTED
    const startEvt: AuditEventRead = {
      id: `evt_${Date.now()}_comp_start`,
      job_id: `job_compliance_${bidderId}`,
      stage: 'COMPLIANCE',
      status: 'RUNNING',
      progress: 10,
      action: 'COMPLIANCE_EVALUATION_STARTED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      tender_id: tenderId,
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}/matrix?mode=demo`,
      message: `COMPLIANCE_EVALUATION_STARTED: Evaluating compliance against tender requirements for "${bidder.bidder_name}".`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [startEvt, ...state.auditEvents];

    const rows: ComplianceMatrixRow[] = requirements.map((req) => {
      const type = (req.requirement_type || '').toUpperCase();
      const field = (req.field || '').toLowerCase();

      // GST rule
      if (type === 'GST' || field.includes('gst')) {
        const isGstOk = (gstVer && gstVer.status === 'VERIFIED') || (Boolean(bidder.gstin) && bidder.gstin !== 'Not Registered');
        if (isGstOk) {
          return {
            requirement_id: req.id,
            clause: req.clause,
            requirement_type: req.requirement_type,
            field: req.field,
            operator: req.operator,
            expected_value: req.expected_value || 'VALID_ACTIVE',
            unit: req.unit,
            mandatory: req.mandatory,
            status: 'PASS',
            reason_code: 'EXACT_MATCH',
            observed_value: 'VALID_ACTIVE',
            evidence_ids: [`ev_gst_${bidderId}`],
            review_required: false,
          };
        } else {
          return {
            requirement_id: req.id,
            clause: req.clause,
            requirement_type: req.requirement_type,
            field: req.field,
            operator: req.operator,
            expected_value: req.expected_value || 'VALID_ACTIVE',
            unit: req.unit,
            mandatory: req.mandatory,
            status: req.mandatory ? 'FAIL' : 'REVIEW_REQUIRED',
            reason_code: 'MISSING_DOCUMENT',
            observed_value: 'NOT_PROVIDED',
            evidence_ids: [],
            review_required: true,
          };
        }
      }

      // PAN rule
      if (type === 'PAN' || field.includes('pan')) {
        const isPanOk = (panVer && panVer.status === 'VERIFIED') || (Boolean(bidder.pan) && bidder.pan !== 'Not Registered');
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value || 'VALID_ACTIVE',
          unit: req.unit,
          mandatory: req.mandatory,
          status: isPanOk ? 'PASS' : (req.mandatory ? 'FAIL' : 'REVIEW_REQUIRED'),
          reason_code: isPanOk ? 'EXACT_MATCH' : 'MISSING_DOCUMENT',
          observed_value: isPanOk ? 'VALID_ACTIVE' : 'NOT_PROVIDED',
          evidence_ids: isPanOk ? [`ev_pan_${bidderId}`] : [],
          review_required: !isPanOk,
        };
      }

      // CIN rule
      if (type === 'CIN' || field.includes('cin')) {
        const isCinOk = (cinVer && cinVer.status === 'VERIFIED') || (Boolean(bidder.cin) && bidder.cin !== 'Not Registered');
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value || 'VALID_ACTIVE',
          unit: req.unit,
          mandatory: req.mandatory,
          status: isCinOk ? 'PASS' : (req.mandatory ? 'FAIL' : 'REVIEW_REQUIRED'),
          reason_code: isCinOk ? 'EXACT_MATCH' : 'MISSING_DOCUMENT',
          observed_value: isCinOk ? 'VALID_ACTIVE' : 'NOT_PROVIDED',
          evidence_ids: isCinOk ? [`ev_cin_${bidderId}`] : [],
          review_required: !isCinOk,
        };
      }

      // Turnover rule
      if (type === 'TURNOVER' || field.includes('turnover')) {
        const expectedNum = typeof req.expected_value === 'number' ? req.expected_value : budget;
        const observedNum = Math.round(expectedNum * 1.15);
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value,
          unit: req.unit || 'INR',
          mandatory: req.mandatory,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          observed_value: observedNum,
          evidence_ids: [`ev_to_${bidderId}`],
          review_required: false,
        };
      }

      // Experience rule
      if (type === 'EXPERIENCE' || field.includes('experience')) {
        const expectedYears = typeof req.expected_value === 'number' ? req.expected_value : 3;
        const observedYears = expectedYears + 2;
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value,
          unit: req.unit || 'YEARS',
          mandatory: req.mandatory,
          status: 'PASS',
          reason_code: 'NUMERIC_GTE',
          observed_value: observedYears,
          evidence_ids: [`ev_exp_${bidderId}`],
          review_required: false,
        };
      }

      // UDYAM / MSME rule
      if (type === 'MSME' || field.includes('udyam') || field.includes('msme')) {
        const udyamVer = verifications.find((v) => v.field === 'udyam_number');
        const isUdyamOk = (udyamVer && udyamVer.status === 'VERIFIED') || (Boolean(bidder.udyam_number) && bidder.udyam_number !== 'Not Registered');
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value || 'MSME_REGISTERED',
          unit: req.unit,
          mandatory: req.mandatory,
          status: isUdyamOk ? 'PASS' : (req.mandatory ? 'FAIL' : 'REVIEW_REQUIRED'),
          reason_code: isUdyamOk ? 'EXACT_MATCH' : 'MISSING_DOCUMENT',
          observed_value: isUdyamOk ? (bidder.udyam_number || 'MSME_REGISTERED') : 'NOT_REGISTERED',
          evidence_ids: isUdyamOk ? [`ev_udyam_${bidderId}`] : [],
          review_required: !isUdyamOk,
        };
      }

      // OEM Authorization / Custom certificate rule
      if (type === 'CUSTOM' || field.includes('oem') || field.includes('authorization') || field.includes('cert')) {
        const hasDoc = (bidder.documents && bidder.documents.length > 0) || (state.bidderDocuments?.[bidderId] && state.bidderDocuments[bidderId].length > 0);
        return {
          requirement_id: req.id,
          clause: req.clause,
          requirement_type: req.requirement_type,
          field: req.field,
          operator: req.operator,
          expected_value: req.expected_value || 'VALID_OEM_LETTER',
          unit: req.unit,
          mandatory: req.mandatory,
          status: hasDoc ? 'PASS' : 'REVIEW_REQUIRED',
          reason_code: hasDoc ? 'EXACT_MATCH' : 'MANUAL_DOCUMENT_VERIFICATION_REQUIRED',
          observed_value: hasDoc ? 'VALID_OEM_LETTER' : 'PENDING_OFFICER_VERIFICATION',
          evidence_ids: hasDoc ? [`ev_doc_${bidderId}`] : [],
          review_required: !hasDoc,
        };
      }

      // Generic fallback
      return {
        requirement_id: req.id,
        clause: req.clause,
        requirement_type: req.requirement_type,
        field: req.field,
        operator: req.operator,
        expected_value: req.expected_value || 'COMPLIANT',
        unit: req.unit,
        mandatory: req.mandatory,
        status: 'PASS',
        reason_code: 'EXACT_MATCH',
        observed_value: req.expected_value || 'COMPLIANT',
        evidence_ids: [`ev_gen_${bidderId}_${req.id}`],
        review_required: false,
      };
    });

    let overall_status: 'PASS' | 'FAIL' | 'REVIEW_REQUIRED' = 'PASS';
    if (rows.some((r) => r.status === 'FAIL')) {
      overall_status = 'FAIL';
    } else if (rows.some((r) => r.status === 'REVIEW_REQUIRED')) {
      overall_status = 'REVIEW_REQUIRED';
    }

    // Audit: Per-Clause CLAUSE_EVALUATED events
    const clauseEvents: AuditEventRead[] = rows.map((r, idx) => {
      const clauseRef = r.clause || `Clause ${idx + 1}`;
      const statusText = r.status === 'PASS' ? 'SATISFIED' : (r.status === 'FAIL' ? 'FAILED' : 'REVIEW_REQUIRED');
      return {
        id: `evt_${Date.now()}_clause_${r.requirement_id || idx}`,
        job_id: `job_compliance_${bidderId}`,
        stage: 'COMPLIANCE',
        status: r.status === 'PASS' ? 'COMPLETED' : (r.status === 'FAIL' ? 'FAILED' : 'RUNNING'),
        progress: 80,
        action: 'CLAUSE_EVALUATED',
        entity_type: 'REQUIREMENT',
        entity_id: r.requirement_id || `req_${idx}`,
        mode: 'DEMO' as const,
        source: 'DEMO_STORE / SYNTHETIC' as const,
        tender_id: tenderId,
        bidder_id: bidderId,
        requirement_id: r.requirement_id,
        clause_reference: clauseRef,
        target_url: `/workspace/bidders/${bidderId}/matrix?requirement=${r.requirement_id}&mode=demo`,
        message: `Clause ${clauseRef} (${r.field || 'N/A'}): ${statusText} - Expected ${r.operator || '='} ${r.expected_value}, observed ${r.observed_value}`,
        timestamp: new Date(Date.now() + idx * 5).toISOString(),
        payload_json: {
          tender_id: tenderId,
          bidder_id: bidderId,
          requirement_id: r.requirement_id,
          clause_reference: clauseRef,
          field: r.field,
          operator: r.operator,
          expected_value: r.expected_value,
          observed_value: r.observed_value,
          status: r.status,
          reason_code: r.reason_code,
          evidence_ids: r.evidence_ids,
          target_url: `/workspace/bidders/${bidderId}/matrix?requirement=${r.requirement_id}&mode=demo`,
        },
      };
    });
    state.auditEvents = [...clauseEvents, ...state.auditEvents];

    // Audit: RULE_EVALUATION_COMPLETED
    const ruleEvt: AuditEventRead = {
      id: `evt_${Date.now()}_rule_eval`,
      job_id: `job_compliance_${bidderId}`,
      stage: 'COMPLIANCE',
      status: 'RUNNING',
      progress: 80,
      action: 'RULE_EVALUATION_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      tender_id: tenderId,
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}/matrix?mode=demo`,
      message: `RULE_EVALUATION_COMPLETED: Evaluated ${rows.length} tender rules for bidder "${bidder.bidder_name}".`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [ruleEvt, ...state.auditEvents];

    // Audit: COMPLIANCE_EVALUATION_COMPLETED
    const completeEvt: AuditEventRead = {
      id: `evt_${Date.now()}_comp_done`,
      job_id: `job_compliance_${bidderId}`,
      stage: 'COMPLIANCE',
      status: 'COMPLETED',
      progress: 100,
      action: 'COMPLIANCE_EVALUATION_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      tender_id: tenderId,
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}/matrix?mode=demo`,
      message: `COMPLIANCE_EVALUATION_COMPLETED: Deterministic evaluation concluded with overall status: ${overall_status} (${rows.filter((r) => r.status === 'PASS').length}/${rows.length} rules satisfied).`,
      timestamp: new Date().toISOString(),
    };
    state.auditEvents = [completeEvt, ...state.auditEvents];

    const matrix: ComplianceMatrixRead = {
      bidder_id: bidderId,
      tender_id: tenderId,
      overall_status,
      run_id: `run_eval_${Date.now()}`,
      historical_limitations_notice: 'Deterministic compliance evaluation based on tender RFP criteria.',
      rows,
    };

    if (!state.complianceMatrices) state.complianceMatrices = {};
    state.complianceMatrices[bidderId] = matrix;
    if (!state.complianceStale) state.complianceStale = {};
    state.complianceStale[bidderId] = false;
    saveToStorage(state);

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(matrix);
      }, 300);
    });
  },

  getComplianceMatrix(bidderId: string): ComplianceMatrixRead | null {
    const state = loadFromStorage();
    return state.complianceMatrices[bidderId] || null;
  },

  recordHumanDecision(bidderId: string, decision: HumanDecisionStatus): void {
    const state = loadFromStorage();
    state.humanDecisions[bidderId] = decision;

    // Update bidder status
    for (const tenderId of Object.keys(state.bidders)) {
      const idx = state.bidders[tenderId].findIndex((b) => b.id === bidderId);
      if (idx !== -1) {
        state.bidders[tenderId][idx].status = decision;
        break;
      }
    }

    // Log audit event
    const evt: AuditEventRead = {
      id: `evt_${Date.now()}_decision`,
      job_id: `job_decision_${bidderId}`,
      stage: 'REPORTING',
      status: 'COMPLETED',
      progress: 100,
      action: 'HUMAN_DECISION_RECORDED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}/review?mode=demo`,
      message: `Officer recorded human decision: ${decision} for bidder ${bidderId}.`,
      timestamp: new Date().toISOString(),
      payload_json: {
        bidder_id: bidderId,
        officer_decision: decision,
        status: decision,
        target_url: `/workspace/bidders/${bidderId}/review?mode=demo`,
      },
    };
    state.auditEvents = [evt, ...state.auditEvents];

    saveToStorage(state);
  },

  recordDeepAuditSynthesis(bidderId: string, synthesis: DeepAuditSynthesis): void {
    const state = loadFromStorage();
    if (!state.deepAuditSyntheses) state.deepAuditSyntheses = {};
    state.deepAuditSyntheses[bidderId] = {
      ...synthesis,
      is_advisory: true,
      advisory_disclaimer: synthesis.advisory_disclaimer || 'Advisory Analysis Only: Deep Audit provides supplemental investigation assistance and anomaly detection. It does not alter compliance evaluations, mutate bidder statuses, or override procurement officer authority. Final decision remains with the human procurement officer.',
    };

    // Strict Authority Invariant: Advisory investigation NEVER mutates bidder status!
    const conflictsCount = synthesis.conflicts_count ?? (synthesis.cross_document_conflicts?.length ?? (synthesis.conflicts_detected?.length ?? 0));
    const precedentsCount = synthesis.policy_precedents?.length ?? (synthesis.rag_investigations?.length ?? 0);
    const evt: AuditEventRead = {
      id: `evt_${Date.now()}_deep_audit`,
      job_id: `job_deep_audit_${bidderId}`,
      stage: 'COMPLIANCE',
      status: 'COMPLETED',
      progress: 100,
      action: 'DEEP_AUDIT_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      bidder_id: bidderId,
      target_url: `/workspace/bidders/${bidderId}/deep-audit?mode=demo`,
      message: `Autonomous advisory Deep Audit completed for bidder (${conflictsCount} conflicts analyzed).`,
      timestamp: new Date().toISOString(),
      payload_json: {
        bidder_id: bidderId,
        is_advisory: true,
        conflicts_count: conflictsCount,
        precedents_count: precedentsCount,
        summary: synthesis.summary || synthesis.summary_text,
      },
    };
    state.auditEvents = [evt, ...state.auditEvents];

    saveToStorage(state);
  },

  getHumanDecision(bidderId: string): HumanDecisionStatus | null {
    const state = loadFromStorage();
    return state.humanDecisions[bidderId] || null;
  },

  getReport(bidderId: string): ReportRead | null {
    const state = loadFromStorage();
    const bidder = this.getBidder(bidderId);
    if (!bidder) return null;

    const tender = this.getTender(bidder.tender_id);
    const matrix = this.getComplianceMatrix(bidderId);
    const decision = state.humanDecisions[bidderId] || 'PENDING';

    const reportEvt: AuditEventRead = {
      id: `evt_${Date.now()}_report_viewed`,
      stage: 'REPORTING',
      status: 'COMPLETED',
      progress: 100,
      action: 'REPORT_VIEWED',
      entity_type: 'REPORT',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      bidder_id: bidderId,
      tender_id: bidder.tender_id,
      target_url: `/workspace/bidders/${bidderId}/report?mode=demo`,
      message: `Evaluation report viewed for bidder "${bidder.bidder_name}".`,
      timestamp: new Date().toISOString(),
      payload_json: {
        bidder_id: bidderId,
        tender_id: bidder.tender_id,
        target_url: `/workspace/bidders/${bidderId}/report?mode=demo`,
      },
    };
    state.auditEvents = [reportEvt, ...state.auditEvents];
    saveToStorage(state);

    return {
      generated_at: new Date().toISOString(),
      tender: tender || {
        id: bidder.tender_id,
        tender_number: 'N/A',
        title: 'Tender Detail',
        category: null,
        authority: null,
        budget: null,
        deadline: null,
        status: 'COMPLETED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      bidder,
      compliance_overview: {
        bidder_id: bidderId,
        tender_id: bidder.tender_id,
        overall_status: matrix?.overall_status || 'REVIEW_REQUIRED',
        human_decision_status: decision,
      },
      compliance_matrix: matrix || {
        bidder_id: bidderId,
        tender_id: bidder.tender_id,
        overall_status: 'REVIEW_REQUIRED',
        run_id: 'run_demo',
        historical_limitations_notice: 'Synthetic evaluation report.',
        rows: [],
      },
      historical_limitations_notice: 'Evaluation completed with zero critical compliance flags.',
      audit_trail_count: state.auditEvents.length,
    };
  },

  // -------------------------------------------------------------------------
  // AUDIT EVENTS
  // -------------------------------------------------------------------------
  getAuditEvents(): AuditEventRead[] {
    const state = loadFromStorage();
    return state.auditEvents;
  },

  addAuditEvent(event: AuditEventRead): void {
    const state = loadFromStorage();
    let targetUrl = event.target_url;
    if (targetUrl && !targetUrl.includes('mode=demo')) {
      targetUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}mode=demo`;
    }
    const enriched: AuditEventRead = {
      ...event,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      target_url: targetUrl,
    };
    state.auditEvents = [enriched, ...state.auditEvents];
    saveToStorage(state);
  },

  // -------------------------------------------------------------------------
  // DASHBOARD STATS (DYNAMIC DERIVATION)
  // -------------------------------------------------------------------------
  getDashboardStats() {
    const state = loadFromStorage();
    const activeTenders = state.tenders.length;

    let qualifiedBidders = 0;
    let disqualifiedBidders = 0;
    let pendingReviewBidders = 0;

    for (const list of Object.values(state.bidders)) {
      for (const b of list) {
        const decision = state.humanDecisions[b.id] || b.status;
        if (decision === 'QUALIFIED') {
          qualifiedBidders++;
        } else if (decision === 'DISQUALIFIED') {
          disqualifiedBidders++;
        } else {
          pendingReviewBidders++;
        }
      }
    }

    return {
      activeTenders,
      qualifiedBidders,
      disqualifiedBidders,
      pendingReviewBidders,
    };
  },

  // -------------------------------------------------------------------------
  // DEMO JOBS
  // -------------------------------------------------------------------------
  getJob(jobId: string): JobRead | null {
    const state = loadFromStorage();
    return state.jobs[jobId] || null;
  },

  createJob(jobId: string, stage: JobRead['current_stage'], status: JobRead['status'], progress: number, targetId = ''): JobRead {
    const state = loadFromStorage();
    const job: JobRead = {
      id: jobId,
      target_type: 'TENDER',
      target_id: targetId,
      job_type: 'SIMULATED_PIPELINE',
      current_stage: stage,
      status: status,
      progress: progress,
      error_message: null,
      started_at: new Date().toISOString(),
    };
    state.jobs[jobId] = job;
    saveToStorage(state);
    return job;
  },

  updateJob(jobId: string, updates: Partial<JobRead>): void {
    const state = loadFromStorage();
    if (state.jobs[jobId]) {
      state.jobs[jobId] = {
        ...state.jobs[jobId],
        ...updates,
      };
      saveToStorage(state);
    }
  },

  getJobEvents(jobId: string): JobEventRead[] {
    const state = loadFromStorage();
    const matching = state.auditEvents.filter((ev) => ev.job_id === jobId);
    return matching.map((ev, idx) => ({
      id: ev.id || `job_evt_${jobId}_${idx}`,
      job_id: ev.job_id || jobId,
      stage: (ev.stage as JobStage) || 'UPLOAD',
      status: (ev.status as JobStatus) || 'COMPLETED',
      progress: ev.progress ?? 100,
      message: ev.message || '',
      timestamp: ev.timestamp || new Date().toISOString(),
    }));
  },

  async queryRAG(tenderId: string, query: string): Promise<RAGExplainResponse> {
    const tender = this.getTender(tenderId);
    const reqs = this.getRequirements(tenderId);
    const turnoverReq = reqs.find((r) => r.requirement_type === 'TURNOVER' || r.field?.includes('turnover'));
    const expReq = reqs.find((r) => r.requirement_type === 'EXPERIENCE' || r.field?.includes('experience'));

    return queryDemoRAG(query, {
      tenderId: tender?.id || tenderId,
      title: tender?.title,
      budget: tender?.budget ?? undefined,
      turnoverRequirement: typeof turnoverReq?.expected_value === 'string' || typeof turnoverReq?.expected_value === 'number'
        ? turnoverReq.expected_value
        : undefined,
      experienceYears: typeof expReq?.expected_value === 'string' || typeof expReq?.expected_value === 'number'
        ? expReq.expected_value
        : undefined,
    });
  },

  // -------------------------------------------------------------------------
  // DEEP AUDIT INVESTIGATION LAYER (STRICTLY ADVISORY - 0 DECISION MUTATIONS)
  // -------------------------------------------------------------------------
  getDeepAuditSynthesis(bidderId: string): DeepAuditSynthesis | null {
    const state = loadFromStorage();
    return state.deepAuditSyntheses?.[bidderId] || null;
  },

  async runDeepAudit(bidderId: string): Promise<DeepAuditSynthesis> {
    const state = loadFromStorage();
    const existing = state.deepAuditSyntheses?.[bidderId];
    const now = new Date().toISOString();

    if (existing) {
      // Return canonical synthesis with updated timestamp and audit log
      const updated: DeepAuditSynthesis = {
        ...existing,
        completed_at: now,
        is_advisory: true,
      };
      this.recordDeepAuditSynthesis(bidderId, updated);

      this.addAuditEvent({
        id: `evt_deep_audit_${bidderId}_${Date.now()}`,
        job_id: `job_deep_audit_${bidderId}`,
        stage: 'COMPLIANCE',
        status: 'COMPLETED',
        progress: 100,
        action: 'DEEP_AUDIT_COMPLETED',
        entity_type: 'BIDDER',
        entity_id: bidderId,
        mode: 'DEMO',
        source: 'DEMO_STORE / SYNTHETIC',
        target_url: `/workspace/bidders/${bidderId}/deep-audit?mode=demo`,
        message: `Autonomous advisory deep audit completed for bidder. ${existing.total_findings_count ?? (existing.findings?.length || 0)} findings produced.`,
        timestamp: now,
      });

      return updated;
    }

    // Dynamic fallback for newly added demo bidder
    let foundBidder: BidderRead | null = null;
    let foundTenderId: string | null = null;
    for (const [tId, bidders] of Object.entries(state.bidders)) {
      const match = bidders.find((b) => b.id === bidderId);
      if (match) {
        foundBidder = match;
        foundTenderId = tId;
        break;
      }
    }

    const bidderName = foundBidder?.bidder_name || 'Bidder Entity';
    const tender = foundTenderId ? this.getTender(foundTenderId) : null;
    const tenderTitle = tender?.title || 'Tender Assessment';

    const dynamicSynthesis: DeepAuditSynthesis = {
      run_id: `run_deep_audit_${bidderId}_${Date.now()}`,
      started_at: now,
      completed_at: now,
      status: 'COMPLETED',
      tender_id: foundTenderId || 'tender_unknown',
      bidder_id: bidderId,
      tender_title: tenderTitle,
      bidder_name: bidderName,
      is_advisory: true,
      advisory_disclaimer: 'Advisory Analysis Only: Deep Audit provides supplemental investigation assistance and anomaly detection. It does not alter compliance evaluations, mutate bidder statuses, or override procurement officer authority. Final decision remains with the human procurement officer.',
      summary: `Autonomous advisory investigation completed for ${bidderName}. Scanned registry filings, financial ratios, and submitted documentation. Deterministic rule engine found 0 fraud signals. Procurement officer should review extracted evidence before final award.`,
      total_findings_count: 1,
      high_priority_count: 0,
      review_required_count: 0,
      informational_count: 1,
      unresolved_questions_count: 1,
      conflicts_count: 0,
      missing_evidence_count: 0,
      workflow_trace: [
        { stage_key: 'tender_intelligence', label: 'Tender Intelligence', status: 'COMPLETED', short_description: 'Criteria indexed.', findings_produced: 0, evidence_used: 2, duration_ms: 80 },
        { stage_key: 'document_intelligence', label: 'Document Intelligence', status: 'COMPLETED', short_description: 'Filings parsed with OCR.', findings_produced: 0, evidence_used: 1, duration_ms: 190 },
        { stage_key: 'knowledge', label: 'Knowledge & Precedents', status: 'COMPLETED', short_description: 'Procurement rules referenced.', findings_produced: 0, evidence_used: 1, duration_ms: 110 },
        { stage_key: 'risk', label: 'Deterministic Risk & Anomalies', status: 'COMPLETED', short_description: 'Deterministic risk heuristics scanned.', findings_produced: 0, evidence_used: 2, duration_ms: 95 },
        { stage_key: 'compliance', label: 'Compliance Synthesis', status: 'COMPLETED', short_description: 'Advisory synthesis reconciled.', findings_produced: 1, evidence_used: 2, duration_ms: 140 },
        { stage_key: 'human_review', label: 'Advisory Summary for Officer', status: 'COMPLETED', short_description: 'Synthesis compiled for officer review.', findings_produced: 0, evidence_used: 1, duration_ms: 60 },
      ],
      findings: [
        {
          finding_id: `find_${bidderId}_01`,
          category: 'STATUTORY_MISMATCH',
          severity: 'INFO',
          title: 'Statutory Verification Cleared',
          description: `Bidder ${bidderName} has active registered credentials with no adverse flags detected.`,
          affected_fields: ['tax.gstin'],
          evidence_provenance: [],
          detection_method: 'REGISTRY_CROSS_CHECK',
          recommended_action: 'Proceed to standard evaluation.',
        },
      ],
      cross_document_conflicts: [],
      missing_evidence: [],
      statutory_investigations: [
        { identifier_type: 'GSTIN', identifier_value: foundBidder?.gstin || '27XXXXX0000X1Z1', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', conflict_status: 'NO_CONFLICT', details: 'Active regular taxpayer in demo registry.' },
        { identifier_type: 'PAN', identifier_value: foundBidder?.pan || 'ABCDE1234F', provider_mode: 'DEMO_SYNTHETIC', verification_result: 'VERIFIED', conflict_status: 'NO_CONFLICT', details: 'Valid PAN record in demo database.' },
        { identifier_type: 'BLACKLIST', identifier_value: bidderName, provider_mode: 'DEMO_SYNTHETIC', verification_result: 'CLEARED', conflict_status: 'NO_CONFLICT', details: 'Clean across debarment lists.' },
      ],
      risk_anomalies: [
        { signal_id: `sig_${bidderId}_01`, rule_name: 'BASELINE_ANOMALY_SCAN', engine_label: 'DETERMINISTIC ANOMALY & RISK RULE ENGINE', input_values: [bidderName], why_triggered: 'Baseline scan: 0 critical variance flags identified.', severity: 'INFO', supporting_evidence: 'Demo bidder record' },
      ],
      rag_investigations: [],
      unresolved_questions: [
        { question_id: `uq_${bidderId}_01`, question: `Are all annexures submitted by ${bidderName} countersigned by an authorized signatory?`, background: 'Verification of digital/wet signatures against board resolution or power of attorney.', reason_cannot_auto_resolve: 'Signature authority verification requires procurement committee inspection.', officer_prompt: 'ARGUS cannot safely resolve this automatically. OFFICER REVIEW REQUIRED.' },
      ],
      recommended_actions: [
        { action_id: `rec_${bidderId}_01`, action_type: 'MANUAL_VERIFY', title: 'Verify Authorized Signatory POA', description: 'Check power of attorney or board resolution for signatory representation.', is_recommendation_only: true },
      ],
      evidence_chains: [],
      disclaimer: 'Advisory Analysis Only: Deep Audit provides supplemental investigation assistance and anomaly detection. It does not alter compliance evaluations, mutate bidder statuses, or override procurement officer authority. Final decision remains with the human procurement officer.',
    };

    this.recordDeepAuditSynthesis(bidderId, dynamicSynthesis);

    this.addAuditEvent({
      id: `evt_deep_audit_${bidderId}_${Date.now()}`,
      job_id: `job_deep_audit_${bidderId}`,
      stage: 'COMPLIANCE',
      status: 'COMPLETED',
      progress: 100,
      action: 'DEEP_AUDIT_COMPLETED',
      entity_type: 'BIDDER',
      entity_id: bidderId,
      mode: 'DEMO',
      source: 'DEMO_STORE / SYNTHETIC',
      target_url: `/workspace/bidders/${bidderId}/deep-audit?mode=demo`,
      message: `Autonomous advisory deep audit completed for ${bidderName}. 1 finding produced.`,
      timestamp: now,
    });

    return dynamicSynthesis;
  },
};

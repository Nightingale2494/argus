/**
 * Client-Side Deterministic Synthetic RAG Engine for ARGUS Demo Mode.
 * 
 * Invariants:
 * 1. 100% client-side execution — ZERO backend network calls.
 * 2. Query-specific retrieval — distinct queries return distinct evidence chunks.
 * 3. Consistent with Demo Tender state (budget, turnover, experience, EMD, JV, OEM).
 * 4. Grounded synthesis — direct answers only cite facts in direct evidence.
 * 5. Deterministic DIRECT_EVIDENCE vs RELATED_CONTEXT separation.
 * 6. Minimum relevance threshold — queries below threshold return INSUFFICIENT_RETRIEVAL_EVIDENCE.
 * 7. ZERO unsupported real policy citations — all fixtures visibly labeled synthetic.
 */

import type { RAGExplainResponse } from './types';
import type { EvidenceRead } from '@/types/api';

export interface SyntheticChunk {
  id: string;
  document_id: string;
  title: string;
  page_number: number;
  snippet: string;
  topic: string;
  tags: string[];
  source_uri: string;
  synthetic: true;
  content_hash: string;
  clause_reference?: string;
  threshold_value?: string | number;
}

export type ResultClass = 'DIRECT_EVIDENCE' | 'RELATED_CONTEXT' | 'INSUFFICIENT_RETRIEVAL_EVIDENCE';

export const MIN_RELEVANCE_THRESHOLD = 0.20;

/**
 * Builds synthetic tender document corpus tailored to the active demo tender.
 */
export function buildDemoCorpus(tenderContext?: {
  tenderId?: string;
  title?: string;
  budget?: number;
  turnoverRequirement?: number | string;
  experienceYears?: number | string;
}): SyntheticChunk[] {
  const tenderId = tenderContext?.tenderId || 'tender_gem_2026_01';
  const turnoverVal = tenderContext?.turnoverRequirement
    ? (typeof tenderContext.turnoverRequirement === 'number'
        ? `₹ ${(tenderContext.turnoverRequirement).toLocaleString('en-IN')}`
        : tenderContext.turnoverRequirement)
    : '₹ 5,00,00,000 (INR 5.00 Crore)';
  const experienceVal = tenderContext?.experienceYears
    ? `${tenderContext.experienceYears} years`
    : '3 years';
  const emdVal = tenderContext?.budget
    ? `₹ ${(Math.round(tenderContext.budget * 0.02)).toLocaleString('en-IN')}`
    : '₹ 10,00,000 (INR 10.00 Lakh)';

  return [
    // 1. Turnover Requirement
    {
      id: `chunk_${tenderId}_turnover`,
      document_id: 'doc_rfp_eligibility',
      title: 'Tender RFP — Section IV: Financial Eligibility Criteria',
      page_number: 5,
      snippet: `Clause 4.2.3 (Annual Turnover): The bidder must have an average annual turnover of at least ${turnoverVal} over the last 3 financial years (2022-23, 2023-24, 2024-25), duly certified by a practicing Chartered Accountant with valid UDIN. Provisional financial statements will not be considered.`,
      topic: 'TURNOVER',
      tags: ['turnover', 'financial', 'annual turnover', 'revenue', 'chartered accountant', 'udin', 'balance sheet'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=5',
      synthetic: true,
      content_hash: 'hash_syn_turnover_423',
      clause_reference: 'Clause 4.2.3',
      threshold_value: turnoverVal,
    },
    // 2. Past Experience Requirement
    {
      id: `chunk_${tenderId}_experience`,
      document_id: 'doc_rfp_eligibility',
      title: 'Tender RFP — Section IV: Technical & Operating Experience',
      page_number: 7,
      snippet: `Clause 4.3.1 (Operating Experience): The bidder must possess at least ${experienceVal} of continuous operating experience in supply, installation, and commissioning of IT infrastructure and surveillance systems. Bidder must submit completion certificates for at least 3 similar contracts each of minimum 40% tender value or 2 contracts of 50% or 1 contract of 80% tender value completed during the last 7 years.`,
      topic: 'EXPERIENCE',
      tags: ['experience', 'past experience', 'operating experience', 'track record', 'similar contracts', 'completion certificates', 'years'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=7',
      synthetic: true,
      content_hash: 'hash_syn_exp_431',
      clause_reference: 'Clause 4.3.1',
      threshold_value: experienceVal,
    },
    // 3. MSME / MSE Exemption Policy (Synthetic Fixture P-153)
    {
      id: `chunk_${tenderId}_msme_exemption`,
      document_id: 'doc_policy_fixture_p153',
      title: 'Synthetic Procurement Policy — Demo Policy Fixture P-153 (MSME Exemption)',
      page_number: 1,
      snippet: `Demo Policy Fixture P-153 (MSME Exemption): Micro and Small Enterprises (MSEs) registered with the Udyam portal under Ministry of MSME are eligible for relaxation from criteria of prior turnover and prior experience in public procurement, subject to meeting technical specifications and demonstrating operational capability. Note: Relaxation does not apply to quality parameters or core system integrity.`,
      topic: 'MSME_EXEMPTION',
      tags: ['msme', 'mse', 'udyam', 'exemption', 'relaxation', 'prior turnover', 'prior experience', 'turnover exemption', 'experience exemption'],
      source_uri: 'demo://policy/synthetic_policy_fixture_p153.pdf#page=1',
      synthetic: true,
      content_hash: 'hash_syn_msme_p153',
      clause_reference: 'Demo Policy Fixture P-153',
    },
    // 4. EMD and Bid Security
    {
      id: `chunk_${tenderId}_emd`,
      document_id: 'doc_rfp_instructions',
      title: 'Tender RFP — Section II: Instructions to Bidders (Bid Security)',
      page_number: 3,
      snippet: `Clause 2.4 (Earnest Money Deposit): All bidders must furnish an Earnest Money Deposit (EMD) / Bid Security of ${emdVal} in the form of an irrevocable Bank Guarantee or Demand Draft from a scheduled commercial bank. Registered Micro & Small Enterprises (MSEs) with valid Udyam registration certificates and DPIIT-recognized Startups are exempt from EMD submission upon furnishing a Bid Securing Declaration.`,
      topic: 'EMD',
      tags: ['emd', 'bid security', 'earnest money', 'bank guarantee', 'demand draft', 'security deposit', 'bid securing declaration'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=3',
      synthetic: true,
      content_hash: 'hash_syn_emd_24',
      clause_reference: 'Clause 2.4',
      threshold_value: emdVal,
    },
    // 5. OEM Authorization Form
    {
      id: `chunk_${tenderId}_oem`,
      document_id: 'doc_rfp_technical',
      title: 'Tender RFP — Section VI: Technical Specifications & OEM Backing',
      page_number: 8,
      snippet: `Clause 4.4.2 (Manufacturer Authorization): Bidders who are not original equipment manufacturers must submit an OEM Authorization Form (MAF) strictly in Annexure-IV format for all critical surveillance cameras, NVRs, and core network switches, confirming 5-year warranty, spare parts availability, and 24/7 technical support.`,
      topic: 'OEM',
      tags: ['oem', 'maf', 'manufacturer authorization', 'annexure-iv', 'warranty', 'spare parts', 'hardware'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=8',
      synthetic: true,
      content_hash: 'hash_syn_oem_442',
      clause_reference: 'Clause 4.4.2',
    },
    // 6. Joint Ventures & Consortia Eligibility
    {
      id: `chunk_${tenderId}_jv_consortium`,
      document_id: 'doc_rfp_instructions',
      title: 'Tender RFP — Section II: Bidder Eligibility & Formation',
      page_number: 4,
      snippet: `Clause 2.8 (Joint Ventures and Consortia): Joint Ventures (JV), Consortia, and Association of Persons are strictly NOT eligible to bid for this tender. Only single corporate entities incorporated under the Companies Act or registered LLPs/partnerships are permitted. Subcontracting of core project tasks without prior written consent is strictly prohibited.`,
      topic: 'JV_CONSORTIUM',
      tags: ['joint venture', 'consortium', 'jv', 'consortia', 'association', 'single entity', 'subcontracting', 'eligible'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=4',
      synthetic: true,
      content_hash: 'hash_syn_jv_28',
      clause_reference: 'Clause 2.8',
    },
    // 7. GSTIN and Statutory Tax Compliance
    {
      id: `chunk_${tenderId}_gst_tax`,
      document_id: 'doc_rfp_statutory',
      title: 'Tender RFP — Section III: Statutory Legal & Tax Registration',
      page_number: 4,
      snippet: `Clause 4.1.1 (Tax Registration): Bidder must possess a valid and active Goods and Services Tax Identification Number (GSTIN) and Permanent Account Number (PAN) registered in India. Self-attested copies of GST registration certificate, PAN card, and the latest 2 quarters of filed GSTR-3B returns must be enclosed with the technical bid.`,
      topic: 'GST_PAN',
      tags: ['gst', 'gstin', 'pan', 'tax', 'registration', 'gstr-3b', 'statutory', 'active gstin'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=4',
      synthetic: true,
      content_hash: 'hash_syn_gst_411',
      clause_reference: 'Clause 4.1.1',
    },
    // 8. Quality & Security Certifications
    {
      id: `chunk_${tenderId}_certifications`,
      document_id: 'doc_rfp_technical',
      title: 'Tender RFP — Section VI: Quality Assurance & Certifications',
      page_number: 9,
      snippet: `Clause 4.5.1 (Quality Certifications): Bidder must possess valid ISO 9001:2015 (Quality Management Systems) and ISO 27001 (Information Security Management Systems) accreditations valid as of the date of bid submission. Certificates must be issued by a NABCB or equivalent accredited conformity assessment body.`,
      topic: 'CERTIFICATION',
      tags: ['iso', 'certification', 'iso 9001', 'iso 27001', 'quality', 'security management', 'accreditation'],
      source_uri: 'demo://documents/highway_surveillance_rfp_2026.pdf#page=9',
      synthetic: true,
      content_hash: 'hash_syn_iso_451',
      clause_reference: 'Clause 4.5.1',
    },
  ];
}

/**
 * Tokenizes text into lower-cased alphanumeric words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const STOP_WORDS = new Set([
  'what', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of',
  'this', 'that', 'it', 'on', 'at', 'by', 'from', 'with', 'does', 'do',
  'requirement', 'requirements', 'applicable', 'criteria'
]);

/**
 * Computes deterministic lexical & keyword similarity score normalized to 0.0 .. 1.0.
 */
function computeRelevanceScore(query: string, chunk: SyntheticChunk): { score: number; rationale: string; isDirect: boolean } {
  const allTokens = tokenize(query);
  if (allTokens.length === 0) return { score: 0, rationale: 'Empty query', isDirect: false };

  const contentTokens = allTokens.filter((t) => !STOP_WORDS.has(t));
  const qTokens = contentTokens.length > 0 ? contentTokens : allTokens;

  const qText = query.toLowerCase();

  // 0. Domain Mismatch Gate: Reject queries for foreign domains
  const isForeignDomain = qText.includes('aircraft') || qText.includes('engine') || qText.includes('medical') || qText.includes('pharma') || qText.includes('solar');
  if (isForeignDomain) {
    return { score: 0, rationale: 'Domain mismatch with tender scope', isDirect: false };
  }

  const chunkTokens = new Set(tokenize(chunk.snippet));
  const tagSet = new Set(chunk.tags.map((t) => t.toLowerCase()));

  // 1. Term overlap on meaningful content tokens
  let matchCount = 0;
  for (const t of qTokens) {
    if (chunkTokens.has(t) || tagSet.has(t)) {
      matchCount++;
    }
  }
  const termOverlapRatio = matchCount / qTokens.length;

  // 2. Tag & keyword bonus (requires at least 1 content token match)
  let tagBonus = 0;
  if (matchCount > 0) {
    for (const tag of chunk.tags) {
      if (tag !== 'warranty' && qText.includes(tag.toLowerCase())) {
        tagBonus += 0.35;
      } else if (tag === 'warranty' && (qText.includes('oem') || qText.includes('hardware') || qText.includes('camera') || qText.includes('surveillance'))) {
        tagBonus += 0.35;
      }
    }
  }

  // 3. Exact phrase matching
  let phraseBonus = 0;
  if (qText.includes(chunk.topic.toLowerCase())) {
    phraseBonus += 0.25;
  }
  if (chunk.clause_reference && qText.includes(chunk.clause_reference.toLowerCase())) {
    phraseBonus += 0.40;
  }

  // 4. Topic intent alignment
  let topicAligned = false;
  const isExperienceQuery = (qText.includes('experience') || qText.includes('past project') || qText.includes('track record')) && !qText.includes('msme') && !qText.includes('exemption');
  const isMsmeQuery = qText.includes('msme') || qText.includes('mse') || qText.includes('udyam') || (qText.includes('exemption') && !qText.includes('emd'));
  const isEmdQuery = qText.includes('emd') || qText.includes('earnest money') || qText.includes('bid security');
  const isEmdExemptionQuery = isEmdQuery && (qText.includes('exempt') || qText.includes('waiver') || qText.includes('relaxation'));
  const isEmdAmountQuery = isEmdQuery && !isEmdExemptionQuery;
  const isJvQuery = qText.includes('joint venture') || qText.includes('consortium') || qText.includes('jv') || qText.includes('consortia');
  const isTurnoverQuery = (qText.includes('turnover') || qText.includes('revenue')) && !qText.includes('msme') && !qText.includes('exemption');
  const isOemQuery = qText.includes('oem') || qText.includes('manufacturer') || qText.includes('maf');
  const isTaxQuery = qText.includes('gst') || qText.includes('pan') || qText.includes('tax');
  const isCertQuery = qText.includes('iso') || qText.includes('certificat');

  if (isExperienceQuery && chunk.topic === 'EXPERIENCE') topicAligned = true;
  if (isMsmeQuery && chunk.topic === 'MSME_EXEMPTION') topicAligned = true;
  if (isEmdQuery && chunk.topic === 'EMD') topicAligned = true;
  if (isJvQuery && chunk.topic === 'JV_CONSORTIUM') topicAligned = true;
  if (isTurnoverQuery && chunk.topic === 'TURNOVER') topicAligned = true;
  if (isOemQuery && chunk.topic === 'OEM') topicAligned = true;
  if (isTaxQuery && chunk.topic === 'GST_PAN') topicAligned = true;
  if (isCertQuery && chunk.topic === 'CERTIFICATION') topicAligned = true;

  // Calculate raw combined score
  let rawScore = termOverlapRatio * 0.45 + Math.min(0.35, tagBonus) + phraseBonus;
  if (topicAligned) {
    rawScore += 0.30;
  }

  // Related context handling & slot requirements:
  let isDirect = topicAligned;
  if (isExperienceQuery && chunk.topic === 'MSME_EXEMPTION') {
    isDirect = false;
    rawScore = Math.min(rawScore, 0.45); // cap related context
  }
  if (isTurnoverQuery && chunk.topic === 'MSME_EXEMPTION') {
    isDirect = false;
    rawScore = Math.min(rawScore, 0.45);
  }
  if (isMsmeQuery && (chunk.topic === 'TURNOVER' || chunk.topic === 'EXPERIENCE')) {
    isDirect = false;
    rawScore = Math.min(rawScore, 0.45);
  }
  if (isMsmeQuery && chunk.topic === 'MSME_EXEMPTION') {
    // Requires explicit exemption/relaxation
    const hasExemption = /exempt|relaxation|waiver/i.test(chunk.snippet);
    if (!hasExemption) isDirect = false;
  }
  if (isEmdAmountQuery && chunk.topic === 'EMD') {
    const hasAmount = /₹|inr|rs|lakh|crore|%/i.test(chunk.snippet);
    if (!hasAmount) isDirect = false;
  }
  if (isEmdExemptionQuery && chunk.topic === 'EMD') {
    const hasExemption = /exempt|waiver|relaxation|bid securing declaration/i.test(chunk.snippet);
    if (!hasExemption) isDirect = false;
  }

  const score = Math.max(0.0, Math.min(1.0, Math.round(rawScore * 100) / 100));

  let rationale = `Matched keywords: ${matchCount}/${qTokens.length}`;
  if (topicAligned) rationale += ' • Direct Topic Match';
  if (tagBonus > 0) rationale += ' • Tag Alignment';

  return { score, rationale, isDirect };
}

/**
 * Executes deterministic, query-specific retrieval over the synthetic demo corpus.
 */
export function queryDemoRAG(
  query: string,
  tenderContext?: {
    tenderId?: string;
    title?: string;
    budget?: number;
    turnoverRequirement?: number | string;
    experienceYears?: number | string;
  }
): RAGExplainResponse {
  const cleanQuery = query.trim();
  const corpus = buildDemoCorpus(tenderContext);
  const now = new Date().toISOString();

  if (!cleanQuery) {
    return {
      query: '',
      explanation: 'ARGUS could not find an indexed clause that directly answers this question.',
      direct_answer: 'ARGUS could not find an indexed clause that directly answers this question.',
      related_context: null,
      result_class: 'INSUFFICIENT_RETRIEVAL_EVIDENCE',
      citations: [],
      related_citations: [],
      is_advisory: true,
      advisory_disclaimer: 'This explanation is purely advisory context generated from synthetic demo fixtures. It does NOT decide qualification or override deterministic compliance rules.',
      retrieved_at: now,
      error_code: 'EMPTY_QUERY',
      error_message: 'Query string was empty.',
    };
  }

  // Score all chunks
  const scored = corpus.map((chunk) => {
    const { score, rationale, isDirect } = computeRelevanceScore(cleanQuery, chunk);
    return { chunk, score, rationale, isDirect };
  });

  // Filter candidates above unified minimum relevance threshold
  const qualifying = scored.filter((item) => item.score >= MIN_RELEVANCE_THRESHOLD);

  // Sort descending by score
  qualifying.sort((a, b) => b.score - a.score);

  // Exact & near-duplicate deduplication using content_hash and page
  const seenHashes = new Set<string>();
  const diverseCandidates: typeof qualifying = [];
  for (const item of qualifying) {
    const key = `${item.chunk.document_id}:${item.chunk.page_number}:${item.chunk.content_hash}`;
    if (!seenHashes.has(key)) {
      seenHashes.add(key);
      diverseCandidates.push(item);
    }
  }

  // Partition into Direct Evidence and Related Context
  const directItems = diverseCandidates.filter((item) => item.isDirect);
  const relatedItems = diverseCandidates.filter((item) => !item.isDirect);

  // If NO direct items qualify above the threshold:
  if (directItems.length === 0) {
    // Check if only related items matched
    if (relatedItems.length > 0) {
      const bestRelated = relatedItems[0];
      const relatedCitations = relatedItems.slice(0, 2).map((item) => formatCitation(item.chunk, item.score, item.rationale, 'RELATED_CONTEXT'));

      return {
        query: cleanQuery,
        explanation: `No explicit clause directly answering '${cleanQuery}' was found in the indexed tender documents. However, related context regarding ${bestRelated.chunk.title} was identified.`,
        direct_answer: 'ARGUS could not find an indexed clause that directly answers this question.',
        related_context: `Supplementary policy context: ${bestRelated.chunk.snippet}`,
        result_class: 'INSUFFICIENT_RETRIEVAL_EVIDENCE',
        citations: [],
        related_citations: relatedCitations,
        is_advisory: true,
        advisory_disclaimer: 'This explanation is purely advisory context generated from synthetic demo fixtures. It does NOT decide qualification or override deterministic compliance rules.',
        retrieved_at: now,
      };
    }

    return {
      query: cleanQuery,
      explanation: 'ARGUS could not find an indexed clause that directly answers this question.',
      direct_answer: 'ARGUS could not find an indexed clause that directly answers this question.',
      related_context: null,
      result_class: 'INSUFFICIENT_RETRIEVAL_EVIDENCE',
      citations: [],
      related_citations: [],
      is_advisory: true,
      advisory_disclaimer: 'This explanation is purely advisory context generated from synthetic demo fixtures. It does NOT decide qualification or override deterministic compliance rules.',
      retrieved_at: now,
    };
  }

  // Build grounded answers
  const topDirect = directItems[0];
  const directCitations = directItems.slice(0, 2).map((item) => formatCitation(item.chunk, item.score, item.rationale, 'DIRECT_EVIDENCE'));
  const relatedCitations = relatedItems.slice(0, 2).map((item) => formatCitation(item.chunk, item.score, item.rationale, 'RELATED_CONTEXT'));

  let directAnswer = '';
  let relatedContext: string | null = null;

  switch (topDirect.chunk.topic) {
    case 'EXPERIENCE':
      directAnswer = `Minimum operating experience requirement: ${topDirect.chunk.threshold_value || '3 years'} of continuous operating experience in relevant infrastructure (Clause 4.3.1). Bidders must provide completion certificates for required past project values.`;
      if (relatedItems.length > 0 && relatedItems[0].chunk.topic === 'MSME_EXEMPTION') {
        relatedContext = `Related statutory policy: Micro & Small Enterprises (MSEs) registered with Udyam may qualify for exemption from prior experience under Demo Policy Fixture P-153.`;
      }
      break;

    case 'TURNOVER':
      directAnswer = `Minimum annual turnover requirement: ${topDirect.chunk.threshold_value || 'INR 5,00,00,000'} average annual turnover over the last 3 financial years, CA-certified with valid UDIN (Clause 4.2.3).`;
      if (relatedItems.length > 0 && relatedItems[0].chunk.topic === 'MSME_EXEMPTION') {
        relatedContext = `Related statutory policy: Udyam-registered MSEs may qualify for turnover relaxation under Demo Policy Fixture P-153.`;
      }
      break;

    case 'MSME_EXEMPTION':
      directAnswer = `MSME turnover and experience exemption is applicable to this tender under Demo Policy Fixture P-153. Udyam-registered Micro and Small Enterprises (MSEs) qualify for exemption from prior turnover and experience criteria, provided they satisfy technical capability.`;
      if (relatedItems.length > 0) {
        relatedContext = `Underlying tender criteria: Standard requirements stipulate turnover and operating experience unless statutory exemption documentation is verified.`;
      }
      break;

    case 'EMD':
      directAnswer = `Earnest Money Deposit (EMD) / Bid Security is ${topDirect.chunk.threshold_value || 'INR 10,00,000'} via Bank Guarantee or Demand Draft (Clause 2.4). Registered MSEs and DPIIT Startups are exempt from EMD upon submitting a Bid Securing Declaration.`;
      break;

    case 'JV_CONSORTIUM':
      directAnswer = `Joint Ventures (JV) and Consortia are strictly NOT eligible to bid for this tender under Clause 2.8. Only single corporate entities or registered LLPs/partnerships may submit bids.`;
      break;

    case 'OEM':
      directAnswer = `Manufacturer Authorization Form (MAF) is mandatory for non-OEM bidders under Clause 4.4.2 in Annexure-IV format, covering 5-year warranty and official support.`;
      break;

    case 'GST_PAN':
      directAnswer = `Valid and active GSTIN and PAN registration in India are mandatory under Clause 4.1.1. Copies of certificates and filed GSTR-3B returns must be enclosed.`;
      break;

    case 'CERTIFICATION':
      directAnswer = `Valid ISO 9001:2015 and ISO 27001 certifications are required under Clause 4.5.1 as of the bid submission date.`;
      break;

    default:
      directAnswer = `Direct clause evidence: ${topDirect.chunk.snippet}`;
      break;
  }

  const overallExplanation = relatedContext
    ? `${directAnswer}\n\n[Related Policy Context]: ${relatedContext}`
    : directAnswer;

  return {
    query: cleanQuery,
    explanation: overallExplanation,
    direct_answer: directAnswer,
    related_context: relatedContext,
    result_class: 'DIRECT_EVIDENCE',
    citations: directCitations,
    related_citations: relatedCitations,
    is_advisory: true,
    advisory_disclaimer: 'This explanation is purely advisory context generated from synthetic demo fixtures. It does NOT decide qualification or override deterministic compliance rules.',
    retrieved_at: now,
  };
}

function formatCitation(
  chunk: SyntheticChunk,
  relevanceScore: number,
  matchRationale: string,
  resultClass: 'DIRECT_EVIDENCE' | 'RELATED_CONTEXT'
): EvidenceRead {
  return {
    id: chunk.id,
    entity_type: 'document_chunk',
    entity_id: chunk.document_id,
    snippet: chunk.snippet,
    source_uri: chunk.source_uri,
    page_number: chunk.page_number,
    location_metadata: {
      title: chunk.title,
      clause_reference: chunk.clause_reference || null,
      topic: chunk.topic,
      relevance_score: relevanceScore,
      match_rationale: matchRationale,
      result_class: resultClass,
      synthetic: true,
    },
    created_at: new Date().toISOString(),
  };
}

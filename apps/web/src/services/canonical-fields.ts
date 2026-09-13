/**
 * Central Canonical Field Registry for ARGUS Frontend.
 * Matches backend `app.compliance.canonical_fields`.
 */

import type { OperatorEnum, RequirementType } from '@/types/api';

export interface CanonicalFieldDefinition {
  key: string;
  category: string;
  displayName: string;
  dataType: 'NUMBER' | 'CURRENCY' | 'BOOLEAN' | 'STRING' | 'DATE' | 'ENUM';
  requirementType: RequirementType;
  allowedOperators: OperatorEnum[];
  unitSemantics: string | null;
  aliases: string[];
  description: string;
}

export const CANONICAL_FIELDS: CanonicalFieldDefinition[] = [
  {
    key: 'financial.average_annual_turnover',
    category: 'Financial',
    displayName: 'Average Annual Turnover',
    dataType: 'CURRENCY',
    requirementType: 'TURNOVER',
    allowedOperators: ['GTE', 'GT', 'LTE', 'LT', 'EQ', 'EXISTS'],
    unitSemantics: 'INR',
    aliases: [
      'turnover',
      'annual_turnover',
      'avg_annual_turnover',
      'average_annual_turnover',
      'financial.annual_turnover',
      'financial.turnover',
      'financial.avg_turnover',
      'annual_turnover_inr',
      'average_turnover',
      'financial.average_turnover',
    ],
    description: 'Average annual financial turnover over the designated past financial years.',
  },
  {
    key: 'tax.gstin',
    category: 'Tax',
    displayName: 'GSTIN (Goods and Services Tax ID)',
    dataType: 'STRING',
    requirementType: 'GST',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'gst',
      'gstin',
      'tax.gst',
      'tax.gstin',
      'gst_number',
      'gst_registration',
      'general.gstin',
    ],
    description: '15-character Goods and Services Tax Identification Number.',
  },
  {
    key: 'identity.pan',
    category: 'Corporate',
    displayName: 'Permanent Account Number (PAN)',
    dataType: 'STRING',
    requirementType: 'CUSTOM',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'pan',
      'pan_number',
      'tax.pan',
      'corporate.pan',
      'general.pan',
      'identity.pan',
    ],
    description: '10-character Permanent Account Number issued by Income Tax Department.',
  },
  {
    key: 'registration.udyam',
    category: 'MSME',
    displayName: 'Udyam Registration Number',
    dataType: 'STRING',
    requirementType: 'UDYAM',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'udyam',
      'udyam_registration',
      'msme_number',
      'udyam_number',
      'msme.udyam',
      'msme.udyam_registration',
      'registration.udyam',
      'msme.udyam_number',
    ],
    description: 'MSME Udyam Registration Certificate number.',
  },
  {
    key: 'corporate.cin',
    category: 'Corporate',
    displayName: 'Corporate Identification Number (CIN)',
    dataType: 'STRING',
    requirementType: 'MCA',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'cin',
      'company_cin',
      'corporate.cin',
      'cin_number',
      'mca.cin',
      'corporate.mca_registration',
    ],
    description: '21-digit Corporate Identification Number registered with MCA.',
  },
  {
    key: 'labour.epfo_registration',
    category: 'Labour & Statutory',
    displayName: 'EPFO Registration Number',
    dataType: 'STRING',
    requirementType: 'EPFO',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'epfo',
      'epf',
      'epfo_number',
      'epf_registration',
      'statutory.epf',
      'labour.epfo_registration',
      'statutory.epfo',
    ],
    description: "Employees' Provident Fund Organisation establishment code.",
  },
  {
    key: 'labour.esic_registration',
    category: 'Labour & Statutory',
    displayName: 'ESIC Registration Number',
    dataType: 'STRING',
    requirementType: 'ESIC',
    allowedOperators: ['EXISTS', 'EQ', 'NE'],
    unitSemantics: null,
    aliases: [
      'esic',
      'esi',
      'esic_number',
      'esi_registration',
      'statutory.esi',
      'labour.esic_registration',
      'statutory.esic',
    ],
    description: "Employees' State Insurance Corporation 17-digit code.",
  },
  {
    key: 'experience.years',
    category: 'Experience',
    displayName: 'Past Experience (Years)',
    dataType: 'NUMBER',
    requirementType: 'EXPERIENCE',
    allowedOperators: ['GTE', 'GT', 'LTE', 'LT', 'EQ', 'EXISTS'],
    unitSemantics: 'years',
    aliases: [
      'experience_years',
      'years_in_business',
      'past_experience_years',
      'experience.years',
      'experience.years_in_business',
      'experience',
    ],
    description: 'Number of completed years of experience in the relevant sector.',
  },
  {
    key: 'legal.blacklisted',
    category: 'Legal & Compliance',
    displayName: 'Debarment / Blacklist Status',
    dataType: 'BOOLEAN',
    requirementType: 'BLACK_LIST',
    allowedOperators: ['EQ', 'NE', 'EXISTS'],
    unitSemantics: null,
    aliases: [
      'blacklisted',
      'debarred',
      'blacklist_status',
      'debarment_status',
      'debarment.status',
      'legal.blacklisted',
      'debarment.blacklisted',
    ],
    description: 'Boolean indicating whether the entity is debarred or blacklisted by any government authority.',
  },
  {
    key: 'document.expiry_date',
    category: 'Document',
    displayName: 'Document Expiry Date',
    dataType: 'DATE',
    requirementType: 'CUSTOM',
    allowedOperators: ['GTE', 'GT', 'LTE', 'LT', 'EQ', 'EXISTS'],
    unitSemantics: null,
    aliases: [
      'expiry_date',
      'valid_upto',
      'valid_until',
      'document.expiry_date',
      'document.valid_upto',
    ],
    description: 'Validity or expiry date of the submitted certificate/document.',
  },
];

const ALIAS_MAP = new Map<string, string>();
CANONICAL_FIELDS.forEach((f) => {
  ALIAS_MAP.set(f.key.toLowerCase().trim(), f.key);
  f.aliases.forEach((a) => ALIAS_MAP.set(a.toLowerCase().trim(), f.key));
});

export function resolveCanonicalField(fieldName?: string | null): string {
  if (!fieldName) return '';
  const normalized = fieldName.toLowerCase().trim();
  return ALIAS_MAP.get(normalized) || fieldName.trim();
}

export function getCanonicalField(keyOrAlias?: string | null): CanonicalFieldDefinition | undefined {
  const canonicalKey = resolveCanonicalField(keyOrAlias);
  return CANONICAL_FIELDS.find((f) => f.key === canonicalKey);
}

export function areFieldsEquivalent(fieldA?: string | null, fieldB?: string | null): boolean {
  if (!fieldA || !fieldB) return false;
  return resolveCanonicalField(fieldA) === resolveCanonicalField(fieldB);
}

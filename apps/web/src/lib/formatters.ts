/**
 * Central display formatters for Argus frontend.
 *
 * Guaranteed to NEVER produce "[object Object]" under any input.
 * Handles null/undefined, strings, numbers (plain vs currency), booleans,
 * arrays, and nested structured objects.
 */

export interface FormatterOptions {
  fallback?: string;
  kind?: 'text' | 'number' | 'currency' | 'date';
  concise?: boolean;
}

export interface ExpectedConditionContext {
  unit?: string | null;
  requirementType?: string | null;
  field?: string | null;
}

/**
 * Returns true if the value is a structured object or array (non-null, non-primitive).
 */
export function isStructuredValue(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

/**
 * Formats a numeric value as Indian Rupees (INR) using Lakh / Crore notation.
 * e.g., 85000000 -> "₹8.5 crore", 116000000 -> "₹11.6 crore", 500000 -> "₹5 lakh"
 */
export function formatCurrencyINR(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : value;
  if (isNaN(num)) return String(value);

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 10000000) {
    const crores = abs / 10000000;
    const formatted = crores % 1 === 0 ? crores.toFixed(0) : crores.toFixed(2).replace(/\.?0+$/, '');
    return `${sign}₹${formatted} crore`;
  }

  if (abs >= 100000) {
    const lakhs = abs / 100000;
    const formatted = lakhs % 1 === 0 ? lakhs.toFixed(0) : lakhs.toFixed(2).replace(/\.?0+$/, '');
    return `${sign}₹${formatted} lakh`;
  }

  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/**
 * Priority keys when extracting a concise scalar representation from a structured object.
 */
const HIGH_PRIORITY_KEYS = [
  'display_value',
  'normalized_value',
  'observed_value',
  'value',
  'extracted_value',
] as const;

const SECONDARY_PRIORITY_KEYS = [
  'verified_value',
  'verified_entity',
  'label',
  'name',
  'status',
] as const;

/**
 * Centrally formats any value for human-readable display.
 * Pure function, zero React dependencies, guaranteed never to return "[object Object]".
 */
export function formatDisplayValue(value: unknown, options?: FormatterOptions): string {
  const fallback = options?.fallback ?? 'Not available';

  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    if (options?.kind === 'currency') {
      return formatCurrencyINR(value);
    }
    return value.toLocaleString('en-US');
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (options?.kind === 'currency' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return formatCurrencyINR(parseFloat(trimmed));
    }
    return trimmed;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return fallback;
    return value.map((item) => formatDisplayValue(item, options)).join(', ');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // 1. Special Case: Claimed + Verified pair (e.g. GSTIN verification result)
    if ('claimed' in obj && 'verified' in obj) {
      const claimedPart = formatDisplayValue(obj.claimed, options);
      let verifiedStatus = '';
      if (obj.verified && typeof obj.verified === 'object') {
        const vObj = obj.verified as Record<string, unknown>;
        if (vObj.status) {
          verifiedStatus = String(vObj.status);
        } else {
          verifiedStatus = formatDisplayValue(vObj, options);
        }
      } else if (obj.verified != null) {
        verifiedStatus = String(obj.verified);
      }
      return verifiedStatus ? `${claimedPart} · ${verifiedStatus}` : claimedPart;
    }

    // 2. Identifier/Type + Status pair (e.g. { name: "GST", status: "ACTIVE" } -> "GST · ACTIVE")
    const idKey = ['name', 'type', 'label', 'field'].find((k) => k in obj && obj[k] != null && typeof obj[k] !== 'object');
    if (idKey && 'status' in obj && obj.status != null && typeof obj.status !== 'object') {
      const idVal = String(obj[idKey]);
      const statusVal = String(obj.status);
      return `${idVal} · ${statusVal}`;
    }

    // 3. High-priority explicit value keys
    for (const key of HIGH_PRIORITY_KEYS) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        const candidate = obj[key];
        if (typeof candidate !== 'object' || candidate === null) {
          return formatDisplayValue(candidate, options);
        }
        const candidateStr = formatDisplayValue(candidate, options);
        if (candidateStr !== fallback && !candidateStr.includes('[object Object]')) {
          return candidateStr;
        }
      }
    }

    // 4. Secondary priority keys
    for (const key of SECONDARY_PRIORITY_KEYS) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        const candidate = obj[key];
        if (typeof candidate !== 'object' || candidate === null) {
          return formatDisplayValue(candidate, options);
        }
        const candidateStr = formatDisplayValue(candidate, options);
        if (candidateStr !== fallback && !candidateStr.includes('[object Object]')) {
          return candidateStr;
        }
      }
    }

    // 5. Short summary from primitive properties
    const primitiveValues: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v !== 'object') {
        primitiveValues.push(String(v));
      } else {
        const nestedObj = v as Record<string, unknown>;
        if (typeof nestedObj.status === 'string') {
          primitiveValues.push(`${k}: ${nestedObj.status}`);
        }
      }
      if (primitiveValues.length >= 3) break;
    }
    if (primitiveValues.length > 0) {
      return primitiveValues.join(' · ');
    }

    // 6. Safe fallback: formatted key-values or JSON stringify (never "[object Object]")
    try {
      if (options?.concise !== false) {
        const pairs = Object.entries(obj)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${formatDisplayValue(v, options)}`);
        return pairs.join(', ');
      }
      return JSON.stringify(obj);
    } catch {
      return fallback;
    }
  }

  // Absolute safety against unknown types
  try {
    const coerced = String(value);
    return coerced.includes('[object Object]') ? fallback : coerced;
  } catch {
    return fallback;
  }
}

/**
 * Checks if a requirement or field represents monetary / financial currency value.
 */
function isMonetaryContext(context?: ExpectedConditionContext): boolean {
  if (!context) return false;

  const unit = (context.unit || '').trim().toLowerCase();
  if (['inr', 'rs', 'rs.', '₹', 'crore', 'crores', 'lakh', 'lakhs'].includes(unit)) {
    return true;
  }

  const field = (context.field || '').trim().toLowerCase();
  const monetaryKeywords = ['turnover', 'annual_turnover', 'financial', 'budget', 'cost', 'bid_value', 'emd', 'price', 'amount'];
  if (monetaryKeywords.some((kw) => field.includes(kw))) {
    return true;
  }

  const reqType = (context.requirementType || '').trim().toUpperCase();
  if (['FINANCIAL', 'TURNOVER'].includes(reqType)) {
    return true;
  }

  return false;
}

/**
 * Formats compliance expected condition safely with full context awareness.
 *
 * e.g.
 * operator="EXISTS", expectedValue=true -> "Required"
 * operator="GTE", expectedValue=85000000, field="financial.average_annual_turnover" -> "≥ ₹8.5 crore"
 * operator="GTE", expectedValue=5, unit="years" -> "≥ 5 years"
 * operator="GTE", expectedValue=3, unit="projects" -> "≥ 3 projects"
 */
export function formatExpectedCondition(
  operator?: string | null,
  expectedValue?: unknown,
  context?: ExpectedConditionContext
): string {
  const opRaw = (operator || '').trim().toUpperCase();

  // 1. Existence operators
  if (opRaw === 'EXISTS' || opRaw === 'EXIST') {
    if (expectedValue === true || expectedValue === 'true' || expectedValue == null) {
      return 'Required';
    }
    if (expectedValue === false || expectedValue === 'false') {
      return 'Must not exist';
    }
  }

  // 2. Map standard operator symbols
  let symbol = '';
  switch (opRaw) {
    case 'GTE':
    case '>=':
      symbol = '≥';
      break;
    case 'LTE':
    case '<=':
      symbol = '≤';
      break;
    case 'GT':
    case '>':
      symbol = '>';
      break;
    case 'LT':
    case '<':
      symbol = '<';
      break;
    case 'EQUALS':
    case 'EQ':
    case '=':
    case '==':
      symbol = '';
      break;
    default:
      symbol = operator ? operator.trim() : '';
      break;
  }

  const isCurrency = isMonetaryContext(context);
  let valueStr = '';

  if (isCurrency && (typeof expectedValue === 'number' || (typeof expectedValue === 'string' && /^-?\d+(\.\d+)?$/.test(expectedValue.trim())))) {
    valueStr = formatCurrencyINR(Number(expectedValue));
  } else {
    valueStr = formatDisplayValue(expectedValue, { kind: isCurrency ? 'currency' : 'text' });
    if (context?.unit && !valueStr.toLowerCase().includes(context.unit.toLowerCase())) {
      valueStr = `${valueStr} ${context.unit.trim()}`;
    }
  }

  if (!symbol) return valueStr;
  return `${symbol} ${valueStr}`.trim();
}

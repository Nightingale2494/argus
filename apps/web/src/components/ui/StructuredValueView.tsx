import React from 'react';
import { formatDisplayValue, isStructuredValue } from '../../lib/formatters';

interface StructuredValueViewProps {
  value: unknown;
  label?: string;
  className?: string;
}

export const StructuredValueView: React.FC<StructuredValueViewProps> = ({
  value,
  label,
  className = '',
}) => {
  if (value === null || value === undefined) {
    return <span className="text-zinc-500 font-mono text-xs">Not available</span>;
  }

  // Primitive value
  if (!isStructuredValue(value)) {
    return (
      <span className={`font-mono text-xs text-zinc-200 ${className}`}>
        {formatDisplayValue(value)}
      </span>
    );
  }

  // Array of values
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-zinc-500 font-mono text-xs">None</span>;
    }
    return (
      <div className={`space-y-1 ${className}`}>
        {value.map((item, idx) => (
          <div key={idx} className="p-2 rounded bg-zinc-900/60 border border-zinc-800 text-xs font-mono">
            <StructuredValueView value={item} />
          </div>
        ))}
      </div>
    );
  }

  const obj = value as Record<string, unknown>;

  // Case 1: Claimed & Verified Structure (e.g. GSTIN clause 2.1)
  if ('claimed' in obj && 'verified' in obj) {
    const verifiedObj =
      obj.verified && typeof obj.verified === 'object'
        ? (obj.verified as Record<string, unknown>)
        : null;

    const status = verifiedObj?.status ? String(verifiedObj.status) : String(obj.verified ?? '—');
    const entity = verifiedObj?.verified_entity ? String(verifiedObj.verified_entity) : null;
    const isPass = ['ACTIVE', 'VALID', 'VERIFIED'].includes(status.toUpperCase());

    return (
      <div className={`space-y-2 rounded-lg bg-zinc-900/80 border border-zinc-800 p-3 text-xs font-mono ${className}`}>
        {label && <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 text-[11px] block">Claimed</span>
            <span className="text-zinc-100 font-semibold break-all">{formatDisplayValue(obj.claimed)}</span>
          </div>

          <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 text-[11px] block">Verification Status</span>
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                isPass ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
              }`}
            >
              {status}
            </span>
          </div>
        </div>

        {entity && (
          <div className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 text-[11px] block">Verified Entity</span>
            <span className="text-zinc-200 font-medium">{entity}</span>
          </div>
        )}

        {/* Any additional fields in verified object */}
        {verifiedObj &&
          Object.entries(verifiedObj).map(([k, v]) => {
            if (['status', 'verified_entity'].includes(k) || v == null) return null;
            return (
              <div key={k} className="p-2 rounded bg-zinc-950/40 border border-zinc-800/40 flex justify-between">
                <span className="text-zinc-500 text-[11px]">{k}</span>
                <span className="text-zinc-300">{formatDisplayValue(v)}</span>
              </div>
            );
          })}
      </div>
    );
  }

  // Case 2: Generic Structured Object
  return (
    <div className={`space-y-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 text-xs font-mono ${className}`}>
      {label && <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} className="p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 text-[10px] uppercase tracking-wider block">{k}</span>
            <div className="mt-0.5 text-zinc-200 break-words">
              {isStructuredValue(v) ? (
                <StructuredValueView value={v} />
              ) : (
                <span className="font-semibold">{formatDisplayValue(v)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

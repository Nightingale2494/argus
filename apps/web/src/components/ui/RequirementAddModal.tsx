'use client';

import React, { useState, useMemo } from 'react';
import { X, Plus, AlertTriangle, CheckCircle2, Sliders } from 'lucide-react';
import type { OperatorEnum, RequirementType, TenderRequirementCreate } from '@/types/api';
import { api } from '@/services/api';
import {
  CANONICAL_FIELDS,
  CanonicalFieldDefinition,
  getCanonicalField,
} from '@/services/canonical-fields';

export interface RequirementAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenderId: string;
  onSubmit?: (data: TenderRequirementCreate) => Promise<void>;
  onAdded?: () => void | Promise<void>;
  isSubmitting?: boolean;
}

const ALL_CATEGORIES = [
  'All',
  'Financial',
  'Tax',
  'Corporate',
  'MSME',
  'Labour & Statutory',
  'Experience',
  'Legal & Compliance',
  'Document',
];

const ALL_OPERATORS: { value: OperatorEnum; label: string }[] = [
  { value: 'GTE', label: '>= (GTE)' },
  { value: 'GT', label: '> (GT)' },
  { value: 'LTE', label: '<= (LTE)' },
  { value: 'LT', label: '< (LT)' },
  { value: 'EQ', label: '== (EQ)' },
  { value: 'NE', label: '!= (NE)' },
  { value: 'IN', label: 'IN' },
  { value: 'NOT_IN', label: 'NOT IN' },
  { value: 'EXISTS', label: 'EXISTS' },
  { value: 'NOT_EXISTS', label: 'NOT EXISTS' },
  { value: 'COUNT_GTE', label: 'COUNT >= (COUNT_GTE)' },
  { value: 'DATE_BEFORE', label: 'DATE BEFORE' },
  { value: 'DATE_AFTER', label: 'DATE AFTER' },
];

export const RequirementAddModal: React.FC<RequirementAddModalProps> = ({
  isOpen,
  onClose,
  tenderId,
  onSubmit,
  onAdded,
  isSubmitting: propSubmitting,
}) => {
  const [clause, setClause] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isCustomField, setIsCustomField] = useState(false);
  const [selectedCanonicalKey, setSelectedCanonicalKey] = useState(CANONICAL_FIELDS[0].key);

  const [requirementType, setRequirementType] = useState<RequirementType>(
    CANONICAL_FIELDS[0].requirementType
  );
  const [field, setField] = useState(CANONICAL_FIELDS[0].key);
  const [operator, setOperator] = useState<OperatorEnum>('GTE');
  const [expectedValue, setExpectedValue] = useState('');
  const [unit, setUnit] = useState(CANONICAL_FIELDS[0].unitSemantics || '');
  const [mandatory, setMandatory] = useState(true);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter canonical fields by category
  const filteredCanonicalFields = useMemo(() => {
    if (selectedCategory === 'All') return CANONICAL_FIELDS;
    return CANONICAL_FIELDS.filter((f) => f.category === selectedCategory);
  }, [selectedCategory]);

  // Active canonical field definition
  const activeCanonicalField: CanonicalFieldDefinition | undefined = useMemo(() => {
    if (isCustomField) return undefined;
    return getCanonicalField(selectedCanonicalKey);
  }, [isCustomField, selectedCanonicalKey]);

  // Allowed operators constrained by data type
  const availableOperators = useMemo(() => {
    if (isCustomField || !activeCanonicalField) {
      return ALL_OPERATORS;
    }
    const allowed = new Set(activeCanonicalField.allowedOperators);
    return ALL_OPERATORS.filter((op) => allowed.has(op.value));
  }, [isCustomField, activeCanonicalField]);

  // Handle canonical field change
  const handleCanonicalSelect = (canonKey: string) => {
    setSelectedCanonicalKey(canonKey);
    const def = getCanonicalField(canonKey);
    if (def) {
      setField(def.key);
      setRequirementType(def.requirementType);
      setUnit(def.unitSemantics || '');
      if (!def.allowedOperators.includes(operator)) {
        setOperator(def.allowedOperators[0]);
      }
    }
  };

  // Custom field syntax validation
  const customFieldSyntaxValid = useMemo(() => {
    if (!isCustomField) return true;
    if (!field.trim()) return false;
    return /^[a-zA-Z0-9_.]+$/.test(field.trim());
  }, [isCustomField, field]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isCustomField && !customFieldSyntaxValid) {
      setError(
        'Custom field identifier must contain only alphanumeric characters, underscores, and dots (e.g. custom.iso_certification).'
      );
      return;
    }

    setLocalSubmitting(true);
    const payload: TenderRequirementCreate = {
      clause,
      requirement_type: requirementType,
      field: field.trim(),
      operator,
      expected_value: expectedValue.trim(),
      unit: unit.trim() || undefined,
      mandatory,
      confidence: 1.0,
      requires_verification: true,
      is_approved: true,
    };

    try {
      if (onSubmit) {
        await onSubmit(payload);
      } else {
        await api.createTenderRequirement(tenderId, payload);
        if (onAdded) await onAdded();
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add requirement.');
    } finally {
      setLocalSubmitting(false);
    }
  };

  const isSubmitting = propSubmitting ?? localSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl space-y-4 text-zinc-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-400" /> Add Evaluation Clause
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Clause Reference *</label>
            <input
              type="text"
              required
              value={clause}
              onChange={(e) => setClause(e.target.value)}
              placeholder="e.g. Section 4.2 - Annual Turnover"
              className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Canonical Field Selector Controls */}
          {!isCustomField ? (
            <div className="space-y-3 p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" /> Canonical Statutory Field
                </span>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Automated Registry Verification Ready
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Category Filter</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-blue-500"
                  >
                    {ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Canonical Metric *</label>
                  <select
                    value={selectedCanonicalKey}
                    onChange={(e) => handleCanonicalSelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-blue-500 font-mono"
                  >
                    {filteredCanonicalFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.displayName} ({f.dataType})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeCanonicalField && (
                <p className="text-[11px] text-zinc-400 italic">
                  {activeCanonicalField.description}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-3.5 rounded-xl bg-amber-950/20 border border-amber-800/40">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>Custom Non-Canonical Field Definition</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                Advisory: Custom non-canonical fields lack pre-wired statutory registry adapters (GST, MCA, EPFO, Udyam) and require manual officer verification or document fact extraction.
              </p>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Requirement Type *</label>
                  <select
                    value={requirementType}
                    onChange={(e) => setRequirementType(e.target.value as RequirementType)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="TURNOVER">TURNOVER</option>
                    <option value="EXPERIENCE_YEARS">EXPERIENCE_YEARS</option>
                    <option value="SIMILAR_WORK_VALUE">SIMILAR_WORK_VALUE</option>
                    <option value="GST_ACTIVE">GST_ACTIVE</option>
                    <option value="PAN_MATCH">PAN_MATCH</option>
                    <option value="CIN_ACTIVE">CIN_ACTIVE</option>
                    <option value="UDYAM_MSME">UDYAM_MSME</option>
                    <option value="LOCAL_CONTENT">LOCAL_CONTENT</option>
                    <option value="OEM_AUTH">OEM_AUTH</option>
                    <option value="TECHNICAL_SPEC">TECHNICAL_SPEC</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">Custom Field Key *</label>
                  <input
                    type="text"
                    required
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    placeholder="e.g. custom.iso_9001_certified"
                    className={`w-full px-3 py-2 rounded-lg bg-zinc-950 border text-zinc-100 text-xs font-mono focus:outline-none ${
                      customFieldSyntaxValid
                        ? 'border-zinc-800 focus:border-amber-500'
                        : 'border-rose-500 focus:border-rose-500'
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Advanced Custom Field Toggle */}
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              onClick={() => {
                const next = !isCustomField;
                setIsCustomField(next);
                if (!next) {
                  handleCanonicalSelect(selectedCanonicalKey);
                }
              }}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-blue-400" />
              <span>{isCustomField ? 'Switch back to Standard Canonical Field' : 'Configure Custom Field (Advanced)'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Operator *</label>
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value as OperatorEnum)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-blue-500 font-mono"
              >
                {availableOperators.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Expected Value *</label>
              <input
                type="text"
                required
                value={expectedValue}
                onChange={(e) => setExpectedValue(e.target.value)}
                placeholder="e.g. 50000000"
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Unit</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="INR, years, etc."
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="mandatory"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="rounded border-zinc-800 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="mandatory" className="text-xs text-zinc-300 cursor-pointer">
              Mandatory disqualifying requirement
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (isCustomField && !customFieldSyntaxValid)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Clause'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

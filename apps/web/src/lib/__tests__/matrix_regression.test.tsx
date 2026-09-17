import { describe, it } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { formatDisplayValue, formatExpectedCondition } from '../formatters.ts';
import { EvidenceDrawer } from '../../components/ui/EvidenceDrawer';
import type { ComplianceMatrixRow } from '../../types/api';

describe('Compliance Matrix Page-Level Regression', () => {
  const productionGstRow = {
    id: 'f914bbd6-4465-40f9-a4d3-38dc848b4f15',
    bidder_id: '52b86491-5749-4853-b510-183b75285aa8',
    requirement_id: 'req_c01',
    clause: '2.1',
    requirement_type: 'STATUTORY',
    field: 'tax.gstin',
    operator: 'EXISTS',
    expected_value: true,
    unit: null,
    mandatory: true,
    status: 'REVIEW_REQUIRED',
    reason_code: 'AMBIGUOUS_VERIFIED_VALUE',
    observed_value: {
      claimed: '29ABCDE5678K1Z1',
      verified: {
        status: 'ACTIVE',
        verified_entity: 'Surya Tech Energy Solutions Pvt Ltd',
      },
    },
    review_required: true,
    evidence_ids: ['fb574385-ad5d-4c1a-9ed0-e751d9e00de0'],
  };

  const productionTurnoverRow = {
    id: '13149485-ce85-4795-88ba-09ce054a7612',
    bidder_id: '52b86491-5749-4853-b510-183b75285aa8',
    requirement_id: 'req_c02',
    clause: '2.4',
    requirement_type: 'FINANCIAL',
    field: 'financial.average_annual_turnover',
    operator: 'GTE',
    expected_value: 85000000,
    unit: 'INR',
    mandatory: true,
    status: 'REVIEW_REQUIRED',
    reason_code: 'MALFORMED_NUMBER',
    observed_value: 'Rs. 11.6 crore (3-year average)',
    review_required: true,
    evidence_ids: ['539e28ad-df99-4b4f-9fae-829ea726f35a'],
  };

  it('renders table cells without any [object Object]', () => {
    // Render GST clause table cell
    const expectedGst = formatExpectedCondition(
      productionGstRow.operator,
      productionGstRow.expected_value,
      {
        unit: productionGstRow.unit,
        requirementType: productionGstRow.requirement_type,
        field: productionGstRow.field,
      }
    );
    const observedGst = formatDisplayValue(productionGstRow.observed_value, { fallback: '—' });

    assert.strictEqual(expectedGst, 'Required');
    assert.strictEqual(observedGst, '29ABCDE5678K1Z1 · ACTIVE');
    assert.ok(!observedGst.includes('[object Object]'));

    // Render Turnover clause table cell
    const expectedTurnover = formatExpectedCondition(
      productionTurnoverRow.operator,
      productionTurnoverRow.expected_value,
      {
        unit: productionTurnoverRow.unit,
        requirementType: productionTurnoverRow.requirement_type,
        field: productionTurnoverRow.field,
      }
    );
    const observedTurnover = formatDisplayValue(productionTurnoverRow.observed_value, { fallback: '—' });

    assert.strictEqual(expectedTurnover, '≥ ₹8.5 crore');
    assert.strictEqual(observedTurnover, 'Rs. 11.6 crore (3-year average)');
    assert.ok(!expectedTurnover.includes('[object Object]'));
    assert.ok(!observedTurnover.includes('[object Object]'));
  });

  it('renders EvidenceDrawer with full structured verification details', () => {
    const html = renderToString(
      React.createElement(EvidenceDrawer, {
        isOpen: true,
        onClose: () => {},
        row: productionGstRow as unknown as ComplianceMatrixRow,
        bidderName: 'Surya Tech Energy Solutions Pvt Ltd',
      })
    );

    // Assert rendered HTML contains expected text
    assert.ok(html.includes('29ABCDE5678K1Z1'), 'Should contain claimed GSTIN');
    assert.ok(html.includes('ACTIVE'), 'Should contain verification status ACTIVE');
    assert.ok(
      html.includes('Surya Tech Energy Solutions Pvt Ltd'),
      'Should contain verified entity name'
    );
    assert.ok(html.includes('Required'), 'Should render Required for expected value');

    // Assert strictly zero [object Object] occurrences
    assert.ok(
      !html.includes('[object Object]'),
      `EvidenceDrawer HTML must not contain [object Object], but found: ${html}`
    );
  });
});

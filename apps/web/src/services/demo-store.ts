/**
 * Navigation Metadata Mirror.
 * 
 * Strictly contains canonical IDs, route paths, and navigation labels for browser routing.
 * Domain truth, turnover thresholds, requirements, statutory results, compliance outcomes,
 * RAG text, and Deep Audit findings are 100% owned and executed by the backend API.
 * Backend demo_fixtures.py remains the single domain source of truth.
 */

export const DEMO_FIXTURE_VERSION = '2026.09.15.1';

export interface DemoScenarioNav {
  readonly id: string;
  readonly name: string;
  readonly scenario: string;
  readonly targetPath: string;
  readonly description: string;
}

export const DEMO_NAVIGATION = {
  version: DEMO_FIXTURE_VERSION,
  flagshipTenderId: 'tender_gem_2026_01',
  flagshipTenderNumber: 'GEM/2026/B/4521089',
  bidders: [
    {
      id: 'bidder_alpha_01',
      name: 'ALPHA TECHNOLOGIES PRIVATE LIMITED',
      scenario: 'Flagship Evaluation Scenario',
      targetPath: '/workspace/bidders/bidder_alpha_01',
      description: 'Primary evaluation flow demonstrating compliant bidder verification and evidence chaining.',
    },
    {
      id: 'bidder_bharat_03',
      name: 'BHARAT INFOSYSTEMS LLP',
      scenario: 'Review Investigation Scenario',
      targetPath: '/workspace/bidders/bidder_bharat_03',
      description: 'Secondary evaluation flow demonstrating variance detection and officer review handoff.',
    },
    {
      id: 'bidder_crest_02',
      name: 'CREST SOLUTIONS PRIVATE LIMITED',
      scenario: 'Statutory Verification Scenario',
      targetPath: '/workspace/bidders/bidder_crest_02',
      description: 'Tertiary evaluation flow demonstrating registry status tracking and exception handling.',
    },
  ] as readonly DemoScenarioNav[],
} as const;


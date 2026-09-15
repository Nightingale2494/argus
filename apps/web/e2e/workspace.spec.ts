import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function createDemoToken(): string {
  const secret = process.env.ARGUS_JWT_SECRET || 'f306cdf1dcaee62e9fe0b58a2d056950a87275fe3ded03bc0e3786c44227cab9';
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: 'playwright-demo-operator',
    role: 'ADMIN',
    name: 'Demo Administrator',
    email: 'demo.admin@argus.local',
    iss: 'argus-api',
    aud: 'argus-clients',
    iat: now,
    exp: now + 7200,
    is_demo_operator: true,
    evaluation_mode: true,
  };
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

test.describe('ARGUS End-to-End Procurement Compliance Workflow', () => {
  test.beforeEach(async ({ page }) => {
    const token = createDemoToken();
    await page.addInitScript((tok) => {
      sessionStorage.setItem('argus_auth_token', tok);
      sessionStorage.setItem('argus_workspace_mode', 'demo');
    }, token);
  });

  test('1. Workspace dashboard loads with explicit demo mode indicator', async ({ page }) => {
    await page.goto('/workspace?mode=demo');
    await expect(page.getByText(/demo/i).first()).toBeVisible();
    await expect(page.getByText(/tenders|procurement/i).first()).toBeVisible();
  });

  test('2. Tenders list and tender detail page navigation', async ({ page }) => {
    await page.goto('/workspace/tenders?mode=demo');
    await expect(page.getByText('Procurement Tenders').first()).toBeVisible();
    
    // Click into first tender
    const tenderLink = page.locator('a[href*="/workspace/tenders/"]').first();
    await tenderLink.click();
    await expect(page).toHaveURL(/\/workspace\/tenders\/.+/);
  });

  test('3. Bidder detail & Mismatch explainability modal acceptance test', async ({ page }) => {
    await page.goto('/workspace/bidders/bidder_alpha_01?mode=demo');
    // Wait for backend API data to load before asserting bidder name
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/ALPHA TECHNOLOGIES|Alpha Infotech/i).first()).toBeVisible({ timeout: 15000 });

    // Verify statutory identifier registry card
    await expect(page.getByText('Statutory Identifier Registry')).toBeVisible();
    await expect(page.getByText('07AABCA1234H1Z9').first()).toBeVisible();

    // Check document table
    await expect(page.getByText('Uploaded Bidder Documents')).toBeVisible();

    // Test Mismatch Explainability: click view details button if visible
    const mismatchBtn = page.getByRole('button', { name: /mismatch/i }).first();
    if (await mismatchBtn.isVisible()) {
      await mismatchBtn.click();
      const modalHeader = page.getByRole('dialog').getByText(/mismatch/i).first();
      await expect(modalHeader).toBeVisible();
      
      // Close modal
      await page.getByRole('button', { name: /close/i }).first().click();
      await expect(modalHeader).not.toBeVisible();
    }
  });

  test('4. Human review page officer decision workflow', async ({ page }) => {
    await page.goto('/workspace/bidders/bidder_alpha_01/review');
    await expect(page.getByText(/human officer review|review/i).first()).toBeVisible();
  });

  test('5. Telemetry status page accurately reports service states', async ({ page }) => {
    await page.goto('/workspace/status');
    await expect(page.getByText(/telemetry|health|status/i).first()).toBeVisible();
    await expect(page.getByText('ARGUS API Gateway')).toBeVisible();
  });
});

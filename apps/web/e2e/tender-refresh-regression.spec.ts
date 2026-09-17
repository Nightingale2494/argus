import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function createDemoToken(): string {
  const secret = process.env.ARGUS_JWT_SECRET || '';
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: 'playwright-regression-tester',
    role: 'ADMIN',
    name: 'Regression Tester',
    email: 'test@argus.local',
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

test.describe('Tender Detail & Job Execution Infinite Loop Regression Suite', () => {
  test.beforeEach(async ({ page }) => {
    const token = createDemoToken();
    await page.addInitScript((tok) => {
      sessionStorage.setItem('argus_auth_token', tok);
      sessionStorage.setItem('argus_workspace_mode', 'demo');
    }, token);

    // Mock demo status/seed endpoints to bypass backend requirement
    await page.route('**/api/v1/demo/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ seeded: true }) });
    });
    await page.route('**/api/v1/demo/seed', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK' }) });
    });
    await page.route('**/api/auth/dev-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token }) });
    });
  });

  test('1. Tender detail processing job: QUEUED -> RUNNING -> COMPLETED without refresh loop', async ({ page }) => {
    let processPostCount = 0;
    let tenderGetCount = 0;
    let jobPollCount = 0;

    const mockTenderId = 'tender_gem_2026_01';

    // Mock Tender Details
    await page.route(`**/api/v1/tenders/${mockTenderId}`, async (route) => {
      tenderGetCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockTenderId,
          title: 'Supply of IT Infrastructure & Server Racks',
          tender_number: 'GEM/2026/B/4521089',
          status: 'ACTIVE',
          authority: 'RailTel Corporation of India Ltd',
          budget: 15000000,
          deadline: '2026-10-31T18:00:00Z',
          published_date: '2026-03-01T10:00:00Z',
          created_at: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        }),
      });
    });

    // Mock Bidders
    await page.route(`**/api/v1/tenders/${mockTenderId}/bidders`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'bidder_01',
            tender_id: mockTenderId,
            bidder_name: 'Alpha Technologies Pvt Ltd',
            gstin: '07AABCA1234H1Z9',
            cin: 'U72200DL2020PTC123456',
            pan: 'AABCA1234H',
            status: 'PENDING',
            created_at: '2026-03-01T10:00:00Z',
            updated_at: '2026-03-01T10:00:00Z',
          },
        ]),
      });
    });

    // Mock Requirements
    await page.route(`**/api/v1/tenders/${mockTenderId}/requirements`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    // Mock Process Trigger
    const mockJobId = 'job_e2e_comp_001';
    await page.route(`**/api/v1/tenders/${mockTenderId}/process`, async (route) => {
      processPostCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockJobId,
          tender_id: mockTenderId,
          status: 'QUEUED',
          current_stage: 'UPLOAD',
          progress: 10,
          created_at: new Date().toISOString(),
        }),
      });
    });

    // Mock SSE Stream
    await page.route(`**/api/v1/jobs/${mockJobId}/events*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: 'event: ping\ndata: {}\n\n',
      });
    });

    // Mock Job Polling Status: Call 1 = RUNNING, Call 2+ = COMPLETED
    await page.route(`**/api/v1/jobs/${mockJobId}`, async (route) => {
      jobPollCount++;
      if (jobPollCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            tender_id: mockTenderId,
            status: 'RUNNING',
            current_stage: 'PARSING',
            progress: 45,
            started_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            tender_id: mockTenderId,
            status: 'COMPLETED',
            current_stage: 'REPORTING',
            progress: 100,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }),
        });
      }
    });

    // Navigate to tender detail page
    await page.goto(`/workspace/tenders/${mockTenderId}?mode=demo`);
    await page.waitForLoadState('domcontentloaded');

    // Confirm initial render of tender title and content
    const tenderTitle = page.getByRole('heading', { name: /Supply of IT Infrastructure & Server Racks/i });
    await expect(tenderTitle).toBeVisible({ timeout: 10000 });

    // Baseline GET count after initial hydration
    const baselineTenderGetCount = tenderGetCount;
    expect(baselineTenderGetCount).toBeGreaterThanOrEqual(1);

    // Track if full-page loader is present
    const fullPageLoader = page.locator('main').getByText('Retrieving authoritative tender state...');
    expect(await fullPageLoader.count()).toBe(0);

    // Trigger AI extraction
    const extractBtn = page.getByRole('button', { name: /Extract AI Criteria/i });
    await expect(extractBtn).toBeVisible();
    await extractBtn.click();

    // Verify process endpoint was called exactly once
    expect(processPostCount).toBe(1);

    // Drawer should open and be visible
    const drawerHeader = page.getByRole('heading', { name: /Autonomous Pipeline Execution/i });
    await expect(drawerHeader).toBeVisible({ timeout: 5000 });

    // Drawer should transition to COMPLETED
    const completedBadge = page.locator('span:text-is("COMPLETED")');
    await expect(completedBadge).toBeVisible({ timeout: 15000 });

    // Tender title and main content must remain mounted and visible
    await expect(tenderTitle).toBeVisible();

    // Wait 3.5 seconds to observe if any remount, refetch, or infinite loop occurs
    await page.waitForTimeout(3500);

    // Assertions
    // 1. Process was posted exactly once (no auto-retry or re-trigger)
    expect(processPostCount).toBe(1);

    // 2. Post-terminal tender refresh occurred exactly once
    expect(tenderGetCount - baselineTenderGetCount).toBe(1);

    // 3. Full-page blocking loader never reappeared after initial load
    expect(await fullPageLoader.count()).toBe(0);

    // 4. Drawer remains open and stable
    await expect(drawerHeader).toBeVisible();
    await expect(completedBadge).toBeVisible();
  });

  test('2. Tender detail failed job: QUEUED -> RUNNING -> FAILED keeps page & drawer visible without retry', async ({ page }) => {
    let processPostCount = 0;
    let jobPollCount = 0;
    const mockTenderId = 'tender_gem_2026_fail';

    await page.route(`**/api/v1/tenders/${mockTenderId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockTenderId,
          title: 'Fail Test Tender',
          tender_number: 'GEM/2026/B/9999999',
          status: 'ACTIVE',
          authority: 'Test Authority',
          budget: 500000,
        }),
      });
    });

    await page.route(`**/api/v1/tenders/${mockTenderId}/bidders`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route(`**/api/v1/tenders/${mockTenderId}/requirements`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    const mockJobId = 'job_e2e_fail_001';
    await page.route(`**/api/v1/tenders/${mockTenderId}/process`, async (route) => {
      processPostCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockJobId,
          tender_id: mockTenderId,
          status: 'QUEUED',
          current_stage: 'UPLOAD',
          progress: 10,
        }),
      });
    });

    await page.route(`**/api/v1/jobs/${mockJobId}/events*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: 'event: ping\ndata: {}\n\n',
      });
    });

    const failureErrorMessage = 'Corrupt PDF binary: SHA-256 integrity mismatch in OCR engine';

    await page.route(`**/api/v1/jobs/${mockJobId}`, async (route) => {
      jobPollCount++;
      if (jobPollCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            tender_id: mockTenderId,
            status: 'RUNNING',
            current_stage: 'OCR',
            progress: 35,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            tender_id: mockTenderId,
            status: 'FAILED',
            current_stage: 'OCR',
            progress: 35,
            error_message: failureErrorMessage,
          }),
        });
      }
    });

    await page.goto(`/workspace/tenders/${mockTenderId}?mode=demo`);
    await page.waitForLoadState('domcontentloaded');

    const tenderTitle = page.getByRole('heading', { name: /Fail Test Tender/i });
    await expect(tenderTitle).toBeVisible({ timeout: 10000 });

    const extractBtn = page.getByRole('button', { name: /Extract AI Criteria/i });
    await extractBtn.click();

    expect(processPostCount).toBe(1);

    // Verify FAILED badge in drawer
    const failedBadge = page.locator('span:text-is("FAILED")');
    await expect(failedBadge).toBeVisible({ timeout: 10000 });

    // Verify error banner displaying the authoritative backend error message
    const errorBannerText = page.getByText(failureErrorMessage);
    await expect(errorBannerText).toBeVisible({ timeout: 5000 });

    // Verify page content remains visible
    await expect(tenderTitle).toBeVisible();

    // Verify no full-page loader appears
    const fullPageLoader = page.locator('main').getByText('Retrieving authoritative tender state...');
    expect(await fullPageLoader.count()).toBe(0);

    // Wait 3 seconds: ensure no auto-retry or re-process
    await page.waitForTimeout(3000);
    expect(processPostCount).toBe(1);
  });

  test('3. Bidder detail verification job: QUEUED -> RUNNING -> COMPLETED with single silent refresh', async ({ page }) => {
    let verifyPostCount = 0;
    let bidderGetCount = 0;
    let jobPollCount = 0;
    const mockBidderId = 'bidder_e2e_001';

    await page.route(`**/api/v1/bidders/${mockBidderId}`, async (route) => {
      bidderGetCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockBidderId,
          tender_id: 'tender_01',
          bidder_name: 'Zenith Global Solutions Pvt Ltd',
          gstin: '29ABCDE1234F1Z5',
          cin: 'U72900KA2021PTC654321',
          pan: 'ABCDE1234F',
          status: 'PENDING',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    });

    await page.route(`**/api/v1/bidders/${mockBidderId}/report`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bidder_id: mockBidderId,
          verification_results: [],
          evidence: [],
        }),
      });
    });

    await page.route(`**/api/v1/bidders/${mockBidderId}/matrix`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          overall_status: 'PASS',
          rows: [],
        }),
      });
    });

    await page.route(`**/api/v1/bidders/${mockBidderId}/documents`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route(`**/api/v1/bidders/${mockBidderId}/runs`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    const mockJobId = 'job_verify_001';
    await page.route(`**/api/v1/bidders/${mockBidderId}/verify`, async (route) => {
      verifyPostCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockJobId,
          status: 'QUEUED',
          current_stage: 'UPLOAD',
          progress: 10,
        }),
      });
    });

    await page.route(`**/api/v1/jobs/${mockJobId}/events*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: 'event: ping\ndata: {}\n\n',
      });
    });

    await page.route(`**/api/v1/jobs/${mockJobId}`, async (route) => {
      jobPollCount++;
      if (jobPollCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            status: 'RUNNING',
            current_stage: 'VERIFICATION',
            progress: 50,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockJobId,
            status: 'COMPLETED',
            current_stage: 'COMPLETED',
            progress: 100,
          }),
        });
      }
    });

    await page.goto(`/workspace/bidders/${mockBidderId}?mode=demo`);
    await page.waitForLoadState('domcontentloaded');

    const bidderName = page.getByRole('heading', { name: /Zenith Global Solutions Pvt Ltd/i });
    await expect(bidderName).toBeVisible({ timeout: 10000 });

    const baselineBidderGetCount = bidderGetCount;
    expect(baselineBidderGetCount).toBeGreaterThanOrEqual(1);

    const fullPageLoader = page.locator('main').getByText('Loading bidder evaluation record...');
    expect(await fullPageLoader.count()).toBe(0);

    // Click "Run Statutory Checks"
    const verifyBtn = page.getByRole('button', { name: /Run Statutory Checks/i });
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    expect(verifyPostCount).toBe(1);

    // Drawer should open and transition to COMPLETED
    const drawerHeader = page.getByRole('heading', { name: /Autonomous Pipeline Execution/i });
    await expect(drawerHeader).toBeVisible({ timeout: 5000 });

    const completedBadge = page.locator('span:text-is("COMPLETED")');
    await expect(completedBadge).toBeVisible({ timeout: 15000 });

    // Page content remains visible
    await expect(bidderName).toBeVisible();

    // Wait 3.5 seconds to confirm stability
    await page.waitForTimeout(3500);

    // Verify assertions
    expect(verifyPostCount).toBe(1);
    expect(bidderGetCount - baselineBidderGetCount).toBe(1); // exactly 1 silent refresh after completion
    expect(await fullPageLoader.count()).toBe(0);
    await expect(drawerHeader).toBeVisible();
  });
});

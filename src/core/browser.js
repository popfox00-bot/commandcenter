// Headless Chromium via Playwright, loaded lazily so jobs that only use HTTP/APIs (and tests)
// never need a browser installed. One browser per process; one fresh context per page.

let browserPromise = null;

async function launch() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Playwright is not installed. Run `npm install` and `npx playwright install chromium`.');
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return playwright.chromium.launch({ headless: true, executablePath });
}

export function createBrowser({ politeness, http, log, signal }) {
  async function getBrowser() {
    browserPromise ??= launch();
    return browserPromise;
  }

  /**
   * Run fn(page) in a fresh browser context. Images, fonts and media are blocked by default
   * (faster and lighter on the site). Navigation should go through `goto` so robots.txt and
   * rate limits apply.
   */
  async function withPage(fn, { blockResources = ['image', 'font', 'media'], viewport = { width: 1280, height: 900 } } = {}) {
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: politeness.userAgent, locale: 'en-US', viewport, timezoneId: 'UTC' });
    try {
      if (blockResources.length) {
        await context.route('**/*', (route) => (blockResources.includes(route.request().resourceType()) ? route.abort() : route.continue()));
      }
      const page = await context.newPage();
      const onAbort = () => context.close().catch(() => {});
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return await fn(page, { goto: (url, opts) => goto(page, url, opts) });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function goto(page, url, { waitUntil = 'domcontentloaded', timeoutMs = 45_000 } = {}) {
    await http.gate(url);
    log.info('browser goto', { url });
    const res = await page.goto(url, { waitUntil, timeout: timeoutMs });
    return res;
  }

  return { withPage, goto };
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { await (await p).close(); } catch { /* already gone */ }
}

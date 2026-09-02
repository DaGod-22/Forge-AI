import fs from 'node:fs';
import path from 'node:path';
import { stateRoot } from '../config.js';
import { createId, nowIso, redactSecrets } from '../security.js';

export interface BrowserAutomationReport {
  id: string;
  status: 'passed' | 'failed' | 'blocked';
  url: string;
  title?: string;
  screenshotPath?: string;
  console: string[];
  networkFailures: string[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome'
].filter(Boolean) as string[];

export class BrowserAutomationService {
  async inspect(url: string): Promise<BrowserAutomationReport> {
    const startedAt = nowIso();
    const id = createId('browser');
    const base: BrowserAutomationReport = {
      id,
      status: 'blocked',
      url,
      console: [],
      networkFailures: [],
      errors: [],
      startedAt,
      finishedAt: startedAt
    };
    if (!/^https?:\/\//.test(url)) throw new Error('Browser automation URL must start with http:// or https://');

    const executablePath = chromiumCandidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!executablePath) {
      return {
        ...base,
        status: 'blocked',
        errors: ['No Chromium executable was found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or CHROME_BIN to enable full browser automation.'],
        finishedAt: nowIso()
      };
    }

    let chromium: any;
    try {
      const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
      chromium = (await importer('playwright-core')).chromium;
    } catch {
      return {
        ...base,
        status: 'blocked',
        errors: ['playwright-core is not installed. Install it to enable click/form/navigation automation.'],
        finishedAt: nowIso()
      };
    }

    const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const report = { ...base, status: 'passed' as BrowserAutomationReport['status'] };
      page.on('console', (message: any) => report.console.push(redactSecrets(`[${message.type()}] ${message.text()}`)));
      page.on('pageerror', (error: Error) => report.errors.push(redactSecrets(error.message)));
      page.on('requestfailed', (request: any) => report.networkFailures.push(redactSecrets(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`)));
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      report.title = await page.title();
      const screenshotDir = path.join(stateRoot, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      report.screenshotPath = path.join(screenshotDir, `${id}.png`);
      await page.screenshot({ path: report.screenshotPath, fullPage: true });
      if (report.errors.length || report.networkFailures.length) report.status = 'failed';
      report.finishedAt = nowIso();
      return report;
    } finally {
      await browser.close();
    }
  }
}

export const browserAutomationService = new BrowserAutomationService();

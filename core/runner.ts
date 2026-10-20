import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { chromium, type Locator, type Page } from 'playwright';
import { assertHostAllowed } from './gates.js';
import { appendJsonl, TODAY } from './project.js';
import { recordResult, upsertCase } from './workbook.js';
import { acquireRunLock } from './run-lock.js';
import type { Project, Result, TestCase } from './types.js';

function readCase(file: string): TestCase {
  const test = YAML.parse(fs.readFileSync(file, 'utf8')) as TestCase;
  if (!test?.id || !test.title || !Array.isArray(test.steps) || !Array.isArray(test.expect) || !test.expect.length) {
    throw new Error(`Testcase thiếu ID, title, steps hoặc assertion: ${file}`);
  }
  return test;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Bước testcase phải là object: ${JSON.stringify(value)}`);
  return value as Record<string, unknown>;
}

function namedLocator(page: Page, kind: string, name: string): Locator {
  if (kind === 'button') return page.getByRole('button', { name, exact: true });
  if (kind === 'link') return page.getByRole('link', { name, exact: true });
  if (kind === 'heading') return page.getByRole('heading', { name, exact: true });
  if (kind === 'text') return page.getByText(name, { exact: true });
  if (kind === 'label') return page.getByLabel(name, { exact: true });
  throw new Error(`Locator kind chưa hỗ trợ: ${kind}`);
}

async function oneStep(page: Page, stepValue: unknown, project: Project): Promise<void> {
  const step = asObject(stepValue);
  if (typeof step.open === 'string') {
    const url = new URL(step.open, project.base_url).toString();
    assertHostAllowed(url, project.allow_hosts);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return;
  }
  if (step.fill && typeof step.fill === 'object') {
    const spec = step.fill as { field?: string; value?: string; by?: 'label' | 'placeholder' };
    if (!spec.field || spec.value === undefined) throw new Error('fill cần field và value');
    const locator = spec.by === 'placeholder' ? page.getByPlaceholder(spec.field, { exact: true }) : page.getByLabel(spec.field, { exact: true });
    await locator.fill(String(spec.value), { timeout: 8000 });
    return;
  }
  if (step.click && typeof step.click === 'object') {
    const spec = step.click as { role?: string; name?: string };
    if (!spec.role || !spec.name) throw new Error('click cần role và name');
    await namedLocator(page, spec.role, spec.name).click({ timeout: 8000 });
    return;
  }
  if (typeof step.reload === 'boolean' && step.reload) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); return; }
  throw new Error(`Action chưa hỗ trợ: ${JSON.stringify(step)}`);
}

async function assertion(page: Page, value: unknown): Promise<void> {
  const spec = asObject(value);
  if (typeof spec.expect_text === 'string') {
    await page.getByText(spec.expect_text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  if (typeof spec.expect_url === 'string') {
    const expected = new RegExp(spec.expect_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!expected.test(page.url())) throw new Error(`URL actual=${page.url()}, expected chứa ${spec.expect_url}`);
    return;
  }
  if (spec.expect_visible && typeof spec.expect_visible === 'object') {
    const item = spec.expect_visible as { role?: string; name?: string };
    if (!item.role || !item.name) throw new Error('expect_visible cần role và name');
    await namedLocator(page, item.role, item.name).waitFor({ state: 'visible', timeout: 8000 });
    return;
  }
  if (spec.expect_enabled && typeof spec.expect_enabled === 'object') {
    const item = spec.expect_enabled as { role?: string; name?: string };
    if (!item.role || !item.name) throw new Error('expect_enabled cần role và name');
    if (!(await namedLocator(page, item.role, item.name).isEnabled())) throw new Error(`Control chưa enabled: ${item.name}`);
    return;
  }
  if (spec.expect_blank_not === true) {
    const text = (await page.locator('body').innerText({ timeout: 5000 })).trim();
    if (!text) throw new Error('Trang trắng, body không có chữ.');
    return;
  }
  throw new Error(`Assertion chưa hỗ trợ hoặc thiếu Expected: ${JSON.stringify(spec)}`);
}

function caseFiles(projectDir: string, suiteName: string, id: string): string[] {
  const casesDir = path.join(projectDir, 'cases');
  if (id) return [path.join(casesDir, `${id}.yaml`)];
  if (!suiteName) throw new Error('Cần --suite <tên> hoặc --id <ID>.');
  const suiteFile = path.join(projectDir, 'suites', `${suiteName}.yaml`);
  if (!fs.existsSync(suiteFile)) throw new Error(`Không tìm thấy suite: ${suiteFile}`);
  const suite = YAML.parse(fs.readFileSync(suiteFile, 'utf8')) as { cases?: string[]; tags?: string[] };
  if (suite.cases) return suite.cases.map(caseId => path.join(casesDir, `${caseId}.yaml`));
  const desiredTags = suite.tags ?? [suiteName];
  return fs.readdirSync(casesDir).filter(file => file.endsWith('.yaml')).map(file => path.join(casesDir, file)).filter(file => {
    const test = YAML.parse(fs.readFileSync(file, 'utf8')) as TestCase;
    return desiredTags.every(tag => test.tags?.includes(tag));
  });
}

function completedCases(projectDir: string, runId: string): Set<string> {
  const root = path.join(projectDir, 'runs');
  const completed = new Set<string>();
  if (!fs.existsSync(root)) return completed;
  for (const day of fs.readdirSync(root, { withFileTypes: true })) {
    if (!day.isDirectory()) continue;
    const dayDir = path.join(root, day.name);
    for (const module of fs.readdirSync(dayDir, { withFileTypes: true })) {
      if (!module.isDirectory()) continue;
      const file = path.join(dayDir, module.name, 'results.jsonl');
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
        try {
          const record = JSON.parse(line) as { run_id?: string; id?: string };
          if (record.run_id === runId && record.id) completed.add(record.id);
        } catch { /* ignore an incomplete final journal line */ }
      }
    }
  }
  return completed;
}

export function requiredRolesForSuite(projectDir: string, suiteName: string, id: string): string[] {
  return [...new Set(caseFiles(projectDir, suiteName, id)
    .map(file => readCase(file).role)
    .filter((role): role is string => Boolean(role)))];
}

export async function runCases(project: Project, projectDir: string, suiteName: string, id: string, headless: boolean, resume = false): Promise<number> {
  const files = caseFiles(projectDir, suiteName, id);
  if (!files.length) throw new Error(`Suite ${suiteName} không có testcase.`);
  const tests = files.map(file => readCase(file));
  for (const test of tests) {
    if (project.safety === 'read-only' && test.mutates) throw new Error(`BLOCKED ${test.id}: dự án read-only không được ghi dữ liệu.`);
    if (test.mutates && test.data_prefix !== 'auto_') throw new Error(`BLOCKED ${test.id}: testcase thay đổi dữ liệu phải khai báo data_prefix: auto_.`);
    if (project.safety === 'shared-dev' && test.mutates && test.data_prefix !== 'auto_') throw new Error(`BLOCKED ${test.id}: shared-dev chỉ cho phép bản ghi auto_.`);
    if (test.role) {
      const authState = path.join(projectDir, '.auth', `${test.role}.json`);
      if (!fs.existsSync(authState)) throw new Error(`BLOCKED ${test.id}: thiếu phiên đã xác thực cho role ${test.role}. Hãy cấu hình auth adapter; không đoán mật khẩu.`);
    }
  }
  const started = new Date();
  const lease = acquireRunLock(projectDir, suiteName || `id:${id}`, resume);
  const runId = lease.runId;
  const completed = resume ? completedCases(projectDir, runId) : new Set<string>();
  let browser;
  try { browser = await chromium.launch({ headless }); }
  catch (error) { lease.release(); throw error; }
  let failures = 0;
  let blockedCount = 0;
  try {
    for (const test of tests) {
      if (completed.has(test.id)) {
        await upsertCase(project, projectDir, test.id);
        console.log(`RESUME skip ${test.id}: kết quả đã có trong run ${runId}`);
        continue;
      }
      const testStart = Date.now();
      const evidence: string[] = [];
      const messages: string[] = [];
      const roleState = test.role ? path.join(projectDir, '.auth', `${test.role}.json`) : undefined;
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(roleState ? { storageState: roleState } : {}) });
      const page = await context.newPage();
      const blockedHosts: string[] = [];
      let previousRequestAt = 0;
      let rateQueue = Promise.resolve();
      await context.route('**/*', async route => {
        let hostAllowed = false;
        try { assertHostAllowed(route.request().url(), project.allow_hosts); hostAllowed = true; }
        catch { blockedHosts.push(route.request().url()); }
        if (!hostAllowed) { await route.abort('blockedbyclient'); return; }
        if (project.safety === 'shared-dev') {
          const waitTurn = rateQueue.then(async () => {
            const waitMs = Math.max(0, 500 - (Date.now() - previousRequestAt));
            if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
            previousRequestAt = Date.now();
          });
          rateQueue = waitTurn.catch(() => undefined);
          await waitTurn;
        }
        await route.continue();
      });
      page.on('console', msg => { if (msg.type() === 'error') messages.push(`console: ${msg.text()}`); });
      page.on('response', response => { if (response.status() >= 400) messages.push(`HTTP ${response.status()} ${response.url()}`); });
      page.on('requestfailed', request => messages.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
      let status: Result['status'] = 'Pass';
      let actual = 'Tất cả bước và assertion đạt.';
      try {
        for (const step of test.steps ?? []) await oneStep(page, step, project);
        for (const expected of test.expect ?? []) await assertion(page, expected);
        if (blockedHosts.length) throw new Error(`BLOCKED: request tới host ngoài allowlist: ${blockedHosts[0]}`);
        if (messages.length) actual += ` Tín hiệu trình duyệt: ${messages.slice(0, 5).join(' | ')}`;
      } catch (error) {
        actual = error instanceof Error ? error.message : String(error);
        status = actual.startsWith('BLOCKED:') || blockedHosts.length ? 'Blocked' : 'Fail';
        if (status === 'Fail') failures++;
        else blockedCount++;
        const evidenceDir = path.join(projectDir, 'evidence', TODAY);
        fs.mkdirSync(evidenceDir, { recursive: true });
        const filename = `${test.id}_fail.png`;
        const target = path.join(evidenceDir, filename);
        try {
          await page.locator('body').evaluate(element => (element as HTMLElement).style.outline = '3px solid red');
          const locator = page.getByText(String((test.expect ?? []).at(-1) ?? ''), { exact: false }).first();
          if (await locator.count()) await locator.evaluate(element => (element as HTMLElement).style.outline = '3px solid red');
        } catch { /* keep whole-page evidence even if target is gone */ }
        await page.screenshot({ path: target, fullPage: true }).catch(() => undefined);
        if (fs.existsSync(target)) evidence.push(path.relative(projectDir, target).split(path.sep).join('/'));
      }
      if (status === 'Fail' && !evidence.length) {
        status = 'Blocked';
        actual += ' Không chụp được evidence, không phân loại là bug.';
      }
      const record = { run_id: runId, id: test.id, module: test.module ?? 'General', status, actual, type: test.type ?? 'Auto', priority: test.priority ?? 'P3', severity: test.severity ?? 'Medium', evidence, duration_ms: Date.now() - testStart, commit: process.env.QA_COMMIT ?? 'Chưa xác minh', ...(test.role ? { role: test.role } : {}) };
      await recordResult(project, projectDir, record);
      await upsertCase(project, projectDir, test.id);
      console.log(`${status} ${test.id}: ${test.title}`);
      await context.close();
    }
  } finally { try { await browser.close(); } finally { lease.release(); } }
  appendJsonl(path.join(projectDir, 'runs', TODAY, 'run_summary.jsonl'), { run_id: runId, project: project.name, suite: suiteName || id, started_at: started.toISOString(), ended_at: new Date().toISOString(), total: tests.length, failed: failures, blocked: blockedCount, resumed: resume });
  return failures ? 1 : blockedCount ? 2 : 0;
}

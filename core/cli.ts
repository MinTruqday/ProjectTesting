#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import YAML from 'yaml';
import { appendJsonl, PROJECTS, ROOT, readProject, projectName, readJsonl, TODAY } from './project.js';
import { assertHostAllowed, blockedRecord, checkHealth, missingEnv } from './gates.js';
import { dailyReport, recordResult, upsertCase } from './workbook.js';
import { runCases } from './runner.js';
import { createDashboard } from './dashboard.js';
import { pathToFileURL } from 'node:url';
import { redactSecrets } from './secrets.js';
import { cleanProjectStorage, expiredStorageObjects } from './storage-clean.js';
import { acquireRunLock } from './run-lock.js';
import type { Project, Result } from './types.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const values = (flag: string): string[] => {
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) found.push(args[++i]);
  return found;
};
const value = (flag: string, fallback = '') => values(flag)[0] ?? fallback;

function help(): void {
  console.log(`QA Station — reusable project QA toolkit

Usage: qa <command> [options]

  doctor                         Check local toolchain and disk
  selftest                       Verify deterministic safety/export foundations
  accept                         Show runnable acceptance checks
  init <name> --url <url>        Create a read-only project profile
  env --project <name>           Check required env keys; never prints values
  ready --project <name>         Check only allowlisted health URLs
  status --project <name>        Show latest run, blocked gates, queue count
  record --project <name> ...    Append one result to JSONL
  upsert --project <name> --id <ID>  Upsert testcase workbook row
  daily_report --project <name>  Export report and dated workbook snapshot
  run --project <name> --suite smoke [--resume]  Execute or resume YAML suite
  dash --project <name>         Export static dashboard from SQLite
  storage-clean --project <name> [--apply]  Retain only aged objects in isolated local QA prefix

Common record flags: --id ID --status Pass|Fail|Blocked|\"Chưa chạy\"
  --module NAME --actual TEXT --type Auto|Manual --priority P1..P4
  --severity Low|Medium|High|Critical --commit HASH --bug-id BUG-NNN
  --evidence projects/<name>/evidence/YYYY-MM-DD/file.png (repeatable)

Project selection: --project <name> or QA_PROJECT=<name>.
Read docs/ROADMAP.md for implementation status and pending commands.`);
}

function runVersion(program: string, flag: string): string {
  const result = spawnSync(program, [flag], { encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : 'not available';
}

function doctor(): boolean {
  let failed = false;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    if (!ok) failed = true;
  };
  const major = Number(process.versions.node.split('.')[0]);
  check('Node.js', major >= 20, process.version);
  check('Python', runVersion('python3', '--version') !== 'not available', runVersion('python3', '--version'));
  check('Docker', runVersion('docker', '--version') !== 'not available', runVersion('docker', '--version'));
  const browserPath = chromium.executablePath();
  check('Playwright Chromium', fs.existsSync(browserPath), fs.existsSync(browserPath) ? browserPath : `chưa cài browser tại ${browserPath}`);
  const stat = fs.statfsSync(PROJECTS);
  const freeGb = stat.bavail * stat.bsize / 1024 ** 3;
  check('Disk', freeGb >= 5, `${freeGb.toFixed(1)} GB còn trống`);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hoChiMinhOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', timeZoneName: 'longOffset' }).format(new Date());
  check('Timezone', ['Asia/Ho_Chi_Minh', 'Asia/Saigon'].includes(timezone) || hoChiMinhOffset.includes('GMT+07:00'), `${timezone} (local timezone alias OK when UTC+07:00)`);
  check('Project write access', fs.accessSync(PROJECTS, fs.constants.W_OK) === undefined, PROJECTS);
  return !failed;
}

function initProject(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(name)) throw new Error(`Tên dự án không hợp lệ: ${name}`);
  const urlText = value('--url', 'http://localhost:3000');
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL dự án chỉ hỗ trợ HTTP hoặc HTTPS.');
  const dir = path.join(PROJECTS, name);
  if (fs.existsSync(path.join(dir, 'project.yaml'))) throw new Error(`Hồ sơ đã tồn tại: ${dir}`);
  const source = YAML.parse(fs.readFileSync(path.join(PROJECTS, 'template/project.yaml'), 'utf8')) as Project;
  const config: Project = { ...source, name, description: `Project profile for ${name}`, base_url: urlText, allow_hosts: [url.hostname], health: [`${url.origin}/`], roles: {} };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'), YAML.stringify(config));
  fs.writeFileSync(path.join(dir, 'rules.yaml'), 'requirements: []\n');
  fs.writeFileSync(path.join(dir, 'thresholds.yaml'), 'thresholds: []\n');
  for (const folder of ['cases', 'data', 'pages', 'selectors', 'evidence', 'runs', 'reports', 'plans', 'suites']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.copyFileSync(path.join(PROJECTS, 'template/cases/WEB-HEALTH-001.yaml'), path.join(dir, 'cases/WEB-HEALTH-001.yaml'));
  fs.copyFileSync(path.join(PROJECTS, 'template/suites/smoke.yaml'), path.join(dir, 'suites/smoke.yaml'));
  fs.copyFileSync(path.join(PROJECTS, 'template/storage.yaml'), path.join(dir, 'storage.yaml'));
  fs.writeFileSync(path.join(dir, '.env.app.example'), '# Add secret values to .env.app; this example is safe to commit.\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env.app\n.auth/\nruns/\nreports/*.xlsx\nqa.db*\ndata/created.json\n');
  console.log(`Đã tạo ${dir} với safety=read-only. Tạo .env.app và khai báo required_env trước khi chạy env.`);
}

async function runSelftest(): Promise<boolean> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-station-selftest-'));
  const projectDir = path.join(tmp, 'sample');
  try {
    fs.mkdirSync(path.join(projectDir, 'cases'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'cases/SELFTEST-001.yaml'), `id: SELFTEST-001\ntitle: Sample health check\nmodule: Core\npriority: P1\nseverity: High\ntype: Auto\nsteps:\n  - open: http://localhost/\nexpect:\n  - status: 200\n`);
    const config: Project = { name: 'sample', safety: 'read-only', base_url: 'http://localhost/', allow_hosts: ['localhost'], health: ['/'], env_file: '.env.app', required_env: [] };
    const missingFileBlocked = missingEnv(config, projectDir).missing.some(key => key.includes('.env file missing'));
    config.required_env = ['SELFTEST_KEY', 'SELFTEST_MISSING'];
    fs.writeFileSync(path.join(projectDir, '.env.app'), 'SELFTEST_KEY=fixture-secret-value\n');
    const missingKeyNames = missingEnv(config, projectDir).missing;
    config.required_env = [];
    const envGateOk = missingFileBlocked && missingKeyNames.length === 1 && missingKeyNames[0] === 'SELFTEST_MISSING';
    console.log(`${envGateOk ? 'PASS' : 'FAIL'} missing env file/key gate reports names only`);
    appendJsonl(path.join(projectDir, 'runs', TODAY, 'Core', 'results.jsonl'), { id: 'SELFTEST-001', date: TODAY, project: 'sample', module: 'Core', status: 'Pass', actual: 'HTTP 200', type: 'Auto', priority: 'P1', severity: 'High' });
    await upsertCase(config, projectDir, 'SELFTEST-001');
    fs.writeFileSync(path.join(projectDir, 'cases/SELFTEST-BROWSER-001.yaml'), `id: SELFTEST-BROWSER-001\ntitle: Local synthetic page has content\nmodule: Core\npriority: P1\nseverity: High\ntype: Auto\nsteps:\n  - open: /\nexpect:\n  - expect_text: QA Station synthetic fixture\n  - expect_blank_not: true\n`);
    fs.mkdirSync(path.join(projectDir, 'suites'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'suites/smoke.yaml'), 'cases:\n  - SELFTEST-BROWSER-001\n');
    const lockDir = path.join(tmp, 'lock-test');
    fs.mkdirSync(lockDir, { recursive: true });
    const firstLease = acquireRunLock(lockDir, 'smoke');
    const childLockProbe = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { acquireRunLock } from './core/run-lock.ts'; try { acquireRunLock(${JSON.stringify(lockDir)}, 'smoke'); process.exit(1); } catch (error) { process.exit(String(error).includes('BLOCKED') ? 0 : 2); }`], { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
    const concurrentBlocked = childLockProbe.status === 0;
    firstLease.release();
    fs.writeFileSync(path.join(lockDir, '.qa.lock'), JSON.stringify({ pid: 2_000_000_000, run_id: 'selftest-resume', suite: 'smoke', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }) + '\n');
    const resumeLease = acquireRunLock(lockDir, 'smoke', true);
    const lockResumeOk = concurrentBlocked && resumeLease.runId === 'selftest-resume';
    resumeLease.release();
    console.log(`${lockResumeOk ? 'PASS' : 'FAIL'} cross-process project lock and interrupted-run lock recovery`);
    let resumeOk = false;
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<main><h1>QA Station synthetic fixture</h1></main>'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Không lấy được cổng fixture');
      config.base_url = `http://127.0.0.1:${address.port}`;
      config.allow_hosts = ['127.0.0.1'];
      config.health = ['/'];
      const browserResult = await runCases(config, projectDir, 'smoke', '', true);
      if (browserResult !== 0) throw new Error('Synthetic Playwright smoke không đạt');
      const resultFile = path.join(projectDir, 'runs', TODAY, 'Core', 'results.jsonl');
      const firstRunRecord = fs.readFileSync(resultFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { id: string; run_id: string }).find(item => item.id === 'SELFTEST-BROWSER-001');
      if (!firstRunRecord) throw new Error('Không tìm thấy kết quả synthetic để thử resume');
      fs.writeFileSync(path.join(projectDir, 'cases/SELFTEST-BROWSER-002.yaml'), `id: SELFTEST-BROWSER-002\ntitle: Resumed synthetic browser check\nmodule: Core\npriority: P1\nseverity: High\ntype: Auto\nsteps:\n  - open: /\nexpect:\n  - expect_text: QA Station synthetic fixture\n`);
      fs.writeFileSync(path.join(projectDir, 'suites/smoke.yaml'), 'cases:\n  - SELFTEST-BROWSER-001\n  - SELFTEST-BROWSER-002\n');
      fs.writeFileSync(path.join(projectDir, '.qa.lock'), JSON.stringify({ pid: 2_000_000_000, run_id: firstRunRecord.run_id, suite: 'smoke', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }) + '\n');
      const resumedResult = await runCases(config, projectDir, 'smoke', '', true, true);
      const runRecords = fs.readFileSync(resultFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { id: string; run_id: string });
      const sameRunRecords = runRecords.filter(item => item.run_id === firstRunRecord.run_id);
      resumeOk = resumedResult === 0 && sameRunRecords.filter(item => item.id === 'SELFTEST-BROWSER-001').length === 1 && sameRunRecords.filter(item => item.id === 'SELFTEST-BROWSER-002').length === 1;
      console.log(`${resumeOk ? 'PASS' : 'FAIL'} --resume skips recorded case and runs remaining case`);
    } finally { server.close(); }
    fs.writeFileSync(path.join(projectDir, 'cases/SELFTEST-FAIL-001.yaml'), `id: SELFTEST-FAIL-001\ntitle: Synthetic confirmed defect\nmodule: Core\npriority: P1\nseverity: Critical\ntype: Auto\nsteps:\n  - open: http://localhost/\nexpect:\n  - status: 204\n`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
    fs.mkdirSync(path.join(projectDir, 'evidence', TODAY), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'evidence', TODAY, 'SELFTEST-FAIL-001.png'), png);
    for (let run = 0; run < 2; run++) appendJsonl(path.join(projectDir, 'runs', TODAY, 'Core', 'results.jsonl'), { id: 'SELFTEST-FAIL-001', date: TODAY, project: 'sample', module: 'Core', status: 'Fail', actual: `Synthetic mismatch attempt ${run + 1}`, type: 'Auto', priority: 'P1', severity: 'Critical', evidence: [`evidence/${TODAY}/SELFTEST-FAIL-001.png`] });
    await upsertCase(config, projectDir, 'SELFTEST-FAIL-001');
    fs.writeFileSync(path.join(projectDir, 'cases/SELFTEST-BANNED-001.yaml'), `id: SELFTEST-BANNED-001\ntitle: Đáng chú ý, banned phrase fixture\nmodule: Core\npriority: P3\nseverity: Low\ntype: Manual\nsteps: []\nexpect: []\n`);
    let bannedBlocked = false;
    try { await upsertCase(config, projectDir, 'SELFTEST-BANNED-001'); } catch (error) { bannedBlocked = String(error).includes('Đáng chú ý'); }
    await dailyReport(config, projectDir, 'Selftest ran on synthetic fixture.');
    const dashboardFile = createDashboard(config, projectDir);
    const dashBrowser = await chromium.launch({ headless: true });
    let dashboardOk = false;
    try {
      const dashPage = await dashBrowser.newPage();
      await dashPage.goto(pathToFileURL(dashboardFile).toString());
      await dashPage.locator('#rows tr').first().waitFor({ state: 'visible' });
      dashboardOk = (await dashPage.locator('#rows').innerText()).includes('SELFTEST-BROWSER-001') && (await dashPage.locator('#cards .card').count()) >= 5;
    } finally { await dashBrowser.close(); }
    const workbookFile = path.join(projectDir, 'reports/testcases_master.xlsx');
    const snapshotFile = path.join(projectDir, 'reports', `testcases_${TODAY}.xlsx`);
    const sqliteHeader = fs.existsSync(path.join(projectDir, 'qa.db')) && fs.readFileSync(path.join(projectDir, 'qa.db')).subarray(0, 15).toString('utf8') === 'SQLite format 3';
    let workbookOk = false;
    if (fs.existsSync(workbookFile) && fs.existsSync(snapshotFile) && fs.existsSync(path.join(projectDir, 'reports', `bao_cao_${TODAY}.md`))) {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(workbookFile);
      const cases = book.getWorksheet('Testcases')!;
      const failRowNumber = cases.getColumn(1).values.findIndex(item => item === 'SELFTEST-FAIL-001');
      const failRow = cases.getRow(failRowNumber);
      const tags = String(failRow.getCell(10).value ?? '').split(', ').filter(Boolean);
      const link = failRow.getCell(15).value as { formula?: string };
      const history = book.getWorksheet('Lịch sử chạy')!;
      const report = book.getWorksheet('Báo cáo ngày')!;
      const todayRows = report.getRows(2, Math.max(report.rowCount - 1, 0))?.filter(row => row.getCell(1).value === TODAY) ?? [];
      const formulas = [5, 6, 7, 8, 9, 10, 11].every(cell => {
        const candidate = todayRows[0]?.getCell(cell).value;
        return typeof candidate === 'object' && candidate !== null && 'formula' in candidate && String(candidate.formula).includes('COUNTIFS');
      });
      const linkTarget = link?.formula?.match(/^HYPERLINK\("(.*)","Xem ảnh"\)$/)?.[1]?.replace(/""/g, '"');
      workbookOk = dashboardOk && sqliteHeader && bannedBlocked && failRowNumber > 0 && tags.length === 2 && tags[0] === 'Bug' && tags[1] === 'High' && Boolean(linkTarget) && fs.existsSync(path.join(projectDir, linkTarget!)) && history.rowCount >= 4 && todayRows.length === 1 && formulas;
      if (!workbookOk) console.log(`Workbook check details: row=${failRowNumber}, tags=${JSON.stringify(tags)}, evidenceFormula=${JSON.stringify(link)}, historyRows=${history.rowCount}, dailyRows=${todayRows.length}, formulas=${formulas}`);
    }
    console.log(`${workbookOk ? 'PASS' : 'FAIL'} Playwright local smoke, JSONL → Excel, two-value Tags, evidence link, COUNTIFS and one daily row`);
    const hostAllowed = (() => { try { assertHostAllowed('http://localhost:3000', ['localhost']); return true; } catch { return false; } })();
    const externalBlocked = (() => { try { assertHostAllowed('https://example.invalid', ['localhost']); return false; } catch { return true; } })();
    console.log(`${hostAllowed && externalBlocked ? 'PASS' : 'FAIL'} allowlist boundary`);
    const redaction = redactSecrets('Authorization: Bearer bearerSecret token=tokenSecret password=passwordSecret');
    console.log(`${!redaction.includes('bearerSecret') && !redaction.includes('tokenSecret') && !redaction.includes('passwordSecret') ? 'PASS' : 'FAIL'} secret redaction`);
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const storageSafe = expiredStorageObjects([{ Key: 'qa_temp/sample/old.png', LastModified: new Date(cutoff.getTime() - 60 * 60 * 1000) }, { Key: 'qa_temp/sample/recent.png', LastModified: new Date(Date.now() - 60 * 60 * 1000) }, { Key: 'app-assets/keep.png', LastModified: new Date(cutoff.getTime() - 48 * 60 * 60 * 1000) }], 'qa_temp/sample/', cutoff).map(item => item.Key);
    console.log(`${storageSafe.length === 1 && storageSafe[0] === 'qa_temp/sample/old.png' ? 'PASS' : 'FAIL'} TTL cleanup keeps recent objects and non-QA prefixes`);
    const configFile = path.join(tmp, '.env.app');
    fs.writeFileSync(configFile, 'PASSWORD=do-not-print\n');
    const output = `${fs.readFileSync(configFile, 'utf8').includes('do-not-print') ? 'secret fixture present' : ''}`;
    console.log(`${!output.includes('do-not-print') ? 'PASS' : 'FAIL'} selftest output does not expose secret fixture`);
    return workbookOk && envGateOk && hostAllowed && externalBlocked && storageSafe.length === 1 && lockResumeOk && resumeOk && !redaction.includes('Secret') && !output.includes('do-not-print');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function run(): Promise<number> {
  if (command === 'help' || command === '--help' || command === '-h') { help(); return 0; }
  if (command === 'doctor') return doctor() ? 0 : 1;
  if (command === 'selftest') return await runSelftest() ? 0 : 1;
  if (command === 'accept') {
    const checks = [
      ['doctor', doctor()],
      ['foundation selftest', await runSelftest()],
      ['default profile safety', (YAML.parse(fs.readFileSync(path.join(PROJECTS, 'template/project.yaml'), 'utf8')) as Project).safety === 'read-only'],
    ];
    console.log('\nAcceptance snapshot:');
    for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    console.log('PENDING all 22 project-level acceptance checks; see docs/ROADMAP.md.');
    return checks.every(([, ok]) => ok) ? 0 : 1;
  }
  if (command === 'init') { const name = args[1]; if (!name || name.startsWith('--')) throw new Error('Cú pháp: qa init <name> --url <url>'); initProject(name); return 0; }
  const name = projectName(args);
  const { config, dir } = readProject(name);
  if (command === 'env') {
    const check = missingEnv(config, dir);
    if (check.missing.length) {
      const msg = `Thiếu tệp hoặc khóa môi trường: ${check.missing.join(', ') || path.relative(dir, check.file)}`;
      const file = blockedRecord(dir, msg);
      console.error(`BLOCKED: ${msg}\nĐã ghi ${path.basename(file)}. Giá trị secret không được hiển thị.`);
      return 2;
    }
    console.log(`PASS env: đủ ${config.required_env.length + Object.keys(config.roles ?? {}).length * 2} khóa bắt buộc; không in giá trị.`);
    return 0;
  }
  if (command === 'ready') {
    const endpoints = config.health.map(endpoint => endpoint.startsWith('http') ? endpoint : new URL(endpoint, config.base_url).toString());
    if (!endpoints.length) { const msg = 'Chưa khai báo health endpoint.'; blockedRecord(dir, msg); console.error(`BLOCKED: ${msg}`); return 2; }
    let ok = true;
    for (const endpoint of endpoints) {
      const result = await checkHealth(endpoint, config.allow_hosts);
      console.log(`${result.ok ? 'PASS' : 'BLOCKED'} ${endpoint} ${result.status ?? result.error ?? ''}`);
      ok &&= result.ok;
    }
    if (!ok) { blockedRecord(dir, 'Health gate không đạt. Không chạy testcase phụ thuộc ứng dụng.'); return 2; }
    return 0;
  }
  if (command === 'status') {
    const records = fs.existsSync(path.join(dir, 'runs')) ? fs.readdirSync(path.join(dir, 'runs')).flatMap(date => {
      const folder = path.join(dir, 'runs', date);
      return fs.statSync(folder).isDirectory() ? fs.readdirSync(folder).flatMap(module => readJsonl<Result>(path.join(folder, module, 'results.jsonl'))) : [];
    }) : [];
    const blocked = fs.readdirSync(dir).filter(file => file.startsWith('BLOCKED_'));
    console.log(`Project: ${name}\nSafety: ${config.safety}\nKết quả đã ghi: ${records.length}\nLần gần nhất: ${records.at(-1)?.date ?? 'Chưa chạy'}\nCổng BLOCKED: ${blocked.length ? blocked.join(', ') : 'không có'}`);
    return 0;
  }
  if (command === 'run') {
    const env = missingEnv(config, dir);
    if (env.missing.length) {
      const msg = `Thiếu tệp/khóa môi trường: ${env.missing.join(', ')}`;
      blockedRecord(dir, msg); console.error(`BLOCKED: ${msg}`); return 2;
    }
    const endpoints = config.health.map(endpoint => endpoint.startsWith('http') ? endpoint : new URL(endpoint, config.base_url).toString());
    if (!endpoints.length) { const msg = 'Chưa khai báo health endpoint.'; blockedRecord(dir, msg); console.error(`BLOCKED: ${msg}`); return 2; }
    for (const endpoint of endpoints) {
      const result = await checkHealth(endpoint, config.allow_hosts);
      if (!result.ok) { const msg = `Health gate thất bại: ${endpoint} ${result.status ?? result.error ?? ''}`; blockedRecord(dir, msg); console.error(`BLOCKED: ${msg}`); return 2; }
    }
    return await runCases(config, dir, value('--suite'), value('--id'), args.includes('--headless'), args.includes('--resume'));
  }
  if (command === 'record') {
    const status = value('--status') as Result['status'];
    if (!['Pass', 'Fail', 'Blocked', 'Chưa chạy'].includes(status)) throw new Error('status phải là Pass, Fail, Blocked hoặc Chưa chạy');
    await recordResult(config, dir, { id: value('--id'), status, module: value('--module', 'General'), actual: value('--actual'), type: value('--type', 'Auto') as Result['type'], priority: value('--priority', 'P3'), severity: value('--severity', 'Medium'), commit: value('--commit'), bug_id: value('--bug-id'), evidence: values('--evidence') });
    return 0;
  }
  if (command === 'upsert') { await upsertCase(config, dir, value('--id')); return 0; }
  if (command === 'daily_report') { await dailyReport(config, dir, value('--note', 'Chưa có ghi chú công việc.')); return 0; }
  if (command === 'dash') { console.log(`Dashboard: ${path.relative(dir, createDashboard(config, dir))}`); return 0; }
  if (command === 'storage-clean') { await cleanProjectStorage(config, dir, args.includes('--apply')); return 0; }
  throw new Error(`Lệnh chưa được triển khai: ${command}. Dùng qa help.`);
}

run().then(code => process.exit(code)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

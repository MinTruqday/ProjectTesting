import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import YAML from 'yaml';
import { appendJsonl, readJsonl, safeResolve, TODAY } from './project.js';
import { redactSecrets } from './secrets.js';
import { loadResults, persistCase, persistResult } from './store.js';
import type { Project, Result, TestCase } from './types.js';

const HEADERS = ['ID', 'Title', 'Module', 'Role', 'Description', 'Step', 'Expected', 'Actual', 'Kết quả', 'Tags', 'Priority', 'Severity', 'Kỹ thuật', 'Type', 'Evidence 1', 'Evidence 2', 'Evidence 3', 'Commit', 'Bug ID'];
const HISTORY_HEADERS = ['Ngày', 'ID', 'Project', 'Module', 'Kết quả', 'Type', 'Priority', 'Severity', 'Actual', 'Commit', 'Bug ID', 'Evidence', 'Execution ID'];
const DAILY_HEADERS = ['Ngày', 'Commit (trước → sau)', 'Module đã làm', 'Việc đã làm', 'Đã chạy', 'Pass', 'Fail', 'Blocked', 'Chưa chạy', 'Auto', 'Manual', 'Bug mới', 'Bug đổi trạng thái', 'Bug còn mở', 'Hồi quy', 'Vướng', 'Ngày mai làm gì'];

function yamlCase(file: string): TestCase {
  const data = YAML.parse(fs.readFileSync(file, 'utf8')) as TestCase;
  if (!data?.id || !data.title) throw new Error(`Testcase thiếu id/title: ${file}`);
  return data;
}

function caseTags(test: TestCase, result?: Result, confirmedBug = false): string[] {
  const priority = test.priority ?? result?.priority ?? 'P3';
  const status = result?.status ?? 'Chưa chạy';
  const failedTwice = status === 'Fail' && confirmedBug;
  const kind = failedTwice ? 'Bug' : 'Task';
  let level = failedTwice
    ? (['Critical', 'High'].includes(test.severity ?? result?.severity ?? '') ? 'High' : ['Medium'].includes(test.severity ?? result?.severity ?? '') ? 'Medium' : 'Low')
    : (priority === 'P1' ? 'High' : priority === 'P2' ? 'Medium' : 'Low');
  const tags = [kind, level];
  if ((test as TestCase & { needs_ba_confirmation?: boolean }).needs_ba_confirmation) tags.push('Cần BA xác nhận');
  return tags;
}

function latestResults(project: Project, projectDir: string): Result[] { return loadResults(project, projectDir); }

function executionKey(record: Result): string {
  return record.execution_id ?? `${record.date}|${record.id}|${record.status}|${record.actual ?? ''}|${record.commit ?? ''}`;
}

function addHistoryRecord(history: ExcelJS.Worksheet, project: Project, record: Result): void {
  const key = executionKey(record);
  const rows = history.getRows(2, Math.max(0, history.rowCount - 1)) ?? [];
  const draft = rows.find(row => row.getCell(13).value === `draft:${record.date}:${record.id}`);
  const values = [record.date, record.id, project.name, record.module, record.status, record.type, record.priority, record.severity, redactSecrets(record.actual ?? ''), record.commit ?? '', record.bug_id ?? '', record.evidence?.[0] ?? '', key];
  if (draft) { draft.values = values; return; }
  if (history.getColumn(13).values.slice(2).includes(key)) return;
  const fallback = `${record.date}|${record.id}|${record.status}|${record.actual ?? ''}|${record.commit ?? ''}`;
  const duplicateLegacy = !record.execution_id && rows.some(row => `${row.getCell(1).value}|${row.getCell(2).value}|${row.getCell(5).value}|${row.getCell(9).value ?? ''}|${row.getCell(10).value ?? ''}` === fallback);
  if (!duplicateLegacy) history.addRow(values);
}

function addDraftRecord(history: ExcelJS.Worksheet, project: Project, test: TestCase, date = TODAY): void {
  const key = `draft:${date}:${test.id}`;
  if (history.getColumn(13).values.slice(2).includes(key)) return;
  history.addRow([date, test.id, project.name, test.module ?? '', 'Chưa chạy', test.type ?? 'Auto', test.priority ?? 'P3', test.severity ?? 'Medium', '', '', '', '', key]);
}

function scanBanned(values: unknown[]): void {
  const bannedFile = path.resolve(import.meta.dirname, '../config/banned_phrases.txt');
  if (!fs.existsSync(bannedFile)) return;
  const banned = fs.readFileSync(bannedFile, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const found = banned.find(phrase => value.toLocaleLowerCase('vi').includes(phrase.toLocaleLowerCase('vi')));
    if (found) throw new Error(`Văn bản bị chặn do cụm "${found}": ${value}`);
  }
}

function evidenceLinks(projectDir: string, evidence?: string[]): Array<ExcelJS.CellValue> {
  const out: Array<ExcelJS.CellValue> = [];
  for (const item of (evidence ?? []).slice(0, 3)) {
    const full = safeResolve(projectDir, item);
    if (!fs.existsSync(full)) throw new Error(`Evidence không tồn tại: ${item}`);
    const rel = path.relative(projectDir, full).split(path.sep).join('/');
    const escaped = rel.replace(/"/g, '""');
    out.push({ formula: `HYPERLINK("${escaped}","Xem ảnh")` });
  }
  while (out.length < 3) out.push('');
  return out;
}

function ensureSheet(workbook: ExcelJS.Workbook, name: string, headers: string[]): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name) ?? workbook.addWorksheet(name);
  if (sheet.rowCount === 0) {
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF234E70' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + headers.length)}1` };
  }
  return sheet;
}

async function openBook(file: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(file)) await workbook.xlsx.readFile(file);
  ensureSheet(workbook, 'Testcases', HEADERS);
  ensureSheet(workbook, 'Lịch sử chạy', HISTORY_HEADERS);
  ensureSheet(workbook, 'Báo cáo ngày', DAILY_HEADERS);
  return workbook;
}

async function atomicSave(workbook: ExcelJS.Workbook, file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp.xlsx`;
  await workbook.xlsx.writeFile(tmp);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (error) {
      if (attempt === 3) {
        try { fs.unlinkSync(tmp); } catch { /* cleanup best effort */ }
        throw new Error(`Không ghi được Excel sau 3 lần thử. Đóng workbook đang mở rồi chạy lại. ${String(error)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

export async function upsertCase(project: Project, projectDir: string, id: string): Promise<void> {
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/i.test(id)) throw new Error(`ID testcase không hợp lệ: ${id}`);
  const testFile = path.join(projectDir, 'cases', `${id}.yaml`);
  if (!fs.existsSync(testFile)) throw new Error(`Không có testcase YAML: ${testFile}`);
  const test = yamlCase(testFile);
  if (test.id !== id) throw new Error(`ID trong YAML (${test.id}) không khớp --id ${id}`);
  persistCase(project, projectDir, test, fs.readFileSync(testFile, 'utf8'));
  const records = latestResults(project, projectDir).filter(result => result.id === id).sort((a, b) => `${a.date}`.localeCompare(`${b.date}`));
  const result = records.at(-1);
  const failTail = records.slice(-2).length === 2 && records.slice(-2).every(item => item.status === 'Fail');
  const taggedResult = result;
  const stepText = (test.steps ?? []).map((step, index) => `${index + 1}. ${JSON.stringify(step)}`).join('\n');
  const expectedText = (test.expect ?? []).map(item => JSON.stringify(item)).join('\n');
  const values = [test.title, test.description ?? '', stepText, expectedText, result?.actual ?? ''];
  scanBanned(values);
  if (taggedResult?.status === 'Fail' && !(result?.evidence?.length)) throw new Error(`Fail ${id} bắt buộc có evidence trước khi xuất Excel.`);

  const file = path.join(projectDir, 'reports', 'testcases_master.xlsx');
  const workbook = await openBook(file);
  const sheet = workbook.getWorksheet('Testcases')!;
  const existing = sheet.getColumn(1).values.findIndex(value => value === id);
  const rowIndex = existing > 0 ? existing : sheet.rowCount + 1;
  const row = sheet.getRow(rowIndex);
  row.values = [id, test.title, test.module ?? result?.module ?? '', test.role ?? result?.role ?? '', test.description ?? '', stepText, expectedText, redactSecrets(result?.actual ?? ''), result?.status ?? 'Chưa chạy', caseTags(test, taggedResult, failTail).join(', '), test.priority ?? result?.priority ?? 'P3', test.severity ?? result?.severity ?? 'Medium', test.technique ?? '', test.type ?? result?.type ?? 'Auto', ...evidenceLinks(projectDir, result?.evidence), result?.commit ?? '', result?.bug_id ?? ''];
  row.commit();
  const history = workbook.getWorksheet('Lịch sử chạy')!;
  if (result) addHistoryRecord(history, project, result);
  else if (!records.length) addDraftRecord(history, project, test);
  for (const row of history.getRows(2, Math.max(0, history.rowCount - 1)) ?? []) row.numFmt = 'General';
  try {
    await atomicSave(workbook, file);
    const pendingFile = path.join(projectDir, 'testcases_pending.jsonl');
    if (fs.existsSync(pendingFile)) {
      const pending = readJsonl<{ id: string; queued_at: string }>(pendingFile).filter(item => item.id !== id);
      fs.writeFileSync(pendingFile, pending.map(item => JSON.stringify(item)).join('\n') + (pending.length ? '\n' : ''), { mode: 0o600 });
    }
  } catch (error) {
    const pendingFile = path.join(projectDir, 'testcases_pending.jsonl');
    const pending = readJsonl<{ id: string }>(pendingFile);
    if (!pending.some(item => item.id === id)) appendJsonl(pendingFile, { id, queued_at: new Date().toISOString() });
    console.error(`Excel đang bị khóa/không ghi được; đã xếp ${id} vào testcases_pending.jsonl để đồng bộ lần sau.`);
    throw error;
  }
  console.log(`Excel upsert: ${id} → ${path.relative(projectDir, file)}`);
}

export async function recordResult(project: Project, projectDir: string, record: Omit<Result, 'date' | 'project'> & { date?: string }): Promise<void> {
  const testFile = path.join(projectDir, 'cases', `${record.id}.yaml`);
  if (!fs.existsSync(testFile)) throw new Error(`Không có testcase YAML: ${testFile}`);
  if (record.status === 'Fail' && !(record.evidence?.length)) throw new Error(`Fail ${record.id} chưa có evidence. Không ghi nhận lỗi thiếu bằng chứng.`);
  for (const evidence of record.evidence ?? []) {
    if (!fs.existsSync(safeResolve(projectDir, evidence))) throw new Error(`Evidence không tồn tại: ${evidence}`);
  }
  const date = record.date ?? TODAY;
  const result: Result = { ...record, actual: record.actual ? redactSecrets(record.actual) : record.actual, execution_id: record.execution_id ?? randomUUID(), run_id: record.run_id ?? randomUUID(), date, project: project.name, module: record.module || 'Chưa phân loại' };
  const file = path.join(projectDir, 'runs', date, result.module.replace(/[^a-z0-9_-]/gi, '_'), 'results.jsonl');
  appendJsonl(file, result);
  persistResult(project, projectDir, result);
  console.log(`Đã ghi results.jsonl: ${result.id} ${result.status}`);
}

export async function dailyReport(project: Project, projectDir: string, note = 'Chưa có ghi chú công việc.'): Promise<void> {
  scanBanned([note]);
  const results = latestResults(project, projectDir);
  const file = path.join(projectDir, 'reports', 'testcases_master.xlsx');
  const workbook = await openBook(file);
  const history = workbook.getWorksheet('Lịch sử chạy')!;
  const current = results.filter(r => r.date === TODAY);
  const executedIds = new Set(results.map(r => r.id));
  for (const rec of current) addHistoryRecord(history, project, rec);
  const casesDir = path.join(projectDir, 'cases');
  if (fs.existsSync(casesDir)) for (const caseFile of fs.readdirSync(casesDir).filter(fileName => fileName.endsWith('.yaml'))) {
    const test = yamlCase(path.join(casesDir, caseFile));
    if (!executedIds.has(test.id) && test.status !== 'Obsolete') addDraftRecord(history, project, test);
  }
  const daily = workbook.getWorksheet('Báo cáo ngày')!;
  const row = daily.getRows(2, Math.max(0, daily.rowCount - 1))?.find(r => r.getCell(1).value === TODAY);
  const target = row ?? daily.addRow([]);
  const n = Math.max(history.rowCount, 2);
  target.getCell(1).value = TODAY;
  target.getCell(2).value = project.branch ?? 'Chưa xác minh';
  target.getCell(3).value = [...new Set(current.map(r => r.module))].join(', ') || 'Chưa chạy';
  target.getCell(4).value = note;
  target.getCell(5).value = { formula: `COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$E$2:$E$${n},"Pass")+COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$E$2:$E$${n},"Fail")+COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$E$2:$E$${n},"Blocked")` };
  for (const [cell, status] of [[6, 'Pass'], [7, 'Fail'], [8, 'Blocked'], [9, 'Chưa chạy']] as const) target.getCell(cell).value = { formula: `COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$E$2:$E$${n},"${status}")` };
  target.getCell(10).value = { formula: `COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$F$2:$F$${n},"Auto")` };
  target.getCell(11).value = { formula: `COUNTIFS('Lịch sử chạy'!$A$2:$A$${n},$A${target.number},'Lịch sử chạy'!$F$2:$F$${n},"Manual")` };
  target.getCell(12).value = 0; target.getCell(13).value = 0; target.getCell(14).value = 0; target.getCell(15).value = 0;
  target.getCell(16).value = current.length ? '' : 'Chưa có kết quả chạy trong ngày.';
  target.getCell(17).value = 'Theo dõi hàng đợi testcase.';
  scanBanned([note, String(target.getCell(4).value ?? ''), String(target.getCell(16).value ?? ''), String(target.getCell(17).value ?? '')]);
  await atomicSave(workbook, file);
  const snapshot = path.join(projectDir, 'reports', `testcases_${TODAY}.xlsx`);
  fs.copyFileSync(file, snapshot);
  const summaryPath = path.join(projectDir, 'reports', `bao_cao_${TODAY}.md`);
  const modules = [...new Set(current.map(r => r.module))];
  const lines = ['# Báo cáo ngày', '', `Ngày: ${TODAY}`, '', '| Module | Đã chạy | Pass | Fail | Blocked | Việc cụ thể đã làm | Bug (ID) | Ảnh chính (link) |', '|---|---:|---:|---:|---:|---|---|---|'];
  if (!modules.length) lines.push(`| Chưa chạy | 0 | 0 | 0 | 0 | ${note} |  |  |`);
  for (const module of modules) {
    const subset = current.filter(r => r.module === module);
    const evidencePath = subset.flatMap(r => r.evidence ?? [])[0];
    const evidenceLink = evidencePath ? `[Xem ảnh](${evidencePath})` : '';
    lines.push(`| ${module} | ${subset.filter(r => ['Pass','Fail','Blocked'].includes(r.status)).length} | ${subset.filter(r => r.status === 'Pass').length} | ${subset.filter(r => r.status === 'Fail').length} | ${subset.filter(r => r.status === 'Blocked').length} | ${note} | ${subset.map(r => r.bug_id).filter(Boolean).join(', ')} | ${evidenceLink} |`);
  }
  lines.push('', 'Chỉ gồm kết quả đã ghi trong `results.jsonl`.');
  scanBanned(lines);
  fs.writeFileSync(summaryPath, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Báo cáo: ${path.relative(projectDir, summaryPath)}`);
  console.log(`Excel: ${path.relative(projectDir, snapshot)}`);
}

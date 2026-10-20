import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadResults } from './store.js';
import { redactSecrets } from './secrets.js';
import type { Project, Result } from './types.js';

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function createDashboard(project: Project, projectDir: string): string {
  const results = loadResults(project, projectDir);
  const testsDir = path.join(projectDir, 'cases');
  const caseFiles = fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter(file => file.endsWith('.yaml')) : [];
  const cases = caseFiles.length;
  const executed = new Set(results.map(result => result.id));
  const unrun = caseFiles.map(file => YAML.parse(fs.readFileSync(path.join(testsDir, file), 'utf8')) as { id?: string; title?: string; module?: string; status?: string })
    .filter(test => test.id && !executed.has(test.id) && test.status !== 'Obsolete')
    .map(test => ({ id: test.id!, date: 'Chưa chạy', project: project.name, module: test.module ?? 'Chưa phân loại', status: 'Chưa chạy' as const, actual: '', type: 'Auto' as const, priority: 'P3', severity: 'Medium', evidence: [] }));
  const rows: Array<Result & { evidence: string[] }> = [...results.map(result => ({ ...result, actual: redactSecrets(result.actual ?? ''), evidence: result.evidence ?? [] })), ...unrun];
  const bannedFile = path.resolve(import.meta.dirname, '../config/banned_phrases.txt');
  const banned = fs.existsSync(bannedFile) ? fs.readFileSync(bannedFile, 'utf8').split(/\r?\n/).map(value => value.trim().toLocaleLowerCase('vi')).filter(Boolean) : [];
  const sourceText = JSON.stringify({ project: project.name, rows }).toLocaleLowerCase('vi');
  const found = banned.find(phrase => sourceText.includes(phrase));
  if (found) throw new Error(`Dashboard bị chặn do cụm văn phong cấm: ${found}`);
  const data = escapeJson({ project: project.name, safety: project.safety, cases, rows });
  const html = `<!doctype html>
<html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA Station · ${project.name}</title>
<style>
:root{font:15px system-ui,sans-serif;color:#17212b;background:#f3f6f9}body{margin:0}header{background:#143d59;color:white;padding:22px 5vw}main{max-width:1280px;margin:24px auto;padding:0 20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}.card,section{background:white;border:1px solid #dbe3ea;border-radius:10px;padding:16px}.card b{display:block;font-size:26px;margin-top:6px}.filters{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}input,select{padding:9px;border:1px solid #bccbd6;border-radius:6px;background:white}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #e7edf2;padding:9px;vertical-align:top}th{background:#f7f9fb;position:sticky;top:0}.table-wrap{overflow:auto;max-height:65vh}.Pass{color:#147d45}.Fail{color:#b42318}.Blocked{color:#9a6700}a{color:#075a9c}.muted{color:#596977;font-size:13px}
</style>
<header><h1>QA Station · ${project.name}</h1><div>Safety: ${project.safety} · Testcase YAML: ${cases}</div></header>
<main><div id="cards" class="cards"></div><section><h2>Kết quả chạy</h2><div class="filters"><input id="search" placeholder="Lọc ID, tiêu đề, actual"><select id="status"><option value="">Mọi trạng thái</option><option>Pass</option><option>Fail</option><option>Blocked</option><option>Chưa chạy</option></select><select id="module"><option value="">Mọi module</option></select></div><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>ID</th><th>Module</th><th>Kết quả</th><th>Actual</th><th>Evidence</th></tr></thead><tbody id="rows"></tbody></table></div></section><p class="muted">Dashboard tĩnh. Dữ liệu lấy từ SQLite; kết quả chưa chạy không được tính vào tổng đã chạy.</p></main>
<script>
const data=${data};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const counts=Object.fromEntries(['Pass','Fail','Blocked','Chưa chạy'].map(s=>[s,data.rows.filter(r=>r.status===s).length]));
document.getElementById('cards').innerHTML=[['Testcase YAML',data.cases],['Đã chạy',counts.Pass+counts.Fail+counts.Blocked],['Pass',counts.Pass],['Fail',counts.Fail],['Blocked',counts.Blocked]].map(([k,v])=>'<div class="card">'+esc(k)+'<b>'+esc(v)+'</b></div>').join('');
const modules=[...new Set(data.rows.map(r=>r.module).filter(Boolean))];document.getElementById('module').innerHTML+='<option>'+modules.map(esc).join('</option><option>')+'</option>';
function draw(){const q=document.getElementById('search').value.toLowerCase(),s=document.getElementById('status').value,m=document.getElementById('module').value;const rows=data.rows.filter(r=>(!s||r.status===s)&&(!m||r.module===m)&&[r.id,r.module,r.actual].join(' ').toLowerCase().includes(q));document.getElementById('rows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.id)+'</td><td>'+esc(r.module)+'</td><td class="'+esc(r.status)+'">'+esc(r.status)+'</td><td>'+esc(r.actual)+'</td><td>'+(r.evidence||[]).slice(0,3).map(p=>'<a target="_blank" rel="noopener" href="../../'+p.split('/').map(encodeURIComponent).join('/')+'">Xem ảnh</a>').join('<br>')+'</td></tr>').join('')||'<tr><td colspan="6">Không có kết quả.</td></tr>'}
for(const id of ['search','status','module'])document.getElementById(id).addEventListener('input',draw);draw();
</script></html>`;
  const out = path.join(projectDir, 'reports/dashboard/index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, { mode: 0o600 });
  return out;
}

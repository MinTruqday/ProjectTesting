import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Project, Result, TestCase } from './types.js';

type Db = InstanceType<typeof Database>;

function openDb(projectDir: string): Db {
  const db = new Database(path.join(projectDir, 'qa.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (name TEXT PRIMARY KEY, repo TEXT, branch TEXT, safety TEXT NOT NULL, base_url TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commits (project TEXT NOT NULL, hash TEXT NOT NULL, date TEXT, author TEXT, message TEXT, files_changed TEXT, PRIMARY KEY(project, hash));
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project TEXT NOT NULL, commit_hash TEXT, started_at TEXT NOT NULL, ended_at TEXT, env TEXT, trigger TEXT, exit_reason TEXT);
    CREATE TABLE IF NOT EXISTS testcases (project TEXT NOT NULL, id TEXT NOT NULL, module TEXT, title TEXT NOT NULL, priority TEXT, severity TEXT, technique TEXT, basis TEXT, type TEXT, status TEXT, yaml_hash TEXT, PRIMARY KEY(project, id));
    CREATE TABLE IF NOT EXISTS results (execution_id TEXT PRIMARY KEY, run_id TEXT, project TEXT NOT NULL, testcase_id TEXT NOT NULL, role TEXT, date TEXT NOT NULL, status TEXT NOT NULL, actual TEXT, duration_ms INTEGER, evidence_paths TEXT, flaky_count INTEGER DEFAULT 0, commit_hash TEXT, bug_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_results_project_date ON results(project, date);
    CREATE INDEX IF NOT EXISTS idx_results_case ON results(project, testcase_id, date);
    CREATE TABLE IF NOT EXISTS bugs (id TEXT PRIMARY KEY, signature TEXT UNIQUE, title TEXT, severity TEXT, status TEXT, first_commit TEXT, last_seen_commit TEXT, hits INTEGER DEFAULT 0, testcase_ids TEXT);
    CREATE TABLE IF NOT EXISTS bug_events (id INTEGER PRIMARY KEY, bug_id TEXT NOT NULL, time TEXT NOT NULL, from_status TEXT, to_status TEXT, commit_hash TEXT, note TEXT);
    CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, execution_id TEXT NOT NULL, path TEXT NOT NULL, kind TEXT, sha256 TEXT);
    CREATE TABLE IF NOT EXISTS inventory (project TEXT NOT NULL, date TEXT NOT NULL, screen TEXT NOT NULL, element_count INTEGER, PRIMARY KEY(project, date, screen));
    CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY, run_id TEXT, task TEXT, tokens_est INTEGER, result TEXT);
    CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY, time TEXT NOT NULL, kind TEXT, detail TEXT);
  `);
  return db;
}

function upsertProject(db: Db, project: Project): void {
  db.prepare(`INSERT INTO projects(name,repo,branch,safety,base_url) VALUES(?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET repo=excluded.repo, branch=excluded.branch, safety=excluded.safety, base_url=excluded.base_url`)
    .run(project.name, project.repo ?? null, project.branch ?? null, project.safety, project.base_url);
}

export function persistCase(project: Project, projectDir: string, test: TestCase, yamlText: string): void {
  const db = openDb(projectDir);
  try {
    const tx = db.transaction(() => {
      upsertProject(db, project);
      db.prepare(`INSERT INTO testcases(project,id,module,title,priority,severity,technique,basis,type,status,yaml_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project,id) DO UPDATE SET module=excluded.module,title=excluded.title,
        priority=excluded.priority,severity=excluded.severity,technique=excluded.technique,basis=excluded.basis,type=excluded.type,
        status=excluded.status,yaml_hash=excluded.yaml_hash`).run(project.name, test.id, test.module ?? null, test.title,
          test.priority ?? null, test.severity ?? null, test.technique ?? null, test.basis ?? null, test.type ?? null,
          test.status ?? 'Active', createHash('sha256').update(yamlText).digest('hex'));
    });
    tx();
  } finally { db.close(); }
}

export function persistResult(project: Project, projectDir: string, record: Result): void {
  const db = openDb(projectDir);
  try {
    const tx = db.transaction(() => {
      upsertProject(db, project);
      const runId = record.run_id ?? record.execution_id ?? randomUUID();
      const executionId = record.execution_id ?? randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT OR IGNORE INTO runs(id,project,commit_hash,started_at,ended_at,trigger,exit_reason) VALUES(?,?,?,?,?,?,?)`)
        .run(runId, project.name, record.commit ?? null, now, now, 'manual', record.status === 'Blocked' ? record.actual ?? 'BLOCKED' : null);
      db.prepare(`INSERT OR IGNORE INTO testcases(project,id,module,title,priority,severity,type,status)
        VALUES(?,?,?,?,?,?,?,?)`).run(project.name, record.id, record.module, record.id, record.priority, record.severity, record.type, 'Active');
      db.prepare(`INSERT OR IGNORE INTO results(execution_id,run_id,project,testcase_id,role,date,status,actual,duration_ms,evidence_paths,commit_hash,bug_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(executionId, runId, project.name, record.id,
          record.role ?? null, record.date, record.status, record.actual ?? null, record.duration_ms ?? null,
          JSON.stringify(record.evidence ?? []), record.commit ?? null, record.bug_id ?? null);
      const insertEvidence = db.prepare('INSERT INTO evidence(execution_id,path,kind,sha256) VALUES(?,?,?,?)');
      for (const file of record.evidence ?? []) {
        const absolute = path.join(projectDir, file);
        const hash = fs.existsSync(absolute) ? createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null;
        insertEvidence.run(executionId, file, path.extname(file).slice(1) === 'png' ? 'screenshot' : 'artifact', hash);
      }
    });
    tx();
  } finally { db.close(); }
}

function journalRecords(projectDir: string): Result[] {
  const runsDir = path.join(projectDir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const records: Result[] = [];
  const db = openDb(projectDir);
  try {
    for (const day of fs.readdirSync(runsDir)) {
      const dayDir = path.join(runsDir, day);
      if (!fs.statSync(dayDir).isDirectory()) continue;
      for (const module of fs.readdirSync(dayDir)) {
        const file = path.join(dayDir, module, 'results.jsonl');
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
        for (let index = 0; index < lines.length; index++) {
          const record = JSON.parse(lines[index]) as Result;
          record.execution_id ??= createHash('sha256').update(`${path.relative(projectDir, file)}:${index}:${lines[index]}`).digest('hex');
          record.run_id ??= record.execution_id;
          if (!record.date) record.date = day;
          record.project ??= path.basename(projectDir);
          const runId = record.run_id;
          db.prepare(`INSERT OR IGNORE INTO runs(id,project,commit_hash,started_at,ended_at,trigger,exit_reason) VALUES(?,?,?,?,?,?,?)`)
            .run(runId, record.project, record.commit ?? null, `${record.date}T00:00:00.000Z`, `${record.date}T23:59:59.999Z`, 'journal-recovery', record.status === 'Blocked' ? record.actual ?? 'BLOCKED' : null);
          db.prepare(`INSERT OR IGNORE INTO testcases(project,id,module,title,priority,severity,type,status) VALUES(?,?,?,?,?,?,?,?)`)
            .run(record.project, record.id, record.module ?? module, record.id, record.priority, record.severity, record.type, 'Active');
          db.prepare(`INSERT OR IGNORE INTO results(execution_id,run_id,project,testcase_id,role,date,status,actual,duration_ms,evidence_paths,commit_hash,bug_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.execution_id, runId, record.project, record.id, record.role ?? null, record.date,
              record.status, record.actual ?? null, record.duration_ms ?? null, JSON.stringify(record.evidence ?? []), record.commit ?? null, record.bug_id ?? null);
          records.push(record);
        }
      }
    }
  } finally { db.close(); }
  return records;
}

export function loadResults(project: Project, projectDir: string): Result[] {
  journalRecords(projectDir);
  const db = openDb(projectDir);
  try {
    upsertProject(db, project);
    const rows = db.prepare(`SELECT r.execution_id,r.run_id,r.project,r.testcase_id,r.role,r.date,r.status,r.actual,r.duration_ms,r.evidence_paths,r.commit_hash,r.bug_id,
      t.module,t.type,t.priority,t.severity FROM results r LEFT JOIN testcases t ON t.project=r.project AND t.id=r.testcase_id
      WHERE r.project=? ORDER BY r.date, r.rowid`).all(project.name) as Array<Record<string, unknown>>;
    return rows.map(row => ({ execution_id: String(row.execution_id), run_id: String(row.run_id), project: String(row.project), id: String(row.testcase_id), role: row.role ? String(row.role) : undefined,
      date: String(row.date), status: String(row.status) as Result['status'], actual: row.actual ? String(row.actual) : undefined, duration_ms: row.duration_ms ? Number(row.duration_ms) : undefined,
      evidence: JSON.parse(String(row.evidence_paths ?? '[]')) as string[], commit: row.commit_hash ? String(row.commit_hash) : undefined, bug_id: row.bug_id ? String(row.bug_id) : undefined,
      module: row.module ? String(row.module) : 'Chưa phân loại', type: row.type ? String(row.type) as Result['type'] : 'Auto', priority: row.priority ? String(row.priority) : 'P3', severity: row.severity ? String(row.severity) : 'Medium' }));
  } finally { db.close(); }
}

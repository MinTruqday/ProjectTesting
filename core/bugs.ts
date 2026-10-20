import { createHash } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';

type BugRow = {
  id: string;
  project: string;
  signature: string;
  title: string;
  severity: string;
  status: string;
  hits: number;
  testcase_ids: string;
};

function openBugDb(projectDir: string): InstanceType<typeof Database> {
  const db = new Database(path.join(projectDir, 'qa.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS bugs (
      id TEXT PRIMARY KEY, signature TEXT UNIQUE, title TEXT, severity TEXT, status TEXT,
      first_commit TEXT, last_seen_commit TEXT, hits INTEGER DEFAULT 0, testcase_ids TEXT,
      project TEXT
    );
    CREATE TABLE IF NOT EXISTS bug_events (
      id INTEGER PRIMARY KEY, bug_id TEXT NOT NULL, time TEXT NOT NULL,
      from_status TEXT, to_status TEXT, commit_hash TEXT, note TEXT
    );
  `);
  const columns = db.pragma('table_info(bugs)') as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'project')) db.exec('ALTER TABLE bugs ADD COLUMN project TEXT');
  return db;
}

function signatureHash(project: string, signature: string): string {
  const normalized = signature.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
  if (!normalized) throw new Error('Bug signature không được để trống.');
  return createHash('sha256').update(`${project}\0${normalized}`).digest('hex');
}

export function reportBug(project: string, projectDir: string, input: {
  signature: string;
  title: string;
  severity: string;
  testcaseId: string;
  commit?: string;
}): { id: string; hits: number; status: string } {
  if (!input.title.trim() || !input.testcaseId.trim()) throw new Error('Bug cần --title và --case.');
  if (!['Low', 'Medium', 'High', 'Critical'].includes(input.severity)) throw new Error('severity phải là Low, Medium, High hoặc Critical.');
  const signature = signatureHash(project, input.signature);
  const db = openBugDb(projectDir);
  try {
    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM bugs WHERE project=? AND signature=?').get(project, signature) as BugRow | undefined;
      const now = new Date().toISOString();
      const testcaseIds = new Set<string>(existing ? JSON.parse(existing.testcase_ids || '[]') as string[] : []);
      testcaseIds.add(input.testcaseId);
      const hits = (existing?.hits ?? 0) + 1;
      const status = existing?.status === 'Closed' ? 'Reopened' : hits >= 2 ? 'Confirmed' : 'Open';
      const id = existing?.id ?? `BUG-${signature.slice(0, 12).toUpperCase()}`;
      if (existing) {
        db.prepare(`UPDATE bugs SET title=?, severity=?, status=?, last_seen_commit=?, hits=?, testcase_ids=? WHERE id=?`)
          .run(input.title.trim(), input.severity, status, input.commit ?? null, hits, JSON.stringify([...testcaseIds]), id);
      } else {
        db.prepare(`INSERT INTO bugs(id,project,signature,title,severity,status,first_commit,last_seen_commit,hits,testcase_ids)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, project, signature, input.title.trim(), input.severity, status,
          input.commit ?? null, input.commit ?? null, hits, JSON.stringify([...testcaseIds]));
      }
      db.prepare(`INSERT INTO bug_events(bug_id,time,from_status,to_status,commit_hash,note) VALUES(?,?,?,?,?,?)`)
        .run(id, now, existing?.status ?? null, status, input.commit ?? null, `Failure reported by ${input.testcaseId}; signature redacted to hash.`);
      return { id, hits, status };
    });
    return tx();
  } finally { db.close(); }
}

export function verifyBug(project: string, projectDir: string, id: string): { status: string; passes: number } {
  const db = openBugDb(projectDir);
  try {
    const bug = db.prepare('SELECT * FROM bugs WHERE project=? AND id=?').get(project, id) as BugRow | undefined;
    if (!bug) throw new Error(`Không tìm thấy bug ${id} trong project ${project}.`);
    const testcaseIds = JSON.parse(bug.testcase_ids || '[]') as string[];
    const getLatest = db.prepare(`SELECT status FROM results WHERE project=? AND testcase_id=? AND bug_id=? ORDER BY date DESC, rowid DESC LIMIT 2`);
    const verifiedCase = testcaseIds.find(testcaseId => {
      const rows = getLatest.all(project, testcaseId, id) as Array<{ status: string }>;
      return rows.length >= 2 && rows[0].status === 'Pass' && rows[1].status === 'Pass';
    });
    const passes = verifiedCase ? 2 : testcaseIds.reduce((max, testcaseId) => {
      const rows = getLatest.all(project, testcaseId, id) as Array<{ status: string }>;
      let count = 0;
      for (const row of rows) { if (row.status !== 'Pass') break; count++; }
      return Math.max(max, count);
    }, 0);
    if (!verifiedCase) throw new Error(`Bug chưa đóng: cần 2 lượt Pass liên tiếp có --bug-id ${id}; hiện có ${passes}/2.`);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE bugs SET status=? WHERE project=? AND id=?').run('Closed', project, id);
      db.prepare(`INSERT INTO bug_events(bug_id,time,from_status,to_status,commit_hash,note) VALUES(?,?,?,?,?,?)`)
        .run(id, now, bug.status, 'Closed', null, `Verified by two consecutive passing results for ${verifiedCase}.`);
    })();
    return { status: 'Closed', passes: 2 };
  } finally { db.close(); }
}

export function listBugs(project: string, projectDir: string): Array<Pick<BugRow, 'id' | 'title' | 'severity' | 'status' | 'hits' | 'testcase_ids'>> {
  const db = openBugDb(projectDir);
  try {
    return db.prepare('SELECT id,title,severity,status,hits,testcase_ids FROM bugs WHERE project=? ORDER BY status,id')
      .all(project) as Array<Pick<BugRow, 'id' | 'title' | 'severity' | 'status' | 'hits' | 'testcase_ids'>>;
  } finally { db.close(); }
}

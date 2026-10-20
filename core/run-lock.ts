import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type LockRecord = {
  pid: number;
  run_id: string;
  suite: string;
  started_at: string;
  heartbeat_at: string;
};

export type RunLease = {
  runId: string;
  release: () => void;
};

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function parseLock(file: string): LockRecord | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockRecord>;
    if (typeof value.pid !== 'number' || typeof value.run_id !== 'string' || typeof value.suite !== 'string' || typeof value.started_at !== 'string') return undefined;
    return { pid: value.pid, run_id: value.run_id, suite: value.suite, started_at: value.started_at, heartbeat_at: value.heartbeat_at ?? value.started_at };
  } catch { return undefined; }
}

export function acquireRunLock(projectDir: string, suite: string, resume = false): RunLease {
  const file = path.join(projectDir, '.qa.lock');
  const claimFile = `${file}.claim`;
  let claim: number;
  try { claim = fs.openSync(claimFile, 'wx', 0o600); }
  catch { throw new Error('BLOCKED: dự án đang được một phiên QA khác khởi chạy.'); }

  let runId: string = randomUUID();
  let ownsLock = false;
  try {
    const existing = fs.existsSync(file) ? parseLock(file) : undefined;
    if (resume) {
      if (!existing) throw new Error('BLOCKED: không tìm thấy phiên bị gián đoạn để tiếp tục.');
      if (existing.suite !== suite) throw new Error(`BLOCKED: phiên đang chờ tiếp tục dùng suite ${existing.suite}, không phải ${suite}.`);
      if (processIsAlive(existing.pid)) throw new Error('BLOCKED: phiên QA giữ khóa vẫn đang chạy; không thể resume đồng thời.');
      runId = existing.run_id;
    } else if (fs.existsSync(file)) {
      const ageMs = Date.now() - fs.statSync(file).mtimeMs;
      if (ageMs <= 6 * 60 * 60 * 1000) throw new Error(`BLOCKED: khóa QA còn hiệu lực (suite=${existing?.suite ?? 'unknown'}). Dùng --resume sau khi xác nhận tiến trình cũ đã dừng.`);
      fs.unlinkSync(file);
    }

    const record: LockRecord = { pid: process.pid, run_id: runId, suite, started_at: existing?.started_at ?? new Date().toISOString(), heartbeat_at: new Date().toISOString() };
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    ownsLock = true;
  } finally {
    fs.closeSync(claim);
    fs.unlinkSync(claimFile);
  }

  return {
    runId,
    release: () => {
      if (!ownsLock) return;
      const current = parseLock(file);
      if (current?.pid === process.pid && current.run_id === runId) fs.unlinkSync(file);
      ownsLock = false;
    },
  };
}

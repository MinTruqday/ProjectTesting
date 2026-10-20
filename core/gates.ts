import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './project.js';
import type { Project } from './types.js';

export function parseEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) throw new Error(`BLOCKED: thiếu tệp môi trường ${file}`);
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

export function missingEnv(project: Project, dir: string, roleNames?: string[]): { file: string; missing: string[] } {
  const file = safeResolve(dir, project.env_file || '.env.app');
  const roleConfigs = roleNames === undefined
    ? Object.values(project.roles ?? {})
    : roleNames.map(name => project.roles?.[name]).filter((role): role is NonNullable<typeof role> => Boolean(role));
  const roleKeys = roleConfigs.flatMap(r => [r.user_env, r.pass_env].filter((v): v is string => Boolean(v)));
  if (!fs.existsSync(file)) return { file, missing: [...new Set([...(project.required_env ?? []), ...roleKeys, `.env file missing: ${project.env_file || '.env.app'}`])] };
  const env = parseEnv(file);
  const keys = new Set([...(project.required_env ?? []), ...roleKeys]);
  return { file, missing: [...keys].filter(key => !env[key] && !process.env[key]) };
}

export function assertHostAllowed(urlText: string, allowHosts: string[]): URL {
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`BLOCKED: giao thức không được hỗ trợ: ${url.protocol}`);
  if (!allowHosts.includes(url.hostname)) throw new Error(`BLOCKED: host ${url.hostname} không nằm trong allow_hosts`);
  return url;
}

export async function checkHealth(urlText: string, allowHosts: string[], timeoutMs = 8000): Promise<{ ok: boolean; status?: number; error?: string }> {
  let url: URL;
  try { url = assertHostAllowed(urlText, allowHosts); }
  catch (error) { return { ok: false, error: String(error) }; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return { ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  finally { clearTimeout(timer); }
}

export function blockedRecord(dir: string, message: string): string {
  const file = path.join(dir, `BLOCKED_${new Date().toISOString().slice(0, 10)}.md`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `# BLOCKED\n\n${new Date().toISOString()}\n\n${message}\n`, { flag: 'a', mode: 0o600 });
  return file;
}

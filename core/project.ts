import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Project } from './types.js';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const PROJECTS = path.join(ROOT, 'projects');
export const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

export function readProject(name: string): { config: Project; dir: string } {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(name)) throw new Error(`Tên dự án không hợp lệ: ${name}`);
  const dir = path.join(PROJECTS, name);
  const file = path.join(dir, 'project.yaml');
  if (!fs.existsSync(file)) throw new Error(`Không tìm thấy hồ sơ: ${file}`);
  const config = YAML.parse(fs.readFileSync(file, 'utf8')) as Project;
  if (config.name !== name) throw new Error(`project.yaml name phải khớp tên thư mục (${name})`);
  if (!['local', 'shared-dev', 'read-only'].includes(config.safety)) throw new Error('safety phải là local, shared-dev hoặc read-only');
  if (!Array.isArray(config.allow_hosts) || !Array.isArray(config.health)) throw new Error('project.yaml thiếu allow_hosts hoặc health');
  return { config, dir };
}

export function projectName(args: string[]): string {
  const at = args.indexOf('--project');
  const name = (at >= 0 ? args[at + 1] : process.env.QA_PROJECT) ?? '';
  if (!name) throw new Error('Chọn dự án bằng --project <tên> hoặc đặt QA_PROJECT.');
  return name;
}

export function safeResolve(dir: string, candidate: string): string {
  const absolute = path.resolve(dir, candidate);
  if (absolute !== dir && !absolute.startsWith(dir + path.sep)) throw new Error(`Đường dẫn vượt khỏi thư mục dự án: ${candidate}`);
  return absolute;
}

export function appendJsonl(file: string, item: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(item) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as T);
}

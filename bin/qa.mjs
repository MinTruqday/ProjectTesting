#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const child = spawn('npx', ['tsx', path.join(root, 'core/cli.ts'), ...args], { stdio: 'inherit', cwd: root });
child.on('exit', code => process.exit(code ?? 1));

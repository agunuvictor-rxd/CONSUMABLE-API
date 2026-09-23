import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'scripts', 'tests', 'public'];

const files = [];
for (const dir of dirs) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full, { recursive: true })) {
    if (String(name).endsWith('.js')) files.push(path.join(full, String(name)));
  }
}

let failed = false;
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    failed = true;
    console.error(`SYNTAX ERROR in ${path.relative(root, file)}:\n${check.stderr}`);
  }
}

if (failed) {
  console.error('\nSyntax check failed.');
  process.exit(1);
}
console.log(`Syntax OK for ${files.length} JavaScript file(s).`);
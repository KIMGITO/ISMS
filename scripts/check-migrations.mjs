#!/usr/bin/env node
// Static checks on supabase/migrations before anything reaches the live database (Phase 7).
// Changes nothing. Compares the working tree with a base commit (default: origin/main).
//
//   node scripts/check-migrations.mjs [base-ref]
//
// Errors (exit 1):
//   - a file name that isn't <11 digits>_<lower_snake>.sql, or two files with one version;
//   - a new file that sorts before a file already on the base: `db push` skips it on live
//     ("Remote migration versions not found" / needs --include-all) and it lands out of order;
//   - a file on the base that was deleted;
//   - a new or changed file that drops, renames, retypes or empties a table or column without
//     a `-- destructive-ok: <reason>` line. Installed apps lag behind (no rollback, fix forward),
//     so the old app must keep working: expand first, contract later
//     (docs/DEPLOYMENT_AND_MONITORING.md → Database and edge functions).
// Warnings:
//   - a file on the base that was changed. If it is already on live, live keeps the old text
//     (the 2026-11-18 rider-pay bug). `bash scripts/db-push.sh` refuses to push in that case.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const NAME = /^(\d{11})_[a-z0-9_]+\.sql$/;
const base = process.argv[2] || process.env.MIGRATIONS_BASE || 'origin/main';
const errors = [];
const warnings = [];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });

// Files on the base commit (none if the base can't be read, e.g. a shallow clone).
let baseFiles = new Map();
try {
  for (const path of git('ls-tree', '--name-only', `${base}:${DIR}`).split('\n').filter(Boolean)) {
    if (path.endsWith('.sql')) baseFiles.set(path, git('show', `${base}:${DIR}/${path}`));
  }
} catch {
  warnings.push(`Couldn't read ${base}; only names and destructive changes are checked.`);
  baseFiles = new Map();
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const versions = new Map();
for (const f of files) {
  const m = NAME.exec(f);
  if (!m) { errors.push(`${f}: name must be <11 digits>_<lower_snake_case>.sql`); continue; }
  if (versions.has(m[1])) errors.push(`${f}: version ${m[1]} is also used by ${versions.get(m[1])}`);
  versions.set(m[1], f);
}

const newestOnBase = [...baseFiles.keys()].sort().at(-1);
for (const f of baseFiles.keys()) {
  if (!files.includes(f)) errors.push(`${f}: deleted, but it is on ${base} and may be on live. Undo it in a new migration instead.`);
}

// SQL without comments, so a comment mentioning DROP doesn't count.
const code = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\s+(IF\s+EXISTS\s+)?(?!["]?_)/i, 'drops a table'],
  [/\bDROP\s+COLUMN\b/i, 'drops a column'],
  [/\bALTER\s+TABLE\b[^;]*?\bRENAME\b/i, 'renames a table or column'],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "changes a column's type"],
  // Temp tables in function bodies are named _like_this; GRANT lists also say TRUNCATE.
  [/(^|;)\s*TRUNCATE\s+(TABLE\s+)?(?!["]?_)/im, 'empties a table'],
  [/\bDROP\s+(SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i, 'drops a schema, type or view'],
];

let checked = 0;
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8');
  const onBase = baseFiles.get(f);
  if (onBase === text) continue;
  checked++;
  if (onBase !== undefined) {
    warnings.push(`${f}: changed, but it is already on ${base}. If it is on live, live keeps the old text; put the change in a new migration.`);
  } else if (newestOnBase && f < newestOnBase) {
    errors.push(`${f}: sorts before ${newestOnBase}, which is already on ${base}. Give it a newer version number.`);
  }
  const ok = /--\s*destructive-ok:\s*\S/i.test(text);
  const body = code(text);
  for (const [re, what] of DESTRUCTIVE) {
    if (!re.test(body)) continue;
    if (ok) warnings.push(`${f}: ${what} (marked destructive-ok).`);
    else errors.push(`${f}: ${what}. Older app versions may still use it. Expand first, contract later; if it is safe, add a line "-- destructive-ok: <why>".`);
  }
}

for (const w of warnings) console.log(process.env.GITHUB_ACTIONS ? `::warning::${w}` : `warning  ${w}`);
for (const e of errors) console.log(process.env.GITHUB_ACTIONS ? `::error::${e}` : `ERROR    ${e}`);
console.log(`Migrations: ${files.length} files, ${checked} new or changed since ${base}, ${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length ? 1 : 0);

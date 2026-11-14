#!/usr/bin/env node
// Gets a built site ready for Cloudflare Workers static assets, and refuses one Cloudflare
// would reject, so the deploy fails here with a clear message instead of half way.
//
//   node scripts/prepare-cloudflare.mjs dist
//
// - Leaves out the 26 MB onnxruntime .wasm (over Cloudflare's 25 MiB limit per file). The
//   web build loads it from jsDelivr instead (VITE_ORT_WASM_FROM_CDN=1, backgroundRemoval.worker.ts).
// - Checks every other file is under 25 MiB, that there are at most 20,000 files,
//   and that index.html and _headers are there.

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 20_000;
// .assetsignore uses .gitignore syntax and is never uploaded itself.
const IGNORE = ['ort-wasm-*.wasm'];

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error(`Usage: prepare-cloudflare.mjs <built directory>. "${dir ?? ''}" does not exist; build first.`);
  process.exit(2);
}

const ignored = (name) => IGNORE.some((pattern) => new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(name));

const files = [];
(function walk(d) {
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    const full = join(d, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push({ path: relative(dir, full), name: entry.name, size: statSync(full).size });
  }
})(dir);

writeFileSync(join(dir, '.assetsignore'), `# Written by scripts/prepare-cloudflare.mjs\n${IGNORE.join('\n')}\n.assetsignore\n`);

const uploaded = files.filter((f) => !ignored(f.name) && f.name !== '.assetsignore');
const problems = [];
for (const required of ['index.html', '_headers']) {
  if (!uploaded.some((f) => f.path === required)) problems.push(`${required} is missing from ${dir}.`);
}
for (const f of uploaded.filter((f) => f.size > MAX_FILE)) {
  problems.push(`${f.path} is ${(f.size / 1048576).toFixed(1)} MiB; Cloudflare takes at most 25 MiB per file.`);
}
if (uploaded.length > MAX_FILES) problems.push(`${uploaded.length} files; Cloudflare takes at most ${MAX_FILES}.`);

const skipped = files.filter((f) => ignored(f.name));
const total = uploaded.reduce((sum, f) => sum + f.size, 0);
console.log(`${dir}: ${uploaded.length} files, ${(total / 1048576).toFixed(1)} MiB to upload`
  + (skipped.length ? `; left out: ${skipped.map((f) => f.path).join(', ')} (loaded from jsDelivr)` : ''));

if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}

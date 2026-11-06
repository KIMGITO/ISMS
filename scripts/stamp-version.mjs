#!/usr/bin/env node
// scripts/stamp-version.mjs
// Writes a release version into package.json (read by the app's About screen) and
// tauri.conf.json (installers only upgrade when the version goes up). CI only; not committed.
//   node scripts/stamp-version.mjs 1.2.3

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error(`Usage: stamp-version.mjs X.Y.Z (got "${version}")`);
  process.exit(1);
}

for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
  if (!existsSync(file)) continue;
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`${file}: ${version}`);
}

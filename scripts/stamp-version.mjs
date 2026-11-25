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

// Linux Software centres show the release list from the AppStream file. Write this release,
// with its notes when CI provides release-notes.md (from scripts/release-version.mjs).
const metainfo = "src-tauri/linux/com.isms.app.metainfo.xml";
if (existsSync(metainfo)) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const notesFile = process.env.RELEASE_NOTES_FILE || "release-notes.md";
  const items = existsSync(notesFile)
    ? readFileSync(notesFile, "utf8")
        .split("\n")
        .filter((l) => /^\s*[-*] /.test(l))
        .map((l) =>
          l
            .replace(/^\s*[-*] /, "")
            .replace(/\s*\([0-9a-f]{7,40}\)\s*$/, "") // commit hash
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
            .replace(/[*_`]/g, "")
            .trim(),
        )
        .filter(Boolean)
        .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
    : [];
  const date = new Date().toISOString().slice(0, 10);
  const description = items.length
    ? `\n      <description>\n        <ul>\n${items.map((i) => `          <li>${esc(i)}</li>`).join("\n")}\n        </ul>\n      </description>\n    `
    : "";
  const release = description
    ? `<release version="${version}" date="${date}">${description}</release>`
    : `<release version="${version}" date="${date}"/>`;
  const xml = readFileSync(metainfo, "utf8").replace(
    /<releases>[\s\S]*?<\/releases>/,
    `<releases>\n    ${release}\n  </releases>`,
  );
  writeFileSync(metainfo, xml);
  console.log(`${metainfo}: ${version} (${items.length} notes)`);
}

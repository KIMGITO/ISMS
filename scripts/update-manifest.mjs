#!/usr/bin/env node
// scripts/update-manifest.mjs
// Prints latest.json for a release: the Tauri updater format for desktop, plus an
// "android" entry the app's own updater reads. Run by the release workflow.
//   node scripts/update-manifest.mjs --version 1.2.3 --tag v1.2.3 --repo owner/name \
//     --notes release-notes.md --dir out > out/latest.json

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Builds the manifest from the names of the files in a release. */
export function buildManifest({ version, tag, repo, notes, files, readText, sha256 }) {
  const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const find = (suffix) => files.find((f) => f.endsWith(suffix));

  const platforms = {};
  // The updater looks for "{os}-{arch}-{installer}" first, then "{os}-{arch}".
  // Each kind of install must get its own file: an app installed from the .deb
  // fails with "invalid updater binary format" if it is handed the AppImage.
  const desktop = [
    ["windows-x86_64", "-windows-x64-setup.msi"],
    ["windows-x86_64-msi", "-windows-x64-setup.msi"],
    ["linux-x86_64", "-linux-x86_64.AppImage"],
    ["linux-x86_64-appimage", "-linux-x86_64.AppImage"],
    ["linux-x86_64-deb", "-linux-amd64.deb"],
  ];
  for (const [platform, suffix] of desktop) {
    const file = find(suffix);
    if (!file) continue;
    // Installed desktop apps refuse an update without a valid signature, so a release
    // without one would quietly stop every desktop from updating.
    if (!files.includes(`${file}.sig`)) throw new Error(`${file} has no .sig, so desktop apps would refuse it.`);
    platforms[platform] = { signature: readText(`${file}.sig`).trim(), url: url(file) };
  }
  if (Object.keys(platforms).length === 0) throw new Error("No desktop installers found.");

  const manifest = { version, notes: notes.trim(), pub_date: new Date().toISOString(), platforms };

  const apk = find("-android.apk");
  if (apk) manifest.android = { url: url(apk), sha256: sha256(apk) };
  return manifest;
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
  );
  for (const key of ["version", "tag", "repo", "notes", "dir"]) {
    if (!args[key]) {
      console.error(`Missing --${key}`);
      process.exit(1);
    }
  }
  const dir = args.dir;
  const manifest = buildManifest({
    version: args.version,
    tag: args.tag,
    repo: args.repo,
    notes: readFileSync(args.notes, "utf8"),
    files: readdirSync(dir),
    readText: (name) => readFileSync(join(dir, name), "utf8"),
    sha256: (name) => createHash("sha256").update(readFileSync(join(dir, name))).digest("hex"),
  });
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

#!/usr/bin/env node
// scripts/verify-update-manifest.mjs
// Run by the release workflow after publishing. Downloads latest.json the way installed
// apps do and checks that it is valid, names this version, and that every installer it
// points to can be downloaded. GitHub's download servers sometimes answer 502/504 for a
// while, so each request is retried before it counts as a failure.
//
//   node scripts/verify-update-manifest.mjs --version 1.2.3 \
//     --require https://a/latest.json --require https://b/latest.json \
//     --warn https://github.com/o/r/releases/latest/download/latest.json
//
// --require sources must pass (exit 1 otherwise); --warn sources only print a warning,
// for CDNs that may still serve the previous version for a few minutes.

import { pathToFileURL } from "node:url";

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const ATTEMPTS = 6;
const WAIT_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Problems with a manifest, as a list of sentences (empty when it's fine). */
export function manifestProblems(m, expectedVersion) {
  const problems = [];
  if (!m || typeof m !== "object") return ["it is not a JSON object"];
  if (typeof m.version !== "string" || !VERSION.test(m.version)) problems.push(`version ${JSON.stringify(m.version)} is not x.y.z`);
  else if (expectedVersion && m.version !== expectedVersion) problems.push(`it names ${m.version}, expected ${expectedVersion}`);
  const platforms = m.platforms && typeof m.platforms === "object" ? Object.entries(m.platforms) : [];
  if (platforms.length === 0) problems.push("it lists no desktop platforms");
  for (const [name, p] of platforms) {
    if (!p?.url?.startsWith("https://")) problems.push(`${name} has no https url`);
    if (!p?.signature) problems.push(`${name} has no signature`);
  }
  if (!m.android) problems.push("it has no android entry");
  else {
    if (!m.android.url?.startsWith("https://")) problems.push("android has no https url");
    if (!SHA256.test(m.android.sha256 ?? "")) problems.push("android.sha256 is not a SHA-256");
  }
  return problems;
}

async function withRetries(label, fn) {
  let last;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err.final) break;
      console.log(`  ${label}: ${err.message} (attempt ${i}/${ATTEMPTS})`);
      if (i < ATTEMPTS) await sleep(WAIT_MS);
    }
  }
  throw last;
}

async function fetchManifest(url, expectedVersion) {
  return withRetries(url, async () => {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}check=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      throw new Error(`not JSON: ${text.slice(0, 60)}`);
    }
    const problems = manifestProblems(m, expectedVersion);
    if (problems.length) {
      const err = new Error(problems.join("; "));
      // A wrong version can be a CDN still serving the old file, so keep retrying that.
      err.final = !problems.every((p) => p.startsWith("it names"));
      throw err;
    }
    return m;
  });
}

async function checkDownload(url) {
  return withRetries(url, async () => {
    // One byte is enough to prove the file is there and the server answers.
    const res = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    await res.body?.cancel();
    if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const version = args[args.indexOf("--version") + 1];
  const pick = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  const required = pick("--require");
  const warnOnly = pick("--warn");
  if (!VERSION.test(version ?? "") || required.length === 0) {
    console.error("Usage: --version x.y.z --require <url> [--require <url>] [--warn <url>]");
    process.exit(2);
  }

  let failed = false;
  let manifest = null;
  for (const url of required) {
    try {
      manifest = await fetchManifest(url, version);
      console.log(`OK   ${url}`);
    } catch (err) {
      failed = true;
      console.log(`::error::latest.json at ${url} is not usable: ${err.message}`);
    }
  }
  for (const url of warnOnly) {
    try {
      await fetchManifest(url, version);
      console.log(`OK   ${url}`);
    } catch (err) {
      console.log(`::warning::${url} is not serving ${version} yet (${err.message}). Apps fall back to the other sources.`);
    }
  }

  if (manifest) {
    const files = [...new Set([...Object.values(manifest.platforms).map((p) => p.url), manifest.android.url])];
    for (const url of files) {
      try {
        await checkDownload(url);
        console.log(`OK   ${url}`);
      } catch (err) {
        failed = true;
        console.log(`::error::${url} can't be downloaded: ${err.message}`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

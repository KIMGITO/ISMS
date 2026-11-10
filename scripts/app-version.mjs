// scripts/app-version.mjs
// Works out the version a build shows in About. vite.config.ts uses it.
// The release workflow writes the version into package.json before it builds, but
// Vercel (the web app) builds straight from main, where package.json says 0.0.0.
// So the version is looked up, first match wins:
//   1. APP_VERSION env var (set it to force a version)
//   2. package.json, when CI has stamped it (anything but 0.0.0)
//   3. git tags and commits, worked out the same way as the release workflow
//      (scripts/release-version.mjs), so the web shows the version this commit ships as
//   4. latest.json on the update-manifest branch (the newest published release)
//   5. 0.0.0

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRelease } from "./release-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+$/;
const DEFAULT_REPO = "KIMGITO/ISMS";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
}

function repoSlug() {
  const { VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: slug, GITHUB_REPOSITORY } = process.env;
  if (owner && slug) return `${owner}/${slug}`;
  return GITHUB_REPOSITORY || DEFAULT_REPO;
}

// Vercel clones only the last few commits and no tags. Fetch the tags and the commit
// history (commits only, no file contents) so the version can be worked out.
function ensureHistory() {
  let shallow = false;
  try {
    shallow = git("rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return false; // not a git checkout
  }
  const hasTags = git("tag", "--list", "v*").length > 0;
  if (!shallow && hasTags) return true;
  const url = `https://github.com/${repoSlug()}.git`;
  const attempts = [
    ["fetch", "--quiet", "--tags", "--filter=tree:0", ...(shallow ? ["--unshallow"] : []), url],
    ["fetch", "--quiet", "--tags", ...(shallow ? ["--unshallow"] : []), url],
  ];
  for (const args of attempts) {
    try {
      git(...args);
      return true;
    } catch {
      // try the next way
    }
  }
  return false;
}

function fromGit() {
  try {
    if (!ensureHistory()) return null;
    const { version, previousTag } = computeRelease();
    return previousTag && SEMVER.test(version) ? version : null;
  } catch {
    return null;
  }
}

async function fromManifest() {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repoSlug()}/update-manifest/latest.json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const { version } = await res.json();
    const clean = String(version || "").replace(/^v/, "");
    return SEMVER.test(clean) ? clean : null;
  } catch {
    return null;
  }
}

export async function resolveAppVersion() {
  const env = (process.env.APP_VERSION || "").replace(/^v/, "");
  if (SEMVER.test(env)) return { version: env, source: "APP_VERSION" };

  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  if (SEMVER.test(pkg) && pkg !== "0.0.0") return { version: pkg, source: "package.json" };

  const tagged = fromGit();
  if (tagged) return { version: tagged, source: "git tags" };

  const published = await fromManifest();
  if (published) return { version: published, source: "update-manifest" };

  return { version: "0.0.0", source: "none found" };
}

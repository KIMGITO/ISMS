#!/usr/bin/env node
// scripts/release-version.mjs
// Works out the next version from the commits since the last vX.Y.Z tag.
// Used by .github/workflows/release-and-deploy.yml; run it locally to preview:
//   node scripts/release-version.mjs
//
// Commit subjects look like "🚀 feat(scope)!: description". The emoji and scope are optional.
//   major  any type followed by "!", or "BREAKING CHANGE" / "BREAKING-CHANGE" in the body
//   minor  feat
//   patch  fix, perf, refactor
//   none   wip, docs, style, test, chore, build, ci, revert, and anything unrecognised

import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MINOR_TYPES = new Set(["feat"]);
const PATCH_TYPES = new Set(["fix", "perf", "refactor"]);
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

// Leading emoji (including variation selectors such as the one in ♻️) and spaces are skipped.
const SUBJECT = /^[^A-Za-z]*(?<type>[A-Za-z]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?:\s*(?<description>.*)$/u;
const BREAKING_BODY = /BREAKING[ -]CHANGE/;

/** @returns {{ type: string|null, scope: string|null, breaking: boolean, bump: 'none'|'patch'|'minor'|'major', description: string }} */
export function classifyCommit(subject, body = "") {
  const match = SUBJECT.exec(subject.trim());
  const type = match ? match.groups.type.toLowerCase() : null;
  const breaking = Boolean(match?.groups.bang) || BREAKING_BODY.test(body);
  let bump = "none";
  if (breaking) bump = "major";
  else if (type && MINOR_TYPES.has(type)) bump = "minor";
  else if (type && PATCH_TYPES.has(type)) bump = "patch";
  return {
    type,
    scope: match?.groups.scope || null,
    breaking,
    bump,
    description: match ? match.groups.description : subject.trim(),
  };
}

export function highestBump(commits) {
  return commits.reduce((best, c) => (RANK[c.bump] > RANK[best] ? c.bump : best), "none");
}

export function nextVersion(previous, bump) {
  const [major, minor, patch] = previous.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return previous;
}

export function releaseNotes(commits, previousTag, tag, repo) {
  const sections = [
    ["Breaking changes", (c) => c.breaking],
    ["Features", (c) => !c.breaking && c.bump === "minor"],
    ["Fixes and improvements", (c) => !c.breaking && c.bump === "patch"],
  ];
  const lines = [];
  for (const [title, pick] of sections) {
    const picked = commits.filter(pick);
    if (picked.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const c of picked) {
      lines.push(`- ${c.scope ? `**${c.scope}:** ` : ""}${c.description} (${c.sha.slice(0, 7)})`);
    }
    lines.push("");
  }
  if (repo && previousTag) lines.push(`**Full changelog:** https://github.com/${repo}/compare/${previousTag}...${tag}`);
  return lines.join("\n").trim() + "\n";
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function latestTag() {
  const tags = git("tag", "--list", "v*", "--sort=-v:refname", "--merged", "HEAD").split("\n");
  return tags.find((t) => /^v\d+\.\d+\.\d+$/.test(t)) || null;
}

function commitsSince(tag) {
  const range = tag ? [`${tag}..HEAD`] : ["HEAD"];
  // Merge commits are skipped; the commits they bring in are listed on their own.
  const raw = git("log", ...range, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e");
  return raw
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ""] = record.split("\x1f");
      return { sha, subject, ...classifyCommit(subject, body) };
    });
}

function main() {
  const previousTag = latestTag();
  const previous = previousTag ? previousTag.slice(1) : "0.0.0";
  const commits = commitsSince(previousTag);
  const bump = highestBump(commits);
  const version = nextVersion(previous, bump);
  const tag = `v${version}`;
  const notes = releaseNotes(commits, previousTag, tag, process.env.GITHUB_REPOSITORY);

  for (const c of commits) console.log(`${c.bump.padEnd(5)}  ${c.subject}`);
  console.log(`\n${previousTag || "(no tag)"} -> ${bump === "none" ? "no release" : tag} (${bump})`);

  if (process.env.GITHUB_OUTPUT) {
    const notesFile = process.env.RELEASE_NOTES_FILE || "release-notes.md";
    writeFileSync(notesFile, notes);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [`bump=${bump}`, `previous=${previousTag || ""}`, `version=${version}`, `tag=${tag}`, `notes_file=${notesFile}`].join("\n") + "\n",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

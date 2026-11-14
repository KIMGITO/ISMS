#!/usr/bin/env node
// Checks that a web deployment really works before (and after) it takes traffic.
//
//   node scripts/smoke-test-web.mjs --url https://kaykays-app.example.workers.dev [--path /terms] [--path /about]
//
// For each page: it answers 200 with HTML that has the app's root element, and every script
// and stylesheet the page loads answers 200 too (a half-uploaded or broken build fails here).
// New deployments can take a few seconds to answer everywhere, so each check retries.
//
// CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (optional): a Cloudflare Access service token,
// only needed if you put the preview URLs behind Cloudflare Access.

const args = process.argv.slice(2);
const option = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const base = option('--url')[0]?.replace(/\/$/, '');
const paths = ['/', ...option('--path')];
if (!base) {
  console.error('Usage: smoke-test-web.mjs --url <deployment url> [--path /page]...');
  process.exit(2);
}

const headers = { 'user-agent': 'kaykays-deploy-check' };
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (res.ok) return res;
      last = new Error(`${url} answered ${res.status}`);
      // 401/403 won't fix itself: protection is on and the bypass secret is wrong or missing.
      if (res.status === 401 || res.status === 403) {
        last = new Error(`${url} answered ${res.status}. Is the preview behind Cloudflare Access without CF_ACCESS_CLIENT_ID/SECRET set?`);
        break;
      }
    } catch (err) {
      last = new Error(`${url}: ${err.message}`);
    }
    await sleep(attempt * 3000);
  }
  throw last;
}

const failures = [];
for (const path of paths) {
  const url = base + path;
  try {
    const res = await get(url);
    const type = res.headers.get('content-type') || '';
    const html = await res.text();
    if (!type.includes('text/html')) throw new Error(`${url} is ${type || 'no content type'}, not HTML`);
    if (!/<div id="root"/.test(html)) throw new Error(`${url} has no <div id="root">, so the app can't start`);

    const assets = [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    if (path === '/' && assets.length === 0) throw new Error(`${url} loads no scripts or styles`);
    for (const asset of new Set(assets)) {
      const assetUrl = new URL(asset, url).href;
      if (!assetUrl.startsWith(base)) continue; // fonts and the like from other hosts
      const a = await get(assetUrl);
      const body = await a.arrayBuffer();
      if (body.byteLength === 0) throw new Error(`${assetUrl} is empty`);
    }
    console.log(`ok   ${url} (${assets.length} assets)`);
  } catch (err) {
    console.log(`FAIL ${url}: ${err.message}`);
    failures.push(err.message);
  }
}

if (failures.length) {
  console.log(`::error::Deployment check failed: ${failures[0]}`);
  process.exit(1);
}

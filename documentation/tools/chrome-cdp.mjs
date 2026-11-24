#!/usr/bin/env node
// Drives headless Google Chrome through the DevTools protocol (Node 22+ has WebSocket built in).
//
//   node chrome-cdp.mjs pdf <input.html> <output.pdf> <header.html> <footer.html>
//   node chrome-cdp.mjs screenshot <url> <output.png> <width> <height> [waitMs]
//
// PDF: A4, CSS page size and margins, header/footer templates, and a document outline
// (PDF bookmarks) built from the h1-h3 headings. Internal links are kept as PDF links.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_BIN || "google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "cdp-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const once = (method) => new Promise((r) => {
    const l = (m) => { if (m.method === method) { listeners.splice(listeners.indexOf(l), 1); r(m); } };
    listeners.push(l);
  });
  const close = () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }, 500); };
  return { send, once, close };
}

async function pdf(input, output, headerFile, footerFile) {
  const c = await launch();
  try {
    await c.send("Page.enable");
    const loaded = c.once("Page.loadEventFired");
    await c.send("Page.navigate", { url: pathToFileURL(resolve(input)).href });
    await loaded;
    await sleep(800); // fonts and images
    const { data } = await c.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: headerFile !== "none",
      headerTemplate: headerFile !== "none" ? readFileSync(headerFile, "utf8") : "<span></span>",
      footerTemplate: footerFile !== "none" ? readFileSync(footerFile, "utf8") : "<span></span>",
      generateDocumentOutline: true,
      generateTaggedPDF: true,
    });
    writeFileSync(output, Buffer.from(data, "base64"));
  } finally { c.close(); }
}

// clicks: optional "Button text|Other button" list, pressed in order before the capture.
async function screenshot(url, output, width, height, waitMs = 8000, clicks = "") {
  const c = await launch();
  try {
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", {
      width: +width, height: +height, deviceScaleFactor: 1, mobile: +width < 600,
    });
    await c.send("Page.navigate", { url });
    await sleep(+waitMs);
    for (const label of clicks.split("|").filter(Boolean)) {
      await c.send("Runtime.evaluate", {
        expression: `(() => { const b = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())})); if (b) b.click(); return !!b; })()`,
      });
      await sleep(2500);
    }
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(output, Buffer.from(data, "base64"));
  } finally { c.close(); }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "pdf") await pdf(...args);
else if (cmd === "screenshot") await screenshot(...args);
else { console.error("usage: chrome-cdp.mjs pdf|screenshot ..."); process.exit(2); }

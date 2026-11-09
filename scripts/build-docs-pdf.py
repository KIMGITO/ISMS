#!/usr/bin/env python3
"""Render the Markdown docs to PDF with headless Chrome.

    python3 scripts/build-docs-pdf.py            # both documents
    python3 scripts/build-docs-pdf.py docs/USER_GUIDE.md

Needs: python3-markdown (pip install markdown) and google-chrome or chromium.
Each .md is written as a .pdf next to it. The front matter (title, subtitle,
version, date) becomes the cover page.
"""
import html
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT = ["docs/SYSTEM_DOCUMENTATION.md", "docs/USER_GUIDE.md"]

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", "Segoe UI", Arial, sans-serif; font-size: 10pt;
       line-height: 1.5; color: #1e293b; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center;
         border-left: 6px solid #f59e0b; padding-left: 14mm; page-break-after: always; }
.cover .brand { font-size: 11pt; letter-spacing: .2em; text-transform: uppercase; color: #b45309; font-weight: 700; }
.cover h1 { font-size: 30pt; margin: 6mm 0 4mm; border: 0; padding: 0; color: #0f172a; }
.cover .sub { font-size: 13pt; color: #475569; max-width: 140mm; }
.cover .meta { margin-top: 14mm; font-size: 10pt; color: #64748b; }
h1 { font-size: 19pt; color: #0f172a; border-bottom: 2px solid #f59e0b; padding-bottom: 2mm;
     margin: 0 0 4mm; page-break-after: avoid; }
h2 { font-size: 13pt; color: #0f172a; margin: 6mm 0 2mm; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 4mm 0 1mm; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 6mm; }
li { margin: 1mm 0; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 4mm; font-size: 9pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #fef3c7; text-align: left; color: #0f172a; }
th, td { border: 1px solid #e2e8f0; padding: 1.6mm 2.2mm; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f8fafc; }
code { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 8.5pt;
       background: #f1f5f9; padding: .2mm 1mm; border-radius: 2px; }
pre { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 3px; padding: 3mm;
      font-size: 8pt; line-height: 1.35; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
strong { color: #0f172a; }
.page-break { page-break-after: always; }
"""


def split_front_matter(text: str):
    meta = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        text = text[m.end():]
    return meta, text


def build(md_path: pathlib.Path, chrome: str):
    meta, body = split_front_matter(md_path.read_text(encoding="utf-8"))
    # The first H1 repeats the title; the cover replaces it.
    body = re.sub(r"^# .*\n", "", body.lstrip(), count=1)
    content = markdown.markdown(body, extensions=["tables", "fenced_code", "sane_lists"])
    title = html.escape(meta.get("title", md_path.stem))
    cover = (
        f'<section class="cover"><div class="brand">KayKay\'s</div><h1>{title}</h1>'
        f'<div class="sub">{html.escape(meta.get("subtitle", ""))}</div>'
        f'<div class="meta">Version {html.escape(meta.get("version", ""))} · {html.escape(meta.get("date", ""))}</div></section>'
    )
    page = f'<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>{CSS}</style></head><body>{cover}{content}</body></html>'
    out = md_path.with_suffix(".pdf")
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "doc.html"
        src.write_text(page, encoding="utf-8")
        subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={out}", src.as_uri()],
            check=True, capture_output=True,
        )
    print(f"wrote {out.relative_to(ROOT)}")


def main():
    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser") if shutil.which(c)), None)
    if not chrome:
        sys.exit("Chrome or Chromium is needed to make PDFs.")
    for p in sys.argv[1:] or DEFAULT:
        build((ROOT / p).resolve(), chrome)


if __name__ == "__main__":
    main()

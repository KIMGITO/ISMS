#!/usr/bin/env python3
"""Build the ISMS documentation set (User Guide, Technical Documentation, Administration Guide).

    python3 documentation/tools/build_docs.py all            # diagrams, checks, PDF and DOCX for all three
    python3 documentation/tools/build_docs.py ug --check     # checks only (numbering, links, captions)
    python3 documentation/tools/build_docs.py td --no-docx   # skip the DOCX

Documents: ug = ISMS-UG, td = ISMS-TD, ag = ISMS-AG (see DOCS_SET below).
Inputs:  documentation/final/<folder>/<ID>.md, final/diagrams/src/*.dot|*.seq, final/images/screens/
Outputs: final/<folder>/<ID>.docx (editable), final/<folder>/<ID>.pdf, final/diagrams/*.svg|*.png,
         final/build/<id>/ (intermediate HTML; not committed)

Requirements: Python 3.10+, `pip install -r documentation/tools/requirements.txt`,
Graphviz (dot), Inkscape, Google Chrome, LibreOffice 7.4+ (python3-uno), Node.js 22+.

Authoring conventions (enforced by the checks):
  * Chapter headings  "# Chapter 9: Security and Access Control"       -> id ch-9
    Part headings     "# Part I: Software Technical Documentation"     -> id part-1
    Appendices        "# Appendix D: Database Reference"               -> id app-d
    Sections          "## 9.1 Authentication"  "### 9.1.2 ..."          -> id s-9-1, s-9-1-2
    Unnumbered h1/h2 only in the front and back matter.
  * Table caption: a paragraph "**Table 9.1:** Title" directly before the table -> id t-9-1
  * Figure: an image alone in a paragraph, "![Figure 4.1: Title](diagrams/x.svg)" -> id f-4-1
  * Cross-references: [Section 9.1](#s-9-1), [Table 9.1](#t-9-1), [Figure 4.1](#f-4-1)
  * Placeholders: <!-- TOC -->, <!-- LIST OF FIGURES -->, <!-- LIST OF TABLES -->
"""
import argparse
import html
import os
import json
import pathlib
import re
import shutil
import subprocess
import sys

import markdown

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
DOCS = ROOT / "final"           # image paths in the sources are relative to this folder
DIAG = DOCS / "diagrams"
DOCS_SET = {
    "ug": ("ISMS-System-User-Guide", "ISMS-UG"),
    "td": ("ISMS-Technical-Documentation", "ISMS-TD"),
    "ag": ("ISMS-System-Administration-Guide", "ISMS-AG"),
}
SRC = BUILD = PDF_OUT = DOCX_OUT = None   # set per document in main()

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6}
errors, warnings = [], []


# --------------------------------------------------------------------------- diagrams
def build_diagrams():
    for src in sorted((DIAG / "src").glob("*")):
        svg, png = DIAG / f"{src.stem}.svg", DIAG / f"{src.stem}.png"
        if svg.exists() and png.exists() and svg.stat().st_mtime > src.stat().st_mtime \
                and png.stat().st_mtime > src.stat().st_mtime:
            continue
        if src.suffix == ".dot":
            subprocess.run(["dot", "-Tsvg", str(src), "-o", str(svg)], check=True)
            subprocess.run(["dot", "-Tpng", "-Gdpi=200", str(src), "-o", str(png)], check=True)
        elif src.suffix == ".seq":
            subprocess.run([sys.executable, str(TOOLS / "seqdiag.py"), str(src), str(svg)], check=True)
            subprocess.run(["inkscape", str(svg), "--export-type=png", f"--export-filename={png}",
                            "--export-dpi=200", "--export-background=white"], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"  diagram {src.name}")


# --------------------------------------------------------------------------- parsing
def front_matter(text):
    meta = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        text = text[m.end():]
    return meta, text


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s))


class Doc:
    def __init__(self):
        self.headings = []   # (level, id, number, title, kind)
        self.figures = []    # (id, number, title)
        self.tables = []     # (id, number, title)
        self.ids = set()


def number_headings(body_html, doc):
    """Give every heading a stable id and check the numbering."""
    state = {"chapter": None, "part": 0, "chapters_seen": [], "sec": 0, "sub": 0, "zone": "front"}

    def repl(m):
        level, inner = int(m.group(1)), m.group(2)
        title = strip_tags(inner).strip()
        kind, number, hid = "plain", "", None
        if level == 1:
            pm = re.match(r"Part (I|II|III|IV|V|VI): (.+)", title)
            cm = re.match(r"Chapter (\d+): (.+)", title)
            am = re.match(r"Appendix ([A-Z]): (.+)", title)
            if pm:
                kind, number = "part", pm.group(1)
                hid = f"part-{ROMAN[pm.group(1)]}"
                if ROMAN[pm.group(1)] != state["part"] + 1:
                    errors.append(f"Part {pm.group(1)} out of order")
                state.update(part=ROMAN[pm.group(1)], zone="body")
            elif cm:
                kind, number = "chapter", cm.group(1)
                n = int(number)
                expected = (state["chapters_seen"][-1] + 1) if state["chapters_seen"] else 1
                if n != expected:
                    errors.append(f"Chapter {n} found where Chapter {expected} was expected")
                state["chapters_seen"].append(n)
                state.update(chapter=number, sec=0, sub=0, zone="body")
                hid = f"ch-{n}"
            elif am:
                kind, number = "appendix", am.group(1)
                state.update(chapter=number, sec=0, sub=0, zone="back")
                hid = f"app-{number.lower()}"
            else:
                state.update(chapter=None, zone="back" if state["zone"] != "front" else "front")
                hid = slug(title)
        elif level in (2, 3):
            nm = re.match(r"([0-9A-Z]+)\.(\d+)(?:\.(\d+))? (.+)", title)
            if nm and state["chapter"] is not None:
                if nm.group(1) != state["chapter"]:
                    errors.append(f"Heading '{title}' is inside chapter {state['chapter']}")
                a = int(nm.group(2))
                if level == 2:
                    if nm.group(3) or a != state["sec"] + 1:
                        errors.append(f"Section numbering: '{title}' (expected {state['chapter']}.{state['sec'] + 1})")
                    state.update(sec=a, sub=0)
                else:
                    b = int(nm.group(3) or 0)
                    if a != state["sec"] or b != state["sub"] + 1:
                        errors.append(f"Subsection numbering: '{title}' (expected {state['chapter']}.{state['sec']}.{state['sub'] + 1})")
                    state["sub"] = b
                number = ".".join(x for x in nm.groups()[:3] if x)
                kind = "section" if level == 2 else "subsection"
                hid = "s-" + number.lower().replace(".", "-")
            else:
                if state["chapter"] is not None and state["zone"] == "body":
                    errors.append(f"Unnumbered h{level} inside a chapter: '{title}'")
                hid = slug(title)
        else:
            hid = slug(f"{state['chapter']}-{title}")
        base, i = hid, 2
        while hid in doc.ids:
            hid, i = f"{base}-{i}", i + 1
        doc.ids.add(hid)
        doc.headings.append((level, hid, number, title, kind))
        cls = f' class="{kind}"' if kind in ("part", "chapter", "appendix") else ""
        return f'<h{level} id="{hid}"{cls}>{inner}</h{level}>'

    out = re.sub(r"<h([1-4])>(.*?)</h\1>", repl, body_html, flags=re.S)
    return out


def captions(body_html, doc):
    current = {"ch": None}

    def chapter_of(pos_html):
        return None

    # Walk in document order so we know the chapter each caption sits in.
    pieces = re.split(r'(<h1 id="[^"]+"[^>]*>.*?</h1>)', body_html, flags=re.S)
    out = []
    zone_ch = None
    counters = {}
    for piece in pieces:
        hm = re.match(r'<h1 id="([^"]+)"', piece)
        if hm:
            hid = hm.group(1)
            zone_ch = hid.split("-", 1)[1].upper() if hid.startswith(("ch-", "app-")) else None
            out.append(piece)
            continue

        def table_cap(m):
            kind_num, title = m.group(1), m.group(2).strip()
            num = kind_num
            if zone_ch is None or not num.upper().startswith(zone_ch + "."):
                errors.append(f"Table {num} is outside its chapter ({zone_ch})")
            n = int(num.split(".")[1])
            if n != counters.get(("t", zone_ch), 0) + 1:
                errors.append(f"Table {num} out of sequence")
            counters[("t", zone_ch)] = n
            tid = "t-" + num.lower().replace(".", "-")
            doc.ids.add(tid)
            doc.tables.append((tid, num, strip_tags(title)))
            return f'<p class="caption table-caption" id="{tid}">Table {num}: {title}</p>\n<table'

        piece = re.sub(r"<p><strong>Table ([0-9A-Z]+\.\d+):</strong>(.*?)</p>\s*<table", table_cap, piece, flags=re.S)

        def fig(m):
            attrs = m.group(1)
            alt = re.search(r'alt="([^"]*)"', attrs).group(1)
            fm = re.match(r"Figure ([0-9A-Z]+\.\d+): (.+)", html.unescape(alt))
            if not fm:
                errors.append(f"Image without a figure caption: {alt[:60]}")
                return m.group(0)
            num, title = fm.group(1), fm.group(2)
            if zone_ch is None or not num.startswith(zone_ch + "."):
                errors.append(f"Figure {num} is outside its chapter ({zone_ch})")
            n = int(num.split(".")[1])
            if n != counters.get(("f", zone_ch), 0) + 1:
                errors.append(f"Figure {num} out of sequence")
            counters[("f", zone_ch)] = n
            fid = "f-" + num.lower().replace(".", "-")
            doc.ids.add(fid)
            doc.figures.append((fid, num, title))
            src = re.search(r'src="([^"]+)"', attrs).group(1)
            if not (DOCS / src).exists():
                errors.append(f"Figure {num}: missing image {src}")
            name = src.rsplit("/", 1)[-1]
            cls = "diagram" if src.startswith("diagrams/") else (
                "shot phone" if name.startswith(("phone-", "sign-in", "terms")) else "shot")
            return (f'<figure id="{fid}" class="{cls}"><img src="{src}" alt="{html.escape(title)}">'
                    f'<figcaption>Figure {num}: {html.escape(title)}</figcaption></figure>')

        piece = re.sub(r"<p>\s*<img([^>]*)/?>\s*</p>", fig, piece)
        # Tables in Parts I-III must have a caption.
        if zone_ch and zone_ch.isdigit():
            for tm in re.finditer(r"(.{0,200})<table", piece, flags=re.S):
                if "table-caption" not in tm.group(1):
                    errors.append(f"Uncaptioned table in chapter {zone_ch}")
        out.append(piece)
    return "".join(out)


def check_links(body_html, doc):
    refs = re.findall(r'href="#([^"]+)"', body_html)
    for r in refs:
        if r not in doc.ids:
            errors.append(f"Broken internal link #{r}")
    used = set(refs)
    for fid, num, _ in doc.figures:
        if fid not in used:
            warnings.append(f"Figure {num} is never referenced in the text")
    for tid, num, _ in doc.tables:
        if tid not in used:
            warnings.append(f"Table {num} is never referenced in the text")
    # Text that names a section/table/figure should link to it.
    for m in re.finditer(r"(?<![\">#/\w-])(Section|Table|Figure|Chapter) ([0-9]+(?:\.[0-9]+)*)(?![\d.]*</a>)", body_html):
        if not re.search(r"ISMS-(UG|TD|AG),? $", body_html[max(0, m.start() - 9):m.start()]):
            warnings.append(f"Unlinked reference: {m.group(0)}")
    return len(refs)


def build_lists(doc):
    toc = ['<nav class="toc" id="toc-list"><ul>']
    for level, hid, number, title, kind in doc.headings:
        if kind in ("part",):
            toc.append(f'<li class="toc-part"><a href="#{hid}">{html.escape(title)}</a><span class="pg" data-for="{hid}"></span></li>')
        elif level == 1 and hid not in ("table-of-contents",):
            toc.append(f'<li class="toc-1"><a href="#{hid}">{html.escape(title)}</a><span class="pg" data-for="{hid}"></span></li>')
        elif level == 2 and (kind == "section" or doc_zone_back(hid)):
            toc.append(f'<li class="toc-2"><a href="#{hid}">{html.escape(title)}</a><span class="pg" data-for="{hid}"></span></li>')
    toc.append("</ul></nav>")
    lof = ['<nav class="lof"><ul>'] + [
        f'<li><a href="#{fid}">Figure {num}: {html.escape(title)}</a><span class="pg" data-for="{fid}"></span></li>'
        for fid, num, title in doc.figures] + ["</ul></nav>"]
    lot = ['<nav class="lot"><ul>'] + [
        f'<li><a href="#{tid}">Table {num}: {html.escape(title)}</a><span class="pg" data-for="{tid}"></span></li>'
        for tid, num, title in doc.tables] + ["</ul></nav>"]
    return "\n".join(toc), "\n".join(lof), "\n".join(lot)


def doc_zone_back(hid):
    return False


def render_body(md_text):
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "sane_lists", "md_in_html"],
                             output_format="html5")
    doc = Doc()
    body = number_headings(body, doc)
    body = captions(body, doc)
    # Back-to-contents link after every part, chapter and appendix heading.
    body = re.sub(r'(<h1 id="[^"]+" class="(?:chapter|appendix)">.*?</h1>)',
                  r'\1\n<p class="backlink"><a href="#table-of-contents">Back to Table of Contents</a></p>', body, flags=re.S)
    toc, lof, lot = build_lists(doc)
    body = body.replace("<!-- TOC -->", toc).replace("<!-- LIST OF FIGURES -->", lof).replace("<!-- LIST OF TABLES -->", lot)
    nlinks = check_links(body, doc)
    # Tables: wrap for page-fit; mark the first row as a header for repetition.
    body = body.replace("<table>", '<table class="data">')
    # Callouts: a quote that starts with **Warning:** or **Important:** gets its own colour.
    body = re.sub(r"<blockquote>\s*<p><strong>(Warning|Important):</strong>",
                  lambda m: f'<blockquote class="{m.group(1).lower()}">\n<p><strong>{m.group(1)}:</strong>', body)
    return body, doc, nlinks


# --------------------------------------------------------------------------- output
CSS = (TOOLS / "print_docs.css")


def cover_html(meta, flavour):
    e = lambda k: html.escape(meta.get(k, ""))
    rows = "".join(f"<tr><th>{label}</th><td>{e(key)}</td></tr>" for label, key in (
        ("Document identifier", "doc_id"), ("Document version", "version"),
        ("Software release", "software_release"), ("Status", "status"),
        ("Created", "created"), ("Last updated", "date"), ("Classification", "classification"),
        ("Document owner", "author"), ("Contact", "contact")) if meta.get(key))
    if flavour == "docx":
        # LibreOffice applies inline styles; the cover is not a heading, so it stays out of the TOC.
        return (f'<p style="font-size:11pt; color:#d97706; letter-spacing:2pt"><b>{html.escape(meta.get("organisation", "").upper())}</b></p>'
                f'<p style="font-size:28pt; margin-top:30pt"><b>{e("title")}</b></p>'
                f'<p style="font-size:15pt; color:#334155"><b>{e("software")}</b></p>'
                f'<p style="font-size:11.5pt; color:#475569">{e("description")}</p><p>&nbsp;</p>'
                f'<table class="cover-meta" cellpadding="3">{rows}</table>')
    return f"""<section class="cover">
  <div class="cover-band"></div>
  <div class="cover-body">
    <div class="cover-org">{e('organisation')}</div>
    <div class="cover-title">{e('title')}</div>
    <div class="cover-sub">{e('software')}</div>
    <p class="cover-desc">{e('description')}</p>
    <table class="cover-meta">{rows}</table>
  </div>
</section>"""


def write_html(body, meta, path, flavour):
    css = CSS.read_text(encoding="utf-8")
    if flavour == "docx":
        # LibreOffice reads PNG images and named anchors best.
        import base64
        from PIL import Image

        def embed(m):
            rel = m.group(1)
            if rel.startswith("diagrams/") and rel.endswith(".svg"):
                rel = rel[:-4] + ".png"
            p = DOCS / rel
            w, h = Image.open(p).size
            phone = rel.rsplit("/", 1)[-1].startswith(("phone-", "sign-in", "terms"))
            dpi = 200 if rel.startswith("diagrams/") else (150 if phone else 140)
            width_px = min(int(w * 96 / dpi), 300 if phone else 605)  # 605 px = 16 cm text width
            mime = "jpeg" if rel.endswith((".jpg", ".jpeg")) else "png"
            data = base64.b64encode(p.read_bytes()).decode()
            return f'src="data:image/{mime};base64,{data}" width="{width_px}"'

        body = re.sub(r'src="((?:diagrams|images/screens)/[\w.-]+\.(?:svg|png|jpg))"', embed, body)
        body = re.sub(r'<(h[1-4]) id="([^"]+)"([^>]*)>', r'<\1\3><a name="\2"></a>', body)
        body = re.sub(r'<(p|figure) ([^>]*)id="([^"]+)"([^>]*)>', r'<\1 \2\4><a name="\3"></a>', body)
        body = re.sub(r'<nav class="toc" id="toc-list">.*?</nav>', '<p class="toc-placeholder">[[TOC]]</p>', body, flags=re.S)
        # Lists of figures and tables: one linked paragraph per entry (no page numbers in Word).
        body = re.sub(r'<nav class="(lof|lot)"><ul>(.*?)</ul></nav>',
                      lambda m: re.sub(r'<li><a href="([^"]+)">(.*?)</a><span[^>]*>[^<]*</span></li>',
                                       r'<p class="list-entry"><a href="\1">\2</a></p>', m.group(2)), body, flags=re.S)
        body = body.replace('<table class="data">', '<table class="data" border="1" cellpadding="4" cellspacing="0" width="100%">')
        body = re.sub(r"<th>", '<th bgcolor="#fef3c7">', body)
    page = (f'<!doctype html><html lang="en-GB"><head><meta charset="utf-8">'
            f'<title>{html.escape(meta.get("title", ""))}</title><style>{css}</style></head>'
            f'<body class="{flavour}">{"" if flavour == "pdf" else cover_html(meta, flavour)}\n{body}</body></html>')
    if flavour == "pdf":
        cover = (f'<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>{css}'
                 f'@page {{ margin: 0; }}</style></head><body class="pdf">{cover_html(meta, "pdf")}</body></html>')
        (path.parent / "cover.html").write_text(cover, encoding="utf-8")
    path.write_text(page, encoding="utf-8")


def header_footer(meta):
    small = "font-family: Arial, 'Liberation Sans', sans-serif; font-size: 7.5pt; color: #475569; width: 100%; margin: 0 25.4mm;"
    header = (f'<div style="{small} display:flex; justify-content:space-between; border-bottom: 0.5px solid #cbd5e1; padding-bottom: 1.5mm;">'
              f'<span>{html.escape(meta.get("short_title", ""))}</span>'
              f'<span>Version {html.escape(meta.get("version", ""))} · {html.escape(meta.get("status", ""))}</span></div>')
    footer = (f'<div style="{small} display:flex; justify-content:space-between; border-top: 0.5px solid #cbd5e1; padding-top: 1.5mm;">'
              f'<span>{html.escape(meta.get("classification", ""))}</span>'
              f'<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>')
    (BUILD / "header.html").write_text(header, encoding="utf-8")
    (BUILD / "footer.html").write_text(footer, encoding="utf-8")


def print_pdf(html_path, pdf_path, plain=False):
    hf = ["none", "none"] if plain else [str(BUILD / "header.html"), str(BUILD / "footer.html")]
    subprocess.run(["node", str(TOOLS / "chrome-cdp.mjs"), "pdf", str(html_path), str(pdf_path), *hf], check=True)


def assemble(cover_pdf, body_pdf, out_pdf, meta):
    """Unnumbered cover + body (page 1 = first page after the cover), with matching page labels."""
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    w.append(PdfReader(str(cover_pdf)), import_outline=False)
    body = PdfReader(str(body_pdf))
    w.append(body)
    w.set_page_label(0, 0, prefix="Cover")
    w.set_page_label(1, len(w.pages) - 1, style="/D", start=1)
    w.add_metadata({"/Title": meta.get("title", ""), "/Subject": meta.get("software", ""),
                    "/Author": meta.get("author", ""), "/Keywords": f"ISMS; KayKay's; {meta.get('doc_id', '')}"})
    w.page_mode = "/UseOutlines"
    w.write(str(out_pdf))


def page_map(pdf_path, doc):
    """Find the page of every heading, figure and table caption in a rendered PDF."""
    from pypdf import PdfReader
    reader = PdfReader(str(pdf_path))
    pages = {}
    # Headings: from the outline Chrome generates.
    titles = {}
    def walk(items):
        for it in items:
            if isinstance(it, list):
                walk(it)
            else:
                titles.setdefault(re.sub(r"\s+", "", it.title), reader.get_destination_page_number(it) + 1)
    walk(reader.outline)
    for level, hid, number, title, kind in doc.headings:
        key = re.sub(r"\s+", "", title)
        if key in titles:
            pages[hid] = titles[key]
    # Captions: search page text after the front matter.
    first_body = pages.get("part-1", 1)
    texts = [(i + 1, (p.extract_text() or "")) for i, p in enumerate(reader.pages)]
    for kind, items in (("Figure", doc.figures), ("Table", doc.tables)):
        for cid, num, _ in items:
            pat = re.compile(rf"(^|\n)\s*{kind} {re.escape(num)}:")
            for no, t in texts:
                if no >= first_body - 1 and pat.search(t):
                    pages[cid] = no
                    break
    return pages, len(reader.pages)


def inject_pages(html_path, pages):
    text = html_path.read_text(encoding="utf-8")
    text = re.sub(r'<span class="pg" data-for="([^"]+)">[^<]*</span>',
                  lambda m: f'<span class="pg" data-for="{m.group(1)}">{pages.get(m.group(1), "")}</span>', text)
    html_path.write_text(text, encoding="utf-8")


def build_one(key, args):
    global SRC, BUILD, PDF_OUT, DOCX_OUT, errors, warnings
    folder, doc_id = DOCS_SET[key]
    SRC = DOCS / folder / f"{doc_id}.md"
    BUILD = DOCS / "build" / key
    PDF_OUT = DOCS / folder / f"{doc_id}.pdf"
    DOCX_OUT = DOCS / folder / f"{doc_id}.docx"
    errors, warnings = [], []
    print(f"== {doc_id}")
    meta, md_text = front_matter(SRC.read_text(encoding="utf-8"))
    BUILD.mkdir(parents=True, exist_ok=True)
    body, doc, nlinks = render_body(md_text)
    print(f"Checked: {len(doc.headings)} headings, {len(doc.figures)} figures, {len(doc.tables)} tables, {nlinks} internal links")
    for w in warnings:
        print("  warning:", w)
    if errors:
        for e in errors:
            print("  ERROR:", e)
        return False
    (BUILD / "outline.json").write_text(json.dumps({"headings": doc.headings, "figures": doc.figures, "tables": doc.tables}, indent=1))
    if args.check:
        return True
    for sub in ("diagrams", "images"):
        target = BUILD / sub
        if target.is_symlink() or target.exists():
            target.unlink() if target.is_symlink() else shutil.rmtree(target)
        target.symlink_to(DOCS / sub)
    if not args.no_pdf:
        header_footer(meta)
        pdf_html = BUILD / "doc-pdf.html"
        write_html(body, meta, pdf_html, "pdf")
        print_pdf(BUILD / "cover.html", BUILD / "cover.pdf", plain=True)
        body_pdf = BUILD / "body.pdf"
        print_pdf(pdf_html, body_pdf)
        pages, total = page_map(body_pdf, doc)
        for attempt in range(3):
            inject_pages(pdf_html, pages)
            print_pdf(pdf_html, body_pdf)
            new_pages, total = page_map(body_pdf, doc)
            if new_pages == pages:
                break
            pages = new_pages
        missing = [h for _, h, _, _, k in doc.headings if k in ("part", "chapter", "section", "appendix") and h not in pages]
        missing += [i for i, _, _ in doc.figures + doc.tables if i not in pages]
        if missing:
            print(f"  warning: no page found for {len(missing)} entries, e.g. {missing[:5]}")
        PDF_OUT.parent.mkdir(exist_ok=True)
        assemble(BUILD / "cover.pdf", body_pdf, PDF_OUT, meta)
        print(f"  {PDF_OUT.relative_to(ROOT)}: cover + {total} numbered pages")
    if not args.no_docx:
        docx_html = BUILD / "doc-docx.html"
        write_html(body, meta, docx_html, "docx")
        subprocess.run(["/usr/bin/python3", str(TOOLS / "make_docx.py"), str(docx_html), str(DOCX_OUT), json.dumps(meta)], check=True)
        print(f"  {DOCX_OUT.relative_to(ROOT)}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("docs", nargs="*", default=["all"])
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-docx", action="store_true")
    ap.add_argument("--no-pdf", action="store_true")
    args = ap.parse_args()
    keys = list(DOCS_SET) if "all" in args.docs else args.docs
    if not args.check:
        print("Diagrams")
        build_diagrams()
    ok = all([build_one(k, args) for k in keys])
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

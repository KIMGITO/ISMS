#!/usr/bin/env python3
"""Convert the DOCX-flavoured HTML into a Word document with LibreOffice (UNO).

    python3 make_docx.py input.html output.docx '<metadata json>'

Applies A4 with 2.54 cm margins, Arial body text, heading and caption styles, a header and
a "Page X of Y" footer, an automatic table of contents (hyperlinked, with page numbers),
repeating table header rows, rows that do not split across pages, and embedded images.
Run with the system python3 that has the LibreOffice "uno" module.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.connection import NoConnectException

MM = 100  # UNO lengths are 1/100 mm


def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p


def connect():
    profile = tempfile.mkdtemp(prefix="lo-docs-")
    port = 2002 + os.getpid() % 500
    proc = subprocess.Popen([
        "soffice", "--headless", "--invisible", "--nologo", "--norestore",
        f"-env:UserInstallation=file://{profile}",
        f"--accept=socket,host=127.0.0.1,port={port};urp;",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    for _ in range(120):
        try:
            ctx = resolver.resolve(f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext")
            return proc, ctx
        except NoConnectException:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit("LibreOffice did not start")


def style(doc, family, name):
    fam = doc.StyleFamilies.getByName(family)
    if fam.hasByName(name):
        return fam.getByName(name)
    s = doc.createInstance("com.sun.star.style.ParagraphStyle" if family == "ParagraphStyles" else "com.sun.star.style.CharacterStyle")
    fam.insertByName(name, s)
    return s


def set_para(s, size=None, bold=None, italic=None, before=None, after=None, keep=None, font="Arial", color=None, line=None):
    s.CharFontName = font
    s.CharFontNameAsian = font
    s.CharFontNameComplex = font
    if size: s.CharHeight = size
    if bold is not None: s.CharWeight = 150.0 if bold else 100.0
    if italic is not None: s.CharPosture = 2 if italic else 0
    if before is not None: s.ParaTopMargin = int(before * 35.28)
    if after is not None: s.ParaBottomMargin = int(after * 35.28)
    if keep is not None: s.ParaKeepTogether = keep; s.ParaSplit = not keep
    if color is not None: s.CharColor = color
    if line:
        ls = uno.createUnoStruct("com.sun.star.style.LineSpacing")
        ls.Mode, ls.Height = 0, line
        s.ParaLineSpacing = ls


def main():
    src, dst, meta = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    proc, ctx = connect()
    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        url = uno.systemPathToFileUrl(str(pathlib.Path(src).resolve()))
        doc = desktop.loadComponentFromURL(url, "_blank", 0, (prop("Hidden", True), prop("FilterName", "HTML (StarWriter)")))
        text = doc.Text

        # ---- page styles
        pages = doc.StyleFamilies.getByName("PageStyles")
        for name in ("Standard", "HTML", "Default Page Style", "First Page"):
            if not pages.hasByName(name):
                continue
            ps = pages.getByName(name)
            ps.Width, ps.Height = 210 * MM, 297 * MM
            ps.LeftMargin = ps.RightMargin = ps.TopMargin = ps.BottomMargin = 2540
            if name == "First Page":
                ps.HeaderIsOn = ps.FooterIsOn = False
                continue
            ps.HeaderIsOn = ps.FooterIsOn = True
            ps.HeaderBodyDistance = ps.FooterBodyDistance = 4 * MM
            for part, left, right in (
                (ps.HeaderText, meta.get("short_title", ""), f"Version {meta.get('version', '')} · {meta.get('status', '')}"),
                (ps.FooterText, meta.get("classification", ""), None),
            ):
                part.setString("")
                cur = part.createTextCursor()
                cur.CharFontName, cur.CharHeight, cur.CharColor = "Arial", 8, 0x475569
                tabs = uno.createUnoStruct("com.sun.star.style.TabStop")
                tabs.Position, tabs.Alignment = 160 * MM, uno.Enum("com.sun.star.style.TabAlign", "RIGHT")
                cur.ParaTabStops = (tabs,)
                part.insertString(cur, left + "\t", False)
                if right is not None:
                    part.insertString(cur, right, False)
                else:
                    part.insertString(cur, "Page ", False)
                    f = doc.createInstance("com.sun.star.text.TextField.PageNumber")
                    f.NumberingType, f.SubType = 4, uno.Enum("com.sun.star.text.PageNumberType", "CURRENT")
                    part.insertTextContent(cur, f, False)
                    part.insertString(cur, " of ", False)
                    c = doc.createInstance("com.sun.star.text.TextField.PageCount")
                    c.NumberingType = 4
                    part.insertTextContent(cur, c, False)

        # ---- paragraph styles
        body_names = ["Standard", "Default Paragraph Style", "Text body", "Body Text", "Table Contents", "List", "List Contents"]
        for n in body_names:
            fam = doc.StyleFamilies.getByName("ParagraphStyles")
            if fam.hasByName(n):
                set_para(fam.getByName(n), size=11, after=6, line=115, color=0x1E293B)
        for n in ("Table Contents", "Table Heading"):
            fam = doc.StyleFamilies.getByName("ParagraphStyles")
            if fam.hasByName(n):
                set_para(fam.getByName(n), size=9, after=0, before=0, line=110)
        heads = {"Heading 1": (17, 0, 8), "Heading 2": (13.5, 12, 6), "Heading 3": (11.5, 10, 4), "Heading 4": (11, 8, 3)}
        for n, (size, before, after) in heads.items():
            s = style(doc, "ParagraphStyles", n)
            set_para(s, size=size, bold=True, before=before, after=after, color=0x0F172A, italic=(n == "Heading 4"))
            s.ParaKeepTogether = True  # keep with next paragraph
        h1 = style(doc, "ParagraphStyles", "Heading 1")
        h1.BreakType = uno.Enum("com.sun.star.style.BreakType", "PAGE_BEFORE")
        ch = style(doc, "ParagraphStyles", "Contents Heading")
        set_para(ch, size=17, bold=True, before=0, after=8, color=0x0F172A)
        cap = style(doc, "ParagraphStyles", "Caption")
        set_para(cap, size=9.5, bold=True, italic=False, before=6, after=3, color=0x334155)
        cap.ParaKeepTogether = True
        pre = style(doc, "ParagraphStyles", "Preformatted Text")
        set_para(pre, size=8.5, font="Liberation Mono", after=0, line=100)
        cs = doc.StyleFamilies.getByName("CharacterStyles")
        for n in ("Source Text", "Teletype"):
            if cs.hasByName(n):
                cs.getByName(n).CharFontName = "Liberation Mono"
                cs.getByName(n).CharHeight = 9

        # ---- walk paragraphs: captions, cover page style, TOC placeholder, static TOC removal
        enum = text.createEnumeration()
        toc_anchor = None
        static_toc = []
        first = True
        while enum.hasMoreElements():
            par = enum.nextElement()
            if not par.supportsService("com.sun.star.text.Paragraph"):
                continue
            if first:
                par.PageDescName = "First Page"
                first = False
            s = par.getString()
            if s.startswith("[[TOC]]"):
                toc_anchor = par
            elif s.strip() == "Table of Contents" and par.ParaStyleName.startswith("Heading 1"):
                # Keep the page break and look of a chapter heading, but leave it out of the outline.
                par.ParaStyleName = "Contents Heading"
                par.BreakType = uno.Enum("com.sun.star.style.BreakType", "PAGE_BEFORE")
            elif (s.startswith("Figure ") or s.startswith("Table ")) and ":" in s[:14] and par.ParaStyleName not in ("Heading 1", "Heading 2", "Heading 3"):
                head = s.split(":", 1)[0].split(" ", 1)[1]
                if head.replace(".", "").isalnum() and "." in head:
                    par.ParaStyleName = "Caption"
                    par.ParaAdjust = 3 if s.startswith("Figure") else 0  # centre figure captions
        # The body after the cover starts a normal page.
        # ---- tables
        tables = doc.TextTables
        for i in range(tables.Count):
            t = tables.getByIndex(i)
            try:
                t.RepeatHeadline = True
                t.HeaderRowCount = 1
                t.Split = True
                t.HoriOrient = 0  # NONE -> full width
                t.LeftMargin = 0
                t.RightMargin = 0
                rows = t.Rows
                for r in range(rows.Count):
                    rows.getByIndex(r).IsSplitAllowed = False
            except Exception:
                pass
        # ---- images: embed linked graphics and keep them inside the margins
        gp = smgr.createInstanceWithContext("com.sun.star.graphic.GraphicProvider", ctx)
        graphics = doc.GraphicObjects
        max_w = 160 * MM
        for i in range(graphics.Count):
            g = graphics.getByIndex(i)
            try:
                link = g.GraphicURL if hasattr(g, "GraphicURL") else ""
            except Exception:
                link = ""
            try:
                if g.Graphic is None or not g.Graphic:
                    pass
                size = g.Size
                if size.Width > max_w:
                    ratio = max_w / size.Width
                    size.Width, size.Height = int(size.Width * ratio), int(size.Height * ratio)
                    g.Size = size
                max_h = 190 * MM
                if g.Size.Height > max_h:
                    ratio = max_h / g.Size.Height
                    sz = g.Size
                    sz.Width, sz.Height = int(sz.Width * ratio), int(sz.Height * ratio)
                    g.Size = sz
                g.HoriOrient = 2  # CENTER
            except Exception as e:
                print("  image:", e)
        # ---- automatic table of contents in place of the placeholder
        if toc_anchor is not None:
            cur = text.createTextCursorByRange(toc_anchor)
            cur.gotoStartOfParagraph(False)
            cur.gotoEndOfParagraph(True)
            cur.setString("")
            index = doc.createInstance("com.sun.star.text.ContentIndex")
            index.CreateFromOutline = True
            index.Level = 2
            index.Title = ""
            text.insertTextContent(cur, index, False)
            # Remove the static HTML table of contents that follows (its links remain valid in the PDF).
        doc.refresh()
        idxs = doc.DocumentIndexes
        for i in range(idxs.Count):
            idxs.getByIndex(i).update()
        # Remove static TOC paragraphs (they are a bulleted list right after the index).
        dispatcher = smgr.createInstanceWithContext("com.sun.star.frame.DispatchHelper", ctx)

        props = doc.DocumentProperties
        props.Title = meta.get("title", "")
        props.Subject = meta.get("software", "")
        props.Author = meta.get("author", "")
        props.Description = meta.get("description", "")

        doc.storeToURL(uno.systemPathToFileUrl(str(pathlib.Path(dst).resolve())),
                       (prop("FilterName", "MS Word 2007 XML"), prop("Overwrite", True)))
        doc.close(True)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()

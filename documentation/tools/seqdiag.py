#!/usr/bin/env python3
"""Render a small sequence-diagram text format to SVG.

    python3 seqdiag.py input.seq output.svg

Format (one statement per line, '#' starts a comment):
    participant ID "Label shown at the top"
    A -> B: message          solid arrow (call or request)
    A --> B: message         dashed arrow (reply or asynchronous callback)
    A -> A: message          self call
    note ID: text            note box on a lifeline
    note ID,ID2: text        note spanning two lifelines
    divider: text            labelled horizontal divider
Use '\\n' inside a message or label for a line break.
"""
import html
import re
import sys

FONT = "Arial, Helvetica, sans-serif"
COL_W = 150          # distance between lifelines
TOP = 20
HEAD_H = 40
ROW = 30             # vertical step per single-line message
LINE_H = 12


def parse(text):
    parts, steps = [], []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip() if not raw.strip().startswith('participant') else raw.rstrip()
        if not line.strip():
            continue
        m = re.match(r'\s*participant\s+(\w+)\s+"(.*)"', line)
        if m:
            parts.append((m.group(1), m.group(2).replace("\\n", "\n")))
            continue
        m = re.match(r"\s*note\s+([\w,]+)\s*:\s*(.*)", line)
        if m:
            steps.append(("note", m.group(1).split(","), m.group(2).replace("\\n", "\n")))
            continue
        m = re.match(r"\s*divider\s*:\s*(.*)", line)
        if m:
            steps.append(("divider", None, m.group(1)))
            continue
        m = re.match(r"\s*(\w+)\s*(-->|->)\s*(\w+)\s*:\s*(.*)", line)
        if m:
            steps.append(("msg", (m.group(1), m.group(3), m.group(2) == "-->"), m.group(4).replace("\\n", "\n")))
            continue
        raise SystemExit(f"cannot parse: {raw}")
    return parts, steps


def text_block(x, y, s, size=10, anchor="middle", weight="normal", fill="#0f172a"):
    out = []
    for i, ln in enumerate(s.split("\n")):
        out.append(
            f'<text x="{x:.1f}" y="{y + i * LINE_H:.1f}" font-family="{FONT}" font-size="{size}" '
            f'text-anchor="{anchor}" font-weight="{weight}" fill="{fill}">{html.escape(ln)}</text>'
        )
    return "\n".join(out)


def render(parts, steps):
    idx = {p: i for i, (p, _) in enumerate(parts)}
    xs = [60 + i * COL_W + COL_W / 2 - 60 for i in range(len(parts))]
    xs = [70 + i * COL_W for i in range(len(parts))]
    width = xs[-1] + 80
    body, y = [], TOP + HEAD_H + 25
    for kind, who, label in steps:
        lines = label.count("\n") + 1
        if kind == "msg":
            a, b, dashed = who
            xa, xb = xs[idx[a]], xs[idx[b]]
            dash = ' stroke-dasharray="5,3"' if dashed else ""
            ty = y + (lines - 1) * LINE_H
            if a == b:
                body.append(text_block(xa + 8, y, label, 9, "start"))
                body.append(f'<path d="M{xa},{ty + 4} h28 v14 h-28" fill="none" stroke="#475569"{dash} marker-end="url(#arr)"/>')
                y = ty + 30
            else:
                mid = (xa + xb) / 2
                body.append(text_block(mid, y, label, 9))
                body.append(f'<line x1="{xa}" y1="{ty + 6}" x2="{xb}" y2="{ty + 6}" stroke="#475569" stroke-width="1.1"{dash} marker-end="url(#arr)"/>')
                y = ty + ROW
        elif kind == "note":
            cols = [xs[idx[w]] for w in who]
            x0 = min(cols) - 62
            x1 = max(cols) + 62
            h = lines * LINE_H + 10
            body.append(f'<rect x="{x0}" y="{y - 10}" width="{x1 - x0}" height="{h}" rx="3" fill="#fef3c7" stroke="#b45309" stroke-width="0.8"/>')
            body.append(text_block((x0 + x1) / 2, y + 2, label, 8.5, fill="#7c2d12"))
            y += h + 12
        elif kind == "divider":
            body.append(f'<line x1="10" y1="{y}" x2="{width - 10}" y2="{y}" stroke="#94a3b8" stroke-dasharray="2,3"/>')
            body.append(f'<rect x="{width / 2 - 110}" y="{y - 9}" width="220" height="16" fill="white"/>')
            body.append(text_block(width / 2, y + 3, label, 8.5, weight="bold", fill="#334155"))
            y += 22
    height = y + 20
    heads = []
    for (pid, label), x in zip(parts, xs):
        heads.append(f'<line x1="{x}" y1="{TOP + HEAD_H}" x2="{x}" y2="{height - 10}" stroke="#cbd5e1" stroke-dasharray="4,3"/>')
        heads.append(f'<rect x="{x - 66}" y="{TOP}" width="132" height="{HEAD_H}" rx="6" fill="#f8fafc" stroke="#475569"/>')
        n = label.count("\n") + 1
        heads.append(text_block(x, TOP + HEAD_H / 2 + 4 - (n - 1) * LINE_H / 2, label, 9.5, weight="bold"))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}">\n'
        '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">'
        '<path d="M0,0 L7,3 L0,6 z" fill="#475569"/></marker></defs>\n'
        f'<rect width="100%" height="100%" fill="white"/>\n' + "\n".join(heads) + "\n" + "\n".join(body) + "\n</svg>\n"
    )


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        p, s = parse(f.read())
    with open(dst, "w", encoding="utf-8") as f:
        f.write(render(p, s))

#!/usr/bin/env python3
"""Generate the database reference (Appendix D) and the entity relationship diagrams
from a schema snapshot taken from a database built with every migration.

    python3 documentation/tools/generate_db_reference.py

Reads   documentation/supporting-references/schema.json   (see README.md: "Regenerating
        the database reference" for how the snapshot is produced)
Writes  the block between the GENERATED DATABASE REFERENCE markers in
        documentation/master-software-documentation.md, and
        documentation/diagrams/src/erd-*.dot
"""
import json
import pathlib
import re
import sys

DOCS = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = DOCS / "supporting-references" / "schema.json"
MASTER = DOCS / "master-software-documentation.md"
BEGIN = "<!-- BEGIN GENERATED DATABASE REFERENCE -->"
END = "<!-- END GENERATED DATABASE REFERENCE -->"

# Functional areas, in the order used by Chapter 5 and Appendix D. Every table must appear once.
AREAS = [
    ("identity", "Identity, tenancy and access control", [
        "businesses", "branches", "users", "employees", "business_memberships", "invitations",
        "role_permissions", "role_default_permissions", "otps", "rate_limits"]),
    ("stock", "Products, stock and production", [
        "products", "product_categories", "inventory_adjustments", "suppliers", "purchases",
        "purchase_items", "recipes", "recipe_ingredients", "bill_of_materials", "bom_ingredients",
        "production_batches", "business_assets"]),
    ("sales", "Sales, receipts and tax", [
        "transactions", "transaction_items", "offline_sync_queue", "receipt_verifications",
        "receipt_settings", "printer_settings", "kra_etims_settings", "kra_etims_secrets",
        "kra_etims_items", "kra_etims_receipts"]),
    ("customers", "Customers, loyalty, wallets, debts and invoices", [
        "customers", "customer_ledger", "wallet_transactions", "debt_payments", "credit_payments",
        "loyalty_settings", "loyalty_redemptions", "loyalty_points_earned", "customer_merges",
        "customer_duplicate_dismissals", "invoices", "invoice_counters"]),
    ("money", "Money, payments, expenses and M-Pesa", [
        "payments", "money_assets", "payment_asset_ledger", "expenses", "expense_categories",
        "mpesa_settings", "mpesa_transactions", "mpesa_till_payments"]),
    ("online", "Online store and customer portal", [
        "customer_accounts", "online_orders", "online_order_items", "customer_order_schedules",
        "customer_messages", "delivery_zones", "website_settings", "website_articles",
        "assistant_usage", "complaints", "complaint_replies"]),
    ("staffops", "Staff operations", ["shifts", "schedules"]),
    ("notify", "Notifications and messaging", [
        "notifications", "notification_preferences", "device_fcm_tokens", "sms_settings",
        "whatsapp_settings"]),
    ("system", "Settings, AI, analytics, logs and backups", [
        "ai_settings", "ai_insights", "integration_configurations", "audit_logs",
        "dashboard_analytics_snapshots", "scheduled_reports", "report_tracked_items",
        "crash_reports", "google_sheets_backup", "backup_history_logs", "storage_files",
        "app_data_conversions"]),
]

# ERDs: which areas go in which diagram (Figure numbers are set in the master document).
ERDS = {
    "erd-identity-staff": ["identity", "staffops", "notify"],
    "erd-stock": ["stock"],
    "erd-sales-customers": ["sales", "customers"],
    "erd-money-online": ["money", "online"],
}

CMD = {"r": "SELECT", "a": "INSERT", "w": "UPDATE", "d": "DELETE", "*": "ALL"}


def md(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def fk_map(table):
    out = {}
    for c in table["constraints"] or []:
        if c["type"] == "f":
            m = re.match(r"FOREIGN KEY \((.*?)\) REFERENCES ([\w.]+)\((.*?)\)(.*)", c["def"])
            cols = [x.strip() for x in m.group(1).split(",")]
            target = m.group(2).replace("public.", "")
            action = re.search(r"ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION|SET DEFAULT)", m.group(4))
            for col in cols:
                out[col] = (target, m.group(3), action.group(1) if action else "NO ACTION")
    return out


def pk_cols(table):
    for c in table["constraints"] or []:
        if c["type"] == "p":
            return [x.strip() for x in re.match(r"PRIMARY KEY \((.*)\)", c["def"]).group(1).split(",")]
    return []


def unique_sets(table):
    sets = []
    for c in table["constraints"] or []:
        if c["type"] == "u":
            sets.append(re.match(r"UNIQUE (?:NULLS NOT DISTINCT )?\((.*)\)", c["def"]).group(1))
    return sets


def short_default(d):
    if d is None:
        return ""
    d = re.sub(r"::[\w\s\[\]\"]+", "", d)
    return d if len(d) <= 32 else d[:29] + "..."


def table_section(t, num):
    name = t["name"]
    pks, fks = pk_cols(t), fk_map(t)
    lines = [f"### {num} `{name}`", ""]
    meta = [f"Row-level security: {'enabled' if t['rls'] else '**disabled**'}"]
    if t.get("realtime"):
        meta.append("published to Realtime")
    lines += ["; ".join(meta) + ".", ""]
    lines += ["| Column | Type | Null | Default | Key |", "|---|---|---|---|---|"]
    for c in t["columns"]:
        key = []
        if c["name"] in pks:
            key.append("PK")
        if c["name"] in fks:
            tgt, col, act = fks[c["name"]]
            key.append(f"FK → `{tgt}`" + ("" if col == "id" else f".{col}") + f" ({act.lower()})")
        lines.append(
            f"| `{c['name']}` | {md(c['type'])} | {'no' if c['notnull'] else 'yes'} | "
            f"{md(short_default(c['default']))} | {'; '.join(key)} |"
        )
    lines.append("")
    extra = []
    uniq = unique_sets(t)
    if uniq:
        extra.append("**Unique:** " + "; ".join(f"({md(u)})" for u in uniq) + ".")
    checks = [c for c in t["constraints"] or [] if c["type"] == "c"]
    if checks:
        extra.append("**Checks:** " + "; ".join(f"`{md(c['def'][6:].strip('()') if c['def'].startswith('CHECK') else c['def'])}`" for c in checks) + ".")
    idx = [i for i in t["indexes"] or [] if not any(i["name"].endswith(s) for s in ("_key",))]
    if idx:
        extra.append("**Indexes:** " + "; ".join(
            f"`{i['name']}`" + (" (unique)" if " UNIQUE " in i["def"] else "") +
            (f" on ({md(re.search(r'USING \w+ \((.*)\)', i['def']).group(1))})" if re.search(r'USING \w+ \((.*)\)', i['def']) else "") +
            (" where " + md(i["def"].split(" WHERE ", 1)[1]) if " WHERE " in i["def"] else "")
            for i in idx) + ".")
    if t["triggers"]:
        trig = []
        for tg in t["triggers"]:
            m = re.search(r"(BEFORE|AFTER) (.*?) ON .*?EXECUTE FUNCTION (?:public\.)?(\w+)", tg["def"])
            trig.append(f"`{tg['name']}` ({m.group(1).lower()} {m.group(2).lower()} → `{m.group(3)}`)")
        extra.append("**Triggers:** " + "; ".join(trig) + ".")
    if t["policies"]:
        pol = []
        for p in t["policies"]:
            roles = ",".join(r for r in (p["roles"] or []) if r) or "public"
            pol.append(f"`{p['name']}` ({CMD.get(p['cmd'], p['cmd'])}, {roles})")
        extra.append("**Policies:** " + "; ".join(pol) + ".")
    else:
        extra.append("**Policies:** none (no client role can read or write the table directly).")
    for e in extra:
        lines += [e, ""]
    return lines


def erd(name, area_keys, tables_by_name, area_of):
    inside = [n for k in area_keys for (key, _, tabs) in AREAS if key == k for n in tabs]
    out = [
        f"// Generated by tools/generate_db_reference.py from supporting-references/schema.json. Do not edit.",
        f"digraph {name.replace('-', '_')} {{",
        '  graph [rankdir=LR, fontname="Arial", nodesep=0.25, ranksep=0.7, pad=0.2, splines=true, overlap=false];',
        '  node  [shape=plaintext, fontname="Arial", fontsize=8.5];',
        '  edge  [color="#64748b", arrowsize=0.6, arrowhead=crow, arrowtail=tee, dir=both, fontname="Arial", fontsize=7];',
    ]
    external = set()
    edges = []
    for n in inside:
        t = tables_by_name[n]
        pks, fks = pk_cols(t), fk_map(t)
        for col, (tgt, _, _) in fks.items():
            if tgt == "businesses":
                continue
            edges.append((n, col, tgt))
            if tgt not in inside:
                external.add(tgt)
    for n in inside:
        t = tables_by_name[n]
        pks, fks = pk_cols(t), fk_map(t)
        rows = []
        for c in t["columns"]:
            if c["name"] in pks or (c["name"] in fks and fks[c["name"]][0] != "businesses"):
                tag = "PK" if c["name"] in pks else "FK"
                rows.append(f'<tr><td align="left" port="{c["name"]}"><font color="#7c2d12">{tag}</font> {c["name"]}</td></tr>')
        other = len(t["columns"]) - len(rows)
        if other > 0:
            rows.append(f'<tr><td align="left"><font color="#64748b">+ {other} more columns</font></td></tr>')
        out.append(
            f'  {n} [label=<<table border="1" cellborder="0" cellspacing="0" cellpadding="3" color="#475569" bgcolor="#f8fafc">'
            f'<tr><td bgcolor="#fef3c7"><b>{n}</b></td></tr>{"".join(rows)}</table>>];'
        )
    for n in sorted(external):
        out.append(
            f'  {n.replace(".", "_")} [label=<<table border="1" cellborder="0" cellspacing="0" cellpadding="3" color="#94a3b8" bgcolor="#f1f5f9">'
            f'<tr><td><font color="#475569">{n}</font></td></tr><tr><td><font color="#64748b">(see {area_of.get(n, "Supabase Auth")})</font></td></tr></table>>];'
        )
    for src, col, tgt in edges:
        out.append(f'  {tgt.replace(".", "_")} -> {src}:{col};')
    out.append("}")
    return "\n".join(out) + "\n"


def main():
    d = json.loads(SCHEMA.read_text())
    tables = {t["name"]: t for t in d["tables"]}
    for n in d.get("publication") or []:
        if n in tables:
            tables[n]["realtime"] = True
    mapped = [n for _, _, tabs in AREAS for n in tabs]
    missing = sorted(set(tables) - set(mapped))
    unknown = sorted(set(mapped) - set(tables))
    dupes = sorted({n for n in mapped if mapped.count(n) > 1})
    if missing or unknown or dupes:
        sys.exit(f"Area map out of date. Unmapped: {missing}; not in schema: {unknown}; listed twice: {dupes}")
    area_of = {n: title for _, title, tabs in AREAS for n in tabs}

    L = [BEGIN, "",
         f"This appendix was generated from a database built from all {d.get('migration_count', 'repository')} "
         "migrations at the commit given in the document control table. Do not edit it by hand; "
         "regenerate it as described in [Section 21.2](#s-21-2). The `business_id` foreign key that links "
         "most tables to `businesses` (cascade on delete) is listed in each table but omitted from the diagrams.", ""]
    L += ["## D.1 Summary", "",
          "| Object | Count |", "|---|---|",
          f"| Tables (schema `public`) | {len(d['tables'])} |",
          f"| Tables with row-level security enabled | {sum(1 for t in d['tables'] if t['rls'])} |",
          f"| Views | {len(d['views'] or [])} |",
          f"| Enumerated types | {len(d['enums'])} |",
          f"| Functions in schema `public` written for ISMS (excluding {sum(1 for f in d['functions'] if f.get('extension'))} extension functions) | {sum(1 for f in d['functions'] if not f.get('extension'))} |",
          f"| of which trigger functions | {sum(1 for f in d['functions'] if not f.get('extension') and f['returns'] == 'trigger')} |",
          f"| of which `SECURITY DEFINER` | {sum(1 for f in d['functions'] if not f.get('extension') and f['secdef'])} |",
          f"| Triggers | {sum(len(t['triggers'] or []) for t in d['tables'])} |",
          f"| Row-level security policies | {sum(len(t['policies'] or []) for t in d['tables'])} |",
          f"| Tables published to Realtime | {len(d.get('publication') or [])} |",
          f"| Scheduled jobs (`pg_cron`) | {len(d.get('cron') or [])} |",
          f"| Storage buckets | {len(d.get('buckets') or [])} |", ""]
    L += ["## D.2 Enumerated types", "", "| Type | Values |", "|---|---|"]
    for e in d["enums"]:
        L.append(f"| `{e['name']}` | {', '.join(e['values'])} |")
    L += ["", "## D.3 Views", "", ", ".join(f"`{v['name']}`" for v in d["views"] or []) + ".", ""]
    L += ["## D.4 Scheduled jobs", "", "| Job | Schedule (cron, UTC) | Command |", "|---|---|---|"]
    for c in d.get("cron") or []:
        L.append(f"| `{c['name']}` | `{c['schedule']}` | `{md(c['command'])}` |")
    L += ["", "## D.5 Storage buckets", "", "| Bucket | Public |", "|---|---|"]
    for b in d.get("buckets") or []:
        L.append(f"| `{b['id']}` | {'yes' if b['public'] else 'no'} |")
    L += ["", "Storage policies: " + ", ".join(f"`{p}`" for p in d.get("storage_policies") or []) + ".", ""]
    L += ["## D.6 Extensions", "", ", ".join(f"`{e}`" for e in d.get("extensions") or []) + ".", ""]

    sec = 7
    for key, title, tabs in AREAS:
        L += [f"## D.{sec} Tables: {title.lower()}", ""]
        for i, n in enumerate(tabs, 1):
            L += table_section(tables[n], f"D.{sec}.{i}")
        sec += 1

    L += [f"## D.{sec} Database functions", "",
          "`Definer` marks `SECURITY DEFINER` functions, which run with the owner's rights after their own "
          "membership and permission checks. `Callable by` lists the roles holding `EXECUTE`; `PUBLIC` "
          "means any role, including `anon`. Trigger functions are listed with the triggers in each table.", "",
          "| Function | Returns | Definer | Callable by |", "|---|---|---|---|"]
    for f in d["functions"]:
        if f["returns"] == "trigger" or f.get("extension"):
            continue
        grants = "PUBLIC" if f["public_exec"] else ", ".join(sorted(g for g in (f["grants"] or []) if g not in ("postgres", "supabase_admin")))
        args = re.sub(r"\s+", " ", f["args"] or "")
        L.append(f"| `{f['name']}({md(args)})` | {md(f['returns'])} | {'yes' if f['secdef'] else 'no'} | {grants or 'owner only'} |")
    L += ["", END]

    text = MASTER.read_text(encoding="utf-8")
    if BEGIN not in text or END not in text:
        sys.exit("Markers not found in the master document.")
    pre, rest = text.split(BEGIN, 1)
    _, post = rest.split(END, 1)
    MASTER.write_text(pre + "\n".join(L) + post, encoding="utf-8")

    src = DOCS / "diagrams" / "src"
    for name, keys in ERDS.items():
        (src / f"{name}.dot").write_text(erd(name, keys, tables, area_of), encoding="utf-8")
    print(f"Database reference: {len(d['tables'])} tables, {sum(1 for f in d['functions'] if not f.get('extension'))} functions; {len(ERDS)} ERDs written.")


if __name__ == "__main__":
    main()

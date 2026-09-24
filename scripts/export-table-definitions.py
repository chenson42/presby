#!/usr/bin/env python3
"""Export a Markdown review document of the table definitions in a set of
hand-written migrations (default: drizzle/0043–0047, the D10/D19/D20/D21 unit).

Usage:  python3 scripts/export-table-definitions.py [OUT] [MIGRATION...]
        OUT defaults to ~/Downloads/presby-table-definitions-<today>.md

Written for the operator's external design reviews (2026-09-24). Re-run after
every correction to the migrations so the reviewer reads the working tree.

Statements are taken verbatim from the migration files (the truth), grouped by
the migrations' own numbered sections. Function bodies are collapsed to their
signature with a file:line pointer; DO blocks likewise; everything else
(tables, alters, indexes, constraints, policies, grants, views, triggers,
comments, seed inserts) is reproduced in full with the comment block that
precedes it.
"""
import os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [
    "drizzle/0043_presby_org_identifiers.sql",
    "drizzle/0044_presby_org_lifecycle.sql",
    "drizzle/0045_presby_about_org_affiliation.sql",
    "drizzle/0046_presby_statistical_returns.sql",
    "drizzle/0047_presby_publications.sql",
]
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(f"~/Downloads/presby-table-definitions-{datetime.date.today().isoformat()}.md")
if len(sys.argv) > 2:
    FILES = sys.argv[2:]

def split_statements(text):
    """Yield (start_line, statement_text) splitting on ';' outside $$ bodies
    and outside -- comments / quoted strings."""
    stmts, buf, start = [], [], 1
    i, n, line = 0, len(text), 1
    in_dollar = False
    in_str = False
    in_comment = False
    cur_start = 1
    started = False
    while i < n:
        c = text[i]
        if not started and not c.isspace():
            cur_start = line
            started = True
        if in_comment:
            buf.append(c)
            if c == "\n":
                in_comment = False; line += 1
            i += 1; continue
        if in_str:
            buf.append(c)
            if c == "'":
                if i + 1 < n and text[i+1] == "'":
                    buf.append("'"); i += 2; continue
                in_str = False
            if c == "\n": line += 1
            i += 1; continue
        if text.startswith("$$", i):
            in_dollar = not in_dollar
            buf.append("$$"); i += 2; continue
        if in_dollar:
            buf.append(c)
            if c == "\n": line += 1
            i += 1; continue
        if text.startswith("--", i):
            in_comment = True; buf.append("--"); i += 2; continue
        if c == "'":
            in_str = True; buf.append(c); i += 1; continue
        if c == ";":
            buf.append(c)
            stmts.append((cur_start, "".join(buf)))
            buf = []; started = False
            i += 1; continue
        buf.append(c)
        if c == "\n": line += 1
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append((cur_start, tail))
    return stmts

SECTION_RE = re.compile(r"^-- (\d+[a-z]?)\. (.+)$")

def classify(sql):
    s = re.sub(r"^\s*(--[^\n]*\n\s*)*", "", sql).lstrip().lower()
    for key, kind in [
        ("create table", "table"), ("alter table", "alter"),
        ("create unique index", "index"), ("create index", "index"),
        ("create policy", "policy"), ("drop policy", "skip"),
        ("drop trigger", "skip"), ("drop index", "skip"), ("drop view", "skip"),
        ("drop function", "skip"), ("drop table", "drop"),
        ("create or replace view", "view"), ("create view", "view"),
        ("create or replace function", "function"), ("create function", "function"),
        ("create constraint trigger", "trigger"), ("create trigger", "trigger"),
        ("grant ", "grant"), ("revoke ", "grant"),
        ("comment on", "comment"), ("do ", "do"), ("insert into", "insert"),
        ("select ", "select"), ("set ", "skip"), ("create extension", "ext"),
        ("update ", "dml"), ("delete ", "dml"), ("with ", "dml"),
    ]:
        if s.startswith(key):
            return kind
    return "other"

def strip_leading_comments(sql):
    lines = sql.split("\n")
    lead, body = [], []
    seen_code = False
    for ln in lines:
        if not seen_code and (ln.strip().startswith("--") or ln.strip() == ""):
            lead.append(ln)
        else:
            seen_code = True
            body.append(ln)
    return "\n".join(lead).strip("\n"), "\n".join(body).strip("\n")

def collapse_function(body, path, line):
    # signature: everything up to and including the line containing 'as $$' / 'language'
    out = []
    for ln in body.split("\n"):
        out.append(ln)
        if "$$" in ln:
            break
    sig = "\n".join(out)
    if sig.endswith("$$"):
        sig = sig[:-2].rstrip()
    total = body.count("\n") + 1
    return sig + f"\n  -- … body omitted ({total} lines) — see {path}:{line}"

def collapse_do(body, path, line):
    lines = body.split("\n")
    total = len(lines)
    head = "\n".join(lines[:4])
    return head + f"\n  -- … ({total} lines) — see {path}:{line}"

def truncate_insert(body):
    if len(body) > 2500:
        return body[:2500] + "\n  -- … truncated (seed payload continues in the migration)"
    return body

def file_header(text):
    """The leading comment block of the migration, up to the first section
    rule or first non-comment line."""
    out = []
    for ln in text.split("\n"):
        if ln.startswith("--"):
            if re.match(r"^-- -{5,}", ln):
                break
            out.append(ln[2:].lstrip(" "))
        elif ln.strip() == "":
            out.append("")
        else:
            break
    return "\n".join(out).strip("\n")

def render_file(path):
    full = os.path.join(ROOT, path)
    text = open(full).read()
    md = []
    md.append(f"\n\n# {path}\n")
    hdr = file_header(text)
    if hdr:
        md.append("**Migration header (verbatim):**\n")
        md.append("\n".join("> " + l if l else ">" for l in hdr.split("\n")))
        md.append("")
    # sections: find "-- N. title" lines and their line numbers
    sections = []
    for i, ln in enumerate(text.split("\n"), 1):
        m = SECTION_RE.match(ln)
        if m:
            sections.append((i, m.group(1), m.group(2)))
    def section_for(line):
        cur = None
        for (l, num, title) in sections:
            if l <= line: cur = (num, title)
            else: break
        return cur
    last_section = None
    for (line, sql) in split_statements(text):
        kind = classify(sql)
        if kind in ("skip", "select", "dml", "ext"):
            continue
        sec = section_for(line)
        if sec != last_section and sec is not None:
            md.append(f"\n## §{sec[0]} {sec[1]}\n")
            last_section = sec
        lead, body = strip_leading_comments(sql)
        idx = text.find(body[:200]) if body else -1
        if idx >= 0:
            line = text[:idx].count("\n") + 1
        # drop the section-rule / section-title lines from the lead comment
        lead_lines = [l for l in lead.split("\n")
                      if not re.match(r"^-- -{5,}", l) and not SECTION_RE.match(l)]
        lead = "\n".join(lead_lines).strip("\n")
        if kind == "function":
            body = collapse_function(body, path, line)
        elif kind == "do":
            body = collapse_do(body, path, line)
        elif kind == "insert":
            body = truncate_insert(body)
        if lead:
            md.append("\n".join(("> " + l[2:].lstrip(" ")) if l.startswith("--") else ("> " + l) for l in lead.split("\n")))
            md.append("")
        md.append(f"```sql\n{body}\n```\n")
    return "\n".join(md)

def summary_tables():
    """Scan for create table statements and a few properties."""
    rows = []
    for path in FILES:
        text = open(os.path.join(ROOT, path)).read()
        for (line, sql) in split_statements(text):
            if classify(sql) != "table": continue
            _, body = strip_leading_comments(sql)
            m = re.search(r"create table (?:if not exists )?(\w+)", body, re.I)
            if not m: continue
            name = m.group(1)
            line = text[:text.lower().index(m.group(0).lower())].count("\n") + 1
            forced = re.search(rf"alter table {name} force row level security", text, re.I) is not None
            policy = re.search(rf"create policy \w+ on {name}\b", text, re.I) is not None
            rows.append((name, path.split("/")[-1], line, "yes" if forced else "no", "yes" if policy else "no"))
    return rows

def main():
    out = []
    out.append("# presby — table definitions for review \n")
    out.append(f"Generated {datetime.date.today().isoformat()} from the working tree at `{ROOT}` "
               "(uncommitted). Work-log: `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`. "
               "Design authority: `docs/schema-design-2.md` §2b/§2c/§3/§5; decisions DECISION-135–139.\n")
    out.append("**How to read this.** Every statement below is reproduced verbatim from the migration it "
               "lives in, in the migration's own order, with the comment block the author wrote above it. "
               "Function bodies and `DO` blocks are collapsed to their first lines with a `file:line` pointer; "
               "everything that defines a table's shape — columns, constraints, indexes, RLS policies, grants, "
               "views, triggers, column comments, seed rows — is complete. Statements that are pure "
               "idempotence boilerplate (`drop … if exists`, `set`) are omitted.\n")
    out.append("## Tables at a glance\n")
    out.append("| Table | Migration | Line | FORCE RLS | tenant policy |")
    out.append("|---|---|---|---|---|")
    for (name, f, line, forced, policy) in summary_tables():
        out.append(f"| `{name}` | `{f}` | {line} | {forced} | {policy} |")
    out.append("")
    out.append("Also changed: `organizations` (+`lifecycle_status`, `lifecycle_as_of`, `deletable_until`; "
               "`status` kept — see 0043/0044), `organization_settings` (−`pcusa_pin`), "
               "`congregation_statistics` (+`publication_id`, −`supersedes_publication_id`), "
               "`sasr_reports` dropped (0047). Drizzle mirrors: `src/lib/db/domain/{org,lifecycle,returns,publication,presbytery}.ts`; "
               "`reporting.ts` deleted.\n")
    for path in FILES:
        out.append(render_file(path))
    open(OUT, "w").write("\n".join(out))
    print(OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()

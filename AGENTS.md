# Agent Instructions

This repo's canonical agent instructions live in **[CLAUDE.md](./CLAUDE.md)** — read that file in full before making changes. It covers the project overview, capability map, the six-phase development pipeline, classification rules, workflow rules (including "no code before the work-log" and commit-message grammar), and key invariants.

This AGENTS.md exists as a portability shim for non-Claude agents (Cursor, Codex, Jules, and other AGENTS.md-standard tools). The short version of what you must honor:

- **Never commit or push without explicit user approval.** Run the checks in `.claude/skills/pre-push/SKILL.md` before any push to `main`.
- **Classify before editing** (CLAUDE.md → Classification). Non-trivial work requires a work-log entry in `docs/work-log/` first.
- **Commit grammar is enforced**: `<prefix>(<scope>): <description>`; `fix:` commits need `Caught-By:` and `Discovered-In:` trailers; `feat:`/`fix:` commits need a `Work-Log:` trailer. CI re-validates on PRs.
- **Key invariants** (CLAUDE.md → Key Invariants): the Edge proxy can't import `@/lib/db`; `schema.ts` is the schema source of truth; permissions (`hasFeature`) and flags (`isFlagEnabled`) are distinct concepts; audit security-sensitive mutations via `recordAudit()`; no `toLocale*` in components (use `<FormattedDate>`); no native browser dialogs; no secrets in committed files.
- **Reconcile `docs/TODO.md` in the same commit as the work** (Workflow Rule 10) and keep `docs/product/functionality-map.md` current at ship time (Rule 14).

Claude-specific tooling (`.claude/agents/`, `.claude/skills/`, hooks in `.claude/settings.json`) won't run under other tools — the rules above still apply; you just have to follow them manually.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

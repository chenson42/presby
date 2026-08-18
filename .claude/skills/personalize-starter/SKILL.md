---
name: personalize-starter
description: One-shot interactive rebrand for a freshly-forked Claude Code Starter — captures identity, branding, and strategic docs (product vision, business plan, branding), then does every find-replace across the codebase. Run once, right after `gh repo clone`.
---

# Personalize the Starter

When the user invokes `/personalize-starter`, walk them through turning this freshly-forked starter into *their* project. This skill runs once, typically right after `gh repo clone`. It edits identity strings, brand colors, and strategic docs in one pass so the forker never has to hunt for the next "Claude Code Starter" mention three months later.

**This skill makes real edits to many files. Confirm scope with the user up front.** If they want to preview before editing, offer plan mode.

---

## Step 0: Confirm preconditions

- Run `git status` — if the working tree has uncommitted changes that aren't from a fresh clone, **stop** and ask whether to commit / stash first. This skill makes a large diff; mixing it with unrelated work makes review impossible.
- Confirm this is a real fork (not a session inside the canonical `chenson42/claudecode-nextjs-starter` repo). Look at `package.json` `name`: if it's still `claudecode-nextjs-starter`, that's the signal. If it's already been personalized, ask whether to re-run.

---

## Step 1: Identity

Ask the user, one question at a time (use `AskUserQuestion` if available):

1. **Project name** — human-readable (e.g. "Lighthouse Ops"). Becomes `<title>`, page headings, deck cover.
2. **Slug** — npm-package safe (e.g. `lighthouse-ops`). Becomes `package.json` `name`. Default by lowercasing + hyphenating the project name.
3. **One-line description** — 140 chars max. Becomes `package.json` `description`, `<meta description>`, README hero, deck intro.
4. **Repository URL** — GitHub URL once they push, e.g. `https://github.com/acme/lighthouse-ops`. Becomes deck footer + any README links.
5. **Contact / from-email** — `Lighthouse Ops <noreply@lighthouse.example.com>`. Becomes `RESEND_FROM_EMAIL` in `.env.example`.
6. **License** — Keep MIT? Replace? If replace, ask which (Apache-2.0, BSL, proprietary, etc.) and update both `LICENSE` and the README license section.

Echo all six answers back before any edits so the user can correct typos.

---

## Step 2: Branding

Ask:

1. **Primary brand color** — hex or HSL. Defaults to the starter's `hsl(217 91% 60%)` (a clean blue). This becomes `--color-accent` in `src/app/globals.css` `@theme` block.
2. **Background / foreground tone** — light/dark/auto. Defaults to auto (matches `prefers-color-scheme`). If they want to lock a specific look, update the `@theme` and `@media (prefers-color-scheme: dark)` blocks.
3. **Voice & tone** — one sentence. "Crisp and technical." / "Warm and approachable." / "Formal B2B." This goes into `docs/product/branding.md` (Step 3).
4. **Keep the training deck?** — yes / no / strip-but-keep-pipeline. If `no`, delete `deck/`, `package.json` `deck:*` scripts, and the deck section from CLAUDE.md + README. If `strip-but-keep-pipeline`, delete `deck/slides.md` / `slides.pdf` and leave the npm scripts so the forker can write their own.

---

## Step 3: Strategic docs (product vision, business plan, branding)

These are the docs that capture the *why* of the project. Every future Claude conversation will read them (Step 6 wires that in). For each of the three documents, offer the user three paths:

| Path | What happens |
|---|---|
| **"I have it already"** | Ask for a file path or paste-in content. Write to canonical location verbatim — do not edit. |
| **"Interview me"** | Ask 4-6 targeted questions, draft the doc, show it back, let them iterate. Save only after they approve. |
| **"Skip / draft later"** | Write a minimal template with `TODO` markers. The file exists so it shows up in directory listings and Claude can fill it in later when the forker asks. |

Canonical locations:

- `docs/product/vision.md`
- `docs/product/business-plan.md`
- `docs/product/branding.md`

### Vision interview prompts (if "Interview me")

- What does this product do, in one sentence?
- Who is the primary user? Be specific — a role, a team, a job-to-be-done.
- What problem does this solve that they can't solve today?
- What's the wedge feature — the one capability that makes a user try this instead of an alternative?
- How do you know it's working? (early signals of success — a count, a behavior, a verbatim quote)
- What's intentionally **out of scope**?

### Business plan interview prompts

- Revenue model — subscription / one-time / freemium / B2B contract / open-source-with-services / something else?
- Pricing — what would you charge, to whom, and why that number?
- Target customer profile — size, industry, role, geography.
- Distribution — how do they hear about it? (SEO, partnerships, direct sales, community, integrations)
- Top 2-3 competitors — who, and how is this different?
- 12-month milestone — what does success look like a year from now?

### Branding interview prompts

- Brand voice — pick 3 adjectives. (e.g. "precise, warm, opinionated")
- Brand voice — pick 3 things you are NOT. (e.g. "not corporate, not cute, not jargon-heavy")
- Visual identity — minimal / dense / playful / serious / brutalist / soft / other?
- Words you always use. (e.g. "members" not "users"; "workspace" not "account")
- Words you never use. (e.g. avoid "leverage", "synergy", "best-in-class")
- Logo direction — wordmark / icon / both / "we'll figure it out later"?

For templates (when "Skip / draft later"), include the prompts above as `<!-- TODO: answer this -->` comments so a future Claude run can interview and fill in.

---

## Step 4: Make every identity edit

Apply find-replace and structured edits across:

**Identity strings — replace "Claude Code Starter" / "claudecode-nextjs-starter" with the new name / slug:**

- `package.json` — `name`, `description`
- `src/app/layout.tsx` — `metadata.title`, `metadata.description`
- `src/app/page.tsx` — `<h1>` heading + body copy
- `src/app/(auth)/signin/page.tsx` — any heading copy that mentions the starter
- `CLAUDE.md` — `## Project Overview` and `## Capability Map` sections (rewrite to describe the new project, not the starter). Keep the workflow sections (`Agent Roster`, `Development Pipeline`, `Periodic Reviews`, etc.) — those are the SDLC pattern the forker wanted.
- `README.md` — full rewrite using the new identity. Keep the structure (Good for / Not for / What you get / The SDLC bit / Quick start / Common commands / Env vars / Forking notes / License). Update every cross-reference.
- `docs/product/functionality-map.md` — do NOT rewrite; keep it as-is (it maps the starter features the fork inherits) and update its header line to the new project name. It evolves per Workflow Rule 14 as the fork builds.
- `deck/slides.md` frontmatter — `header`, `footer`, cover slide title (if keeping the deck)
- `.env.example` — `RESEND_FROM_EMAIL` placeholder

**Branding edits:**

- `src/app/globals.css` — `@theme` block: update `--color-accent` (and any other token the user changed). If they picked a non-default background/foreground, update those too.
- `src/app/icon.svg` — leave it for the forker to swap (or, if they pasted SVG content, replace).

**License edits (if they replaced MIT):**

- `LICENSE` — replace contents.
- `package.json` — there's no `"license"` field today; add `"license": "<spdx-id>"`.
- `README.md` — License section.

---

## Step 5: Strip what they don't want

- If `Step 2 #4` was "no deck": delete `deck/`, remove `deck:*` scripts from `package.json`, remove deck references from `CLAUDE.md` and `README.md`.
- If they don't want the periodic-review cadence: ask explicitly before stripping. Most forkers will keep it.
- If they don't want the 6-phase pipeline at full weight: leave it in place (no edits) but flag in the manual TODOs that they can trim `CLAUDE.md` → `Development Pipeline` to fit their team size.

---

## Step 6: Wire the strategic docs into project memory

Add a new section near the top of `CLAUDE.md`, immediately after `## Project Overview`:

```markdown
## Project Context

Three documents capture the *why* of this project. Every Claude conversation that touches product decisions, scope, or copy MUST read them first:

- [`docs/product/vision.md`](docs/product/vision.md) — what we're building, for whom, and why.
- [`docs/product/business-plan.md`](docs/product/business-plan.md) — how it makes money and who pays.
- [`docs/product/branding.md`](docs/product/branding.md) — voice, tone, and words to use / avoid.

If any of these is a placeholder with `TODO` markers, ask the user to fill it in before doing scope-shaping work.
```

Then update `.claude/agents/analyst.md` so the analyst agent reads `docs/product/vision.md` during Phase 1 (functional refinement) — feature requests should be checked against the stated product vision, not just the literal request.

---

## Step 7: Manual TODO report

Echo this list back to the user — these are the things only they can do:

1. **Provision Neon Postgres** — create a project, copy `DATABASE_URL` into `.env.local`, run `npm run db:push` then `npm run db:seed`.
2. **Generate `AUTH_SECRET` and `AUTH_TOTP_ENCRYPTION_KEY`** — `openssl rand -base64 32` for each, put in `.env.local`. **The TOTP key cannot be rotated without invalidating every enrolled secret.**
3. **Set up Google OAuth** — create credentials at `console.cloud.google.com`, add `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` to `.env.local`. Configure authorized redirect URI: `<AUTH_URL>/api/auth/callback/google`.
4. **Set `INITIAL_ADMIN_EMAILS`** in `.env.local` to your email(s) — comma-separated.
5. **Set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`** for local credentials-based admin (skip if you'll only use Google).
6. **Set `NEXT_PUBLIC_APP_URL`** to your public origin (used to build email links).
7. **Configure Resend** — sign up at `resend.com`, verify your sending domain, add `RESEND_API_KEY` to `.env.local`. In dev without a key, emails log to stdout.
8. **Swap `src/app/icon.svg`** for your real icon. Optionally add a `src/app/apple-icon.png` for iOS.
9. **Create a new GitHub repo** and `git remote set-url origin <new-url>`. Then `git add -A && git commit -m "Personalize for <project name>"` and push.
10. **Vercel deploy** — connect the GitHub repo, set every env var in the Vercel dashboard, deploy.
11. **(Optional)** Provision Upstash Redis for distributed rate limiting (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).
12. **(Optional)** Fill in any strategic docs you marked "skip / draft later".

---

## Step 8: Write the upstream-sync state file

After all find-replaces are complete, write `.claude/upstream-state.json` so the `/upstream-sync` skill knows where this fork started and which files were personalized.

```json
{
  "upstreamUrl": "https://github.com/chenson42/claudecode-nextjs-starter",
  "forkPointSha": "",
  "lastSyncedSha": "",
  "lastSyncedDate": "<today YYYY-MM-DD>",
  "personalizedPaths": [
    "package.json",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/(auth)/signin/page.tsx",
    "src/app/globals.css",
    "CLAUDE.md",
    "README.md"
  ]
}
```

Notes on each field:

- `upstreamUrl` — always this value; forks do not change it.
- `forkPointSha` — leave empty string. The first `/upstream-sync` run will ask the user to confirm the SHA (or compute it automatically via `git merge-base` if an `upstream` remote is configured).
- `lastSyncedSha` — same as `forkPointSha`; both start empty and are filled in at first sync.
- `lastSyncedDate` — today's date. Primes the 14-day cadence clock so the first `upstream-sync` review is not shown as overdue immediately after personalization.
- `personalizedPaths` — the list above covers the files that Step 4 edits by default. If the user made additional edits in Steps 4–5 (e.g. replaced the license, stripped the deck), append those file paths manually.

If the file already exists (re-running this skill), merge rather than overwrite: preserve any existing `forkPointSha` / `lastSyncedSha` values, update `lastSyncedDate` to today, and union the `personalizedPaths` arrays.

---

## Step 9: Don't commit

Do not commit the personalize-starter edits. The user reviews the diff (`git diff`) and commits when they're satisfied. Recommend a single commit titled `"Personalize for <project name>"` so future contributors can see the fork point clearly.

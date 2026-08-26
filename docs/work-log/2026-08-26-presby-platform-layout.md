# Repo Layout — presby-platform Sibling Structure — Work Log

> **Slug:** `2026-08-26-presby-platform-layout`
> **Surface:** dev tooling — repo layout, local build config, `.claude/agents/site-recreator.md`
> **Permission(s)/Flag(s):** none — infra, not app code
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, brief (build-config fix only; the layout move itself is infra, not app behavior)

---

## Restructuring

`presby-site-kit` and `site-fpcw` moved out of `presby/scratch/` (gitignored, nested inside presby's own repo tree) to live as siblings under `~/git/presby-platform/{presby, presby-site-kit, site-fpcw}`. Motivation: the nested layout was the direct cause of two real bugs this session — `pre-push-gate.mjs` mistaking a push targeting a nested scratch/ repo for a push to presby's own repo, and a `cd`-vs-`git -C` cwd-resolution gap in the same hook when invoked from a background/forked execution context. A sibling layout makes "which repo does this command target" unambiguous by construction. `presby` itself was re-cloned fresh from `origin/main` into the new location rather than moved, to avoid disrupting an active session's own working-directory assumptions mid-move.

Local dev dependency linking switched from a manual `rsync -a dist/ node_modules/.../dist/` step to `npm link` — `node_modules/presby-site-kit` is now a real symlink to the sibling repo, so a site-kit rebuild is visible to presby instantly, no copy step to forget. `package.json`'s actual dependency (`github:chenson42/presby-site-kit#v3.4.0`) is untouched — this is a local-machine-only override, exactly what `npm link` is for.

## Bug found and fixed

`npm link`'s symlink points outside presby's own project root, which Turbopack's default root inference doesn't follow — `next build` failed with `Module not found: Can't resolve 'presby-site-kit'` on every route importing it (`/site/[slug]/**`), despite `node -e "require.resolve('presby-site-kit')"` resolving it correctly (confirming the gap is Turbopack-specific, not a real module-resolution problem). Root cause and fix documented inline in `next.config.ts`.

**Fix:** `turbopack.root` widened to presby's own parent directory, derived from `next.config.ts`'s own file location via `import.meta.url` — not a hardcoded absolute path. Safe to commit: harmless for anyone who clones presby anywhere else, and a no-op in CI/production where `presby-site-kit` installs normally (no symlink) regardless.

## Verification

Full clean `next build` (every route present, including every `/site/[slug]/**` route that imports `presby-site-kit`) and a real dev server (`npm run dev`, `curl -sI http://localhost:.../site/fpcw` → 200) both confirmed working in the new location. `npm run typecheck` clean. `npm test` — 2082 passed, 1 pre-existing failure unrelated to this change (`sitemap.xml/route.test.ts`, already tracked in `docs/TODO.md`, reproduces identically regardless of this layout change).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1–3 | — | Skipped | Trivial bug-fix variant — build-config-only fix, no app surface, no invariant touched | 2026-08-26 |
| 4 | (implemented inline) | Complete | Fix + real build/dev-server verification | 2026-08-26 |
| 5 | (self-verified) | Complete | Clean build, clean typecheck, no new test failures | 2026-08-26 |
| 6 | — | N/A | Dev tooling, not a user-facing feature | — |

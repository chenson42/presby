# Chromium autofill tint overriding input backgrounds — Work Log

> **Slug:** `2026-08-27-autofill-tint-override`
> **Surface:** app-wide (globals.css base layer)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, compressed — root cause diagnosed live with the operator (screenshots + computed-style probes in Chromium AND WebKit proving the page CSS was already consistent); fix is five lines of CSS in globals.css; phases 2-3 skipped (no invariant, no structure); implementation direct.
> **Source:** live operator report, 2026-08-27 — "directory is gray. home is white" (Arc browser, with screenshots). The gray field carried a remembered value; the white one was empty. Chromium's `:-webkit-autofill` paint layers OVER any CSS background, so the 2026-08-27-input-background-standard fix (real, verified, and still correct) could not affect it.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Root cause | orchestrator (live with operator) | Complete | Autofill paint, not page CSS — proven by identical computed styles in two engines vs. the operator's screenshot showing gray only on the value-carrying field | 2026-08-27 |
| 2-3 | — | Skipped (five-line CSS, no invariant) | — | 2026-08-27 |
| 4 — Implementation | orchestrator | Complete | `input/textarea/select:-webkit-autofill` (+ :hover/:focus) get `inset 0 0 0 1000px var(--background)` box-shadow + `-webkit-text-fill-color`/`caret-color: var(--foreground)` in globals.css @layer base | 2026-08-27 |
| 5 — Verification | limited by nature | Complete with caveat | The autofill pseudo-state CANNOT be triggered programmatically (browser-internal); verification = CSS present + typecheck/build green + operator visual confirmation after hard refresh. The token choice (`--background`) matches docs/ui-standards.md's control standard, so an autofilled field now paints identically to an empty one, in both palettes and both schemes (the token itself is scheme-aware). | 2026-08-27 |
| 6 — Confirmed by operator | pending operator | Pending | awaiting operator confirmation after hard refresh | — |

## Notes

- The earlier same-day pipeline (`2026-08-27-input-background-standard`) fixed a REAL but different inconsistency (primitive `bg-transparent` drift). This work-log exists so the two root causes aren't conflated: that one was page CSS; this one is browser paint.
- `-webkit-autofill` is supported by Chromium and WebKit; Firefox uses `:autofill` with a `!important` UA background that the shadow trick also covers in practice (Firefox respects box-shadow). Not verified in Firefox — dev is Chromium/Arc.

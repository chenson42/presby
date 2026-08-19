# P0.5 — Design Foundation and Per-Organization Brand Architecture — Work Log

> **Slug:** `2026-08-19-brand-foundation`
> **Surface:** every surface — this is the token contract the rest of the product inherits
> **Permission(s):** new tenant key `org.branding` (slice d)
> **Flag(s):** `ui.brand_theming`
> **Estimated complexity:** large — six slices, three of which block P1 and P3
> **Pipeline mode:** Full, run with agents
> **Verification:** Phases 5 and 6 deferred per DECISION-045 — operator is the verifier

---

## Settled inputs

S12–S14 (`docs/work-log/2026-08-18-backbone-and-org-sites.md`): full re-skin across
website and portal · a congregation's real brand colour derived into accessible
ramps, never painted raw · curated type pairings. Branding lives on the
**organization**, not on `sites`, because it spans both surfaces.

Carried scope from DECISION-036: 7 hand-rolled tables, 8 hand-rolled buttons,
`alert-dialog.tsx` predating `components.json`, dark-mode strategy, the
`radix-ui` umbrella problem (F-B1), and reconciling `docs/ui-standards.md`'s 562
prose lines against real primitives.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (agent) | Complete | READY WITH NOTES — six slices; blocking relationship corrected | 2026-08-19 |
| 2 — Architectural review | architect (agent) | Complete — slices 0 and a | Approved with suggestions — 5 decisions (046–050), 3 overturns | 2026-08-19 |
| 3 — Technical design | tech-lead | Complete — slices 0 and a | Design complete — 10 commits, implementers named; 3 decisions drafted (051–053), 4 overturns | 2026-08-19 |
| 4 — Implementation | api-developer (`0.1`, `a1`, `a8`) · ux-developer (`0.2`, `a2`–`a7`) | In progress — **`0.1`, `a1` pushed (`f0ebd7c`); `0.2`, `a2`, `a3`, `a4`, `a5`, `a6` complete**; next: `a7` (member + shared), then `a8` | `0.1` contract + palette correction, 56 tests, operator ruling taken on the dark red · `a1` tooling, 3 CLI surfaces, 41 tests, C2 dry-run counts 52 violations · `0.2` ui-standards visual rewrite, 562 → 626 lines · `a2` harness, 18 routes × 4 = 72 captures, self-comparison clean, caught the unstable `/admin/users` sort · `a3` scheme/motion/radius, 656 unit + 86 e2e, 72/72 visual self-consistency · `a4` five primitives + alert-dialog regen, C2 demonstrated failing at 52, E7 semantics verified · `a5` `(admin)` sweep, 14 files, 28 violations cleared, 87 e2e, every visual diff attributed · `a6` credential sweep, mandatory auth e2e gate PASS (88/88, new MFA-enrolled fixture built for it), 12/12 visual diffs attributed | 2026-08-19 |
| 5 — Verification | qa | **Deferred** (DECISION-045) | — | — |
| 6 — Shipped vs intent | analyst | **Deferred** (DECISION-045) | — | — |

*Recorded by the orchestrator from the read-only analyst agent. Full output preserved.*

---


## Operator answers to Phase 1's open questions (2026-08-19)

| # | Decision | Effect |
|---|---|---|
| **S15** | **S12 refinement accepted: every surface participates in the brand; brand carries *emphasis*, neutral carries *content*.** Masthead, nav, links, primary buttons, focus rings, selected states and the public site's hero bands are brand-driven; table rows, form interiors, body copy, disabled states and semantic colours are neutral and identical everywhere. Transactional email is name-and-logo only; credential email stays presby-voiced. | Makes the accessibility floor achievable, and keeps the re-skin on the axis that reads as identity rather than the axis that reads as data. |
| **S16** | **Body-text contrast floor is AAA (7:1)**, not AA. | Above the legal standard, deliberately. The audience skews old and the product's own content is about hearing loops and large-print bulletins. Constrains every future palette decision, knowingly. |
| **S17** | **A member-facing dark-mode toggle ships**, account-level, defaulting to system. | Approves `next-themes`; its FOUC-prevention script is needed anyway to satisfy Flow 4's no-flash-of-the-previous-congregation requirement. The `.dark` class mechanism was shipping regardless. |
| **S18** | **A minimal `(admin)` organizations surface comes into this pipeline** (slice c). | "The operator sets branding at onboarding" has nowhere to live otherwise — there is no organizations page in `/admin` at all today. It is also where neutralising an abusive tenant's brand belongs, and P2's onboarding work builds around it rather than replacing it. |

Still open, for the architect: the `radix-ui` umbrella (OQ5) — **now a second
occurrence**, hand-corrected again during the avatar pipeline on 2026-08-19, so
slice a must settle it rather than defer it a third time. And OQ4, the
"congregations still on the default palette" report, which the operator has not
answered and which is cheap in this pipeline and awkward later.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES** — the scope as written is two pipelines, not one, and the blocking relationship the operator recorded is partly inverted. S12–S14 are sound and I am not asking to reverse any of them; I am asking to make S12's "every surface" mean something precise enough to build and to test, and to fix a scheduling landmine where the piece of P0.5 that supposedly unblocks P1 actually depends on it.

## ONE-LINE TAKE

> The real deliverable is not a colour picker — it is a *contract*: a closed token vocabulary, a derivation function whose accessibility guarantees are property-tested against every possible brand colour, and a rule (not a list) that decides which surfaces are un-brandable; the branding UI is the easy 20% and the part most likely to be built first.

## The one place I am pushing back on S12

S12 says full re-skin, every surface of website *and* portal. Held literally, it collides head-on with the accessibility floor: a brand-tinted table row, a brand-tinted form field, and a brand-tinted status badge are exactly the three places contrast dies, and they are the three places a 78-year-old clerk of session spends her time.

I am not asking to reverse S12. I am asking for a one-sentence refinement that makes it buildable:

> **Every surface participates in the brand. Brand carries *emphasis*; neutral carries *content*.**

Concretely: masthead, logo, primary navigation, links, primary buttons, focus ring, selected/active states, section accents, and the public site's hero and band treatments are brand-driven. Table rows, form field interiors, body copy, disabled states, and semantic status colours are neutral-driven and identical across every organization. That is still "the whole interface re-skins" when you switch congregations — it just re-skins on the axis that reads as identity rather than the axis that reads as data.

**Two subtractions from "every surface" that I think are correct and want confirmed:**

1. **Notification email is name-and-logo only, not colour.** Email is inline-styles-only, and mail clients apply their own dark-mode inversion that no CSS can prevent. A derived ramp cannot be guaranteed in that environment, so guaranteeing it is a lie. The org's name and logo in the header deliver ~90% of the felt ownership at ~0% of the risk.
2. **Credential emails stay presby-voiced.** Password reset and 2FA emails are part of the credential path, and a church-branded "reset your password" email is a phishing template with our return address on it.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| **Platform operator** (onboarding call) | Set a new congregation's brand colour and logo while on the phone with them | one-time — **the moment that decides whether the product ships branded or default** |
| Platform operator | Neutralise a tenant's brand (abuse, trademark, impersonation) | rare, must exist |
| **Church administrator** | See what our brand currently is | rare |
| Church administrator | Enter our brand colour — hex, picker, or sampled from the logo | ~once a decade, and at every pastor transition |
| Church administrator | Upload / replace the logo | once, then again when someone redesigns the letterhead |
| Church administrator | Choose a type pairing (S14) | one-time |
| Church administrator | **Preview before saving** | every time they touch it |
| Church administrator | **Restore the previous brand** | rare, high-stakes, used at 9pm on a Saturday |
| Church administrator | Read *why* their colour was adjusted, in a sentence they believe | every adjustment |
| **Any authenticated member** | Know, ambiently, which organization they are looking at | continuous — the single most important verb here |
| **Multi-org user** | Switch context and have it be unmistakable but not disorienting | several times a session |
| **Anonymous visitor** | Recognise a church's site as *that church's* | on demand |
| **Cron agent** | Place a block and choose a `tone` from an enumerated set — never a colour | daily |
| **Any implementer** | Build a new surface and get the brand for free | every future pipeline |

**Pass 1 finding.** The last verb decides whether this succeeds. If honouring the brand requires an implementer to *remember* to honour it, S12 is false within two pipelines. Hand-rolling a colour must be harder than using the token, and ideally caught by a tripwire.

## Flows

**Flow 1 — Onboarding sets the brand (the flow that decides the product).** Operator on the call → org created → brand step in the checklist → hex read off the letterhead, or logo emailed → generator returns tokens + adjustments → confirm → branded from day one.

- Church doesn't know their colour: upload the logo and accept a sampled suggestion. **A suggestion a human accepts, never a silent extraction.**
- Church has nothing: platform default, plus a persistent (not dismissible-forever) completion card. See G1.
- **There is no platform surface for organizations today**, so this flow has nowhere to live — G8.

**Flow 2 — The church administrator changes the brand.** Current brand shown as rendered UI, not swatches → change → **live preview of three real surfaces** → Save → audit event.

- Upload rejected: "That file is 12 MB — we can take up to 2 MB." Not "Upload failed."
- Storage unreachable: the colour still saves, the logo does not, and the user is told which half landed. A partial save reported as total failure is how a secretary uploads the same logo four times.
- **"Restore previous brand"** with the previous brand rendered as a swatch and a date.

**Flow 3 — A brand colour cannot satisfy the floor (the failure that must be designed, not discovered).** Enter the church's actual cream → generator returns tokens **plus a non-empty `adjustments` array** → the editor must render every adjustment before save is meaningful → "Cream is too light for white text to be readable on a button, so buttons and links use a deeper shade of the same colour. Your cream still appears on your masthead and page backgrounds." Accept, or pick another.

- **The generator returns the explanation as data**, so disclosure is a contract of the generator rather than a UI nicety someone forgets in the second implementation.
- A hue whose accessible ramp stops reading as their colour (gold, lime): **flip the foreground before you move the hue.** Gold with near-black text is 4.5:1 and still reads gold; gold darkened until white text works reads brown, and the church will say we changed their colour. Rule: *move the text, not the hue; move the hue only when the text cannot move.*
- Near-grey seed: links become indistinguishable from body text. Enforce minimum chroma — "colour alone is not a signal" is already in `ui-standards.md`.

**Flow 4 — A multi-org user switches context.** The entire interface arrives already in the new organization's brand **on first byte**. Tokens are emitted server-side; no client theme provider, no flash of the previous congregation's colours. A flash is a moment where the user's mental model of "which org am I in" is wrong while an interactive page is on screen.

- **The dangerous case is not the switch, it is the second tab.** Two tabs, two congregations, one destructive action in the wrong one. Requirement, cheap now: **every consequential confirmation names the organization** — "Remove Jane Smith from the roll at Wrenfield Presbyterian Church" — not "Are you sure?"

**Flow 5 — A sealed section inside a branded page.** The giving block renders on a **neutral plate** and says whose it is. Not a design compromise — it *is* someone else's form. The reset must be a **cascade property** (`data-sealed` re-declaring neutral values), not a convention. A convention gets broken by the third block author.

**Flow 6 — A presby failure on a church's domain.** The church's masthead (so the visitor knows they're in the right place) with a **platform-voiced, un-restyleable body**. The error page must render on the platform default with **no dependency on the brand read path** — an error page that needs the theme to render is not an error page.

## Permissions & Flags

One key: **`org.branding`**. Not a view/edit split — nothing consumes the distinction. Explicitly not granted to the Session group: the court governs, it does not choose typefaces.

**The downward-inheritance ruling, unambiguous:**

> **A presbytery never inherits, sets, or overrides branding at a member congregation.** No code path may resolve branding by walking `organizations.path` or `parent_id`.

Same error as a presbytery publishing a website in a congregation's voice, wearing a different hat. The one legitimate adjacent thing: at org creation a new worshiping community may **copy** a sponsor's branding as a starting value. Copy, not link — a copy diverges, a link is inheritance with a nicer name. The inverse also holds: a congregation's brand never leaks upward; the presbytery's directory renders in the *presbytery's* brand with each congregation's logo as content inside a card.

**The scheduling landmine.** The tenant permission catalog is P1 — which P0.5 was supposed to unblock. So the tenant-facing editor cannot ship before P1 without inventing a second permission mechanism. Resolution, which matches reality anyway: **branding is set by the platform operator at onboarding in the first release.**

**Flags.** `ui.brand_theming` gates whether the per-org override is emitted at all; rollback is one switch, no data change, no migration. Given the failure mode is "we re-skinned every surface and something is unreadable for someone we cannot see," it earns its keep. **No flag on the primitive migration** — a half-migrated UI behind a flag is two UIs. Per-org branding on/off is **not** a flag; it is the presence of a brand row, i.e. tenant state (DECISION-003).

**Audit.** `org.branding_updated` on every change. Per F18 a platform action against a tenant's brand carries that tenant's `organization_id`, or the church cannot see it. It is the only record that will exist when someone asks "who made our website purple."

## Gaps the Request Didn't Address

**G1 — Nobody sets the brand, and a platform where 190 of 200 congregations run the default is a different product.** Left to self-service, most congregations never will: a part-time secretary, a pastor serving two yoked churches, a session that meets monthly, and a "brand" consisting of a scanned 1998 letterhead and a colour nobody has expressed as a number.

- **The default must not be presby's own brand.** If the majority run it and it is our marketing blue, every congregation's portal reads as vendor software imposed from outside — precisely what a congregationally-governed denomination resists. The default must be **ecclesiastically neutral**: a warm ink-and-paper register rather than a SaaS blue.
- **Do not hue-hash the default per org.** Unexplainable to a session ("who decided we were green?"), makes "is this set" invisible to the admin *and* the agent, and destroys the audit story — a brand should be attributable to a person or to "platform default," never to a hash.
- **The differentiator that matters is not colour.** Two congregations both named "First Presbyterian Church," both un-logoed, both on the default palette **are** confusable — and that is the common case. See G3.
- **Recommendation:** capture branding at the onboarding conversation, plus a persistent completion card, plus a report the operator can run — "congregations still on the default palette" — because branding completion is a real adoption metric.

**G2 — The derivation contract, as testable properties.** Every property must hold for every sRGB seed, in both schemes, or the generator is wrong:

| # | Property |
|---|---|
| **D1** | Body text on any generated surface ≥ **7:1** (AAA). Deliberately above AA — the audience skews old and the content is literally about large-print bulletins. Cheap, because body text is never brand-on-brand. |
| **D2** | Any text on a brand-filled surface ≥ **4.5:1**. `primary-foreground` is **computed**, not fixed white. |
| **D3** | Non-text UI — input borders, focus rings, icon-only affordances — ≥ **3:1**. Routinely missed. |
| **D4** | The focus ring has ≥3:1 against **both** the surface and the control it rings. The classic failure: ring = primary, drawn on a primary button, invisible. |
| **D5** | Disabled controls remain ≥ **3:1**. Stricter than WCAG, which exempts them. `opacity-50` on a low-contrast brand is invisible to a 78-year-old. |
| **D6** | `destructive`/`warning`/`success` are **platform-fixed, never derived**, and `primary` keeps a minimum perceptual distance from `destructive`. A burgundy church must not get a Delete button indistinguishable from Save. |
| **D7** | Page background lightness bounded to a near-white or near-dark band. **This is the pale-gold-on-cream answer:** a congregation may have a cream page; they may not have a gold page. |
| **D8** | Determinism and **versioning**. Same seed → same tokens, forever. Without a pinned `brand_token_version`, a dependency upgrade silently re-skins 200 congregations on a Tuesday and nobody can explain why. |
| **D9** | The ramp is **monotone in lightness**, or "hover is darker" inverts for some hues. |
| **D10** | Derived `primary` stays within a bounded hue distance of the seed; the unmodified seed is preserved as **`brand-raw`** for non-interactive decorative surfaces. This is how the church still sees *their* colour. |
| **D11** | Both schemes derived **independently** — the dark ramp is not an inversion. |
| **D12** | The generator returns `{ tokens, adjustments[] }`, and a non-empty `adjustments` **must** be surfaced before save. |

**Testing shape:** a property-based test over the OKLCH space asserting every legal token pair passes D1–D6 and D9 in both schemes. The single highest-value artifact in this pipeline, and cheap.

**One seed in v1, not two.** Many congregations have a genuine pair; two seeds double the contrast surface and most churches cannot reliably name a second.

**No opt-out.** An accessibility floor with an "I accept the risk" checkbox is not a floor. If a customer genuinely must be excepted: support ticket plus a platform-admin override that writes an audit event and is **visible on that org's own settings page**.

**G3 — Two congregations look identical, and the schema cannot tell them apart.** Hundreds of congregations are named "First Presbyterian Church." `organizations` has **no locality and no address** — addresses exist only on `people`. So there is literally no data to disambiguate two identically-named churches.

1. **Disambiguate by parent council**, which is already in the schema: "First Presbyterian Church · Fable Presbytery" is how Presbyterians actually do it, and it costs nothing.
2. **Organizations need an address** for reasons beyond this pipeline — the public site's most-used content is "when and where," the SASR needs it, the presbytery directory needs it.
3. **The organization mark is a rounded square; the person avatar is a circle.** Two adjacent identity controls in one header must not be the same shape.

**G4 — What must stay un-brandable: the rule.**

> **A surface is un-brandable when a visitor's safety depends on knowing whose surface it is, or when restyling it changes a compliance scope, or when it is not scoped to exactly one organization.**

Five clauses: credential/identity surfaces (anti-phishing — and DECISION-038 already keeps credential entry on the platform origin, so rule and architecture agree); payment surfaces (PCI SAQ-A); PII capture; platform statements about the platform; and anything not scoped to exactly one org.

**Clause 5 maps onto route groups**, which is what makes it a rule rather than a maintained list: `(org)` and `(public)/site/<slug>` are brandable; `(auth)`, `(account)`, `(member)`, `(admin)`, `(email-verify)`, `(password-reset)`, `/launch`, `/no-organization` are not.

**Enforcement:** the brand token scope is opened in exactly two layouts, asserted by a tripwire in the `check:audit` family; sealed sections re-declare neutral values on their own container so neutrality is a cascade property rather than a discipline.

**Two that are easy to miss:** the **DECISION-040 access-denied page must be un-branded** — a branded 403 would tell a prober the org is a real configured tenant, reintroducing exactly the leak that decision closes. And `/developer` is exempt and stays exempt (clause 5).

**G5 — The accessibility floor beyond contrast.** `ui-standards.md` has no type scale, no minimum size, no colour values. The floor needs: **16px minimum body text**, nothing below 14px member-facing, layout survives 200% zoom without horizontal scroll, `text-size-adjust` not suppressed. The type scale must be a **token, not hard-coded classes**, so a future large-print mode is a multiplier rather than a rewrite. Links in body copy underlined, not colour-only. Touch targets ≥44px. `prefers-reduced-motion` honoured. **Print:** church offices print directories and rolls on black-and-white lasers; a brand that exists only as screen tokens produces solid black boxes on paper.

**G6 — The AI angle.** The token vocabulary is **closed and named by role** — `surface`, `on-surface`, `brand`, `on-brand`, `brand-raw`, `border`, `ring`, `danger` — and the agent composes roles, never seeing a hex. **No block prop may accept a colour** (grep-enforceable, should be a tripwire); variants that touch colour are enumerated `tone: default | brand | inverse`. The contract declares which pairs are legal and the property test asserts every legal pair passes at every seed — which is the only way S12 and S1 coexist, because an agent authoring for 200 congregations cannot check contrast per church.

**G7 — Logos.** What a congregation actually has: a raster image, often a scan, frequently with a baked-in white rectangle, usually containing the church's name as pixels, at an unknown aspect ratio, almost never with a dark variant or an SVG.

- **Never composite a supplied logo onto a brand-coloured or dark surface.** The logo sits on a neutral near-white plate, always — **which answers the dark-variant question by not needing one.**
- **Two slots: a `mark` (square) and a `wordmark` (wide).** If only one is supplied, use it as the wordmark and fall back to initials for the mark. **Never auto-crop a wordmark into a square** — it will slice their name in half.
- **The no-logo fallback is typographic**: the church name in the brand's display face. **Not a generic church-building glyph and specifically not a cross** — a platform choosing a religious symbol on a congregation's behalf is presumptuous in a denomination with real theological variety about symbols.
- **Reject SVG in v1** — `<script>` and `<foreignObject>` make sanitising it its own project.
- **Storage rides DECISION-030's adapter with one genuine divergence:** a person photo is tier-1 private on an authenticated path; **a logo is public by design** and must be readable by the anonymous public renderer, which under DECISION-041 reads only through the narrow published-content function. Same interface, different read path.
- **Favicon and social card derive from the mark** — a church's link shared into a group text should carry their logo.

**G8 — There is no platform surface for organizations**, so "the operator sets branding at onboarding" has nowhere to live. Recommend a minimal `(admin)` organizations surface in this pipeline — it is also where the abuse-neutralisation action lives.

**G9 — Storage constraints.** Readable by the authenticated org shell under RLS *and* by the unauthenticated public renderer; readable without the caller being authorized for the org, but **not** in a way that reveals `platform_status` (the DECISION-040 property); and **typed columns / its own table, not `organization_settings.settings` jsonb**, per DECISION-033's precedent. Plus one deletion: **`theme_tokens jsonb` on `sites` in §14 should be removed from the sketch** — two homes for theming is how they diverge.

**G10 — Empty state, three doors.** Not "No branding configured" but the default rendered as it actually looks, plus: **"Upload our logo"** (sample and suggest), **"Pick a colour"**, **"Enter a hex code"**. A secretary asked for a hex code who does not know what one is will close the tab — and that is how you get 190 defaults out of 200.

**G11 — The verification burden nobody has costed.** The re-skin of every existing surface at 360px is a much larger verification surface than any feature so far. DECISION-045 defers Phases 5 and 6; **a re-skin of every surface is the change where deferring independent verification is riskiest** — three of this repo's worst bugs were phone-only, and slice B just found light mode had *never worked for anyone* with no automated check noticing. Two non-negotiables even under DECISION-045: **the generator's property tests** (they are the mechanism by which S13 is true), and **automated screenshot diffs at 360px and 1280px in both schemes across every route**.

**G12 — Dark mode.** Add the `.dark` class mechanism regardless of whether a toggle ships — the pipeline derives two ramps per org anyway, and a scoped per-org override inside a media query is awkward. **Recommend a member-facing toggle**, account-level, defaulting to system: older users frequently cannot find the OS setting, and a member who cannot read the screen should have a control they can find.

## Adversarial Pass

| # | Vector | Finding |
|---|---|---|
| A1 | A congregation brands its own site into unusability | Answered structurally by the non-overridable floor plus D7. The floor is the answer; a warning is not. |
| A2 | Two congregations indistinguishable | G3: name + parent council everywhere; square org mark vs circular person avatar; **every consequential confirmation names the organization**. |
| A3 | A presby failure looks like the church's fault | Chrome may carry identity; the attribution sentence is platform-voiced. The error page must not depend on the brand read path. |
| A4 | The inverse — a church's embarrassment looks like presby's | Persistent "powered by presby" **only on the platform subdomain**, never on the church's own domain where it is their identity, not ours. |
| A5 | Platform admin inside a tenant, wearing the tenant's brand | No such path exists today. **Forward constraint, named at the cheapest moment:** whenever break-glass is built (D7 defers it), it carries a persistent un-brandable platform-context banner. |
| A6 | Brand as a phishing surface | Sign-in never brandable; platform subdomain attribution; changes audited; platform-admin can neutralise. |
| A7 | CSS injection through the colour value | **Store a parsed colour and emit values generated from parsed numbers — never echo the user's string.** Server-side, because the editor is not the only writer. |
| A8 | Font as a payload | Curated set enforced as an **enum resolved server-side to a known `next/font` import**. Self-hosted — no runtime request to Google Fonts from a member's browser. |
| A9 | Brand state as an enumeration signal | A **branded** DECISION-040 denial page would reveal the org is a configured tenant. The denial page is un-branded. Easy to get wrong precisely because branding it feels like a kindness. |
| A10 | A type pairing that breaks layout | The acceptance criterion for adding a pairing: validated against the real UI at 360px in both schemes. A curated set that was never validated is a colour picker with fewer options. |
| A11 | Self-targeting | The prohibition to write down is the *inheritance* one. |
| A12 | A church leaves | Their brand and logo are theirs; export includes both. **Do not silently revert an outgoing church's brand while their site is still serving** — that reads as defacement at the worst moment. |
| A13 | Silent re-skin on upgrade | D8. Without a pinned version, a generator improvement re-paints every congregation with no action by anyone and no audit row. |

## Decomposition

| # | Slice | Class | Blocks |
|---|---|---|---|
| **P0.5-0** | **Token contract + accessibility floor** — closed role vocabulary, legal-pairs matrix, D1–D12, the un-brandable rule and its route-group mapping, type scale, versioning. Output `src/lib/brand/contract.ts` + a rewritten visual section of `ui-standards.md`. No visual change. | Spec | everything |
| **P0.5-a** | **Primitive migration + dark mechanism** — 7 tables, 8 buttons, add input/select/dialog/sheet/tabs, regenerate `alert-dialog.tsx`, settle the umbrella and the radius remap, add `.dark`. **Acceptance criterion: zero user-visible change** except radius and dark. | Refactor | P1, P3, P0.5-c |
| **P0.5-b** | **The ramp generator** — pure function, seed → two ramps + `adjustments[]`, versioned, property-tested. No UI, no schema. | Feature | P0.5-c |
| **P0.5-c** | **Brand storage + server-side emission** — brand table, logo asset + public read path, shell emission, sealed-boundary reset, scope tripwire, audit, minimal `(admin)` operator surface. Behind `ui.brand_theming`. | Feature | P1, P3 |
| **P0.5-d** | **The church-facing brand editor** — three doors, live preview, adjustment microcopy, restore-previous, `org.branding`. **Depends on P1.** | Feature | nothing |
| **P0.5-e** | **Curated type pairings** — self-hosted, byte budget, 360px validation per pairing. | Feature | nothing |

**Why the boring migration is not optional housekeeping — the strongest argument here.** S12 says branding reaches every surface. Seven pages hand-roll `<table>` and roughly twenty files hand-roll button classes. **Every hand-rolled surface is a surface the brand silently will not reach.** The migration is the mechanism by which S12 is true. Defer it and S12 is false on day one, and nobody notices until a church asks why their admin tables are still blue.

**Corrected blocking statement, replacing "P0.5 blocks P1 and P3":** slices 0/a/b/c block P1 and P3 · slice d **depends on** P1 · slice e blocks nothing.

## Out of Scope

A second brand colour · per-org custom CSS or raw token editing · a user-facing large-print mode (named, not built; the tokens must not foreclose it) · **a denominational baseline palette — yes to a platform baseline, no to a denominational one**: presby is not the denomination, the PC(USA) seal has real usage restrictions, and a congregationally-governed church does not receive its visual identity from Louisville. What is legitimate is the **connectional line of text**, auto-populated from `organizations.path`. Identity by words, not borrowed marks · branding of transactional email beyond name and logo · break-glass · an organization address field · the visual direction itself.

## Open Questions

1. **Confirm the S12 refinement** — "brand carries emphasis, neutral carries content," with email as name-and-logo only.
2. **Does the minimal `(admin)` organizations surface come into this pipeline, or wait for P2's onboarding?** Recommendation: into this pipeline, minimal.
3. **Dark mode: member-facing toggle, or follow the OS?** The `.dark` mechanism ships either way. Recommendation: a toggle, account-level, defaulting to system.
4. **Is "congregations still on the default palette" a report the operator wants?**
5. **`radix-ui` umbrella: adopt it, or keep hand-rewriting the import on every `shadcn add`?** Slice a must settle it once.
6. **Confirm the accessibility floor is AAA for body text (7:1), not AA.** Above standard, justified by the audience, cheap — but a commitment that constrains every future palette decision.

## Handoff

**Next: architect (Phase 2)**, scoped to **slices 0 and a only** — do not send b–e as one blob; that is how the derivation rules get decided by whoever types first.

---

# Phase 2 — Architectural Review (architect)

*Scoped to slices **0** (token contract) and **a** (primitive migration) only. Slices b–e are not reviewed here. Recorded by the orchestrator from the read-only architect agent.*

## Verdict

**Approved with suggestions.** Nothing goes back to Phase 1. Five decisions proposed (046–050); three places marked **⚠ Overturned / extended**.

**The ruling every other one hangs off:** branding is not a new styling system. **It is a cascade override of the token set `globals.css` already declares.** Raw values sit on `:root`; `@theme inline` maps them to `--color-*`. No component anywhere changes to become brandable — a primitive keeps writing `bg-primary`, and whether that paints platform blue or a congregation's burgundy is decided by whether an ancestor re-declared `--primary`. That is what makes clause 5 of the un-brandable rule mechanically true rather than aspirational, and what makes the tripwire small enough to be honest.

## Placement

### 1. The token contract — `src/lib/brand/contract.ts`

Location approved. `src/lib/brand/` alongside `permissions.ts`, `flags.ts`, `initials.ts` — not `db/domain/` (not schema), not `components/` (data, not markup).

**Not `server-only`, and the precedent is already written down** in `src/lib/utils.ts:6-8`. Same comment here, naming the four consumers: server components, the generator, the property test, the cron agent's instruction data.

**Stronger than the analyst asked: `contract.ts` has ZERO runtime imports.** No `@/lib/db`, no `next/*`, no React, no drizzle. Type-only imports permitted. This is what lets it be imported from an Edge route handler, from a `vitest` run with no database, and from a `.mjs` script emitting the agent's instruction payload. Cheap to hold now, impossible to recover once one import lands.

| File | Slice | May import |
|---|---|---|
| `contract.ts` | 0 | **nothing** |
| `generate.ts` | b | `contract.ts` |
| `emit.ts` | c | `contract.ts` |
| storage/read helpers | c | `contract.ts`, db |

`contract.ts` never imports its siblings. If that inverts, it has stopped being a contract.

**Legal pairs are both — runtime structure is the source of truth, type derived from it.** Not two hand-maintained lists; that is the same failure mode used to justify deleting `theme_tokens`.

```ts
export const LEGAL_PAIRS = [
  { fg: "on-surface", bg: "surface", min: 7,   kind: "body"     },
  { fg: "on-brand",   bg: "brand",   min: 4.5, kind: "text"     },
  { fg: "border",     bg: "surface", min: 3,   kind: "non-text" },
] as const satisfies readonly BrandPair[];
```

Three consequences worth having deliberately: the property test iterates `LEGAL_PAIRS` and reads `min` **from the pair** rather than restating D1–D6 — adding a pair automatically adds its assertion, and a pair whose floor was never decided cannot be added because `min` is required. A pair not in the array is not expressible in the type system, so block `tone` typing falls out of the same array. And the agent's instruction data is `JSON.stringify(LEGAL_PAIRS)` — literally the same object, so G6 becomes a serialization of the contract rather than a prose paragraph in a prompt that drifts.

**One addition slice 0 must carry:** the **closed partition of which existing tokens the brand scope may re-declare and which it may not.** This is S15 made machine-readable; without it S15 is a sentence a third implementer reinterprets.

- **Re-declarable:** `--primary`, `--primary-foreground`, `--ring`, `--accent`, `--accent-foreground`, the additive `--brand-*` roles, and `--background`/`--foreground` **bounded by D7**.
- **Never re-declarable:** `--card`, `--popover`, `--muted`, `--muted-foreground`, `--input`, `--border`, `--destructive`, and future `--warning`/`--success`. D6 fixes the semantic three; this extends it to the surfaces a clerk of session reads data on.

### 2. The un-brandable rule — a tripwire on the *emitter*

`scripts/check-brand-scope.mjs`, wired as `check:brand-scope` into the `check` chain. Follows the existing family exactly: plain node, `walk()` over `src/`, regex, non-zero exit, header comment naming the motivating failure.

**(a) The emitter check — the real enforcement.** The brand-scope marker must appear in **exactly** `src/app/(org)/o/[slug]/layout.tsx` and `src/app/(public)/site/[slug]/layout.tsx`. Anywhere else, or missing from an allowlisted file, fails. Sufficient on its own, because under the cascade design a page cannot become branded without an ancestor scope. A route group added in P9 or P10 is un-brandable by default until someone edits the allowlist — a reviewable diff.

**(b) The consumer check — narrow, meaningful only after slice a.** Only the additive `--brand-*` utilities are restricted; everything else re-skins through the cascade and is legal everywhere. A shared component rendered in both `(admin)` and `(org)` may not hard-code a brand class — if it needs emphasis it takes a `tone` prop, the same mechanism G6 requires for the agent.

**The allowlist lives in the script, not imported from `contract.ts`.** The tripwires are `.mjs` with no build step; regex-extracting an array from a `.ts` file breaks on a formatter change. Two duplicated path strings in a file whose whole job is to fail when they change is the right trade.

**⚠ Overturned / extended — the denial-page consequence is right, but the obvious implementation makes it false by default.**

Confirmed without reservation: **the access-denied page must be un-branded**, because a branded 403 tells a prober the org is a configured tenant.

But it does not follow automatically. `o/[slug]/layout.tsx` renders **above** `page.tsx` — above the 403, the ended-relationship page, and `not-found.tsx`. Its own comment says so: *"The header renders on the access-denied, relationship-ended and 404 pages too. That is the point."* Open the brand scope there naively and every denial page renders branded.

The fix is **not** to move the scope down into pages — that makes honouring the brand something an implementer must remember, which Pass 1 says kills S12 within two pipelines. The fix: **the brand read is membership-scoped and returns `null` for a non-member, and the layout paints nothing when it gets `null`.** The layout never gates, never redirects, never varies its structure — it simply has no colours to emit. That composes with the existing deliberate contract that this layout is *not* the gate, and makes the un-branded denial a property of the read path rather than a rule someone must remember at the 403. Wrap it in React `cache()` so it does not double the membership check against the page's `assertOrgAccess`.

**⚠ Overturned — Flow 6's "the church's masthead on the error page."** Flow 6 wants the church's masthead *and* requires the error page to have no dependency on the brand read path. Those are in tension and it resolves one way: **the org error boundary renders un-branded.** The visitor's need — "am I in the right place" — is met by the **organization's name as text** from `publicOrgSummary()`, a narrow public-tree read that already exists and never returns `platform_status`. Colour is not what tells someone they are in the right place; the name is. An error page that paints in the org's brand depends on the read that may have just failed.

**Confirmed: `/developer` stays exempt — structurally, not by policy.** It sits in `(admin)`, imports `developer.css`, scopes its palette under `.reg`, imports none of the shared tokens. Forward constraint: `developer.css` must keep its palette local to `.reg` and never write to `:root`, or it becomes a third emitter.

**One consequence the analyst did not draw.** "Un-brandable" must not be read as "no logos." `/orgs` is un-brandable and yet is precisely where a congregation's mark is most useful, because G3 says two churches named "First Presbyterian Church" is the common case. The distinction: **brand-as-chrome is scoped and forbidden outside the two layouts; logo-as-content is a component on a neutral plate and is legal anywhere the caller is authorized to see it.** State it, or someone strips the marks off the chooser to satisfy the tripwire.

### 3. The logo's read path

Same adapter, different gate, different route, different cache posture. **The adapter is not what diverges — the authorization wrapped around it is.**

- **The public read is not a new endpoint keyed by slug.** A standalone public `getBrand(slug)` or `/api/brand/<slug>` is an **enumeration oracle**: query any slug, learn whether it is configured, learn whether it is a tenant. Instead the brand payload and logo asset key are **fields of the DECISION-041 published-content projection**, returned by the same narrow SECURITY DEFINER function on the same published-site condition. The gate for "may a stranger see this congregation's colours" becomes identical to "may a stranger see this congregation's homepage" — a gate that already has to be right.
- **`getPlatformDb()` stays forbidden in `(public)`.**
- **Caching: content-addressed plus immutable.** `/site/<slug>/brand/<assetHash>.<ext>`, `max-age=31536000, immutable`, strong ETag, sniffed content-type allowlist (SVG rejected per G7), `nosniff`, no `Vary: Cookie`. **This is the single property that makes DECISION-030's bytes-in-Postgres survivable on an anonymous path served on every page load.**
- **One route handler per trust class.** No polymorphic `/api/assets/<key>` deciding authorization by inspecting the key — that is the exact shape in which a bug serves a tier-1 person photo to a stranger.
- **Favicon and social card derive at write time, not request time.** **This is the one likely new runtime dependency in the pipeline** (an image encoder) and it is explicitly **not** pre-approved — it belongs to slice c and needs its own five-criteria pass. Named now so it is not discovered at Phase 4, which is what happened twice with the Radix umbrella.
- G7's "never composite a logo onto a brand-coloured or dark surface" is a component invariant belonging in `org-mark.tsx` next to the initials fallback. Reuse `src/lib/initials.ts`; do not write a second one.

### 4. Brand storage placement

**Its own table: `organization_brands`, PK `organization_id`.** Against jsonb on DECISION-033's precedent verbatim — hot read path, CHECK constraints with teeth, and a blob deciding what colour 200 congregations render is "whatever last wrote the blob."

**Also not columns on `organizations`, and this is tempting enough to name.** That table carries a bare `grant select to presby_app` with no policy precisely because the org tree is public. Putting brand there would make **every congregation's brand readable by any authenticated caller with no org context** — the enumeration oracle again, arrived at by following an existing precedent. And it would make the public tree a write target for tenant admins.

- `FORCE RLS`, policy `organization_id = presby_current_org()`, read inside `withOrgContext()`.
- The composite-key invariant is satisfied **degenerately** — the PK *is* `organization_id`, one row per org, no second key to compose. State it in the migration comment or the next reviewer "fixes" it.
- **No public grant on this table. Ever.** Write it as a comment on the grant line, because "follow the `organizations` pattern" is the wrong instinct here and looks right.
- Typed columns: seed hex with `CHECK (~ '^#[0-9a-f]{6}$')` — **A7's "never echo the user's string" gets database-level teeth, not just server-side discipline** — `type_pairing` CHECKed against the curated enum, `mark_asset_key`, `wordmark_asset_key`, `brand_token_version` (D8, pinned per org), `updated_at`, `updated_by`.
- **"Restore previous brand" gets a history table, not `previous_*` columns.** Flow 2 wants a swatch *and a date*; A13 wants version pinning; the audit story is "who made our website purple." One previous-value column answers exactly one restore and then loses the trail.

**`platform_status` non-revelation now holds by construction:** the tenant path keys on membership, the public path on published-site status, and neither answers "is this arbitrary slug a tenant."

**Delete `theme_tokens jsonb` from `docs/schema-design.md` §14 — confirmed.** Plus: the earlier pipeline's **G6** (which constrained `theme_tokens` to a fixed set) is **superseded** by this contract and should be marked as such, or a future reader reintroduces it as a quick win during P3.

**Unsolicited and cheap: take OQ4.** Once the table exists, "congregations still on the default palette" is a `LEFT JOIN … WHERE brand IS NULL` against the `(admin)` organizations surface S18 already approved.

### 5. The `radix-ui` umbrella, and the radius remap

**Do not adopt. Automate the correction and give it a tripwire.**

Two occurrences, two hand-reverts, and slice a is about to run `shadcn add` ten-plus times. Hand-reverting ten times in one slice is where the third occurrence becomes the *silent* one. A comment asking the next human to remember is not a mitigation, it is a note.

Against the five criteria: already solved (five `@radix-ui/react-*` are direct deps covering every use — the umbrella is the same code re-packaged); maintained and compatible; Edge-irrelevant; **bundle roughly neutral — the real cost is supply-chain surface**, ~40 packages in the audit and update path to use six, in a repo whose charter is a small auditable baseline; MIT either way.

The honest argument *for* adopting is that generated code then works untouched, and a manual step that must be repeated has now failed twice. That is taken seriously — which is why the answer is not "keep hand-rewriting."

- **`npm run ui:add`** — wraps the CLI, rewrites `from "radix-ui"` to individual packages, normalises `X.Root` → `X`, then restores `package.json`/lock and `npm ci`. Exactly what the ux-developer did by hand twice, correctly. An hour to encode, permanently removes the failure mode.
- **`check:deps-drift`** — `radix-ui` absent from dependencies, and no `src/` file imports from it. Converts "an implementer must remember to md5 the lockfile" into a build failure.
- **CLAUDE.md gains `npm run ui:add`**; `ui-standards.md` says raw `shadcn add` is not the supported path.

**Rejected alternative, recorded so it is not relitigated:** a tsconfig `paths` alias to a local shim. Elegant, and it solves only the smaller half — the CLI installs the umbrella from the registry manifest, not from module resolution, so `package.json` still gets edited. It also adds a resolution trap: an alias shadowing a real package name silently wins over a genuine install.

**Radius remap: approve, in slice a, bounded.** The primitives generated *in this slice* bake `rounded-md`; deferring means a second visual sweep later. Choose `--radius` so **`rounded-md` computes to today's `0.375rem`** — turning a whole-app visual change into a small enumerable set of deltas. **And `--radius` is a platform token, NOT per-org brandable in v1** — a congregation does not choose corner radius; it is D8-style extensibility creep and it multiplies the 360px verification surface G11 already flags.

**Two smaller findings for slice a:** `button.tsx` carries non-stock size variants (`xs`, `icon-xs`, `icon-sm`, `icon-lg`) and `data-variant`/`data-size` attributes with **zero consumers anywhere in `src/`** — dead variants in a generated file are lost on regeneration and not worth recovering; delete them or record the delta in a header comment the way `dropdown-menu.tsx` records its import correction. Silent divergence from the registry in a file marked "do not hand-edit" is a quiet invariant violation.

### 6. Server-side emission with no client theme provider

**Achievable in `(org)` as it stands. Not confirmable in `(public)` — that group does not exist yet**, so this is a constraint placed on P3 rather than a confirmation.

**⚠ Extended — emit a `:root`-scoped `<style>` element, not an inline `style` on a wrapper `<div>`. This is the most likely defect in slice c and it is invisible in a screenshot.**

A wrapper div is the obvious implementation and it is subtly wrong, because **portals escape it.** Radix `DropdownMenu.Portal` and `Dialog.Portal` render into `document.body`, and `<Toaster>` lives in the root layout — all outside any wrapper inside `(org)`. A branded portal renders in platform default, and you notice only by opening a dropdown, which no page screenshot captures.

A `<style>` element covers portals, covers the toaster, and does not leak: each request renders one route, so a rule emitted only under `(org)` cannot reach `(admin)`. The tripwire still enforces two layouts, and Flow 5's `data-sealed` reset still wins by specificity.

**Forward constraint, cheap now and expensive later: CSP.** DECISION-024 ships report-only CSP and defers enforcement to forks. An inline `<style>` needs `style-src 'unsafe-inline'` or a nonce. **The brand style element must be nonce-able from day one**, or the first fork that enforces CSP breaks every branded page and cannot diagnose why.

**Reconciling `next-themes` with "no client theme provider" — two different flashes, and Phase 3 must not conflate them.** The *org* flash (Flow 4) is solved entirely by server-side emission; `next-themes` contributes nothing. The *scheme* flash is what its pre-paint script solves, and nothing installed addresses it.

**Ruling: the brand style element always emits BOTH ramps, and `next-themes` selects between them with a class.** `:root{…light…}` and `.dark{…dark…}` in one element. Emitting only the "current" scheme server-side would force a re-render on toggle and reintroduce a flash on the scheme axis — the exact bug next-themes exists to prevent, re-created by the brand system. D11 already requires both ramps to exist.

**`next-themes` approved for slice a** (~2KB, MIT, React 19 compatible, nothing installed does pre-paint selection). Three things Phase 3 must plan for: the provider is `'use client'` in the root layout wrapping **every** surface including un-brandable ones (correct — scheme is not brand), `suppressHydrationWarning` on `<html>`, and `<Toaster theme="system">` must read the resolved theme.

**⚠ One divergence between S17's wording and what the library does.** S17 says the preference is **account-level**; `next-themes` persists to `localStorage`, which is **device-level**. Account-level is a `users` column plus a server-rendered initial class, with `next-themes` as the client applier seeded from it. **Slice a ships system/localStorage mode only**; the account-level column arrives with the account-surface work. Flagged rather than quietly shipping device-level and calling S17 satisfied.

## Scope order

**The analyst is right about slice a, and the repo backs it with numbers.** Seven files hand-roll `<table>`; roughly **twenty-four** hand-roll button-shaped class strings; only seven import `<Button>` at all. Under the cascade design, a hand-rolled `bg-blue-600` **does not re-skin** — no cascade reaches a literal. So slice a is the difference between "the brand reaches every surface" and "the brand reaches the surfaces that happened to use a primitive." Defer it and S12 is false on day one, and you find out when a church asks why their admin tables are still blue. **Confirmed.**

**Strengthening:** slice a is also what makes the consumer tripwire *enforceable* — a grep for hard-coded colour utilities cannot be turned on while ~24 violations exist. Slice a should end as slice B ended: the consumer rule confirmed **failing pre-migration and passing after**.

**Parallel or sequential: sequential on the token partition, parallel on the mechanics.**

May start immediately: umbrella resolution, `ui:add`, `check:deps-drift`, radius remap, `.dark` + `next-themes`, `alert-dialog` regeneration, generating the new primitives.

Must wait for slice 0's merged partition: rewriting the 7 tables and ~24 button sites — because that rewrite is exactly where a developer decides, per surface, whether a colour is *emphasis* or *content*. Migrating 24 files against an unwritten contract means migrating them twice.

**They must not be one commit.** The mechanics are reviewable; the sweep is reviewable; together they are a diff nobody reads.

## Invariants Touched

| Invariant | Effect |
|---|---|
| **Isolation Is a Database Property** | Extended. `organization_brands` is FORCE RLS read through `withOrgContext()`; public read is the narrow SECURITY DEFINER function. **New teeth:** explicit prohibition on a bare public grant — the enumeration oracle reached by following the `organizations` precedent. |
| **Composite Tenant Keys** | Satisfied degenerately — PK *is* `organization_id`. Must be stated in the migration comment or it reads as an oversight. |
| **Two Hierarchies Intersect Nowhere** | Structural, not a rule to remember: the read keys on `organization_id` alone with no recursion, so no path walks `path` or `parent_id` in either direction. Slice c's sponsor→new-worshiping-community is a **copy**, never a link. |
| **Permissions vs Flags** | `ui.brand_theming` is a flag; per-org branding on/off is the presence of a row (tenant state); `org.branding` is a tenant key landing with P1. `src/lib/permissions.ts` stays FROZEN. |
| **Extensibility Goes Through Support (D8)** | Reinforced twice — closed token vocabulary, and `--radius` is a platform token a congregation may not set. |
| **Verify in a Browser** | The reason ruling 6 exists. Portals escaping a wrapper div passes `tsc`, `next build`, and a page screenshot. G11's screenshot-diff requirement is the right instrument and is not weakened. |
| **CLAUDE.md changes** | **Two, at slice a**, owned by tech-lead: Common Commands gains `ui:add` and the two new tripwires (`check` becomes four); Component Rules gains the brand-scope rule and Route Group Rules gains one line naming `(org)` and `(public)` as the only brandable groups. |

## Notes for Phase 3

1. **The brand read is membership-scoped and returns `null` for a non-member**; the layout paints nothing on `null`. Wrap in `cache()`.
2. **Emit a `:root`-scoped `<style>` element, not a wrapper div.** Portals. And make it nonce-able.
3. **Both ramps in one element**, `.dark` selecting. Org flash and scheme flash are different problems.
4. **The brand payload is a field of the published-content projection**, not a public endpoint keyed by slug.
5. **No public grant on `organization_brands`.** Say it on the grant line.
6. **Content-addressed, immutable logo URLs.** What makes bytes-in-Postgres affordable on an anonymous path.
7. **One asset route per trust class.**
8. **Slice 0's re-declarable/never-re-declarable partition is a closed machine-readable list**, not prose. It is S15 made buildable.
9. **`contract.ts` has zero runtime imports.**
10. **The 24-file sweep waits for slice 0; the mechanics do not.** Separate commits.
11. **The consumer tripwire must be demonstrated failing pre-migration and passing post**, per slice B's precedent.
12. **Unresolved dependency, slice c:** the image encoder for write-time favicon/social derivation. Its own five-criteria pass. Do not let it arrive as a surprise at Phase 4 — that is how the Radix umbrella arrived twice.
13. **`next-themes` ships system/localStorage in slice a.** S17's account-level persistence is a `users` column and is not slice a.
14. **Recommend taking OQ4** in slice c.

---

# Phase 3 — Technical Design (tech-lead)

*Scoped to slices **0** (token contract) and **a** (primitive migration) only. Slices b–e are not designed here. Phases 5 and 6 remain deferred per DECISION-045 — with one exception named in Edge Cases (E1): the **Phase 4** auth-e2e gate is not a Phase 5 gate and is not deferred.*

## Summary

Slice 0 writes the contract that every later slice and every future pipeline reads: a closed role vocabulary, `LEGAL_PAIRS` as a runtime array whose type is derived from it and whose contrast floor rides on each pair, a **three-way** (not two-way) partition of every custom property `globals.css` declares into *brandable / bounded / platform*, the type scale, and `BRAND_TOKEN_VERSION`. Slice a then makes S12 mechanically achievable: it normalises primitive generation so the Radix umbrella cannot return, switches the colour scheme from a media query to a class so both ramps can coexist in one emitted element, generates the five primitives the sweep actually consumes, and rewrites 28 files' worth of hand-rolled buttons, 6 hand-rolled tables and 14 hand-rolled inputs onto those primitives — because under DECISION-046's cascade design a hand-rolled class string is a surface the brand can never reach.

**Two findings during this design change the shape of both slices, and in both cases the code contradicted the inherited assumption.** First: **the platform's own default palette fails six of the floors the contract is about to declare** — including a focus ring that is mathematically invisible on the primary button (1.00:1) and secondary body text at 4.70:1 against a 7:1 floor. A contract whose reference implementation violates it is a lie from commit one, so slice 0 corrects the palette and ships the test that proves it. Second: **"zero user-visible change" is not achievable for slice a and was never going to be** — a shadcn `<Table>` and a shadcn `<Button>` have their own geometry, so migrating onto them *is* a visual change. Section "Acceptance criteria" replaces the blanket claim with a three-category criterion that can actually be proved.

## Permissions & Flags

- **Permission key(s): none.** `org.branding` is slice d and depends on P1's tenant catalog. `src/lib/permissions.ts` stays FROZEN. Nothing in slices 0 or a is reachable by a user as a feature.
- **Default role bindings: none.** No `FEATURE_CATALOG` entry, no seed change.
- **Feature flag(s): none.** `ui.brand_theming` gates *emission*, which is slice c. Phase 1 is explicit that there is **no flag on the primitive migration** — a half-migrated UI behind a flag is two UIs. Slice a ships unflagged and is reverted by revert, not by switch.
- **Audit events: none.** No mutation in either slice.

This is worth stating plainly because it is unusual: **slices 0 and a add no route, no action, no table, no permission and no flag.** Everything below is contract, tooling, tokens and markup.

## API Contract

No HTTP routes and no server actions. The contract here is a **module surface** and a **CLI surface**, and implementers should follow these signatures literally.

### `src/lib/brand/contract.ts` — data only, ZERO runtime imports

Not `server-only` (precedent: `src/lib/utils.ts:6-8`). Type-only imports permitted; no `@/lib/db`, no `next/*`, no `react`, no `drizzle`, **and no import of its own siblings including `contrast.ts`**. Four consumers named in the header comment: server components, `generate.ts` (slice b), the property test, and the `.mjs` script that emits the cron agent's instruction payload.

```ts
export const BRAND_TOKEN_VERSION = 1;

/** The closed role vocabulary. An agent composes roles; it never sees a hex. */
export const BRAND_ROLES = [
  "surface", "on-surface",
  "brand", "on-brand",
  "brand-raw", "on-brand-raw",
  "muted-surface", "on-muted-surface",
  "border", "input-border", "ring",
  "danger", "on-danger",
] as const;
export type BrandRole = (typeof BRAND_ROLES)[number];

/** Role → the CSS custom property it resolves to. Total over BRAND_ROLES. */
export const ROLE_TO_TOKEN = {
  surface: "--background",
  "on-surface": "--foreground",
  brand: "--primary",
  "on-brand": "--primary-foreground",
  "brand-raw": "--brand-raw",
  "on-brand-raw": "--brand-raw-foreground",
  "muted-surface": "--muted",
  "on-muted-surface": "--muted-foreground",
  border: "--border",
  "input-border": "--input",
  ring: "--ring",
  danger: "--destructive",
  "on-danger": "--destructive-foreground",
} as const satisfies Record<BrandRole, TokenName>;

export type BrandPair = {
  readonly fg: BrandRole;
  readonly bg: BrandRole;
  readonly min: number;      // WCAG contrast floor for THIS pair
  readonly kind: "body" | "large-text" | "non-text";
  readonly derives: string;  // "D1" … "D5" — traceability to Phase 1
};

export const LEGAL_PAIRS = [
  { fg: "on-surface",      bg: "surface",       min: 7,   kind: "body",      derives: "D1" },
  { fg: "on-muted-surface",bg: "surface",       min: 7,   kind: "body",      derives: "D1" },
  { fg: "on-muted-surface",bg: "muted-surface", min: 7,   kind: "body",      derives: "D1" },
  { fg: "on-brand",        bg: "brand",         min: 4.5, kind: "text",      derives: "D2" },
  { fg: "on-brand-raw",    bg: "brand-raw",     min: 4.5, kind: "large-text",derives: "D2" },
  { fg: "on-danger",       bg: "danger",        min: 4.5, kind: "text",      derives: "D2/D6" },
  { fg: "input-border",    bg: "surface",       min: 3,   kind: "non-text",  derives: "D3" },
  { fg: "ring",            bg: "surface",       min: 3,   kind: "non-text",  derives: "D4" },
  { fg: "brand",           bg: "surface",       min: 3,   kind: "non-text",  derives: "D3" },
] as const satisfies readonly BrandPair[];
export type LegalPair = (typeof LEGAL_PAIRS)[number];
export type LegalTone = LegalPair["bg"];   // block `tone:` typing falls out of the array
```

Three deliberate choices inside that array, each of which a reviewer should check rather than assume:

- **`border` is not in `LEGAL_PAIRS`; `input-border` is.** D3 as Phase 1 wrote it names *input borders, focus rings, icon-only affordances*. A card edge and a table rule are decoration, not "visual information required to identify a component." Today `--border` and `--input` carry the identical value `hsl(214 32% 91%)` — 1.24:1 against the page. Splitting them is what lets the control border reach 3:1 without repainting every card edge in mid-grey. Companion rule for `ui-standards.md`: **a border that identifies a control uses `border-input`; a border that separates content uses `border`.**
- **D4 becomes structural, and this is a correction to the code, not just the contract.** D4 wants the ring to clear ≥3:1 against *both* the surface and the control it rings. Today `--ring` is byte-identical to `--primary`, so the focus ring on the default `<Button>` is **1.00:1 — invisible, shipped, in both schemes**. Deriving a per-org ring that clears its own brand fill is possible but fragile at every seed. The robust fix is geometric: **every focus ring is drawn with an offset in the surface colour**, so it is never adjacent to the control it rings. With the offset, D4 reduces to `ring on surface ≥ 3`, which is the pair above and holds for every seed. Primitive consequence in slice a: `focus-visible:ring-offset-2 focus-visible:ring-offset-background` is added to `button`, `badge` and `input`, and recorded as a deliberate registry divergence in each file's header comment (precedent: `dropdown-menu.tsx:5-11`).
- **D6 is not a contrast pair.** "Minimum perceptual distance between `primary` and `destructive`" is a hue/ΔE question, and computing it as a WCAG ratio produces nonsense (today's blue-vs-red scores 1.08, which says nothing). It ships as a separate constant, `MIN_BRAND_DANGER_HUE_DISTANCE_DEG = 45`, enforced by slice b's generator, documented here so slice b does not re-derive it.

```ts
export type TokenPolicy = "brandable" | "bounded" | "platform";
export type TokenEntry = {
  readonly token: TokenName;
  readonly policy: TokenPolicy;
  readonly additive?: true;   // not present in globals.css :root today
  readonly bound?: string;    // named constraint slice b's generator must implement
  readonly why: string;       // one sentence, quotable in a review
};
export const TOKEN_POLICY = [ /* every token, exactly once — table below */ ] as const;

export const BRAND_SCOPE_SELECTOR      = ":root:root";
export const BRAND_SCOPE_SELECTOR_DARK = ":root:root.dark";

export const TYPE_SCALE = [ /* table below */ ] as const;
export const MIN_BODY_PX = 16;
export const MIN_MEMBER_FACING_PX = 14;
export const MIN_TOUCH_TARGET_PX = 44;
export const MIN_BRAND_DANGER_HUE_DISTANCE_DEG = 45;

/** The platform default palette, in both schemes. globals.css transcribes THIS. */
export const PLATFORM_TOKENS = {
  light: { /* token → colour string */ },
  dark:  { /* token → colour string */ },
} as const;
```

### `src/lib/brand/contrast.ts` — pure WCAG math, ZERO runtime imports

Slice 0 needs contrast math to prove the platform palette meets its own floor, and slice b needs the same math inside the generator. Duplicating it is how the two drift, so it ships once, now.

```ts
export function parseColor(css: string): { r: number; g: number; b: number };  // hsl() and #rrggbb only
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number;
export function contrastRatio(a: string, b: string): number;                   // WCAG 2.1, ≥1
export function meets(pair: BrandPair, fg: string, bg: string): boolean;       // type-only import of BrandPair
```

`contrast.ts` imports `contract.ts` for the `BrandPair` **type only** (`import type`), which keeps both at zero runtime imports.

### `npm run ui:add -- <component…>` (`scripts/ui-add.mjs`)

The only supported way to generate a shadcn primitive in this repo. Raw `npx shadcn add` is documented as unsupported in `ui-standards.md` and CLAUDE.md.

1. Snapshot `package.json` and `package-lock.json` into memory; refuse to run if `git status --porcelain` shows either already dirty.
2. `npx shadcn@latest add --yes --overwrite <component…>`, stdio inherited.
3. For every file under `src/components/ui/` that `git status --porcelain` now reports as added or modified, rewrite each `radix-ui` umbrella import to the individual package: `import { Foo as FooPrimitive } from "radix-ui"` → `import * as FooPrimitive from "@radix-ui/react-<kebab(Foo)>"`.
   **Correction to the architect's Note:** *no `X.Root` → `X` member-access normalisation is required.* A namespace import of `@radix-ui/react-dropdown-menu` exposes `.Root`, `.Trigger` and friends exactly as the umbrella's namespace does — the hand-corrected `dropdown-menu.tsx` in the tree today is proof (`DropdownMenuPrimitive.Root`, line 17). Rewriting the import line is the whole job; rewriting member accesses would be a second, fragile regex with nothing to fix.
4. Restore `package.json` + `package-lock.json` from the snapshot; `npm ci`.
5. **Fail loudly if any rewritten import targets a package that is not already in `dependencies`.** Message: the package names, and "these are new runtime dependencies. They need the architect's five-criteria pass (CLAUDE.md → Agent Roster, Phase 2) before they can be installed. Install deliberately, then re-run." *This step is the whole point of the script:* the Radix umbrella arrived twice as a surprise at Phase 4, and this converts "surprise dependency" into "build stops and names it."
6. Run `node scripts/check-deps-drift.mjs`.
7. Print: primitives are generated files — record any deliberate divergence from the registry in a header comment, the way `dropdown-menu.tsx` does.

### `npm run check:deps-drift` (`scripts/check-deps-drift.mjs`)

Follows the existing family exactly — plain node, `walk()` over `src/`, regex, non-zero exit, header comment naming the motivating failure (F-B1, two occurrences, two hand-reverts). Three rules:

1. `radix-ui` appears in neither `dependencies` nor `devDependencies` of `package.json`, nor as a root dependency in `package-lock.json`.
2. No file under `src/` contains `from "radix-ui"`.
3. Every `@radix-ui/react-*` specifier imported anywhere under `src/` is present in `package.json` `dependencies`. (Catches a rewrite to a package nobody installed — the failure mode step 5 of `ui:add` prevents at generation time and this one prevents at merge time.)

### `npm run check:brand-scope` (`scripts/check-brand-scope.mjs`)

Same family. The allowlist is **two path strings literal in the script**, not imported from `contract.ts` — the tripwires are `.mjs` with no build step, and regex-extracting an array out of a `.ts` file breaks on a formatter change. Duplicating two paths in a file whose entire job is to fail when they change is the correct trade (architect, §2; confirmed).

```js
const EMITTERS = [
  { path: "src/app/(org)/o/[slug]/layout.tsx",      required: false }, // slice c flips → true
  { path: "src/app/(public)/site/[slug]/layout.tsx", required: false }, // P3 creates the file; slice c flips
];
```

Four rules, with a staged rollout that is honest about what exists today:

- **E1 — emitter containment (on from slice a).** The marker `<BrandTokens` may appear in **no file outside `EMITTERS`**. At slice a it appears nowhere, so E1 is a ratchet placed before the thing it guards — which is the only time a ratchet is free.
- **E2 — emitter presence (off until slice c).** Each `EMITTERS` entry with `required: true` whose file exists must contain the marker. Slice c flips both flags in a one-line, reviewable diff. A route group added in P9 is un-brandable by default until someone edits this array.
- **E3 — no second emitter (on from slice a).** No file under `src/` outside `src/components/brand/` may contain the string `<style` or `dangerouslySetInnerHTML`. **Verified enforceable today at zero violations** — `src/` contains no `<style` element and no real `dangerouslySetInnerHTML` (the three grep hits are comments asserting the XSS invariant, which E3 must not trip on: match on `<style` and on `dangerouslySetInnerHTML=` in non-comment lines, reusing `check-sql-date.mjs`'s comment-skipping shape). This clause is what stops someone copy-pasting the `<style>` body into a third layout and sailing past a grep for the component name.
- **C1 — brand-class containment (on from slice a, vacuous until slice c).** No `(bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-brand(-[a-z0-9-]+)?` utility outside the two brandable groups. A shared component rendered in both `(admin)` and `(org)` takes a `tone` prop instead — the same mechanism G6 requires of the agent.
- **C2 — no hand-rolled primitives (turned on at the END of the sweep, a8).** No class string outside `src/components/ui/` may match *button-shaped* (`rounded-*` **and** `px-<n>` **and** `font-medium|font-semibold`) or *table-shaped* (a literal `<table` element). Escape hatch `// ui-ok: <reason>` on the line above, matching `check-sql-date.mjs`'s convention. `src/app/(admin)/developer/**` is exempt by path (it is a hand-set register with its own `.reg`-scoped palette and no shared tokens — verified: `developer.css` declares every value under `.reg`, never `:root`).

**⚠ Correction to the architect, and the code is the reason.** Phase 2's "Scope order" says the consumer rule "cannot be turned on while ~24 violations exist" and Note 11 asks for it to be demonstrated failing pre-migration and passing after. But §2(b) and DECISION-047 define the consumer rule as the **`--brand-*` clause** — and there are **zero** `--brand-*` utilities in the tree today and there will be zero until slice c, so that clause is vacuously true and cannot be demonstrated failing against real code. The clause that *does* have violations to clear is C2, and the census is worse than "~24": **44 button-shaped class strings across 28 files, 14 input-shaped across 9, and 7 files containing `<table>` (6 in scope; `developer/tables/[table]/page.tsx` is the exempt seventh).** So Note 11's demonstration attaches to **C2**, is real, and is the a8 commit. C1's equivalent proof is a fixture test on the checker itself (`scripts/check-brand-scope.test.mjs` — vitest already includes `scripts/**/*.test.mjs`), which is the honest way to prove a rule that has nothing to catch yet.

**Explicitly NOT a consumer rule: literal palette colours.** The census found **47 hard-coded Tailwind palette utilities across 21 files** (`bg-green-500/10`, `text-amber-700 dark:text-amber-300`, and so on) — and they are almost entirely *status chips*, which D6 says are platform-fixed and never derived. Banning them requires semantic tokens (`--success`, `--warning`, `--info`, each needing a fill/subtle-fill/foreground triple) that do not exist and whose design is a real exercise. **Out of scope for slice a; goes to `docs/TODO.md`** (see Out of Scope). Anyone reading "the sweep is done" as "all colour is tokens now" would be wrong, so it is written down here.

### The brand-scope marker — decided

**It is a server component, `<BrandTokens>` at `src/components/brand/brand-tokens.tsx`, and it *is* the `<style>` element.** Not a `data-brand-scope` attribute.

The reason is DECISION-050. The emitter is a `:root`-scoped `<style>` precisely because portals escape a wrapper element — so a `data-brand-scope` attribute would mark a wrapper that does no work. The marker and the behaviour would then be two facts that can disagree in both directions: an attribute present with no emission, an emission with no attribute. Making the component the emitter collapses them into one fact, which is the most honest thing a grep can be pointed at. E3 closes the remaining hole (copy the `<style>` body somewhere else without importing the component).

Signature, so slice c has nothing to invent:

```ts
// src/components/brand/brand-tokens.tsx — server component, no 'use client'
export function BrandTokens(props: {
  brand: BrandTokenSet | null;   // null → renders null. THIS is how the 403 stays un-branded.
  nonce?: string;                // DECISION-024 forward constraint; nonce-able from day one
}): React.ReactElement | null;
```

Two mechanics slice c must not rediscover:

- **Render `<style>{cssText}</style>` with a plain string child — never `dangerouslySetInnerHTML`.** React 19 renders text children of `<style>` verbatim, the CSS text is built from parsed numbers only (A7), and it contains no `<` or `&`. This keeps DECISION-041's "no `dangerouslySetInnerHTML` in `(public)`" literally true rather than carved out.
- **Do not pass React 19's `precedence` prop.** `precedence` hoists the style into React's managed head ordering, and nothing guarantees that lands *after* `globals.css`. Instead the emitted rules are specificity-armored: `:root:root { … }` and `:root:root.dark { … }` (exported as `BRAND_SCOPE_SELECTOR` / `..._DARK` so the emitter and its test share one string). `:root:root` is 0,2,0 and beats globals.css's `:root`; `:root:root.dark` is 0,2,1 and beats it in turn; platform tokens the brand does not own are untouched and cascade normally. Source-order dependence is exactly the kind of defect that passes `tsc`, `next build` and a page screenshot — which is the architect's own stated reason for ruling out the wrapper div.

## Data Model

**No schema changes required in slices 0 or a.** No table, no column, no index, no migration, no `db:push`. `organization_brands` (DECISION-049) is slice c; the account-level colour-scheme column (DECISION-050, S17) is the account-surface work and is explicitly not slice a.

## Component / Page Plan

### Slice 0

**Files to create**
- `src/lib/brand/contract.ts` — as specified above.
- `src/lib/brand/contrast.ts` — as specified above.
- `src/lib/brand/contract.test.ts` — three test groups, described under Implementation Order. This is the highest-value artifact in the slice.

**Files to modify**
- `src/app/globals.css` — token *values* only (below). No new tokens, no structural change; the `@theme inline` block and the `@layer base` block are untouched in slice 0.
- `docs/ui-standards.md` — the visual rewrite (below).

**The three-way partition, verified against `globals.css` as it actually is today.** The architect's starting partition named 14 of the file's 20 declared properties and left six unclassified; a partition with holes is not closed, and the six holes are the tokens a reviewer is most likely to guess wrong about. Corrected and complete:

| Token | Policy | Why |
|---|---|---|
| `--primary` | **brandable** | The brand fill. S15's emphasis axis. |
| `--primary-foreground` | **brandable** | Computed, never fixed white (D2). |
| `--ring` | **brandable** | Focus ring; ≥3:1 on surface, offset makes the control clause structural (D4). |
| `--brand-raw` | **brandable**, additive | The unmodified seed, decorative surfaces only (D10). Not in `globals.css` until slice c. |
| `--brand-raw-foreground` | **brandable**, additive | A hero band carries text; that text needs a computed foreground. |
| `--background` | **bounded** — `nearWhiteOrNearDarkBand` | D7. A congregation may have a cream page; they may not have a gold page. |
| `--foreground` | **bounded** — `computedFor(--background, 7:1)` | Follows the background or D1 breaks. |
| `--accent` | **bounded** — `nearNeutralTintWithin(--muted)` | ⚠ **Overturns the architect, who listed it plainly re-declarable.** `globals.css:49` says in its own comment that accent is "a subtle hover/active surface — not the brand colour," and it is what every dropdown item hover and every `ghost`/`outline` button hover paints with. Free re-declaration turns menu hover into a burgundy block behind *content*-axis text, which is the exact collision S15 exists to prevent. Bounded satisfies S15's "selected/active states are brand-driven" as a tint. |
| `--accent-foreground` | **bounded** — `computedFor(--accent, 7:1)` | Menu item labels are content; 7:1, not 4.5:1. |
| `--card` | platform | A clerk of session reads data on it. |
| `--card-foreground` | platform | ⚠ Unclassified by the architect. If `--card` is fixed its foreground must be too, or the pair is unverifiable. |
| `--popover` | platform | As `--card`. |
| `--popover-foreground` | platform | ⚠ Unclassified by the architect. |
| `--muted` | platform | Content axis. |
| `--muted-foreground` | platform | Content axis, and the D1 pair the platform must guarantee for everyone. |
| `--secondary` | platform | ⚠ Unclassified by the architect. Today it is byte-identical to `--muted`: a neutral chip/secondary-button surface, i.e. content. Brandable would give a page two competing brand fills with no rule for which wins. |
| `--secondary-foreground` | platform | ⚠ Unclassified by the architect. |
| `--destructive` | platform | D6. |
| `--destructive-foreground` | platform | ⚠ Unclassified by the architect. D6 covers the pair, not just the fill. |
| `--border` | platform | Decorative separators. |
| `--input` | platform | Control identification (D3). Fixed so the 3:1 guarantee cannot be lowered per org. |
| `--radius` | platform, non-colour | DECISION-048. A congregation does not choose corner radius. |
| `--success` / `--success-foreground` / `--warning` / `--warning-foreground` / `--info` / `--info-foreground` | platform, **reserved** | Named now so the partition stays closed when the semantic-token slice lands. Listing a token that does not exist yet costs nothing and prevents the next author from treating "unlisted" as "brandable." |

That is 20 declared properties + 2 additive + 6 reserved, every one classified exactly once. **Closure is enforced, not asserted:** `contract.test.ts` reads `src/app/globals.css`, extracts the custom-property names declared in `:root`, and asserts that set is exactly the set of non-additive, non-reserved entries in `TOKEN_POLICY`. The day someone adds a token to `globals.css` without classifying it, the test fails and names it. Vitest already runs in-repo file reads and needs no new dependency.

**The platform default palette does not meet the floor the contract declares. Six pairs fail.** Measured against the current values in `globals.css`:

| Pair | Light | Dark | Floor | |
|---|---|---|---|---|
| `foreground` on `background` | 17.87 | 17.08 | 7 | pass |
| **`muted-foreground` on `background`** | **4.70** | **6.97** | 7 | **FAIL** |
| **`muted-foreground` on `card`** | **4.70** | **5.78** | 7 | **FAIL** |
| **`muted-foreground` on `muted`** | **4.29** | **5.78** | 7 | **FAIL** |
| `primary-foreground` on `primary` | 5.17 | 4.91 | 4.5 | pass |
| **`destructive-foreground` on `destructive`** | 4.80 | **3.61** | 4.5 | **FAIL (dark)** — fails plain AA, not just AAA |
| **`input` on `background`** | **1.24** | **1.43** | 3 | **FAIL** |
| **`ring` on `primary`** | **1.00** | **1.00** | 3 | **FAIL** — `--ring` is byte-identical to `--primary`; the focus ring on the default button is invisible today, in both schemes |
| `ring` on `background` | 5.17 | 4.91 | 3 | pass |

`muted-foreground` alone is **244 `text-sm text-muted-foreground` sites**. This is not a theoretical gap.

**Ruling: slice 0 corrects the palette, in the same commit as the contract.** The alternatives were considered and rejected: shipping a contract its own reference implementation violates makes the contract decorative from commit one; a `KNOWN_VIOLATIONS` list is the "I accept the risk" checkbox Phase 1 says is not a floor; and deferring means every surface P1 and P3 build gets built against a palette that fails. The correction is five values and one class string, and it is *provable* rather than argued. **It is, however, a deliberate user-visible change, and slice 0 is therefore no longer a "no visual change" slice** — that line in Phase 1's decomposition is superseded here, on purpose, with the numbers above as the argument. If the operator would rather take the palette correction separately, the clean cut is to hold commit 0.1 and land the contract with the *current* values plus a failing test marked `.fails()` — I recommend against it and have designed for the correction landing.

Values, computed and ready to transcribe (`contract.test.ts` re-verifies them, so an arithmetic slip fails at implementation rather than in production):

| Token | Scheme | From | To | Result |
|---|---|---|---|---|
| `--muted-foreground` | light | `hsl(215 16% 47%)` | `hsl(215 16% 33%)` | 7.92 on background, 7.23 on muted |
| `--muted-foreground` | dark | `hsl(215 20% 65%)` | `hsl(215 20% 73%)` | 8.89 on background, 7.37 on card |
| `--destructive` | dark | `hsl(0 84% 60%)` | `hsl(0 84% 48%)` | 4.87 against white foreground; still 3.67 against the page |
| `--destructive-foreground` | dark | `hsl(210 40% 98%)` | `hsl(0 0% 100%)` | pairs with the above |
| `--input` | light | `hsl(214 32% 91%)` | `hsl(214 32% 59%)` | 3.20 on background |
| `--input` | dark | `hsl(217 33% 22%)` | `hsl(217 33% 50%)` | 3.88 on background, 3.22 on card |
| `--border` | both | unchanged | unchanged | decorative by definition; documented as such |
| `--ring` | both | unchanged | unchanged | fixed structurally by the offset, not by a value |

**Blast radius of the palette change on existing e2e:** `e2e/color-scheme.spec.ts` asserts only `--background` (white / `hsl(222 47% 11%)`), which does not move. `e2e/header-controls.spec.ts:340-350` asserts luminance *differences* and non-transparency, not fixed colours, and its margins widen. **Nothing existing breaks.** Because `--input` has no consumer until the `input` primitive lands in slice a, its light-mode change is invisible today — the 3:1 control border arrives exactly when the control does.

**The type scale.** Declared as data in slice 0; **conformance is not slice a** (see Out of Scope). Every size is `rem`, never `px`, so a future large-print mode is a root multiplier rather than a rewrite (G5), and `text-size-adjust` is never suppressed.

| Role | rem / px | Line height | Tailwind equivalent | Where allowed |
|---|---|---|---|---|
| `display` | 1.875 / 30 | 1.2 | `text-3xl` | page-level hero |
| `title` | 1.5 / 24 | 1.25 | `text-2xl` | the single `<h1>` |
| `section` | 1.25 / 20 | 1.3 | `text-xl` | `<h2>` |
| `subhead` | 1.125 / 18 | 1.4 | `text-lg` | `<h3>` |
| `body` | 1 / 16 | 1.6 | `text-base` | **all body copy — the floor** |
| `dense` | 0.875 / 14 | 1.5 | `text-sm` | tabular cells, metadata, form labels. Never a paragraph. |
| `micro` | 0.75 / 12 | 1.4 | `text-xs` | **`(admin)` and `/developer` only. Forbidden on any member-facing surface.** |

### Slice a

**Files to create**
- `scripts/ui-add.mjs`, `scripts/check-deps-drift.mjs`, `scripts/check-brand-scope.mjs`, `scripts/check-brand-scope.test.mjs`
- `src/components/theme-provider.tsx` — `'use client'`, the next-themes wrapper, nothing else in it
- `src/components/ui/sonner.tsx` — shadcn's stock Toaster wrapper (see below)
- `src/components/ui/table.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx` — generated
- `e2e/visual-parity.spec.ts` + `e2e/support/routes.ts` — the harness (see Acceptance criteria)

**Files to regenerate**
- `src/components/ui/alert-dialog.tsx` — currently hand-built on `@radix-ui/react-dialog`, uses React 19-deprecated `React.ElementRef`, interpolates `${className}` instead of `cn()`, and paints its action button `bg-foreground text-background` rather than through a variant. Regeneration installs `@radix-ui/react-alert-dialog` (**pre-approved, DECISION-036**) and gives it real `role="alertdialog"` semantics, which the `Dialog`-based version never had. Its three consumers (`(account)/account/delete-button.tsx`, `(member)/home/feedback-prompt-card.tsx`, `(admin)/admin/whats-new/delete-button.tsx`) keep the same component names, so the change is import-compatible.

**Files to modify**
- `src/app/globals.css` — `@import "tw-animate-css";`, `@custom-variant dark (&:is(.dark *));`, move the `@media (prefers-color-scheme: dark)` block to `.dark { … }`, add the four `--radius-*` mappings inside `@theme inline`, add the `prefers-reduced-motion` base rule
- `src/app/layout.tsx` — `suppressHydrationWarning` on `<html>`, `<ThemeProvider>`, `<Toaster>` → the generated `sonner.tsx`
- `src/app/(admin)/developer/developer.css` — its dark block is `@media (prefers-color-scheme: dark)` and would be the one surface that ignores an explicit user choice. Replace with `.dark .reg { … }`, placed after `.reg`. Values unchanged; behaviour identical under `theme=system`, correct under an explicit choice. `/developer` stays brand-exempt — this is the *scheme* axis, not the brand axis.
- `src/components/ui/button.tsx`, `badge.tsx` — delete the four dead size variants and the `data-variant`/`data-size` attributes (**verified: zero consumers anywhere in `src/`**); add the focus-ring offset; drop `dark:bg-destructive/60` (an alpha-composited fill cannot be verified against a contract, and the corrected dark `--destructive` makes it unnecessary). Each divergence gets a line in a header comment, the `dropdown-menu.tsx` way.
- 28 files carrying button-shaped class strings, 9 carrying input-shaped, 6 carrying `<table>` — the sweep
- `package.json` — scripts and three new dependencies
- `CLAUDE.md`, `.claude/agents/architect.md`, `docs/ui-standards.md`, `docs/TODO.md`

**Which primitives to generate — narrowed, and this overturns the architect's list.** Phase 2 said "add input/select/dialog/sheet/tabs." The code says:

- `select` requires `@radix-ui/react-select` and `tabs` requires `@radix-ui/react-tabs`. **Neither is installed, neither is pre-approved, and neither has a consumer** — there is no `Tabs` anywhere in `src/`, and every `<select>` in the tree is a native filter control that works. Generating them would drag two un-vetted runtime dependencies into a slice whose defining lesson is that un-vetted dependencies arrived twice by surprise.
- `dialog` and `sheet` ride the already-installed `@radix-ui/react-dialog`, so they are free — but they also have no consumer in slice a.
- **Ruling: generate only what the sweep consumes — `table`, `input`, `label`, `textarea`, `alert-dialog` (regenerated), `sonner`.** Everything else waits for the pipeline that needs it. This is not conservatism for its own sake: `npm run ui:add` is being built in this very slice precisely so that generating a primitive later costs one command, which removes the only good argument for pre-generating. A generated file with no consumer is dead code in a directory marked "do not hand-edit."

`label` uses `@radix-ui/react-label` — **already installed** and, notably, currently unused; 14 files hand-roll `<label>`.

**Dependencies added in slice a (three, all previously ruled on):**

| Package | Status | Note |
|---|---|---|
| `@radix-ui/react-alert-dialog` | pre-approved, DECISION-036 | regeneration target |
| `tw-animate-css` | pre-approved, DECISION-036 | see the motion finding below |
| `next-themes` | approved, DECISION-050 | ~2KB, MIT, React 19 compatible, system/localStorage only |

**⚠ A finding on `tw-animate-css` that changes the acceptance criterion.** `dropdown-menu.tsx` already ships `data-[state=open]:animate-in fade-in-0 zoom-in-95 slide-in-from-*` on both its content surfaces (lines 51 and 239) — and **those classes are inert today**, because `tw-animate-css` is not installed and Tailwind v4 does not provide them. Installing it does not "add animation support"; it **turns on animations that have never once rendered**, in every dropdown and every menu, the moment it lands. That is a user-visible change nobody has costed. It is also the right change (the primitives are authored for it and look unfinished without it), so it ships — as a *named* delta, with the `prefers-reduced-motion` base rule landing in the same commit so G5 is satisfied at the moment the risk is created rather than later:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**⚠ A finding on the radius remap that makes it strictly better than the architect hoped.** Phase 2 asked for `--radius` chosen so `rounded-md` is a no-op, "turning a whole-app visual change into a small enumerable set of deltas." Checked against the installed Tailwind v4 defaults (`node_modules/tailwindcss/theme.css:397-401`: xs 0.125, sm 0.25, md 0.375, lg 0.5, xl 0.75rem) and shadcn's canonical mapping, with `--radius` left at its **current** `0.5rem`:

| | computed | Tailwind v4 default | delta |
|---|---|---|---|
| `--radius-sm: calc(var(--radius) - 4px)` | 4px | 4px | **none** |
| `--radius-md: calc(var(--radius) - 2px)` | 6px | 6px | **none** |
| `--radius-lg: var(--radius)` | 8px | 8px | **none** |
| `--radius-xl: calc(var(--radius) + 4px)` | 12px | 12px | **none** |

**The enumerable set of deltas is empty.** All four remapped steps are byte-identical at `--radius: 0.5rem`, and the tree uses only `rounded-md` (97), `rounded-lg` (23), `rounded-full` (23), `rounded-xl` (6) and `rounded-sm` (5) — `full` and the un-remapped `xs`/`2xl`/`3xl` are untouched. **Do not adopt shadcn's default `--radius: 0.625rem`**, which would move all four. Keep `0.5rem` and say why in the CSS comment, or the next person "aligns with the registry" and repaints the app.

**Root layout and `<Toaster>` reconciliation.**

```tsx
<html lang="en" suppressHydrationWarning>
  <body className="min-h-screen antialiased">
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster richColors closeButton position="top-right" />
    </ThemeProvider>
  </body>
</html>
```

- `ThemeProvider` is the only `'use client'` addition; server children pass through it as props, which the App Router handles with no ceremony. The existing comment block at `layout.tsx:37-44` ("Do not add 'use client' to this file") stays true of the file and needs its wording updated to say why a client *wrapper* is fine.
- `<Toaster theme="system">` today reads `prefers-color-scheme` on its own, which will diverge from an explicit user choice the moment a toggle exists. The fix is **shadcn's stock `sonner.tsx`**: it calls `useTheme()` and forwards `theme` — when the value is `"system"`, sonner's own media query is the correct answer; when it is explicit, sonner follows the user. Using the stock file rather than a bespoke `resolvedTheme` wrapper keeps the registry-divergence count at zero here. `theme` is dropped from the call site because the wrapper supplies it.
- `disableTransitionOnChange` prevents a transition flash on toggle.
- next-themes also sets `style="color-scheme: dark"` on `<html>`, which nothing does today. Native scrollbars and native form controls will render dark in dark mode where they currently render light. That is a fix, and it is a **named delta** rather than a surprise.

## Implementation Order

Ten commits. Slice 0 must be **merged** before a5; a1–a4 may run in parallel with slice 0 (architect: "sequential on the token partition, parallel on the mechanics" — confirmed).

**Slice 0**

1. **`0.1` — the contract.** `contract.ts`, `contrast.ts`, `contract.test.ts`, and the `globals.css` value corrections, in one commit — they cannot be separated, because the test asserts `globals.css` transcribes `PLATFORM_TOKENS`. Three test groups:
   (a) every entry of `LEGAL_PAIRS` evaluated against `PLATFORM_TOKENS` in **both** schemes, reading `min` **from the pair**;
   (b) the closure test — the `:root` custom-property set in `globals.css` equals the non-additive, non-reserved `TOKEN_POLICY` set;
   (c) `contrast.ts` unit cases against published WCAG reference values (black/white = 21, and two mid-tones).
   *Implementer: **api-developer**.*
2. **`0.2` — `docs/ui-standards.md`, docs only.** Separated from 0.1 so a prose commit cannot break a test and vice versa. *Implementer: **ux-developer**.*

**Slice a — mechanics (no dependency on slice 0)**

3. **`a1` — tooling.** `ui-add.mjs`, `check-deps-drift.mjs`, `check-brand-scope.mjs` (rules E1, E3, C1 live; E2 and C2 dormant), `check-brand-scope.test.mjs`, the four `package.json` script entries, `check` becomes a four-tripwire chain, and the CLAUDE.md / architect.md edits. No runtime change at all. *Implementer: **api-developer**.*
4. **`a2` — the visual-parity harness.** Lands **before** any visual change so the baseline can be captured on unmodified code. *Implementer: **ux-developer**.*
5. **`a3` — scheme, motion, radius.** `tw-animate-css`, `next-themes`, `@custom-variant dark`, the `.dark` block move, the `--radius-*` mappings, `prefers-reduced-motion`, `developer.css`'s `.dark .reg`, the root layout, `sonner.tsx`. *Implementer: **ux-developer**.*
6. **`a4` — primitives.** Generate `table`, `input`, `label`, `textarea` via `npm run ui:add`; regenerate `alert-dialog`; clean the dead variants out of `button`/`badge`; add the focus-ring offset to `button`, `badge`, `input`; record every divergence in header comments. No consumer changes yet — the primitives land unused and the app still renders exactly as it did. *Implementer: **ux-developer**.*

**Slice a — the sweep (requires slice 0 merged)**

7. **`a5` — `(admin)`.** 6 tables, ~20 button strings, the admin layout. Highest volume, lowest risk, un-brandable surface, platform-only audience. *Implementer: **ux-developer**.*
8. **`a6` — credential surfaces.** `(auth)`, `(password-reset)`, `(email-verify)`, and `(account)/account/2fa/*`. **Split out for a specific reason the architect did not flag: CLAUDE.md's Phase 4 gate requires a running-server e2e smoke of the full login path, including an MFA-enrolled user, for any change touching `src/app/(auth)/`.** Folding these files into a bigger sweep would drag that gate across the whole thing; isolating them keeps the gate proportionate and the commit reviewable. See E1 in Edge Cases — this gate is Phase 4 and is **not** covered by DECISION-045's deferral. *Implementer: **ux-developer**.*
9. **`a7` — member and shared.** `(member)`, `(account)` (non-2FA), `src/components/shared/*`, `src/app/page.tsx`, `no-organization`, `launch`, `(org)`. *Implementer: **ux-developer**.*
10. **`a8` — turn on C2.** Flip the rule, run `npm run check`, watch it pass, and record in the work-log that it was **demonstrated failing at `a4` and passing at `a8`** (Note 11, attached to the clause that actually has violations). One-line script change. *Implementer: **api-developer**.*

**Why the sweep splits three ways rather than one.** The operator asked me to decide. The line is **trust class, not file count**: `(admin)` is platform-only and un-brandable; the credential group carries a mandatory auth-e2e gate; member and shared surfaces are the ones a congregation sees and the ones the brand will eventually reach. Splitting by trust class means each commit's review question is a single question, and a rollback of one does not un-migrate the others. A single 43-file diff is, in the architect's words, a diff nobody reads — and the same is true of a two-way split at 22 files each.

## Acceptance criteria — how slice a proves what it claims

**"Zero user-visible change" cannot be met and should not be claimed.** A shadcn `<Table>` renders `<div class="relative w-full overflow-x-auto"><table class="w-full caption-bottom text-sm">` with `<TableHead>` at `h-10 px-2 text-foreground font-medium`; today's tables are `<table class="mt-6 w-full text-sm">` with `<th class="py-2">` under a `text-muted-foreground` row. A shadcn `<Button>` is `h-9`; the hand-rolled buttons are `h-10` or unset with `py-2`. Migrating *is* the change. Phase 1's slice-a line ("zero user-visible change except radius and dark") is superseded here by a criterion that can be proved:

**Category A — must be pixel-identical (`maxDiffPixels: 0`).** Commits `a1`, `a2`, and the radius portion of `a3`. The radius remap is provably a no-op (table above) and the tooling touches no runtime code. Any diff here is a bug.

**Category B — deltas must be *attributable*, not merely acceptable.** Commits `a4`–`a7`. The criterion is a rule about the diff, not about the pixels: **the sweep deletes class strings; it does not author them.** Concretely — a primitive may receive only layout-context classes (`mt-6`, `w-full`, grid placement); it may **not** receive geometry (`h-10`, `px-4`, `text-sm`, `rounded-*`) or colour. If a surface needs a size the primitive does not have, that is a variant on the primitive, not a `className` at the call site. This is greppable at review and it is what stops the sweep becoming 43 files of bespoke overrides that re-create the problem with new syntax. Screenshot pairs are produced for every route and reviewed by the operator; the question asked of each is "is this delta the primitive's stock geometry?" not "does this look fine?"

**Category C — named intended changes, listed once so nobody has to rediscover them.** (1) Dropdown and menu animations begin rendering (`tw-animate-css`). (2) The colour scheme becomes class-driven; `color-scheme` is now declared, so native scrollbars and controls follow the scheme. (3) Narrow tables gain horizontal scroll instead of overflowing at 360px. (4) `--muted-foreground` darkens/lightens to clear 7:1 (slice 0). (5) Focus rings gain a 2px offset and become visible on the primary button for the first time. (6) `alert-dialog` gains `role="alertdialog"`.

**The harness (G11), scoped and decided: yes, it is part of slice a, at commit `a2`, and it uses zero new dependencies.**

G11 asks for automated screenshot diffs at 360px and 1280px in both schemes. Committed Playwright baselines are the obvious build and the wrong one here: baselines rendered on macOS never match `ubuntu-latest`, and baselines generated on `ubuntu-latest` drift with the runner image — `.github/workflows/e2e.yml` pins nothing (`npx playwright install --with-deps chromium`). So the harness is **self-comparing across two runs on one machine**, which is exactly the instrument slice B used to prove its byte-identical claim, mechanised:

- `e2e/support/routes.ts` — the route manifest: path, which `storageState`, expected status. Roughly 20 routes across `/`, `(auth)`, `(member)`, `(account)`, `(admin)`, `(org)`.
- `e2e/visual-parity.spec.ts` — a Playwright project `visual`, matrix of {360, 1280} × {light, dark}, `toHaveScreenshot({ fullPage: true, animations: "disabled", maxDiffPixels: 0 })`, with `snapshotPathTemplate` pointed at `.visual/` (gitignored).
- `npm run visual:baseline` → `playwright test --project=visual --update-snapshots`. `npm run visual:check` → `playwright test --project=visual`; failures write `-diff.png`.
- `animations: "disabled"` is what keeps the tw-animate-css delta out of the diff while leaving it real and named in Category C.

Workflow: capture the baseline on the commit before a change, apply the change, run the check, review or accept. Cost is one spec, one manifest, four `package.json` lines, no dependency, and it is directly reusable in slice c for the per-org verification G11 actually cares about. **Committing baselines to CI is explicitly out of scope** and goes to `docs/TODO.md` — it needs a pinned container image, which is its own decision.

## E2E blast radius — existing specs this changes

Phase 3's job here is the *existing* specs, not the new ones (retro 2026-07-11).

| Spec | What changes | Action |
|---|---|---|
| `e2e/color-scheme.spec.ts` | Its entire premise. It guards "the palette follows `prefers-color-scheme`," which is currently a media query and becomes a class applied by next-themes' pre-paint script. The two assertions still pass — Playwright's `colorScheme` emulation drives `matchMedia`, which is what the script reads — but they now test a **different mechanism**, and its 12-line header comment describing the Tailwind `@theme`-hoisting incident becomes misleading. | Rewrite the header comment; **add an assertion that `document.documentElement.classList` carries `dark` under `colorScheme: "dark"` and does not under `"light"`.** Without it the spec passes for the wrong reason if the script is misconfigured and the CSS happens to fall back. This spec becomes the primary regression guard for the whole scheme mechanism. |
| `e2e/header-controls.spec.ts:302-355` | The two-scheme block reads `--popover` and the avatar fill through computed style; same mechanism change. Assertions are ratio-based and the corrected palette widens their margins. | Verify, do not rewrite. |
| `e2e/header-controls.spec.ts:153` | `.locator("span.truncate")` inside the org switcher — `org-switcher.tsx` is in sweep `a7`. A structural class used as a test hook. | The sweep must preserve the `span.truncate`, or the spec moves to a `data-testid`. Named so it is not discovered as a red run. |
| `e2e/header-controls.spec.ts:350` | `getByTestId(AVATAR).locator("span").first()` — `avatar-menu.tsx` is in `a7`. | Preserve the span structure. |
| `e2e/feedback.spec.ts:69` | `page.locator("tbody tr")` — descendant combinator, survives the `<Table>` wrapper. | No action; verified safe. |
| `e2e/post-login-routing.spec.ts:211` | Asserts `main`'s innerText is byte-identical across `managed`/`invited`/`unmanaged` (DECISION-040). | The sweep may not change copy. Any text edit in `(org)` breaks the enumeration-safety guard, which is the correct failure. |
| `e2e/admin-*.spec.ts` | Locate by role and text through the migrated tables and buttons. | Safe **iff** the sweep preserves the rendered element and the accessible name. Rule: a `<Link>` that looks like a button becomes `<Button asChild><Link/></Button>`, never `<Button>` — otherwise `getByRole("link")` becomes `getByRole("button")` and specs fail for a reason that looks cosmetic. |
| `e2e/security-headers.spec.ts` | Unaffected. Report-only CSP already carries `script-src 'unsafe-inline'` and `style-src 'unsafe-inline'`, so next-themes' pre-paint script and (later) the brand `<style>` produce no violation today. | No action. The nonce work is a slice-c forward constraint. |

**New tests slice a owes:** `scripts/check-brand-scope.test.mjs` (fixture-driven, proves C1 catches a violation it has nothing real to catch); the `contract.test.ts` groups above; the `classList` assertion in `color-scheme.spec.ts`.

## Documentation changes

**`docs/ui-standards.md` — the visual rewrite (commit `0.2`).** The file is 562 lines of genuinely good interaction guidance with **no type scale, no minimum sizes and no colour values**, and its Accessibility section states a **WCAG AA** floor, which S16 has now overridden. It is also written against primitives that do not exist ("Select & Combobox Patterns (Popover + Command)"). The rewrite is surgical, not a replacement:

- **New section, "Colour and Tokens"** (after Page Layout): the three-way partition as a table, the "brand carries emphasis, neutral carries content" sentence as the operating rule, `border` vs `border-input`, "never write a Tailwind palette literal — if you need a colour that is not a token, that is a missing token and a design decision, not a class string," and the pointer to `contract.ts` as the source of truth.
- **New section, "Type Scale"**: the seven roles, `rem` only, the 16px body floor, the 14px member-facing floor, `micro` restricted to `(admin)`/`/developer`, and the note that the scale exists in rem so large-print is a multiplier.
- **Rewrite "Page Header & Typography"** to reference the roles rather than `text-2xl`.
- **Rewrite "Accessibility"**: AA → **AAA (7:1) for body text**, 3:1 for non-text and control borders, focus rings **always with an offset** (with the 1.00:1 measurement as the reason), 44px touch targets kept, `prefers-reduced-motion` added, 200% zoom without horizontal scroll added, print added (church offices print rolls on monochrome lasers).
- **Rewrite "Select & Combobox Patterns"** to say what actually exists: a native `<select>` for filters today; `Select` is not generated and arrives with the pipeline that needs it, via `npm run ui:add`.
- **New subsection under Component Rules**: `npm run ui:add` is the supported generation path; raw `shadcn add` is not; primitives are not hand-edited and every deliberate divergence from the registry gets a header comment.
- **Add to the Pre-merge UX Audit Checklist**: type-scale roles used rather than raw sizes; no palette literals; contrast checked against the AAA floor; focus ring has an offset.

**`CLAUDE.md` — three edits, not two.** ⚠ The architect assigned "Common Commands" and "Component Rules / Route Group Rules," but **`CLAUDE.md` has no Component Rules and no Route Group Rules sections** — those live in `.claude/agents/architect.md` (lines 13 and 24). So:

1. **Common Commands** — add `ui:add`, `check:deps-drift`, `check:brand-scope`, `visual:baseline`, `visual:check`; update the `check` line from "Both tripwires" to the four-tripwire chain.
2. **Project Layout** — add `src/lib/brand/` (contract, zero runtime imports) and `src/components/ui/` (generated; use `ui:add`).
3. **Key Invariants — new subsection, "The Brand Is a Cascade Override."** Six lines: branding re-declares existing tokens and introduces no styling system; the three-way partition is closed and lives in `contract.ts`; the emitter is `<BrandTokens>` and appears in exactly two layouts; `(org)` and `(public)/site/<slug>` are the only brandable groups, and everything else — `(auth)`, `(account)`, `(member)`, `(admin)`, `(email-verify)`, `(password-reset)`, `access-pending`, `/launch`, `/no-organization`, `/developer` — is not; un-brandable does not mean logo-free.

**`.claude/agents/architect.md` — one edit, two sections.** Route Group Rules gains a line naming `(org)` and `(public)` as the only brandable groups (and `access-pending`, which the list currently mentions, as un-brandable). Component Rules gains `ui:add` as the generation path and "no hand-rolled button, table or input class strings — `check:brand-scope` C2 enforces it."

**`docs/decisions.md` — three implementation entries to append when slice 0 lands** (drafted here so the implementer transcribes rather than invents):

- **DECISION-051 — The token partition is three-way, and the platform default palette is corrected to meet its own floor.** Brandable / bounded / platform, closed over every property `globals.css` declares, closure enforced by a test that parses the CSS. `--accent` and `--accent-foreground` are *bounded*, not brandable, because accent is menu-hover under content-axis text. Six pairs of the current default palette fail the floors the contract declares — including `ring` on `primary` at 1.00:1, a focus ring that has been invisible on the primary button in both schemes since P0 — so slice 0 corrects five token values and adds a structural ring offset rather than shipping a contract its reference implementation violates.
- **DECISION-052 — The brand-scope marker is the emitting component, and the tripwire has four clauses.** `<BrandTokens>` *is* the `<style>` element, so grep-presence and behaviour-presence are one fact; a `data-brand-scope` attribute would mark a wrapper DECISION-050 already ruled out. E3 (no `<style>` outside `src/components/brand/`) closes the copy-paste bypass and is enforceable today at zero violations. The consumer clause that can be demonstrated failing is **C2 (hand-rolled primitives, 44 real violations)**, not the `--brand-*` clause, which is vacuous until slice c. Palette literals are out of scope pending semantic status tokens. Emission uses `:root:root` / `:root:root.dark` for specificity rather than relying on source order, and a plain string child rather than `dangerouslySetInnerHTML`.
- **DECISION-053 — Slice a is not a zero-visual-change slice, and it proves its claim with a self-comparing screenshot harness.** Three acceptance categories (pixel-identical / attributable / named); the diff-level rule that the sweep deletes class strings rather than authoring them; a Playwright `visual` project with gitignored `.visual/` baselines captured before and after on one machine, at 360 and 1280 in both schemes, zero new dependencies. Committed CI baselines need a pinned container and are deferred.

## Edge Cases & Risks

**E1 — DECISION-045 defers Phase 5, but the auth-e2e requirement is a *Phase 4* gate and is not deferred.** CLAUDE.md: "For any feature that touches `src/app/(auth)/` … a running-server e2e smoke covering the full login path (including an MFA-enrolled user) is required **before Phase 5 can begin**." Commit `a6` rewrites markup in `(auth)/signin`, `(auth)/totp` and the password-reset flow. The gate applies. This is the single most likely place for the pipeline to ship something broken under the deferral, because "Phase 5 is deferred" reads as "e2e is optional" and it is not.

**E2 — the pre-paint script is now load-bearing for every user, and a JS-disabled user loses dark mode entirely.** Today the media query works with JS off. After `a3`, `.dark` is applied by next-themes' inline script. Accepted (the app requires JS to sign in at all), named so it is not rediscovered as a bug report.

**E3 — hydration mismatch on `<html>`.** `suppressHydrationWarning` on `<html>` is mandatory and easy to omit or to put on `<body>` instead. Symptom is a console error in dev and nothing in prod, which is exactly how it survives to production.

**E4 — `dark:` semantics change under every existing class string.** After `@custom-variant dark (&:is(.dark *))`, the ~47 palette literals carrying `dark:` variants (status chips in `(admin)` and `(account)`) resolve through the class rather than the media query. They keep working *because* next-themes applies the class from system preference by default — but they are the largest population of styling that changes mechanism without changing appearance, and they are exactly what the visual harness at `a3` must cover. Route the manifest through `/admin/feedback`, `/admin/email-queue` and `/account/2fa`, which carry the densest chip usage.

**E5 — the `<Table>` wrapper adds a scroll container.** `overflow-x-auto` on a table inside an already-constrained layout can produce a nested scroll region or clip a sticky header. Check the widest table (`/admin/users`, six columns) at 360px and 1280px before assuming it is free.

**E6 — a `<Link>` styled as a button must stay an `<a>`.** `<Button asChild><Link/></Button>`, never `<Button>`. Otherwise the accessible role changes, keyboard behaviour changes (Enter vs Space), and several e2e locators fail in a way that reads as cosmetic.

**E7 — `alert-dialog` regeneration changes focus and escape semantics.** `role="alertdialog"` and the real Radix AlertDialog trap focus and require an explicit action; the current `Dialog`-based version closes on outside click. Its three consumers are all destructive confirmations, so the stricter behaviour is correct — but it is a behaviour change, not a restyle, and `account/delete-button.tsx` deserves a manual pass.

**E8 — `ui:add` runs `npm ci` and will happily delete an uncommitted lockfile edit.** Hence the clean-tree precondition in step 1. Worth stating in the script's error message, not just in this document.

**E9 — the `git status --porcelain` detection in `ui:add` misses a regenerated file whose content is byte-identical to what is already committed.** Harmless (nothing to rewrite), but the script must not treat "no files detected" as success without saying so.

**E10 — `check:brand-scope` E3 must not trip on the three existing comments** that contain the string `dangerouslySetInnerHTML` while asserting the XSS invariant. Reuse `check-sql-date.mjs`'s comment-skipping logic; a tripwire that fires on a comment praising the invariant is a tripwire people learn to bypass.

**E11 — the corrected `--muted-foreground` is 244 sites of visible change and the most likely thing to be mistaken for a regression** during review of the sweep, which lands later and larger. Mitigation: it ships in slice 0, alone, with a screenshot pair and the contrast table in the commit body.

**E12 — `PLATFORM_TOKENS` and `globals.css` are two copies of the same values.** The closure test asserts the *names* match; the value transcription is asserted too, by parsing the declarations. If the implementer finds parsing values too brittle (nested `hsl()` with spaces), the fallback is asserting names only and treating value drift as caught by the pair tests — which read `PLATFORM_TOKENS`, so a `globals.css` that drifts from it would pass its own tests while rendering something else. Say which was chosen in the Phase 4 notes; do not leave it ambiguous.

**E13 — `/developer` and the scheme axis.** `developer.css` is brand-exempt structurally, but if its dark block stays a media query it becomes the one page in the app that ignores an explicit theme choice. Fixed in `a3`; the risk is that "exempt from branding" gets read as "exempt from everything."

**E14 — `next-themes` persists to `localStorage`, which is device-level, and S17 asked for account-level.** DECISION-050 already flags this. Slice a must not ship a toggle UI that implies the choice follows the account — in fact **slice a ships no toggle at all**, only the mechanism. Naming it here because "the `.dark` class works, let's add the switch" is a two-line temptation.

## Out of Scope (confirm with the user)

Each of these goes to `docs/TODO.md` in the commit that discovers it (Workflow Rule 10), not into slice a.

1. **Type-scale conformance.** The scale is declared in slice 0; the tree contains **244 `text-sm` and 97 `text-xs`** usages, many of them body copy at 14px and 12px against a 16px floor. Migrating them is a separate, larger, and more visually consequential sweep than the primitive migration. New surfaces are authored to the scale from slice 0 onward.
2. **Semantic status tokens and the 47 palette literals.** `--success` / `--warning` / `--info`, each needing fill, subtle-fill and foreground, plus the sweep of 21 files. Real design work, and D6 says these are platform-fixed anyway, so nothing about the brand depends on it.
3. **`select`, `tabs`, `dialog`, `sheet`, `skeleton`, `separator`.** Generated by the pipeline that needs them, via `npm run ui:add`. Two of them require new runtime dependencies and an architect pass.
4. **A colour-scheme toggle UI, and account-level persistence.** Mechanism only in slice a (DECISION-050).
5. **Committed screenshot baselines in CI.** Needs a pinned container image; that is its own decision.
6. **Everything in slices b–e** — the generator, brand storage, emission, the `(admin)` organizations surface, the church-facing editor, type pairings.
7. **OQ4** ("congregations still on the default palette") — architect recommends taking it in slice c; still unanswered by the operator.

## Implementer

Split explicitly, by commit:

| Commit | Scope | Implementer |
|---|---|---|
| `0.1` | `contract.ts`, `contrast.ts`, `contract.test.ts`, `globals.css` token values | **api-developer** — pure TypeScript, contrast math, no React, no route |
| `0.2` | `docs/ui-standards.md` visual rewrite | **ux-developer** |
| `a1` | `ui-add.mjs`, `check-deps-drift.mjs`, `check-brand-scope.mjs` + its fixture test, `package.json` scripts, CLAUDE.md, architect.md | **api-developer** — node tooling, no runtime code |
| `a2` | visual-parity harness (`visual` project, route manifest, scripts) | **ux-developer** |
| `a3` | `next-themes`, `tw-animate-css`, `@custom-variant dark`, `.dark` block, radius mappings, reduced-motion, root layout, `sonner.tsx`, `developer.css` | **ux-developer** |
| `a4` | generate `table`/`input`/`label`/`textarea`, regenerate `alert-dialog`, `button`/`badge` cleanup + ring offset | **ux-developer** |
| `a5` | `(admin)` sweep — 6 tables, ~20 buttons | **ux-developer** |
| `a6` | credential sweep — `(auth)`, `(password-reset)`, `(email-verify)`, `(account)/account/2fa/*` — **auth e2e gate applies** | **ux-developer** |
| `a7` | member and shared sweep | **ux-developer** |
| `a8` | flip `check:brand-scope` C2 on; record the failing→passing demonstration | **api-developer** |

**Not `full-stack-developer` anywhere.** The two axes here are genuinely separate — dependency-free data modules and node tooling on one side, CSS and markup on the other — and the handoff points (a contract file; a set of generated primitives) are unusually clean.

## Handoff

**Next: api-developer (Phase 4), commit `0.1`.** Everything needed is above: the module surface, the corrected token values with their measured ratios, and the three test groups. `0.2`, `a1` and `a2` can start in parallel; `a5` waits for `0.1` to merge.

Three things I want the operator to look at before implementation starts, because each is a decision I made rather than deferred and each is reversible only cheaply *now*:

1. **Slice 0 corrects the platform palette** and is therefore no longer a no-visual-change slice. The alternative is a contract violated by its own defaults.
2. **Slice a is not zero-visual-change**, and the acceptance criterion has been rewritten in three categories rather than weakened into "looks fine."
3. **The primitive list is narrowed to five**, dropping `select` and `tabs` (new dependencies, no consumers) and `dialog`/`sheet` (no consumers) — on the argument that building `ui:add` in this slice is what makes deferring them free.

---

# Phase 4 — Implementation

*One section per commit. Commits land in the order of the design's Implementation Order; each subsection is written by that commit's implementer.*

## Commit `0.1` — the contract (api-developer)

**Date:** 2026-08-19

### Files Created

- `src/lib/brand/contract.ts` — the closed vocabulary. `BRAND_TOKEN_VERSION`, `BRAND_ROLES` + `ROLE_TO_TOKEN`, `LEGAL_PAIRS` as a runtime `as const` array with `LegalPair`/`LegalTone` derived from it and `min` riding on each pair, the three-way `TOKEN_POLICY` partition, `BRAND_SCOPE_SELECTOR`/`_DARK`, the floors that are not pairs (`MIN_BODY_PX`, `MIN_MEMBER_FACING_PX`, `MIN_TOUCH_TARGET_PX`, `MIN_BRAND_DANGER_HUE_DISTANCE_DEG`, `FOCUS_RING_OFFSET_PX`), `TYPE_SCALE`, and `PLATFORM_TOKENS`. **Zero runtime imports** — verified by grep: the file contains no `import` statement at all.
- `src/lib/brand/contrast.ts` — `parseColor`, `relativeLuminance`, `contrastRatio`, `meets`. One `import type { BrandPair }`, which erases; no runtime imports.
- `src/lib/brand/contract.test.ts` — 56 tests in the design's three groups, plus partition hygiene and a parser fixture.

### Files Modified

- `src/app/globals.css` — six declarations corrected (four tokens), the header comment now names `contract.ts` as the source of truth, and three new comments record the `border`/`input` split and why `--ring` equals `--primary`.

### Schema Changes

None. Slice 0 adds no table, no column, no migration.

### Audit Events

None. Slice 0 contains no mutation.

### Measured contrast — before and after

Computed with the module this commit ships, on 8-bit sRGB, both schemes.

| Pair | Floor | Light before | Light after | Dark before | Dark after |
|---|---|---|---|---|---|
| `foreground` on `background` | 7 | 17.87 | 17.87 | 17.08 | 17.08 |
| `muted-foreground` on `background` | 7 | **4.70** | **7.92** | 6.97 | 8.89 |
| `muted-foreground` on `card` | 7 | **4.70** | **7.92** | **5.78** | **7.37** |
| `muted-foreground` on `muted` | 7 | **4.29** | **7.23** | **5.78** | **7.37** |
| `primary-foreground` on `primary` | 4.5 | 5.17 | 5.17 | 4.91 | 4.91 |
| `destructive-foreground` on `destructive` | 4.5 | 4.80 | 4.80 | **3.61** | **4.87** |
| `input` on `background` | 3 | **1.24** | **3.20** | **1.43** | **3.88** |
| `ring` on `background` | 3 | 5.17 | 5.17 | 4.91 | 4.91 |
| `ring` on `primary` (the ringed control) | — | 1.00 | 1.00 | 1.00 | 1.00 |
| `border` on `background` | none | 1.24 | 1.24 | 1.43 | 1.43 |

`ring on primary` stays 1.00 **on purpose**: D4 is satisfied geometrically, not by a value. `FOCUS_RING_OFFSET_PX = 2` is the contract's half; slice a's `focus-visible:ring-offset-2 focus-visible:ring-offset-background` on `button`/`badge`/`input` is the other half. A test asserts the two cannot be separated — if the ring ever fails to clear the brand fill, the contract must be mandating an offset.

`border` is deliberately unchanged and deliberately not a legal pair: a card edge separates content, and D3 is about identifying a control. That is now `--input`'s job, and the two tokens diverge in value for the first time.

### E12 — the choice the design asked for, made

**Values as well as names, compared as parsed RGB.** The closure test extracts the `:root` custom-property set from `globals.css` and asserts set equality with the non-additive, non-reserved `TOKEN_POLICY` entries in both directions; a second test asserts every `PLATFORM_TOKENS` entry matches the declaration in the stylesheet, comparing `parseColor(actual)` against `parseColor(expected)` rather than the raw strings.

Names-only was rejected because it leaves the suite self-certifying: every pair assertion reads `PLATFORM_TOKENS`, so a `globals.css` that had drifted would pass its own tests while the browser painted something nobody measured. Parsing turned out not to be brittle — the parser already exists in `contrast.ts` and is the same one the ratios are computed with. Comparing RGB rather than strings means an equivalent renotation is not called drift, which is what stops the test being edited into agreement with a change.

The parser handles the dark block as `@media (prefers-color-scheme: dark) { :root { … } }` (today) **and** as `.dark { … }` (slice a), with a fixture test on the second branch so `a3` does not land against a code path nobody has run.

### Verification

- `npm run typecheck` — clean.
- `npm run lint --max-warnings=0` — clean.
- `npx vitest run` — 656 passing, 0 failing (600 before this commit; the number 559 quoted in the handoff was stale).
- `npm run check` — all four tripwires pass.
- `npm run build` — compiles.
- **Mutation-checked**, because a test that cannot fail is not a test: drifting one value in `globals.css` fails the transcription test and names the token; adding an unclassified `--sidebar` to `:root` fails the closure test and names it; reverting the `muted-foreground` correction in *both* files fails three floor assertions.
- **Verified in a browser** (CLAUDE.md → Verify in a Browser). The running dev server was serving a stale CSS chunk and had to be discounted — a production build served on a scratch port was used instead. `/signin`, `/`, `/forgot-password` screenshotted at 390px in both schemes; computed `--muted-foreground` reads `#475262` light / `#acb8c8` dark, and all three pages render legibly.

### Surfaces that visibly change

Slice 0 is not a no-visual-change commit, by design.

1. **Secondary text everywhere** — `muted-foreground` is referenced 201 times across 48 files. Darker in light mode, lighter in dark. Page descriptions, table metadata, empty states, form hints, timestamps.
2. **`/admin/whats-new` and `/admin/whats-new/[id]`** — six hand-rolled fields use `border-input` and get a markedly darker border in light mode. **The design said `--input` "has no consumer until the `input` primitive lands in slice a"; that is wrong**, and these six fields are the proof.
3. **Every `outline` button in dark mode** — `button.tsx:16` carries `dark:border-input dark:bg-input/30 dark:hover:bg-input/50`. The border becomes visible (1.43 → 3.88) and the translucent fill lightens: the composite goes `#162033` → `#243450`, and `#1b263a` → `#32476a` on hover. Text on it stays far above the floor (15.58 → 11.93, and 14.49 → 8.94).
4. **Destructive surfaces in dark mode** — the fill darkens from `hsl(0 84% 60%)` to `hsl(0 84% 48%)`: destructive `Button`/`Badge` fills, the destructive dropdown item's text and its focus tint.

### Implementer Notes — where the design was wrong

Seven findings. Two are typed defects that would not compile as written, four are factual corrections, one is a recommendation the operator has to rule on.

1. **`BrandPair["kind"]` as written cannot type `LEGAL_PAIRS`.** The design declares `kind: "body" | "large-text" | "non-text"` and then uses `kind: "text"` on three of the nine pairs. Added `"text"` to the union.
2. **`TokenEntry` as written cannot express the closure test.** It has `additive?: true` but no `reserved`, while the closure test is specified over "non-additive, **non-reserved**" entries and six reserved tokens are listed in the partition table. Added `reserved?: true`, and `nonColour?: true` for `--radius`, which is classified but carries no colour and therefore no `PLATFORM_TOKENS` value.
3. **`TokenName` is never defined in the design** although three declarations depend on it. Derived it from `TOKEN_POLICY` (`(typeof TOKEN_POLICY)[number]["token"]`) so the partition is the single source of truth and a token cannot be named anywhere in the file without first being classified — rather than maintaining a second list, which is the failure mode the architect used to justify deleting `theme_tokens`. `AdditiveTokenName`, `ReservedTokenName`, `NonColourTokenName`, `DeclaredTokenName` and `PlatformTokenName` are all derived the same way. `ROLE_TO_TOKEN` is `satisfies Record<BrandRole, PlatformTokenName>` rather than the design's `Record<BrandRole, TokenName>`, which is strictly stronger: it makes "every role has a platform colour to measure" a compile error rather than a test.
4. **`LEGAL_PAIRS` contains a pair `PLATFORM_TOKENS` cannot answer as specified.** `on-brand-raw` on `brand-raw` resolves to `--brand-raw*`, which are additive and by definition absent from `globals.css`. Test group (a) is specified over *every* pair in both schemes, so `PLATFORM_TOKENS` carries platform defaults for the two additive tokens (equal to the primary pair — the platform has no congregation and therefore no raw seed), and the transcription test skips exactly the entries `TOKEN_POLICY` marks `additive`. The alternative — skipping pairs whose tokens have no value — would have made the suite silently weaker than it reads.
5. **The closed role vocabulary cannot express two of the pairs the design itself measured.** `--card` and `--popover` have no role in `BRAND_ROLES`, so `muted-foreground on card` — 4.70 light / 5.78 dark in the design's own failure table — is not reachable through `LEGAL_PAIRS`. It is asserted in `contract.test.ts` as a named, commented exception rather than by adding roles, because the vocabulary is the contract and a test file should not quietly extend it. **Follow-up for the vocabulary: either add `card-surface`/`popover-surface` roles, or state in `ui-standards.md` that `surface` covers all three and the generator must hold the floor on each.**
6. **The `--input` claim is wrong, as above** — six fields on `/admin/whats-new*` and every dark-mode `outline` button consume it today. The change is still right; it is simply visible now rather than invisible until slice a.
7. **The dark `destructive` correction fixes a pair nothing renders and regresses one that does.** ⚠ **Operator decision.**
   - `--destructive-foreground` has **zero consumers**: `button.tsx:14` and `badge.tsx:16` both hard-code `text-white`. And dark destructive fills render through `dark:bg-destructive/60`, so what actually paints today is white on `#953139` — **7.56:1**, not the 3.61:1 the design cites as a shipped AA failure. The 3.61 pair is real in the *token* sense and must be fixed before `a4` drops the alpha, but it is not a defect a user has ever seen.
   - The cost is: `text-destructive` on the dark page falls **4.73 → 3.67**, and on the dark popover **3.92 → 3.04**. That is rendered today, in the destructive dropdown item, and 3.67 is below the 4.5 text floor.
   - There is a strictly better correction, and it is the one Phase 1's Flow 3 prescribes — *move the text, not the hue*: leave dark `--destructive` at `hsl(0 84% 60%)` and set dark `--destructive-foreground` to `hsl(222 47% 11%)`, the page ink. That pair is **4.73:1** (clears 4.5), and `text-destructive` keeps its 4.73 / 3.92. It is a two-line change and the suite stays green either way.
   - ~~**Shipped as the design specifies**, because the design named explicit values and a visual token is the operator's call, not the implementer's. Flagged here for a ruling.~~ **Orchestrator postscript (2026-08-19): the ruling was taken before push — `f0ebd7c` carries the strictly-better alternative** (fill unchanged at `hsl(0 84% 60%)`, dark `--destructive-foreground` = page ink `hsl(222 47% 11%)`). The `globals.css` comment and the TODO ruling line described the rejected correction until the housekeeping commit after `0.2` fixed both.

Two smaller notes. `FOCUS_RING_OFFSET_PX = 2` is an addition to the design's constant list — D4 is only structural if the offset is *data* the primitives read, and the test that joins it to the ring/brand ratio needs something to assert. And `contrast.ts` accepts the legacy comma-separated `hsl()` form and rejects everything else, including any notation carrying alpha: a ratio against a translucent fill depends on what is behind it and is therefore not a property of the pair, so returning a plausible number for it would be worse than throwing.

---

# Phase 4 · commit `a1` — tooling (api-developer)

*Serialized by the orchestrator. The implementing agent deliberately did not write this
section itself: `git diff --stat` showed the work-log under concurrent modification
(+531 lines from the `0.1` agent) and a lost update here would have destroyed the design.
Good judgment worth recording.*

**Created** `scripts/ui-add.mjs`, `scripts/check-deps-drift.mjs`,
`scripts/check-brand-scope.mjs`, `scripts/check-brand-scope.test.mjs` (30 fixture
tests), `scripts/ui-add.test.mjs` (11). **Modified** `package.json` (four script
entries; `check` is a four-tripwire chain), `CLAUDE.md` (Common Commands, Project
Layout, and a new Key Invariant — *The Brand Is a Cascade Override*),
`.claude/agents/architect.md` (Route Group Rules + Component Rules 4 and 5).

**Live vs dormant.** E1 (emitter containment) live — a ratchet placed before the thing
it guards. E3 (no second emitter) live, zero violations. C1 (brand-class containment)
live but vacuous, proven by fixture test. **E2 dormant** because `(public)` does not
exist yet; **C2 dormant** behind one flag, flipped at `a8`.

**The C2 dry run is the sweep's real size: 52 violations — 45 button-shaped strings
across 28 files, 7 `<table>` across 6.** File counts match the design exactly.
**But the button-shaped population includes the status chips**, which need `<Badge>` or
an explicit exemption rather than a button — the design's census did not anticipate
that, and the `a8` implementer inherits it.

**Six design findings.**

1. **`from "radix-ui"` already appears in `src/`** — at `dropdown-menu.tsx:6`, inside
   the hand-correction comment quoting the import it forbids. A naive rule-2 grep fails
   on commit one, tripped by the comment explaining the rule.
2. **Comment-skipping needs four forms, not one.** `check-sql-date.mjs` skips `//` only;
   the real hits include JSX `{/* … */}`. Documented rather than silently widened.
3. **The C1 regex as designed over-matches** — `-brand(-…)?` also matches inside
   `text-branding`. Boundary guards added, with a fixture test for exactly that.
4. **`ui:add` step 5 fires after `npm ci`**, leaving rewritten imports with the package
   uninstalled. Intended — the build stops and names it — but the error message says so
   explicitly rather than leaving the operator to infer it.
5. **`visual:baseline` / `visual:check` were assigned to `a1`'s docs edit but ship in
   `a2`.** Documented only what `a1` adds: *"documenting a command that does not exist is
   a doc that lies."*
6. **The design named no test for `ui-add.mjs`.** Its rewrite runs ten-plus times in this
   slice and **fails silently** — a missed rewrite compiles fine whenever the umbrella
   happens to be installed, which is the state the lockfile restore exists to prevent.
   Added, with the script restructured behind an `isMain` guard so the pure functions are
   importable.

**Operational hazard, from the `0.1` agent and repeated here because `a2` depends on it:**
the running dev server was serving a **stale CSS chunk** and never recompiled even after a
touch. Visual checks were done against a production build on a scratch port. **The
visual-parity harness must not baseline against a long-running dev server.**

---

# Phase 4 · commit `0.2` — `docs/ui-standards.md` visual rewrite (ux-developer)

**Date:** 2026-08-19

**File modified:** `docs/ui-standards.md` only (562 → 626 lines). No code, no CSS, no
`package.json` — per the commit's scope.

**Changes, matching the Phase 3 spec bullet-for-bullet:**

- **New section "Colour and Tokens"** (after Page Layout): the three-way `TOKEN_POLICY`
  partition as a table, transcribed from the *shipped* `contract.ts` rather than the
  Phase 3 sketch; "brand carries emphasis, neutral carries content" as the operating
  rule; the `border` vs `border-input` rule with the diverged values cited; "never write
  a Tailwind palette literal" with the status-chip gap named and pointed at
  `docs/TODO.md`; `contract.ts` declared source of truth ("if the two disagree, the
  contract wins").
- **New section "Type Scale"**: the seven roles, rem-only rule, 16px body floor, 14px
  member-facing floor, `micro` restricted to `(admin)`/`/developer`, large-print
  multiplier rationale.
- **Rewrote "Page Header & Typography"** onto the roles (`title`/`section`/`subhead`/
  `dense`) instead of bare size classes.
- **Rewrote "Accessibility"**: AA → AAA (7:1) body floor; 3:1 non-text; focus ring
  always with a 2px offset, citing the measured 1.00:1 invisible ring; added
  `prefers-reduced-motion`, 200% zoom, and print (monochrome laser) rules; kept 44px
  touch targets.
- **Rewrote "Select & Combobox Patterns"**: removed the never-built "Popover + Command"
  pattern (verified zero `Popover`/`Command`/`Select` files exist and grepped all four
  real native-`<select>` consumers); documented native `<select>` as what exists;
  `Select`/`Command` arrive via `npm run ui:add` with the pipeline that needs them.
- **New "Component Rules" section**: `ui:add` as the only supported generation path,
  raw `shadcn add` unsupported, header-comment rule for registry divergences with
  `dropdown-menu.tsx` as precedent.
- **Pre-merge UX Audit Checklist**: added type-scale-roles, no-palette-literals,
  AAA-floor, and ring-offset items; updated the stale AA/focus-ring lines.
- **Table of Contents** updated with the three new anchors.

**Finding — a three-way self-description mismatch on the dark `--destructive`.** The
shipped code (`f0ebd7c`) carries the *alternate* correction from `0.1`'s note 7 — dark
`--destructive` unchanged at `hsl(0 84% 60%)`, `--destructive-foreground` set to the
page ink `hsl(222 47% 11%)` (the "move the text, not the hue" option; the Per-Phase
Status row records the operator ruling was taken) — but three pieces of prose still
describe the superseded 48%-plus-white correction: the `globals.css` comment above the
declarations, `docs/TODO.md`'s "Operator ruling" line (still listed as open), and
note 7's own closing line "Shipped as the design specifies." Corrected by the
orchestrator in the housekeeping commit that follows `0.2`; the doc itself is
unaffected because it cites `contract.ts` rather than hard-coding values.

*Recorded by the orchestrator from the implementing agent's report; the agent returned
its section as text to avoid concurrent modification of this file.*

---

# Phase 4 · commit `a2` — the visual-parity harness (ux-developer)

**Date:** 2026-08-19

**Created** `e2e/support/routes.ts` (the manifest: 18 routes × fixture storageState ×
expected status, with six selection rules in the header) and `e2e/visual-parity.spec.ts`
(the `visual` project's spec: 18 routes × {360×800, 1280×900} × {light, dark} = 72
tests, `toHaveScreenshot({ fullPage, animations: "disabled", maxDiffPixels: 0 })`,
`document.fonts.ready` awaited before capture). **Modified** `playwright.config.ts`
(the `visual` project, gated), `package.json` (`visual:baseline` / `visual:check`),
`.gitignore` (`e2e/.visual/`). Zero new dependencies.

**Design deviation — the project gate is an env var, not argv.** A `process.argv`
check for `--project=visual` passes `--list` but breaks real runs: Playwright's test
workers are separate processes that reload the config and do not inherit the CLI's
argv ("Project \"visual\" not found in the worker process"). The npm scripts set
`PW_VISUAL=1`, which child processes do inherit; the `visual` project is only in the
`projects` array when it is set, which is the only gate that holds regardless of
Playwright's default project selection. Documented in the config header.

**Verification** (per the operational hazard — never against a dev server):
`npm run typecheck` and `lint --max-warnings=0` clean; `npx playwright test --list`
collects 84 tests / 14 files with zero `visual-parity` matches (the default suite is
untouched); production build served on port 3100, then `visual:baseline` (72 passed,
72 PNGs) followed by `visual:check` twice (72 passed, 0 diffs, both runs). Suite
integrity spot-checked with `color-scheme.spec.ts` + `role-boundaries.spec.ts`
(7/7). Baselines were deleted after verification — they are working state, and `a3`
must capture fresh ones on the commit before its change.

**A real finding, caught by running it (the F26 pattern in miniature): `/admin/users`
row order is unstable on unmodified code.** `orderBy(desc(users.createdAt))` has no
secondary key, seeded users share millisecond-identical `created_at` values, and
globalSetup's fixture upsert is enough of an UPDATE for Postgres to reorder the tied
rows between baseline and check — a reproducible ~3,600-pixel diff per capture with
zero CSS involvement. Genuine pre-existing page bug (an admin refreshing the page can
watch rows reshuffle), filed in `docs/TODO.md`; the route is excluded from the
manifest (rule 6) until fixed. `/totp` (redirects before paint for every fixture) and
`/access-pending` (renders an `audit_events` write, which would poison `/admin/audit`
downstream in the same run) are the other two exclusions, rules 1 and 2.

*Recorded by the orchestrator from the implementing agent's report.*

---

# Phase 4 · commit `a3` — scheme, motion, radius (ux-developer)

**Date:** 2026-08-19

**Created** `src/components/theme-provider.tsx` (`'use client'` wrapper around
next-themes, documenting the device-vs-account persistence gap and the no-toggle rule)
and `src/components/ui/sonner.tsx` (generated via `npm run ui:add -- sonner`, stock —
`useTheme()` forwarded, zero registry divergence). **Modified** `globals.css`
(`tw-animate-css` import, `@custom-variant dark`, the dark block moved from the media
query to `.dark { … }` with values byte-identical, the four `--radius-*` mappings with
the keep-0.5rem proof in a comment, the `prefers-reduced-motion` base rule),
`layout.tsx` (`suppressHydrationWarning` on `<html>` not `<body>` per E3;
`<ThemeProvider attribute="class" defaultTheme="system" enableSystem
disableTransitionOnChange>`; Toaster switched to the wrapper with `theme` dropped),
`developer.css` (media query → `.dark .reg`, values unchanged, E13 named),
`color-scheme.spec.ts` (header rewritten for the class mechanism; two new `classList`
assertions), `package.json`/lock (`tw-animate-css`, `next-themes` — both pre-ruled).

**Implementer note — `ui:add`'s clean-tree precondition collides with same-commit
dependency installs.** Installing `next-themes`/`tw-animate-css` first left the
manifests dirty, so generating `sonner.tsx` required stashing the manifests, running
`ui:add`, popping, and `npm ci`. `check:deps-drift` passed before and after. Whoever
runs `ui:add` mid-slice again: install runtime deps in their own step or expect to
stash.

**Verification.** typecheck, lint clean · vitest **656 passing** (the `.dark`-branch
fixture in `contract.test.ts`, written pre-emptively at `0.1`, now runs against the
real moved block) · `npm run check` all four tripwires · build clean, 34 routes ·
**full e2e 86 passed** (84 + the two new classList assertions) · browser sanity on the
production build in both schemes (`/signin`, `/admin`; `/developer`'s `.dark .reg`
verified by isolated toggle because no platform-admin e2e fixture exists), no
wrong-scheme flash.

**Visual parity — the harness's first live use, and it worked as designed.** Check
against the step-zero baseline: 64/72 passed; all 8 failures on two routes
(`/account/2fa` ×4, `/admin/audit` ×4). Both were investigated and attributed to
**time-based data drift**, not this commit: the TOTP pending-enrollment secret has a
10-minute TTL (the QR code alone diffed), and live `audit_events` rows accreted in
the ~39-minute gap. Proof rather than assertion: a fresh baseline + immediate check
on the `a3` code was **72/72, 0 diffs** — this commit introduces zero pixel delta on
its own. Category A confirmed (radius remap a no-op); no Category C delta was
observable (declared `color-scheme` moved nothing in this browser/OS).

**Operational note:** a stale `next-server` from an earlier session was bound to port
3000 and blocked the e2e webServer; killed to unblock.

*Recorded by the orchestrator from the implementing agent's report.*

---

# Phase 4 · commit `a4` — primitives (ux-developer, verification finished by the orchestrator)

**Date:** 2026-08-19

**Generated** `table.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx` via `npm run
ui:add` (no new packages — `@radix-ui/react-label` was already installed).
**Regenerated** `alert-dialog.tsx` on `@radix-ui/react-alert-dialog` (pre-approved,
DECISION-036, installed with the a3 stash dance) — import-compatible: all three
consumers (`(account)/account/delete-button.tsx`, `(member)/home/feedback-prompt-card.tsx`,
`(admin)/admin/whats-new/delete-button.tsx`) keep the same component names, verified.
**Cleaned** `button.tsx`/`badge.tsx`: the four dead size variants and the
`data-variant`/`data-size` attributes deleted (grep-verified zero consumers first);
`focus-visible:ring-offset-2 focus-visible:ring-offset-background` added to button,
badge, and input (D4's structural half); `dark:bg-destructive/60` dropped (an alpha
composite is uncheckable against `LEGAL_PAIRS`, and the corrected dark token clears
its floor solid). Every divergence recorded in header comments, dropdown-menu-style.
No call-site changes outside alert-dialog's three consumers; the new primitives land
unused.

**The C2 demonstration (Phase 3 Note 11).** Flag flipped on temporarily: exit 1,
**exactly 52 `[C2]` violations** — matching a1's dry-run census — including
`src/components/shared/org-switcher.tsx:99` as a representative hit; flag reverted to
dormant, `npm run check` passes again. The failing half of failing-at-`a4` /
passing-at-`a8` is now on record.

**Verification** (finished by the orchestrator after the implementing agent was lost
to a stream-watchdog stall twice during the long screenshot runs — the implementation
itself was complete and intact):
- typecheck, lint clean · vitest **656 passed** · `npm run check` all four tripwires ·
  build clean.
- **Visual parity vs the pre-`a4` baseline: no attributable pixel delta.** 67/72
  passed outright; `/account/2fa` ×4 is the known TOTP-QR TTL drift (filed at `a3`);
  the single `/signin` 360-light failure was a `networkidle` goto timeout, not a
  pixel diff (no diff artifact produced), and re-running all four `/signin` combos
  passed 4/4 against the same baseline — transient.
- **Full e2e: 86 passed** — the E6 risk (link-as-button role changes) did not
  manifest; no locator broke.
- **E7 manual pass on the delete-account dialog** (production build, member fixture):
  `role="alertdialog"` present, focus trapped inside, outside click does NOT close,
  Escape closes. The stricter semantics are the intended behaviour change for a
  destructive confirmation.

**Note for the `a5` implementer (E5):** the new `<Table>` wraps in
`<div class="relative w-full overflow-x-auto">` — check the widest table
(`/admin/users`, six columns) at 360px for nested scroll regions before assuming the
wrapper is free.

*Recorded by the orchestrator; implementation by the ux-developer agent.*

---

# Phase 4 · commit `a5` — `(admin)` sweep (ux-developer)

**Date:** 2026-08-19

**Scope:** `src/app/(admin)/**` except `/developer` (exempt by design). C2 census in
scope: 28 violations across 14 files (6 tables — `2fa/page.tsx` has two — plus 22
button-shaped strings). All cleared; C2 flag flipped for the census and confirmed
reverted (`git diff` on the tripwire script is empty).

**Swept:** `2fa/page.tsx` + `policy-toggle.tsx`, `audit/page.tsx`,
`email-queue/page.tsx` + `retry-button.tsx`, `feedback/page.tsx` +
`feedback-status-control.tsx`, `flags/page.tsx`, `users/page.tsx` (the widest table,
E5's named target), `users/[id]/deactivate-card.tsx` + `two-factor-card.tsx`,
`whats-new/page.tsx` + `[id]/page.tsx` + `delete-button.tsx` — onto `<Table>`,
`<Button>`, `<Badge>`, `<Label>`/`<Input>`/`<Textarea>`. `admin/layout.tsx`,
`admin/page.tsx`, `admin/docs/page.tsx`, `users/[id]/page.tsx` reviewed, nothing to
migrate (nav Links, not button-shaped; illustrative demo code left as-is).

**Chip rule, applied uniformly:** every status chip chose **(a) shape onto `<Badge
variant="outline">`, retaining the pre-existing palette-literal colour** — Badge's
stock base class matched every hand-rolled chip's shape exactly, so (a) was strictly
the smaller diff everywhere; the `(b)` `// ui-ok:` exemption was never needed in this
scope. Where the original colour was already a token (`bg-muted`), a named variant
(`secondary`) was used instead of a retained className.

**E6 (link-as-button) hit once, real:** `whats-new/[id]/page.tsx`'s Cancel control —
`<Button asChild variant="outline"><Link/></Button>`, keeping `role="link"`. Given a
dedicated regression test (`e2e/whats-new.spec.ts`) since it's the one place in the
sweep introducing a novel `asChild`-wrapped `<Link>` against existing spec coverage.

**A separate finding, adjacent to but not itself a C2 hit:**
`whats-new/delete-button.tsx`'s `<AlertDialogAction className="bg-red-600 ...">` was
overriding colour with an authored class when the primitive already exposes
`variant="destructive"` — swapped, deleting the authored colour string. Same
principle as Category B, caught by inspection rather than the grep.

**Verification.** typecheck, lint clean · vitest **656 passed** · `npm run check` all
four tripwires, C2 confirmed dormant · build clean, 34 routes · **visual: 44/72
passed, 28 diffs, every one attributed** — 4 are the known `/account/2fa` TTL noise;
24 are the six swept routes × 4 captures, matching Category B stock-primitive
geometry (taller `TableHead`, Badge's `rounded-full` shape, bordered button heights)
plus, on three routes, live row-count drift from repeated build/test cycles (the same
class `a3` already logged for `/admin/audit`) — nothing unattributable · **e2e: 87
passed** (86 + the new Cancel-link regression test) · browser pass on `/admin/users`
and `/admin/feedback` at 360px in both schemes: page-level `scrollWidth === clientWidth`
(no page overflow) while the table's own container scrolls internally — E5 satisfied,
no nested scroll region, no clipped sticky element.

**UX note, named as a deliberate tradeoff, not a defect:** the role-remove pill on
`/admin/users` loses its `rounded-full` pill shape (Button has no pill variant); the
two destructive-confirmation triggers in `deactivate-card.tsx` go from a subtle
red-outline text style to Button's solid `destructive` fill — a real strengthening of
the affordance, not merely a geometry swap, since no "outline destructive" variant
exists to preserve the subtler original.

**Follow-up filed in `docs/TODO.md`:** `deactivate-card.tsx` and `two-factor-card.tsx`
hand-roll `@radix-ui/react-dialog` for destructive confirmations rather than the
`AlertDialog` primitive `a4` regenerated for exactly this — out of scope for a markup
sweep (different focus-trap semantics), left for its own pass.

*Recorded by the orchestrator from the implementing agent's report.*

---

# Phase 4 · commit `a6` — credential-surface sweep + the mandatory auth e2e gate (ux-developer)

**Date:** 2026-08-19

**Scope:** `(auth)` (signin, totp), `(password-reset)`, `(email-verify)`,
`(account)/account/2fa/*` (enrolment UI only). C2 census: 11 violations across 10
files, all cleared onto `<Button>`/`<Input>`/`<Label>` (no `<Table>`/`<Textarea>`/
`<Badge>` consumers in this scope); flag reverted, confirmed empty diff.

**Named consequence, not discovered late:** every hand-rolled `bg-foreground
text-background` "primary" button (Google sign-in, Verify, the two password-reset
submits, Confirm enrollment) now renders in brand-primary blue via `<Button>`'s
default variant — the direct effect of S15's "primary buttons are brand-driven"
rather than an override, matching `a5`'s destructive-button precedent.

**E6 hit three times:** the three success/error-state "back to X" links on
`forgot-password`, `reset-password` (invalid-token), and the verify-email `ErrorCard`
— all `<Button asChild><Link/></Button>`, `role="link"` preserved.

**One incidental accessibility fix, named rather than silently bundled:** the TOTP
code fields on `/totp` and `/account/2fa`'s enrolment form had no `htmlFor`/`id`
pairing before this commit — added while migrating onto `<Label>`+`<Input>`. No
existing `aria-*`, `autoComplete`, `autoFocus`, or `name` attribute touched anywhere
in scope; no copy string changed. Verified directly by diff review (`reset-password`,
`totp`) — every preserved attribute intact, only geometry classes deleted.

**Deliberately not touched:** the Turnstile widget; every palette-literal alert box
(the tracked 47-site status-token gap); `fresh-recovery-codes.tsx` (lives in
`shared/`, `a7`'s scope); the QR `<details>`/`<summary>` disclosure (CLAUDE.md names
a `<summary>`/`display` bug specifically — not touched casually).

### The mandatory auth-e2e gate — PASS, not deferred

No existing spec completed a real TOTP challenge — every prior fixture using
`twoFactorRequired` was deliberately un-enrolled, proving only the redirect gate.
Rather than report the gate unsatisfiable, the implementer built what it needed:

- **New fixture `mfa-enrolled`** (`admin-2fa-enrolled@presby.invalid`) — actually
  TOTP-enrolled, unique among the roster.
- **`e2e/support/totp-fixture.ts`** — seeds a real, decryptable secret using the
  well-known public TOTP demo value (doubled), duplicating `two-factor.ts`'s
  AES-256-GCM format rather than importing it (the standing e2e/no-app-imports
  rule). **Verified not a real credential** — it's the value most TOTP client
  library READMEs use as their own example.
- **`e2e/totp-full-login.spec.ts`** — credentials sign-in → `/totp` → wrong code
  rejected → real code (computed via `otplib` from the same seed) accepted → lands
  on `/admin`.
- **Ran against the production build, 88/88 passed**, including the new spec. All
  four gate requirements proven in one test: password sign-in, a completed MFA
  challenge, correct post-login destination, wrong-code rejection.

### Verification

typecheck, lint clean · vitest **656 passed** (unchanged — no unit surface touched) ·
`npm run check` all four tripwires, C2 confirmed dormant · build clean, 34 routes ·
**visual: 60/72 passed, 12 diffs, every one on the three swept routes present in the
manifest** (`/signin`, `/forgot-password`, `/account/2fa`; `/totp` and
`/reset-password` aren't in the visual manifest), confirmed by inspecting the diff
PNGs as stock Label/Input/Button geometry with no structural shift — `/account/2fa`'s
QR-TTL noise didn't manifest this cycle (timing-dependent, unrelated to this commit)
· **full e2e: 88 passed** (87 + the new gate spec) · browser pass at 360px, both
schemes, five routes — no overflow, QR plate's `bg-white` preserved in dark mode.

*Recorded by the orchestrator from the implementing agent's report.*

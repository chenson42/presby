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
| 2 — Architectural review | architect | Pending — scoped to slices 0 and a | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD | Pending | — | — |
| 5 — Verification | qa | **Deferred** (DECISION-045) | — | — |
| 6 — Shipped vs intent | analyst | **Deferred** (DECISION-045) | — | — |

*Recorded by the orchestrator from the read-only analyst agent. Full output preserved.*

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

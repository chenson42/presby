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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD | Pending | — | — |
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

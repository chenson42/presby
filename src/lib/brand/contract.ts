/**
 * The brand token contract.
 *
 * This file is data, not behaviour. It declares the closed vocabulary every
 * later slice reads: which colour roles exist, which CSS custom property each
 * role resolves to, which foreground/background pairs are legal and what
 * contrast floor each one carries, which of `globals.css`'s properties a
 * per-organization brand may re-declare, the type scale, and the platform
 * default palette itself.
 *
 * ZERO RUNTIME IMPORTS. No `@/lib/db`, no `next/*`, no `react`, no `drizzle`,
 * and no import of its own siblings — including `contrast.ts`, which imports
 * this file (type-only) and not the other way round. That constraint is what
 * lets the contract be read from an Edge route handler, from a `vitest` run
 * with no database, and from a plain `.mjs` script. It is cheap to hold now and
 * impossible to recover once one import lands. Type-only imports are permitted;
 * there are none today.
 *
 * Deliberately NOT `server-only` — the precedent is `src/lib/utils.ts:6-8`.
 * Four consumers are expected:
 *   1. server components emitting the per-org `<style>` element (slice c),
 *   2. `generate.ts`, the ramp generator (slice b),
 *   3. `contract.test.ts`, which proves the platform palette meets the floors
 *      this file declares,
 *   4. the `.mjs` script that emits the cron agent's instruction payload — the
 *      agent's rules are `JSON.stringify(LEGAL_PAIRS)`, literally this object,
 *      so the prompt cannot drift from the contract.
 *
 * Design: docs/work-log/2026-08-19-brand-foundation.md, Phase 3, commit `0.1`.
 * Derivation properties D1–D12 are Phase 1, "G2 — the derivation contract".
 */

/**
 * Pinned so that a generator improvement cannot silently re-skin every
 * congregation (D8, A13). Each org stores the version its tokens were derived
 * under; a bump is a deliberate, audited migration, never a dependency upgrade.
 *
 * 1 -> 2 (docs/work-log/2026-08-27-button-modernization.md, Phase 2/3):
 * `searchBrandLightness`'s light-scheme stopping condition changed — it now
 * also requires white-on-`brand` to clear D2 (4.5:1), not just D3
 * (brand-on-surface >=3:1), so `on-brand` resolves to white rather than
 * black for most light-scheme seeds. A materially different derivation, not
 * a bugfix-in-place. Per architect ruling (Phase 2 #2), `getOrgBrandForLayout()`
 * calls `generateBrandTokens()` unconditionally on every request and never
 * reads the stored `brand_token_version` column, so this bump does NOT gate
 * a migration the way the comment above implies it should — see the
 * read/write-asymmetry item in docs/TODO.md.
 */
export const BRAND_TOKEN_VERSION = 2;

/* -------------------------------------------------------------------------
 * Token policy — the three-way partition
 *
 * `TOKEN_POLICY` is the single source of truth for which custom properties
 * exist. `TokenName` is DERIVED from it, so a token cannot be referenced
 * anywhere in this file without first being classified here. That is what
 * makes "closed" a property of the type system rather than a claim in prose.
 *
 *   brandable — a per-org brand may re-declare this freely.
 *   bounded   — a per-org brand may re-declare it only within a named
 *               constraint the generator (slice b) must implement.
 *   platform  — never re-declarable. The content axis (S15) and the semantic
 *               colours (D6) belong to the platform for every organization.
 * ---------------------------------------------------------------------- */

export type TokenPolicy = "brandable" | "bounded" | "platform";

export type TokenEntry = {
  /** The CSS custom property, written exactly as `globals.css` declares it. */
  readonly token: string;
  readonly policy: TokenPolicy;
  /** Not declared in `globals.css` today; introduced by the emitter (slice c). */
  readonly additive?: true;
  /** Named now to keep the partition closed; does not exist anywhere yet. */
  readonly reserved?: true;
  /** Not a colour, so it carries no palette value and no contrast pair. */
  readonly nonColour?: true;
  /** The constraint slice b's generator must implement, for `bounded` only. */
  readonly bound?: string;
  /** One sentence, quotable in a review. */
  readonly why: string;
};

export const TOKEN_POLICY = [
  {
    token: "--primary",
    policy: "brandable",
    why: "The brand fill. S15's emphasis axis.",
  },
  {
    token: "--primary-foreground",
    policy: "brandable",
    why: "Computed against the brand fill, never fixed white (D2).",
  },
  {
    token: "--ring",
    policy: "brandable",
    why: "Focus ring; >=3:1 on the surface, with the ring offset making the clause about the ringed control structural (D4).",
  },
  {
    token: "--brand-raw",
    policy: "brandable",
    additive: true,
    why: "The unmodified seed, for decorative non-interactive surfaces (D10). This is how a congregation still sees THEIR colour.",
  },
  {
    token: "--brand-raw-foreground",
    policy: "brandable",
    additive: true,
    why: "A hero band carries text, and that text needs a foreground computed against the raw seed.",
  },
  {
    token: "--font-heading",
    policy: "brandable",
    additive: true,
    nonColour: true,
    why: "A per-org type pairing (TYPE_PAIRINGS) selects the heading face; not in globals.css until the font resolver (slice e1) emits it.",
  },
  {
    token: "--font-body",
    policy: "brandable",
    additive: true,
    nonColour: true,
    why: "Paired with --font-heading from the same curated TYPE_PAIRINGS entry; carries no palette value and no contrast pair.",
  },
  {
    token: "--background",
    policy: "bounded",
    bound: "nearWhiteOrNearDarkBand",
    why: "D7. A congregation may have a cream page; they may not have a gold page.",
  },
  {
    token: "--foreground",
    policy: "bounded",
    bound: "computedFor(--background, 7)",
    why: "Must follow the background or D1 breaks.",
  },
  {
    token: "--accent",
    policy: "bounded",
    bound: "nearNeutralTintWithin(--muted)",
    why: "Accent is menu/hover surface under content-axis text, not the brand fill; free re-declaration turns every dropdown hover into a brand block behind content (S15).",
  },
  {
    token: "--accent-foreground",
    policy: "bounded",
    bound: "computedFor(--accent, 7)",
    why: "Menu item labels are content, so the floor is 7:1 and not 4.5:1.",
  },
  {
    token: "--card",
    policy: "platform",
    why: "A clerk of session reads the roll on it — content axis, identical for every organization.",
  },
  {
    token: "--card-foreground",
    policy: "platform",
    why: "If the card is fixed its foreground must be too, or the pair is unverifiable.",
  },
  {
    token: "--popover",
    policy: "platform",
    why: "A menu or combobox surface is content, and it renders in a portal where no per-org scope is guaranteed to reach it.",
  },
  {
    token: "--popover-foreground",
    policy: "platform",
    why: "Fixed with --popover, or the pair is unverifiable.",
  },
  {
    token: "--muted",
    policy: "platform",
    why: "Content axis — table zebra, form interiors and empty states, which S15 keeps neutral everywhere.",
  },
  {
    token: "--muted-foreground",
    policy: "platform",
    why: "Content axis, and the D1 pair the platform must guarantee for every organization at once.",
  },
  {
    token: "--secondary",
    policy: "platform",
    why: "A neutral chip and secondary-button surface, i.e. content. Brandable would give a page two competing brand fills with no rule for which wins.",
  },
  {
    token: "--secondary-foreground",
    policy: "platform",
    why: "Fixed with --secondary; a chip label is content and is read at 7:1.",
  },
  {
    token: "--destructive",
    policy: "platform",
    why: "D6. A burgundy church must not get a Delete button indistinguishable from Save.",
  },
  {
    token: "--destructive-foreground",
    policy: "platform",
    why: "D6 covers the pair, not just the fill.",
  },
  {
    token: "--border",
    policy: "platform",
    why: "Decorative separators — a card edge and a table rule are not control identification.",
  },
  {
    token: "--input",
    policy: "platform",
    why: "Control identification (D3). Fixed so the 3:1 guarantee cannot be lowered per organization.",
  },
  {
    token: "--radius",
    policy: "platform",
    nonColour: true,
    why: "DECISION-048. A congregation does not choose corner radius; it is extensibility creep and it multiplies the verification surface.",
  },
  {
    token: "--success",
    policy: "platform",
    reserved: true,
    why: "Named now so the partition stays closed when the semantic-token slice lands; unlisted must never read as brandable.",
  },
  {
    token: "--success-foreground",
    policy: "platform",
    reserved: true,
    why: "Reserved with --success; the fill and its foreground are decided together or neither is verifiable.",
  },
  {
    token: "--warning",
    policy: "platform",
    reserved: true,
    why: "Reserved for the semantic-token slice; D6 fixes the semantic colours for every organization.",
  },
  {
    token: "--warning-foreground",
    policy: "platform",
    reserved: true,
    why: "Reserved with --warning, for the same reason its fill is.",
  },
  {
    token: "--info",
    policy: "platform",
    reserved: true,
    why: "Reserved for the semantic-token slice; an informational chip is not an emphasis surface.",
  },
  {
    token: "--info-foreground",
    policy: "platform",
    reserved: true,
    why: "Reserved with --info, for the same reason its fill is.",
  },
] as const satisfies readonly TokenEntry[];

/** Every custom property the contract knows about. Derived, never restated. */
export type TokenName = (typeof TOKEN_POLICY)[number]["token"];

/** Introduced by the emitter; absent from `globals.css`. */
export type AdditiveTokenName = Extract<
  (typeof TOKEN_POLICY)[number],
  { additive: true }
>["token"];

/** Classified in advance of existing anywhere. */
export type ReservedTokenName = Extract<
  (typeof TOKEN_POLICY)[number],
  { reserved: true }
>["token"];

/** Carries no colour, so no palette value and no contrast pair. */
export type NonColourTokenName = Extract<
  (typeof TOKEN_POLICY)[number],
  { nonColour: true }
>["token"];

/**
 * Exactly the set `globals.css` declares in `:root`. `contract.test.ts` parses
 * the stylesheet and asserts equality in both directions, so adding a token to
 * the CSS without classifying it here fails the build and names it.
 */
export type DeclaredTokenName = Exclude<
  TokenName,
  AdditiveTokenName | ReservedTokenName
>;

/** Exactly the set `PLATFORM_TOKENS` carries a colour for, in both schemes. */
export type PlatformTokenName = Exclude<
  TokenName,
  ReservedTokenName | NonColourTokenName
>;

/* -------------------------------------------------------------------------
 * Roles
 * ---------------------------------------------------------------------- */

/**
 * The closed role vocabulary. An agent composes roles; it never sees a hex
 * (G6). No block prop accepts a colour.
 */
export const BRAND_ROLES = [
  "surface",
  "on-surface",
  "brand",
  "on-brand",
  "brand-raw",
  "on-brand-raw",
  "muted-surface",
  "on-muted-surface",
  "accent",
  "on-accent",
  "border",
  "input-border",
  "ring",
  "danger",
  "on-danger",
] as const;

export type BrandRole = (typeof BRAND_ROLES)[number];

/**
 * Role -> the CSS custom property it resolves to. Total over `BRAND_ROLES`,
 * and the codomain is `PlatformTokenName` rather than `TokenName` so that
 * every role is guaranteed to have a platform default to measure against.
 */
export const ROLE_TO_TOKEN = {
  surface: "--background",
  "on-surface": "--foreground",
  brand: "--primary",
  "on-brand": "--primary-foreground",
  "brand-raw": "--brand-raw",
  "on-brand-raw": "--brand-raw-foreground",
  "muted-surface": "--muted",
  "on-muted-surface": "--muted-foreground",
  accent: "--accent",
  "on-accent": "--accent-foreground",
  border: "--border",
  "input-border": "--input",
  ring: "--ring",
  danger: "--destructive",
  "on-danger": "--destructive-foreground",
} as const satisfies Record<BrandRole, PlatformTokenName>;

/* -------------------------------------------------------------------------
 * Legal pairs
 *
 * The runtime array is the source of truth and the types are derived from it,
 * rather than two hand-maintained lists that drift. Three consequences, all
 * deliberate:
 *
 *   - the property test iterates LEGAL_PAIRS and reads `min` FROM THE PAIR
 *     rather than restating D1-D6, so adding a pair automatically adds its
 *     assertion, and a pair whose floor was never decided cannot be added
 *     because `min` is required;
 *   - a pair not in the array is not expressible in the type system, so a
 *     block's `tone:` typing falls out of the same array;
 *   - the agent's instruction data is JSON.stringify(LEGAL_PAIRS).
 *
 * Three choices inside the array that a reviewer should check rather than
 * assume:
 *
 *   1. `border` is NOT a pair; `input-border` is. D3 names input borders,
 *      focus rings and icon-only affordances. A card edge and a table rule are
 *      decoration, not "visual information required to identify a component".
 *      Splitting them is what lets the control border reach 3:1 without
 *      repainting every card edge in mid-grey. Companion rule for
 *      ui-standards.md: a border that identifies a CONTROL uses `border-input`;
 *      a border that separates CONTENT uses `border`.
 *   2. D4 is structural, not a lucky value. D4 wants the ring to clear 3:1
 *      against both the surface and the control it rings; `--ring` equals
 *      `--primary` by design, so a ring drawn flush against a primary button
 *      is 1.00:1 and invisible. Deriving a per-org ring that clears its own
 *      brand fill is possible and fragile at every seed. Instead every focus
 *      ring is drawn with FOCUS_RING_OFFSET_PX of surface colour between the
 *      ring and the control, so the ring is never adjacent to what it rings
 *      and D4 reduces to `ring on surface >= 3` — the pair below, which holds
 *      for every seed.
 *   3. D6 is not a contrast pair. "Minimum perceptual distance between primary
 *      and destructive" is a hue question; computed as a WCAG ratio it
 *      produces nonsense (today's blue against today's red scores 1.08, which
 *      says nothing). It ships as MIN_BRAND_DANGER_HUE_DISTANCE_DEG below.
 * ---------------------------------------------------------------------- */

export type BrandPair = {
  readonly fg: BrandRole;
  readonly bg: BrandRole;
  /** The WCAG contrast floor for THIS pair. Required — see above. */
  readonly min: number;
  readonly kind: "body" | "text" | "large-text" | "non-text";
  /** Traceability back to Phase 1's derivation properties. */
  readonly derives: string;
};

export const LEGAL_PAIRS = [
  { fg: "on-surface", bg: "surface", min: 7, kind: "body", derives: "D1" },
  {
    fg: "on-muted-surface",
    bg: "surface",
    min: 7,
    kind: "body",
    derives: "D1",
  },
  {
    fg: "on-muted-surface",
    bg: "muted-surface",
    min: 7,
    kind: "body",
    derives: "D1",
  },
  {
    fg: "on-accent",
    bg: "accent",
    min: 7,
    kind: "body",
    derives: "D1",
  },
  { fg: "on-brand", bg: "brand", min: 4.5, kind: "text", derives: "D2" },
  {
    fg: "on-brand-raw",
    bg: "brand-raw",
    min: 4.5,
    kind: "large-text",
    derives: "D2",
  },
  { fg: "on-danger", bg: "danger", min: 4.5, kind: "text", derives: "D2/D6" },
  {
    fg: "input-border",
    bg: "surface",
    min: 3,
    kind: "non-text",
    derives: "D3",
  },
  { fg: "ring", bg: "surface", min: 3, kind: "non-text", derives: "D4" },
  { fg: "brand", bg: "surface", min: 3, kind: "non-text", derives: "D3" },
] as const satisfies readonly BrandPair[];

export type LegalPair = (typeof LEGAL_PAIRS)[number];

/** Block `tone:` typing falls out of the array rather than being restated. */
export type LegalTone = LegalPair["bg"];

/* -------------------------------------------------------------------------
 * Emission
 * ---------------------------------------------------------------------- */

/**
 * The selectors the per-org `<style>` element emits under (slice c).
 *
 * `:root:root` is specificity 0,2,0 and beats `globals.css`'s `:root`;
 * `:root:root.dark` is 0,2,1 and beats it in turn. Specificity rather than
 * source order, because React does not guarantee where a rendered `<style>`
 * lands relative to the stylesheet, and source-order dependence is exactly the
 * kind of defect that passes `tsc`, `next build` and a page screenshot.
 * Exported so the emitter and its test share one string.
 */
export const BRAND_SCOPE_SELECTOR = ":root:root";
export const BRAND_SCOPE_SELECTOR_DARK = ":root:root.dark";

/* -------------------------------------------------------------------------
 * Floors that are not contrast pairs
 * ---------------------------------------------------------------------- */

/** G5: 16px body text. Never expressed in px in CSS — see TYPE_SCALE. */
export const MIN_BODY_PX = 16;

/** Nothing below 14px on a member-facing surface. */
export const MIN_MEMBER_FACING_PX = 14;

/** G5 / WCAG 2.5.5. */
export const MIN_TOUCH_TARGET_PX = 44;

/**
 * D6 as a hue distance, enforced by slice b's generator. Written down here so
 * slice b does not re-derive it and pick a different number.
 */
export const MIN_BRAND_DANGER_HUE_DISTANCE_DEG = 45;

/**
 * D4, made structural. Every focus ring is drawn with this much surface colour
 * between the ring and the control it rings, so the ring's contrast is only
 * ever measured against the surface. Slice a adds
 * `focus-visible:ring-offset-2 focus-visible:ring-offset-background` to
 * `button`, `badge` and `input` and records it as a deliberate divergence from
 * the shadcn registry in each file's header comment.
 */
export const FOCUS_RING_OFFSET_PX = 2;

/* -------------------------------------------------------------------------
 * Type scale
 *
 * Every size is rem, never px, so a future large-print mode is a root
 * multiplier rather than a rewrite (G5), and `text-size-adjust` is never
 * suppressed. Declared here in slice 0; conformance across the existing tree
 * is a separate sweep and is explicitly not slice a.
 * ---------------------------------------------------------------------- */

export type TypeScaleEntry = {
  readonly role: string;
  readonly rem: number;
  readonly px: number;
  readonly lineHeight: number;
  readonly tailwind: string;
  readonly where: string;
};

export const TYPE_SCALE = [
  {
    role: "display",
    rem: 1.875,
    px: 30,
    lineHeight: 1.2,
    tailwind: "text-3xl",
    where: "page-level hero",
  },
  {
    role: "title",
    rem: 1.5,
    px: 24,
    lineHeight: 1.25,
    tailwind: "text-2xl",
    where: "the single <h1>",
  },
  {
    role: "section",
    rem: 1.25,
    px: 20,
    lineHeight: 1.3,
    tailwind: "text-xl",
    where: "<h2>",
  },
  {
    role: "subhead",
    rem: 1.125,
    px: 18,
    lineHeight: 1.4,
    tailwind: "text-lg",
    where: "<h3>",
  },
  {
    role: "body",
    rem: 1,
    px: 16,
    lineHeight: 1.6,
    tailwind: "text-base",
    where: "all body copy — the floor",
  },
  {
    role: "dense",
    rem: 0.875,
    px: 14,
    lineHeight: 1.5,
    tailwind: "text-sm",
    where: "tabular cells, metadata, form labels. Never a paragraph.",
  },
  {
    role: "micro",
    rem: 0.75,
    px: 12,
    lineHeight: 1.4,
    tailwind: "text-xs",
    where: "(admin) and /developer only. Forbidden member-facing.",
  },
] as const satisfies readonly TypeScaleEntry[];

export type TypeRole = (typeof TYPE_SCALE)[number]["role"];

/* -------------------------------------------------------------------------
 * Type pairings
 *
 * A closed set of curated heading/body font combinations (S14). Chosen
 * against this product's own accessibility floor (AAA body text, S16) and
 * its audience, which skews older (S16) — legibility and x-height win over
 * character every time a choice was close. Google Fonts only; no display,
 * script, or decorative face made the list. Font RESOLUTION is deliberately
 * not here — `next/font/google` imports must be statically analyzable and
 * are Next-coupled, which this file's zero-runtime-imports rule forbids —
 * that lives in `src/lib/brand/fonts.ts` (slice e1), which imports only
 * `TypePairingKey` from this file. This array is data: the enum and the
 * reasoning behind each entry, nothing else.
 *
 * A10: each pairing must be validated against the real UI at 360px, in both
 * schemes, before being added — a curated set that was never validated is a
 * colour picker with fewer options. That validation is e1's job; adding an
 * entry here without it happening is not itself a contract violation, but
 * shipping one to `fonts.ts` unvalidated would be.
 * ---------------------------------------------------------------------- */

export type TypePairing = {
  /** kebab-case, stored verbatim in `organization_brands.type_pairing`. */
  readonly key: string;
  /** Human-facing, shown in the editor (slice d). */
  readonly label: string;
  /** Google Fonts family name, resolved to a `next/font/google` import in `fonts.ts`. */
  readonly heading: string;
  /** Google Fonts family name, resolved to a `next/font/google` import in `fonts.ts`. */
  readonly body: string;
  /** One sentence, quotable in a review. */
  readonly why: string;
};

export const TYPE_PAIRINGS = [
  {
    key: "classic",
    label: "Classic",
    heading: "Lora",
    body: "Source Sans 3",
    why: "Lora's calm, low-contrast serif curves read as a printed bulletin without tipping into a historic or ornamental register, and Source Sans 3's wide apertures and large x-height keep it legible in a table cell at the dense role.",
  },
  {
    key: "modern",
    label: "Modern",
    heading: "Libre Franklin",
    body: "Public Sans",
    why: "Libre Franklin's grotesque sturdiness gives headings and a hero band confident weight without reading as trendy, and Public Sans — engineered by the U.S. government specifically for cross-age accessibility — keeps body copy legible at small sizes for a member squinting at a phone.",
  },
  {
    key: "warm",
    label: "Warm",
    heading: "Bitter",
    body: "Karla",
    why: "Bitter's slab serif is grounded and warm, evoking a hymnal or bulletin insert rather than a corporate report, and Karla's rounded humanist letterforms carry the same warmth into body copy while holding a large x-height at the dense role.",
  },
  {
    key: "contemporary",
    label: "Contemporary",
    heading: "Montserrat",
    body: "Open Sans",
    why: "Montserrat's geometric, even-stroke caps give headings and a hero band a confident, current voice without tipping into corporate or trend-chasing, and Open Sans's open apertures and near-ubiquitous familiarity keep body copy calm and easy to scan, holding a large x-height at the dense role.",
  },
] as const satisfies readonly TypePairing[];

/** For `fonts.ts` (slice e1) to import as a type-only reference. */
export type TypePairingKey = (typeof TYPE_PAIRINGS)[number]["key"];

/* -------------------------------------------------------------------------
 * The platform default palette
 *
 * `globals.css` transcribes THIS, and `contract.test.ts` parses the stylesheet
 * and asserts the transcription rather than trusting it — otherwise the pair
 * tests would pass against values the browser never renders.
 *
 * The additive `--brand-raw` roles have no seed on the platform default (there
 * is no congregation and therefore no raw brand colour), so they take the
 * primary values. They are the one part of PLATFORM_TOKENS that `globals.css`
 * does not declare, and the transcription test skips exactly the entries
 * TOKEN_POLICY marks `additive`.
 *
 * G1: the default is deliberately NOT presby's marketing identity in the long
 * run — an ecclesiastically neutral register is a separate visual decision and
 * is out of scope here. What slice 0 does is make the CURRENT default meet the
 * floors this file declares.
 * ---------------------------------------------------------------------- */

export type Scheme = "light" | "dark";

export const PLATFORM_TOKENS = {
  light: {
    "--background": "hsl(0 0% 100%)",
    "--foreground": "hsl(222 47% 11%)",
    "--card": "hsl(0 0% 100%)",
    "--card-foreground": "hsl(222 47% 11%)",
    "--popover": "hsl(0 0% 100%)",
    "--popover-foreground": "hsl(222 47% 11%)",
    "--primary": "hsl(221 83% 53%)",
    "--primary-foreground": "hsl(0 0% 100%)",
    "--brand-raw": "hsl(221 83% 53%)",
    "--brand-raw-foreground": "hsl(0 0% 100%)",
    "--secondary": "hsl(210 40% 96%)",
    "--secondary-foreground": "hsl(222 47% 11%)",
    "--muted": "hsl(210 40% 96%)",
    "--muted-foreground": "hsl(215 16% 33%)",
    "--accent": "hsl(210 40% 96%)",
    "--accent-foreground": "hsl(222 47% 11%)",
    "--destructive": "hsl(0 72% 51%)",
    "--destructive-foreground": "hsl(0 0% 100%)",
    "--border": "hsl(214 32% 91%)",
    "--input": "hsl(214 32% 59%)",
    "--ring": "hsl(221 83% 53%)",
  },
  dark: {
    "--background": "hsl(222 47% 11%)",
    "--foreground": "hsl(210 40% 98%)",
    "--card": "hsl(217 33% 17%)",
    "--card-foreground": "hsl(210 40% 98%)",
    "--popover": "hsl(217 33% 17%)",
    "--popover-foreground": "hsl(210 40% 98%)",
    "--primary": "hsl(217 91% 60%)",
    "--primary-foreground": "hsl(222 47% 11%)",
    "--brand-raw": "hsl(217 91% 60%)",
    "--brand-raw-foreground": "hsl(222 47% 11%)",
    "--secondary": "hsl(217 33% 17%)",
    "--secondary-foreground": "hsl(210 40% 98%)",
    "--muted": "hsl(217 33% 17%)",
    "--muted-foreground": "hsl(215 20% 73%)",
    "--accent": "hsl(217 33% 17%)",
    "--accent-foreground": "hsl(210 40% 98%)",
    "--destructive": "hsl(0 84% 60%)",
    "--destructive-foreground": "hsl(222 47% 11%)",
    "--border": "hsl(217 33% 22%)",
    "--input": "hsl(217 33% 50%)",
    "--ring": "hsl(217 91% 60%)",
  },
} as const satisfies Record<Scheme, Record<PlatformTokenName, string>>;

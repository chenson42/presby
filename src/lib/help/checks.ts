/**
 * check:help's pure rules, H1 to H18 (R7, Phase 3 "check:help, the ninth tripwire"). Each rule
 * is a function over a plain, in-memory input, so every one has a failing and a passing fixture
 * in checks.test.ts and none reads the tree. scripts/check-help.ts builds the input from the
 * repo and prints `[H<n>] <file>: <message>`. H19 (the import boundary) is
 * scripts/lib/help-boundary.mjs; the catalog and tile coverage rules are coverage.test.ts,
 * because those modules cannot be imported by tsx (P3-1).
 *
 * Relative imports only (this directory is walked by H19).
 */
import { allowedExternalHosts, linkContext, resolveLink } from "./links";
import { EXAMPLE_NAMES, GENERIC_PHRASES, LEAD_WORDS } from "./example-names";
import { scanMarkdown } from "./markdown-scan";
import { extractHeadings } from "./headings";
import { readTodoTokens, readingFor, type TodoReading } from "./todo-grammar";
import { HELP_CONTACT_LINE } from "./contact";
import { applyHelpTokens, unknownTemplateTokens } from "./tokens";
import type { HelpContentEntry, HelpEntry, HelpPlannedEntry, HelpShot, HelpToken } from "./types";

export interface HelpFile {
  path: string;
  content: string;
}

export interface HelpImageFile {
  /** File name inside src/content/help/images/. */
  name: string;
  size: number;
  /** From the PNG header; null when the header is not a PNG's. */
  width: number | null;
  height: number | null;
}

export interface HelpCheckInput {
  pages: readonly HelpEntry[];
  /** src/content/help/*.md, raw (before {{contact}}). */
  contentFiles: readonly HelpFile[];
  imageFiles: readonly HelpImageFile[];
  shots: readonly HelpShot[];
  /** The source of screenshots.ts, or null when it does not exist yet. */
  screenshotsSource: string | null;
  slugHistory: readonly string[];
  /** docs/TODO.md. */
  todo: string;
  /** package.json's version. */
  packageVersion: string;
  /** docs/product/functionality-map.md. */
  functionalityMap: string;
  /** Non-test files under src/, for H10 and H16. */
  srcFiles: readonly HelpFile[];
  contact?: string;
}

export interface HelpViolation {
  rule: string;
  file: string;
  message: string;
}

export const formatViolation = (v: HelpViolation) => `[${v.rule}] ${v.file}: ${v.message}`;

// ---- shared helpers -----------------------------------------------------------

const REGISTRY = "src/lib/help/registry.ts";
const TODO_FILE = "docs/TODO.md";
const CONTENT_DIR = "src/content/help";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const RESERVED = new Set(["planned", "contact"]);

const isContent = (p: HelpEntry): p is HelpContentEntry => p.status !== "planned";
const isPublished = (p: HelpEntry): p is HelpContentEntry => p.status === "published";
const isPlanned = (p: HelpEntry): p is HelpPlannedEntry => p.status === "planned";
const contentPath = (slug: string) => `${CONTENT_DIR}/${slug}.md`;

function contentOf(input: HelpCheckInput, slug: string): string | undefined {
  const f = input.contentFiles.find((c) => c.path === contentPath(slug));
  return f ? applyHelpTokens(f.content, input.contact ?? HELP_CONTACT_LINE) : undefined;
}

/** Content entries that have a file, with the text the content rules read. */
function contentPages(input: HelpCheckInput, filter: (p: HelpContentEntry) => boolean = () => true) {
  const out: { entry: HelpContentEntry; file: string; text: string }[] = [];
  for (const entry of input.pages.filter(isContent).filter(filter)) {
    const text = contentOf(input, entry.slug);
    if (text !== undefined) out.push({ entry, file: contentPath(entry.slug), text });
  }
  return out;
}

const cmpVersion = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

function parseTodo(input: HelpCheckInput): TodoReading {
  return readTodoTokens(input.todo);
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** The strings a published entry shows people (H8 and H9 read these). */
function registryStrings(e: HelpEntry): string[] {
  if (isPlanned(e)) return [e.title, e.summary, e.forWhom, e.today];
  return [e.title, e.summary, ...(e.needs ? [e.needs.who] : [])];
}

// ---- H1: registry shape -----------------------------------------------------------

function h1(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const v = (message: string) => out.push({ rule: "H1", file: REGISTRY, message });
  const slugs = new Map<string, number>();
  const aliasUse = new Map<string, number>();
  const replacesUse = new Map<string, number>();
  const orderUse = new Map<string, string>();

  for (const e of input.pages) {
    slugs.set(e.slug, (slugs.get(e.slug) ?? 0) + 1);
    if (!SLUG_RE.test(e.slug) || e.slug.length > 60) v(`slug "${e.slug}" must be kebab-case and at most 60 characters.`);
    if (RESERVED.has(e.slug)) v(`slug "${e.slug}" is reserved (/help/planned and /help/contact are routes).`);
    if (!e.title.trim()) v(`${e.slug}: title is empty.`);
    if (!e.summary.trim()) v(`${e.slug}: summary is empty.`);
    for (const a of e.aliases ?? []) {
      aliasUse.set(a, (aliasUse.get(a) ?? 0) + 1);
      if (!SLUG_RE.test(a)) v(`${e.slug}: alias "${a}" is not a kebab-case slug.`);
    }

    const group = isPlanned(e) ? "planned" : e.audience;
    const key = `${group}:${e.order}`;
    if (orderUse.has(key)) v(`${e.slug}: order ${e.order} is already used by ${orderUse.get(key)} in the same group.`);
    else orderUse.set(key, e.slug);

    if (isPlanned(e)) {
      if (!e.forWhom.trim()) v(`${e.slug}: a planned entry needs forWhom.`);
      if (!e.today.trim()) v(`${e.slug}: a planned entry needs a "today" line.`);
      if (!isIsoDate(e.confirmedOn)) v(`${e.slug}: confirmedOn "${e.confirmedOn}" is not an ISO date (YYYY-MM-DD).`);
      continue;
    }
    for (const r of e.replaces ?? []) replacesUse.set(r, (replacesUse.get(r) ?? 0) + 1);
    if (e.status === "published" && !e.verifiedIn) v(`${e.slug}: a published entry needs verifiedIn.`);
    if (e.status === "pending" && !e.requires) v(`${e.slug}: a pending entry needs requires (its [help:<token>]).`);
    if (e.requires !== undefined && !SLUG_RE.test(e.requires)) v(`${e.slug}: requires "${e.requires}" is not a token.`);
    if (e.limitationUntil !== undefined) {
      const tokens = limitationTokens(e);
      if (tokens.length === 0) v(`${e.slug}: limitationUntil is an empty list; remove the marker.`);
      for (const t of tokens) if (!SLUG_RE.test(t)) v(`${e.slug}: limitationUntil "${t}" is not a token.`);
    }
  }

  for (const [slug, n] of slugs) if (n > 1) v(`duplicate slug "${slug}".`);
  for (const [a, n] of aliasUse) {
    if (n > 1) v(`alias "${a}" is used by more than one entry (or twice).`);
    if (slugs.has(a)) v(`alias "${a}" equals a live slug.`);
  }
  for (const [r, n] of replacesUse) {
    if (n > 1) v(`replaces target "${r}" is used more than once.`);
    if (slugs.has(r)) v(`replaces target "${r}" equals a live slug (delete the placeholder).`);
  }
  return out;
}

// ---- H2: file parity ----------------------------------------------------------------

function h2(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const wanted = new Set(input.pages.filter(isContent).map((p) => p.slug));
  const planned = new Set(input.pages.filter(isPlanned).map((p) => p.slug));
  const files = new Set(input.contentFiles.map((f) => f.path));

  for (const slug of wanted) {
    if (!files.has(contentPath(slug))) out.push({ rule: "H2", file: REGISTRY, message: `${slug}: no file ${contentPath(slug)}.` });
  }
  for (const f of input.contentFiles) {
    const slug = f.path.slice(CONTENT_DIR.length + 1).replace(/\.md$/, "");
    if (planned.has(slug)) out.push({ rule: "H2", file: f.path, message: `"${slug}" is a planned entry; a planned entry has no file.` });
    else if (!wanted.has(slug)) out.push({ rule: "H2", file: f.path, message: `no registry entry for this file (an orphan).` });
  }
  return out;
}

// ---- H3: slug permanence ---------------------------------------------------------------

function h3(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const history = new Set(input.slugHistory);
  const current = new Set(input.pages.map((p) => p.slug));
  const retired = new Set<string>();
  for (const p of input.pages) {
    for (const a of p.aliases ?? []) retired.add(a);
    if (isContent(p)) for (const r of p.replaces ?? []) retired.add(r);
  }
  for (const p of input.pages) {
    if (p.status !== "pending" && !history.has(p.slug)) {
      out.push({ rule: "H3", file: "src/lib/help/slug-history.ts", message: `"${p.slug}" is ${p.status} but is not in slug-history.ts (append it).` });
    }
  }
  for (const slug of history) {
    if (!current.has(slug) && !retired.has(slug)) {
      out.push({ rule: "H3", file: "src/lib/help/slug-history.ts", message: `"${slug}" was published or planned once and is now neither a current slug, an alias, nor a replaced placeholder. A URL people bookmarked would 404; give it an alias or replaces.` });
    }
  }
  return out;
}

// ---- H4: headings --------------------------------------------------------------------------

function h4(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const { entry, file, text } of contentPages(input)) {
    const scan = scanMarkdown(text);
    const v = (line: number, message: string) => out.push({ rule: "H4", file, message: `line ${line}: ${message}` });
    let previous = 1; // the page's own <h1> comes from the registry title
    for (const h of scan.headings) {
      if (h.level === 1) v(h.line, "a level-1 heading; the title is the page's only h1 (start at ##).");
      if (!h.text.replace(/[`*_~\s]/g, "")) v(h.line, "an empty heading.");
      if (h.level > previous + 1) v(h.line, `heading level jumps from h${previous} to h${h.level}.`);
      previous = Math.max(h.level, 1);
    }
    const ids = new Set(extractHeadings(text).map((h) => h.id));
    for (const a of entry.anchors ?? []) {
      if (!ids.has(a)) out.push({ rule: "H4", file, message: `declared anchor "${a}" matches no heading.` });
    }
  }
  return out;
}

// ---- H5: the closed subset ----------------------------------------------------------------------

function h5(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const f of input.contentFiles) {
    const raw = f.content;
    const text = applyHelpTokens(raw, input.contact ?? HELP_CONTACT_LINE);
    const scan = scanMarkdown(text);
    const v = (line: number, what: string, snippet?: string) =>
      out.push({ rule: "H5", file: f.path, message: `line ${line}: ${what}${snippet ? ` (${snippet})` : ""}.` });
    for (const x of scan.rawHtml) v(x.line, "raw HTML is not allowed", x.snippet);
    for (const x of scan.referenceLinks) v(x.line, "reference-style links are not allowed; use an inline link", x.snippet);
    for (const x of scan.autolinks) v(x.line, "an <autolink> is not allowed; use an inline link", x.snippet);
    for (const x of scan.bareUrls) v(x.line, "a bare URL is not allowed; use an inline link", x.snippet);
    for (const x of scan.entities) v(x.line, "an HTML entity is left over; write the character", x.snippet);
    for (const x of scan.setext) v(x.line, "setext headings are not allowed; use #", x.snippet);
    for (const x of unknownTemplateTokens(raw)) v(x.line, "only {{contact}} and {{privacyContact}} are template tokens", x.snippet);
  }
  return out;
}

// ---- H6: links ----------------------------------------------------------------------------------------

const VAGUE_LINK_TEXT = new Set(["here", "click here", "this link", "link", "read more"]);

function h6(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const ctx = linkContext(input.pages);
  for (const { entry, file, text } of contentPages(input)) {
    for (const l of scanMarkdown(text).links) {
      const where = `line ${l.line}`;
      if (!resolveLink(l.destination, ctx, { includePending: entry.status === "pending" })) {
        out.push({ rule: "H6", file, message: `${where}: "${l.destination}" is not a link help may carry (a published page, a declared anchor, /launch, /signin, or an allowlisted https URL).` });
      }
      const plain = l.text.replace(/[`*_~]/g, "").trim().toLowerCase().replace(/[.!?:;,]+$/, "");
      if (VAGUE_LINK_TEXT.has(plain)) out.push({ rule: "H6", file, message: `${where}: link text "${l.text.trim()}" says nothing out of context; name the page it opens.` });
    }
  }
  return out;
}

// ---- H7: images -----------------------------------------------------------------------------------------------

function h7(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const ids = new Set(input.shots.map((s) => s.id));
  for (const { file, text } of contentPages(input)) {
    for (const img of scanMarkdown(text).images) {
      const where = `line ${img.line}`;
      const m = /^shot:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(img.source);
      if (!m) out.push({ rule: "H7", file, message: `${where}: image source "${img.source}" must be shot:<id> (no remote, relative or tracking images).` });
      else if (!ids.has(m[1])) out.push({ rule: "H7", file, message: `${where}: shot:${m[1]} is not in screenshots-data.ts.` });
      const alt = img.alt.trim();
      if (!alt) out.push({ rule: "H7", file, message: `${where}: an image needs alt text.` });
      else if (alt.length > 125) out.push({ rule: "H7", file, message: `${where}: alt text is ${alt.length} characters; keep it to 125.` });
    }
  }
  return out;
}

// ---- H8: banned phrases ------------------------------------------------------------------------------------------

const BANNED_PHRASES = [
  "coming soon",
  "will be able to",
  "planned",
  "in a future release",
  "in the future",
  "next release",
  "later this year",
  "stay tuned",
];
const BANNED_RE = new RegExp(`\\b(${BANNED_PHRASES.map((p) => p.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

function h8(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const { file, text } of contentPages(input, (e) => e.status === "published")) {
    const prose = scanMarkdown(text).prose;
    for (const m of prose.matchAll(BANNED_RE)) {
      const line = prose.slice(0, m.index).split("\n").length;
      out.push({ rule: "H8", file, message: `line ${line}: "${m[0]}" promises a future; help describes what is there today.` });
    }
  }
  for (const e of input.pages.filter(isPublished)) {
    for (const s of registryStrings(e)) {
      for (const m of s.matchAll(BANNED_RE)) out.push({ rule: "H8", file: REGISTRY, message: `${e.slug}: "${m[0]}" in a registry string promises a future.` });
    }
  }
  return out;
}

// ---- H9: no real data -------------------------------------------------------------------------------------------------

const HOST_SHAPES: [RegExp, string][] = [
  [/\b[\w.-]*\.neon\.tech\b/i, "a Neon hostname"],
  [/\b[\w.-]*vercel\.app\b/i, "a Vercel hostname"],
  [/\bep-[a-z]+-[a-z]+-[a-z0-9]+\b/i, "a Neon endpoint identifier"],
  [/\bbr-[a-z]+-[a-z]+-[a-z0-9]+\b/i, "a Neon branch identifier"],
  [/\bsnap-[a-z]+-[a-z]+-[a-z0-9]+\b/i, "a snapshot identifier"],
];
// `site-<slug>` is the name of a church's site repository; these ordinary words are not one.
const SITE_REPO_RE = /\bsite-(?!(?:wide|specific|level|based|owner|builder|kit|content|map|search)\b)[a-z0-9]+(?:-[a-z0-9]+)*\b/i;
const NAME_HEADS = new Set(["Church", "Presbytery", "Synod"]);

function namedOrganisations(line: string): string[] {
  const words = line.split(/\s+/).map((w) => w.replace(/^[("'“‘]+|[.,;:!?)"'”’]+$/g, ""));
  const found: string[] = [];
  words.forEach((w, j) => {
    if (!NAME_HEADS.has(w)) return;
    const phrase: string[] = [w];
    for (let k = j - 1; k >= 0 && /^[A-Z][A-Za-z'’-]*$/.test(words[k]); k--) phrase.unshift(words[k]);
    while (phrase.length > 1 && LEAD_WORDS.includes(phrase[0])) phrase.shift();
    if (phrase.length < 2) return;
    const name = phrase.join(" ");
    if (EXAMPLE_NAMES.includes(name) || GENERIC_PHRASES.includes(name)) return;
    found.push(name);
  });
  return found;
}

function realDataIn(text: string, hosts: Set<string>): string[] {
  const out: string[] = [];
  for (const [re, what] of HOST_SHAPES) if (re.test(text)) out.push(`contains ${what}.`);
  if (SITE_REPO_RE.test(text)) out.push("contains a site-<name> repository name.");
  for (const m of text.matchAll(/https?:\/\/([^/\s)>"'`]+)/gi)) {
    if (!hosts.has(m[1].toLowerCase())) out.push(`links a host that is not on the external allowlist (${m[1]}).`);
  }
  for (const line of text.split("\n")) {
    for (const name of namedOrganisations(line)) {
      out.push(`names "${name}", which looks like a real congregation. Use an invented name and add it to src/lib/help/example-names.ts.`);
    }
  }
  return out;
}

function h9(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const hosts = new Set(allowedExternalHosts());
  for (const { file, text } of contentPages(input)) {
    for (const message of realDataIn(text, hosts)) out.push({ rule: "H9", file, message });
  }
  for (const e of input.pages) {
    for (const message of realDataIn(registryStrings(e).join("\n"), hosts)) out.push({ rule: "H9", file: REGISTRY, message: `${e.slug}: ${message}` });
  }
  return out;
}

// ---- H10: labels --------------------------------------------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s
    .replace(/\\(['"])/g, "$1")
    .replace(/&apos;|&rsquo;|&lsquo;|&#39;|&#x27;|[‘’]/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const LABEL_EXCLUDED = ["src/content/", "src/lib/help/", "src/components/help/"];

function h10(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const uiText = input.srcFiles
    .filter((f) => !/\.test\.[tj]sx?$/.test(f.path) && !LABEL_EXCLUDED.some((d) => f.path.startsWith(d)))
    .map((f) => normalizeText(f.content));
  for (const { entry, file, text } of contentPages(input, (e) => e.status === "published")) {
    const own = normalizeText([text, ...registryStrings(entry)].join("\n"));
    for (const label of entry.labels) {
      const wanted = normalizeText(label);
      if (!wanted) continue;
      if (!uiText.some((t) => t.includes(wanted))) {
        out.push({ rule: "H10", file, message: `label "${label}" is in no non-test src/ file: the UI no longer says it.` });
      } else if (!own.includes(wanted)) {
        out.push({ rule: "H10", file, message: `label "${label}" is declared but this page never says it (a stale label cannot vouch for the page).` });
      }
    }
  }
  return out;
}

// ---- H11: needs ----------------------------------------------------------------------------------------------------------------------

const PERMISSION_KEY_RE =
  /\b(?:org_features|role_grants|people|roles|groups|officers|tickets|staff|domains|careers|branding|events|directory|parishes|giving|credentials|filings|statistics|org_portal|admin|sites|auth|feedback|audit)\.[a-z_]+\b/;

function h11(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const e of input.pages.filter(isPublished)) {
    if (!e.needs) continue;
    if (!e.needs.who.trim()) out.push({ rule: "H11", file: REGISTRY, message: `${e.slug}: needs.who is empty.` });
    else if (PERMISSION_KEY_RE.test(e.needs.who)) out.push({ rule: "H11", file: REGISTRY, message: `${e.slug}: needs.who names a permission key; say the role in the UI's own words.` });
  }
  return out;
}

/** The limitation tokens an entry names, as a list (none, one, or several). */
function limitationTokens(e: { limitationUntil?: HelpToken | readonly HelpToken[] }): readonly HelpToken[] {
  if (e.limitationUntil === undefined) return [];
  return typeof e.limitationUntil === "string" ? [e.limitationUntil] : e.limitationUntil;
}

// ---- H12: publication against docs/TODO.md --------------------------------------------------------------------------------------------

function h12(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const v = (message: string) => out.push({ rule: "H12", file: TODO_FILE, message });
  const read = parseTodo(input);
  if (!read.classifiable) return [{ rule: "H12", file: TODO_FILE, message: read.reason ?? "cannot classify the file." }];

  // Global: whatever carries a token must be readable, whether or not an entry uses it yet.
  for (const r of read.readings.values()) {
    if (r.state === "ambiguous") v(`[help:${r.token}] on line ${r.lines.join(", ")} is ambiguous: it must be a "- [ ]" line above "## Done" (open) or a "- [x]" line below it (done).`);
    if (r.state === "duplicate") v(`[help:${r.token}] occurs more than once (lines ${r.lines.join(", ")}); a token belongs on exactly one line.`);
  }
  const reported = (state: string) => state === "ambiguous" || state === "duplicate";

  const need = (who: string, token: string, state: string, lines: number[]) => {
    if (state === "missing") v(`${who}: [help:${token}] appears on no line of docs/TODO.md.`);
    return !reported(state) && state !== "missing";
  };

  const plannedTokens = new Set(input.pages.filter(isPlanned).map((p) => p.slug));
  for (const e of input.pages) {
    if (isPlanned(e)) {
      const r = readingFor(read, e.slug);
      if (!need(e.slug, e.slug, r.state, r.lines)) continue;
      if (r.state === "done" || r.state === "declined") v(`${e.slug}: its line is ${r.state}; replace or remove the placeholder.`);
      continue;
    }
    if (e.requires !== undefined) {
      if (plannedTokens.has(e.requires)) v(`${e.slug}: requires "${e.requires}", which is a planned entry's token; a planned token belongs to one entry.`);
      const r = readingFor(read, e.requires);
      if (need(e.slug, e.requires, r.state, r.lines)) {
        if (e.status === "published" && r.state !== "done") {
          v(`${e.slug}: published, but [help:${e.requires}] is ${r.state}; a page cannot go live ahead of its feature (set it pending).`);
        }
        if (e.status === "pending") {
          if (r.state === "done") v(`${e.slug}: feature shipped: publish its page ([help:${e.requires}] is Done).`);
          else if (r.state === "declined") v(`${e.slug}: [help:${e.requires}] is declined; remove the pending page.`);
        }
      }
    }
    for (const token of limitationTokens(e)) {
      const r = readingFor(read, token);
      if (need(e.slug, token, r.state, r.lines)) {
        if (r.state === "done") v(`${e.slug}: feature shipped: remove the limitation sentence and the marker (limitationUntil: ${token}).`);
        else if (r.state === "declined") v(`${e.slug}: [help:${token}] is declined; the limitation will not lift, remove the marker.`);
      }
    }
  }
  return out;
}

// ---- H13: verifiedIn ----------------------------------------------------------------------------------------------------------------------

function h13(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const e of input.pages.filter(isContent)) {
    if (e.verifiedIn === null) continue;
    if (!VERSION_RE.test(e.verifiedIn)) out.push({ rule: "H13", file: REGISTRY, message: `${e.slug}: verifiedIn "${e.verifiedIn}" is not a version.` });
    else if (cmpVersion(e.verifiedIn, input.packageVersion) > 0) {
      out.push({ rule: "H13", file: REGISTRY, message: `${e.slug}: verifiedIn ${e.verifiedIn} is later than package.json's ${input.packageVersion}; a page cannot have been walked against a release that does not exist.` });
    }
  }
  return out;
}

// ---- H14: covers syntax ---------------------------------------------------------------------------------------------------------------------

const COVERS_RE = /^(?:org_portal\.[a-z0-9_]+|tile:[a-z0-9]+(?:-[a-z0-9]+)*|flag:[a-z0-9_]+(?:\.[a-z0-9_]+)+|route:\/[A-Za-z0-9/_{}-]*)$/;

function h14(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const e of input.pages.filter(isContent)) {
    for (const c of e.covers) {
      if (!COVERS_RE.test(c)) out.push({ rule: "H14", file: REGISTRY, message: `${e.slug}: covers "${c}" must be org_portal.<key>, tile:<key>, flag:<key> or route:/<path>.` });
    }
  }
  return out;
}

// ---- H15: the functionality map ---------------------------------------------------------------------------------------------------------------

function h15(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const e of input.pages.filter(isPublished)) {
    const re = new RegExp(`/help/${e.slug}(?![a-z0-9-])`);
    if (!re.test(input.functionalityMap)) {
      out.push({ rule: "H15", file: "docs/product/functionality-map.md", message: `no mention of /help/${e.slug} (Workflow Rule 14: add it to the bullet the page covers).` });
    }
  }
  return out;
}

// ---- H16: hand-built /help literals ----------------------------------------------------------------------------------------------------------------

const H16_EXEMPT = ["src/lib/help/", "src/proxy.ts", "src/app/(documentation)/"];
const HELP_LITERAL_RE = /(["'`])\/help(?=[/#?"'`${\\]|\s|$)/g;

function h16(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  for (const f of input.srcFiles) {
    if (/\.test\.[tj]sx?$/.test(f.path) || H16_EXEMPT.some((p) => f.path.startsWith(p))) continue;
    f.content.split("\n").forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (HELP_LITERAL_RE.test(line)) out.push({ rule: "H16", file: f.path, message: `line ${i + 1}: a string beginning /help; build in-app help links with helpHref() (src/lib/help/urls.ts).` });
      HELP_LITERAL_RE.lastIndex = 0;
    });
  }
  return out;
}

// ---- H17: images on disk ------------------------------------------------------------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 400 * 1024;

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG header. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const be = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: be(16), height: be(20) };
}

function h17(input: HelpCheckInput): HelpViolation[] {
  const out: HelpViolation[] = [];
  const DATA = "src/lib/help/screenshots-data.ts";
  const shots = new Map(input.shots.map((s) => [s.id, s]));
  const files = new Map(input.imageFiles.map((f) => [f.name, f]));

  for (const f of input.imageFiles) {
    const dir = `${CONTENT_DIR}/images/${f.name}`;
    const m = /^(.+)\.png$/.exec(f.name);
    if (!m) {
      out.push({ rule: "H17", file: dir, message: "not a .png file." });
      continue;
    }
    const shot = shots.get(m[1]);
    if (!shot) {
      out.push({ rule: "H17", file: dir, message: `no entry "${m[1]}" in screenshots-data.ts (an orphan file).` });
      continue;
    }
    if (f.width === null || f.height === null) out.push({ rule: "H17", file: dir, message: "the file header is not a PNG's." });
    else if (f.width !== shot.width || f.height !== shot.height) {
      out.push({ rule: "H17", file: dir, message: `is ${f.width}x${f.height} but screenshots-data.ts says ${shot.width}x${shot.height}.` });
    }
    if (f.size > MAX_IMAGE_BYTES) out.push({ rule: "H17", file: dir, message: `is ${Math.ceil(f.size / 1024)} KB; the limit is 400 KB.` });
  }

  const referenced = new Set<string>();
  for (const { text } of contentPages(input)) {
    for (const img of scanMarkdown(text).images) {
      const m = /^shot:(.+)$/.exec(img.source);
      if (m) referenced.add(m[1]);
    }
  }
  for (const s of input.shots) {
    if (!files.has(`${s.id}.png`)) out.push({ rule: "H17", file: DATA, message: `${s.id}: no file ${CONTENT_DIR}/images/${s.id}.png.` });
    if (!VERSION_RE.test(s.capturedIn) || cmpVersion(s.capturedIn, input.packageVersion) > 0) {
      out.push({ rule: "H17", file: DATA, message: `${s.id}: capturedIn ${s.capturedIn} is not a version at most package.json's ${input.packageVersion}.` });
    }
    if (!referenced.has(s.id)) out.push({ rule: "H17", file: DATA, message: `${s.id}: no published or pending page uses it.` });
  }
  return out;
}

// ---- H18: screenshots.ts imports ------------------------------------------------------------------------------------------------------------------------------

function h18(input: HelpCheckInput): HelpViolation[] {
  const FILE = "src/lib/help/screenshots.ts";
  const out: HelpViolation[] = [];
  if (input.screenshotsSource === null) {
    if (input.shots.length > 0) out.push({ rule: "H18", file: FILE, message: "screenshots-data.ts has entries but screenshots.ts does not exist." });
    return out;
  }
  const counts = new Map<string, number>();
  for (const m of input.screenshotsSource.matchAll(/import\s+[\w{},\s*]+\s+from\s*["']@\/content\/help\/images\/([^"']+)["']/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const wanted = new Set(input.shots.map((s) => `${s.id}.png`));
  for (const name of wanted) {
    const n = counts.get(name) ?? 0;
    if (n === 0) out.push({ rule: "H18", file: FILE, message: `no static import of images/${name}.` });
    if (n > 1) out.push({ rule: "H18", file: FILE, message: `images/${name} is imported ${n} times; exactly one.` });
  }
  for (const name of counts.keys()) {
    if (!wanted.has(name)) out.push({ rule: "H18", file: FILE, message: `imports images/${name}, which has no entry in screenshots-data.ts.` });
  }
  return out;
}

// ---- registry of rules ---------------------------------------------------------------------------------------------------------------------------------------------

export const HELP_RULES: Record<string, (input: HelpCheckInput) => HelpViolation[]> = {
  H1: h1, H2: h2, H3: h3, H4: h4, H5: h5, H6: h6, H7: h7, H8: h8, H9: h9,
  H10: h10, H11: h11, H12: h12, H13: h13, H14: h14, H15: h15, H16: h16, H17: h17, H18: h18,
};

export function checkHelp(input: HelpCheckInput): HelpViolation[] {
  return Object.values(HELP_RULES).flatMap((rule) => rule(input));
}

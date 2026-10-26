/**
 * The Documentation page's rows (Ruling 9). Each row names a document the
 * portal intends to bring in, and where the material lives TODAY. Nothing here
 * is rendered from the files; `docs-registry.test.ts` only checks that every
 * named path still exists.
 *
 * `DOCS_REVIEWED` is a hand-set date the monthly documentation review keeps
 * current. The page claims only that a person last looked then.
 *
 * Excluded on purpose: rate limits, SDKs, webhooks and the word API (it
 * appears only on the API page, Increment 3).
 */
export type DocKind = "tutorial" | "how-to" | "reference" | "explanation";

export interface DocRow {
  key: string;
  title: string;
  kind: DocKind;
  willContain: string;
  livesToday: { files: readonly string[] } | { text: string };
}

export const DOCS_REVIEWED = "2026-10-25";

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  tutorial: "Tutorial",
  "how-to": "How-to",
  reference: "Reference",
  explanation: "Explanation",
};

export const DOC_ROWS: readonly DocRow[] = [
  {
    key: "getting-started",
    title: "Getting started",
    kind: "tutorial",
    willContain:
      "Set up a local copy: clone the repository, create a database branch, seed it, run the app and the checks.",
    livesToday: { files: ["README.md", "docs/testing.md"] },
  },
  {
    key: "architecture",
    title: "Architecture overview",
    kind: "explanation",
    willContain:
      "How the platform is put together and why: tenants, the two database connections, the proxy and the portals.",
    livesToday: { files: ["docs/architecture.md"] },
  },
  {
    key: "decisions",
    title: "Decisions log",
    kind: "reference",
    willContain: "Every numbered decision, searchable by number.",
    livesToday: { files: ["docs/decisions.md"] },
  },
  {
    key: "runbooks",
    title: "Runbooks and deployment",
    kind: "how-to",
    willContain:
      "Deploying, applying migrations to production, and the pre-deploy checklists.",
    livesToday: { files: ["docs/deployment.md"] },
  },
  {
    key: "security",
    title: "Security and data handling",
    kind: "explanation",
    willContain:
      "How organizations are kept apart, which data is private, and how sensitive data is handled.",
    livesToday: { files: ["CLAUDE.md", "docs/schema-design.md"] },
  },
  {
    key: "changelog",
    title: "Changelog",
    kind: "reference",
    willContain: "What changed in each release.",
    livesToday: { files: ["docs/release-notes"] },
  },
  {
    key: "status",
    title: "Status",
    kind: "reference",
    willContain:
      "Whether the scheduled jobs, the email queue and domain checks are healthy.",
    livesToday: {
      text: "parts of this appear on the platform administrators' dashboard (email queue and domains).",
    },
  },
];

/**
 * The "lives today" sentence as plain text. Files are joined with " and ";
 * the page renders them in <code>, so it uses `DocRow.livesToday` directly and
 * this exists for tests and for any plain-text consumer.
 */
export function livesTodayText(row: DocRow): string {
  if ("text" in row.livesToday) {
    return `Planned. Not built yet. Today, ${row.livesToday.text}`;
  }
  return `Planned. Not built yet. Today this material lives in ${row.livesToday.files.join(" and ")}.`;
}

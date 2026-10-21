/**
 * renderEmail - the one place an outbound message is laid out (DECISION-191,
 * docs/work-log/2026-10-21-review-polish.md, Phase 2 R9-R13).
 *
 * Every message `enqueueEmail()` accepts is a `RenderedEmail`: a branded
 * `{ subject, html, text }` that only this file can produce. A caller passes
 * RAW strings in structured content; this file escapes them for HTML, strips
 * line breaks from the subject, validates the action URL, and generates the
 * plain-text part from the same structure (never by stripping tags).
 *
 * PURE. No `server-only`, no database, no `process.env`, no request headers:
 * `src/lib/giving/statements/notice.ts` documents itself as pure and must keep
 * testing in isolation, so it imports this file directly - never through the
 * `@/lib/email` barrel, which pulls in the `server-only` queue (R9). It also
 * never names a sender and never reads a `templateKey` (R11, DECISION-182).
 *
 * LAYOUT RULES (R12, F160). Inline styles only: Gmail strips a style element
 * and `check:brand-scope` rule E3 bans one outside `src/components/brand/`.
 * Every layout table is built by the ONE `table()` helper below, whose single
 * table-open line carries the `ui-ok` annotation rule C2 asks for; no path
 * exemption was added to the tripwire. Colour is declared with explicit
 * `bgcolor` and `color` on every block and with the colour-scheme meta tags,
 * so a client that force-inverts still has a legible fallback.
 *
 * GIVING-NOTICE CHROME (R13, B5). The statement notice asserts that no amount
 * appears anywhere in its subject, html or text, so the FIXED chrome below
 * contains no dollar sign, no decimal number, no thousands-separated number,
 * no year, and no digit except integer CSS lengths and hex colours. It also
 * avoids the words the domain notification tests forbid in a message. Do not
 * add a decimal CSS value (a fractional line-height, an em size) or an
 * rgb() colour here: render.test.ts fails on the first one.
 *
 * ACTION URL INVARIANT (R13, invitations G5). The action URL appears as an
 * unchanged substring in three places: `href="..."` (with only `&` written as
 * `&amp;`), the printed link beneath the button (same escaping), and on its
 * own line in `text`. No soft wrapping, no zero-width characters, no further
 * entity encoding, so a later `replaceAll` of the URL stays correct.
 */

import { escapeHtml } from "./escape-html";

declare const renderedEmailBrand: unique symbol;

/**
 * A laid-out message. The brand is type-only: the one cast that creates it
 * lives in `renderEmail()` below, and a source scan (render.test.ts) fails on
 * a cast to this type anywhere else under `src/`.
 */
export type RenderedEmail = {
  /** Raw text, whitespace runs (CR and LF included) collapsed, trimmed, capped. */
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly [renderedEmailBrand]: true;
};

export type EmailBlock =
  /** A paragraph. Newlines become line breaks. */
  | { kind: "p"; text: string }
  /** "Label: value" lines, the label in bold. */
  | { kind: "facts"; rows: ReadonlyArray<{ label: string; value: string }> }
  /** An optional lead-in label and a bulleted list. */
  | { kind: "list"; label?: string; items: ReadonlyArray<string> }
  /** User-supplied prose, set off with a left rule. */
  | { kind: "quote"; text: string };

export interface EmailContent {
  subject: string;
  /** Hidden inbox preview text; defaults to the heading. */
  preheader?: string;
  heading: string;
  blocks: ReadonlyArray<EmailBlock>;
  /** One bulletproof button, with the raw URL printed beneath it. */
  action?: { label: string; href: string };
  /** Per-message "why you got this" or safety line. */
  footnote?: string;
}

// ---------------------------------------------------------------------------
// Palette - transcribed from PLATFORM_TOKENS.light (src/lib/brand/contract.ts),
// as hex because rgb() would put a comma-separated number run into the chrome
// (R13). render.test.ts asserts each value equals its token and that every
// text and background pair clears its contrast floor.
// ---------------------------------------------------------------------------

export const EMAIL_PALETTE = {
  /** --background */
  white: "#ffffff",
  /** --foreground (navy) */
  navy: "#0d223f",
  /** --primary (blue) */
  blue: "#1a5aa8",
  /** --secondary (the page surface behind the card) */
  surface: "#f2f4f7",
  /** --muted-foreground */
  muted: "#475162",
  /** --border */
  rule: "#cbd2dc",
} as const;

const C = EMAIL_PALETTE;

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The text wordmark. No image: a blocked image must still look right. */
const WORDMARK = "PresbyPortal";

/** The fixed footer line. Generic on purpose (R13): the situational line is the footnote. */
const FOOTER_LINE = "This message was sent automatically by PresbyPortal.";

const SUBJECT_MAX = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The one place a layout table is built. */
function table(attrs: string, rows: string): string {
  // ui-ok: HTML email layout string, not a React table
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>${rows}</table>`;
}

function esc(value: string): string {
  return escapeHtml(value);
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Escape, then turn newlines into line breaks. */
function escMultiline(value: string): string {
  return esc(normalizeNewlines(value)).replace(/\n/g, "<br>");
}

/** Escape only what an attribute or text node needs for the URL to survive unchanged. */
function escUrl(href: string): string {
  return href.replace(/&/g, "&amp;");
}

function cleanSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().slice(0, SUBJECT_MAX);
}

/**
 * The action URL must be an absolute http(s) URL with no character that could
 * break out of an attribute or a text node. The error never echoes the URL: it
 * may carry a live credential.
 */
function assertActionHref(href: unknown): asserts href is string {
  const ok =
    typeof href === "string" &&
    href.length > 0 &&
    !/[\s\u0000-\u001f\u007f"<>]/.test(href) &&
    (() => {
      try {
        const u = new URL(href);
        return (u.protocol === "http:" || u.protocol === "https:") && u.host !== "";
      } catch {
        return false;
      }
    })();
  if (!ok) {
    throw new Error("renderEmail: action.href must be an absolute http(s) URL");
  }
}

const P_STYLE = `margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.navy};`;

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "p":
      return `<p style="${P_STYLE}">${escMultiline(block.text)}</p>`;
    case "facts":
      return `<p style="${P_STYLE}">${block.rows
        .map((r) => `<strong>${esc(r.label)}:</strong> ${escMultiline(r.value)}`)
        .join("<br>")}</p>`;
    case "list": {
      const lead = block.label
        ? `<p style="margin:0 0 4px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.navy};"><strong>${esc(block.label)}</strong></p>`
        : "";
      const items = block.items
        .map(
          (i) =>
            `<li style="margin:0 0 4px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.navy};">${esc(i)}</li>`,
        )
        .join("");
      return `${lead}<ul style="margin:0 0 16px 0;padding:0 0 0 24px;color:${C.navy};">${items}</ul>`;
    }
    case "quote":
      return `<div style="margin:0 0 16px 0;padding:8px 16px;border-left:4px solid ${C.rule};background-color:${C.surface};font-family:${FONT};font-size:16px;line-height:24px;color:${C.navy};">${escMultiline(block.text)}</div>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case "p":
      return normalizeNewlines(block.text);
    case "facts":
      return block.rows.map((r) => `${r.label}: ${normalizeNewlines(r.value)}`).join("\n");
    case "list": {
      const items = block.items.map((i) => `- ${i}`).join("\n");
      return block.label ? `${block.label}\n${items}` : items;
    }
    case "quote":
      return normalizeNewlines(block.text)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
  }
}

function actionHtml(action: { label: string; href: string }): string {
  const url = escUrl(action.href);
  const button = table(
    `style="margin:8px 0 16px 0;"`,
    `<tr><td bgcolor="${C.blue}" style="background-color:${C.blue};border-radius:6px;">` +
      `<a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:16px;line-height:24px;font-weight:bold;color:${C.white};text-decoration:none;">${esc(action.label)}</a>` +
      `</td></tr>`,
  );
  const printed =
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">` +
    `If the button does not work, copy and paste this link into your browser:<br>` +
    `<a href="${url}" style="color:${C.blue};text-decoration:underline;word-break:break-all;">${url}</a></p>`;
  return button + printed;
}

// ---------------------------------------------------------------------------
// renderEmail
// ---------------------------------------------------------------------------

/**
 * Lays a message out. Callers pass raw strings; everything is escaped here.
 * Throws only on a programmer error (an action `href` that is not an absolute
 * http(s) URL), which the callers' send-time handling logs.
 */
export function renderEmail(content: EmailContent): RenderedEmail {
  if (content.action) assertActionHref(content.action.href);

  const subject = cleanSubject(content.subject);
  const preheader = content.preheader ?? content.heading;

  const bodyHtml = [
    `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${C.navy};">${esc(content.heading)}</h1>`,
    ...content.blocks.map(blockHtml),
    content.action ? actionHtml(content.action) : "",
    content.footnote
      ? `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${escMultiline(content.footnote)}</p>`
      : "",
  ].join("");

  const header = `<tr><td bgcolor="${C.navy}" style="background-color:${C.navy};padding:20px 32px;font-family:${FONT};font-size:20px;line-height:24px;font-weight:bold;color:${C.white};">${WORDMARK}</td></tr>`;
  const body = `<tr><td bgcolor="${C.white}" style="background-color:${C.white};padding:32px;color:${C.navy};">${bodyHtml}</td></tr>`;
  const footer = `<tr><td bgcolor="${C.surface}" style="background-color:${C.surface};padding:16px 32px;font-family:${FONT};font-size:12px;line-height:16px;color:${C.muted};">${esc(FOOTER_LINE)}</td></tr>`;

  const card = table(`width="600" align="center" style="width:100%;max-width:600px;"`, header + body + footer);
  const outer = table(
    `width="100%" bgcolor="${C.surface}" style="background-color:${C.surface};"`,
    `<tr><td align="center" bgcolor="${C.surface}" style="background-color:${C.surface};padding:24px 12px;">${card}</td></tr>`,
  );

  const html =
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="color-scheme" content="light">\n` +
    `<meta name="supported-color-schemes" content="light">\n` +
    `<title>${esc(subject)}</title>\n` +
    `</head>\n` +
    `<body bgcolor="${C.surface}" style="margin:0;padding:0;background-color:${C.surface};color:${C.navy};">\n` +
    `<div style="display:none;max-height:0;overflow:hidden;color:${C.surface};font-size:1px;line-height:1px;">${esc(preheader)}</div>\n` +
    `${outer}\n` +
    `</body>\n</html>`;

  const textParts = [
    content.heading,
    ...content.blocks.map(blockText),
    content.action ? `${content.action.label}:\n${content.action.href}` : "",
    content.footnote ? normalizeNewlines(content.footnote) : "",
    `--\n${FOOTER_LINE}`,
  ].filter((part) => part !== "");
  const text = textParts.join("\n\n");

  return { subject, html, text } as RenderedEmail;
}

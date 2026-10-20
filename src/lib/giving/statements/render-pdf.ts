import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatCents } from "../money";
import type { StatementLineSnapshot, StatementSnapshot } from "./snapshot";
import { composeGreeting, statementWording, type StatementWording } from "./wording";

/**
 * The statement renderer - docs/work-log/2026-10-15-online-giving.md,
 * DECISION-174 (pdfkit) and Batch 5b. A PURE function of its snapshot(s) and
 * the committed font files: no clock, no randomness, no database, no network.
 *
 * ONE RENDERER, TWO CALLERS. `issueStatementBatch` renders each statement once
 * at issue and stores the bytes (the record); the print-run route re-renders
 * the frozen snapshots on demand (never stored). Because the renderer is
 * deterministic, a lone snapshot re-rendered later reproduces the stored bytes
 * exactly, and a snapshot rendered inside a batch prints the same text on its
 * page(s) as it does alone. Both are tested.
 *
 * DETERMINISM. The PDF's CreationDate/ModDate are pinned to the issue date
 * (UTC midnight), the Producer/Creator are fixed strings, and pdfkit derives
 * its file id from the info dictionary - so nothing in the output depends on
 * when or where it is rendered. A batch pins the LATEST issue date among its
 * statements.
 *
 * FONTS. Noto Sans Regular/Bold (OFL, committed under `./fonts/`) cover Latin,
 * Latin Extended, Vietnamese, Greek and Cyrillic - donor names arrive from
 * Stripe in any script and the standard-14 fonts are WinAnsi only (DECISION-174
 * obligation 3). A name in a script the font lacks (Arabic, Hebrew, CJK) draws
 * as the font's missing-glyph box: inert and honest, not a crash. Paths are
 * built from `process.cwd()` and traced into the function by
 * `outputFileTracingIncludes` in next.config.ts. The files are read once.
 *
 * INERT TEXT. Every string is DRAWN, never interpreted: control characters and
 * bidirectional-override characters are replaced before drawing, and the
 * donor's name is clamped to the 120 characters the database allows so an
 * absurd value cannot run a statement onto a hundred pages.
 *
 * Node runtime only (`server-only`, a Node fs read). Never import this from a
 * client component or an Edge route.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - 66;

const COLUMNS = { date: 66, fund: 118, description: 232, amount: CONTENT_WIDTH - 66 - 118 - 232 } as const;
const TEXT = "#111111";
const MUTED = "#555555";
const RULE = "#bbbbbb";

const FONT_DIR = "src/lib/giving/statements/fonts";
let fonts: { regular: Buffer; bold: Buffer } | null = null;

function loadFonts(): { regular: Buffer; bold: Buffer } {
  if (!fonts) {
    fonts = {
      regular: readFileSync(path.join(process.cwd(), FONT_DIR, "NotoSans-Regular.ttf")),
      bold: readFileSync(path.join(process.cwd(), FONT_DIR, "NotoSans-Bold.ttf")),
    };
  }
  return fonts;
}

const DONOR_NAME_MAX = 120;
const TEXT_FIELD_MAX = 600;

function codeRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** C0/C1 controls, DEL, the line and paragraph separators, and the bidirectional embedding/override/isolate controls. */
const STRIPPED = new Set<number>([
  ...codeRange(0x00, 0x1f),
  ...codeRange(0x7f, 0x9f),
  0x2028,
  0x2029,
  ...codeRange(0x202a, 0x202e),
  ...codeRange(0x2066, 0x2069),
]);
const ELLIPSIS = String.fromCharCode(0x2026);

/** Replaces the characters above with a space; keeps `\n` only when asked; clamps to `max`. */
function inert(value: string, options: { keepNewlines?: boolean; max?: number } = {}): string {
  let out = "";
  for (const ch of value.replace(/\r\n?/g, "\n")) {
    const code = ch.codePointAt(0)!;
    out += STRIPPED.has(code) && !(options.keepNewlines && code === 0x0a) ? " " : ch;
  }
  if (options.keepNewlines) out = out.replace(/\n{3,}/g, "\n\n");
  const max = options.max ?? TEXT_FIELD_MAX;
  return out.length > max ? `${out.slice(0, max - 1)}${ELLIPSIS}` : out;
}

function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}/${d}/${y}`;
}

type Doc = InstanceType<typeof PDFDocument>;

interface Ctx {
  doc: Doc;
  wording: StatementWording;
  snapshot: StatementSnapshot;
}

function setFont(ctx: Ctx, weight: "regular" | "bold", size: number, color = TEXT): void {
  ctx.doc.font(weight === "bold" ? "Bold" : "Regular").fontSize(size).fillColor(color);
}

function drawText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  options: { width: number; align?: "left" | "right" | "center" },
): number {
  ctx.doc.text(text, x, y, { width: options.width, align: options.align ?? "left", lineGap: 1.5 });
  return ctx.doc.y;
}

function heightOf(ctx: Ctx, text: string, width: number): number {
  return ctx.doc.heightOfString(text, { width, lineGap: 1.5 });
}

function continuedHeader(ctx: Ctx): void {
  const { snapshot } = ctx;
  setFont(ctx, "regular", 9, MUTED);
  drawText(
    ctx,
    `${inert(snapshot.donee.legalName, { max: 200 })} - ${snapshot.taxYear} Contribution Statement for ${inert(snapshot.donorName, { max: DONOR_NAME_MAX })} (continued)`,
    MARGIN,
    MARGIN,
    { width: CONTENT_WIDTH },
  );
  ctx.doc.y = MARGIN + 28;
}

/** Starts a new page when `needed` points do not fit above the bottom limit. Returns true if it did. */
function ensureSpace(ctx: Ctx, needed: number): boolean {
  if (ctx.doc.y + needed <= BOTTOM_LIMIT) return false;
  ctx.doc.addPage();
  continuedHeader(ctx);
  return true;
}

function rule(ctx: Ctx, y: number): void {
  ctx.doc.save().moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor(RULE).stroke().restore();
}

function drawLetterhead(ctx: Ctx): void {
  const { donee } = ctx.snapshot;
  setFont(ctx, "bold", 16);
  let y = drawText(ctx, inert(donee.legalName, { max: 200 }), MARGIN, MARGIN, { width: CONTENT_WIDTH });
  setFont(ctx, "regular", 10, MUTED);
  y = drawText(ctx, inert(donee.line1, { max: 120 }), MARGIN, y + 2, { width: CONTENT_WIDTH });
  if (donee.line2) y = drawText(ctx, inert(donee.line2, { max: 120 }), MARGIN, y, { width: CONTENT_WIDTH });
  y = drawText(
    ctx,
    `${inert(donee.city, { max: 120 })}, ${donee.region} ${donee.postalCode}`,
    MARGIN,
    y,
    { width: CONTENT_WIDTH },
  );
  if (donee.ein) {
    y = drawText(ctx, `${ctx.wording.einLabel}: ${donee.ein}`, MARGIN, y, { width: CONTENT_WIDTH });
  }
  rule(ctx, y + 8);
  ctx.doc.y = y + 18;
}

function drawTitle(ctx: Ctx): void {
  const { snapshot, wording } = ctx;
  setFont(ctx, "bold", 14);
  let y = drawText(ctx, wording.title(snapshot.taxYear), MARGIN, ctx.doc.y, { width: CONTENT_WIDTH });
  if (snapshot.version > 1 && snapshot.replacesDate) {
    setFont(ctx, "bold", 11);
    y = drawText(ctx, wording.correctedTitle(snapshot.replacesDate), MARGIN, y + 2, { width: CONTENT_WIDTH });
  }
  setFont(ctx, "regular", 10, MUTED);
  y = drawText(ctx, wording.issuedLine(snapshot.issuedDate), MARGIN, y + 2, { width: CONTENT_WIDTH });
  ctx.doc.y = y + 14;
}

function drawDonorBlock(ctx: Ctx): void {
  const { snapshot } = ctx;
  const d = snapshot.delivery;
  setFont(ctx, "bold", 11);
  let y = drawText(ctx, inert(snapshot.donorName, { max: DONOR_NAME_MAX }), MARGIN, ctx.doc.y, { width: 320 });
  setFont(ctx, "regular", 10);
  if (d.line1) y = drawText(ctx, inert(d.line1, { max: 120 }), MARGIN, y, { width: 320 });
  if (d.line2) y = drawText(ctx, inert(d.line2, { max: 120 }), MARGIN, y, { width: 320 });
  const cityLine = [d.city, [d.region, d.postalCode].filter(Boolean).join(" ")]
    .filter((part) => part && part.length > 0)
    .map((part) => inert(part as string, { max: 120 }))
    .join(", ");
  if (cityLine) y = drawText(ctx, cityLine, MARGIN, y, { width: 320 });
  if (d.country && d.country !== "US") y = drawText(ctx, d.country, MARGIN, y, { width: 320 });
  ctx.doc.y = y + 16;
}

function drawGreeting(ctx: Ctx): void {
  const { snapshot, wording } = ctx;
  setFont(ctx, "regular", 11);
  const greeting = inert(composeGreeting(snapshot.greetingText, inert(snapshot.donorName, { max: DONOR_NAME_MAX })), {
    keepNewlines: true,
    max: 700,
  });
  let y = drawText(ctx, greeting, MARGIN, ctx.doc.y, { width: CONTENT_WIDTH });
  y = drawText(ctx, wording.intro(inert(snapshot.donee.legalName, { max: 200 }), snapshot.taxYear), MARGIN, y + 8, {
    width: CONTENT_WIDTH,
  });
  ctx.doc.y = y + 12;
}

function drawTableHeader(ctx: Ctx): void {
  const { wording } = ctx;
  const y = ctx.doc.y;
  setFont(ctx, "bold", 9, MUTED);
  drawText(ctx, wording.tableHeaders.date, MARGIN, y, { width: COLUMNS.date });
  drawText(ctx, wording.tableHeaders.fund, MARGIN + COLUMNS.date, y, { width: COLUMNS.fund - 6 });
  drawText(ctx, wording.tableHeaders.description, MARGIN + COLUMNS.date + COLUMNS.fund, y, {
    width: COLUMNS.description - 6,
  });
  drawText(ctx, wording.tableHeaders.amount, MARGIN + COLUMNS.date + COLUMNS.fund + COLUMNS.description, y, {
    width: COLUMNS.amount,
    align: "right",
  });
  rule(ctx, y + 14);
  ctx.doc.y = y + 20;
}

function drawLine(ctx: Ctx, line: StatementLineSnapshot): void {
  const { wording } = ctx;
  const fund = inert(line.fundLabel, { max: 80 });
  const description = inert(line.description, { max: 300 });
  const note = line.reversedCents > 0 ? wording.refundNote(formatCents(line.reversedCents)) : null;

  setFont(ctx, "regular", 10);
  const fundW = COLUMNS.fund - 6;
  const descW = COLUMNS.description - 6;
  const descHeight = heightOf(ctx, description, descW);
  setFont(ctx, "regular", 8.5, MUTED);
  const noteHeight = note ? heightOf(ctx, note, descW) : 0;
  setFont(ctx, "regular", 10);
  const rowHeight = Math.max(heightOf(ctx, fund, fundW), descHeight + noteHeight, 14) + 8;

  if (ensureSpace(ctx, rowHeight)) drawTableHeader(ctx);
  const y = ctx.doc.y;

  setFont(ctx, "regular", 10);
  drawText(ctx, shortDate(line.occurredOn), MARGIN, y, { width: COLUMNS.date });
  drawText(ctx, fund, MARGIN + COLUMNS.date, y, { width: fundW });
  const descX = MARGIN + COLUMNS.date + COLUMNS.fund;
  drawText(ctx, description, descX, y, { width: descW });
  if (note) {
    setFont(ctx, "regular", 8.5, MUTED);
    drawText(ctx, note, descX, y + descHeight, { width: descW });
    setFont(ctx, "regular", 10);
  }
  const amountText = line.kind === "cash" && line.amountCents !== null ? formatCents(line.amountCents) : wording.nonCashAmount;
  drawText(ctx, amountText, descX + COLUMNS.description, y, { width: COLUMNS.amount, align: "right" });

  rule(ctx, y + rowHeight - 4);
  ctx.doc.y = y + rowHeight;
}

function drawTotals(ctx: Ctx): void {
  const { snapshot, wording } = ctx;
  ensureSpace(ctx, 60);
  const y = ctx.doc.y + 4;
  setFont(ctx, "bold", 11);
  drawText(ctx, wording.totalCashLabel, MARGIN, y, { width: CONTENT_WIDTH - COLUMNS.amount - 10 });
  drawText(ctx, formatCents(snapshot.cashTotalCents), MARGIN + CONTENT_WIDTH - COLUMNS.amount, y, {
    width: COLUMNS.amount,
    align: "right",
  });
  let next = y + 20;
  if (snapshot.nonCashCount > 0) {
    setFont(ctx, "regular", 10, MUTED);
    next = drawText(ctx, wording.nonCashSummary(snapshot.nonCashCount), MARGIN, next, { width: CONTENT_WIDTH });
  }
  ctx.doc.y = next + 14;
}

function drawRequiredBlock(ctx: Ctx): void {
  const { snapshot, wording } = ctx;
  const paragraphs = wording.requiredBlock({
    doneeName: inert(snapshot.donee.legalName, { max: 200 }),
    ein: snapshot.donee.ein,
    nonCash: snapshot.nonCashCount > 0,
    coveredFee: snapshot.lines.some((l) => l.coveredFeeCents > 0),
    coveredFeeCounted: snapshot.coveredFeeCounted,
    corrected: snapshot.version > 1,
    replacesDate: snapshot.replacesDate,
  });
  setFont(ctx, "regular", 10);
  const innerW = CONTENT_WIDTH - 20;
  const heights = paragraphs.map((p) => heightOf(ctx, p, innerW) + 4);
  const total = heights.reduce((a, b) => a + b, 0) + 20;
  ensureSpace(ctx, total);
  const top = ctx.doc.y;
  let y = top + 10;
  paragraphs.forEach((p, i) => {
    drawText(ctx, p, MARGIN + 10, y, { width: innerW });
    y += heights[i]!;
  });
  ctx.doc.save().rect(MARGIN, top, CONTENT_WIDTH, y - top + 6).lineWidth(0.75).strokeColor(RULE).stroke().restore();
  ctx.doc.y = y + 20;
}

function drawClosing(ctx: Ctx): void {
  const { snapshot } = ctx;
  const { donee } = snapshot;
  setFont(ctx, "regular", 11);
  const closing = inert(snapshot.closingText, { keepNewlines: true, max: 700 });
  const closingH = heightOf(ctx, closing, CONTENT_WIDTH);
  const signatureH = (donee.signatoryName ? 18 : 0) + (donee.signatoryTitle ? 16 : 0) + 30;
  ensureSpace(ctx, closingH + signatureH);
  let y = drawText(ctx, closing, MARGIN, ctx.doc.y, { width: CONTENT_WIDTH });
  y += 26;
  if (donee.signatoryName) {
    setFont(ctx, "bold", 11);
    y = drawText(ctx, inert(donee.signatoryName, { max: 120 }), MARGIN, y, { width: CONTENT_WIDTH });
  }
  if (donee.signatoryTitle) {
    setFont(ctx, "regular", 10, MUTED);
    y = drawText(ctx, inert(donee.signatoryTitle, { max: 120 }), MARGIN, y, { width: CONTENT_WIDTH });
  }
  ctx.doc.y = y;
}

function drawStatement(doc: Doc, snapshot: StatementSnapshot): void {
  const ctx: Ctx = { doc, wording: statementWording(snapshot.wordingVersion), snapshot };
  drawLetterhead(ctx);
  drawTitle(ctx);
  drawDonorBlock(ctx);
  drawGreeting(ctx);
  drawTableHeader(ctx);
  for (const line of snapshot.lines) drawLine(ctx, line);
  drawTotals(ctx);
  drawRequiredBlock(ctx);
  drawClosing(ctx);
}

/**
 * Renders one PDF holding one statement per page run (a statement with many
 * gifts continues onto further pages; the next statement always starts on a
 * fresh page). A single snapshot yields the document that is stored at issue.
 */
export async function renderStatementPdf(snapshots: readonly StatementSnapshot[]): Promise<Buffer> {
  if (snapshots.length === 0) throw new RangeError("renderStatementPdf: no statements to render");
  const pinned = snapshots.map((s) => s.issuedDate).sort().at(-1)!;
  const pinnedDate = new Date(`${pinned}T00:00:00Z`);
  const single = snapshots.length === 1 ? snapshots[0]! : null;

  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: single ? `${single.taxYear} Contribution Statement` : "Contribution statements",
      Creator: "PresbyPortal",
      Producer: "PresbyPortal",
      CreationDate: pinnedDate,
      ModDate: pinnedDate,
    },
  });
  const { regular, bold } = loadFonts();
  doc.registerFont("Regular", regular);
  doc.registerFont("Bold", bold);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  try {
    snapshots.forEach((snapshot, index) => {
      if (index > 0) doc.addPage();
      drawStatement(doc, snapshot);
    });
  } finally {
    doc.end();
  }
  return done;
}

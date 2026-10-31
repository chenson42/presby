import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { PrintModel } from "./print-model";

/**
 * The printed reimbursement form - docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 Copy C11, API Contract Layer 4 (`/o/<slug>/reimbursements/<id>/print`).
 * Draws a `PrintModel` and nothing else: no database, no clock, no request, so
 * the same request prints the same bytes (the PDF's dates are pinned to the
 * model's `stampDate`; the file id pdfkit derives follows from the info
 * dictionary).
 *
 * FONTS. The year-end statements' committed Noto Sans (OFL; see
 * `src/lib/giving/statements/fonts/FONT-SOURCE.txt`) is used here too: a name,
 * a vendor or a purpose arrives in any script and the standard-14 fonts are
 * WinAnsi only. A character the font lacks draws as its missing-glyph box:
 * inert, not a crash. The files are read once, from `process.cwd()`, and are
 * traced into this route's function by `outputFileTracingIncludes` in
 * `next.config.ts` (the print route's own key), with pdfkit's own AFM data;
 * `serverExternalPackages: ["pdfkit"]` is already set for the statements.
 *
 * INERT TEXT. Every string is DRAWN, never interpreted. The model has already
 * cleaned and clamped them (`print-model.ts`); pdfkit breaks a word that is
 * wider than the line, so an unbroken 500-character purpose wraps and cannot
 * run off the page (`print.test.ts`).
 *
 * Node runtime only (`server-only`, an fs read). Never import this from a client
 * component or an Edge route.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN - 40;
const LABEL_WIDTH = 150;
const VALUE_X = MARGIN + LABEL_WIDTH + 12;
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH - 12;
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

type Doc = InstanceType<typeof PDFDocument>;

function font(doc: Doc, weight: "regular" | "bold", size: number, color = TEXT): void {
  doc.font(weight === "bold" ? "Bold" : "Regular").fontSize(size).fillColor(color);
}

function rule(doc: Doc, y: number): void {
  doc.save().moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor(RULE).stroke().restore();
}

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > BOTTOM_LIMIT) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

/** Draws one labelled value; a value taller than a page is split by pdfkit across pages. */
function drawField(doc: Doc, label: string, lines: readonly string[]): void {
  font(doc, "regular", 11);
  const value = lines.join("\n");
  const valueHeight = doc.heightOfString(value, { width: VALUE_WIDTH, lineGap: 1.5 });
  // Keep a short field whole; a long one starts where it is and flows onto the next page.
  ensureSpace(doc, Math.min(valueHeight, 120) + 12);
  const top = doc.y;
  font(doc, "bold", 9, MUTED);
  doc.text(label, MARGIN, top + 2, { width: LABEL_WIDTH, lineGap: 1.5 });
  font(doc, "regular", 11);
  doc.text(value, VALUE_X, top, { width: VALUE_WIDTH, lineGap: 1.5 });
  const bottom = Math.max(doc.y, top + 14);
  rule(doc, bottom + 6);
  doc.y = bottom + 12;
}

export async function renderRequestPdf(model: PrintModel): Promise<Buffer> {
  const stamp = new Date(`${model.stampDate}T00:00:00Z`);
  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: model.documentTitle,
      Creator: "PresbyPortal",
      Producer: "PresbyPortal",
      CreationDate: stamp,
      ModDate: stamp,
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
    font(doc, "bold", 18);
    doc.text(model.title, MARGIN, MARGIN, { width: CONTENT_WIDTH });
    font(doc, "regular", 12, MUTED);
    doc.text(model.organization, MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
    rule(doc, doc.y + 8);
    doc.y += 20;

    font(doc, "regular", 11);
    const statusHeight = doc.heightOfString(model.statusLine, { width: CONTENT_WIDTH - 20, lineGap: 1.5 });
    ensureSpace(doc, statusHeight + 30);
    const boxTop = doc.y;
    doc.text(model.statusLine, MARGIN + 10, boxTop + 8, { width: CONTENT_WIDTH - 20, lineGap: 1.5 });
    const boxBottom = doc.y + 8;
    doc.save().rect(MARGIN, boxTop, CONTENT_WIDTH, boxBottom - boxTop).lineWidth(0.75).strokeColor(RULE).stroke().restore();
    doc.y = boxBottom + 16;

    for (const field of model.fields) drawField(doc, field.label, field.lines);

    ensureSpace(doc, 30);
    font(doc, "regular", 9, MUTED);
    doc.text(model.footer, MARGIN, doc.y + 6, { width: CONTENT_WIDTH });
  } finally {
    doc.end();
  }
  return done;
}

/**
 * text.ts is the TypeScript twin of presby_reimbursement__clean_text. This runs
 * the SAME inputs through both and requires the same output (EC37). The corpus
 * leaves out U+00A0 (no-break space) on purpose: the database's whitespace
 * collapse follows the database locale and JavaScript's does not, the one
 * documented divergence (text.ts header). The database cleans again on every
 * write, so the twin's job is measuring length the way the database will.
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/text.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { cleanText } from "./text";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const CORPUS = [
  "",
  " ",
  "plain",
  "  padded  ",
  "tabs\tand\nnewlines\r\nand\vvertical\fform",
  "a\u0085b c d",
  "nul-free control \u0001\u0002\u0007\u001F\u007F\u0084\u0086\u009F end",
  "zero​width‌‍‎‏joiners",
  "bidi ‪‫‬‭‮ and isolates ⁦⁧⁨⁩ and word joiner ⁠",
  "bom﻿inside",
  "Café vs Café",
  "emoji \u{1F600} and CJK 漢字 and Arabic مرحبا",
  "<b>markup</b> & \"quotes\" 'single' %_\\ backslash",
  "   \t \n  ",
  "x".repeat(600),
  "line one\n\n\n\nline two",
  "Paint & brushes (2 gal.) - $41.50, 100%",
];

describe.skipIf(!hasDb)("cleanText parity with presby_reimbursement__clean_text (Postgres-backed)", () => {
  it("agrees with the database on every input in the corpus", async () => {
    const { getPlatformDb } = await import("@/lib/db");
    const owner = getPlatformDb();
    for (const input of CORPUS) {
      const result = await owner.execute(sql`select presby_reimbursement__clean_text(${input}::text) as cleaned`);
      const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{ cleaned: string | null }>;
      expect(cleanText(input), JSON.stringify(input)).toBe(rows[0]!.cleaned);
    }
  });
});

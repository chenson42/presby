// Directly from render.ts, never the "@/lib/email" barrel: the barrel pulls in the
// server-only queue and this file is pure (Phase 2 R9).
import { renderEmail, type RenderedEmail } from "@/lib/email/render";

/**
 * The statement NOTICE email - docs/work-log/2026-10-15-online-giving.md, R12
 * (P3-1: print + portal notice, no token download in v1) and DECISION-173.
 *
 * `email_queue` is a platform table with full `presby_app` DML, no RLS and
 * indefinite retention, and it has no attachment column. A statement's
 * CONTENTS therefore never enter it: this email says only that a statement
 * exists and where to find it. NO AMOUNTS ANYWHERE, the subject included, and
 * no gift detail - the content has no digit but the tax year. `check:giving-
 * boundaries` rule B5 keeps this the one file that names the template key, and
 * keeps money tokens out of it.
 *
 * The message is laid out by `renderEmail()` (DECISION-191, Phase 2 R13): its
 * fixed chrome is built to contain no `$`, no decimal and no thousands-separated
 * number, so `notice.test.ts` asserts the no-amounts rule on the FULL rendered
 * subject, html and text, not on a fragment.
 *
 * Pure: no database, no `server-only`. `renderEmail()` escapes every string,
 * and strips line breaks from the subject; the organization name is also
 * flattened to one line here because it appears in the body.
 */

export const STATEMENT_NOTICE_TEMPLATE = "giving.statement.notice";

export interface StatementNoticeInput {
  organizationName: string;
  taxYear: number;
  /** Absolute URL of the member's giving page, built from the canonical origin. */
  link: string;
  /** True for a corrected version (version > 1). */
  corrected: boolean;
}

export interface StatementNotice {
  templateKey: string;
  /** The laid-out message: pass it to `enqueueEmail({ message })`. */
  message: RenderedEmail;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildStatementNotice(input: StatementNoticeInput): StatementNotice {
  const org = oneLine(input.organizationName);
  const year = String(input.taxYear);
  const what = input.corrected ? `corrected ${year} giving statement` : `${year} giving statement`;
  const subject = `Your ${what} from ${org}`;

  const intro = input.corrected
    ? `${org} has issued a corrected ${year} giving statement. It replaces the earlier one.`
    : `${org} has issued your ${year} giving statement.`;
  const privacy =
    "For your privacy this message does not list any gifts. If you don't have an account, or you didn't expect this message, please contact the church office.";

  const message = renderEmail({
    subject,
    heading: input.corrected ? "Your corrected giving statement is ready" : "Your giving statement is ready",
    blocks: [
      { kind: "p", text: intro },
      { kind: "p", text: "Sign in to view and download it." },
      { kind: "p", text: privacy },
    ],
    action: { label: "View my statement", href: input.link },
  });

  return { templateKey: STATEMENT_NOTICE_TEMPLATE, message };
}

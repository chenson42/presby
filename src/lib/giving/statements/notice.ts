import { escapeHtml } from "@/lib/email/escape-html";

/**
 * The statement NOTICE email - docs/work-log/2026-10-15-online-giving.md, R12
 * (P3-1: print + portal notice, no token download in v1) and DECISION-173.
 *
 * `email_queue` is a platform table with full `presby_app` DML, no RLS and
 * indefinite retention, and it has no attachment column. A statement's
 * CONTENTS therefore never enter it: this email says only that a statement
 * exists and where to find it. NO AMOUNTS ANYWHERE, the subject included, and
 * no gift detail - the body has no digit but the tax year. `check:giving-
 * boundaries` rule B5 keeps this the one file that names the template key, and
 * keeps money tokens out of it.
 *
 * Pure: no database, no `server-only`. Every interpolated string is
 * HTML-escaped (`escapeHtml`), and the organization name is stripped of line
 * breaks before it reaches a subject header.
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
  subject: string;
  html: string;
  text: string;
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
  const where = "Sign in to view and download it:";
  const privacy =
    "For your privacy this message does not list any gifts. If you don't have an account, or you didn't expect this message, please contact the church office.";

  const text = [intro, "", where, input.link, "", privacy].join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${escapeHtml(where)} <a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    `<p>${escapeHtml(privacy)}</p>`,
  ].join("\n");

  return { templateKey: STATEMENT_NOTICE_TEMPLATE, subject, html, text };
}

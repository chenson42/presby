import { formatDayHeading } from "@/lib/calendar/month";
import { dayKeyOf, formatTime } from "@/lib/calendar/wall-clock";
import { renderEmail, type RenderedEmail } from "@/lib/email/render";
import { EMAIL_COPY, EMAIL_LINE_CAP } from "./copy";
import { WORSHIP_TEMPLATE_KEYS, type WorshipTemplateKey } from "./vocab";

/**
 * The four worship notices, as pure builders - docs/work-log/2026-11-04-
 * worship-inc1.md, Phase 3 "Email (R10)" and Copy G7. PURE: no database, no
 * `server-only`; `renderEmail` is imported from `render.ts` directly, never the
 * `@/lib/email` barrel (which pulls in the server-only queue).
 *
 * `email_queue` is a platform table with full `presby_app` DML, no RLS and
 * indefinite retention, and credential bodies are redacted after sending while
 * these are NOT (F428, accepted, `paper`, tier-1 content). So a body carries
 * the organization's name, a position name, a team name and a date and
 * NOTHING ELSE: no person's name (not the volunteer's, not the leader's, not a
 * decliner's), no reason, no note, no free text a person typed. The builders'
 * signatures are the guarantee: there is no parameter through which a person's
 * name could arrive, and `messages.test.ts` asserts it on the FULL rendered
 * subject, html and text.
 *
 * LINKS are plain GETs: `<platform origin>/o/<slug>/worship`,
 * `/o/<slug>/worship/requests/<assignmentId>` (exactly one request), or
 * `/o/<slug>/worship/teams/<groupId>/services/<eventId>` (the decline notice).
 * NO query string, no `next`, no `callbackUrl`: the proxy sends a signed-out
 * visitor to `/signin?callbackUrl=<pathname>` (path only), so a bare path is
 * the shape that survives sign-in and the two-factor hop. The origin is
 * `platformOrigin()` and never the request host. A slug or id that is not
 * path-safe throws: both come from the database, and a link must never be bent
 * by what a row held.
 *
 * Every builder returns `{ templateKey, message }`; the senders pass
 * `templateKey: worshipMessage.templateKey` (the audience registry scan reads
 * that expression, `email-audience.test.ts`).
 */

export interface WorshipMessage {
  templateKey: WorshipTemplateKey;
  /** The laid-out message: pass it to `insertQueueRowInTx({ message })`. */
  message: RenderedEmail;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function base(origin: string, slug: string): string {
  if (!SLUG.test(slug)) throw new Error("worship link: slug is not path-safe");
  return `${origin.replace(/\/+$/, "")}/o/${slug}`;
}

function uuid(value: string, what: string): string {
  if (!UUID.test(value)) throw new Error(`worship link: ${what} is not a uuid`);
  return value;
}

export const worshipLinks = {
  /** Several requests, a reminder, a cancel: the member's worship home. */
  home: (origin: string, slug: string) => `${base(origin, slug)}/worship`,
  /** Exactly one request. */
  request: (origin: string, slug: string, assignmentId: string) =>
    `${base(origin, slug)}/worship/requests/${uuid(assignmentId, "assignment id")}`,
  /** The decline notice: the board for the team on that service. */
  board: (origin: string, slug: string, groupId: string, eventId: string) =>
    `${base(origin, slug)}/worship/teams/${uuid(groupId, "group id")}/services/${uuid(eventId, "event id")}`,
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * 'Sunday, November 16 at 9:00 AM' from wall-clock text ('YYYY-MM-DDTHH:mm'):
 * a label, not an instant, so no time zone is applied (DECISION-113 ruling 3).
 */
export function formatServiceWhen(wallClock: string): string {
  return `${formatDayHeading(dayKeyOf(wallClock))} at ${formatTime(wallClock)}`;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface RequestLine {
  /** Wall-clock 'YYYY-MM-DDTHH:mm'. */
  startsAt: string;
  positionName: string;
  teamName: string;
}

/** One line of a request or a reminder: 'Sunday, November 16 at 9:00 AM: Drums, Praise band'. */
export function requestLine(line: RequestLine): string {
  return `${formatServiceWhen(line.startsAt)}: ${line.positionName}, ${line.teamName}`;
}

/** The request email: one per person per Send, listing their positions and dates (up to 12 lines, then 'and N more'). */
export function buildRequestMessage(input: { organizationName: string; lines: readonly RequestLine[]; link: string }): WorshipMessage {
  const shown = input.lines.slice(0, EMAIL_LINE_CAP).map(requestLine);
  const hidden = input.lines.length - shown.length;
  const copy = EMAIL_COPY.request;
  const message = renderEmail({
    subject: copy.subject(input.organizationName),
    heading: copy.heading,
    blocks: [
      { kind: "p", text: copy.intro(input.organizationName) },
      { kind: "list", items: shown },
      ...(hidden > 0 ? [{ kind: "p" as const, text: copy.more(hidden) }] : []),
    ],
    action: { label: input.lines.length === 1 ? copy.buttonOne : copy.buttonMany, href: input.link },
    footnote: copy.footnote,
  });
  return { templateKey: WORSHIP_TEMPLATE_KEYS.request, message };
}

/** The reminder: 'unanswered' (still waiting for an answer) or 'confirmed' (serving soon). */
export function buildReminderMessage(input: {
  kind: "unanswered" | "confirmed";
  organizationName: string;
  line: RequestLine;
  link: string;
}): WorshipMessage {
  if (input.kind === "unanswered") {
    const copy = EMAIL_COPY.reminderWaiting;
    return {
      templateKey: WORSHIP_TEMPLATE_KEYS.reminder,
      message: renderEmail({
        subject: copy.subject(input.organizationName),
        heading: copy.heading,
        blocks: [{ kind: "p", text: copy.body(formatServiceWhen(input.line.startsAt), input.line.positionName, input.line.teamName) }],
        action: { label: copy.button, href: input.link },
        footnote: copy.footnote,
      }),
    };
  }
  const copy = EMAIL_COPY.reminderConfirmed;
  return {
    templateKey: WORSHIP_TEMPLATE_KEYS.reminder,
    message: renderEmail({
      subject: copy.subject(input.organizationName),
      heading: copy.heading,
      blocks: [{ kind: "p", text: requestLine(input.line) }],
      action: { label: copy.button, href: input.link },
      footnote: copy.footnote,
    }),
  };
}

/** The cancel notice, to a person who was asked or scheduled. No footnote. */
export function buildCancelledMessage(input: { organizationName: string; startsAt: string; link: string }): WorshipMessage {
  const copy = EMAIL_COPY.cancelled;
  return {
    templateKey: WORSHIP_TEMPLATE_KEYS.cancelled,
    message: renderEmail({
      subject: copy.subject(input.organizationName),
      heading: copy.heading,
      blocks: [{ kind: "p", text: copy.body(formatServiceWhen(input.startsAt)) }],
      action: { label: copy.button, href: input.link },
    }),
  };
}

/** The decline notice, to the person who placed the decliner. It never names the decliner. */
export function buildDeclinedMessage(input: {
  organizationName: string;
  positionName: string;
  startsAt: string;
  link: string;
}): WorshipMessage {
  const copy = EMAIL_COPY.declined;
  return {
    templateKey: WORSHIP_TEMPLATE_KEYS.declined,
    message: renderEmail({
      subject: copy.subject(input.organizationName),
      heading: copy.heading,
      blocks: [{ kind: "p", text: copy.body(input.positionName, formatServiceWhen(input.startsAt)) }],
      action: { label: copy.button, href: input.link },
      footnote: copy.footnote,
    }),
  };
}

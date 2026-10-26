/**
 * The account-invitation email, built in ONE function (DECISION-186,
 * docs/work-log/2026-10-21-invitations.md Phase 3). Every invitation send and
 * every resend goes through `renderInvitationEmail()`; nothing else composes
 * this message. The layout is the shared `renderEmail()` (DECISION-191), so
 * the message is a `RenderedEmail` like every other sender's.
 *
 * LINK ORIGIN: `${platformOrigin()}/invite?token=<token>` and nothing else -
 * never the request `Host`, never a church's custom host (a custom host has no
 * session and no platform routes, and a link to one would be phishable). When
 * no safe origin exists the render returns `null` and the caller refuses the
 * send (`link_origin_unavailable`).
 *
 * THE ACCEPT URL IS EMITTED AS ONE UNCHANGED SUBSTRING in the html (the href
 * AND the printed copy) and in the text (renderEmail's action-URL invariant,
 * R13; `&` would be written `&amp;` in the html, the token alphabet has none).
 * The post-send scrub replaces the WHOLE stored body of a credential row with a
 * marker (queue.ts CREDENTIAL_TEMPLATE_KEYS), so no form of the link survives.
 *
 * NO FREE TEXT from the sender, ever (a phishing channel in platform-domain
 * mail). The only interpolated values are the recipient's first name, the
 * organization name and, for a `sign_in` invitation, the sender's name AS
 * RECORDED on their own person row (a name, not a message), each capped at 100
 * characters; `renderEmail()` escapes them for the html body. The token is
 * base64url, so it is inert in html and in a URL.
 *
 * Pure: no database, no `server-only`. Safe in unit tests.
 */
import { renderEmail, type RenderedEmail } from "@/lib/email/render";
import { platformOrigin } from "@/lib/domains/host";
import type { AccountInvitationPurpose } from "@/lib/db/domain/invitations";

/** The `email_queue.template_key` of a platform designation. Class `account`, platform domain (Q2, R4). */
export const ACCOUNT_INVITATION_TEMPLATE_KEY = "account_invitation";

/**
 * The template key of a congregation's sign-in invitation (Community
 * Increment 2b). Audience `person:credential` (the address is the person's
 * credential address, chosen in SQL), and a credential template: the stored
 * body is scrubbed after send, like the designation's.
 */
export const ACCOUNT_SIGN_IN_TEMPLATE_KEY = "account_sign_in_invitation";

export const INVITATION_NAME_MAX = 100;

export interface RenderInvitationEmailInput {
  /** Greeting name. Null or blank falls back to a plain "Hello". */
  firstName: string | null;
  organizationName: string;
  purpose: AccountInvitationPurpose;
  token: string;
  expiresAt: Date;
  /**
   * The sender's own record name (a `sign_in` invitation is sent by a person at
   * the congregation, not by the platform). Capped like every interpolated name.
   * Ignored for the two designations.
   */
  senderName?: string | null;
  /** Injected for tests; defaults to `platformOrigin()`. */
  origin?: string | null;
}

export interface RenderedInvitationEmail {
  /** The laid-out message, ready for `insertQueueRowInTx` / `enqueueEmail`. */
  message: RenderedEmail;
  /** The exact accept URL embedded in the html and the text. */
  url: string;
}

const ROLE_PHRASE = {
  founding_administrator: "the first administrator",
  treasurer: "the treasurer",
} as const;

const ROLE_GRANTS = {
  founding_administrator:
    "As administrator you will be able to manage people, roles and settings for the congregation.",
  treasurer:
    "As treasurer you will be able to manage the congregation's online giving once you have set up two-factor sign-in.",
} as const;

/** Trim, drop control characters, cap. Rendering-time safety, not validation. */
function cap(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, INVITATION_NAME_MAX);
}

// A fixed locale and zone: the email is rendered on the server once and read
// anywhere, so "October 28, 2026" must not depend on the server's locale.
const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatExpiry(date: Date): string {
  return EXPIRY_FORMAT.format(date);
}

export function renderInvitationEmail(
  input: RenderInvitationEmailInput,
): RenderedInvitationEmail | null {
  const origin = input.origin === undefined ? platformOrigin() : input.origin;
  if (origin === null) return null;

  const url = `${origin}/invite?token=${input.token}`;
  const organization = cap(input.organizationName) || "your congregation";
  const first = input.firstName ? cap(input.firstName) : "";
  const greeting = first ? `Hello ${first},` : "Hello,";
  const expires = formatExpiry(input.expiresAt);

  const content = contentFor(input.purpose, {
    greeting,
    organization,
    expires,
    sender: input.senderName ? cap(input.senderName) : "",
  });

  const message = renderEmail({
    subject: content.subject,
    preheader: `Accept your invitation for ${organization}.`,
    heading: "You're invited to PresbyPortal",
    blocks: content.blocks.map((text) => ({ kind: "p" as const, text })),
    action: { label: "Accept the invitation", href: url },
    footnote: content.footnote,
  });

  return { message, url };
}

interface PurposeContent {
  subject: string;
  /** Paragraphs, in order. */
  blocks: string[];
  footnote: string;
}

/**
 * Per-purpose copy through ONE exhaustive switch (F196's TypeScript half): a
 * purpose added to `AccountInvitationPurpose` is a type error here, and cannot
 * fall into another purpose's text.
 */
function contentFor(
  purpose: AccountInvitationPurpose,
  v: { greeting: string; organization: string; expires: string; sender: string },
): PurposeContent {
  switch (purpose) {
    case "founding_administrator":
    case "treasurer":
      return {
        subject: `You're invited to PresbyPortal for ${v.organization}`,
        blocks: [
          v.greeting,
          `A PresbyPortal administrator has invited you to be ${ROLE_PHRASE[purpose]} for ${v.organization}.`,
          ROLE_GRANTS[purpose],
        ],
        footnote:
          `The link works once and expires on ${v.expires}. Nobody holds this role until you accept.\n` +
          "If you were not expecting this, you can ignore this message.",
      };
    case "sign_in": {
      // The sender is a person at the congregation (their own record name). A
      // blank name falls back to the congregation, so the sentence still reads.
      const who = v.sender ? `${v.sender} at ${v.organization}` : v.organization;
      return {
        subject: `${v.organization} has invited you to sign in to PresbyPortal`,
        blocks: [
          v.greeting,
          `${who} has set up a place for you on PresbyPortal, the website your congregation uses to keep its records and do its work. Accepting takes about a minute: you choose a password, and then you can sign in whenever you need to.`,
          `What you can see and do depends on your role at ${v.organization}. Accepting doesn't change your role.`,
        ],
        footnote: `The link works once and expires on ${v.expires}. If you already have a PresbyPortal account, sign in with this email address. If you weren't expecting this, you can ignore it. Nothing happens unless you accept.`,
      };
    }
    default: {
      const _exhaustive: never = purpose;
      throw new Error(`Unhandled invitation purpose: ${String(_exhaustive)}`);
    }
  }
}

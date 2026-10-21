/**
 * The account-invitation email, built in ONE function (DECISION-186,
 * docs/work-log/2026-10-21-invitations.md Phase 3). Every invitation send and
 * every resend goes through `renderInvitationEmail()`; nothing else composes
 * this message, so a layout change (the parallel review-polish pipeline's
 * shared `renderEmail()`) is one edit here.
 *
 * LINK ORIGIN: `${platformOrigin()}/invite?token=<token>` and nothing else -
 * never the request `Host`, never a church's custom host (a custom host has no
 * session and no platform routes, and a link to one would be phishable). When
 * no safe origin exists the render returns `null` and the caller refuses the
 * send (`link_origin_unavailable`).
 *
 * THE ACCEPT URL IS EMITTED AS ONE UNCHANGED SUBSTRING in the html (the href
 * AND the printed copy) and in the text, so the post-send scrub, which
 * rewrites the stored body of a credential row (queue.ts
 * CREDENTIAL_TEMPLATE_KEYS), finds it in every part.
 *
 * NO FREE TEXT from the sender, ever (a phishing channel in platform-domain
 * mail). The only interpolated values are the recipient's first name and the
 * organization name, both capped at 100 characters and `escapeHtml()`'d for the
 * html body. The token is base64url, so it is inert in html and in a URL.
 *
 * Pure: no database, no `server-only`. Safe in unit tests.
 */
import { escapeHtml } from "@/lib/email/escape-html";
import { platformOrigin } from "@/lib/domains/host";
import type { AccountInvitationPurpose } from "@/lib/db/domain/invitations";

/** The `email_queue.template_key`. Class `account`, platform domain (Q2, R4). */
export const ACCOUNT_INVITATION_TEMPLATE_KEY = "account_invitation";

export const INVITATION_NAME_MAX = 100;

export interface RenderInvitationEmailInput {
  /** Greeting name. Null or blank falls back to a plain "Hello". */
  firstName: string | null;
  organizationName: string;
  purpose: AccountInvitationPurpose;
  token: string;
  expiresAt: Date;
  /** Injected for tests; defaults to `platformOrigin()`. */
  origin?: string | null;
}

export interface RenderedInvitationEmail {
  subject: string;
  html: string;
  text: string;
  /** The exact accept URL embedded in the html and the text. */
  url: string;
}

const ROLE_PHRASE: Record<AccountInvitationPurpose, string> = {
  founding_administrator: "the first administrator",
  treasurer: "the treasurer",
};

const ROLE_GRANTS: Record<AccountInvitationPurpose, string> = {
  founding_administrator:
    "As administrator you will be able to manage people, roles and settings for the congregation.",
  treasurer:
    "As treasurer you will be able to manage the congregation's online giving once you have set up two-factor sign-in.",
};

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
  const role = ROLE_PHRASE[input.purpose];
  const grants = ROLE_GRANTS[input.purpose];
  const expires = formatExpiry(input.expiresAt);

  const subject = `You're invited to PresbyPortal for ${organization}`;

  const text = [
    greeting,
    "",
    `A PresbyPortal administrator has invited you to be ${role} for ${organization}.`,
    grants,
    "",
    "Open this link to accept the invitation:",
    url,
    "",
    `The link works once and expires on ${expires}. Nobody holds this role until you accept.`,
    "If you were not expecting this, you can ignore this message.",
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>A PresbyPortal administrator has invited you to be ${role} for <strong>${escapeHtml(organization)}</strong>.</p>`,
    `<p>${grants}</p>`,
    `<p><a href="${escapeHtml(url)}">Accept the invitation</a></p>`,
    `<p>If the button does not work, copy this address into your browser:<br>${escapeHtml(url)}</p>`,
    `<p>The link works once and expires on ${escapeHtml(expires)}. Nobody holds this role until you accept.</p>`,
    `<p>If you were not expecting this, you can ignore this message.</p>`,
  ].join("\n");

  return { subject, html, text, url };
}

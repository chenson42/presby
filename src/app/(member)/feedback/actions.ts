"use server";
import "server-only";

import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ADMIN_ROLE } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { enqueueEmail } from "@/lib/email";
import { renderEmail, type RenderedEmail } from "@/lib/email/render";
import { platformOrigin } from "@/lib/domains/host";
import type { ActionResult } from "@/types/actions";
// computeLocalDate lives in date-utils.ts — extracted from this file because
// Next.js 16 Turbopack requires all exports from "use server" files to be
// async Server Actions. Pure utility functions must live in a separate module.
import { computeLocalDate } from "./date-utils";

// ---------------------------------------------------------------------------
// Helper: admin notification email
// ---------------------------------------------------------------------------

/**
 * Build the admin notification email (DECISION-191). Every member-supplied
 * string is passed RAW: `renderEmail()` escapes it for HTML (the XSS
 * invariant that used to live here as hand-written escapeHtml calls), keeps the
 * subject a plain header, and generates the plain-text part. The "View all
 * feedback" link is built from the validated platform origin and omitted when
 * none is safe (it used to be a relative href, dead in a mail client; F165).
 */
function buildFeedbackEmail(params: {
  body: string;
  category: string | null;
  contextPath: string | null;
  appVersion: string | null;
  submitterName: string;
  submitterEmail: string;
}): RenderedEmail {
  const { body, category, contextPath, appVersion, submitterName, submitterEmail } =
    params;
  const origin = platformOrigin();
  const categoryLabel = category ?? "general";

  const rows: Array<{ label: string; value: string }> = [
    { label: "From", value: `${submitterName} <${submitterEmail}>` },
    { label: "Category", value: categoryLabel },
  ];
  if (contextPath) rows.push({ label: "Page", value: contextPath });
  if (appVersion) rows.push({ label: "App version", value: appVersion });

  return renderEmail({
    subject: `New feedback — ${categoryLabel}`,
    heading: "New feedback",
    blocks: [
      { kind: "facts", rows },
      { kind: "p", text: "Message:" },
      { kind: "quote", text: body },
    ],
    action: origin ? { label: "View all feedback", href: `${origin}/admin/feedback` } : undefined,
  });
}

// ---------------------------------------------------------------------------
// Valid categories allowlist
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ["suggestion", "bug", "other"] as const;

// ---------------------------------------------------------------------------
// submitFeedback
// ---------------------------------------------------------------------------

type SubmitFeedbackInput = {
  body: string;
  category: string | null;
  contextPath: string | null;
  appVersion: string | null;
  tzOffsetMinutes: number | null;
};

/**
 * Submit in-app feedback from any authenticated member.
 * Gate: session.user.id must exist (no feature gate — any signed-in user).
 * Rate-limited: 5 submissions per hour per user (key: feedback:${userId}).
 *
 * Returns { ok: true, data: { id } } on success.
 * Returns { ok: false, error } on validation failure, auth failure, or rate limit.
 * Never throws for email failures — admin notification is fire-and-forget.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }

  // Rate limit: 5 submissions per hour per user.
  const rateLimitResult = await checkRateLimit(
    `feedback:${session.user.id}`,
    { max: 5, windowSeconds: 3600 },
    {
      userId: session.user.id,
      actor: session.user.email ?? session.user.id,
      reason: "feedback submission",
    },
  );
  if (!rateLimitResult.allowed) {
    return { ok: false, error: "Too many submissions — come back in a bit." };
  }

  // Body validation.
  const trimmedBody = input.body.trim();
  if (trimmedBody.length < 1) {
    return { ok: false, error: "Say something first." };
  }
  if (trimmedBody.length > 2000) {
    return { ok: false, error: "Feedback must be 2,000 characters or fewer." };
  }

  // Category allowlist.
  if (
    input.category !== null &&
    !(VALID_CATEGORIES as readonly string[]).includes(input.category)
  ) {
    return { ok: false, error: "Invalid category." };
  }

  // Bug-only metadata — stripped when category !== 'bug'.
  const contextPath =
    input.category === "bug"
      ? (input.contextPath ?? "").slice(0, 512) || null
      : null;
  const appVersion =
    input.category === "bug"
      ? (input.appVersion ?? "").slice(0, 32) || null
      : null;

  const localToday = computeLocalDate(input.tzOffsetMinutes);

  // Insert feedback row.
  // audit-exempt: personal-data submission; rate-limited; not a security-sensitive mutation
  const [row] = await db
    .insert(schema.feedback)
    .values({
      userId: session.user.id,
      category: input.category,
      body: trimmedBody,
      contextPath,
      appVersion,
    })
    .returning({ id: schema.feedback.id });

  // Upsert feedbackPromptState.lastSubmittedDate.
  // CLOBBER-PREVENTION: sets ONLY lastSubmittedDate. optedOut and lastSnoozedDate are untouched.
  // audit-exempt: personal preference mutation; no security-sensitive surface
  await db
    .insert(schema.feedbackPromptState)
    .values({
      userId: session.user.id,
      lastSubmittedDate: localToday,
      optedOut: false,
      lastSnoozedDate: null,
    })
    .onConflictDoUpdate({
      target: schema.feedbackPromptState.userId,
      set: { lastSubmittedDate: sql`excluded.last_submitted_date` },
    });

  // Admin notification — fire-and-forget; failure never surfaces to the member.
  try {
    const admins = await db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .innerJoin(
        schema.userRoles,
        eq(schema.userRoles.userId, schema.users.id),
      )
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(eq(schema.roles.name, ADMIN_ROLE));

    if (admins.length === 0) {
      console.warn("[feedback] No admins found — skipping notification email.");
    } else {
      // One message for every admin: nothing in it is per-recipient.
      const message = buildFeedbackEmail({
        body: trimmedBody,
        category: input.category,
        contextPath,
        appVersion,
        submitterName: session.user.name ?? "A member",
        submitterEmail: session.user.email ?? "",
      });
      for (const admin of admins) {
        await enqueueEmail({
          to: admin.email,
          message,
          templateKey: "feedback_notification",
        });
      }
    }
  } catch (err) {
    console.error("[feedback] Admin notification failed:", err);
  }

  return { ok: true, data: { id: row.id } };
}

// ---------------------------------------------------------------------------
// snoozeFeedbackPrompt
// ---------------------------------------------------------------------------

/**
 * Snooze the daily feedback prompt for the current local calendar day.
 * Gate: any authenticated user.
 *
 * CLOBBER-PREVENTION: upserts ONLY lastSnoozedDate.
 * optedOut and lastSubmittedDate are not touched.
 */
export async function snoozeFeedbackPrompt(
  tzOffsetMinutes: number | null,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }

  const localToday = computeLocalDate(tzOffsetMinutes);

  // CLOBBER-PREVENTION: sets ONLY lastSnoozedDate.
  // audit-exempt: personal preference mutation; no security-sensitive surface
  await db
    .insert(schema.feedbackPromptState)
    .values({
      userId: session.user.id,
      lastSnoozedDate: localToday,
      optedOut: false,
      lastSubmittedDate: null,
    })
    .onConflictDoUpdate({
      target: schema.feedbackPromptState.userId,
      set: { lastSnoozedDate: sql`excluded.last_snoozed_date` },
    });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// setFeedbackOptOut
// ---------------------------------------------------------------------------

/**
 * Set the member's daily prompt opt-out preference.
 * Gate: any authenticated user.
 *
 * Called with optedOut=true to dismiss the daily prompt permanently.
 * Called with optedOut=false to re-enable it from /account settings.
 *
 * CLOBBER-PREVENTION: upserts ONLY optedOut.
 * lastSnoozedDate and lastSubmittedDate are not touched.
 */
export async function setFeedbackOptOut(
  optedOut: boolean,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }

  // CLOBBER-PREVENTION: sets ONLY optedOut.
  // audit-exempt: personal preference mutation; no security-sensitive surface
  await db
    .insert(schema.feedbackPromptState)
    .values({
      userId: session.user.id,
      optedOut,
      lastSnoozedDate: null,
      lastSubmittedDate: null,
    })
    .onConflictDoUpdate({
      target: schema.feedbackPromptState.userId,
      set: { optedOut: sql`excluded.opted_out` },
    });

  return { ok: true };
}

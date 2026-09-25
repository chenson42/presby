"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { submitStatisticsGrant } from "@/lib/statistics-grants";
import type { ActionResult } from "@/types/actions";

/**
 * `(statistics-submit)`'s Server Actions — the platform's first
 * unauthenticated write path (D16 / DECISION-147,
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 3 API Contract).
 *
 * No `auth()` anywhere in this file — every caller is an anonymous visitor
 * holding an emailed, opaque, single-use token. This is the file
 * `scripts/check-audit-coverage.mjs` walks (`MUTATION_RE` now matches
 * `db.execute(...)`, taken in this same batch specifically so this file
 * cannot silently ship a mutation with no audit coverage) — but the tripwire
 * proves only that SOME audit call appears somewhere in the file; the
 * SHAPE of that call (no session, actor from the just-spent grant, never the
 * raw token) is a property this file's own tests and Phase 2's review
 * cover, not the tripwire.
 *
 * ENUMERATION SAFETY: every failure path below returns one of exactly two
 * fixed strings, regardless of which underlying cause produced it — see
 * `src/lib/statistics-grants.ts`'s header for the full "same number of DB
 * round-trips" discipline this file's own call into that module preserves.
 * The one exception, deliberately outside that discipline, is the IP-keyed
 * rate limit below: it is scoped to an ADDRESS, not a TOKEN, so distinguishing
 * "rate limited" from "invalid token" leaks nothing about which congregation
 * or year a caller is probing — the same posture `(password-reset)/
 * actions.ts`'s own rate limit already takes.
 */

const GENERIC_INVALID_ERROR =
  "This link is no longer active. If you still need to file, ask the presbytery for a new link.";
const GENERIC_FIELDS_ERROR =
  "Some entries could not be saved — check the highlighted fields and try again.";

export type AttestedRole = "clerk_of_session" | "moderator" | "other";

export interface SubmitGrantedReturnInput {
  token: string;
  payload: Record<string, number | boolean | undefined>;
  attestedByName: string;
  attestedRole: AttestedRole;
  /** Required by the client form when `attestedRole === "other"`; folded
   *  into one string ("other: <text>") before reaching the database, since
   *  `statistical_returns.attested_role` is a single plain column. */
  attestedRoleOther?: string;
}

/**
 * The one write this feature's public surface performs. Order, deliberately:
 * the IP-keyed rate limit first (mirrors `(password-reset)/actions.ts`'s
 * identical precedent — cheap, and never token-keyed, because a token-keyed
 * limit would let anyone holding or guessing at a link lock the one real
 * filer out of their one filing window), then the attested-role collapse,
 * then the call into `submitStatisticsGrant()`, which owns every credential-
 * liveness and enumeration-safety property. On success: one audit row (no
 * session — the `{ userId: null, email }` actor-override shape
 * `requestPasswordReset()` already established) naming the grant's own
 * recipient email and both organization ids, never the raw token or its
 * hash; then a redirect to the static confirmation page, which accepts no
 * token and no other parameter.
 */
export async function submitGrantedReturnAction(
  input: SubmitGrantedReturnInput,
): Promise<ActionResult> {
  const hdrs = await headers();
  const ip = getRequestIp(hdrs);

  const limited = await checkRateLimit(
    `stats_submit:${ip ?? "unknown"}`,
    { max: 10, windowSeconds: 3600 },
    { userId: null, actor: ip ?? "unknown", reason: "statistics_grant_submit" },
  );
  if (!limited.allowed) {
    const mins = Math.ceil(limited.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }

  const attestedRole =
    input.attestedRole === "other"
      ? `other: ${(input.attestedRoleOther ?? "").trim()}`
      : input.attestedRole;

  const result = await submitStatisticsGrant(
    input.token,
    input.payload,
    input.attestedByName,
    attestedRole,
  );

  if (result.kind === "invalid") {
    return { ok: false, error: GENERIC_INVALID_ERROR };
  }
  if (result.kind === "invalid_input") {
    return { ok: false, error: GENERIC_FIELDS_ERROR };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STATISTICS_GRANT_SUBMITTED,
    actor: { userId: null, email: result.auditFacts?.issuedToEmail ?? null },
    resourceType: "statistical_returns",
    resourceId: result.returnId,
    metadata: {
      organizationId: result.auditFacts?.organizationId ?? null,
      aboutOrgId: result.auditFacts?.aboutOrgId ?? null,
      reportYear: result.auditFacts?.reportYear ?? null,
      returnId: result.returnId,
    },
  });

  redirect("/file-statistics/submitted");
}

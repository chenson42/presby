import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, getPlatformDb } from "@/lib/db";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { organizations } from "@/lib/db/domain/org";
import { statisticsSubmissionGrants } from "@/lib/db/domain/returns";
import { enqueueEmail, escapeHtml } from "@/lib/email";
import { isFlagEnabled } from "@/lib/flags";

/**
 * Statistical-return submission grants — increment 6 (D16, Section P:
 * submission without an account), DECISION-147.
 * `docs/work-log/2026-09-25-submission-grants.md`, Phase 3 API Contract /
 * Phase 4 batch A handoff.
 *
 * A grant is a CREDENTIAL, not a permission and not a flag (DECISION-147):
 * a one-time, single-purpose, expiring capability that authorizes exactly
 * one write. This file has TWO HALVES with two entirely different trust
 * shapes, kept in one file (architect's Phase 2 ruling — the grant -> return
 * FK makes them one unit) but never sharing a helper that would blur the
 * boundary between them:
 *
 *   1. ISSUANCE / REVOCATION / LISTING — ordinary tenant DML. SAME SHAPE as
 *      `src/lib/presbytery.ts`: one `withOrgContext()` transaction per
 *      exported function, a permission gate (`statistics.manage`) checked
 *      FIRST, a local `resolveMemberCongregation()` parent-path re-check
 *      duplicated from `presbytery.ts` (neither helper is exported there —
 *      same per-module duplication convention that file's own header
 *      documents for `person-sensitive.ts`/`credentials.ts`).
 *
 *   2. THE PUBLIC SUBMISSION BOUNDARY (`submitStatisticsGrant`,
 *      `previewGrantedReturn`) — NO SESSION, NO PERMISSION CHECK, NO ORG
 *      CONTEXT SET. This is the trust boundary Phase 2 named explicitly: the
 *      exported signature takes no `personId` and no `organizationId` — ONLY
 *      a raw token, a payload and an attestation — so a reviewer can see at a
 *      glance that the anonymous path cannot be handed an org id by a
 *      caller. `withOrgContext()` is WRONG here on purpose: the tenant
 *      tables this path touches are owned by `neondb_owner`
 *      (`rolbypassrls = t`), so a `SECURITY DEFINER` function needs no org
 *      GUC at all, and setting one would be `withOrgContext()` with the
 *      membership check deleted — the exact confused-deputy shape CLAUDE.md's
 *      "RLS enforces tenancy, not authorization" paragraph names.
 *
 * ENUMERATION SAFETY (Phase 2's central finding): every failure state on the
 * public boundary — no such token, expired, revoked, already submitted,
 * stale affiliation (the issuing presbytery no longer holds the
 * congregation), and the feature flag being off — collapses to ONE result,
 * `{ kind: "invalid" }`, reached by the SAME number of database round-trips
 * every time. Do NOT add an early return anywhere in `submitStatisticsGrant`
 * that would make one of these cases measurably cheaper than another.
 */

const STATISTICS_MANAGE = "statistics.manage";
const SUBMISSION_GRANTS_FLAG = "statistics.submission_grants";

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;
const RECIPIENT_NAME_MAX = 255;
const RECIPIENT_EMAIL_MAX = 320;
const ATTESTATION_NAME_MAX = 255;
const ATTESTATION_ROLE_MAX = 100;
const EXPIRES_DEFAULT_DAYS = 45;
const EXPIRES_MIN_DAYS = 1;
const EXPIRES_MAX_DAYS = 180;

/** The uniform refusal literal `presby_submit_granted_return()` raises for
 *  every credential-liveness failure — byte-for-byte, per database-admin's
 *  Batch A handoff. Never surfaced to the browser; matched against here only
 *  to route the failure into `{ kind: "invalid" }`. */
const GRANT_NOT_USABLE = "presby_submit_granted_return: grant not usable";

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Walks the `.cause` chain Drizzle hangs a real `pg`/neon driver error off
 * of (it wraps every failure in its own "Failed query: ..." error first —
 * same fact `src/lib/org-provisioning.ts`'s `pgErrorCode()` and
 * `src/lib/db/domain/grants.test.ts`'s `expectDbError()` both document).
 * Returns the first SQLSTATE found and every message in the chain, joined,
 * so a raised message text can be matched with `.includes()` regardless of
 * how deep the driver nested it.
 */
function pgErrorInfo(err: unknown): { code: string | undefined; message: string } {
  const messages: string[] = [];
  let code: string | undefined;
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    if (
      code === undefined &&
      typeof current === "object" &&
      current !== null &&
      "code" in current
    ) {
      const c = (current as { code?: unknown }).code;
      if (typeof c === "string") code = c;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return { code, message: messages.join(" :: ") };
}

/** Same shape as `PresbyteryResult`/`CredentialsResult` — every expected/
 *  denied outcome is a typed variant, never a thrown exception. */
export type StatisticsGrantResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

// ---------------------------------------------------------------------------
// Shared helpers — tenant (session) side only. NEVER called from the public
// submission boundary below.
// ---------------------------------------------------------------------------

async function hasPermission(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${permissionKey}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/** The parent-path check every `aboutOrgId` goes through before a write —
 *  never a bare client-supplied id. A convenience filter for the picker
 *  UI, never authority: `presby_check_about_org_affiliated` (the INSERT
 *  trigger on `statistics_submission_grants`) is the actual authority, and
 *  this file never assumes the two agree (CLAUDE.md's "the check that
 *  matters is at write time"). */
async function resolveMemberCongregation(
  tx: OrgTx,
  organizationId: string,
  aboutOrgId: string,
): Promise<{ id: string; name: string; platformStatus: string } | null> {
  const [row] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      platformStatus: organizations.platformStatus,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, aboutOrgId),
        eq(organizations.parentId, organizationId),
        eq(organizations.organizationType, "congregation"),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssueStatisticsGrantInput {
  aboutOrgId: string;
  reportYear: number;
  issuedToName: string;
  issuedToEmail: string;
  /** Optional; default 45, clamped [1, 180]. */
  expiresInDays?: number;
}

/**
 * Issues a new submission grant. Mints a 32-byte CSPRNG token
 * (`randomBytes(32).toString("base64url")`, byte-for-byte the
 * `requestPasswordReset` precedent — never bcrypt, a fast hash is correct
 * for a high-entropy secret), stores only its sha256 hex, and emails the raw
 * token as a `/file-statistics?token=...` link. **The raw token never leaves
 * this function's scope** — not returned to the caller, never logged, never
 * placed in `metadata`.
 */
export async function issueStatisticsGrant(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: IssueStatisticsGrantInput,
): Promise<StatisticsGrantResult<{ id: string; expiresAt: string }>> {
  if (
    !Number.isInteger(input.reportYear) ||
    input.reportYear < YEAR_MIN ||
    input.reportYear > YEAR_MAX
  ) {
    return { kind: "invalid_input", message: "Enter a valid report year." };
  }

  const issuedToName = input.issuedToName.trim();
  if (issuedToName.length < 1 || issuedToName.length > RECIPIENT_NAME_MAX) {
    return {
      kind: "invalid_input",
      message: `Recipient name must be 1–${RECIPIENT_NAME_MAX} characters.`,
    };
  }

  const issuedToEmail = input.issuedToEmail.trim().toLowerCase();
  if (
    issuedToEmail.length < 3 ||
    issuedToEmail.length > RECIPIENT_EMAIL_MAX ||
    !issuedToEmail.includes("@")
  ) {
    return { kind: "invalid_input", message: "Enter a valid recipient email address." };
  }

  const expiresInDays = clampInt(
    input.expiresInDays ?? EXPIRES_DEFAULT_DAYS,
    EXPIRES_MIN_DAYS,
    EXPIRES_MAX_DAYS,
  );

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    const cong = await resolveMemberCongregation(tx, organizationId, input.aboutOrgId);
    if (!cong) return { kind: "invalid_target" };

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    let inserted: { id: string; expiresAt: Date } | undefined;
    try {
      [inserted] = await tx
        .insert(statisticsSubmissionGrants)
        .values({
          organizationId,
          aboutOrgId: cong.id,
          reportYear: input.reportYear,
          tokenHash,
          issuedToName,
          issuedToEmail,
          issuedBy: actingUserId,
          expiresAt,
        })
        .returning({
          id: statisticsSubmissionGrants.id,
          expiresAt: statisticsSubmissionGrants.expiresAt,
        });
    } catch (err) {
      const { code, message } = pgErrorInfo(err);
      if (code === "23505") {
        // statistics_submission_grants_live_idx
        return {
          kind: "invalid_input",
          message:
            "A grant is already outstanding for this congregation and year — revoke it first.",
        };
      }
      if (code === "22023" && message.includes("already has an active account")) {
        // presby_check_grant_about_org_unmanaged() — the picker filters this
        // client-side, but the trigger is the authority, not the filter.
        return {
          kind: "invalid_input",
          message:
            "This congregation already has an active account and self-files through its own portal.",
        };
      }
      if (code === "42501") {
        // presby_check_about_org_affiliated's shared drizzle/0045 literal —
        // should be unreachable given resolveMemberCongregation() above, but
        // the trigger is the true authority and this file never assumes the
        // parent-path cache agrees with it.
        return { kind: "invalid_target" };
      }
      throw err;
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const submitUrl = `${baseUrl}/file-statistics?token=${rawToken}`;
    const safeRecipientName = escapeHtml(issuedToName);
    const safeCongregationName = escapeHtml(cong.name);
    const expiresLabel = inserted!.expiresAt.toDateString();

    await enqueueEmail({
      to: issuedToEmail,
      subject: `File ${cong.name}'s ${input.reportYear} statistical report`,
      html: `
        <p>Hi ${safeRecipientName},</p>
        <p><strong>${safeCongregationName}</strong> has been asked to file its ${input.reportYear} annual statistical report.</p>
        <p>Click the link below to open the form. This link expires on ${expiresLabel} and can be used once.</p>
        <p><a href="${submitUrl}">${submitUrl}</a></p>
        <p>If you were not expecting this, you can safely ignore this email.</p>
      `,
      text: `File ${cong.name}'s ${input.reportYear} statistical report. This link expires ${inserted!.expiresAt.toISOString()} and can be used once.\n\n${submitUrl}\n\nIf you were not expecting this, ignore this email.`,
      templateKey: "statistics_submission_grant",
    });

    return {
      kind: "ok",
      data: { id: inserted!.id, expiresAt: inserted!.expiresAt.toISOString() },
    };
  });
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revokes a live grant. Pre-selects the row so the UI can distinguish
 * **not found**, **already filed**, and **already revoked** — the freeze
 * trigger's own `check_violation` text is never allowed to reach a user;
 * this function returns its own message before attempting the `UPDATE`.
 */
export async function revokeStatisticsGrant(
  viewerPersonId: string,
  organizationId: string,
  grantId: string,
): Promise<StatisticsGrantResult<{ id: string; aboutOrgId: string; reportYear: number }>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    // aboutOrgId/reportYear are fetched in this SAME pre-select — no extra
    // round trip — so the caller's audit write (Phase 3's Audit Events
    // block: `{ organizationId, aboutOrgId, reportYear, grantId }`) never
    // has to re-query for them.
    const [existing] = await tx
      .select({
        id: statisticsSubmissionGrants.id,
        aboutOrgId: statisticsSubmissionGrants.aboutOrgId,
        reportYear: statisticsSubmissionGrants.reportYear,
        submittedAt: statisticsSubmissionGrants.submittedAt,
        revokedAt: statisticsSubmissionGrants.revokedAt,
      })
      .from(statisticsSubmissionGrants)
      .where(
        and(
          eq(statisticsSubmissionGrants.id, grantId),
          eq(statisticsSubmissionGrants.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!existing) return { kind: "invalid_target" };

    if (existing.submittedAt) {
      return {
        kind: "invalid_input",
        message: `This grant was already used to file a return on ${existing.submittedAt.toLocaleDateString()}.`,
      };
    }
    if (existing.revokedAt) {
      return { kind: "invalid_input", message: "This grant was already revoked." };
    }

    await tx
      .update(statisticsSubmissionGrants)
      .set({ revokedAt: new Date() })
      .where(eq(statisticsSubmissionGrants.id, grantId));

    return {
      kind: "ok",
      data: { id: grantId, aboutOrgId: existing.aboutOrgId, reportYear: existing.reportYear },
    };
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface StatisticsGrantRow {
  id: string;
  aboutOrgId: string;
  aboutOrgName: string;
  reportYear: number;
  issuedToName: string;
  issuedToEmail: string;
  issuedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  returnId: string | null;
  revokedAt: string | null;
  status: "issued" | "expired" | "revoked" | "submitted";
}

function statusOf(
  row: { submittedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: number,
): StatisticsGrantRow["status"] {
  if (row.submittedAt) return "submitted";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now) return "expired";
  return "issued";
}

/** Every grant this presbytery has ever issued, newest first. */
export async function listStatisticsGrants(
  viewerPersonId: string,
  organizationId: string,
): Promise<StatisticsGrantResult<StatisticsGrantRow[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select({
        id: statisticsSubmissionGrants.id,
        aboutOrgId: statisticsSubmissionGrants.aboutOrgId,
        aboutOrgName: organizations.name,
        reportYear: statisticsSubmissionGrants.reportYear,
        issuedToName: statisticsSubmissionGrants.issuedToName,
        issuedToEmail: statisticsSubmissionGrants.issuedToEmail,
        issuedAt: statisticsSubmissionGrants.issuedAt,
        expiresAt: statisticsSubmissionGrants.expiresAt,
        submittedAt: statisticsSubmissionGrants.submittedAt,
        returnId: statisticsSubmissionGrants.returnId,
        revokedAt: statisticsSubmissionGrants.revokedAt,
      })
      .from(statisticsSubmissionGrants)
      .innerJoin(
        organizations,
        eq(organizations.id, statisticsSubmissionGrants.aboutOrgId),
      )
      .where(eq(statisticsSubmissionGrants.organizationId, organizationId))
      .orderBy(desc(statisticsSubmissionGrants.issuedAt));

    const now = Date.now();
    const data: StatisticsGrantRow[] = rows.map((r) => ({
      id: r.id,
      aboutOrgId: r.aboutOrgId,
      aboutOrgName: r.aboutOrgName,
      reportYear: r.reportYear,
      issuedToName: r.issuedToName,
      issuedToEmail: r.issuedToEmail,
      issuedAt: r.issuedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      returnId: r.returnId,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      status: statusOf(r, now),
    }));

    return { kind: "ok", data };
  });
}

// ---------------------------------------------------------------------------
// THE PUBLIC SUBMISSION BOUNDARY — no session, no personId, no organizationId
// ever accepted as a parameter. See this file's header.
// ---------------------------------------------------------------------------

export interface PreviewGrantedReturnResult {
  aboutOrgName: string;
  reportYear: number;
  formVersionKey: string;
}

/**
 * Read-only resolve for the token page. Calls `presby_preview_granted_
 * return()` — `language sql stable security definer`, one indexed lookup,
 * never `presby_submit_granted_return()` itself (a write). A dead token
 * (nonexistent, expired, revoked, already submitted) previews as `null`,
 * never an error — the page renders the SAME generic "this link is no
 * longer active" copy either way.
 */
export async function previewGrantedReturn(
  rawToken: string,
): Promise<PreviewGrantedReturnResult | null> {
  const tokenHash = sha256Hex(rawToken);

  const result = await db.execute(sql`
    select about_org_name, report_year, form_version_key
    from presby_preview_granted_return(${tokenHash})
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          about_org_name: string | null;
          report_year: number | null;
          form_version_key: string | null;
        }>;
      }
    ).rows ?? [];
  const row = rows[0];
  if (!row || row.about_org_name === null || row.report_year === null || row.form_version_key === null) {
    return null;
  }

  return {
    aboutOrgName: row.about_org_name,
    reportYear: row.report_year,
    formVersionKey: row.form_version_key,
  };
}

export interface SubmittedGrantAuditFacts {
  organizationId: string;
  aboutOrgId: string;
  reportYear: number;
  issuedToEmail: string;
}

export type SubmitStatisticsGrantResult =
  | { kind: "ok"; returnId: string; auditFacts: SubmittedGrantAuditFacts | null }
  /** ONE bucket: no such token, expired, revoked, already submitted, stale
   *  affiliation, flag off, or a genuine DB/network failure. Deliberately
   *  indistinguishable — see this file's header. */
  | { kind: "invalid" }
  /** Only reachable once token possession is already proven — safe to be
   *  specific here (Phase 3 ruling 6's "two-tier uniformity rule"). */
  | { kind: "invalid_input"; message: string };

/**
 * The one write the credential authorizes. Calls `presby_submit_granted_
 * return()` on the plain tenant `db` connection with **no org context set**
 * — `withOrgContext()` would be wrong here; see this file's header.
 *
 * Order, deliberately: hash the token, check the flag, THEN validate the
 * attestation shape, THEN call the database — every branch before the flag
 * check and after it performs exactly one indexed lookup, so a flag-off
 * response costs the same as a live one (Phase 2's enumeration-safety rule).
 */
export async function submitStatisticsGrant(
  rawToken: string,
  payload: Record<string, unknown>,
  attestedByName: string,
  attestedRole: string,
): Promise<SubmitStatisticsGrantResult> {
  const tokenHash = sha256Hex(rawToken);

  const flagOn = await isFlagEnabled(SUBMISSION_GRANTS_FLAG);
  if (!flagOn) {
    // A real, side-effect-free, identically-indexed lookup whose result is
    // deliberately discarded — the mechanism that keeps a flag-off response
    // from being measurably cheaper than a live-token response, without
    // teaching the SQL layer about flags (flags stay a pure TS concept,
    // never passed into a SECURITY DEFINER function parameter).
    await db.query.statisticsSubmissionGrants.findFirst({
      where: (t, { eq }) => eq(t.tokenHash, tokenHash),
    });
    return { kind: "invalid" };
  }

  const trimmedName = attestedByName.trim();
  if (trimmedName.length < 1 || trimmedName.length > ATTESTATION_NAME_MAX) {
    return {
      kind: "invalid_input",
      message: "Enter the name of the person attesting to this report.",
    };
  }
  const trimmedRole = attestedRole.trim();
  if (trimmedRole.length < 1 || trimmedRole.length > ATTESTATION_ROLE_MAX) {
    return {
      kind: "invalid_input",
      message: "Enter the role of the person attesting to this report.",
    };
  }

  try {
    const result = await db.execute(sql`
      select presby_submit_granted_return(
        ${tokenHash},
        ${JSON.stringify(payload)}::jsonb,
        ${trimmedName},
        ${trimmedRole}
      ) as return_id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ return_id: string | null }> }).rows ??
      [];
    const returnId = rows[0]?.return_id;
    if (!returnId) {
      // The function contract is: return a uuid, or raise. A null/absent
      // row here would be a driver-shape surprise, not a credential state —
      // fold it into the same generic bucket rather than throwing.
      return { kind: "invalid" };
    }

    // ONE follow-up, self-scoped read — purely to hand the caller (the
    // `(statistics-submit)/actions.ts` audit write) the recipient email and
    // both organization ids, never to re-derive authority: the grant is
    // ALREADY spent by this point, and `returnId` is a value only this
    // successful call could have produced, so a lookup keyed on it cannot be
    // used to fish for any other tenant's data (the same "self-scoped,
    // harmless" property Phase 3 named). The public tenant `db` connection
    // has no org context here and never will — `statistics_submission_
    // grants` is FORCE RLS, so an unscoped `db.select()` would silently
    // return zero rows, not an error. `getPlatformDb()` (owner connection,
    // no grant binds it) is used instead, exactly once, narrowly, for this
    // one already-authorized read — the same "verified, no membership"
    // caller shape `src/lib/sites.ts`'s header documents for its own
    // platform-authorized readers, applied here to a caller that just
    // proved authorization by successfully spending the credential rather
    // than by holding a platform feature. A failure here never unwinds the
    // write that already committed; it degrades to `auditFacts: null` and
    // the caller records a still-useful, if incomplete, audit row.
    let auditFacts: SubmittedGrantAuditFacts | null = null;
    try {
      const platform = getPlatformDb();
      const [row] = await platform
        .select({
          organizationId: statisticsSubmissionGrants.organizationId,
          aboutOrgId: statisticsSubmissionGrants.aboutOrgId,
          reportYear: statisticsSubmissionGrants.reportYear,
          issuedToEmail: statisticsSubmissionGrants.issuedToEmail,
        })
        .from(statisticsSubmissionGrants)
        .where(eq(statisticsSubmissionGrants.returnId, returnId))
        .limit(1);
      if (row) auditFacts = row;
    } catch (auditLookupErr) {
      // REDACTED, deliberately (QA Phase 5 Advisory 1 — same class of risk,
      // applied here too though not itself flagged): never log the caught
      // error object or its `.message` chain. Drizzle's `DrizzleQueryError`
      // builds its OWN message as `Failed query: ...\nparams: ...`, so a
      // bound query parameter — here, `returnId` — would otherwise reach the
      // server log verbatim. Only the SQLSTATE and a fixed prefix are safe.
      console.error(
        "[statistics-grants] submitStatisticsGrant: audit-facts lookup failed",
        { code: pgErrorInfo(auditLookupErr).code ?? "unknown" },
      );
    }

    return { kind: "ok", returnId, auditFacts };
  } catch (err) {
    const { code, message } = pgErrorInfo(err);

    if (code === "42501" && message.includes(GRANT_NOT_USABLE)) {
      return { kind: "invalid" };
    }
    if (code === "22023" || code === "23514") {
      // 22023 (invalid_parameter_value): attestation out of range, or the
      // chain writer's report-year/form-version/recipient-type/F80 collision
      // refusal. 23514 (check_violation): `presby_enforce_sasr_field_spec()`'s
      // own allow-list/type/bounds rejection on the `statistical_returns`
      // insert — measured against the live catalog to carry `check_violation`,
      // not `invalid_parameter_value` as an earlier design draft assumed; the
      // discrepancy is recorded here rather than silently reconciled. Both are
      // safe to distinguish from a dead token, because token possession is
      // already proven by the time either can fire.
      return {
        kind: "invalid_input",
        message:
          "Some entries could not be saved — check the highlighted fields and try again.",
      };
    }

    // A genuine thrown/network/DB failure — same bucket as a dead token,
    // per "nothing was saved, try the link again." Logged server-side only;
    // the SQL text is never surfaced to the browser.
    //
    // REDACTED (QA Phase 5 Advisory 1, measured not inferred): `err` itself
    // — and this catch block's own `message` local, built by `pgErrorInfo()`
    // by walking `err`'s `.cause` chain — must never reach `console.error`
    // here. `db.execute()`'s first bound parameter is `tokenHash`, and
    // Drizzle's `DrizzleQueryError` renders its OWN `.message` as
    // `` `Failed query: ${query}\nparams: ${params}` ``, so logging the raw
    // error (or the joined message chain `pgErrorInfo()` extracts from it)
    // would print the credential's hash to the server log on every
    // unmapped failure — QA reproduced this by forcing an unmapped SQLSTATE
    // through the same call shape. Only the SQLSTATE code and a fixed
    // prefix are logged; never the error object, never `message`.
    console.error(
      "[statistics-grants] submitStatisticsGrant: unexpected error",
      { code: code ?? "unknown" },
    );
    return { kind: "invalid" };
  }
}

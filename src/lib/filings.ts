import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { publications } from "@/lib/db/domain/publication";
import { statisticalReturns } from "@/lib/db/domain/returns";

/**
 * The CONGREGATION'S OWN filing surface — DECISION-152,
 * `docs/work-log/2026-09-26-withdraw-publication.md` Phase 3 API Contract.
 *
 * ITS OWN MODULE, DELIBERATELY, NOT `src/lib/presbytery.ts` (Phase 3's own
 * reasoning, restated here because the boundary matters more than the file
 * split): `presbytery.ts`'s header calls itself "Presbytery-owned
 * operational data," every exported function there gates on a
 * presbytery-scoped permission, and every `resolveMemberCongregation()`
 * parent-path check assumes the actor IS the presbytery. A congregation
 * withdrawing its own act is the OTHER axis of Two Hierarchies entirely —
 * same shape (`withOrgContext`, a local `hasPermission()` helper, typed
 * result variants) but a different owning council — so it gets its own file,
 * the same per-module-duplication convention `presbytery.ts`'s own header
 * documents for `person-sensitive.ts`/`credentials.ts`/
 * `statistics-grants.ts`.
 *
 * THE READ IS A TENANT-POLICY JOIN, NOT A NEW DEFINER FUNCTION (Phase 2
 * ruling 1b). The congregation owns its `publications` and
 * `statistical_returns` rows outright (`organizationId` on both IS the
 * congregation), `presby_app` holds `SELECT` on both, and the policy is
 * `organization_id = presby_current_org()` — so this crosses no tenant
 * boundary. `presby_list_own_congregation_publications()` stays UNCHANGED and
 * UNUSED here on purpose: it is the *projection* read (reaches the
 * presbytery's `congregation_statistics` row, `setof congregation_
 * statistics`) and carries `withdrawnAt` but not `withdrawnBy`,
 * `withdrawnMinuteReference` or `supersedesId` — it cannot render the history
 * this file needs without a return-type change Phase 2 explicitly declined
 * to make (widening a DEFINER function where a tenant policy already
 * answers is exactly what DECISION-112/135 are careful about).
 *
 * THE WITHDRAWAL WRITER — `presby_withdraw_publication(p_publication_id,
 * p_withdrawn_by, p_minute_reference)` (`drizzle/0052`, DECISION-152) — is a
 * SECURITY DEFINER council act with NO organization parameter: the actor is
 * `presby_current_org()`, already membership-verified by `withOrgContext()`
 * before this file is reachable. Refusals split by what the caller has
 * already proven (F40's discipline): not-found, wrong-owning-org, wrong
 * record class, and a `p_withdrawn_by` that is not an active member of the
 * acting congregation ALL raise ONE uniform literal
 * (`insufficient_privilege`, `42501`) — collapsed here to a single
 * `FilingsResult` kind, `invalid_target`, so the TypeScript layer cannot
 * accidentally re-introduce the cross-tenant existence oracle the database
 * refuses to expose. "Already withdrawn" and "superseded by a later
 * publication" raise DISTINCT, honest `check_violation` (`23514`) messages,
 * because by the time those branches run the caller has already proven it
 * owns the row and can already read both facts under its own tenant policy.
 *
 * `withdrawnBy` IS `actingUserId` (the session's `users.id`), BOUND SERVER-
 * SIDE, NEVER A FORM FIELD — the exported signature below has no parameter
 * shaped like a client-suppliable identity claim; the only user id it
 * accepts is the third positional argument, filled in by
 * `admin/filings/actions.ts`'s `resolveActingIdentity()` from the
 * authenticated session, exactly `setCongregationStatistics()`'s
 * `actingUserId` precedent (`src/lib/presbytery.ts:618-621`). The database
 * additionally BOUNDS the claim (an active member of the acting congregation
 * or the uniform refusal) — see `drizzle/0052`'s own header note (3) — so a
 * same-tenant misattribution is possible but bounded and cross-checkable
 * against the audit event's independently recorded actor. Neither this file
 * nor the action above ever reads a `withdrawnBy`/`withdrawnByUserId` key out
 * of client input; `withdrawFiling()`'s TypeScript signature is the
 * enforcement — there is no field to smuggle a value into.
 */

const STATISTICS_PUBLISH = "statistics.publish";
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;
/** Same bound as `presbytery.ts`'s own `MINUTE_REFERENCE_MAX` — reused by
 *  value, not by import, matching this file's own per-module-duplication
 *  convention (no shared "minutes" helper module exists, and inventing one
 *  for a single constant would be its own coupling). Phase 3's own Data
 *  Model ruling: no DB-level length CHECK exists on either minute-reference
 *  column, so this is the ONLY bound either column has. */
export const MINUTE_REFERENCE_MAX = 500;

/** Same shape as `PresbyteryResult`/`StatisticsGrantResult` — every
 *  expected/denied outcome is a typed variant, never a thrown exception.
 *  `invalid_target` is the ONE uniform literal for every identity-class
 *  refusal (Phase 3's refusal-copy table); `already_withdrawn`/`superseded`
 *  are the two honest, distinct state-class refusals. */
export type FilingsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string }
  | { kind: "already_withdrawn" }
  | { kind: "superseded" };

export interface FilingRow {
  publicationId: string;
  reportYear: number;
  /** ISO. */
  publishedAt: string;
  minuteReference: string | null;
  supersedesId: string | null;
  /** ISO, or null if not withdrawn. */
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnMinuteReference: string | null;
}

/** Local, single-permission gate — `statistics-grants.ts`'s exact shape
 *  (one key, not `person-sensitive.ts`'s parameterized-by-key variant, since
 *  this module has exactly one permission). */
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

/**
 * Walks the `.cause` chain Drizzle hangs a real `pg`/neon driver error off
 * of. Same helper, same reasoning, as `statistics-grants.ts`'s own
 * `pgErrorInfo()` (per-module duplication, not a shared import — this file
 * has no other coupling to that module and inventing a shared error-parsing
 * helper module for two call sites is not worth the indirection).
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

/** Substrings of `presby_withdraw_publication()`'s own two honest,
 *  state-class `check_violation` literals (`drizzle/0052`) — matched with
 *  `.includes()` because the DB message is parameterized (the timestamp in
 *  the already-withdrawn case), never asserted verbatim. */
const ALREADY_WITHDRAWN_MARKER = "already withdrawn at";
const SUPERSEDED_MARKER = "supersedes this one";

/**
 * Every publication this congregation has itself made, newest first —
 * `publications ⋈ statistical_returns` under the tenant policy (see this
 * file's header). `year`, if given, filters to one report year.
 */
export async function listOwnFilings(
  viewerPersonId: string,
  organizationId: string,
  year?: number,
): Promise<FilingsResult<FilingRow[]>> {
  if (
    year !== undefined &&
    (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX)
  ) {
    return { kind: "invalid_input", message: "Enter a valid statistical year." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_PUBLISH))) {
      return { kind: "forbidden" };
    }

    const rows = await tx
      .select({
        publicationId: publications.id,
        reportYear: statisticalReturns.reportYear,
        publishedAt: publications.publishedAt,
        minuteReference: publications.minuteReference,
        supersedesId: publications.supersedesId,
        withdrawnAt: publications.withdrawnAt,
        withdrawnBy: publications.withdrawnBy,
        withdrawnMinuteReference: publications.withdrawnMinuteReference,
      })
      .from(publications)
      .innerJoin(
        statisticalReturns,
        and(
          eq(statisticalReturns.id, publications.artifactId),
          eq(statisticalReturns.organizationId, publications.organizationId),
        ),
      )
      .where(
        and(
          eq(publications.organizationId, organizationId),
          eq(publications.recordClass, "statistical_return"),
          year !== undefined ? eq(statisticalReturns.reportYear, year) : undefined,
        ),
      )
      .orderBy(desc(statisticalReturns.reportYear), desc(publications.publishedAt));

    const data: FilingRow[] = rows.map((r) => ({
      publicationId: r.publicationId,
      reportYear: r.reportYear,
      publishedAt: r.publishedAt.toISOString(),
      minuteReference: r.minuteReference,
      supersedesId: r.supersedesId,
      withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
      withdrawnBy: r.withdrawnBy,
      withdrawnMinuteReference: r.withdrawnMinuteReference,
    }));

    return { kind: "ok", data };
  });
}

export interface WithdrawnFiling {
  id: string;
  /** The presbytery the withdrawn publication was addressed to — read back
   *  after the withdrawal succeeds so `admin/filings/actions.ts`'s audit
   *  write can carry BOTH organization ids without a second network round
   *  trip from the caller (`revokeStatisticsGrant()`'s own "fetched in this
   *  SAME…no extra round trip" precedent, `src/lib/statistics-grants.ts`). */
  recipientOrgId: string;
  /** Likewise read back for the audit metadata Phase 2's Audit section
   *  specifies (`{ organizationId, recipientOrgId, aboutOrgId, reportYear,
   *  publicationId }`) — `aboutOrgId` itself is NOT read back here because
   *  for a congregation withdrawing its OWN publication it is always exactly
   *  `organizationId` (the caller already has it) — see this file's header,
   *  "the congregation owns its publications and statistical_returns rows
   *  outright." */
  reportYear: number;
}

/**
 * Withdraws a published statistical return. Calls `presby_withdraw_
 * publication(p_publication_id, p_withdrawn_by, p_minute_reference)` — see
 * this file's header for the refusal split and the `withdrawnBy` binding
 * rule. `actingUserId` is `setCongregationStatistics()`'s `actingUserId`
 * precedent: bound server-side from the session by the caller
 * (`admin/filings/actions.ts`), never accepted from a client-suppliable
 * field on this function's own signature.
 */
export async function withdrawFiling(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  publicationId: string,
  minuteReference: string,
): Promise<FilingsResult<WithdrawnFiling>> {
  const trimmed = minuteReference.trim();
  if (trimmed.length < 1 || trimmed.length > MINUTE_REFERENCE_MAX) {
    return {
      kind: "invalid_input",
      message: `Minute reference must be 1–${MINUTE_REFERENCE_MAX} characters.`,
    };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_PUBLISH))) {
      return { kind: "forbidden" };
    }

    try {
      const result = await tx.execute(sql`
        select presby_withdraw_publication(
                 ${publicationId}::uuid,
                 ${actingUserId}::uuid,
                 ${trimmed}
               ) as id
      `);
      const rows = (result as unknown as { rows?: Array<{ id?: string }> }).rows ?? [];
      const id = rows[0]?.id;
      if (!id) {
        // The function's contract is: return a uuid, or raise. A null/absent
        // row here would be a driver-shape surprise, not a credential/state
        // outcome — same "not a state a clerk caused" treatment as the
        // unmapped data_exception arm below.
        throw new Error("presby_withdraw_publication returned no id");
      }

      // ONE follow-up, self-scoped read, same transaction — the publication
      // just successfully withdrawn is unambiguously this congregation's own
      // (organization_id = presby_current_org(), already the tenant policy
      // for this whole transaction), so this read fishes for nothing outside
      // what the caller already proved it owns.
      const [facts] = await tx
        .select({
          recipientOrgId: publications.recipientOrgId,
          reportYear: statisticalReturns.reportYear,
        })
        .from(publications)
        .innerJoin(
          statisticalReturns,
          and(
            eq(statisticalReturns.id, publications.artifactId),
            eq(statisticalReturns.organizationId, publications.organizationId),
          ),
        )
        .where(eq(publications.id, id))
        .limit(1);
      if (!facts) {
        // Structurally unreachable — the row we just withdrew must still
        // exist under this same transaction's own write — but treated as a
        // bug signal rather than assumed, same discipline as the driver-shape
        // check above.
        throw new Error("withdrawn publication vanished before its own read-back");
      }

      return {
        kind: "ok",
        data: { id, recipientOrgId: facts.recipientOrgId, reportYear: facts.reportYear },
      };
    } catch (err) {
      const { code, message } = pgErrorInfo(err);

      if (code === "42501") {
        // The ONE uniform literal — not found, wrong owning org, wrong
        // record class, or a p_withdrawn_by that is not an active member of
        // the acting congregation. No substring check: this is the only
        // thing presby_withdraw_publication() raises with this SQLSTATE, and
        // narrowing the copy toward any one of its five causes would be
        // exactly the existence oracle DECISION-152 refuses to build.
        return { kind: "invalid_target" };
      }
      if (code === "23514" && message.includes(ALREADY_WITHDRAWN_MARKER)) {
        return { kind: "already_withdrawn" };
      }
      if (code === "23514" && message.includes(SUPERSEDED_MARKER)) {
        return { kind: "superseded" };
      }

      // 22000 (data_exception — the pair-inconsistency guard) and anything
      // else unmapped: a bug signal, not a state a clerk caused. Rethrown
      // per src/types/actions.ts's "truly unexpected errors may throw"
      // contract, same as submitStatisticsGrant()'s own unmapped-failure
      // arm — never surfaced as a friendly FilingsResult.
      throw err;
    }
  });
}

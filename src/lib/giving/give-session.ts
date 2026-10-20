import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { rowsOf } from "./db-util";
import { GIVE_MESSAGES } from "./giving-copy";
import type { GiveField, GiveResult, ParsedGive } from "./give-input";
import { slugSitePath } from "@/lib/site-urls";
import { donorOrigin } from "./donor-origin";
import { givingOrigin } from "./origin";
import { readPublicGivingConfig } from "./public-config";
import { checkoutExpiresAt } from "./providers/stripe/checkout";
import { createCheckoutSession, isStripeConfigured } from "./providers/stripe/client";
import { ProviderError } from "./providers/stripe/errors";

/**
 * Starting a gift - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Checkout-intent lifecycle" steps 2 to 6. Shared by the public action
 * (`/site/<slug>/give`) and the member action (`/o/<slug>/giving/give`); the
 * actions own everything BEFORE an intent exists (honeypot, rate limits,
 * Turnstile, the session gate, parsing), this file owns everything after.
 *
 *   created ──attach_session──▶ open ──completed event──▶ completed
 *      │                         └──expired event / cron──▶ expired
 *      └──Stripe call failed──▶ failed
 *
 * THE DATABASE IS THE AUTHORITY on money. `presby_giving_create_intent_*`
 * recomputes the charged total (`presby_giving_gross_up`) and returns it; the
 * Checkout request is built from THAT row, never from the form. The `created`
 * intent row is COMMITTED before Stripe is called (the public path is one
 * statement; the member path is its own `withOrgContext` transaction that has
 * ended by the time we reach the network), so a Stripe outage leaves a visible
 * `failed` row, never a vanished attempt.
 *
 * REDIRECT TARGETS never come from the request: not the `Host` or
 * `X-Forwarded-Host`, not a form field. This file does not read request headers
 * at all. The PUBLIC surface's origin is `donorOrigin(slug)` (the organization's
 * SERVING canonical custom host from the database, else the platform origin from
 * `NEXT_PUBLIC_APP_URL`); the MEMBER surface's is `givingOrigin()` (the platform
 * origin, always: members give on the platform host).
 *
 * NO DONOR DATA is stored or logged here: the form carries an amount, a fund id
 * and choices. A failure is logged with the intent id and a fixed stage only.
 */

/** The row `presby_giving_create_intent_*` returns, camel-cased. */
export interface IntentRow {
  outcome: "created" | "existing" | "invalid" | "unavailable" | "rate_limited";
  intentId: string | null;
  externalAccountId: string | null;
  livemode: boolean | null;
  fundName: string | null;
  giftAmountCents: number | null;
  coveredCents: number | null;
  totalCents: number | null;
  /** Null for `existing` (the function does not repeat them). */
  methods: Array<"card" | "bank"> | null;
  alreadyAttached: boolean;
}

const OUTCOMES = new Set(["created", "existing", "invalid", "unavailable", "rate_limited"]);

function intOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

/** Maps the function's one row. An unrecognized outcome is `unavailable`, never a guess. Exported for tests. */
export function toIntentRow(row: Record<string, unknown> | undefined): IntentRow {
  const outcome = typeof row?.outcome === "string" && OUTCOMES.has(row.outcome) ? row.outcome : "unavailable";
  const methods = Array.isArray(row?.methods)
    ? (row!.methods as unknown[]).filter((m): m is "card" | "bank" => m === "card" || m === "bank")
    : null;
  return {
    outcome: outcome as IntentRow["outcome"],
    intentId: typeof row?.intent_id === "string" ? row.intent_id : null,
    externalAccountId: typeof row?.external_account_id === "string" ? row.external_account_id : null,
    livemode: typeof row?.livemode === "boolean" ? row.livemode : null,
    fundName: typeof row?.fund_name === "string" ? row.fund_name : null,
    giftAmountCents: intOrNull(row?.gift_amount_cents),
    coveredCents: intOrNull(row?.covered_cents),
    totalCents: intOrNull(row?.total_cents),
    methods: methods && methods.length > 0 ? methods : null,
    alreadyAttached: row?.already_attached === true,
  };
}

// ---------------------------------------------------------------------------
// the database calls
// ---------------------------------------------------------------------------

/** The PUBLIC intent: org from the slug only, no membership parameter - structurally unable to link a donor to a member. */
export async function createPublicIntent(slug: string, p: ParsedGive): Promise<IntentRow> {
  const result = await db.execute(sql`
    select * from presby_giving_create_intent_public(
      ${slug}::text, ${p.fundId}::uuid, ${p.amountCents}::integer, ${p.coverFees}::boolean,
      ${p.method}::text, ${p.frequency}::text, ${p.idempotencyKey}::text)`);
  return toIntentRow(rowsOf(result)[0]);
}

/**
 * The MEMBER intent: runs inside the viewer's own `withOrgContext` (which
 * re-verifies the membership before setting the context) and carries the
 * viewer's membership id, which is the only way a donor is linked to a member.
 * The transaction ends - committing the `created` row - before this returns.
 */
export async function createMemberIntent(
  viewer: { personId: string; organizationId: string },
  membershipId: string,
  p: ParsedGive,
): Promise<IntentRow> {
  return withOrgContext(viewer.personId, viewer.organizationId, async (tx) => {
    const result = await tx.execute(sql`
      select * from presby_giving_create_intent_member(
        ${membershipId}::uuid, ${p.fundId}::uuid, ${p.amountCents}::integer, ${p.coverFees}::boolean,
        ${p.method}::text, ${p.frequency}::text, ${p.idempotencyKey}::text)`);
    return toIntentRow(rowsOf(result)[0]);
  });
}

async function attachSession(intentId: string, sessionId: string): Promise<boolean> {
  const result = await db.execute(
    sql`select presby_giving_attach_session(${intentId}::uuid, ${sessionId}::text) as attached`,
  );
  return rowsOf(result)[0]?.attached === true;
}

async function failIntent(intentId: string): Promise<void> {
  try {
    await db.execute(sql`select presby_giving_fail_intent(${intentId}::uuid)`);
  } catch {
    // The row stays `created`; `presby_giving_expire_intents` closes it. Never mask the real result.
    console.error("[giving/give] fail_intent failed", { intentId });
  }
}

// ---------------------------------------------------------------------------
// the redirect targets (pure; exported for tests)
// ---------------------------------------------------------------------------

export type GiveSurface = "public" | "member";

/**
 * `success_url` and `cancel_url`, built from the canonical origin and the slug
 * and from nothing else. `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder and
 * must reach Stripe literally. The slug has already been checked slug-shaped.
 *
 * `customHost` (public surface only) says `origin` is a church's own domain,
 * whose site lives at CLEAN paths: the donor returns to `<host>/give/return`, not
 * to `<platform>/site/<slug>/give/return` (Track F, DECISION-181). The platform
 * form is built by `slugSitePath`, the one builder of a slug URL.
 */
export function checkoutReturnUrls(
  origin: string,
  slug: string,
  surface: GiveSurface,
  customHost: boolean = false,
): { successUrl: string; cancelUrl: string } {
  const base =
    surface === "public"
      ? `${origin}${customHost ? "/give" : slugSitePath(slug, "/give")}`
      : `${origin}/o/${slug}/giving/give`;
  return {
    successUrl: `${base}/return?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: base,
  };
}

// ---------------------------------------------------------------------------
// the shared flow
// ---------------------------------------------------------------------------

/** How long a donor is told to wait when the per-organization flood cap (200 `created` intents an hour) trips. */
const FLOOD_RETRY_SECONDS = 300;

/** The DB said `invalid` without saying which field: find out cheaply, on this rare path only. */
async function refineInvalid(slug: string, p: ParsedGive): Promise<GiveResult> {
  const config = await readPublicGivingConfig(slug);
  if (config.state !== "live") return { kind: "unavailable" };
  if (!config.funds.some((f) => f.id === p.fundId)) {
    return { kind: "invalid", field: "fund", message: GIVE_MESSAGES.fundUnavailable };
  }
  const methodOk =
    p.method === "either"
      ? config.cardEnabled || config.achEnabled
      : p.method === "card"
        ? config.cardEnabled
        : config.achEnabled;
  if (!methodOk) return { kind: "invalid", field: "method", message: GIVE_MESSAGES.methodUnavailable };
  const field: GiveField = "form";
  return { kind: "invalid", field, message: GIVE_MESSAGES.form };
}

/** The Checkout methods for an `existing` intent whose function row did not repeat them. */
async function methodsFor(slug: string, p: ParsedGive): Promise<Array<"card" | "bank">> {
  const config = await readPublicGivingConfig(slug);
  if (config.state !== "live") return [];
  const out: Array<"card" | "bank"> = [];
  if ((p.method === "card" || p.method === "either") && config.cardEnabled) out.push("card");
  if ((p.method === "bank" || p.method === "either") && config.achEnabled) out.push("bank");
  return out;
}

/**
 * Creates the intent, then (if it can) the Checkout session, and says what
 * happened. NEVER throws: every failure past this point is `error`, with the
 * intent row marked `failed` where it was ours to mark. `create` may be called
 * twice (once, and once more to settle a lost attach race); it is idempotent on
 * the form's key.
 */
export async function startGiveSession(args: {
  surface: GiveSurface;
  slug: string;
  parsed: ParsedGive;
  create: () => Promise<IntentRow>;
}): Promise<GiveResult> {
  const { surface, slug, parsed, create } = args;
  let intentId: string | null = null;
  try {
    const intent = await create();
    intentId = intent.intentId;

    switch (intent.outcome) {
      case "invalid":
        return await refineInvalid(slug, parsed);
      case "unavailable":
        return { kind: "unavailable" };
      case "rate_limited":
        return { kind: "rate_limited", retryAfterSeconds: FLOOD_RETRY_SECONDS };
      case "existing":
        // A repeat of a submit whose session is already attached: never mint a second one.
        if (intent.alreadyAttached) return { kind: "already_started" };
        break;
      case "created":
        break;
    }
    if (
      !intent.intentId ||
      !intent.externalAccountId ||
      intent.totalCents === null ||
      intent.coveredCents === null ||
      !intent.fundName
    ) {
      if (intent.intentId) await failIntent(intent.intentId);
      return { kind: "error" };
    }

    // Step 3: no key on this installation -> the attempt is recorded as failed, honestly "unavailable".
    if (!isStripeConfigured()) {
      await failIntent(intent.intentId);
      return { kind: "unavailable" };
    }
    // No safe public origin (production without an https NEXT_PUBLIC_APP_URL and no serving
    // custom host) -> same. The PUBLIC donor returns to the organization's serving custom host
    // when it has one (from the DATABASE, by slug); the member always returns to the platform.
    const target =
      surface === "public"
        ? await donorOrigin(slug)
        : (() => {
            const platform = givingOrigin();
            return platform ? { origin: platform, custom: false } : null;
          })();
    if (!target) {
      await failIntent(intent.intentId);
      return { kind: "unavailable" };
    }

    const methods = intent.methods ?? (await methodsFor(slug, parsed));
    if (methods.length === 0) {
      await failIntent(intent.intentId);
      return { kind: "unavailable" };
    }

    const { successUrl, cancelUrl } = checkoutReturnUrls(target.origin, slug, surface, target.custom);
    let session: { sessionId: string; url: string };
    try {
      session = await createCheckoutSession({
        accountId: intent.externalAccountId,
        mode: parsed.frequency === "monthly" ? "subscription" : "payment",
        // The DATABASE's figures, never the form's.
        totalCents: intent.totalCents,
        coveredFeeCents: intent.coveredCents,
        fundDisplayName: intent.fundName,
        methods,
        intentId: intent.intentId,
        successUrl,
        cancelUrl,
        expiresAt: checkoutExpiresAt(),
        idempotencyKey: `giving-session:${intent.intentId}`,
      });
    } catch (err) {
      console.error("[giving/give] checkout failed", {
        intentId: intent.intentId,
        code: err instanceof ProviderError ? err.code : "unexpected",
      });
      await failIntent(intent.intentId);
      return { kind: "error" };
    }

    if (await attachSession(intent.intentId, session.sessionId)) {
      return { kind: "checkout", url: session.url };
    }

    // attach refused: either a concurrent submit of the same key attached the (identical,
    // Stripe-idempotent) session first, or the intent is no longer `created` (failed / expired /
    // older than 15 minutes). Ask again; only the first case may hand out the URL.
    const settled = await create();
    if (settled.outcome === "existing" && settled.alreadyAttached) {
      return { kind: "checkout", url: session.url };
    }
    await failIntent(intent.intentId);
    return { kind: "error" };
  } catch (err) {
    console.error("[giving/give] start failed", {
      intentId,
      surface,
      code: err instanceof ProviderError ? err.code : "unexpected",
    });
    return { kind: "error" };
  }
}

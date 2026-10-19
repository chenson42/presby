import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "./db-util";
import { isSlugShaped } from "./give-input";
import type { FeeRates } from "./money";

/**
 * The two reads the give pages make, both on the anonymous `db` connection with
 * NO org context and NO session - docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Public surface actions" and Batch 4a's "Contract for 4b".
 *
 *   readPublicGivingConfig(slug)        -> presby_public_giving_config(slug)
 *   readReturnState(slug, sessionId)    -> presby_giving_return_state(slug, session)
 *
 * Both are SECURITY DEFINER functions that ALWAYS return exactly one row and
 * never an `acct_` id or an organization id. Each reader is ONE try/catch:
 * a database failure is logged with ids only (the slug and a fixed stage, never
 * a row, a name or a session id) and collapses to the neutral answer the page
 * already renders for a miss. Neither function throws.
 *
 * The two answers are deliberately hard to tell apart from a miss:
 *   - config `absent` is byte-identical for an unknown slug, a non-tenant slug,
 *     and an organization with no live published site (the database guarantees
 *     it; the page must render the SAME markup for all three). A toggle-off or
 *     non-giving-type organization WITH a live site is `unavailable`, not
 *     `absent`: its site is public, so the answer leaks nothing, and the give
 *     page falls through to the site's own `/give` page when it has one;
 *   - return `unknown` is identical for an absent, foreign-organization or
 *     malformed session id (and this module never touches the database for a
 *     malformed one).
 * The page must never vary copy, status code or timing between the cases.
 */

// ---------------------------------------------------------------------------
// the give page's inputs
// ---------------------------------------------------------------------------

export interface PublicGivingFund {
  id: string;
  /** The fund's online display name (the donor-facing text). */
  name: string;
}

export type PublicGivingConfig =
  /** No such organization, or nothing to say about one (unknown slug, non-tenant, toggle-off): render the neutral not-found state. */
  | { state: "absent" }
  /** The site is live but giving is not: show the name and the church's public phone, never the form. */
  | { state: "unavailable"; organizationName: string; contactPhone: string | null }
  /** The form's inputs. */
  | {
      state: "live";
      organizationName: string;
      /** False => a Stripe TEST-mode connection (gifts are practice only): show `<TestModeBadge>`. */
      livemode: boolean;
      contactPhone: string | null;
      /** Active, offered-online funds in display order; never empty when `live`. */
      funds: PublicGivingFund[];
      cardEnabled: boolean;
      achEnabled: boolean;
      /** The org's own fee rates, for the display-only "gift + fees = total" preview (`grossUp(amount, method, rates)`). */
      rates: FeeRates;
      /** Inclusive online bounds in cents (100 and 2,500,000). */
      minAmountCents: number;
      maxAmountCents: number;
    };

const ABSENT: PublicGivingConfig = { state: "absent" };

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function int(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

function arrayOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  // A driver that hands a Postgres array back as its text form ("{a,b}") is not
  // trusted to split it: refuse, and the page reads `absent`.
  return null;
}

/** Maps the function's one row to the union. Exported for the unit test. */
export function mapPublicConfigRow(row: Record<string, unknown> | undefined): PublicGivingConfig {
  if (!row) return ABSENT;
  if (row.state === "unavailable") {
    const organizationName = text(row.organization_name);
    return organizationName
      ? { state: "unavailable", organizationName, contactPhone: text(row.contact_phone) }
      : ABSENT;
  }
  if (row.state !== "live") return ABSENT;

  const organizationName = text(row.organization_name);
  const ids = arrayOf(row.fund_ids);
  const names = arrayOf(row.fund_names);
  const cardBps = int(row.card_fee_bps);
  const cardFixedCents = int(row.card_fee_fixed_cents);
  const achBps = int(row.ach_fee_bps);
  const achCapCents = int(row.ach_fee_cap_cents);
  const min = int(row.min_amount_cents);
  const max = int(row.max_amount_cents);
  if (
    !organizationName ||
    !ids ||
    !names ||
    ids.length === 0 ||
    ids.length !== names.length ||
    cardBps === null ||
    cardFixedCents === null ||
    achBps === null ||
    achCapCents === null ||
    min === null ||
    max === null ||
    typeof row.livemode !== "boolean"
  ) {
    return ABSENT;
  }
  const funds: PublicGivingFund[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = text(ids[i]);
    const name = text(names[i]);
    if (!id || !name) return ABSENT;
    funds.push({ id, name });
  }
  return {
    state: "live",
    organizationName,
    livemode: row.livemode,
    contactPhone: text(row.contact_phone),
    funds,
    cardEnabled: row.card_enabled === true,
    achEnabled: row.ach_enabled === true,
    rates: { cardBps, cardFixedCents, achBps, achCapCents },
    minAmountCents: min,
    maxAmountCents: max,
  };
}

/**
 * The give page and the `giving` live slot's one read. `live` -> `<GiveForm>`;
 * `unavailable` -> the notice; `absent` -> `notFound()` (page) or `null` (slot).
 * Never throws: a database failure is `absent`.
 */
export async function readPublicGivingConfig(slug: string): Promise<PublicGivingConfig> {
  if (!isSlugShaped(slug)) return ABSENT;
  try {
    const result = await db.execute(sql`select * from presby_public_giving_config(${slug}::text)`);
    return mapPublicConfigRow(rowsOf(result)[0]);
  } catch {
    console.error("[giving/public-config] read failed", { stage: "config", slug });
    return ABSENT;
  }
}

// ---------------------------------------------------------------------------
// the return page's input
// ---------------------------------------------------------------------------

/**
 * The five panels the return page renders, plus `error` (a database failure:
 * "we can't load this right now - your gift is not affected", never a guess).
 *
 *   unknown       the session id is absent, malformed, or another organization's
 *   confirming    we have the intent but not the gift yet (the webhook is on its way): <ReturnPoller>
 *   received      a succeeded gift, or a monthly gift whose subscription exists
 *   bank_pending  a bank (ACH) gift Stripe has accepted but not yet collected
 *   failed        the gift failed, or the checkout expired
 *
 * Every non-`unknown` arm carries the donor-visible facts and nothing else: no
 * name, email, address, id, or Stripe object. `coveredCents` is the part of the
 * charge that was the donor covering fees (total = giftAmountCents + coveredCents).
 */
export type ReturnState =
  | { state: "unknown" }
  | { state: "error" }
  | {
      state: "confirming" | "received" | "bank_pending" | "failed";
      giftAmountCents: number;
      coveredCents: number;
      fundName: string;
      frequency: "once" | "monthly";
      /** False => test mode (practice gift): show `<TestModeBadge>`. */
      livemode: boolean;
    };

const UNKNOWN: ReturnState = { state: "unknown" };
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,255}$/;

/** Maps the function's one row to the union. Exported for the unit test. */
export function mapReturnStateRow(row: Record<string, unknown> | undefined): ReturnState {
  if (!row) return UNKNOWN;
  const state = row.state;
  if (state !== "confirming" && state !== "received" && state !== "bank_pending" && state !== "failed") {
    return UNKNOWN;
  }
  const giftAmountCents = int(row.gift_amount_cents);
  const coveredCents = int(row.covered_cents);
  const fundName = text(row.fund_name);
  const frequency = row.frequency;
  if (
    giftAmountCents === null ||
    coveredCents === null ||
    !fundName ||
    (frequency !== "once" && frequency !== "monthly") ||
    typeof row.livemode !== "boolean"
  ) {
    return UNKNOWN;
  }
  return { state, giftAmountCents, coveredCents, fundName, frequency, livemode: row.livemode };
}

/**
 * The return page's one read: presby's OWN rows for the Checkout session id in
 * the URL. The URL proves nothing and decides nothing - no query parameter marks
 * a gift paid; this reads what the webhook recorded. A malformed id or slug
 * answers `unknown` without touching the database.
 */
export async function readReturnState(slug: string, sessionId: string): Promise<ReturnState> {
  if (!isSlugShaped(slug) || typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return UNKNOWN;
  try {
    const result = await db.execute(
      sql`select * from presby_giving_return_state(${slug}::text, ${sessionId}::text)`,
    );
    return mapReturnStateRow(rowsOf(result)[0]);
  } catch {
    console.error("[giving/public-config] read failed", { stage: "return_state", slug });
    return { state: "error" };
  }
}

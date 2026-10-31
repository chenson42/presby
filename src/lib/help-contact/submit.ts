import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isDirectPlatformActionRequest } from "@/lib/domains/action-host";
import { consumeRateLimit, recordRateLimitBlock } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/request-ip";
import { verifyTurnstile } from "@/lib/turnstile";
import { isHelpContactConfigured } from "./configured";
import { HELP_CONTACT_FIELDS as FIELDS, type HelpContactOutcome } from "./contract";
import { notifyOperatorsOfContactMessage } from "./notify";
import { validateHelpContact } from "./validate";

/**
 * The one entry point of the anonymous contact form (Phase 3 "API Contract",
 * CA2 order, DECISION-300 to 303). `actions.ts` is a thin `"use server"` wrapper
 * around `submitHelpContact`.
 *
 * ORDER OF CHECKS (CA2, binding). Each step returns before the next spends
 * anything:
 *   1. the platform host (CA7): a custom host gets `unavailable` with no limiter
 *      and no database;
 *   2. configured (CA6): the same pure check the page ran at build;
 *   3. the honeypot: a silent fake `sent` that spends nothing;
 *   4. validation (CA12), BEFORE Turnstile, so a field error does not burn the
 *      single-use token;
 *   5. the per-IP limit, only when a usable IP exists (CA8);
 *   6. Turnstile;
 *   7. the global ceiling, AFTER Turnstile, so a flood without tokens never
 *      spends the honest senders' budget;
 *   8. the definer, which holds the database ceiling and the notification claim.
 *
 * NEVER READS A SESSION. A signed-in sender is anonymous here. Nothing about the
 * typed name, email, congregation or message is used as a limiter key, a log
 * field or an audit field.
 *
 * AF-2: `getRequestIp` trusts `cf-connecting-ip`, which Vercel is not documented
 * to strip, so the IP is client-influenced. It is used only if IP-shaped, the
 * per-IP limit is a courtesy, and the bound is Turnstile plus the global ceiling
 * plus the database ceiling.
 *
 * READ COMMITTED (Batch 1 note 2): the definer's coalescing is exact only when
 * each call is its own statement or a default transaction, which is how
 * `db.execute` runs it. Never call it inside a REPEATABLE READ transaction.
 */

export const HELP_CONTACT_LIMITS_PER_IP = { max: 3, windowSeconds: 3600 } as const;
export const HELP_CONTACT_GLOBAL_HOUR = { max: 30, windowSeconds: 3600 } as const;
export const HELP_CONTACT_GLOBAL_DAY = { max: 100, windowSeconds: 86_400 } as const;
/** At most one refusal audit row per kind per window. */
const AUDIT_GATE = { max: 1, windowSeconds: 3600 } as const;

const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/** `null` unless the value is IP-shaped: a spoofed header can never inject text into a limiter key. */
export function usableIp(value: string | null): string | null {
  return value !== null && IP_SHAPE.test(value) ? value : null;
}

type Kind = "ip" | "global" | "ceiling";

/**
 * At most one RATE_LIMIT_BLOCKED row per kind per hour (CA5, DECISION-302). The
 * audit keys carry no IP and no typed text; the gate is itself a limiter key.
 * Never throws, never delays the response past the gate read.
 */
async function auditRefusal(kind: Kind, retryAfterSeconds: number): Promise<void> {
  try {
    const gate = await consumeRateLimit(`help_contact:audit:${kind}`, AUDIT_GATE);
    if (gate.allowed) {
      recordRateLimitBlock(
        `help_contact:${kind}`,
        { userId: null, actor: "anonymous", reason: "help_contact_form" },
        retryAfterSeconds,
      );
    }
  } catch {
    // The audit is best effort; the refusal stands.
  }
}

/** The SQLSTATE of a driver error, which Drizzle wraps in `.cause`. */
function sqlState(err: unknown): string | null {
  for (let cur: unknown = err, depth = 0; cur && depth < 6; depth += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

function errorClass(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows ?? []) as Record<string, unknown>[];
}

const stringField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function submitHelpContact(
  formData: FormData,
  hdrs: { get(name: string): string | null },
): Promise<HelpContactOutcome> {
  // 1. A DIRECT request on a platform host (CA7 as amended, DECISION-313): `Host`, read through
  //    requestHost() (R3), is a platform host AND `x-action-forwarded` is absent. On a church's own host
  //    Next forwards the action to its owner with the server's own `Host`, so `Host` alone is not
  //    enough. An absent or unparsable Host, an IP literal in a production deployment, every church's
  //    custom domain and every forwarded action are refused alike. `x-forwarded-host` is never read.
  if (!isDirectPlatformActionRequest(hdrs)) return { kind: "unavailable" };

  // 2. Configured.
  if (!isHelpContactConfigured(process.env)) return { kind: "unavailable" };

  // A crafted call may pass anything as the argument; only a FormData is a form.
  if (!(formData instanceof FormData)) return { kind: "not_sent" };

  try {
    // 3. The honeypot.
    if (stringField(formData, FIELDS.honeypot).trim() !== "") return { kind: "sent" };

    // 4. Validation, before Turnstile.
    const checked = validateHelpContact({
      topic: stringField(formData, FIELDS.topic),
      name: stringField(formData, FIELDS.name),
      email: stringField(formData, FIELDS.email),
      congregation: stringField(formData, FIELDS.congregation),
      message: stringField(formData, FIELDS.message),
    });
    if (!checked.ok) return { kind: "invalid", fieldErrors: checked.fieldErrors };
    const input = checked.value;

    // 5. The per-IP limit, only for a usable IP (CA8): no IP is no shared "unknown" bucket.
    const ip = usableIp(getRequestIp(hdrs as Headers));
    if (ip !== null) {
      const perIp = await consumeRateLimit(`help_contact:ip:${ip}`, HELP_CONTACT_LIMITS_PER_IP);
      if (!perIp.allowed) {
        await auditRefusal("ip", perIp.retryAfterSeconds);
        return { kind: "busy" };
      }
    }

    // 6. Turnstile (fail-open on a Cloudflare outage is DECISION-026, bounded by 7 and 8).
    if (!(await verifyTurnstile(stringField(formData, FIELDS.turnstileToken) || null, ip))) {
      return { kind: "check_failed" };
    }

    // 7. The global ceiling, after Turnstile.
    for (const window of [HELP_CONTACT_GLOBAL_HOUR, HELP_CONTACT_GLOBAL_DAY]) {
      const global = await consumeRateLimit(`help_contact:global:${window.windowSeconds}`, window);
      if (!global.allowed) {
        await auditRefusal("global", global.retryAfterSeconds);
        return { kind: "busy" };
      }
    }

    // 8. The definer: ceiling, storage and the notification claim in one function.
    const result = await db.execute(sql`
      select presby_submit_help_contact(
        ${input.topic}::text, ${input.name}::text, ${input.email}::text,
        ${input.congregation}::text, ${input.message}::text) as outcome`);
    const outcome = rowsOf(result)[0]?.outcome;

    if (outcome === "ceiling") {
      await auditRefusal("ceiling", HELP_CONTACT_GLOBAL_HOUR.windowSeconds);
      return { kind: "busy" };
    }
    if (outcome === "stored_notify") {
      // Never fails the submission: the message is already committed. notify.ts swallows its
      // own failures; this is the belt for a future change that lets one escape.
      try {
        await notifyOperatorsOfContactMessage();
      } catch (err) {
        console.error("[help-contact] notification step failed", { errorClass: errorClass(err) });
      }
      return { kind: "sent" };
    }
    if (outcome === "stored") return { kind: "sent" };
    return { kind: "not_sent" };
  } catch (err) {
    // EXECUTE revoked from presby_app is the operator's immediate switch (CA6, lever A).
    if (sqlState(err) === "42501") return { kind: "unavailable" };
    // The class only: never the message, which can carry what the visitor typed.
    console.error("[help-contact] not sent", { errorClass: errorClass(err), sqlState: sqlState(err) });
    return { kind: "not_sent" };
  }
}

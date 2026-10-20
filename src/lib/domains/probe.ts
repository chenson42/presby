import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * probe.ts - the "is this host really routed to this deployment?" handshake
 * (Phase 3 T1; architect suggestion 1 and addendum T1; DECISION-178).
 *
 * "Live" has a definition (G13): the proof is valid, the routing is correct,
 * AND a request to the host over HTTPS came back from THIS deployment. The
 * sweeper sends `x-presby-probe: <nonce>.<mac>`; the proxy (Batch 1c), as the
 * first thing it does for a non-platform host, answers a header that verifies
 * for that exact host with a 204 carrying `x-presby-probe-ack: <ack>`. Nothing
 * else about the response depends on the database, a tenant, or the path.
 *
 * WHY IT IS SAFE TO ANSWER. The responder reveals one fact - "this host routes
 * to this deployment" - and only to a caller holding a MAC for that exact host
 * and nonce, which only a holder of the server's secret can compute. It reads
 * no tenant row and sets no cookie. WHY THE ACK CANNOT BE REPLAYED. The ack is
 * `HMAC(key, "ack" + host + nonce)`: bound to the host AND to the sweeper's
 * fresh random nonce, so an ack observed for one probe (or one host) proves
 * nothing for another.
 *
 * KEY. `HMAC-SHA256(AUTH_SECRET, "presby-domain-probe")`, derived at call time
 * (no new secret to manage, and rotating AUTH_SECRET rotates it). A missing or
 * empty AUTH_SECRET throws: a probe built with a guessable key would be a
 * forgeable "live".
 *
 * PROXY-SAFE: `node:crypto` only (src/proxy.ts may import this file and
 * nothing else from src/lib/domains except host.ts and cron-passthrough.ts;
 * check:proxy-imports, Batch 1c). The proxy-side `answerProbe` ships here with
 * the sweeper-side `makeProbe` so the two halves are tested against each other
 * in one place; wiring it into the proxy is Batch 1c.
 */

export const PROBE_REQUEST_HEADER = "x-presby-probe";
export const PROBE_ACK_HEADER = "x-presby-probe-ack";

const NONCE_RE = /^[0-9a-f]{32}$/;
const KEY_LABEL = "presby-domain-probe";

function probeKey(secret: string | undefined): Buffer {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("probe: AUTH_SECRET is not set");
  }
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/** `kind` separates the request MAC from the ack so one can never stand in for the other; the newlines make the fields unambiguous. */
function mac(key: Buffer, kind: "req" | "ack", host: string, nonce: string): string {
  return createHmac("sha256", key).update(`${kind}\n${host}\n${nonce}`).digest("base64url");
}

/** Constant-time string equality (length is not secret here, so an early length mismatch is fine). */
export function ackMatches(expected: string, got: string | null | undefined): boolean {
  if (typeof got !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Probe {
  /** The `x-presby-probe` request header value: `<nonce>.<mac>`. */
  header: string;
  /** The `x-presby-probe-ack` value a deployment that holds the secret returns for exactly this probe. */
  expectedAck: string;
}

/** Sweeper side: a fresh probe for `host`. Throws if AUTH_SECRET is unset. */
export function makeProbe(host: string, secret: string | undefined = process.env.AUTH_SECRET): Probe {
  const key = probeKey(secret);
  const nonce = randomBytes(16).toString("hex");
  return {
    header: `${nonce}.${mac(key, "req", host, nonce)}`,
    expectedAck: mac(key, "ack", host, nonce),
  };
}

/**
 * Proxy side: the ack for `headerValue` if it is a valid probe for exactly
 * `host`, else `null`. Never throws on hostile input (a malformed header, a
 * wrong host and a missing secret are all `null`).
 */
export function answerProbe(
  host: string,
  headerValue: string | null | undefined,
  secret: string | undefined = process.env.AUTH_SECRET,
): string | null {
  if (typeof headerValue !== "string") return null;
  const dot = headerValue.indexOf(".");
  if (dot !== 32) return null;
  const nonce = headerValue.slice(0, dot);
  const given = headerValue.slice(dot + 1);
  if (!NONCE_RE.test(nonce)) return null;

  let key: Buffer;
  try {
    key = probeKey(secret);
  } catch {
    return null;
  }
  if (!ackMatches(mac(key, "req", host, nonce), given)) return null;
  return mac(key, "ack", host, nonce);
}

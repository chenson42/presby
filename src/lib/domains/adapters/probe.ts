import "server-only";
import { ackMatches, makeProbe, PROBE_ACK_HEADER, PROBE_REQUEST_HEADER } from "../probe";
import type { DnsObserver } from "./dns";
import { isNonPublicAddress } from "./cloudflare-ranges";

/**
 * adapters/probe.ts - the sweeper's side of the live-ness probe (Phase 3 T1,
 * G13; the HMAC handshake itself is ../probe.ts, and the proxy's answering half
 * arrives with Batch 1c).
 *
 * THREE OUTCOMES, AND ONLY ONE OF THEM IS EVIDENCE OF A LOSS.
 *
 *   ack       the host answered over HTTPS and returned the ack that only a
 *             deployment holding our secret can compute for THIS probe: the
 *             host routes to this deployment.
 *   negative  something answered (or DNS says nothing routes anywhere) and it
 *             was not us: an HTTP response with no or a wrong ack, a name that
 *             resolves to no address, or one that resolves to an address we
 *             refuse to connect to. This is the only outcome that counts toward
 *             `live -> attached` (policy: 2 consecutive scheduled, 1 forced).
 *   unknown   we could not find out: a timeout, a connection or TLS failure, a
 *             resolver that did not answer, no AUTH_SECRET. It never counts
 *             either way (G9: an outage on our side or in the middle is not a
 *             verdict on the church's site).
 *
 * THE REQUEST. One `GET https://<host>/` carrying the probe header; redirects
 * are NOT followed (`redirect: "manual"`: a 3xx is an answer, and following it
 * would let a church-controlled host steer us to a third party); the body is
 * never read (`cancel()`), nothing is returned but the enum, and the response
 * is never logged.
 *
 * SSRF. The host is a church-controlled name and this is an outbound request
 * from our infrastructure, so before connecting it resolves A and AAAA through
 * the DoH quorum and refuses to connect if ANY answer is a loopback, private,
 * link-local, multicast or reserved address (the probe then reports `negative`:
 * a name that points inside a network does not route to us). The ack makes a
 * successful probe unforgeable and the enum makes the response unreadable, so
 * what remains is the DNS-rebinding window between our lookup and `fetch`'s own
 * - named in the work-log; Vercel's runtime has no private network to reach.
 */

export type ProbeOutcome = "ack" | "negative" | "unknown";

export interface ProbeClient {
  probe(host: string): Promise<ProbeOutcome>;
}

const HOST_SHAPE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface HttpsProbeOptions {
  dns: DnsObserver;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** AUTH_SECRET override for tests; defaults to the environment. */
  secret?: string;
}

export class HttpsProbe implements ProbeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpsProbeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async probe(host: string): Promise<ProbeOutcome> {
    if (!HOST_SHAPE.test(host)) return "negative";

    let probe;
    try {
      probe = makeProbe(host, this.options.secret ?? process.env.AUTH_SECRET);
    } catch {
      return "unknown";
    }

    // SSRF pre-check: where would this name take us?
    const [a, aaaa] = await Promise.all([
      this.options.dns.lookup(host, "A"),
      this.options.dns.lookup(host, "AAAA"),
    ]);
    const addresses = [...a.records, ...aaaa.records].map((r) => r.data);
    if (addresses.some(isNonPublicAddress)) return "negative";
    if (addresses.length === 0) {
      // Nothing resolves. A definitive "no address" from both resolvers is a
      // verdict; anything less is not.
      return a.kind === "absent" && aaaa.kind === "absent" ? "negative" : "unknown";
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`https://${host}/`, {
        method: "GET",
        headers: { [PROBE_REQUEST_HEADER]: probe.header },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return "unknown";
    }
    const ack = response.headers.get(PROBE_ACK_HEADER);
    try {
      await response.body?.cancel();
    } catch {
      /* the body was never wanted */
    }
    return ackMatches(probe.expectedAck, ack) ? "ack" : "negative";
  }
}

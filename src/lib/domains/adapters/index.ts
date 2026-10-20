import "server-only";
import { createDohObserver, type DnsObserver } from "./dns";
import { createFakeDns, fileStateReader } from "./fake";

/**
 * Provider selection (Phase 2 R7). Explicit configuration, never a feature
 * flag, and never inferred from a request.
 *
 *   DOMAINS_DNS_PROVIDER   unset | "doh"   the two-resolver DoH quorum (default)
 *                          "fake"          the file-driven fake, NON-PRODUCTION only
 *
 * `fake` outside production reads `DOMAINS_FAKE_STATE_FILE` on every query. In
 * production it is ignored and the real observer is used (the production build
 * assertion refuses the variable outright, so reaching that branch means the
 * assertion was bypassed, and failing safe to the real resolvers is correct).
 *
 * The hosting provider (`DOMAINS_PROVIDER`: unset = unconfigured, `vercel`,
 * `fake`) arrives with the Vercel adapter in Batch 1b, on this same seam.
 */
export interface Adapters {
  dns: DnsObserver;
}

let doh: DnsObserver | null = null;

export function getAdapters(env: Readonly<Record<string, string | undefined>> = process.env): Adapters {
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  if (env.DOMAINS_DNS_PROVIDER === "fake" && !production) {
    return { dns: createFakeDns(fileStateReader()).observer };
  }
  doh ??= createDohObserver();
  return { dns: doh };
}

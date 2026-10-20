import "server-only";
import { createDohObserver, type DnsObserver } from "./dns";
import { createFakeDns, FakeHosting, FakeProbe, fileStateReader } from "./fake";
import { MisconfiguredHosting, UnconfiguredHosting, type HostingProvider } from "./hosting";
import { HttpsProbe, type ProbeClient } from "./probe";
import { VercelHosting } from "./vercel";

/**
 * Provider selection (Phase 2 R7). Explicit configuration, never a feature
 * flag, and never inferred from a request.
 *
 *   DOMAINS_DNS_PROVIDER   unset | "doh"   the two-resolver DoH quorum (default)
 *                          "fake"          the file-driven fake, NON-PRODUCTION only
 *
 *   DOMAINS_PROVIDER       unset | other   UNCONFIGURED: every hosting call answers
 *                                          "unavailable", so the lifecycle waits
 *                                          honestly ("Connecting is temporarily
 *                                          unavailable") instead of pretending
 *                          "vercel"        the Vercel REST adapter. Honoured only
 *                                          when `VERCEL_ENV` is unset or "production"
 *                                          (a Preview deployment must never be able
 *                                          to attach production domains with the
 *                                          shared token) and never under
 *                                          `NODE_ENV=test` (a test must not reach
 *                                          the real API however .env.local reads).
 *                                          Needs VERCEL_API_TOKEN and VERCEL_PROJECT_ID
 *                                          (VERCEL_TEAM_ID optional): missing either
 *                                          is a CONFIG ERROR the operator is alerted
 *                                          to, not "unconfigured".
 *                          "fake"          the in-memory fake hosting provider and
 *                                          probe, NON-PRODUCTION only
 *
 * `fake` in production is ignored and the unconfigured provider is used (the
 * production build assertion in host.ts refuses the variable outright, so
 * reaching that branch means the assertion was bypassed, and failing safe is
 * correct).
 */
export interface Adapters {
  dns: DnsObserver;
  hosting: HostingProvider;
  probe: ProbeClient;
}

type Env = Readonly<Record<string, string | undefined>>;

let doh: DnsObserver | null = null;
let fakeHosting: FakeHosting | null = null;
let fakeProbe: FakeProbe | null = null;

const isProduction = (env: Env) => env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

function resolveDns(env: Env): DnsObserver {
  if (env.DOMAINS_DNS_PROVIDER === "fake" && !isProduction(env)) {
    return createFakeDns(fileStateReader()).observer;
  }
  doh ??= createDohObserver();
  return doh;
}

function resolveHosting(env: Env): HostingProvider {
  switch (env.DOMAINS_PROVIDER) {
    case "vercel": {
      const previewOrTest = (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "production") || env.NODE_ENV === "test";
      if (previewOrTest) return new UnconfiguredHosting();
      if (!env.VERCEL_API_TOKEN) return new MisconfiguredHosting("token_invalid");
      if (!env.VERCEL_PROJECT_ID) return new MisconfiguredHosting("project_missing");
      return new VercelHosting({
        token: env.VERCEL_API_TOKEN,
        projectId: env.VERCEL_PROJECT_ID,
        teamId: env.VERCEL_TEAM_ID || undefined,
      });
    }
    case "fake":
      if (isProduction(env)) return new UnconfiguredHosting();
      fakeHosting ??= new FakeHosting(fileStateReader());
      return fakeHosting;
    default:
      return new UnconfiguredHosting();
  }
}

function resolveProbe(env: Env, dns: DnsObserver): ProbeClient {
  if (env.DOMAINS_PROVIDER === "fake" && !isProduction(env)) {
    fakeProbe ??= new FakeProbe(fileStateReader());
    return fakeProbe;
  }
  return new HttpsProbe({ dns });
}

/**
 * `overrides` lets a caller (the service, a test) supply any adapter it already
 * has. The probe is built on whichever DNS observer ends up in force, so a test
 * that injects a fake resolver can never have its probe fall back to the real
 * DoH quorum.
 */
export function getAdapters(env: Env = process.env, overrides: Partial<Adapters> = {}): Adapters {
  const dns = overrides.dns ?? resolveDns(env);
  return {
    dns,
    hosting: overrides.hosting ?? resolveHosting(env),
    probe: overrides.probe ?? resolveProbe(env, dns),
  };
}

/** Test seam: drops the memoised fakes so a test starts from an empty provider. */
export function resetAdaptersForTests(): void {
  doh = null;
  fakeHosting = null;
  fakeProbe = null;
}

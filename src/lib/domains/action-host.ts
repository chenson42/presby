import { isPlatformHost, requestHost } from "./host";

/**
 * Whether a Server Action request arrived DIRECTLY on a platform host (DECISION-313, the CA7
 * ruling of docs/work-log/2026-10-31-help-contact.md, Batch 3).
 *
 * WHY `requestHost()` ALONE IS NOT ENOUGH FOR AN ACTION. On a church's own host the proxy rewrites
 * a Server Action POST into the `/site/<host>/...` tree, where the action's id is not registered, so
 * Next FORWARDS the action to the worker that owns it with an internal fetch. That fetch carries the
 * server's OWN `Host` (a platform host) and adds `x-action-forwarded`
 * (`next/dist/server/app-render/action-handler.js`, `createForwardedActionResponse`); the client's
 * host survives only in `x-forwarded-host`. So the action sees a platform `Host` and runs. Measured
 * on a dev server and on `next build && next start`: a replay with `Host: church-one.invalid`
 * returned `{"kind":"sent"}` and wrote a row.
 *
 * THE RULE: an action is direct on a platform host when `Host` is a platform host (via
 * `requestHost()`, R3: it reads `host` and nothing else) AND `x-action-forwarded` is ABSENT. A
 * forwarded action is refused whatever its `Host` says, because a forward is exactly how a custom
 * host's action arrives dressed as a platform one.
 *
 * NEVER READ `x-forwarded-host` HERE. When Next is self-hosted it does `??=` on that header, so a
 * client can supply it; it is a spoofable input and R3 says no decision rests on it. (This function
 * only ever DENIES on the forwarded marker, so a client that fakes `x-action-forwarded` can only
 * refuse itself.)
 *
 * The marker is a Next-internal name. `action-host.test.ts` reads Next's own source and fails the
 * build when an upgrade renames it, so the refusal cannot go quiet unnoticed.
 *
 * PURE and dependency-free except `./host`: no `server-only`, no `next/*`. It is NOT imported by
 * `src/proxy.ts` (the proxy's allow-list is host.ts, probe.ts and cron-passthrough.ts); the one
 * caller is `src/lib/help-contact/submit.ts`. Any future anonymous Server Action on the platform
 * wants the same call; that is a separate pipeline, not this one.
 */

/** The header Next's action forwarder adds. Present, with any value, means "this was forwarded". */
export const NEXT_ACTION_FORWARDED_HEADER = "x-action-forwarded";

export function isDirectPlatformActionRequest(
  headers: { get(name: string): string | null },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (headers.get(NEXT_ACTION_FORWARDED_HEADER) !== null) return false;
  const host = requestHost(headers, env);
  if (host === null) return false;
  return isPlatformHost(host, env);
}

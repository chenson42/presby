import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

/**
 * Two connections, deliberately.
 *
 *   db          presby_app.       RLS ENFORCED, ALWAYS. Every tenant-facing
 *                                 route. The role is created NOBYPASSRLS and
 *                                 must stay that way.
 *   platformDb  neondb_owner      Bypasses RLS. Platform admin pages only.
 *               (via PLATFORM_DATABASE_URL).
 *
 * CORRECTED 2026-09-25 (B-I3 / DECISION-146): this comment used to name
 * `presby_platform` as the second connection's role. It never was.
 * `presby_platform` exists in the catalog and holds grants on 83 tables, but
 * it is `rolcanlogin = false` (measured) and nothing has ever connected as
 * it; `PLATFORM_DATABASE_URL` authenticates as `neondb_owner`. This matters
 * beyond tidiness: `neondb_owner` OWNS every table, so it holds every
 * privilege by ownership independent of any grant or revoke, and it is
 * `rolbypassrls = true`. Reasoning of the shape "X cannot happen on this
 * connection because the grant forbids it" is false here (F44) — only a
 * trigger binds this path. The same wrong role name was also fixed in
 * scripts/seed.ts.
 *
 * This is the boundary that survives application bugs. `users.is_platform_admin`
 * decides which PAGES are reachable; it does not decide whether a query is
 * filtered. If a single connection could see everything and a boolean chose
 * whether to add the filter, tenant isolation would be an application property,
 * and every query ever written would be a chance to leak.
 *
 * WHY THE WEBSOCKET POOL AND NOT neon-http:
 *
 * RLS here is driven by a transaction-scoped GUC (`app.current_org_id`). The
 * neon-http driver has no session and no transaction support at all — measured,
 * not assumed: `set_config(..., true)` in one HTTP request is gone by the next,
 * and `db.transaction()` throws "No transactions support in neon-http driver".
 * Over HTTP every tenant query would run with no org context and return zero
 * rows, so the isolation model dictates the driver.
 *
 * The pool is verified not to leak context: after a transaction commits, a
 * subsequent query on the same pooled connection sees no org and returns
 * nothing. That matters more than it sounds — a GUC that outlived its
 * transaction would hand the next request the previous tenant's context.
 */

neonConfig.webSocketConstructor = ws;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

const appPool = new Pool({ connectionString: required("DATABASE_URL") });

/**
 * The tenant connection. Reads and writes are filtered by RLS, and with no org
 * context set they return NOTHING — fail-closed by construction.
 *
 * Do not query tenant tables through this directly. Use `withOrgContext()` from
 * `@/lib/authz`, which sets the context inside the transaction after verifying
 * the user actually belongs to that organization.
 */
export const db = drizzle(appPool, { schema });

/**
 * Platform connection. BYPASSES RLS — it sees every tenant.
 *
 * Only platform admin surfaces may import this, and it must never be reachable
 * from a tenant-facing route. Break-glass elevation (reason, time box,
 * tenant-visible access log) lands with the AI worker in Phase 5; until then the
 * discipline is simply that this import is rare and obvious in review.
 */
let platformPool: Pool | null = null;
export function getPlatformDb() {
  if (!platformPool) {
    platformPool = new Pool({
      connectionString: required("PLATFORM_DATABASE_URL"),
    });
  }
  return drizzle(platformPool, { schema });
}

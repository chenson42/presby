/**
 * custom-hosts.ts - the fixture world and request helpers for the custom-domain
 * e2e specs (e2e/custom-domains/, Track F; docs/work-log/2026-10-19-custom-domains.md,
 * Phase 3 "E2E approach").
 *
 * WHAT A REAL BROWSER CAN AND CANNOT DO HERE. `playwright.config.ts` maps
 * `*.invalid` to loopback for Chromium, so `http://church-one.invalid:<port>/` is
 * a real page load with that name in `Host`. The `request` fixture cannot be
 * mapped, but it can set `Host` explicitly (`rawGet` below), which is also how a
 * test LIES about its Host. `.invalid` is reserved (RFC 2606): No Real Data.
 *
 * THE WORLD (built in beforeAll by each spec; every row is the spec's own, removed
 * in afterAll and confirmed by SELECT):
 *
 *   ONE   a throwaway congregation from giving-fixture (so the give page and its
 *         return panels can be exercised too) with a LIVE site; canonical host
 *         `www.church-one.invalid`, alias `church-one.invalid`, both `live`.
 *   TWO   a second, lighter congregation with its own bundle and ONE canonical
 *         host `church-two.invalid`, `live` - the "wrong org" and isolation target.
 *   WALK  a third congregation whose single canonical host `walk.invalid` is walked
 *         through the legal lifecycle edges one request at a time, so every
 *         non-serving state is observed against the same host and compared with
 *         the baseline taken before any row exists.
 *
 * Domain rows are arranged with raw owner SQL by WALKING LEGAL EDGES (the
 * 0057 trigger binds the owner connection too), exactly as the DB-backed suites do.
 * Rows are never deleted by name: the organizations are fixture orgs
 * (`deletable_until`), and deleting an organization is the one thing the domain
 * delete guard allows.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { backdateDomainClockHttp } from "./domains-fixture";
import { E2E_USERS } from "./users";

// ---------------------------------------------------------------------------
// hosts and names
// ---------------------------------------------------------------------------

export const HOSTS = {
  oneCanonical: "www.church-one.invalid",
  oneAlias: "church-one.invalid",
  two: "church-two.invalid",
  walk: "walk.invalid",
  /** Never has a row anywhere. */
  unknown: "nobody-home.invalid",
  /** A claimed-then-expired name. */
  expired: "expired-claim.invalid",
} as const;

export const TITLES = {
  one: "Church One Home Page",
  oneAbout: "About Church One",
  two: "Church Two Home Page",
  twoAbout: "About Church Two",
  walk: "Walk Church Home Page",
} as const;

export const ORG_NAMES = {
  two: "E2E Domains Church Two",
  walk: "E2E Domains Walk Church",
} as const;

/** Fixed, valid proof tokens (>= 32 URL-safe chars). The token is never a secret here: fakes only. */
const token = (n: number) => `e2e-domains-token-${String(n).padStart(2, "0")}-`.padEnd(40, "x");

// ---------------------------------------------------------------------------
// request helpers
// ---------------------------------------------------------------------------

/** The server's port, taken from the project's baseURL so dev (3000/3111) and the prod lane (3800) both work. */
export function portOf(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? "http://localhost:3000");
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

/** `http://<host>:<port>` for a mapped `*.invalid` name (browser navigation). */
export function originFor(host: string, baseURL: string | undefined): string {
  return `http://${host}:${portOf(baseURL)}`;
}

/**
 * HARNESS RESILIENCE, NAMED HONESTLY. The server under test reads the database on every public request
 * (the render flag, then one definer call), and the Neon WebSocket pool occasionally hands a request a
 * half-open connection: the query then stalls for the TCP timeout (~15 minutes) instead of failing. Four
 * earlier pipelines recorded the same family ("Connection terminated unexpectedly"). It is environmental
 * and not a defect in the code under test, but one stalled request used to fail a whole 30-request loop.
 * So every request here carries a 20 s timeout and is retried ONCE on a stall or a reset; the retry is a
 * fresh request on a fresh connection, and it is COUNTED and printed (`stalledRetries`) so a spec that
 * retries in every run is visible as the defect it would be. A second failure fails the test.
 */
export const stalledRetries: string[] = [];
const REQUEST_TIMEOUT_MS = 20_000;

async function withOneRetry(label: string, send: () => Promise<APIResponse>): Promise<APIResponse> {
  try {
    return await send();
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (!/timeout|ECONNRESET|socket hang up|EPIPE/i.test(message)) throw err;
    stalledRetries.push(label);
    console.warn(`[custom-hosts] request stalled or was reset, retrying once (#${stalledRetries.length}): ${label}`);
    return send();
  }
}

/** (The URL is built by concatenation: `new URL("//x", base)` would read a path like `//api/...` as a host.)
 * A request to the server at `baseURL` carrying an explicit `Host` (and any other headers, e.g. to lie). */
export async function rawGet(
  request: APIRequestContext,
  baseURL: string | undefined,
  host: string | null,
  path: string,
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  const url = `${new URL(baseURL ?? "http://localhost:3000").origin}${path}`;
  return withOneRetry(`GET ${host ?? "(no host)"} ${path}`, () =>
    request.get(url, {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { ...(host === null ? {} : { host: `${host}:${portOf(baseURL)}` }), ...headers },
    }),
  );
}

/**
 * A GET whose request-target is sent EXACTLY as given, with an explicit `Host`. Playwright's `request` (WHATWG
 * `URL` underneath) and a browser both collapse `.` / `..` segments before a byte leaves the client, so they
 * cannot test what a hostile client that does NOT normalize sends; `node:http` writes the string it is handed.
 * Returns the response in the `Snapshot` shape (`shape()`'s reduction: volatile headers dropped, the requested
 * host fixed, an HTML body reduced to what a visitor sees), plus the raw header bag for cookie checks.
 * Same 20 s timeout and single counted retry on a stall/reset as `rawGet`.
 */
export interface RawPathResponse extends Snapshot {
  rawHeaders: Record<string, string | string[] | undefined>;
}

export async function rawPathGet(
  baseURL: string | undefined,
  host: string,
  rawPath: string,
  headers: Record<string, string> = {},
): Promise<RawPathResponse> {
  const origin = new URL(baseURL ?? "http://localhost:3000");
  const once = () =>
    new Promise<RawPathResponse>((resolve, reject) => {
      const req = http.request(
        {
          hostname: origin.hostname,
          port: origin.port || 80,
          method: "GET",
          path: rawPath,
          headers: { host: `${host}:${portOf(baseURL)}`, "accept-encoding": "gzip", ...headers },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", reject);
          res.on("end", () => {
            const needle = new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
            const reduced: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (VOLATILE_HEADERS.has(k)) continue;
              const joined = Array.isArray(v) ? v.join(", ") : String(v ?? "");
              reduced[k] = k === "x-middleware-rewrite" ? "<rewrite>" : joined.replace(needle, "<host>");
            }
            const wire = Buffer.concat(chunks);
            // Ask for gzip as Playwright's client does, so the response header set matches a normal request's.
            const decoded = res.headers["content-encoding"] === "gzip" ? gunzipSync(wire) : wire;
            const text = maskPerRequest(decoded.toString("utf8")).replace(needle, "<host>");
            const looksHtml = (res.headers["content-type"] ?? "").includes("text/html");
            resolve({ status: res.statusCode ?? 0, headers: reduced, body: looksHtml ? visibleText(text) : text, rawHeaders: res.headers });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  try {
    return await once();
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (!/timeout|ECONNRESET|socket hang up|EPIPE/i.test(message)) throw err;
    stalledRetries.push(`GET(raw) ${host} ${rawPath}`);
    console.warn(`[custom-hosts] raw request stalled or was reset, retrying once (#${stalledRetries.length}): ${host} ${rawPath}`);
    return once();
  }
}

/** Same for a POST (webhooks, ingest, credentials). Not retried: a POST is not idempotent in general. */
export async function rawPost(
  request: APIRequestContext,
  baseURL: string | undefined,
  host: string,
  path: string,
  options: { headers?: Record<string, string>; data?: string } = {},
): Promise<APIResponse> {
  return request.post(`${new URL(baseURL ?? "http://localhost:3000").origin}${path}`, {
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { host: `${host}:${portOf(baseURL)}`, ...(options.headers ?? {}) },
    data: options.data,
  });
}

/**
 * Next stamps each response with a random request id (`__next_r`) and an `_rsc` token, and the DEV server
 * streams React debug-info rows whose count and ids depend on I/O timing. Masked so two renders of the
 * SAME page can be compared byte for byte (the same mask giving-public.spec.ts uses); every string the
 * page renders, and the whole document outside the Flight script, still has to match exactly.
 */
export function maskPerRequest(html: string): string {
  return html
    .replace(/__next_r="[^"]*"/g, "R")
    .replace(/_rsc=[A-Za-z0-9_-]+/g, "RSC")
    .replace(/(?:\\n[0-9a-f]+:D\\"\$[0-9a-f]+\\")+/g, () => "\\nD*")
    .replace(/\\n[0-9a-f]+:(?=null|\[|I\[)/g, () => "\\n#:")
    .replace(/\$L?[0-9a-f]{1,4}\b/g, () => "$#");
}

/** Headers that legitimately differ per response and carry no tenant information. */
const VOLATILE_HEADERS = new Set(["date", "etag", "x-nextjs-request-id", "x-request-id", "keep-alive", "connection", "content-length", "transfer-encoding"]);

export interface Snapshot {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * A response reduced to what must be byte-identical across non-serving states: status, masked body and every
 * header except the volatile ones.
 *
 * `host` is the name the request asked for. Next echoes the route params into the page (the segment value, i.e.
 * the host, appears in the streamed Flight payload and in the dev-only `x-middleware-rewrite` header), so the
 * requested host is replaced by a fixed token before comparing. That makes the comparison one between STATES,
 * not between names: it is the visitor's own Host header coming back, which tells them nothing they did not send.
 */
export async function snapshot(res: APIResponse, host: string): Promise<Snapshot> {
  const needle = new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers())) {
    if (VOLATILE_HEADERS.has(k)) continue;
    // The dev server also names the rewrite TARGET (host and path) in `x-middleware-rewrite`; a production
    // build does not send it. Either way it is the visitor's own request coming back, so it is fixed here.
    headers[k] = k === "x-middleware-rewrite" ? "<rewrite>" : v.replace(needle, "<host>");
  }
  return { status: res.status(), body: maskPerRequest(await res.text()).replace(needle, "<host>"), headers };
}

/**
 * What a visitor can SEE in an HTML response: title plus text, with scripts, templates (the dev server's error
 * stack lives in one) and tags removed. Next echoes the requested path into the streamed payload and, in dev, into
 * an error template, so two 404s for DIFFERENT paths are never byte-identical; the visible page and the headers are.
 */
export function visibleText(html: string): string {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<template[\s\S]*?<\/template>/g, " ")
    .replace(/<head[\s\S]*?<\/head>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${title} | ${body}`;
}

/** Like `snapshot`, but the body is compared as what a visitor sees (for responses to DIFFERENT paths). */
export async function shape(res: APIResponse, host: string): Promise<Snapshot> {
  const snap = await snapshot(res, host);
  const looksHtml = (res.headers()["content-type"] ?? "").includes("text/html");
  return { ...snap, body: looksHtml ? visibleText(snap.body) : snap.body };
}

// ---------------------------------------------------------------------------
// the world
// ---------------------------------------------------------------------------

export interface SiteOrg {
  orgId: string;
  slug: string;
  name: string;
  blobId: string;
}

export type WalkState =
  | "pending"
  | "verified"
  | "attach_pending"
  | "attached"
  | "live"
  | "lapsed"
  | "parked"
  | "release_pending"
  | "released";

/** The legal-edge paths to each state, from a fresh `pending` row. [to, release_cause?, force_release_reason?] */
const PATH: Record<WalkState, Array<[string, string?, string?]>> = {
  pending: [],
  verified: [["verified"]],
  attach_pending: [["verified"], ["attach_pending"]],
  attached: [["verified"], ["attach_pending"], ["attached"]],
  live: [["verified"], ["attach_pending"], ["attached"], ["live"]],
  lapsed: [["verified"], ["attach_pending"], ["attached"], ["live"], ["lapsed"]],
  parked: [["verified"], ["attach_pending"], ["attached"], ["live"], ["parked", "removed"]],
  release_pending: [["verified"], ["attach_pending"], ["attached"], ["live"], ["release_pending", "force_released", "Arranged by the e2e fixture."]],
  released: [["verified"], ["attach_pending"], ["attached"], ["live"], ["release_pending", "force_released", "Arranged by the e2e fixture."], ["released"]],
};

async function actingUserId(sql: Sql): Promise<string> {
  const rows = (await withDbRetry("acting user id", () => sql`select id from users where email = ${E2E_USERS["mfa-enrolled"].email}`)) as { id: string }[];
  if (!rows[0]) throw new Error("[custom-hosts] no mfa-enrolled user row; globalSetup must run first");
  return rows[0].id;
}

/**
 * The bundle a fixture site serves: a home page with the title as its hero, a contact form block (so the
 * form can be driven), an `/about` page, and an `/api/probe-me` is deliberately NOT a page (the platform
 * routes must 404 on a church's domain whatever the bundle holds).
 */
export function bundleFor(title: string, aboutTitle: string): { pages: unknown[] } {
  return {
    pages: [
      {
        path: "/",
        frontMatter: { title, navLabel: "Home" },
        mdxAst: {
          blocks: [
            { type: "hero", props: { heading: title } },
            { type: "prose", props: { body: `Welcome to ${title}.` } },
            { type: "contactForm", props: { heading: "Contact us" } },
          ],
        },
      },
      {
        path: "/about",
        frontMatter: { title: aboutTitle, navLabel: "About" },
        mdxAst: { blocks: [{ type: "hero", props: { heading: aboutTitle } }, { type: "prose", props: { body: aboutTitle } }] },
      },
    ],
  };
}

/** Inserts a bundle blob and returns its id. */
async function insertBundle(sql: Sql, orgId: string, bundle: { pages: unknown[] }): Promise<string> {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages: bundle.pages, imageKeys: {} }), "utf-8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const rows = (await sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${orgId}::uuid, ${hash}, 'application/json', ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'))
    returning id`) as { id: string }[];
  return rows[0]!.id;
}

/** Stores a tiny PNG as a blob and returns its id (for the asset route). */
export async function insertImage(sql: Sql, orgId: string): Promise<string> {
  // A 1x1 transparent PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const hash = createHash("sha256").update(png).digest("hex");
  const rows = (await sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${orgId}::uuid, ${hash}, 'image/png', ${png.byteLength}, decode(${png.toString("hex")}, 'hex'))
    returning id`) as { id: string }[];
  return rows[0]!.id;
}

/** A throwaway congregation (`deletable_until`), a live site with a bundle, and the domains toggle ON. */
export async function createSiteOrg(
  sql: Sql,
  o: { label: string; idx: number; name: string; bundle: { pages: unknown[] }; stamp: number; toggle?: boolean },
): Promise<SiteOrg> {
  const slug = `e2e-domains-${o.label}-${o.stamp}`;
  // Unique per run AND per org in the run: audit_events is append-only and keeps a run's rows forever.
  const orgId = `e2e93001-0000-4000-8000-${String((o.stamp % 100_000_000_000) * 10 + o.idx).padStart(12, "0")}`;
  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${o.name}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  const blobId = await insertBundle(sql, orgId, o.bundle);
  await sql`
    insert into organization_sites (organization_id, repo, status, content_bundle_key, last_ingested_at)
    values (${orgId}::uuid, ${`org/site-${slug}`}, 'live', ${blobId}::uuid, now())`;
  if (o.toggle !== false) await setDomainsToggle(sql, orgId, true);
  return { orgId, slug, name: o.name, blobId };
}

/** The `org_portal.domains` toggle row (the owner-only SQL predicate reads it). `null` removes the row. */
export async function setDomainsToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await withDbRetry("clear domains toggle", () => sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = 'org_portal.domains'`);
    return;
  }
  await withDbRetry("set domains toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, 'org_portal.domains', ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}`);
}

export async function setSiteStatus(sql: Sql, orgId: string, status: "provisioning" | "live" | "suspended"): Promise<void> {
  await withDbRetry("set site status", () => sql`update organization_sites set status = ${status} where organization_id = ${orgId}::uuid`);
}

export async function setOrgStatus(sql: Sql, orgId: string, status: "active" | "inactive"): Promise<void> {
  await withDbRetry("set org status", () => sql`update organizations set status = ${status} where id = ${orgId}::uuid`);
}

export async function setPublicRenderFlag(sql: Sql, enabled: boolean): Promise<void> {
  await withDbRetry("set public render flag", () => sql`update feature_flags set enabled = ${enabled} where key = 'sites.public_render'`);
}

export async function getPublicRenderFlag(sql: Sql): Promise<boolean> {
  const rows = (await withDbRetry("get public render flag", () => sql`select enabled from feature_flags where key = 'sites.public_render'`)) as { enabled: boolean }[];
  if (!rows[0]) throw new Error("[custom-hosts] no feature_flags row for sites.public_render");
  return rows[0].enabled;
}

/** Gives the org a brand (an invented maroon seed) so a custom host's brand cascade can be asserted. */
export async function setBrand(sql: Sql, orgId: string, seedHex: string): Promise<void> {
  const user = await actingUserId(sql);
  await withDbRetry("set brand", () => sql`
    insert into organization_brands (organization_id, seed_hex, type_pairing, brand_token_version, updated_by)
    values (${orgId}::uuid, ${seedHex}, 'classic', 1, ${user}::uuid)
    on conflict (organization_id) do update set seed_hex = ${seedHex}`);
}

export interface DomainRow {
  id: string;
  hostname: string;
}

/**
 * Inserts a `pending` web row (owner connection) and walks it along legal edges to `state`. `nextCheckInFuture`
 * keeps the 5-minute sweeper (the cron specs call it) from leasing the fixture's rows. Returns the row id.
 */
export async function addDomain(
  sql: Sql,
  o: { orgId: string; hostname: string; claimName?: string; role: "canonical" | "alias"; state: WalkState; token?: number },
): Promise<DomainRow> {
  const user = await actingUserId(sql);
  const claim = o.claimName ?? o.hostname;
  const rows = (await sql`
    insert into organization_domains (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id, next_check_at)
    values (${o.orgId}::uuid, 'web', ${o.hostname}, ${claim}, ${o.role}, ${token(o.token ?? 1)}, 'platform', ${user}::uuid, now() + interval '5 hours')
    returning id`) as { id: string }[];
  const id = rows[0]!.id;
  await walkDomain(sql, id, o.state);
  return { id, hostname: o.hostname };
}

/** Walks a `pending` row to `state` along the legal edges. */
export async function walkDomain(sql: Sql, id: string, state: WalkState): Promise<void> {
  for (const [to, cause, reason] of PATH[state]) await stepDomain(sql, id, to, cause, reason);
}

/** One edge. The row's `next_check_at` is pushed out again so the sweeper never leases it mid-spec. */
export async function stepDomain(sql: Sql, id: string, to: string, cause?: string, reason?: string): Promise<void> {
  if (reason !== undefined) {
    await sql`update organization_domains set state = ${to}, release_cause = ${cause ?? null}, force_release_reason = ${reason}, next_check_at = now() + interval '5 hours' where id = ${id}::uuid`;
  } else if (cause !== undefined) {
    await sql`update organization_domains set state = ${to}, release_cause = ${cause}, next_check_at = now() + interval '5 hours' where id = ${id}::uuid`;
  } else {
    await sql`update organization_domains set state = ${to}, next_check_at = now() + interval '5 hours' where id = ${id}::uuid`;
  }
}

/** `paused` / `disputed` / none: the owner-only platform hold (a column, not a state). */
export async function setHold(sql: Sql, id: string, hold: "paused" | "disputed" | null): Promise<void> {
  if (hold === null) {
    await withDbRetry("clear hold", () => sql`update organization_domains set platform_hold = null, hold_reason = null where id = ${id}::uuid`);
  } else {
    await withDbRetry("set hold", () => sql`update organization_domains set platform_hold = ${hold}, hold_reason = 'Arranged by the e2e fixture.' where id = ${id}::uuid`);
  }
}

/** A claim that was never proven: pending, then expired past its 7 days (terminal; serves nothing). */
export async function addExpiredClaim(sql: Sql, orgId: string, hostname: string): Promise<void> {
  const row = await addDomain(sql, { orgId, hostname, role: "alias", state: "pending", token: 9 });
  // expires_at is immutable and trigger-guarded; the sanctioned seam moves it, then the edge is legal.
  await backdateDomainClockHttp(sql, row.id, { expiresAt: new Date(Date.now() - 60_000) });
  await stepDomain(sql, row.id, "expired");
}

/** Removes a fixture organization and everything under it. Refuses anything that is not an `e2e-domains-` org. */
export async function removeSiteOrg(sql: Sql, org: SiteOrg): Promise<void> {
  if (!/^e2e-domains-/.test(org.slug)) throw new Error(`[custom-hosts] refusing to remove non-fixture org ${org.slug}`);
  // Deletes then confirming reads: repeating the whole unit after a lost reply ends the same.
  await withDbRetry(`remove site org ${org.slug}`, async () => {
    await sql`delete from site_contact_messages where organization_id = ${org.orgId}::uuid`;
    await sql`delete from organization_brands where organization_id = ${org.orgId}::uuid`;
    await sql`delete from organization_sites where organization_id = ${org.orgId}::uuid`;
    await sql`delete from blob_assets where organization_id = ${org.orgId}::uuid`;
    await sql`delete from organizations where id = ${org.orgId}::uuid`;
    const left = (await sql`select 1 from organizations where id = ${org.orgId}::uuid`) as unknown[];
    if (left.length > 0) throw new Error(`[custom-hosts] fixture organization ${org.slug} was not removed`);
    const rows = (await sql`select 1 from organization_domains where organization_id = ${org.orgId}::uuid`) as unknown[];
    if (rows.length > 0) throw new Error(`[custom-hosts] domain rows of ${org.slug} survived its removal`);
  });
}

/** Removes any fixture orgs a crashed earlier run left behind (slug prefix `e2e-domains-` only). */
export async function removeStaleSiteOrgs(sql: Sql): Promise<void> {
  const stale = (await withDbRetry("list stale site orgs", () => sql`select id, slug from organizations where slug like 'e2e-domains-%'`)) as { id: string; slug: string }[];
  for (const s of stale) {
    await removeSiteOrg(sql, { orgId: s.id, slug: s.slug, name: s.slug, blobId: "" });
  }
}

/** The slug of the org a host is attached to, by the database's own answer (for assertions that name the right org). */
export async function messagesFor(sql: Sql, orgId: string): Promise<Array<{ name: string; body: string }>> {
  return (await sql`select name, body from site_contact_messages where organization_id = ${orgId}::uuid order by created_at`) as Array<{
    name: string;
    body: string;
  }>;
}

// ---------------------------------------------------------------------------
// the standard world
// ---------------------------------------------------------------------------

export interface World {
  one: SiteOrg;
  two: SiteOrg;
  walk: SiteOrg;
  /** ONE's canonical (www) row, its alias row, TWO's row and WALK's row. */
  rows: { oneCanonical: DomainRow; oneAlias: DomainRow; two: DomainRow; walk: DomainRow };
  /** A PNG blob owned by ONE (the asset route). */
  oneImageId: string;
  /** A PNG blob owned by TWO. */
  twoImageId: string;
}

/**
 * Builds the three congregations and their domains. ONE and TWO are `live` and serving; WALK has a
 * single `pending` canonical row for the lifecycle walk. TWO is branded (an invented maroon seed) so
 * the brand cascade on a custom host can be asserted. Idempotent against a crashed earlier run.
 */
export async function buildWorld(sql: Sql): Promise<World> {
  await removeStaleSiteOrgs(sql);
  const stamp = Date.now();
  const one = await createSiteOrg(sql, { label: "one", idx: 1, name: "E2E Domains Church One", bundle: bundleFor(TITLES.one, TITLES.oneAbout), stamp });
  const two = await createSiteOrg(sql, { label: "two", idx: 2, name: ORG_NAMES.two, bundle: bundleFor(TITLES.two, TITLES.twoAbout), stamp });
  const walk = await createSiteOrg(sql, { label: "walk", idx: 3, name: ORG_NAMES.walk, bundle: bundleFor(TITLES.walk, "About Walk Church"), stamp });

  await setBrand(sql, two.orgId, "#7a1f2b");

  const oneCanonical = await addDomain(sql, {
    orgId: one.orgId,
    hostname: HOSTS.oneCanonical,
    claimName: HOSTS.oneAlias,
    role: "canonical",
    state: "live",
    token: 1,
  });
  const oneAlias = await addDomain(sql, {
    orgId: one.orgId,
    hostname: HOSTS.oneAlias,
    claimName: HOSTS.oneAlias,
    role: "alias",
    state: "live",
    token: 1,
  });
  const twoRow = await addDomain(sql, { orgId: two.orgId, hostname: HOSTS.two, role: "canonical", state: "live", token: 2 });
  const walkRow = await addDomain(sql, { orgId: walk.orgId, hostname: HOSTS.walk, role: "canonical", state: "pending", token: 3 });

  return {
    one,
    two,
    walk,
    rows: { oneCanonical, oneAlias, two: twoRow, walk: walkRow },
    oneImageId: await insertImage(sql, one.orgId),
    twoImageId: await insertImage(sql, two.orgId),
  };
}

/** Removes the world and confirms by SELECT (never assumed from the delete succeeding). */
export async function teardownWorld(sql: Sql, world: World | undefined): Promise<void> {
  if (!world) return;
  await withDbRetry("teardown world", async () => {
    for (const org of [world.one, world.two, world.walk]) await removeSiteOrg(sql, org);
  });
}

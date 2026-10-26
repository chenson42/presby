# Developer portal research — PresbyPortal /developer

Researched 2026-10-25. Sources are linked inline. Where a source is a vendor blog or another third party rather than the provider's own docs, it is marked *(secondary)*.

## 1. Common developer-portal sections

Key: **Int** = relevance to an internal operator/engineer portal now. **Ext** = relevance to a future external API for congregations and integrators. H/M/L = high/medium/low.

| Section | What it is | Seen in | Int | Ext |
|---|---|---|---|---|
| Home / overview | Landing page that routes readers by task, plus "what's new" | All surveyed; Backstage home | H | H |
| Getting started / quickstart | Shortest path to a first successful call | Twilio ([quickstarts](https://twilio.com/docs/usage/quickstart)), PCO GitHub README ([repo](https://github.com/planningcenter/developers)), Pushpay CCB ([getting started](https://docs.pushpay.io/chms-v2/docs/getting-started)); guidance in [Tyk](https://tyk.io/blog/what-makes-a-great-developer-portal-for-your-api/) | M (onboarding a new engineer: local dev, Neon branch, seed) | H |
| Authentication & API keys | Token types, OAuth flows, scopes, key rotation | PCO (PATs + OAuth2), Pushpay CCB (System vs Identity auth), Breeze (one account key, [secondary](https://help.clearstream.io/en/articles/9406799-where-do-i-find-my-breeze-api-credentials)) | M (document the session, 2FA and RLS model) | H |
| API reference (OpenAPI) | Per-endpoint reference generated from a spec | Stripe, GitHub, Shopify; guidance in [devpath](https://devpath.com/courses/api-analytics-for-product-managers/creating-api-documentation) | M (route and server-action inventory) | H |
| Webhooks / events | Event catalog, signing, retries, versioned payloads | Stripe ([webhooks](https://edge.stripe.com/docs/webhooks/best-practices)), Shopify (versioned payloads, `X-Shopify-Api-Version`, [versioning](https://shopify.dev/docs/api/usage/versioning)), PCO People/Giving ([secondary](https://rollout.com/integration-guides/planning-center/api-essentials)) | L–M (inbound Stripe webhook and crons) | H (giving and roll events) |
| SDKs & libraries | Client libraries and samples | Stripe, Twilio; PCO's `pco_api` gem; community Breeze wrappers ([npm](https://www.npmjs.com/package/breeze-chms)) | L | M (later) |
| Rate limits & errors | Quotas, headers, error envelope | GitHub (60/h unauthenticated, 5,000/h authenticated, [docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)); PCO reported at 100 per 20 s ([secondary](https://www.usecarly.com/blog/planning-center-api/)) | L | H |
| Versioning & changelog | Version policy, deprecations, change history | Stripe (dated versions plus `Stripe-Version` header, [versioning](https://docs.stripe.com/api/versioning), [changelog](https://docs.stripe.com/changelog)); Shopify (quarterly, ≥12-month support); PCO (date-based per product, `X-PCO-API-Version`, [secondary](https://www.usecarly.com/blog/planning-center-api/)) | M (link release notes and decisions) | H |
| Status page | Live operational health | Stripe and GitHub status pages; recommended by [Moesif](https://www.moesif.com/blog/api-strategy/what-is-a-developer-portal/) and Tyk | M (crons, domain sweep, email queue) | H |
| Sandbox / test data | An isolated environment with fake data | Stripe sandboxes ([upgrades](https://docs.stripe.com/upgrades)); Pushpay CCB `api-beta.ccbchurch.com` | H (Neon branches, `seed-dev.sql`, demo accounts) | H |
| Data model / schema reference | Entities and relationships | PCO's resource-oriented reference; Backstage's catalog of APIs and Resources ([catalog](https://backstage.io/docs/features/software-catalog/)) | H (the current /developer page) | M: publish resource shapes, never the DDL |
| Guides / tutorials / explanation | Task docs and concept docs | Diátaxis's four modes: tutorial, how-to, reference, explanation ([Canonical](https://canonical.com/blog/diataxis-a-new-foundation-for-canonical-documentation)) | H (architecture, invariants) | H |
| Security / compliance | Data handling, PCI scope, disclosure policy | Stripe; OWASP API9:2023 says to keep the API inventory documented ([Wallarm](https://lab.wallarm.com/api92023-improper-inventory-management/)) | H | H |
| Support / community | Where to ask, how issues get filed | PCO (GitHub issues), Pushpay (access-request form) | M (feedback and ticket loop) | H |
| Terms & policies | API terms, partner program, approval | Pushpay requires partner approval before granting OAuth access ([Nango, secondary](https://nango.dev/docs/api-integrations/pushpay-chms-v2/how-to-register-your-own-pushpay-chms-v2-oauth-app)) | L | H |

## 2. What church-management-software APIs expose

**Planning Center (PCO)** is the closest analogue and the de facto standard.
- **Coverage.** Calendar, Check-Ins, Giving, Groups, People and Services, with more products in progress ([help center](https://help.planningcenter.com/en/144877-the-planning-center-api.html)).
- **Format.** Responses are JSON:API 1.0, and paths carry the product and major version, e.g. `/services/v2/` ([GitHub](https://github.com/planningcenter/developers)).
- **Authentication.** Two models ([GitHub](https://github.com/planningcenter/developers)):
  - Personal access tokens over HTTP Basic, for single-organization scripts. Org administrators can see and revoke them ([help center](https://help.planningcenter.com/en/144877-the-planning-center-api.html)).
  - OAuth 2 applications, for multi-church integrations.
- **Versioning.** Each product has its own date-based version, selected with the `X-PCO-API-Version` header ([secondary](https://www.usecarly.com/blog/planning-center-api/)).
- **Webhooks.** Available for People and later Giving ([secondary](https://rollout.com/integration-guides/planning-center/api-essentials)).

**Pushpay / Church Community Builder (ChMS v2)** ([docs](https://docs.pushpay.io/chms-v2)):
- OAuth 2 that is partner-gated: Pushpay must create the application for you.
- Two grant types. **System Auth** covers a whole church's data and must be approved by a Master Administrator. **Identity Auth** acts as one individual.
- Versioned through the vendor media type `application/vnd.ccbchurch.v2+json`.
- A separate beta/sandbox host.
- The legacy v1 API is XML over Basic auth with a dedicated API user ([v1](https://docs.pushpay.io/chms-v1)).

**Breeze ChMS** offers one account-wide API key that grants full access, and is reached mostly through community wrappers ([secondary](https://help.clearstream.io/en/articles/9406799-where-do-i-find-my-breeze-api-credentials)). Avoid this pattern, because it carries no scopes and no per-app revocation.

**Lessons for PresbyPortal:**
- Make the **tenant (congregation) the consent boundary**. A Session or administrator approves an app for the org, as CCB's System Auth does. Add scopes that map to the privacy tiers, so financial and pastoral data are never in a default scope.
- Offer per-org tokens that admins can list and revoke.
- Use date-based versioning.
- Use JSON:API or a similarly predictable envelope.
- Send signed webhooks for roll actions and giving.

## 3. Internal developer portal patterns (Backstage-style)

Backstage is built around a **software catalog**: entities defined in YAML in each repo, with owners, kinds such as Component, API, Resource and System, and links to tools. Alongside it sit **TechDocs** (docs-as-code Markdown rendered in the portal), templates, search and plugins ([Backstage catalog](https://backstage.io/docs/features/software-catalog/); [Frontside](https://frontside.com/blog/2022-05-16-what-is-spotify-backstage/)).

PresbyPortal does not need Backstage itself (one repo, one team), but these patterns map directly:

- **Catalog → subsystem inventory**:
  - auth/2FA
  - authz/RLS
  - roll
  - giving (Stripe Connect)
  - domains (Track F)
  - contact methods
  - storage
  - brand
  - email queue
  - crons

  Each entry links to its `docs/architecture.md` section and its owning files.
- **ADRs**: render `docs/decisions.md`, searchable by DECISION number.
- **Runbooks**: production migration runbooks, the Vercel re-attach, Neon branch hygiene, lockout recovery (DECISION-194).
- **Environment and deployment info**: which environments exist, the current version and release notes, the cron schedule (`vercel.json`), migration journal head. Show names and states only, never connection strings.
- **Feature-flag inventory**: a read-only list of `feature_flags` with state, kept separate from the permission catalog (DECISION-003).
- **Permission catalog**: `FEATURE_CATALOG` and the role bindings.
- **Invariants board**: the `/developer` database/trigger/paper markers already exist; promote them to a first-class page.
- **Observability and audit links**: deep links to `/admin` audit events, feedback, the Vercel and Neon dashboards, and `npm run check` tripwire status.

## 4. Recommendations for a phased PresbyPortal developer portal

**Phase A — now (internal, platform-admin only):**
- **Home** with task-oriented cards, organized by Diátaxis mode:
  1. Schema reference (the existing page, moved off the root)
  2. API & integration surface
  3. Architecture & invariants
  4. Decisions
  5. Flags & permissions
  6. Environments & releases
  7. Placeholders

  Add a "what changed" strip drawn from the release notes.
- **Clearly labelled placeholders**, each with a one-line "what will live here" and a "Not yet written" badge, not an empty page:
  - Getting started (local dev)
  - Runbooks
  - Webhooks & events
  - Rate limits & errors
  - SDKs
  - Status
  - Security & data handling
  - Changelog

**The API page before an external API exists** should say so plainly: "PresbyPortal has no public API yet. Integrations are not supported, and no API keys exist." It then lists the **internal surface** as an inventory, in the spirit of OWASP API9 (document the inventory), and should be generated from the code rather than hand-written, so it cannot drift:
- route handlers under `src/app/api/`, including the four cron paths and their bearer-key requirement
- the Stripe webhook receiver
- server actions grouped by module, with the audit action each one writes

It closes with a "Future public API" section of design intents, not promises: org-consented OAuth, tier-mapped scopes, date versioning, signed webhooks, and the PCO comparison.

**Phase B — when an external API is planned:** split the portal in two.
- The public portal (on a platform host) carries getting started, auth, OpenAPI reference, webhooks, rate limits, versioning, changelog, status, terms, and partner approval.
- The internal portal stays behind `isPlatformAdmin`.

**Security cautions:**
- **No tenant data on any portal page.** Show counts and catalog metadata, and generate everything from schema and code, never from tenant rows. Read through `getPlatformDb()` only for platform tables. Never render example payloads built from real rows; use `seed-dev.sql` style fixtures.
- **Keep the gate.** `/developer` is gated by live `users.is_platform_admin` (DECISION-044), not by `canAccessAdmin`. Every new subpage must authorize itself at page level, not through the layout.
- **Never expose environment secrets or connection details.** Show env-var *names* and *presence* only.
- **Nothing public reveals the internals.** No DDL, RLS policy text, `SECURITY DEFINER` function names, trigger logic, the internal route inventory, or cron paths. These are a map for an attacker. The repo is public, but a curated portal lowers the effort to find them. A public reference should describe resources and scopes, not tables.
- **Tenant-enumeration rule.** Nothing should reveal which congregations are tenants (DECISION-040), including example org slugs.
- **Custom hosts.** The portal must 404 on a custom host like every other platform route.

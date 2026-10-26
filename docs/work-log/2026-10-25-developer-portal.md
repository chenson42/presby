# Developer portal: home, API page, documentation placeholders — Work Log

> **Slug:** `2026-10-25-developer-portal`
> **Surface:** (admin) `/developer` (gated by `users.is_platform_admin`, DECISION-044)
> **Permission(s):** TBD (isPlatformAdmin today)
> **Flag(s):** none expected (no new platform flags pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-25, Rule 16):** DECISION-258–261; F283–F288; migration 0071 if needed; dev port 3570.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; 4 increments; G1–G14, Q1–Q14 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; 9 rulings; A1 key outside FEATURES; no migration; DECISION-258–261 | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Increment 1 complete (see `-inc1`); Increments 2–4 pending, one child each | Design complete (Inc 1) | 2026-10-25 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

**Slug:** `2026-10-25-developer-portal` · Worktree `/Users/cshenso/git/presby-platform/presby-devportal` (from main at b903154)
**Date:** 2026-10-25 · **Read-only review.** Nothing was written. The orchestrator records this section.

**Operator quotes recorded (verbatim):**

1. 2026-10-25, original: "we can probably also take pass at the developer portal design. i think it goes directly to the database schema. it really needs its own portal home and placeholders for future developer documentation. we need an api page and do some reasearch on other developer features that are usually on a developer page"
2. 2026-10-25, standing requirement from the platform admin redesign: "the same thought and care with the ux should be used as with the org portal. same ux principals"
3. 2026-10-25, addition: "the developer page should be accessible by someone with the role of developer. could be part of any orgatization"

**Research input:** `/private/tmp/claude-501/-Users-cshenso/git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/devportal-research.md` did not exist when I finished reading code. **Phase 2 must read it and reconcile it with this section.** Where it recommends a section I have not listed, treat it as a candidate for a later increment unless it is cheap and honest today. The section list below comes from the repo and the request, not from that survey.

---

## VERDICT

**READY WITH NOTES.** The shape is buildable and four increments cover it. The notes are:

- A security-relevant finding about today's `/developer`: it has no 2FA gate and no app shell (G1, G2).
- A drift finding: the generated page is mislabelled for more than half the schema (G3).
- The new access rule needs architect rulings (G5 to G11).
- 14 open questions, each with a safe default.

## ONE-LINE TAKE

> `/developer` stops being a schema list and becomes a small, honestly labelled engineering portal. It has a home, the existing data model as one section, an API inventory that says plainly there is no public API, and a documentation page of labelled placeholders. It is open to anyone holding a platform `developer` role, whatever organizations they belong to, and it shows structure only.

---

## Verified current state

All facts are from reading the code in this worktree.

| Area | What exists | Evidence |
|---|---|---|
| Routes | `/developer` (index), `/developer/tables/[table]`, `/developer/erd/[module]`, `/developer/schema.json` (route handler). Each page calls `requirePlatformAdmin(returnTo)` itself. | `src/app/(admin)/developer/**` |
| Gate | `users.is_platform_admin`, read live. Unauthenticated users go to `/signin?callbackUrl=<fixed /developer path>`. Signed-in non-admins are silently redirected to `/home`. `schema.json` returns 401 or 403 as JSON. | `guard.ts`, `schema.json/route.ts`, `platform-admin.ts` |
| Who can set the gate | **Nothing in `src` writes `is_platform_admin`.** It is set by hand in SQL, with no UI and no audit row. | grep of `src`, `scripts/seed.ts` (comment only) |
| 2FA | The proxy's 2FA gate is `pathname.startsWith("/admin") \|\| pathname.startsWith("/o/")`. `/developer` is in neither. It falls through "auth-only". The guard does not check 2FA either. | `src/proxy.ts` ~145; `guard.ts` |
| Shell | There is no `layout.tsx` under `(admin)/developer` or at `(admin)` root. The root layout does not render `GlobalNav`. A developer page has no header, no avatar menu, no sign-out, and no link back to `/home`. The only chrome is a 12px breadcrumb. | `ls`; grep for `GlobalNav` |
| Entry points | Avatar menu "Developer" (`isPlatformAdmin`). A `/home` "Developer" card whose description reads "Schema reference, tables, and entity diagrams." `/launch` sends a zero-org platform admin to `/home` so the card stays reachable (DECISION-044). | `avatar-menu.tsx:138`, `home/page.tsx:172`, `destination.ts` |
| Generated | Table, column, FK and index structure comes from Drizzle at request time. Descriptions come from Postgres `COMMENT ON`. The permission list comes from `FEATURE_CATALOG`. | `dev-docs.ts` |
| Hand-maintained | `MODULES` (table to design-doc section), `BESPOKE_POLICIES`, and `INVARIANTS` (15 entries). | `dev-docs.ts` |
| Styling | A bespoke "register" palette in `developer.css`. It is hex literals under `.reg`, with its own light and dark variables. It is exempt from brand theming (DECISION-047). Rows collapse at 52rem. Breadcrumb links are 12px. | `developer.css` |
| Tests | `dev-docs` is imported by a test only incidentally (`events.schema.test.ts`, `scan.test.ts`). There is no test that the generated page is complete or correct. | grep |
| Route handlers that exist | 19 `route.ts` files: NextAuth, 4 crons, Stripe and Resend webhooks, the site-content ingest (CI OIDC), `schema.json`, asset and download routes. | `find src/app -name route.ts` |
| Public API | **None exists.** The schema has no API-key, OAuth-app or developer-account table. | schema table list |
| Docs on disk | `docs/architecture.md` (189 lines), `deployment.md` (840), `decisions.md` (3,416), `testing.md`, `STATE.md`, `schema-design*.md`, `ui-standards.md`, `release-notes/`, `product/functionality-map.md`. `/admin/docs` already renders release notes from disk with `react-markdown`, which is already a dependency. | `ls docs`; `admin/docs/page.tsx` |

---

## User Verbs

Surfaces used in this feature:
- **Anonymous visitor.** Only the sign-in redirect.
- **Newly-authenticated user with no roles.** Must not reach the portal.
- **Authenticated member.** Includes someone who is also a developer. Reaches the portal from the avatar menu or `/home`.
- **Admin / platform.** A platform-axis `developer` role holder, which is new. Also a `users.is_platform_admin` holder, unchanged.

"The developer" must never mean a tenant role. It is not an officer, not a church administrator, and not an org-scoped grant.

| Surface | Verb | Cadence |
|---|---|---|
| Developer (platform axis) | Open the portal from the avatar menu or the `/home` card; land on the portal home | per session |
| Developer | Scan the home: what exists, what is real, what is planned | per session |
| Developer | Find a table or column; open a table; open a module diagram | many times a day while building |
| Developer | Copy a deep link such as `/developer/tables/roll_actions` into a PR or ticket | daily |
| Developer | Read the API page to learn what HTTP surfaces exist and how each is protected | on demand |
| Developer | Look up a permission key, a flag definition, or an invariant and how it is enforced | on demand |
| Developer | Read the documentation page to learn what docs exist and where they live today | on demand |
| Platform administrator (`ADMIN_ROLE`) | Grant or revoke the `developer` role at `/admin/users` | one-time per person |
| Anonymous | Follow a `/developer` link, get sent to sign-in, and come back to the same page | rare |

---

## Pass 1 findings: the "who" is under-specified in the request

"Someone with the role of developer, could be part of any organization" has three possible meanings. I have taken the first as the requirement; Q1 asks the operator to confirm.

1. **A platform-axis role.** `developer` sits in the platform `roles` table, assigned at `/admin/users`, independent of any congregation. This is what I specify.
2. A tenant role in an organization, for example a church's "IT volunteer". This conflicts with the Two Hierarchies rule. A tenant role cannot unlock a platform page, because the portal shows platform structure and must not be reachable by anything an organization can grant.
3. A flag on the user. That is what `is_platform_admin` is today. It has no UI and no audit.

---

## Portal design

### Sections (what is real now, what is a labelled placeholder)

Every section carries a **provenance label** in text, not only color: `Generated`, `Tested list`, `Written by hand`, or `Planned`. The reader must always be able to tell whether a page is computed from the running system or written by a person.

| Section | URL | State | Source of truth |
|---|---|---|---|
| **Home** | `/developer` | Real | Composes the cards below. |
| **Data model** | `/developer/data-model` | Real (moved) | The current index: module lists, filter, counts. `tables/[table]`, `erd/[module]` and `schema.json` **keep their URLs**, because they are already linked from PRs and tickets. |
| **API** | `/developer/api` | Real, new | A tested registry of the 19 route handlers plus the four cron schedules. Includes a plain "there is no public API" statement. |
| **Rules** (invariants, with how each is enforced) | `/developer/rules` | Real (moved, then repaired) | `INVARIANTS`, fixed for drift (G4). Enforcement levels: `database`, `trigger`, `paper`. |
| **Access** (permissions and flags) | `/developer/access` | Real, new | Platform `FEATURE_CATALOG` (already rendered today); the tenant permission catalog (global definitions only); the org-feature catalog definitions; flag keys and descriptions. Definitions, never who holds what. |
| **Documentation** | `/developer/docs` | **Placeholder, one page** | A table of planned documents, each tagged `Planned`: getting started, architecture overview, decisions log, runbooks and deployment, changelog. Each row says what it will contain and which repo file holds the material today. |
| **Status** | none yet | Not built | Do **not** create a route. The platform dashboard (padmin Inc 1) owns platform health. A status page here would duplicate it. List it on the Documentation page as "Planned". |

**Why one placeholder page, not six empty routes.** A route that says "coming soon" is a dead end (org-portal principle U4: empty states say what happened and what to do next). One honest page listing what is planned, and where the material lives today, is more useful. A real page replaces its row when it ships.

**Nothing may imply a public API.** The word "API" appears only on the API page, always followed by the explanation. The home card for it says "Internal HTTP endpoints" (see Copy).

### Navigation and shell

- **The schema reference becomes one section** ("Data model") of the portal. Table and diagram pages get a breadcrumb back to it, and 44px tap targets (G13).
- **The portal gets its own layout** (`/developer/layout.tsx`) with a header carrying the avatar menu and a way back, and a left nav that becomes a sheet below 768px. This directly reuses the platform admin redesign's vocabulary and components: `AdminHeader`, `AdminNavLinks`, `AdminMobileMenu`, `AdminForbidden`, and the nav registry shape (`ADMIN_NAV_GROUPS`).
- **It must not appear in the platform admin left nav.** That is DECISION-044 and the padmin Phase 1 rule ("Do not add a Developer link to the left nav"). Reasons: `canAccessAdmin` and the developer predicate differ, and a nav item would invite people who cannot enter. The reverse link is fine: the developer header may link "Platform admin" only if the viewer holds `canAccessAdmin`, mirroring the avatar menu.
- **Sequencing dependency (Phase 2 must rule):** the shared shell lives in `/Users/cshenso/git/presby-platform/presby-padmin/src/components/admin-portal/`, built by the padmin Increment 1. That increment is not on `main`. Options: (a) developer Increment 1 waits for the padmin merge; (b) the shell components are generalized and moved to `src/components/shared/` first. I prefer (a). Do not fork the components. The architect should also decide whether the admin-only `AdminForbidden` (deliberately kept out of `shared/` so it cannot become the `(org)` miss response) is reused or gets a developer sibling.

### Restyling (UX principles from the org portal)

The existing page is strong on reading and weak on the org portal's principles:

- It has no loading or calm-failure state. A database error on any `/developer` page shows Next's default error page (U1).
- Its palette is hex literals (U9, "tokens only"). Enforcement is also encoded in verdigris versus oxblood, which is color-only for the central distinction (paper versus database). The text tags (`paper`, `database`) exist, which is good; keep them and add an icon.
- Breadcrumb links are 12px (U7, 44px).
- Dark mode works by a `.dark .reg` override, which is fine.

Default: the frame, home, API and docs pages use platform tokens and shared primitives. Data-model pages keep their reading layout but get 44px targets, error and loading states, and a token pass (Q8).

---

## Flows

**Flow 1 — Open the portal (entry: avatar menu "Developer", the `/home` Developer card, or a deep link such as `/developer/tables/roll_actions`).**
- Steps: the layout checks that the user is signed in → checks the developer entitlement live from the database → checks the 2FA challenge if one is required → renders the portal home with the section nav.
- Success: the home shows sections with a provenance label each, and the viewer's way back (avatar menu, "Platform admin" only if entitled).
- Failure: signed out goes to `/signin?callbackUrl=<same path>` and returns to the same page after sign-in. Signed in but not entitled sees a calm "Your account doesn't include the developer portal" page with a link home, not a silent bounce (G12). The database unreachable shows "We can't check your access right now" with Try again, and the page **denies** (fails closed). It does not redirect to `/home`, which would read as revoked access (the `/launch` precedent).

**Flow 2 — Find a table (entry: portal home "Data model", or a deep link).**
- Steps: Data model list → type in Find → open a table → follow "referenced by" links or its diagram.
- Success: the filter narrows the list with an `n of N` count; the table page shows structure only.
- Failure: a read failure shows a calm "can't load" state with Try again, never an empty list. An unknown table is a plain 404.
- Empty: a brand-new install still lists every table. A table with no `COMMENT ON` says "No description yet", which is true but should say what to do (add a `COMMENT ON` in the migration).

**Flow 3 — Read the API page (entry: home "API", or the avatar menu to the portal).**
- Steps: read the statement ("no public API") → scan the endpoint groups (crons, webhooks, ingest, authentication, downloads, schema.json) → read each row's method, path pattern, purpose, and how it is protected.
- Success: the reader can tell which surfaces take outside traffic and which are called by Vercel, Stripe, Resend or CI.
- Failure: the page is static from a tested registry, so it has no data failure. If the registry and the code disagree, a test fails in CI (G4), not the page.

**Flow 4 — Grant the developer role (entry: `/admin/users`, the existing role assignment UI).**
- Steps: an administrator holding `ADMIN_ROLE` picks the user → assigns "Developer" → an audit row is written → the target's access takes effect on their next request, not their next sign-in (G7).
- Success: the person can open `/developer` with no `/admin` access.
- Failure: someone without `ADMIN_ROLE` cannot reach the action (`requireAdmin` throws `Forbidden`). Note `/admin/users` copy says "Admins receive every feature automatically" and needs a small change (G10).

**Flow 5 — Revoke the developer role.**
- Steps: an administrator removes the role → audit row → the next `/developer` request by that person is denied.
- Success: a revoked developer mid-session loses access on their next request, with the "doesn't include" page.
- Failure: if the portal trusted the JWT feature claim, a revoked developer would keep access until sign-in (G7). It must not.

**Flow 6 — Land after sign-in as a developer with no organization and no admin access.**
- Steps: sign-in → `/launch` → `/home` (the chooser) with a single Developer card → open the portal.
- Success: they see one platform card and the honest line that they have no congregations yet. They are not shown "no-organization".
- Failure: if `/launch` is not updated, the matrix sends them to `/no-organization` and they can reach `/developer` only by typing the URL (G6).

---

## Permissions & Flags

- **Permission(s):** a new platform-axis key, `FEATURES.DEVELOPER_PORTAL = "developer.portal"` (working name). **Phase 2 must rule on this.** `permissions.ts` is described as frozen for church-facing keys. Platform keys have been added before (`ADMIN_TICKETS` for the Support Operator), so a platform key is plausible, but it is the architect's call.
- **Default roles:** a new system role `developer`, bound to that key and nothing else. The `admin` role receives every catalog key automatically (`token.features = FEATURE_KEYS`), so `admin.*` holders would carry the claim. **The portal must not read the claim** (see below).
- **Access predicate (one function, `canAccessDeveloper`):** `users.is_platform_admin` (unchanged; platform admins keep access), **or** the user holds a role bound to `developer.portal` through `role_features`, **read live from the database on every request**. It does not read the session claim.
  - Why not the claim: role and feature claims refresh only at sign-in or on a self-targeted `unstable_update` (`auth.ts` jwt callback, `needsRoleRefresh`). A revoked developer would keep the portal until their next sign-in. That is the exact reason `is_platform_admin` is read live (`platform-admin.ts`).
  - Consequence to state: an `ADMIN_ROLE` holder does not gain the portal merely because the catalog grew. Today an admin-role user without `is_platform_admin` is not a developer; that behavior is preserved (DECISION-044).
  - Fail closed: any error reading the predicate denies, with calm copy (Flow 1).
- **DECISION-044 amended, not contradicted.** There are now two *gate* predicates and one *composite*: `canAccessAdmin` (claims, Edge-enforced on `/admin`) and `canAccessDeveloper` (the composite above). `isPlatformAdmin` becomes an input to the composite, not a caller-facing predicate. No caller composes the two itself.
- **Launch matrix (`destination.ts`):** `platform = canAccessAdmin || canAccessDeveloper`. Row 4 (zero orgs, `canAccessAdmin`, not developer) still sends to `/admin`. Everything else with platform access lands on `/home`, so the Developer card is reachable. Consequence (accepted by default, Q6): a congregation member who is also a developer no longer auto-forwards to their one org; they land on the chooser. That is already the platform-admin behavior.
- **Avatar menu and `/home`:** both take the composite. Rename the prop in tests. Update the `/home` card description; it is currently false once the portal holds more than the schema (Copy).
- **2FA:** see G1. The developer role follows the same rule as `/admin`: challenge when `twoFactorRequired` and not verified. Neither `/admin` nor this forces enrolment. A stricter rule is Q5.
- **Flag(s):** **not needed.** Operator: no new global flags pre-live. The portal is read-only structure behind a role nobody holds until granted, so the grant is the staged rollout. **Rollback plan:** remove the role binding (`role_features`) or revoke the role. Because the predicate is read live, that takes effect on the next request.
- **Audit (Rule 7):** assigning and removing the role is a role change. `assignRoleAction` and `removeRoleAction` already write `USER_ROLE_ASSIGNED` and `USER_ROLE_REMOVED`, but assign records only `roleId`. Phase 3 should record `roleName` too so the audit reads without a join. Portal reads are not audited; this is an accepted residual (Q9).

---

## Gaps the Request Didn't Address

| # | Gap | Why it matters | Suggested resolution |
|---|---|---|---|
| **G1** | **`/developer` has no 2FA gate** (proxy gates `/admin` and `/o/*` only; the guard does not check). | A platform admin whose account requires 2FA and who has not verified can read a map of the whole application. Adding a wider developer audience makes it worse. | Add `/developer` to the 2FA-gated set. Architect rules whether that is a one-line proxy edit (triggers the MFA e2e gate: `src/proxy.ts` is on the auth-touching list) or a page-level guard like the admin layout's defense-in-depth redirect. I prefer both layers. `schema.json` should answer a JSON 403 `two_factor_required`, not a redirect. |
| **G2** | **No shell.** No header, avatar menu, sign-out, or route back to `/home` or `/admin`. | A phone user lands on a page with only the browser back button. The request's "portal home" and "same UX principles" cannot be met without it. | The portal layout above. |
| **G3** | **The generated page is mislabelled for 58 of 105 tables.** `MODULES` is a hand map. Tables not in it fall into "platform (from starter)": all 14 `giving_*`, tickets, events, domains, sites, invitations, and more. They get no diagram (the ERD generator skips that module), and the page header claims it "cannot drift from what is deployed." | The reader sees giving tables filed under the starter and trusts it. The promise "cannot drift" is false. A new table silently joins the wrong bucket. | A test: every exported table is either in `MODULES` or on an explicit allow-list for platform tables; adding an unmapped table fails CI, the way `contract.ts` fails an unclassified token. Add the missing mappings. Correct the header copy. |
| **G4** | **Hand lists have no drift check.** `INVARIANTS` omits much of CLAUDE.md's Key Invariants (Composite Tenant Keys, Extensibility Goes Through Support, The Brand Is a Cascade Override, A Custom Host Is a Key, The Proxy Does Not Reach the Database, Permissions vs Flags). It also carries "must be removed before ship" for the `ADMIN_ROLE` wildcard, which CLAUDE.md now records as a known bounded violation. The "rules unenforced" headline count derives from that list. | A stale page that says nothing is paper when something is paper misleads, which is the failure the operator named. | A test that reads the `### ` headings under Key Invariants in CLAUDE.md and requires each to be in `INVARIANTS` or on a short, reasoned "not listed" list. Fix the stale entries. |
| **G5** | **The `developer` role and key do not exist in production.** Roles and features are seeded by `scripts/seed.ts`, not by migration. | If the code ships before the rows exist, the grant UI has nothing to assign. If the predicate cannot find the key, it must deny. | Phase 3 designs the production seeding (the `neon-postgres` / `deployment.md` "Pre-deploy runbook" pattern; migration 0071 only if a migration is the right carrier). The predicate fails closed on a missing row. |
| **G6** | **`/launch` and `/home` will send a developer-only user to the wrong place.** The matrix knows two inputs; a developer with zero orgs and no admin access is `/no-organization`. | The portal is reachable only by URL. | Third input in `destination.ts` plus test rows for every combination. |
| **G7** | **JWT staleness on revoke** (see Permissions). | Revocation that works "at next sign-in" is not revocation. | Live read in the one predicate; a test that revokes mid-session. |
| **G8** | **`is_platform_admin` has no grant path or audit.** It is set by hand in SQL. | The old gate has no record of who got in. The operator may want to retire it in favor of the role. | Keep the column as is for now (Q3). Record the role as the audited path. Not in scope: a UI for the column. |
| **G9** | **Failure modes of today's guard.** `readIsPlatformAdmin` throws on a database error and shows Next's default error. A signed-in non-entitled user is silently redirected to `/home`. | Both read as a bug or as revoked access. | Calm, fail-closed states (Copy). |
| **G10** | **`/admin/users` copy.** "Admins receive every feature automatically." After this change that is still true of the claim but not of the portal. The role list will also show a role whose purpose an administrator cannot see. | An administrator needs to know what "Developer" grants before assigning it. | One line of copy under the role selector, and the role's `displayName`. |
| **G11** | **Self-grant and chains.** An `ADMIN_ROLE` holder can already assign any role to themselves. Granting `developer` to oneself is allowed. | It is a self-targeted privilege change. | Audited already; mark `selfTargeted` in metadata so it is detectable (the invitations precedent for `selfAddressed`). |
| **G12** | **No forbidden state.** See Flow 1. | One shared state, not hand-copied sentences (U3). | The shared forbidden component. |
| **G13** | **Touch targets and 360px unverified.** 12px breadcrumb links; wide column tables on table pages; a mermaid SVG on the diagram page. | The operator reviews this page from a phone. Three phone-only bugs have shipped in this project already. | Phase 5 walks every page at 360px. |
| **G14** | **No consumer for `schema.json`.** The file comment says it serves "the AI support worker"; nothing in `src` or `scripts` calls it. It is session-authenticated, so an automated worker could not. | The copy claims a purpose that does not exist. | Q10. |

---

## Pass 5 — Adversarial

| Check | Finding |
|---|---|
| **Redirect targets** | The sign-in `callbackUrl` is built from a fixed `/developer…` prefix plus a path parameter, so it cannot leave the origin. Keep it that way: every new page passes a literal `/developer…` string. `/signin` also runs `sanitizeCallbackUrl`. **Confirmed safe by design.** |
| **State-machine shortcuts** | A deep link skips the home. Each route must guard itself (a layout cannot stop client-side navigation after a revoke). **Gap:** add a source-scan test that every `page.tsx` and `route.ts` under the developer tree calls the one guard. |
| **Enumeration** | The portal exists in a public repo, so its existence reveals nothing. A non-entitled signed-in user sees the same page for `/developer` and `/developer/tables/<anything>`; do not let a missing table answer differently for them (guard first, then 404). **Confirmed in current order** (`requirePlatformAdmin` runs before `notFound`). |
| **Input boundaries** | The only input is the client-side filter, which reads server-rendered DOM and sends nothing. No server-side parameters exist to validate. The API page takes none. |
| **Self-targeting** | Covered in G11. A developer has no action in the portal that changes a role. |
| **Secrets** | The API page must show mechanism classes only ("shared bearer secret", "Stripe signature", "GitHub Actions OIDC", "session"), never values, and not env-var or header names. No example payloads with realistic IDs. No "try it" console, no live probing or health pings from the page (it would turn an inventory into a request forger). |
| **Tenant data** | See Two Hierarchies below. |
| **Public-repo contrast** | Everything on these pages is also in the public repo. The gate is still right: the point is not secrecy of the code but that a curated, current map is an aid to an attacker, and CLAUDE.md already says so. Say less than the repo in the UI, not more. |

---

## Two Hierarchies / no tenant data

The developer role is a **platform-axis capability** (a role bound to a platform key). It confers no tenant authority: it appears nowhere in `role_grants`, the permission resolver, or `withOrgContext`. A developer who is also a congregation member has exactly the tenant authority their congregation gave them and nothing more. Organization membership neither gives nor removes portal access ("could be part of any organization" is satisfied by independence).

Content audit, page by page:

| Page | Reads | Verdict |
|---|---|---|
| Home | Counts of tables, routes, rules (structure) | OK. Never row counts, never per-org counts. |
| Data model, table, ERD, `schema.json` | Drizzle structure, `pg_description` comments, constants | OK. Structure only. Comments are written by developers; the no-real-data rule applies to them. |
| Rules | Constants | OK. |
| Access | `FEATURE_CATALOG`; `permissions` table (global catalog); `ORG_FEATURE_CATALOG` definitions; `feature_flags` key and description | OK **only as definitions**. No role-to-person mapping, no per-org toggle state, and flag *live* on/off state is shown only with a link to `/admin/flags` for viewers who hold `ADMIN_FLAGS` (Q11). |
| API | A constant registry plus `vercel.json` | OK. No tenant slugs; patterns such as `/o/[slug]/…`. |
| Documentation | Constants | OK. |

**Mechanical check (recommended):** a source-scan test over the developer tree and its libraries (the padmin dashboard has a "boundaries scan"; mirror it) that bans `withOrgContext`, `getPlatformDb`, and imports of tenant-table modules. `dev-docs.ts` uses the RLS-enforced `db` for catalog comments only, which is fine; the owner connection has no business here.

---

## What is generated, what is hand-written, and how it stays current

| Content | Kind | Staying current |
|---|---|---|
| Tables, columns, FKs, indexes | Generated at request time from Drizzle | Cannot drift. |
| Table and column descriptions | Generated from `COMMENT ON` | Already a convention; show "No description yet" honestly. |
| Platform permission list | Generated from `FEATURE_CATALOG` | Cannot drift. |
| Module grouping (`MODULES`) | Hand map | **Completeness test (G3).** |
| Invariants (`INVARIANTS`) | Hand list | **Coverage test against CLAUDE.md (G4).** Each entry carries `enforcement`; a change to CLAUDE.md that adds an invariant fails CI until it is listed. |
| API inventory | Hand registry | **Set-equality test:** the registry equals `find src/app -name route.ts`, and its cron entries equal `vercel.json` (path and schedule). A new route or cron cannot ship unlisted; a deleted one cannot linger. |
| Flag definitions | Seeded defaults in `scripts/seed.ts` or live rows | Read the rows; do not copy descriptions into a second file. |
| Documentation page | Hand-written, `Planned` | Each row has a `lastReviewed` date; the monthly documentation review (tech-lead) already covers it. |
| ERD blocks in `docs/schema-design.md` | Generated by `npm run docs:erd` from the same module | The same single source. Fixing `MODULES` fixes both. |

Rule 14 applies at ship: update the `presby: developer reference` line in `docs/product/functionality-map.md`.

---

## Copy for key states (Phase 3 finalizes; QA checks for truthfulness)

- **Home masthead:** "Developer portal" / "Engineering reference for PresbyPortal. It shows how the platform is built, never congregation data."
- **Home card, Data model:** "Every table, how it is isolated, and the diagrams. Generated from the running schema." (`Generated`)
- **Home card, API:** "The HTTP endpoints the platform itself uses, and how each is protected. This is not a public API." (`Tested list`)
- **Home card, Documentation:** "What documentation exists, where it lives today, and what is planned." (`Planned`)
- **API page statement:** "PresbyPortal has no public API. There are no API keys, no outside developer accounts and no supported integration surface. The endpoints below are used by Vercel, Stripe, Resend, our own build pipeline, and our own pages, and they can change without notice." Verified: no key, OAuth or developer-account table exists. Server actions are internal and not listed; say so in one sentence.
- **Forbidden:** "Your account doesn't include the developer portal. Ask a platform administrator if you need it." (Do not say why. Do not name the role.)
- **Access check failed:** "We can't check your access right now. This is on our end, not yours. Try again in a moment." plus a 44px Try again.
- **Read failure:** "We couldn't load this right now. Try again in a moment."
- **Placeholder row:** "Planned. Not built yet. Today this material lives in `docs/architecture.md`." Text plus icon, not color alone.
- **`/home` card description (replaces "Schema reference, tables, and entity diagrams."):** "Data model, API endpoints and engineering references." Update only when the sections it names exist (Increment 1).
- **Provenance labels:** `Generated`, `Tested list`, `Written by hand`, `Planned`.
- Avoid the word "tenant" in operator-facing copy (U11); say "congregation" or "organization".

---

## Out of Scope (confirm with user)

- A public API, API keys, OAuth apps, SDKs, a sandbox, or a "try it" console.
- Rendering `docs/*.md` in the portal (Increment 4). The `react-markdown` dependency is already present and `/admin/docs` is a precedent, but Vercel must include the files at runtime; Phase 2 must verify.
- Retiring `users.is_platform_admin` or adding a UI for it (Q3).
- Any tenant-derived data: no row counts, no per-organization anything.
- A status or health page (the platform dashboard owns that).
- Audit of portal reads (Q9).

---

## Open Questions

| # | Question | Default if unanswered |
|---|---|---|
| **Q1** | Confirm the developer role is a platform-axis role assigned at `/admin/users`, not a tenant role. | Yes. |
| **Q2** | Does anyone with `ADMIN_ROLE` gain the portal automatically? | No. Platform admins (`is_platform_admin`) and `developer` holders only, as today. |
| **Q3** | Keep `is_platform_admin` as a second way in, or migrate those people to the role? | Keep both; no column change in this pipeline. |
| **Q4** | Name of the role and key. | Role `developer`, key `developer.portal`. |
| **Q5** | Should the developer role require 2FA more strictly than `/admin`? | Parity: challenge when `twoFactorRequired` and unverified, with `/developer` added to the gated set. Stricter (granting sets `two_factor_required` and is audited) is available if you want it. |
| **Q6** | A congregation member who becomes a developer lands on the `/home` chooser instead of auto-forwarding into their one organization. Acceptable? | Yes (the platform-admin behavior today). |
| **Q7** | Does a signed-in non-entitled user see a "doesn't include" page, or the current silent redirect to `/home`? | The page. |
| **Q8** | Restyle the data-model pages onto platform tokens in Increment 1, or leave the `.reg` palette and only fix targets and states? | Targets, states and shell now; palette migration tracked as a follow-up. |
| **Q9** | Audit portal reads? | No. The grant and revoke are audited. Recorded as an accepted residual. |
| **Q10** | `schema.json`: keep session-gated and drop the "AI support worker" claim until a consumer exists? | Yes. |
| **Q11** | Show live flag on/off state to developers who do not hold `admin.flags`? | No. Definitions only, with a link for those who hold the key. |
| **Q12** | Read `docs/*.md` into the portal later, or keep them as repo links? | Decide in Increment 4. Today: "where it lives" text only. |
| **Q13** | Include a Server Actions inventory on the API page? | No. They are internal RPC with framework-generated identifiers, not an interface. State that. |
| **Q14** | Should the research agent's survey add sections before Increment 1? | Phase 2 decides after reading it. Default: no. Add only what is real and honest today. |

---

## Recommended increments

Each is a full pipeline unless noted. Numbers come from the pre-assignment: DECISION-258 to 261, F283 to F288.

| Inc | Carries | Notes |
|---|---|---|
| **1. Frame and hardening** | **DECISION-258** (portal IA, provenance labels, URL stability) and **DECISION-261** (shell reuse, restyling). **F283** (module map drift, G3), **F284** (2FA gate and shell, G1/G2), **F285** (stale invariants, G4). | Portal layout, home, Documentation placeholder page, Data model moved with its URLs kept, one guard, calm states, 44px targets, completeness tests. Touches the proxy only if the architect chooses that layer; if so, the MFA e2e gate applies. Depends on the padmin Increment 1 shell merging (or an explicit architect alternative). Phase 6 walk at 360px. |
| **2. The developer role** | **DECISION-259** (access predicate, amends DECISION-044), **F286** (no grant path or audit for the old gate), **F287** (JWT staleness, live read). | Role and key, production seeding, `canAccessDeveloper`, `/launch` matrix, avatar menu, `/home` card, `schema.json` gate, `/admin/users` copy, audit metadata. **Auth-touching, so the MFA e2e gate applies.** Phase 6 walk **as the person the grant creates**: a user with a `developer` role and zero organizations, then one with one organization; list each page they reach at 360px on `development`; plus a revoke mid-session. This is the walk Phase 6 requires for any change to how a role is granted. |
| **3. The API page** | **DECISION-260** (inventory registries and drift tripwires, including the redaction rules), **F288** (guard failure modes and the unconsumed `schema.json`, G9/G14). | Tested route and cron registry, Access page, Rules page repairs. |
| **4. Real documentation** | Tracked in `docs/TODO.md`, not built now. | Decisions index, runbooks, changelog, architecture overview. Needs the Vercel file-inclusion check (Q12). |

Order rationale: Increment 1 closes a gap that exists today (G1) before the audience widens. Increment 2 widens it. Increment 3 adds a page whose security caution matters more once more people can read it.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; 4 increments; G1–G14, Q1–Q14; research file not yet available, Phase 2 must read it | READY WITH NOTES | 2026-10-25 |

## Handoff

**Next agent: architect (Phase 2).** Please rule on:

1. Whether `developer.portal` is a permitted platform key in the frozen `src/lib/permissions.ts`, versus gating on the role name or a `users` column (my preference: key plus live DB read, because a role name is not a permission and an administrator may compose custom roles).
2. How the live predicate reads: the join over `user_roles`, `roles` and `role_features`, whether it is its own module beside `platform-admin.ts`, and that `ADMIN_ROLE` holders do not gain access by the catalog growing.
3. The 2FA layer for `/developer` (proxy line, page guard, or both) and the consequence for the MFA e2e gate; and the JSON 403 for `schema.json`.
4. Whether the portal reuses the padmin `admin-portal` components (sequencing against padmin Increment 1) or they move to `shared/`; and whether `AdminForbidden` is reused.
5. The `/launch` matrix change (a new input, or rename `isPlatformAdmin` to the composite) and its pure-function tests.
6. Production seeding of the role and key, and whether migration 0071 is needed.
7. Where the tripwires live (module-map completeness, route and cron set-equality, CLAUDE.md invariants coverage, "every developer page calls the guard", and the tenant-data boundary scan), and whether any belongs in `npm run check`.
8. Runtime file reading on Vercel, for Increment 4 only.
9. **Read `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/devportal-research.md` and fold it in.**

**Files read:** `/Users/cshenso/git/presby-platform/presby-devportal/` `src/app/(admin)/developer/{page.tsx,guard.ts,erd.tsx,table-filter.tsx,developer.css,schema.json/route.ts,tables/[table]/page.tsx,erd/[module]/page.tsx}`, `src/lib/{dev-docs.ts,platform-admin.ts,permissions.ts}`, `src/app/launch/{destination.ts,page.tsx}`, `src/proxy.ts`, `src/auth.ts` (jwt callback), `src/components/shared/avatar-menu.tsx`, `src/app/(member)/home/page.tsx`, `src/app/(admin)/admin/users/{page.tsx,actions.ts}`, `src/app/(admin)/admin/docs/page.tsx`, `src/app/api/**/route.ts` (headers), `vercel.json`, `next.config.ts`, `scripts/{seed.ts,generate-erd.ts,check-schema-parity.ts}`, `docs/{ui-standards,deployment,architecture,decisions}.md`, `CLAUDE.md`; and `/Users/cshenso/git/presby-platform/presby-padmin/docs/work-log/2026-10-25-platform-admin-redesign.md` plus `src/lib/admin-portal/nav.ts` and `src/components/admin-portal/admin-forbidden.tsx`.

I did not verify the following, and Phase 5 should: behavior at 360px on any existing `/developer` page, the mermaid diagram's width on a phone, and whether the padmin shell components accept a different nav registry without change.

---

# Phase 2 — Architectural Review (architect)

**Slug:** `2026-10-25-developer-portal` · Worktree `/Users/cshenso/git/presby-platform/presby-devportal` (main at b903154)
**Date:** 2026-10-25 · **Read-only review.** No file was written. The orchestrator records this section.

## Verdict

**Approved with suggestions.**

The feature shape, the four increments and their order are sound. One design premise from Phase 1 is false and is corrected here: the access predicate as written would let in every `admin` role holder (A1 below). That is a ruling within this phase, not a loop-back. The other rulings are binding on Phase 3. Suggestions are marked as such.

### A1: new finding, record under F287

The analyst proposed a live join over `user_roles`, `role_features` and `features` for a key `FEATURES.DEVELOPER_PORTAL`. That join would admit every `admin` role holder:

- **Seed binding.** `scripts/seed.ts` `bindAdminFeatures()` binds every `Object.values(FEATURES)` value to the `admin` role in `role_features`.
- **Live data.** On `development` (endpoint `ep-lingering-meadow`, read 2026-10-25 as `neondb_owner` in a read-only session), `admin` holds all 11 catalog keys in `role_features`.
- **JWT path.** `auth.ts` sets `token.features = FEATURE_KEYS`, which is all of `FEATURES`, for `ADMIN_ROLE`.
- **Precedent.** `src/lib/tickets-notifications.ts` uses exactly this join, and it includes admins on purpose.

So putting the key in `FEATURES` contradicts Q2's default ("ADMIN_ROLE holders not auto-entitled"). It would also extend the known `ADMIN_ROLE` wildcard violation to a new surface. Ruling 1 fixes this.

## Placement

### Directory placement

**Routes.** The portal stays in `src/app/(admin)/developer/`. There is no new route group and no URL change. `tables/[table]`, `erd/[module]` and `schema.json` keep their URLs. New pieces:

- **Layout:** `layout.tsx`, the chrome only (see Ruling 3).
- **Error boundary:** `error.tsx`, `'use client'`, calm copy, never `error.message`.
- **New sections:** `data-model/page.tsx`, `api/page.tsx`, `rules/page.tsx`, `access/page.tsx`, `docs/page.tsx`.
- **Gate:** the co-located `guard.ts`, rewritten as the one gate.
- **Status:** no status route.

**Library modules.**

- **New `src/lib/developer-portal/`**, parallel to padmin's `src/lib/admin-portal/`. It holds pure data only: `nav.ts`, `api-inventory.ts` (Inc 3) and `docs-registry.ts`. Inc 3 adds one `readers.ts` for the `feature_flags` and `permissions` definition reads.
- **`src/lib/dev-docs.ts` stays where it is.** `scripts/generate-erd.ts` and `npm run docs:erd` import it, and moving it is churn.
- **The predicate goes into `src/lib/platform-admin.ts`, not a new module.** That file already exists to hold the platform predicates.

**Components.** The collapsing nav and the header are promoted to `src/components/shared/` (Ruling 4). `AdminForbidden` stays in `src/components/admin-portal/` and the developer portal imports it from there.

### Server vs Client split

- **Server Components:** the layout, every page, every state (forbidden, access unavailable, read failure) and the registries.
- **Try again stays a server link.** It is a `Link` to the page's own literal path (the `OrganizationsUnavailable retryHref` precedent), so it needs no client code.
- **`'use client'` is only for:**
  - the promoted nav-links leaf (`usePathname`)
  - the mobile menu (`Sheet` state)
  - the existing `table-filter.tsx` and `erd.tsx` (mermaid, loaded dynamically)
  - `error.tsx`
- **No forms.** `check:hydration-gate` is untouched.

### Dependencies

**None new.**

- **Increments 1–3:** `mermaid`, `react-markdown`, `remark-gfm`, `lucide-react` and the `Sheet` primitive are all present.
- **Increment 4:** must not add a markdown or MDX dependency. It uses `react-markdown` + `remark-gfm` without `rehype-raw` (Ruling 8).

## Invariants Touched

- **Two Hierarchies Intersect Nowhere: respected, confirmed.**
  - `developer` is a platform-axis role in `roles`/`user_roles`. Those are platform tables with no RLS: `relrowsecurity = f` and no policies on `users`, `roles`, `user_roles`, `role_features` or `features`, read live.
  - It never appears in `role_grants`, the resolver, `withOrgContext()` or any `presby_*` function. It confers no tenant authority, and holding an organization neither gives nor removes access.
  - Pages show structure only: Drizzle config, `pg_description`, constants, and global catalog definitions. They never show row counts, per-org toggle state, role-to-person mappings or live flag state (Q11).
  - Pinned by a scan (Ruling 7): `src/lib/authz.ts` and `src/lib/db/domain/**` never reference the developer constants.
- **Permissions vs Flags: respected, with one new shape that CLAUDE.md must document.**
  - No flag. The rollout is the grant, and rollback is revoking the role or the binding, which takes effect on the next request.
  - `developer.portal` is a permission read live from the database, never a session claim. It sits outside `FEATURES` (Ruling 1).
  - Phase 6 edits the Key Invariants paragraph to read: "a platform permission may also be a live-read capability outside `FEATURES`; it is never gated through `hasFeature()` or the proxy."
- **No Role Carries a Wildcard: strengthened.** The `ADMIN_ROLE` wildcard does not extend to the developer portal.
- **Post-Login Landing / DECISION-044: amended (see DECISION-259).** The two gate predicates become `canAccessAdmin` (claims, enforced by the proxy) and `canAccessDeveloper` (live composite). `isPlatformAdmin` becomes an input to the composite and is no longer caller-facing. Phase 6 updates the CLAUDE.md table and the "Two platform predicates" paragraph.
- **The Proxy Does Not Reach the Database: unchanged.**
  - The proxy gains one path condition and no import, so `check:proxy-imports` is unaffected.
  - There is still no `PROTECTION_RULES` entry for `/developer`, and there must not be one: the key is not a claim.
- **No `loading.tsx` on a segment that redirects or 404s.** `tables/[table]` and `erd/[module]` call `notFound()`. So:
  - no `loading.tsx` anywhere under `(admin)/developer`, pinned by a scan
  - loading feedback, if any, is per-section `Suspense`
  - this applies DECISION-251 to the developer tree
- **The Brand Is a Cascade Override: unchanged.**
  - The portal is platform palette, and `check:brand-scope` is unchanged.
  - New pages use primitives (C2).
  - The `.reg` palette stays on data-model pages for now (Q8), with a tracked follow-up.
- **A Custom Host Is a Key, Not an Identity: satisfied by construction.** On a custom host the proxy's first branch rewrites `/developer/*` to `/site/<host>/developer…` before any platform logic runs. This answers the survey's "must 404 on a custom host".
- **Isolation Is a Database Property.**
  - Every portal read uses `db` (`presby_app`). `getPlatformDb()` is banned in the developer tree.
  - Every table it reads carries no RLS. `presby_app` holds SELECT only on `roles`, `role_features` and `features` (live: `aclexplode`), and full CRUD on `user_roles`/`users`, which the existing role actions need.
  - The survey's "read through `getPlatformDb()`" is overridden: least privilege wins.
- **No Real Data.** `COMMENT ON` text, registry rows and any example on the API page follow `seed-dev.sql` style. Paths use patterns (`/o/[slug]/…`), never slugs, hosts or IDs.
- **Verify in a Browser.** Every increment walks each page at 360px (G13).

## Notes: rulings on the nine handoff items

### Ruling 1: the key (handoff 1)

**Constants.**

- `developer.portal` is a platform key declared in `src/lib/permissions.ts`, but **not** in `FEATURES` or `FEATURE_CATALOG`.
- Declare `DEVELOPER_ROLE = "developer"` beside `ADMIN_ROLE` and `SUPPORT_OPERATOR_ROLE`.
- Declare `DEVELOPER_PORTAL_KEY = "developer.portal" as const`, with a doc comment explaining that it is outside `FEATURES` on purpose.

This is consistent with "frozen". The freeze bars church-facing additions, and the precedent is `ADMIN_TICKETS` plus DECISION-253's copy-only change.

**What staying out of `FEATURES` buys:**

- The admin JWT wildcard (`FEATURE_KEYS`) and `bindAdminFeatures()` never carry the key.
- `hasFeature(…, DEVELOPER_PORTAL_KEY)` does not typecheck, because `FeatureKey` excludes it. Nobody can gate on a stale claim by accident.
- The proxy's vocabulary cannot reach it.

**The `features` row.** The key still gets a row in `features`, so `role_features` keeps its FK. The binding is data like every other binding.

**Known residual (`paper`, harmless).** The non-admin branch of the `auth.ts` jwt callback joins through `features`. A developer-role holder's `token.features` will therefore contain the string `developer.portal`. Nothing may read it. Do not filter it in `auth.ts`, because that would make the increment auth-touching for no gain.

**Rejected alternatives:**

- **Gating on the role name.** The schema comment says features are the runtime unit. `ADMIN_ROLE` is the only role-name check, and it should not get a sibling.
- **A `users` column.** That repeats F286: no grant path and no audit.
- **Putting the key in `FEATURES` and carving the admin role out.** That changes the wildcard contract in `auth.ts` and the seed, and still leaves a typed claim.

**Required tests:**

- `DEVELOPER_PORTAL_KEY ∉ Object.values(FEATURES)`.
- After seeding, the only `role_features` row for the key belongs to the `developer` role. This is a DB-backed test plus the runbook's verification query.

### Ruling 2: the live predicate (handoff 2)

**The function.**

- `readCanAccessDeveloper(userId): Promise<boolean>` lives in `src/lib/platform-admin.ts`.
- It is one round trip: `users.is_platform_admin` is true, **or** `exists` a `user_roles` row joined to `role_features` on `role_id` where `feature_key = DEVELOPER_PORTAL_KEY`. The join to `roles` is unnecessary.
- It uses the query builder, not raw SQL.
- It must not short-circuit on `ADMIN_ROLE`.

**Fail closed by throwing.** A missing role row or key row means zero rows, which means false. A database error **throws**, and each caller denies in its own way:

| Caller | On error |
|---|---|
| The gate | Calm "We can't check your access right now" |
| `/launch` | Its existing `OrganizationsUnavailable` branch |
| Chrome, avatar menu, `/home` card | `.catch(() => false)`, which hides the link |

`/launch` depends on the throw. A predicate that swallowed the error into `false` would route a developer to `/no-organization` during a blip.

**What callers can and cannot reach.**

- `readIsPlatformAdmin` stops being exported in Inc 2. No caller can compose the two inputs itself, as DECISION-044 intends.
- `cachedIsPlatformAdmin` in `nav-data.ts` becomes `cachedCanAccessDeveloper`.
- The `AvatarMenu`/`/home`/padmin-layout prop `isPlatformAdmin` is renamed `canAccessDeveloper`.

**Required tests (DB-backed):**

- an admin-role user without the column and without the role gets `false`
- a revoke mid-session gets `false` on the next call (G7/F287)
- an injected error throws

### Ruling 3: 2FA, both layers (handoff 3)

**(a) Proxy.** Add `pathname === "/developer" || pathname.startsWith("/developer/")` to `isTwoFactorGated`.

- Use the segment-boundary form, not a bare `startsWith`.
- Update the proxy's fall-through comment.
- Add `proxy.test.ts` rows for:
  - `/developer`
  - `/developer/tables/x`
  - `/developer/schema.json`, which redirects to `/totp` when 2FA is required and unverified
  - a verified non-admin passing through
  - `/developerx` not gated, to pin the boundary

**(b) Page gate.** The co-located gate runs in this order:

1. No session redirects to `/signin?callbackUrl=<literal /developer… path>`.
2. Required and unverified redirects to `/totp?callbackUrl=<same literal>`.
3. The live predicate runs inside a try that wraps **only** the read, per the `/launch` precedent: `redirect()` throws.
4. The gate returns a discriminated result: `ok`, `forbidden` or `unavailable`.
5. The page renders `AdminForbidden` (area "the developer portal") or the calm unavailable state.

**What the gate must not do.** It must not silently redirect to `/home` (G9/G12). Every page calls the gate **before** reading params or calling `notFound()`, so a non-entitled user sees the same answer for `/developer/tables/<anything>`.

**The layout decides chrome only.** It renders the header always, renders the section nav only when the live read is true (a catch yields no nav), and always renders `children`. Access is decided by the page. A layout persists across soft navigations, so it cannot be the gate.

**(c) `schema.json`.** The proxy gate covers it too: a browser user goes to `/totp` and comes back, which is correct for the only real consumer (a session-cookie browser). The handler also checks independently and answers JSON:

| Condition | Response |
|---|---|
| No session | `401 {error:"unauthorized"}` |
| 2FA required and unverified | `403 {error:"two_factor_required"}` |
| Not entitled | `403 {error:"forbidden"}` |
| Database error | `503 {error:"unavailable"}`, fail closed |

All responses are `no-store`. Drop the "AI support worker" comment (Q10/G14).

**(d) MFA e2e gate.** Inc 1 edits `src/proxy.ts`, so the CLAUDE.md Phase 4 running-server e2e smoke applies:

- the full login path with an MFA-enrolled seeded user
- a new spec: a required-but-unverified user opening `/developer/tables/roll_actions` lands on `/totp` and returns to that path
- Phase 5 `PASS` requires it against a real dev server on port 3570; deferred means `BLOCKED`

By ruling, the gate also applies to **Inc 2**. It does not touch the listed files, but it changes post-login routing for a new class of user, and its Phase 6 walk is as an MFA-enrolled developer.

### Ruling 4: the shell (handoff 4)

**Promote the nav and header to `shared/`.** DECISION-253's own revisit trigger fires: "a second consumer appears for a collapsing-nav primitive (then promote it to `shared/`)".

- Promote `AdminNavLinks`, `AdminMobileMenu`, `AdminNav` and `AdminHeader` to `src/components/shared/` under console-neutral names (Phase 3 picks them).
- Parameterize them with **required** props, no defaults, so each caller states them:
  - the console label, which is hard-coded "Platform admin" today in the header, the sheet title and both `aria-label`s
  - the id prefix, hard-coded `admin-nav-` today
  - the main-landmark id
  - `canAccessAdmin`, which `AdminHeader` hard-codes `true` today. A developer-only viewer would otherwise see an Admin avatar link the proxy bounces to `/access-pending`.
- The Menu button does not render when `groups` is empty. This is the forbidden-state chrome.
- padmin's existing tests move with the files, with no behavior change for `/admin`.

**Do not fork.** Inc 1 Phase 4 starts only after padmin's 0.43.0 (6b49fd4) is on `main` and merged into `pipeline/developer-portal`.

**Pre-approved fallback.** padmin Inc 2–4 are all at Phase 3 Pending and will touch these files. The orchestrator should give padmin Inc 2's Phase 3 the promoted paths.

- If a padmin Phase 4 is already editing them when devportal Inc 1 reaches Phase 4, parameterize the components **in place** in `admin-portal/` with the same required props.
- Record the promotion in `docs/TODO.md`.
- No loop-back is needed for this fallback.

**`AdminForbidden`: reused as is, imported from `admin-portal/`.**

- Its sentence with area "the developer portal" is exactly the analyst's copy, so there is one state and no hand-copied sentence (U3).
- It stays out of `shared/` for its DECISION-040 reason, and its doc comment gains one line naming the second platform consumer.
- Add a scan: `(org)` and `(public)` never import from `@/components/admin-portal/`.
- The "can't check your access" state is new. Phase 3 decides whether it is a `shared/` sibling of `OrganizationsUnavailable` or reuses padmin's `LoadError`. Prefer reuse.

**Nav registry.** The developer registry, `src/lib/developer-portal/nav.ts`, is pure data and unfiltered: every entitled viewer sees every item.

**The portal never appears in the admin left nav** (DECISION-044, padmin Phase 1). The way back to `/admin` is the avatar menu, gated on `canAccessAdmin`. Suggestion: no extra header link, because the avatar menu already covers it.

### Ruling 5: the `/launch` matrix (handoff 5)

**Rename the input, do not add one.** In `DestinationInput`, `isPlatformAdmin` becomes `canAccessDeveloper` (the composite). A third input would let a caller compose the predicates, which DECISION-044 forbids. `destination.ts` keeps zero imports.

**The matrix.** `platform = canAccessAdmin || canAccessDeveloper`. Row 4 becomes `enterable = 0 && canAccessAdmin && !canAccessDeveloper`, which goes to `/admin`.

**Required tests:** the full truth table, with `requestedPath = null`.

| Enterable orgs | `canAccessAdmin` | `canAccessDeveloper` | Destination |
|---|---|---|---|
| 0 | no | no | `/no-organization` |
| 0 | yes | no | `/admin` |
| 0 | no | yes | `/home` (G6) |
| 0 | yes | yes | `/home` |
| 1 | no | no | `/o/<slug>` |
| 1 | any other combination | | `/home` (Q6) |
| 2 | any | any | `/home` |

Plus:

- `requestedPath = /developer/tables/x` passes through (it is not an org path; the page gates)
- the existing `/launch` loop guard and the non-enterable-slug rows

`/launch/page.tsx` swaps `readIsPlatformAdmin` for `readCanAccessDeveloper` inside the existing `Promise.all`/catch. CLAUDE.md's Post-Login Landing table is updated at Phase 6.

### Ruling 6: production seeding, no migration (handoff 6)

**Migration 0071 is not needed. Release the number.**

`roles`, `features` and `role_features` are global catalogs that `presby_app` can only SELECT (0048). They are seeded by the idempotent `scripts/seed.ts` on the owner connection, and that is the documented production step (`docs/deployment.md` step 5).

**Seed changes:**

- `seedRoles()` adds `developer`: `isSystem: true`, a `description` stating "Opens the developer portal. Grants nothing else." (G10), and a `sortOrder` between `support_operator` and `member`.
- A new `seedDeveloperCapability()` inserts the `features` row for `DEVELOPER_PORTAL_KEY` (`seedFeatures` iterates `FEATURE_CATALOG` and will not) and binds it to `developer` only.
- `bindAdminFeatures()` is untouched. It iterates `FEATURES`, so it cannot pick the key up.

**Runbook.** Add a `deployment.md` "Pre-deploy runbook" entry:

- **Order is free.** Without the rows the predicate returns false, so it fails closed, and the `is_platform_admin` path is unaffected.
- **Command:** the seed with every `SEED_*`/`INITIAL_ADMIN_EMAILS` variable empty.
- **Verification query:** the only `role_features` row for `developer.portal` belongs to `developer`.

**Test fixtures.** An e2e fixture for a developer-role user (with and without MFA, zero orgs and one org) uses the person-id range the orchestrator pre-assigns (Rule 16).

### Ruling 7: tripwires (handoff 7)

**All of these are vitest tests, co-located, and none joins `npm run check`.**

- They import TypeScript modules (the schema, registries, `vercel.json`, `CRON_PATHS`) and run on every PR without a database.
- `npm run check` stays the repo-wide `.mjs` source tripwires.
- padmin's `shell-boundaries.test.ts` is the precedent.

| Test | Pins | Increment |
|---|---|---|
| `src/lib/dev-docs.test.ts`, module map | Every `pgTable` export in `schema.ts` and `domain/**` is in `MODULES` or on a closed, reasoned platform list. A new table fails until it is classified (the `contract.ts` model). | 1 (F283) |
| `src/lib/dev-docs.test.ts`, invariants | Every `### ` heading under `## Key Invariants` in CLAUDE.md is in `INVARIANTS` or on a closed "not listed" list, each with a reason. The failure message tells the CLAUDE.md editor what to do. Also: the enforcement vocabulary matches CLAUDE.md's `database`/`trigger`/`paper`; today's code says `documented`. | 1 (F285) |
| `src/app/(admin)/developer/shell-boundaries.test.ts` | Every `page.tsx`/`route.ts` under the tree calls the gate before any `params` read or `notFound()`. Every `callbackUrl` is a literal `/developer` prefix. No `loading.tsx`. No `getPlatformDb`. `@/` imports are **allow-only over a closed module list** (no `@/lib/authz`, no `@/lib/db/domain/*`; `@/lib/db` only in the readers). `(org)`/`(public)` do not import `admin-portal/`. `authz.ts` and `domain/**` never name the developer constants. | 1, extended in 3 |
| `src/lib/developer-portal/api-inventory.test.ts` | Set equality between the registry and the walked `src/app/**/route.ts` files (19 today; route groups stripped to a path pattern), **including each file's exported HTTP methods**. Cron entries equal `vercel.json` (path and schedule) and `CRON_PATHS`. A new route cannot ship unlisted, and a deleted one cannot linger. | 3 |
| Tenant-data boundary (the readers) | See below. | 3 |

**The readers scan, and what padmin's saga teaches.** Do not write a second parser. padmin's 876-line scan needed four loop-backs because it tried to recognise forbidden SQL positions. The lessons that hold:

- **Allow-only, not deny-lists.** State what is permitted.
- **Closed name sets.** Every `pgTable` name, read at test time.
- **Shrink the surface.** Concentrate database access in as few files as possible.

So the rules are:

1. The portal's database access is confined to three things:
   - `dev-docs.loadDescriptions`, which reads `pg_catalog` only
   - the predicate in `platform-admin.ts`
   - `src/lib/developer-portal/readers.ts`: `feature_flags` key and description only, never `enabled` (Q11), plus the global `permissions` catalog
2. Extract padmin's closed-name-set and allow-only checks into a parameterized test helper (`src/test-support/`, name for Phase 3). padmin's test becomes a caller with identical allow-lists, and its synthetic-offender suite stays.
3. Run the helper over `src/lib/developer-portal/` with the allow-list `{feature_flags, permissions}`.

If the extraction proves costly in Phase 4, the pre-approved fallback is the import allow-list above plus a literal-table-name check on the one readers file.

**Honest residual (`paper`).** Quote DECISION-252's four classes verbatim: a computed access, a runtime-assembled name, a helper module outside the scanned set, and a deliberately evasive reader. Review and the retrospective are the control.

### Ruling 8: runtime `docs/*.md` (handoff 8, Increment 4 only)

**Do not rely on the implicit trace.**

- `/admin/docs` reads `process.cwd()/docs/release-notes` with no `outputFileTracingIncludes` entry. Whether Vercel's tracer picks that up is **unverified** from here.
- `next start` locally is not evidence, because the working directory there contains the whole repo.

**Inc 4 requirements:**

- An explicit `outputFileTracingIncludes` key for the docs route, naming a **closed file list**. Never a directory glob: `docs/work-log/**` and `docs/reviews/**` are not portal content.
- Phase 5 verification on a Vercel preview deployment.
- `react-markdown` + `remark-gfm` **without** `rehype-raw`, so raw HTML in a long `decisions.md` is not interpreted.
- Inc 4 also confirms that `/admin/docs` works in production, as the existence proof.
- **Alternative:** a build-time import of the content, if Phase 3 for Inc 4 prefers it.

### Ruling 9: research fold-in (handoff 9, Q14)

No section is added to Increment 1. Reconciliation of the survey (`docs/research/2026-10-25-developer-portal-survey.md`):

| Survey item | Ruling |
|---|---|
| Home routes by task; invariants board as its own page; flags/permissions page; API page states "no public API" | Adopted. These are the analyst's Home, Rules, Access and API pages. |
| Keep the gate on `is_platform_admin` | Superseded by Q1. The live composite keeps its intent: live, never `canAccessAdmin`. |
| Read through `getPlatformDb()` | Overridden: `db` only (least privilege; no RLS on the tables read). |
| Show env-var names and presence | **Rejected.** The analyst's stricter rule holds: mechanism classes only ("shared bearer secret", "Stripe signature", "GitHub Actions OIDC", "session"). No env-var or header names, no presence, no values, no realistic payloads, no try-it console, no live probes. |
| API page generated from code | A hand registry plus set-equality (Ruling 7) gives the same no-drift property, and code generation cannot write "how it is protected". |
| Server actions inventory with audit actions | Declined (Q13), with one sentence on the page. **Optional for Inc 3:** list `AUDIT_ACTIONS` keys on the Access page as definitions only. |
| "Future public API" design-intent section | **Not in the UI.** It reads as a promise. PCO and CCB lessons become constraints any future public-API pipeline must meet, recorded in DECISION-260 and a `docs/TODO.md` line, not displayed: the congregation as consent boundary, scopes mapped to privacy tiers, no Breeze-style account-wide key, date versioning, signed webhooks. |
| Phase B: split into a public portal | Recorded in DECISION-258. `/developer` is the internal portal for good. A future public developer surface is a separate public route on a platform host, never this tree made public. |
| Placeholders: getting started, runbooks, changelog, security and data handling | Adopted as Documentation rows, alongside the analyst's architecture overview, decisions and status. |
| Placeholders: rate limits, SDKs, webhooks and events | **Excluded.** They imply a public API. |
| Diátaxis mode per document | **Suggestion:** tag each Documentation row tutorial, how-to, reference or explanation. Cheap and honest. |
| "What changed" strip from release notes | Deferred to Inc 4. It needs Ruling 8, and `/admin/docs` is behind `ADMIN_RELEASE_NOTES`. The running version already shows in the shell's nav foot (`APP_VERSION`). |
| Environment info: migration journal head | **Rejected.** The `__drizzle_migrations` ledger is 10 rows on both databases (`deployment.md`), so a journal head would misstate what is applied. |
| Links to Vercel and Neon dashboards, tripwire status | **Rejected.** Dashboard URLs name the team and project; tripwire status is not known at runtime. |
| Subsystem catalog (Backstage) | Deferred to Inc 4 (architecture overview). If built, it is pinned to `docs/architecture.md` headings the way `INVARIANTS` is pinned to CLAUDE.md. |
| Portal 404s on a custom host | Already true by construction. |

### API page enumeration and redaction (confirmed for Inc 3)

- **Paths:** patterns only: `/o/[slug]/…`, `/site/[slug]/…`, `[id]`, `[key]`.
- **Never shown:**
  - which organizations have domains, sites or giving
  - per-org anything
  - environment or header names
- **The page is static:** no data read, no failure state.
- **Gate before anything:** the page calls the gate first like every other page.

### Proposed decisions (architect-owned; the orchestrator records them)

**DECISION-258: The developer portal is an internal engineering portal in the existing `(admin)/developer` tree.**

- **Information architecture.** Home, Data model, API, Rules, Access and Documentation, with provenance labels: `Generated`, `Tested list`, `Written by hand`, `Planned`.
- **Stable URLs.** Existing URLs are kept.
- **Placeholders.** One Documentation placeholder page. No empty routes and no status route.
- **Gate order.** Every page gates before it reads params or calls `notFound()`.
- **No `loading.tsx`** anywhere in the tree. `error.tsx` shows calm copy.
- **2FA in two layers:**
  - the proxy uses a segment-boundary prefix
  - the page gate repeats the check
  - `schema.json` answers JSON 401/403/503 itself
- **Internal for good.** `/developer` is never made public. A future public developer surface is separate.

**DECISION-259: The developer capability is the `developer` role bound to `developer.portal`, read live. Amends DECISION-044.**

- **Outside `FEATURES`.** `DEVELOPER_PORTAL_KEY` and `DEVELOPER_ROLE` live in `permissions.ts` outside `FEATURES` and `FEATURE_CATALOG`, so neither the admin JWT wildcard nor `bindAdminFeatures()` carries the key.
- **The predicate.** `readCanAccessDeveloper` in `platform-admin.ts` is `is_platform_admin` OR a role bound to the key. It throws on error and every caller denies. `readIsPlatformAdmin` becomes module-private.
- **Platform predicates.** They are now `canAccessAdmin` (claims, enforced by the proxy) and `canAccessDeveloper` (live).
- **Seeding.** Seeded by `scripts/seed.ts`, with no migration.
- **No tenant authority.** The role confers none.
- **Accepted residuals:**
  - the unread `developer.portal` string in a developer-role holder's JWT
  - portal reads are not audited (Q9)
  - a self-grant is permitted, audited, and marked `selfTargeted` (G11)

**DECISION-260: The portal's hand-written lists are tested registries.**

- **What is tested:**
  - route and cron set-equality, including exported methods
  - `MODULES` completeness
  - `INVARIANTS` coverage against CLAUDE.md
  - a gate-call, no-`loading.tsx` and allow-only import scan of the tree
  - a tenant-data boundary scan of the one readers module, using padmin's checks extracted into a parameterized helper
- **Where they run.** Vitest, not `npm run check`.
- **Redaction.** The API page shows mechanism classes only.
- **Accepted residual.** DECISION-252's four `paper` classes, quoted.
- **Future public API.** The constraints from the research are recorded, not displayed.

**DECISION-261: The second-consumer trigger of DECISION-253 fires.**

- **Promotion.** The collapsing console nav and header move to `src/components/shared/`. Label, id prefix, main id and `canAccessAdmin` are required props.
- **`AdminForbidden`** stays in `admin-portal/` and is reused by import.
- **Nav registry.** The developer nav registry is pure data in `src/lib/developer-portal/nav.ts`.
- **`.reg` palette.** It stays on data-model pages with a tracked follow-up (Q8).
- **Pre-approved fallback.** Parameterize in place if a padmin Phase 4 holds the files.

### Other things Phase 3 and the orchestrator must honor

- **The guard's `forbidden` and `unavailable` states render with HTTP 200.** That is acceptable on a platform page, which has no enumeration surface. QA should not file it.
- **Audit (G11/F286).** `assignRoleAction` records `roleName` as well as `roleId`, and `selfTargeted` when actor equals target. `check:audit` already covers both actions.
- **`/admin/users` copy (G10).** One line saying Admins do not get the developer portal automatically. The role's `description` comes from the seed.
- **Doc edits at Phase 6 (orchestrator):**
  - CLAUDE.md Project Layout line for `src/app/(admin)/developer/`: "the developer portal" instead of "generated schema reference"
  - the Post-Login Landing table and predicate paragraph
  - the Permissions vs Flags paragraph (live-read capability)
  - a route-group rule line in `.claude/agents/architect.md`: "`(admin)/developer`: `canAccessDeveloper`, read live; the proxy enforces auth and 2FA; every page gates itself; platform palette"
  - Rule 15: one sentence in `docs/architecture.md` on the developer role as a platform-axis capability
- **The worktree has no `.env.local`.** Rule 16 requires a pipeline Neon branch before any DB-backed Phase 4 work or tests. The orchestrator creates it at the Phase 4 kickoff; dev port 3570.
- **Live-catalog read scope.** It was against `development` only. Production carries the same 0048 grants as a shipped migration, but that was not read directly. The runbook's verification query is the production check.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete. Nine items ruled. A1 (admin role bound to every `FEATURES` key) fixed by keeping the key outside `FEATURES`. No migration (0071 released). DECISION-258–261 drafted. Research reconciled. | Approved with suggestions | 2026-10-25 |

## Handoff

**Next agent: tech-lead (Phase 3)**, for Increment 1 first: frame, 2FA two-layer, shell promotion, `MODULES`/`INVARIANTS` tests, and the gate rewritten with the old predicate. Inc 2 swaps the predicate inside the one function.

Phase 3 for Inc 1 can design against padmin's branch files (`/Users/cshenso/git/presby-platform/presby-padmin/src/components/admin-portal/`). Phase 4 waits for 0.43.0 on `main`.

Phase 3 must:

- carry every ruling above into the Carry-forward table
- treat A1 as part of F287
- confirm the e2e fixture person-id range with the orchestrator

**Files read:** in `/Users/cshenso/git/presby-platform/presby-devportal/`:

- `docs/work-log/2026-10-25-developer-portal.md`
- `docs/research/2026-10-25-developer-portal-survey.md`
- `src/app/(admin)/developer/{guard.ts,schema.json/route.ts}` and the tree listing
- `src/lib/{platform-admin.ts,permissions.ts,permissions.test.ts,nav-data.ts,tickets-notifications.ts,dev-docs.ts}`
- `src/proxy.ts`
- `src/auth.ts` (jwt callback)
- `src/app/launch/{destination.ts,page.tsx}`
- `src/components/shared/global-nav.tsx`
- `src/app/(admin)/admin/users/actions.ts`
- `src/app/(admin)/admin/docs/page.tsx`
- `src/lib/db/schema.ts` (roles block)
- `scripts/seed.ts`
- `drizzle/0048_presby_security_b.sql`
- `next.config.ts`, `vercel.json`, `src/lib/domains/cron-passthrough.ts`
- `docs/deployment.md` (catalog seeding)

In `/Users/cshenso/git/presby-platform/presby-padmin/`:

- `src/components/admin-portal/*`
- `src/lib/admin-portal/nav.ts`
- `src/lib/admin-portal/dashboard/boundaries.test.ts`
- `src/app/(admin)/admin/layout.tsx`
- `docs/decisions.md` (DECISION-251/252/253/255)
- the Per-Phase Status of the Inc 2–4 work-logs

**Live catalog:** read on `development` as `neondb_owner` in a read-only session: `pg_class` RLS flags, `aclexplode(relacl)` for `presby_app`, `pg_policies`, `pg_trigger`, plus the `roles`, `features` and `role_features` rows.

---

# Phases 3–6 — carried by one child work-log per shipped increment

Per CLAUDE.md Per-Feature Tracking, this parent keeps the shared Phase 1 and Phase 2 above (verbatim) and the operator's rulings below. Phase 3 (design), Phase 4 (implementation), Phase 5 (verification) and Phase 6 (shipped vs intent) are recorded in the child for each increment. The Increment 1 child also records the Phase 3 conventions every later increment inherits (gate shape, shell props, test layout, the Copy four-check form, the Carry-forward table, which names every Phase 1 gap, Phase 2 ruling and open question against the increment that carries it).

| Increment | Scope | Child work-log | Phase 3 | Phase 4–6 | Migration |
|---|---|---|---|---|---|
| 1. Frame and hardening | Portal layout (chrome only), `error.tsx`, no `loading.tsx`; home with provenance-labelled cards; Data model moved with its URLs kept; Documentation placeholder page; the one gate (`ok`/`forbidden`/`unavailable`) on the existing `is_platform_admin` predicate; the proxy 2FA line and the page-level 2FA check; `schema.json` JSON 401/403/503; shell promotion to `src/components/shared/`; `MODULES` completeness and `INVARIANTS`-vs-CLAUDE.md tests and their data repairs; the shell-boundaries scan; 44px targets and 360px | `2026-10-25-developer-portal-inc1.md` | Complete 2026-10-25 | Pending | none |
| 2. The developer role | `developer` role and `developer.portal` key outside `FEATURES`; `readCanAccessDeveloper` (live, throws); `/launch` matrix; avatar menu and `/home` card; production seeding and runbook; audit metadata; `/admin/users` copy; MFA e2e gate and the Phase 6 walk as the person the grant creates | `2026-10-25-developer-portal-inc2.md` | Pending | Pending | none (0071 released, Ruling 6) |
| 3. The API page, Rules and Access | Tested route and cron registry and its set-equality test; `/developer/api`; `/developer/rules`; `/developer/access`; the readers module and the tenant-data boundary scan; home cards and counts | `2026-10-25-developer-portal-inc3.md` | Pending | Pending | none |
| 4. Real documentation | Rendered decisions, runbooks, changelog and architecture overview; Ruling 8 file inclusion | `2026-10-25-developer-portal-inc4.md` | Pending | Pending | none |

Numbers carried: Increment 1 — DECISION-258, 261; F283, F284, F285, F288 (F288 moved here from Increment 3 because the orchestrator's Increment 1 scope contains its two halves: the gate's failure states and the `schema.json` comment/JSON statuses). Increment 2 — DECISION-259; F286, F287 (A1 under F287). Increment 3 — DECISION-260. Increment 4 — none.

## Operator request (2026-10-25, verbatim)

> we can probably also take pass at the developer portal design.  i think it goes directly to the database schema.  it really needs its own portal home and placeholders for future developer documentation.  we need an api page and do some reasearch on other developer features that are usually on a developer page

Related standing requirement (platform admin redesign, 2026-10-25): "the same thought and care with the ux should be used as with the org portal. same ux principals".

## Operator addition (2026-10-25, verbatim)

> the developer page should be accessible by someone with the role of developer.  could be part of any orgatization

## Orchestrator rulings (2026-10-25)

- Q1: confirmed from the operator quote — a platform-axis `developer` role assigned at `/admin/users`, independent of any organization.
- Q2–Q14 proceed on the analyst defaults.
- The research survey is committed with this pipeline at `docs/research/2026-10-25-developer-portal-survey.md` (verified free of real data by `check:secrets` at commit time).

## Orchestrator (2026-10-25)

- e2e fixture person-id range for developer-role users: ids prefixed `00000000-0000-4258-`.
- Migration 0071 released (not needed).

## Operator ruling (2026-10-26): what the API page is

Asked after Increment 1's Phase 6: "What should the developer portal's API page be?" — **Internal inventory.** List the internal endpoints and scheduled jobs with what each does and how it is protected, say plainly "PresbyPortal has no public API", and keep the list in sync with the code by test. This confirms Phase 1's interpretation for Increment 3; a public API is not planned.

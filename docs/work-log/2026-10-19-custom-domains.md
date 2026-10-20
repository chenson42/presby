# Connect your domain (Track F): custom web domains, then church mail domains — Work Log

> **Slug:** `2026-10-19-custom-domains`
> **Surface:** mixed — public sites on custom hosts; org admin "connect your domain" checklist; platform admin oversight
> **Permission(s):** TBD in Phase 1 (likely a tenant key for managing the org's domain; platform-admin path for oversight)
> **Flag(s):** no new platform flag (operator, 2026-10-14: per-org on/off toggle via ORG_FEATURE_CATALOG instead)
> **Estimated complexity:** large
> **Pipeline mode:** Full — one work-log, two increments (1: web domains, 2: mail domains) as Phase 4 batches

## Kickoff (orchestrator, 2026-10-19)

**Value.** A congregation's public website must live at its own domain, not `presbyportal.org/site/<slug>`. Two real needs drive it: the first go-live customer owns a domain (registered and DNS-hosted at Cloudflare) and wants its site served there, and the FPCW cutover requires the existing domain to keep working on day one (`docs/TODO.md` Track F, "HARD BLOCKER"). Churches either bring a domain they already have or acquire one later; both paths share one org-domain record. Church-originated email should come from the church's own domain too.

**Operator intent (verbatim, 2026-10-19):** "when we send automated emails on the platform from resend.io, they should probably be coming from the church's domain. as part of provisioning, is there a way to programitically provision resend as well for the new domains? i expect that churchs might go get their own domain or bring it with them. we would need to ask them to make dns entries." Agreed shape (recorded in `docs/TODO.md` Track F): one per-org DNS checklist covering the web and mail records with per-record status; never block on DNS — until verified, church mail sends from the platform domain as "<Church> via PresbyPortal" with Reply-To the church office; church-originated mail (invitations, statement notices, event/roll notices) moves to the church domain once verified; **account mail (sign-in, reset, 2FA, verification) stays on the platform domain**; DNS verification is the ownership proof; per-domain bounce/complaint tracking with automatic fallback; Resend domain removed on departure or domain change; Resend plan Pro or higher; Cloudflare-API auto-DNS is a later option.

**Known constraints to carry into Phase 1–2:** host→org resolution cannot live in `src/proxy.ts` (the Edge cannot reach the database); DECISION-041 designed custom domains but `organization_sites` has no domain column; the slug is immutable and remains the canonical platform URL; the brand is a cascade override scoped to `(org)` and `(public)/site/<slug>`; DECISION-040's enumeration-safety rule (which congregations are tenants must not leak — including via a host that resolves vs one that doesn't); Vercel holds the TLS/domain attachment (the Vercel project lives in the `community-collective` team; domains are attached by API); Resend's `POST /domains` returns DKIM (`resend._domainkey`) plus SPF/bounce-MX on a `send.` return-path subdomain (none touch the root SPF/MX); the Resend key is full-access in PresbyPortal's own team (`docs/deployment.md`). No real congregation names or domains in any tracked file — fixtures use `*.invalid` hosts.

**Pre-assigned numbers (Rule 16):** migrations `0057`–`0058`; `DECISION-176`–`DECISION-182`; findings `F146`–`F152`. Worktree `presby-domains`, branch `pipeline/custom-domains`; a Neon child branch is created before Phase 4 (Phases 1–3 are read-only).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-19 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-19 |
| 3 — Technical design | tech-lead | Complete (architect addendum A1–A6 folded 2026-10-19) | Design complete; implementers named; T1–T7 confirmed by the architect; Batch 1a-i ready for database-admin | 2026-10-19 |
| 4 — Implementation | 1a-i database-admin → 1a-ii full-stack-developer · 1b full-stack-developer · 1c full-stack-developer (after PR #31 + rebase) · 1d ux-developer · 2a database-admin → api-developer · 2b, 2c api-developer | In progress: **Batch 1a-i complete** (database-admin; `0057` applied twice to `pipeline-custom-domains`, test-rls-47 114/114 as `presby_app`, stock suite unchanged vs baseline); **Batch 1a-ii complete** (full-stack-developer; `src/lib/domains/` service, DNS adapter, tenant and platform actions, catalog/tile/bundle edits; typecheck, lint, `npm run check`, build green; test-rls-47 still 114/114); 1b next | — | 2026-10-19 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*2026-10-19, analyst (read-only; recorded verbatim by the orchestrator).*

## VERDICT

**READY WITH NOTES**

The feature shape is sound and the web-before-mail split is right. Nothing needs to go back to the operator before Phase 2. But the request leaves 32 gaps (G1–G32) and 12 operator questions. Several of the gaps are security-shaped and would be expensive to retrofit:
- domain takeover after a lapse (G9, G10)
- squatting and capacity exhaustion (G1, G14)
- the reputation-vs-fallback conflict in mail (G21)
- serving platform routes and cookies on a foreign host (G6)

Phase 2 and 3 must carry these as inputs, not suggestions. Open Questions Q1–Q4 need operator answers before Phase 3 closes.

## ONE-LINE TAKE

> A church's admin proves it owns a domain, we serve only that church's public site there (clean paths, nothing else from the platform, no cookies), and later its church-originated email is sent from the same domain. The hard parts are the unclaimed-host response, takeover after a lapse, and keeping one church's mail reputation from taking down everyone's sign-in email.

## Key findings (read these first)

1. **A custom host is not an identity.** It is only a lookup key, trusted if and only if it matches a verified row. Everything else on a non-platform host must be a byte-identical 404. That includes `/api/*`, which `proxy.ts` bypasses unconditionally today, and `/signin`, `/file-statistics`, `/forgot-password` and `/reset-password`, which are in `PUBLIC_PATHS` (G6).
2. **TXT proof is a persistent record, not a one-time check.** Takeover after a lapse is the real threat. When a church's domain expires and a new registrant points an A record at Vercel, the domain is still attached to our project with a valid certificate. We would serve the old church's site on the stranger's domain. Only a continuously re-checked ownership TXT stops that (G9).
3. **Fallback to the platform sender is right for infrastructure failure and wrong for reputation failure.** If a church's list is bouncing, moving that mail onto `presbyportal.org` poisons sign-in and reset mail for everyone. Reputation breaches must pause and hold that org's church-originated mail (G21).
4. **The mail increment has almost no senders today.** The only church-originated mail on `main` is `statistics_submission_grant`, sent by a presbytery. The statement notice arrives with PR #31. Invitations and event/roll notices do not exist yet. The increment is real, but it should ship as a sender-resolution mechanism with a closed registry (G20).
5. **The site renderer hardcodes `/site/<slug>` in about eight places.** These are `pageUrl`, `imageUrl`, `logoUrl`, canonical and OG, sitemap, `portalUrl`, the give back-link, and giving return URLs. Pages, assets and form actions on a custom host need clean host-relative paths (G5).
6. **`robots.ts` would de-index every custom-host site.** It says `Allow: /site/`, `Disallow: /`, and the root layout is `noindex` platform-wide. The custom host's clean paths would be disallowed (G8).

## User Verbs

| Surface | Who | Verb | Cadence |
|---|---|---|---|
| Org admin (`/o/<slug>/admin/domains`, new) | Holder of `domains.manage` | Enter a domain; pick canonical (`www` vs apex) | One-time, rare change |
| same | same | Read the DNS checklist; copy all records; hand to whoever runs DNS | One-time |
| same | same | Press "Check now" (rate-limited); read per-record status | A few times during setup |
| same | same | Change the canonical host, remove the domain, replace the domain | Rare |
| same | same | Enable/disable mail-from-our-domain (increment 2); set the office Reply-To address | One-time |
| DNS operator (church volunteer, vendor or registrar contact; not necessarily an app user) | Outside the app | Add or delete DNS records at Cloudflare, GoDaddy, etc. | One-time, plus a delete on exit |
| Anonymous visitor | none | Browse the church's site on its own domain, submit the contact form, give (if live) | Constant |
| Anonymous visitor | none | Hit the old `presbyportal.org/site/<slug>` URL or the `apex`/`www` alias and get redirected | Occasional |
| Authenticated member | none | Click "Our Portal" on the church's site; land on the platform host and sign in there | Per session |
| Platform admin (`/admin`) | `FEATURES.ADMIN_ORGANIZATIONS` (reused; see Permissions) | See all domains and their health; pause; force-release; resolve a dispute | On demand |
| Newly-authenticated, no roles | none | None. Nothing in this feature touches `/access-pending`. | |

The cast is: org admin, DNS operator (often a different person), anonymous visitor, platform admin.

## Flows

**Flow 1 — Connect a web domain (org admin, happy path).**
1. The admin opens `/o/<slug>/admin/domains` from the admin hub. The tile shows only if the org toggle is on and the viewer holds `domains.manage`.
2. They type a domain. The server normalizes it: lowercase, strip scheme, path, port and trailing dot, convert IDN to punycode. It rejects the hosts in G2.
3. They pick the canonical host, `www.<d>` or apex. We default to `www`. The other becomes an alias that redirects.
4. **Proof first, no traffic effect.** We show one TXT record at `_presby-challenge.<host>` with a per-claim token. This proves control and touches nothing live. Nothing is attached to Vercel or Resend yet (G1, G14).
5. When the proof verifies, we attach the host to Vercel. The checklist now shows the routing records: A or ALIAS/flattened CNAME for apex, CNAME for `www`. Target values are read back from Vercel's domain-config response, never hardcoded (G12).
6. The church flips DNS. Per-record status updates through automatic re-checks plus "Check now".
7. Vercel issues the certificate once DNS resolves, which takes minutes. Status is "Securing your site…".
8. We make a live end-to-end HTTPS probe. "Live" means a request to the host returned this org's site, not merely "Vercel says configured" (G13). The admin sees "Live" and a link.
- Failure: each record has its own plain-English state (G11). A lookup error reads "We couldn't check right now; try again", never "missing". A Vercel API outage reads "Connecting is temporarily unavailable; your DNS changes are safe to make", with a retry. Nothing is half-attached without a visible state.

**Flow 2 — Cutover of an already-live external site (FPCW day one; the first customer).**
1. Do the proof (Flow 1, steps 1–4) days ahead. The WordPress site is untouched.
2. The checklist runs a pre-flight: the org site is `live`, a render-flag check passes, and the canonical choice is made.
3. On the agreed day, the church flips the A/CNAME records. It also deletes any leftover AAAA records pointing at the old host (G11).
4. There is a short TLS gap before the certificate is issued. The runbook says to lower the TTL a day earlier and to rehearse first on the operator's test domain.
5. Rollback is the church restoring its old records. We never altered them. On our side, "Pause" returns a 404.
- Failure: if the site is not live yet, the pre-flight blocks the flip instruction with "Your site isn't published yet; flip DNS after it is". Without this, the flip turns a working WordPress site into a 404.

**Flow 3 — Visitor on a verified, healthy custom host.**
1. The visitor requests `https://www.church.invalid/about`. Vercel terminates TLS. Host resolution happens in the RSC layer through a narrow lookup, because the Edge cannot reach the database.
2. The page serves exactly that one org's site, gated by the same `getPublishedSite()` check (site live plus `sites.public_render`). Paths are clean (`/about`, `/sitemap.xml`, `/robots.txt`, assets, the contact action, and `/give` if the org has giving). Canonical, OG, sitemap and `robots` all name the custom host, derived from the verified DB row and never from request headers (G5, G8).
3. "Our Portal" is an absolute link to the platform host. Sign-in, sessions and cookies exist only there (G7).
- Failure: anything else on the host returns the one neutral 404 (G6). A DB blip renders the existing fail-closed behavior, and the resolver must not leak whether the host is known.

**Flow 4 — Visitor on the platform slug URL or the alias.**
1. `presbyportal.org/site/<slug>/...` with a verified, healthy custom domain redirects path-preserving to the canonical custom host.
2. `apex` redirects to `www` or the reverse, path-preserving.
3. During a lapse, or with no domain, the slug URL serves the site itself and is self-canonical (the DECISION-041 fail-soft interlock).
- Failure: the redirect status and cache lifetime must not strand visitors if the domain later lapses (G15).

**Flow 5 — Drift and re-verification (a church lets DNS lapse).**
1. A scheduled job re-checks the TXT proof and routing every day and more often while pending. The existing `/api/cron/maintenance` runs daily and `email-queue` every 5 minutes, so the infrastructure exists.
2. A single failed check does not flip status. A debounce or consecutive-failure rule applies. A DNS timeout is "unknown", never "lapsed" (G9).
3. After a sustained miss, status moves to `lapsed`. The host stops serving (neutral 404) and the slug URL becomes self-canonical again. The admin is emailed, and mail falls back per Flow 9.
4. After a grace period, the domain is detached from Vercel (and Resend in increment 2), and the claim is released. The admin is emailed.
- Failure: the admin who owns the lapse is gone. The email goes to all `domains.manage` holders, and the platform admin sees it on the oversight list.

**Flow 6 — Change or remove a domain; org leaves, closes or is suspended.**
1. Removing sets status `released` (or `paused`, if suspended) and serves a 404 on the host. The slug URL stops redirecting.
2. The church sees an offboarding checklist: "Delete these records from your DNS". A scheduled check warns while records still point at us (G10).
3. The mail domain is removed from Resend after sender resolution has been switched to the platform sender (G22).
- Failure: Vercel or Resend detach fails. The state is `release_pending` with a retry, and the claim is not freed until the detach succeeds.

**Flow 7 — Platform admin oversight.**
A list of all domains (host, org, status, last verified, canonical, mail state, bounce rates) with Pause, Force-release (reason required) and Dispute-resolve (G3). Every action is audited. The platform admin never sees or controls the church's DNS credentials, and gets no tenant authority.

**Flow 8 — Connect a mail domain (increment 2).**
1. In the same checklist, an admin who holds `domains.manage` turns on "Send our email from our domain".
2. Only after our own TXT ownership proof of that name (G14), we call Resend `POST /domains` and show the returned DKIM TXT plus the `send.` return-path SPF and MX. None touch the root SPF/MX, so Workspace or M365 is undisturbed. The UI says so, and says "do not delete your existing MX or SPF".
3. Per-record status comes from Resend's verification states and a "Verify now" call.
4. Until verified, nothing changes: Flow 9's fallback applies. Never block on DNS.
5. Once verified, the admin sets the office Reply-To address (G18) and church-originated mail starts using the church sender.
- Failure: Resend says the domain exists in another team: "This domain is already set up for sending elsewhere; contact support" (G19). The Pro-plan domain cap is reached: "Not available yet; we've been notified", with fallback in effect and an operator alert (G17). Domain unverifiable: pending state, with a re-check schedule and expiry.

**Flow 9 — Send path.**
1. Each outbound mail is classified through a closed registry (G20): `templateKey` → `platform` or `org`. Account mail (sign-in, reset, 2FA, email verification) and platform support-ticket mail are `platform`. Unknown keys default to `platform`.
2. For `org` mail, the sender is resolved **at send time**, not at enqueue time (G22): a verified, healthy mail domain gives `"<Church>" <notifications@church.invalid>` with Reply-To the office address. Otherwise it is `"<Church> via PresbyPortal" <noreply@presbyportal.org>` with Reply-To the office address. If no Reply-To is configured, the display name still says "via PresbyPortal" and the footer says so.
3. Retries after a domain is removed or paused degrade rather than permanently failing.

**Flow 10 — Bounce and complaint breach.**
Per-domain counters fed by the existing Resend webhook, with `email_queue` gaining org/domain attribution (G16). A breach pauses and holds that org's church-originated mail and tells its admins and the platform admin. It never reroutes to the platform sender (G21). Per-recipient hard-bounce suppression is a separate, finer mechanism.

**Flow 11 — Giving on a custom host (PR #31).**
`/give` is platform-owned when giving is live, and falls through to the bundle's `/give` page otherwise. On a custom host:
1. The back-link and the visitor's whole journey stay on the custom host.
2. `success_url` and `cancel_url` currently derive from `NEXT_PUBLIC_APP_URL` (`givingOrigin()`), deliberately never from Host. That rule stands. The donor-facing origin becomes "the verified canonical host for this site, read from the DB, else the platform origin". Treasurer-facing onboarding returns and the statement-notice link (`${origin}/o/<slug>/giving`, a signed-in page) stay on the platform host (G24).
- Failure: if the custom host is not healthy at return time, donors land on the platform's return page, which still works.

**Flow 12 — Two organizations claim the same domain.**
Pending claims never conflict and never reveal anything. The first claim to *verify* wins. The second, once it proves control, is told "this domain is already connected; contact support", with no org named (G3).

## Permissions & Flags

- **Permission (tenant):** new `domains.manage`, tier 1, one key for web and mail. It needs the DECISION-078 constitutional-duty test as a Phase 3 ruling. Following DECISION-101's `brand_admin` precedent, it should **not** bind to `stated_clerk` (domain management isn't a constitutional duty). Bind it to the enumerated `founding_administrator` role, which the founding-administrator era already provisions (DECISION-155). Add a single-purpose role only if a web volunteer must hold it without `roles.manage`; that is a Phase 3 call.
- **Permission (platform):** reuse `FEATURES.ADMIN_ORGANIZATIONS`. It already gates the per-org site/profile admin at `/admin/organizations/[id]`, and a Domains section there plus a cross-org list fits. Minting a new key in the frozen `permissions.ts` should be justified by the architect, not assumed. The platform admin does pause, release and dispute resolution. The platform admin does **not** hold `domains.manage` and cannot toggle mail-from-church on an org's behalf. Sending mail as a church is a representation act, and the platform admin gains no ecclesiastical authority. Whether a platform admin may record a *web* claim on an org's behalf is Open Question Q2.
- **Flags:** **no new platform flag**, per the operator's standing rule.
  - The outer kill switch is the existing `sites.public_render`: if it is off, no custom host serves.
  - Two per-org toggles in `ORG_FEATURE_CATALOG` give the on/off gate and rollback (flag, then org toggle, then permission, DECISION-097). `org_portal.domains` gates web. A **separate** `org_portal.mail_domain` gates mail, because increment 2 ships later and because the toggle is the practical valve for the Resend domain cap. Both default off.
  - The per-domain `paused` state is the immediate rollback: no DNS changes, and the host serves the neutral 404.
- **Self-service vs operator-enabled** toggles is Open Question Q1.

## Gaps the Request Didn't Address

Each is tagged **[A]** (architect must rule), **[D]** (design detail for Phase 3), or **[O]** (operator decision).

**Claim and ownership**
- **G1 [A] Squatting and slot exhaustion.** If "add domain" immediately attaches to Vercel or creates a Resend domain, any org admin can occupy a name they don't own and burn the Resend Pro cap of 10 domains and Vercel's per-project domain limit. A squatted Resend name also blocks the real owner, since Resend domains are globally unique. **Resolution:** attach and provision only after our own TXT ownership proof; cap pending claims per org (suggest 3 web hosts: canonical, alias, one spare; 1 mail domain); expire unproven claims after 7 days.
- **G2 [D] Hostname rules.** Reject: our own platform hosts and any subdomain of `presbyportal.org`, `*.vercel.app`, `localhost`, IP literals, wildcards, public-suffix-only names (needs a PSL check), anything with a port or path, over-length labels, mixed-script IDN lookalikes. Store the normalized punycode form and display the Unicode form. A uniqueness constraint applies to the verified hostname only (partial unique index), so pending claims coexist.
- **G3 [A/D] Dispute and eviction.** Cross-org double-claims need a defined outcome. The first to **verify** wins. The second sees a neutral "already connected" only after it proves control. Pre-proof, the response is identical to a fresh claim (no oracle). A platform-admin eviction is audited with a reason and notifies the evicted org's admins. This is the one place the platform acts across orgs, so it needs a function-mediated or platform-connection path, never a tenant policy.
- **G4 [D] Multiple domains.** Churches commonly own two or three (old name, new name). Model: one org has many domain rows, exactly one canonical for web, others are 308 aliases. Mail uses at most one. The `apex`/`www` pair is the common case. The web host and the mail domain can differ (`www.church.invalid` serves the web; mail is on `church.invalid`), and proof is per DNS name. The kickoff's "one org-domain record" has to reconcile with that. Phase 3 needs to resolve it: one domain with purposes, or one record per host.

**Serving**
- **G5 [A] URL space.** `page.tsx`, `generateMetadata`, `sitemap.xml/route.ts`, the asset route, `portalUrl: /o/<slug>`, the give back-link and the giving return URLs all assume `/site/<slug>`. On a custom host the slug must not appear in any URL, header or HTML. `/site/<slug>/…` on a custom host must 404. Otherwise a church's domain serves other tenants' content (host confusion). Absolute URLs must come from the verified DB row, never from `NEXT_PUBLIC_APP_URL` or the request. The PR #31 `give/*` routes and `render-site-page.tsx` need the same treatment.
- **G6 [A] Non-site routes on a foreign host.** On a custom host, the Edge allows only the site's path allowlist and returns the neutral 404 for everything else: `/api/*` (including `/api/auth/*`, `/api/webhooks/*`, `/api/sites/ingest`, `/api/cron/*`), `/signin`, `/totp`, `/forgot-password`, `/reset-password`, `/file-statistics*`, `/home`, `/o/*`, `/admin/*`, `/account/*`. Edge can decide this without the DB because it only needs "is this a platform host?" (an env-configured set including `presby.vercel.app` and preview hosts). A misconfigured platform-host set would 404 the platform itself, so it needs a boot-time assertion. The "this host is a tenant" decision is the RSC resolver's.
- **G7 [A] No session or cookies on custom hosts.** Sign-in, NextAuth and TOTP never run there, and no `Set-Cookie` is emitted (response-header test). Cross-domain SSO is out of scope. This keeps the DECISION-094 branded-sign-in exception and `check:brand-scope` unchanged: `/signin` stays on the platform host and is reached through "Our Portal".
- **G8 [D] Robots and indexing.** Platform `robots.ts` is `Allow: /site/`, `Disallow: /`, and the root layout is `noindex`. A custom host needs its own `robots.txt` allowing `/` and naming `https://<canonical>/sitemap.xml`, and the platform `noindex` must not apply. A non-canonical alias must `noindex` or redirect.
- **G9 [D] Re-verification cadence and debounce.** See Flow 5. DNS resolver errors are "unknown", not "lapsed". A single failure should not flip a live site. Define pending-check cadence, an expiry for never-verified claims, and what the admin is told at each transition.
- **G10 [A/D] Takeover after lapse or exit.** Two cases. (a) A lapsed domain re-registered by a stranger who points it at Vercel: the persistent TXT check stops serving, and detach follows. (b) The church leaves and its DNS still points at Vercel after we detach. Another Vercel customer may then attach that name and serve their own content on the church's domain. **Mitigations:** keep the domain attached and parked (neutral 404) for a grace period (default 30 days; Q6) while the offboarding checklist and daily "records still point at us" warnings run; email the church. The TXT must be described honestly in the UI as "keep this record in place; it protects your domain."
- **G11 [D] DNS checklist quality.** Per-record states `correct`, `missing`, `wrong value`, `conflicting`, `couldn't check`. Detect conflicting A/AAAA/CNAME at the host (a leftover AAAA to the old host silently sends IPv6 users to WordPress). Detect a restrictive **CAA** record that blocks Vercel's CA ("add letsencrypt.org"). Detect **DNSSEC** misconfiguration. Never instruct deleting MX or SPF. Give instructions for CNAME flattening at the apex, and mention Cloudflare and GoDaddy specifically. Provide "copy all records as text" and a `mailto:` link (not server-sent mail to an arbitrary address, which would be an open relay). The DNS person is often not the admin.
- **G12 [D] Vercel target values** come from the API config response (they can be per-project). A future Vercel project migration means re-attaching every domain, so the adapter must support a bulk re-attach runbook. Churches whose records are generic need no change.
- **G13 [D] "Live" has a definition.** An end-to-end HTTPS probe through a token-bound, non-enumerating check, not just Vercel's `misconfigured: false`. Cloudflare's orange cloud (proxied) is a known problem for Vercel: detect it (answers in Cloudflare ranges) and say "set this record to DNS only (grey cloud)". Whether proxied is permitted after verification is Q7.
- **G14 [A] Order of operations** (proof, then provision) also protects Resend and Vercel API quotas. "Check now" and "Verify now" are rate-limited per org and per domain, because they trigger outbound API calls.
- **G15 [A] Redirect caching.** DECISION-041 specified a 301 from the slug URL. A permanent redirect is cached by browsers and search engines, so if the custom domain later lapses, visitors with a cached redirect are stranded on a dead host, which defeats the fail-soft promise. Use a temporary status or bounded `Cache-Control`. This needs a superseding decision. Also note DECISION-041's `<slug>.presby.app` wording is stale (no wildcard subdomain exists, and the product is `presbyportal.org`); the superseding decision should reconcile it. Legacy WordPress URLs on the cutover also 404 with no redirect map; SEO continuity for FPCW needs a legacy-URL redirect mechanism, possibly in `presby-site-kit` — out of this pipeline unless the operator pulls it in (Q8).

**Mail (increment 2)**
- **G16 [D] Attribution.** `email_queue` has no `organization_id`, so per-domain bounce and complaint tracking cannot be attributed. Add org attribution (and a nullable domain reference), plus per-domain counters fed by the existing webhook.
- **G17 [O] Capacity.** Resend Pro is 10 domains. At 80% the operator must be alerted. At the cap, new mail domains cannot be provisioned and the UI says so honestly.
- **G18 [D] No office email exists.** `organization_profiles` has address and phone but no email. "Reply-To the church office" needs a new field, validated (format, length, CR/LF injection rejected), and an empty state (the footer says "replies go to PresbyPortal support"). The From display name carries org-controlled text: sanitize against quotes, angle brackets and CR/LF, and cap the length. The "via PresbyPortal" suffix on the fallback sender is mandatory and not editable (anti-impersonation).
- **G19 [D] Resend edge cases.** A domain already registered in another team. An existing `send.` subdomain. An existing strict DMARC policy (DKIM is aligned, so this is fine, but the UI should say what to expect). The church needs to delete the DKIM/SPF/MX records on exit. The Resend states `not_started | pending | verified | failed | temporary_failure` map to the per-record statuses.
- **G20 [A] Which mail moves.** An explicit registry: `templateKey` → `platform` | `org`, defaulting to `platform` for anything unknown. Today: `statistics_submission_grant` (sent by a presbytery, so it uses the presbytery's domain if that org has one), the statement notice (PR #31), and future invitations, event/roll notices → `org`. Account mail (`password_reset`, `email_change_verify`) and ticket mail (`ticket_*`, `feedback_notification`) → `platform`. Links in church-domain mail still point at the platform host — an accepted residual (a mismatch spam filters can notice), disclosed in the checklist.
- **G21 [A] Reputation vs infrastructure.** See Key finding 3. All church domains live in **one** Resend team and its account-level enforcement can pause the whole team, including sign-in mail. Define breaker thresholds with a minimum sample size (a 10% rate on 20 sends is noise). The default action is "pause and hold this org's church-originated mail, notify admins and the platform admin". Resume is a platform-admin action.
- **G22 [A] Sender resolved at send time, not enqueue time.** `email_queue.from_email` is stored so retries reuse the same sender, with up to 8 attempts over hours. A domain that lapses, pauses or is removed mid-retry would make those rows fail permanently. Resolve at attempt time and degrade to the platform sender where the reason is infrastructure, hold where it is reputation.
- **G23 [D] Removal order.** Switch sender resolution to the fallback, then delete the Resend domain. Domain change means a new Resend domain and a delete of the old after the queue drains or immediately after the switch. Deleting the Resend domain is audited.

**Giving (PR #31)**
- **G24 [A] Sequencing and shared files.** The `give/*` routes, `render-site-page.tsx`, `givingOrigin()` and the statement link all live in the unmerged PR #31. This pipeline's batch 3 needs them. Recommend PR #31 merges (and this branch rebases) before batch 3 starts; Phase 3 should name the exact files in conflict. The donor-return origin change in Flow 11 is a small, deliberate edit to a security-reviewed rule, with a test that Host and `X-Forwarded-Host` still cannot influence it.

**Operational and safety**
- **G25 [A] Secrets and failure modes.** New secrets: Vercel API token, project id and team id; Resend key (already set, full-access, own team). Scope the Vercel token minimally. Define behavior for both APIs being down, rate-limited, or the token revoked: no half-states, retries, operator alert. *(Analyst noted the `docs/deployment.md` Vercel account problem as a hard external blocker; orchestrator note: the operator's `community-collective` access was restored and the CLI can now set production env vars as of 2026-10-19 — the architect should re-assess rather than assume.)*
- **G26 [D] Vercel behaviors to verify, not assume.** Vercel adds HSTS (long max-age) to custom domains by default; a church that later leaves needs valid HTTPS at its new host *first*, or returning visitors are locked out — put this in the exit checklist. A TLS gap exists between the DNS flip and certificate issuance. Server Actions' Origin-versus-Host check should hold on a custom host — verify it (the contact form depends on it). CSP `form-action 'self'` and `frame-ancestors 'none'` are fine on a custom host and must stay so.
- **G27 [D] Audit.** Audit keys for claim, proof verified, attached, live, canonical changed, lapsed, paused, released, evicted, mail domain added, verified, paused, removed, Reply-To changed. Machine transitions (scheduled lapse) are written without a human actor. `check:audit` scans `actions.ts`, so cron and library paths need their own coverage or an explicit tripwire note.
- **G28 [D] 2FA gate.** `/o/*` is 2FA-gated at the Edge, so a mid-enrolment user is redirected to `/totp` first — fine; confirm in the checklist test. Domain control is a security-sensitive mutation, so consider requiring a recent re-authentication on claim, canonical change and release.
- **G29 [D] Empty and mobile states.** Empty state before any domain is added: explain the two paths (bring a domain, or acquire one later), say "your site works at presbyportal.org/site/<slug> in the meantime", and offer a "Start" button, not "No domains". The checklist, records and Copy buttons must work at 360px, with long TXT values wrapping and tappable-to-copy.
- **G30 [D] Failure microcopy** for DB down, Vercel down, Resend down, and DNS lookups failing: human, specific, with the next action. Never expose provider error text.
- **G31 [D] Support burden.** The checklist is the support tool: the platform admin list shows exactly what the church sees, plus last-checked time and the last error class. A "Why isn't it working?" panel is the first-line diagnosis (the four common causes: proxied Cloudflare record, leftover AAAA, CAA, wrong canonical host). Notification emails come from the platform sender to the church admins.
- **G32 [D] Presbyteries and synods** get sites and domains too. Nothing should hardcode congregation. Succession (a closed church's domain redirecting to the successor's site) is future work.

## Adversarial pass

| # | Question | Finding |
|---|---|---|
| A1 | Can an unverified, pending, lapsed, suspended or never-claimed host be told apart from a nonexistent one? | **Gap (G6/G9)**, to confirm in design. All must return the same neutral 404, in the same status, body, headers and timing class (one DB read each). A *live* site's own missing page may differ, since a live site is public. At Vercel's layer an *attached* host and a *non-attached* one differ (Vercel's own error page vs ours); that reveals only "attached to our project", which DNS already reveals for a live church site. Proof-before-attach (G1) keeps unproven names from being attached at all. |
| A2 | Host-header spoofing: `X-Forwarded-Host`, `Forwarded`, `X-Original-Host` on a platform-host request switching tenancy. | **Gap**, test required. Only the `Host` the platform actually received is read, never forwarded-host variants. A request to a platform host with a spoofed `Host: church.invalid`-style header must never serve that church's site, and a request on a custom host with a spoofed forwarded header must never switch org. |
| A3 | Can an org serve another org's content by requesting `/site/<other-slug>` on its own domain? | **Gap (G5).** Must 404. |
| A4 | Can I claim a name I don't own to block the real owner? | **Gap (G1/G3).** Proof-before-attach and first-to-verify wins. |
| A5 | Can I burn the Resend/Vercel quotas? | **Gap (G1/G14).** Per-org caps, expiry, rate limits on checks. |
| A6 | Can I use a lapsed domain after the church loses it? | **Gap (G10).** Persistent TXT check plus parked-then-detach. |
| A7 | Open redirects: the `callbackUrl` on "Our Portal", the `?next=`, our alias/canonical/slug redirects. | **Gap, confirm.** Alias and slug redirect targets come only from the verified DB host, never from a request parameter or header. The portal link is a fixed `https://<platform>/o/<slug>`. `sanitizeCallbackUrl` stays on the platform host only. |
| A8 | Can anonymous traffic on a custom host reach any authenticated or mutating route? | **Gap (G6/G7).** The allowlist blocks `/api/*` and the auth pages; no `Set-Cookie`. |
| A9 | Does `/launch` or any redirect send a custom-host visitor into the portal or sign-in on the wrong host? | **Gap (G6).** All platform routes 404 on a foreign host; "Our Portal" is an absolute link to the platform. |
| A10 | Contact form on a custom host: spam, wrong-org write. | **Confirm.** The slug passed to the action is derived server-side from the resolved host, not a client field. The existing honeypot and IP/slug rate limit continue to apply. |
| A11 | Giving redirect targets. | **Gap (G24).** Donor origin from the verified DB row only; "never from Host" preserved. |
| A12 | Enumeration through the domain-claim UI ("already connected"). | **Gap (G3).** Pre-proof, identical response. Post-proof, a generic message naming no org. |
| A13 | Input boundaries: empty, 10,000-char, trailing dot, uppercase, mixed-script IDN, `a..b`, trailing space, a port, a scheme. | **Gap (G2).** Server-side validation with normalization; same rules for the Reply-To address and From display name (G18). |
| A14 | Self-targeting: can a non-admin of org A change org B's domains? Can an admin delete their own audit trail? | **Confirm, test.** Everything goes through `withOrgContext()` and `domains.manage`. Audit rows are append-only. The platform-admin eviction is the one cross-org action and is audited. |
| A15 | State-machine shortcuts: hitting "Live" or mail "enable" without proof. | **Gap.** Every transition is a server-side check against stored state (proof before attach, attach before live, DKIM verified before send). The UI never decides. |
| A16 | Cookie scope across a church's host and the platform. | **Confirm.** Different registrable domains, and G7 forbids setting any; proof by response-header test. |
| A17 | Email display-name or Reply-To header injection; impersonating another brand. | **Gap (G18).** Sanitize, cap, keep "via PresbyPortal" mandatory on the fallback. |
| A18 | Webhook forgery to flip a domain's bounce state. | **Confirm.** Svix signature verification stays the only authenticator, and the webhook is unreachable on custom hosts (G6). |

## Testing without real domains

- **Unit and integration:** all fixtures use `*.invalid` hosts (`church-one.invalid`, `www.church-one.invalid`). Vercel, Resend and DNS sit behind adapter interfaces with in-memory fakes that simulate each state (pending, misconfigured, proxied, CAA-blocked, lapse, API down, rate-limited, name already exists). The state machine, resolver, allowlist, redirect and canonical rules, sender resolver and breaker are all testable this way.
- **E2E on the dev server:** Playwright resolves `.invalid` hosts to loopback (host-resolver mapping or a `Host` override, not DNS). Cover the neutral 404 for each non-live state, `/api/*` and `/signin` on a foreign host, no `Set-Cookie`, spoofed forwarded headers, the redirect matrix, robots/sitemap/canonical output, the 360px checklist, and a hydration spec for the domain form (DECISION-159).
- **One real domain, manual:** Vercel attach, certificate issuance, apex/`www`, Cloudflare proxied vs not, Resend DKIM verify, and a real send with a bounce (Resend test inboxes simulate delivered/bounced/complained) cannot run in CI. A **scripted manual acceptance pass against one operator-owned throwaway domain** before FPCW's cutover and before the first customer's go-live; the domain name stays in the operator's private notes, never committed. Q9.
- No real congregation or domain appears in any test, doc or fixture. Work-log and decision text refer to "the first customer" and "FPCW's domain".

## Out of Scope (confirm with user)

- Registering or buying domains for churches (the "acquire later" path is only "you got a domain, now connect it").
- Cloudflare-API auto-DNS (a recorded later option).
- Sign-in, sessions, or the member portal on a custom host (no SSO, no `church.org/portal`).
- Per-org branding of `/signin` beyond DECISION-094.
- Redirecting a closed or merged congregation's domain to its successor's site.
- Wildcard or arbitrary multi-alias domains beyond the apex/`www` pair plus extra redirecting aliases.
- Legacy-URL redirect maps for the FPCW cutover (a `presby-site-kit` or ingest concern) unless the operator pulls it in (Q8).
- Per-org dedicated IPs, custom TLS certificates, mail-domain DMARC authoring, inbound mail, church-chosen sender local-parts.
- Moving platform account mail to church domains (excluded by the agreed shape).

## Open Questions

For the operator, with the analyst's recommended default in brackets:

1. **Who flips the org toggles?** The org's own admin via `/admin/features`, or the platform admin only? [Operator-enabled during the first-customers era; self-service later.]
2. **May a platform admin record a *web* domain claim on an org's behalf?** DNS proof still required. Mail stays tenant-only regardless. [Yes for web, audited and attributed to the operator; no for mail.]
3. **Reply-To source and empty state.** New "office email" field on the org profile, or an existing contact? Blank → ? [New profile field; blank shows the platform support address with "via PresbyPortal" kept.]
4. **Breaker thresholds and sample sizes** (G21), and who can resume a paused org. [Platform admin resumes; thresholds in Phase 3 with conservative defaults; operator reviews.]
5. **Resend plan and cap.** At what count do we upgrade, and who gets the 80% alert? [Alert to the operator at 8 of 10.]
6. **Grace periods.** Never-verified claim expiry (7 days), lapse-to-detach (30 days parked). [As suggested.]
7. **Cloudflare proxied after verification:** allowed or required grey? [Require grey (DNS only) for now; revisit after the real-domain acceptance pass.]
8. **Legacy-URL redirects for FPCW's cutover:** in scope, a separate pipeline, or manual? [Separate; a `docs/TODO.md` cutover dependency.]
9. **Operator-owned throwaway domain** for the manual acceptance pass, and who else controls its DNS?
10. **Sequence versus PR #31 and the Vercel situation.** [PR #31 first; no real attach until the Vercel project is under the operator's control.]
11. **Sender local-part:** fixed `notifications@` or church-chosen later? [Fixed.]
12. **Notification recipients** for lapse, pause and release: all `domains.manage` holders plus the platform admin? [Yes.]

## Recommended increment / batch order

One pipeline, two increments, each its own Phase 4 batch sequence. Migrations `0057` (web) and `0058` (mail); `DECISION-176`–`182`; `F146`–`F152`.

**Increment 1 — web (blocks go-live; ship and merge before Increment 2 starts Phase 4):**
- **Batch 1a — claim model.** Domain table, hostname rules, per-org caps, expiry, proof token and TXT verification (DNS adapter plus fake), uniqueness on verified hosts, RLS/FORCE, audit keys, `domains.manage` plus `org_portal.domains`. No Vercel yet.
- **Batch 1b — Vercel adapter.** Attach, config read, detach, the status machine, daily re-verification and debounce on the existing cron, and parked-then-detach.
- **Batch 1c — serving.** Edge allowlist and platform-host set with boot assertion, RSC host resolver, the URL builder across `page`/`metadata`/`sitemap`/assets/portal link, canonical/robots/sitemap, alias and slug redirects, `Set-Cookie` and non-site-route tests. Rebase on PR #31 first.
- **Batch 1d — UI.** `/o/<slug>/admin/domains` checklist (empty state, per-record status, Copy, mobile), plus the platform admin oversight list. Hydration gate, browser pass at 360px.
- **Gate:** the manual real-domain acceptance pass before the first customer's go-live.

**Increment 2 — mail (can follow; no customer is blocked on it):**
- **Batch 2a — sender resolver and registry.** Closed `templateKey` registry, send-time resolution, `email_queue` org attribution, Reply-To field. No Resend yet; the fallback sender alone ships.
- **Batch 2b — Resend adapter.** Provision after proof, per-record status, removal order, cap handling.
- **Batch 2c — webhook attribution, breaker, pause/hold, notifications, UI section** in the existing checklist.

## Handoff

**Next: architect (Phase 2).** Rulings needed: (1) the host-to-org resolution mechanism (RSC resolver and its narrow SECURITY DEFINER lookup), and the Edge allowlist plus platform-host set, with the rule "a host is a key, not an identity"; (2) how the URL space is abstracted across the renderer, metadata, sitemap and PR #31's `give/*`; (3) a superseding decision for DECISION-041's canonical rule, covering redirect status and caching (G15) and the stale `<slug>.presby.app` text; (4) where the Vercel, Resend and DNS adapters live, and the cron plus audit coverage for non-action paths (G27); (5) whether platform-admin access reuses `FEATURES.ADMIN_ORGANIZATIONS`; (6) the domain-record shape (G4), and the `email_queue` attribution and send-time sender-resolution change (G16, G22); (7) a CLAUDE.md update for the new serving surface: custom hosts as a third non-brandable-chrome, session-less surface that shares the `(public)` contract.

Operator answers on Q1–Q4 are needed before Phase 3 closes.

---

# Phase 2 — Architectural Review (architect)

*2026-10-19, architect (read-only; recorded verbatim by the orchestrator).*

## Verdict

**Approved with suggestions**

The feature shape from Phase 1 is right and nothing goes back to Phase 1. Phase 3 must design within the fourteen binding rulings below (R1–R14). Four of them correct premises that the kickoff, the analyst, or `CLAUDE.md` state as settled:

- **The proxy is not an Edge function (F146).** On Next 16.3.6 `src/proxy.ts` runs on Node.js. The rule against the proxy reading the database stays, but for a different reason, and it now needs a tripwire.
- **The custom host is not a third surface.** It is served by the existing `(public)/site/[slug]` tree through a proxy rewrite. It keeps the church's branding, and `check:brand-scope` does not change.
- **`domains.manage` cannot be reached as the analyst proposed (F150).** F111's permission ceiling means binding it to a role is not enough on its own.
- **One church can pause sign-in mail for everyone (F149).** Resend's bounce and complaint limits apply to the whole Resend account, not per domain.

## Placement

**Directory placement**

- **`src/lib/domains/`** — new top-level module (DECISION-179):
  - `host.ts`: pure, imports nothing, safe for the proxy and `next.config.ts`. Holds `requestHost()`, `normalizeHost()`, `platformHosts()` and `isPlatformHost()`.
  - `hostname-rules.ts`: the G2 rules. Uses `node:url` `domainToASCII`/`domainToUnicode` and Unicode-property regexes. Server-only.
  - `state.ts`: a pure transition table, unit-tested.
  - `service.ts`: server-only. Claim, check, attach, canonical change, release, pause, evict, and the single transition choke point (R8).
  - `adapters/vercel.ts`, `adapters/dns.ts`, `adapters/mail-provider.ts`, and `adapters/fake.ts`.
  - `notify.ts`: admin notifications, always sent from the platform sender.
- **`src/lib/site-urls.ts`** — pure URL builder (R5).
- **`src/lib/email/senders.ts`** — the closed sender registry and send-time resolver (R11). `queue.ts` and `send.ts` are modified.
- **Public site** — `src/app/(public)/site/[slug]/` keeps its route files. The `[slug]` segment now carries a *site key* (R1). New file: `robots.txt/route.ts`, answering in host mode only.
- **Org admin** — `src/app/(org)/o/[slug]/admin/domains/` with `page.tsx`, a co-located `actions.ts`, and the client islands.
- **Platform admin** — a Domains section in `src/app/(admin)/admin/organizations/[id]/`, plus a cross-org list (suggested path `/admin/organizations/domains`).
- **Cron** — `src/app/api/cron/domains/route.ts` and a new `vercel.json` entry.
- **Migrations** — `drizzle/0057_presby_org_domains.sql` (web) and `drizzle/0058_presby_mail_domains.sql` (mail).

**Server vs Client split**

- Every page is a Server Component.
- `'use client'` is limited to: the claim/canonical form (react-hook-form inside `<HydrationGate>`, DECISION-159); the copy-record button (`navigator.clipboard`); the "Check now" / "Verify now" buttons (`useTransition`); `AlertDialog` confirms for remove, release, pause and evict (Workflow Rule 2).
- The public site gets no new client code. The contact form's action binding changes (R5).

**Dependencies:** none new.

| Candidate | Ruling | Why |
|---|---|---|
| `@vercel/sdk` | Rejected | Five REST endpoints over `fetch` behind an adapter interface. The SDK adds size and version churn and buys nothing the interface doesn't already hide. |
| `tldts` / `psl` (public suffix list) | Rejected | The TXT proof is the security control. A suffix-only name (`co.uk`) can never prove control, so it expires after 7 days. "Is this name a zone apex (no CNAME allowed)?" comes from an SOA lookup through the DNS adapter, more accurate than the PSL for delegated subzones. Revisit only if cookie scope or registrable-domain grouping becomes a requirement. |
| Node `dns/promises` as the primary resolver | Rejected | It reports no DNSSEC/AD status, and the platform resolver caches differently locally and on Vercel. Acceptable inside fakes or dev tooling. |
| DNS-over-HTTPS via `fetch` | Adopted | Zero dependencies. Two independent resolvers (see R7). |
| Resend domain API | Existing `resend` SDK | `domains.create/get/verify/remove` are already in the SDK. |

## Invariants Touched

- **Isolation Is a Database Property.** New tables are `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy. `presby_app` grants are column-limited, with no `DELETE`. Anonymous reads go only through `SECURITY DEFINER` functions with a pinned `search_path` and `EXECUTE` revoked from `PUBLIC`. The owner-only helper is not executable by `presby_app` (R10). Live catalog on development (2026-10-19): `organization_sites`, `organization_profiles`, `site_contact_messages` are `relforcerowsecurity = t`; `organization_sites` has no `presby_app` grant; `presby_published_site(text)` is `SECURITY DEFINER`, `search_path=public, pg_temp`, ACL `neondb_owner` + `presby_app` only. Widening its OUT columns forces DROP/CREATE, which resets the ACL (F152).
- **RLS enforces tenancy, not authorization.** Tenant paths go through `withOrgContext()` plus `presby_has_permission('domains.manage')`. Anonymous paths go through definer functions that collapse every non-serving state to zero rows.
- **Two Hierarchies.** Pause, release and evict by a platform admin are acts on platform infrastructure (Vercel attachment, the serving state), not ecclesiastical authority. The platform admin never holds `domains.manage` and can never enable mail-from-church. No platform predicate enters a tenant authority check.
- **Composite Tenant Keys.** New tables declare `unique (id, organization_id)`; the mail child table references the host row by a composite FK; `email_queue`'s new domain reference is composite with `MATCH SIMPLE` (R11).
- **Never Hard-Delete.** Domain rows are never deleted; released and expired rows stay, as history and for takeover forensics. `organizations` is untouched.
- **The Brand Is a Cascade Override.** No change and no third emitter. Custom hosts render through `(public)/site/[slug]/layout.tsx`, which is `EMITTERS[1]` already. The org admin domains page inherits the `(org)` cascade; platform oversight pages use the platform palette.
- **The Edge Gate Cannot Reach the Database.** **This premise is false on Next 16 (F146).** The rule is kept as a design rule, its rationale restated, and enforced by a new tripwire. `CLAUDE.md` must change (R12).
- **Permissions vs Flags.** Permission: `domains.manage` (tenant) and `FEATURES.ADMIN_ORGANIZATIONS` (platform, reused). Flags: the existing `sites.public_render`, plus org toggles `org_portal.domains` and `org_portal.mail_domain` with `flag: null` (DECISION-160's precedent); no new platform flag. The per-domain `paused` state is lifecycle state, not a flag. The serving predicate is flag → toggle → state, with no permission check because the visitor is anonymous.
- **DECISION-040 enumeration safety.** Every non-serving state goes down one code path with the same read count. The proxy decides on hostname shape and platform-host membership only, never on database state (R1).
- **The `(org)` contract.** The domains page and its actions use `withOrgContext()` only. Provider calls go out over the network and are not reads of the platform database. Cross-org sweeps run in `src/app/api/cron/`, outside `(org)`.
- **No Real Data.** Fixtures use `*.invalid`. Observation: `docs/TODO.md:39` already contains FPCW's real domain; the Rule-10 reconciliation of the Track F line should drop it, and this pipeline should not copy it anywhere.
- **Verify in a Browser.** The checklist is checked at 360px, the form has a hydration spec, and the e2e covers host-mapped `*.invalid`.

## Notes

### Binding rulings

**R1 — How a custom host is served (handoff 1; G6, A1–A3, A8, A9).**
- **Proxy order.** The first branch of `proxy()`, before the `/api/` bypass at `src/proxy.ts:33`, before the `/site` bypass and before `PUBLIC_PATHS`, reads `host = requestHost(req.headers)` and classifies it:
  - **Invalid hostname shape** (empty, illegal characters, an IP literal in production): 404 with no database read.
  - **Platform host:** today's logic unchanged, plus: `/site/<segment containing a dot>` returns 404, so the internal target can't be reached from the platform.
  - **Any other host:** `NextResponse.rewrite(new URL(\`/site/${host}${pathname}${search}\`, req.url))`. This branch never calls `edgeAuth()` and has no other branches.
- **The site key.** The rewrite lands in the existing `(public)/site/[slug]` tree. `parseSiteKey(param)` classifies the segment value once: no dot means a slug; a dot means a host. They can't collide: the slug CHECK is a DNS label with no dot (`drizzle/0014_presby_org_router.sql:42`) and the hostname rules require at least one dot.
- **Host-mode resolution** happens in a single `cache()`-wrapped resolver used by the layout, page, `generateMetadata`, sitemap, assets, robots and `give/*`:
  - **Host check.** The resolver requires `requestHost(await headers()) === key`. This backstops paths the proxy matcher excludes (`*.png` and similar) and self-hosted deployments, and it is the only legal `headers()` read on this surface.
  - **Single lookup.** Exactly one read, `presby_published_site_by_host(p_host)`, returning the existing projection plus `slug`, `canonical_host` and `request_is_canonical`. Every non-serving state returns zero rows. Everything downstream (staff, committee and giving reads) stays slug-keyed, using the **slug the database returned**.
  - **No fallback.** Host mode never renders `PresbyteryFallback`, because a miss has no slug.
- **Rejected alternatives:** a database lookup in the proxy (Neon on every platform request; a second enumeration-sensitive path — F146); branching root pages on host without a rewrite (`/` is the platform home); a parallel `(public)/host/[host]` tree (six duplicated route adapters and a third `BrandTokens` emitter); Vercel-level domain redirects (see R6).
- **Justification against DECISION-040.** The rewrite reuses the one `not_found` collapse that already makes "never provisioned / suspended / flag off / read failed" identical. Unknown, pending, lapsed, paused, released and toggle-off hosts join it with the same number of reads (the flag read plus one function call).
- **Correction to Phase 1 handoff item 7.** A custom host is not a "non-brandable-chrome third surface". It is the church's own site, in the same brandable `(public)` group, session-less exactly as `(public)` already is.

**R2 — The platform-host set and its boot assertion (G6).**
- `platformHosts()` in `src/lib/domains/host.ts` is the union of: the host of `NEXT_PUBLIC_APP_URL`; `NEXT_PUBLIC_PLATFORM_HOSTS`, a comma list inlined at build time (production: `presbyportal.org,www.presbyportal.org`); any host ending in `.vercel.app`; outside production only, loopback, `DEV_ALLOWED_ORIGINS`, and `*.trycloudflare.com`.
- **`VERCEL_PROJECT_PRODUCTION_URL` may never feed this set, or any origin anywhere (F148).**
- **Boot assertion.** `next.config.ts` fails a production build if `NEXT_PUBLIC_APP_URL` is missing or not https, if its host is not in the set, or if any `PLATFORM_HOSTS` entry is not a hostname. The classifier gets unit tests.
- **Failure direction.** A host not in the set is treated as a custom host (rewrite, database, 404). A misconfiguration 404s the platform; it never serves platform routes on a church's domain.

**R3 — A host is a lookup key, not an identity (A2, A7).** Only `Host` is read, through `requestHost()`; `X-Forwarded-Host`, `Forwarded` and `nextUrl.host` are never read, and a test must prove a spoofed forwarded header changes nothing. The host chooses *which public site renders* and nothing else: never an origin, a redirect target, or a value written to the database. Every absolute URL and redirect target comes from the verified row. On Vercel only attached hosts reach the project; self-hosted, any Host can arrive, but either way it selects only public content.

**R4 — No sessions or cookies on custom hosts (G7, A16).** `/api/*` (auth, webhooks, cron, ingest), every auth page, `/o/*` and `/admin/*` are rewritten into bundle-path space and 404. A test asserts no `Set-Cookie` on every class of custom-host response: page, 404, asset, sitemap, robots, redirect, and a server-action POST. The `next.config.ts:71-72` `/orgs` redirect must gain `has: host ∈ platform` (F151). DECISION-094 and `check:brand-scope` are unchanged.

**R5 — The URL builder and giving (handoff 2; G5, G24, A10, A11).**
- **`SiteUrls`** (`src/lib/site-urls.ts`) is built *only* by the resolver, from the database row plus the validated platform origin. It provides `origin`, `page()`, `asset()`, `sitemap()`, `give()`, `giveReturn()`, `canonical()`, and `portal()` (an absolute `https://<platform>/o/<slug>`).
- **Every hand-built `/site/${slug}` moves onto it:** `render-site-page.tsx` (`pageUrl`, `imageUrl`, logo) and its metadata; the sitemap; the staff and committee photo URLs; `presbytery-fallback.tsx`; the `give` back-link and the return-panel hrefs; `checkoutReturnUrls`.
- **Tripwire.** A vitest source scan bans `` `/site/${`` outside `site-urls.ts`.
- **G5, narrowed.** No same-host URL may route by slug. The slug, being the public platform identifier, may still appear on a custom host as the absolute portal link and as opaque action arguments.
- **Giving.** `givingOrigin()` is unchanged and stays env-only. A new `donorOrigin(slug)` returns the database serving canonical host for that org, or `givingOrigin()` if there is none, computed in the action from the slug, never from the request. Treasurer onboarding `return_url`/`refresh_url` and the statement-notice link stay on `givingOrigin()`. A test must show a spoofed `Host`/`X-Forwarded-Host` cannot change `success_url`/`cancel_url`.
- **Named residual.** `success_url` is fixed when the Stripe session is created, so a host that lapses mid-checkout returns the donor to a 404.
- **Contact form and give actions.** These take a site key bound on the server. Today the contact form uses a client hidden field `__slug` (`contact-form.tsx:64`); bind the key on the server instead. The action re-resolves the key and, in host mode, requires that it equals the request Host. Writing into another org's inbox this way is no more than visiting that org's page, so the residual is accepted.

**R6 — Supersede DECISION-041's canonical rule (handoff 3; G15, G8).** DECISION-041's routing contract stands (`(public)` is unauthenticated and reads only through a narrow definer function). Its canonicalisation paragraph is superseded:
- **One serving predicate.** An owner-only SQL helper answers "which host serves this org?". Both the host lookup and the slug projection call it, so the fail-soft interlock is structural.
- **"Serving":** the host row is in a serving state, the org is active, the site is live, and the `org_portal.domains` toggle row is enabled; the caller also checks `sites.public_render`. The category axis is deliberately excluded — a curation preference must never take a site off the internet.
- **Redirect status.** Every host-level redirect (slug to custom, alias to canonical) is a **307 with `no-store`**, never a 301/308, and never configured at Vercel. Cached permanent redirects strand visitors after a lapse and loop if the church later swaps www and apex.
- **The slug URL.** When a serving host exists, HTML pages and the sitemap get a 307 that keeps the path and query; assets, `/give/return` and server-action POSTs are never redirected. Otherwise the slug URL serves itself and is its own canonical, as shipped. The `<slug>.presby.app` wording and the "never canonical, always noindex" text are retired.
- **Custom canonical host.** It is its own canonical. `/robots.txt` is the new host-mode route: `Allow: /` plus `Sitemap: https://<canonical>/sitemap.xml`; the same route 404s in slug mode. The sitemap lists clean URLs. `src/app/robots.ts` is unchanged for platform hosts.
- **HSTS (F147).** Split the `next.config.ts:22` header by host. Platform hosts keep `max-age=63072000; includeSubDomains`; every other host gets `max-age=63072000` only (Vercel's own default for custom domains). Add a header test for both.

**R7 — Adapters, secrets and failure modes (handoff 4; G14, G25).**
- **Provider selection** by explicit configuration, `DOMAINS_PROVIDER=vercel` and `MAIL_DOMAINS_PROVIDER=resend`; default `unconfigured`, an honest UI state ("Connecting is temporarily unavailable"). Configuration, not a feature flag. Production scope only: Preview must never be able to attach production domains or create Resend domains with the shared full-access key. Tests use the fakes.
- **Vercel.** REST: `POST /v10/projects/{id}/domains`, `GET`/`DELETE /v9/projects/{id}/domains/{d}`, `POST …/verify`, `GET /v6/domains/{d}/config`. Token `VERCEL_API_TOKEN`, **project-scoped to `presby`**, plus `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`. `/v6/…/config` is team-level and may be denied to a project token; the adapter must not depend on it for correctness (fall back to the project-domain GET plus our own DNS checks; verify in the acceptance pass). Vercel's own `verification` TXT challenge (domain in another Vercel account) is surfaced as a checklist record. A 400 "domain already exists on the project" is idempotent success. "Latest production deployment was not successful" is retryable (attach stays `attach_pending`).
- **DNS.** DNS-over-HTTPS JSON through two independent resolvers. A lapse requires *both* to positively answer "absent"; any error or disagreement is `unknown`. An SOA lookup classifies the zone apex.
- **No half-states.** Provider first, database second. The cron reconciles by querying the provider, using `attach_pending` and `release_pending`.
- **Rate limits.** "Check now"/"Verify now" go through `checkRateLimit` per org and per domain. Provider calls share Resend's 10 requests/second team limit with ordinary sends.

**R8 — Cron and audit for non-action paths (G27).**
- `src/app/api/cron/domains/route.ts`, house `CRON_SECRET` bearer shape, its own schedule (suggest every 15 minutes), processing due rows by `next_check_at` in bounded batches, in a failure domain separate from `maintenance`. Cross-org reads use `getPlatformDb()` (precedent `api/cron/maintenance/route.ts:97`).
- **One choke point.** Every state change goes through `transitionDomain(tx, row, event, actor)`, which writes the new state and **exactly one** `audit_events` row in the same transaction. Machine transitions use `actorUserId: null` and record `metadata.trigger`.
- **Proof of coverage.** `check:audit` cannot see library or cron paths, so coverage is proven by a DB-backed test per transition. The `actions.ts` files and the cron route carry a header noting audit is delegated; QA verifies through that test, not the tripwire.
- `presby_app` holds only `INSERT, SELECT` on `audit_events` (live grant), so A14 holds for the tenant connection.

**R9 — Platform admin reuses `FEATURES.ADMIN_ORGANIZATIONS` (handoff 5).** `src/lib/permissions.ts` untouched; `PROTECTION_RULES` unchanged. The platform admin can view, pause, resume, force-release (with a reason), resolve disputes and evict, on `getPlatformDb()`, audited, notifying the evicted org's admins. The platform admin can never enable mail-from-church (a representation act). Q2 (a platform admin recording a *web* claim on an org's behalf) is architecturally permissible: DNS proof still required, audited as the platform actor. The operator decides.

**R10 — The domain record and its database rules (handoff 6; G1, G3, G4, G10, G14). Migration `0057`.**
- **One row per DNS host** in `organization_domains` (the host is the unit Vercel attaches and routing serves). `claim_name` is the name the admin typed; the proof TXT sits at `_presby-challenge.<claim_name>` with a per-claim random token. A proof at N covers N and `www.N`; a proof at `www.N` covers only itself. `web_role` is `canonical` or `alias`. The kickoff's "one org-domain record" becomes the claim-name grouping in the UI.
- **Indexes:** a cross-org partial unique index on `hostname` for every holding state (proven onward, until released) — first to *verify* wins, enforced by the database, and the conflict surfaces only after proof (A12); per-org uniqueness of non-terminal hosts; one canonical host per org.
- **CHECK** on hostname shape (lowercase punycode, at least one dot, at most 253 characters).
- **Transition guard.** A `BEFORE UPDATE` trigger enforces the legal edges and their timestamps; triggers bind the owner connection too (A15).
- **Grants.** `presby_app`: `SELECT`, `INSERT`, `UPDATE` limited to tenant-intent columns. No `DELETE`.
- **Caps** (suggested: 3 non-terminal web hosts, 1 mail domain) enforced in the claim transaction behind a lock on the organization row (DECISION-155's phantom-safe pattern). Unproven claims expire after 7 days.
- **Lifecycle.** **No provider call before proof.** After a sustained miss the host is `lapsed` (404; the slug URL becomes self-canonical), then `parked` (still attached, serving 404) for a 30-day grace period, then `release_pending` until the detach succeeds. Named residual: once detached, a church's dangling DNS can be claimed by another Vercel customer; the grace period and offboarding checklist reduce this; nothing can remove it.
- **Mail (migration `0058`).** A child table `organization_mail_domains`, composite FK to the host row, at most one active per org.
- **Functions.** `presby_published_site_by_host(text)` is `SECURITY DEFINER`, pinned search path, `EXECUTE` revoked from `PUBLIC` and granted to `presby_app`. The serving helper is owner-only. A new `scripts/test-rls.sql` section, run as `presby_app`, asserts: cross-org access denied; every non-serving state returns zero rows; the helper is not executable; the ACLs and `relforcerowsecurity` are as designed.

**R11 — Mail (handoff 6; G16, G20, G21, G22).**
- **A closed registry** in `src/lib/email/senders.ts`; an unknown key is treated as `account`:

  | Class | Templates | Sender |
  |---|---|---|
  | `account` | `password_reset`, `email_change_verify`, 2FA, `ticket_*`, `ticket_filed_confirmation`, `feedback_notification` | Always the platform domain |
  | `org` | statement notice (PR #31), future invitations and event/roll notices | Church domain once verified, else fallback |
  | `org_fallback_only` | `statistics_submission_grant` | Always the fallback form ("<Presbytery> via PresbyPortal") |

  This changes Phase 1's G20 for the statistics grant: a credential-bearing link must never ride a sender whose availability depends on a tenant's DNS or reputation, and members should learn that credential links arrive from one domain.
- **Enqueue.** `enqueueEmail` requires `organizationId` for the two org classes and rejects a `from` for them, so `from_email` stays null.
- **`email_queue` stays a platform outbox with no RLS.** It gains `organization_id` (set at enqueue), `sender_mail_domain_id` (set by the attempt that sent), and a composite FK `(sender_mail_domain_id, organization_id)` with `MATCH SIMPLE`.
- **Sender resolution, per attempt:** verified and healthy → the church domain; unverified or infrastructure-unhealthy → the fallback sender; held for reputation → requeued **without consuming an attempt**, with a bounded hold lifetime, then failed and audited. A reputation hold is never rerouted to the platform sender.
- **No oracle.** No new `presby_app`-callable function may answer "does org X have a mail domain?" for an arbitrary X. An inline attempt resolves inside the caller's already-verified org transaction; the worker resolves on the platform connection.
- **Breaker.** Counters keyed by `sender_mail_domain_id` from the webhook, with a minimum sample size; thresholds conservatively below Resend's account-level limits (F149).
- **Sending pools.** The resolver returns a pool, `account` or `org`; the adapter is keyed by pool. `RESEND_ORG_API_KEY` is optional and falls back to the main key. The fallback From (`ORG_MAIL_FALLBACK_FROM`, e.g. a `notifications.` subdomain) must differ from the account-mail From.
- **Display names.** Sanitised and length-capped; the "via PresbyPortal" suffix on the fallback sender is fixed and not editable.

**R12 — Documentation and gate changes (handoff 7).** Drafted below. In addition: **Phase 4 gate** — treat `src/proxy.ts` as auth-touching for this pipeline (a host-classification bug 404s sign-in), so the running-server login e2e (including an MFA-enrolled user) is required, plus a deployed smoke of the platform host. **New tripwire** `check:proxy-imports` walks `src/proxy.ts`'s static import graph and fails if it reaches `@/lib/db`, `@/lib/sites`, or any `server-only` module.

**R13 — `domains.manage` and the F111 ceiling (F150).** `domains.manage` is a tier-1 tenant key with no constitutional binding (`brand_admin` precedent, DECISION-101). Under `assertPermissionSubset()` a new key that no organization holds can never be granted anywhere, so binding it to a role is not enough. Phase 3 must: add it to DECISION-155's administration half (it meets amended criterion (i): no template can deliver it); design a backfill for organizations already designated, measured on the **production** catalog (development has zero `founding_administrator` roles today); name Q2's on-behalf path as the go-live mitigation if the backfill slips.

**R14 — Order relative to PR #31 (G24).** PR #31 merges first and this branch rebases before Batch 1c. Files in conflict: `(public)/site/[slug]/render-site-page.tsx`, `[[...path]]/page.tsx`, `give/page.tsx`, `give/actions.ts`, `give/return/page.tsx`, `public-giving-slot.tsx`; `src/lib/giving/give-session.ts` (`checkoutReturnUrls`) and `src/lib/giving/origin.ts`; the email queue (statement-notice attribution). PR #31's `render-site-page.tsx` extraction is the natural place to inject `SiteUrls`. Development already carries `giving_funds`/`giving_statements`, so `0057`/`0058` numbering is consistent.

### Where each [A]-tagged gap is ruled

| Gap | Ruling |
|---|---|
| G1 | R10 (proof before provisioning, caps, expiry) |
| G3 | R10 (first-to-verify index), R9 (eviction) |
| G5 | R5 |
| G6 | R1, R2, R4, F151 |
| G7 | R4 |
| G10 | R10 |
| G14 | R7, R10 |
| G15 | R6 |
| G20 | R11 |
| G21 | R11, F149 |
| G22 | R11 |
| G24 | R5, R14 |
| G25 | R7. The analyst's Vercel blocker is lifted (operator CLI access restored 2026-10-19). Remaining: a project-scoped token, and **no real attach until production serves from the `presby` project**. |

### Suggestions (not binding)

1. Answer the "Live" probe (G13) in the proxy: a request carrying a valid `x-presby-probe: HMAC(host, secret)` gets a 204 echoing the HMAC — reveals only "this host routes to this deployment", no tenant read.
2. Have the ingest validator refuse bundle pages at reserved paths: `/api`, `/_next`, `/site`, `/assets`, `/robots.txt`, `/sitemap.xml`, `/give/return`.
3. Add a segment `not-found.tsx` under `(public)/site/[slug]/` so the neutral 404 carries no "PresbyPortal" title (today the root metadata names the product on every custom-host 404).
4. Give custom hosts a per-site favicon and icons (DECISION-049 derives a favicon at write time); otherwise `/favicon.ico` and `/icon.svg` serve the platform mark on church domains (F151).
5. Point "View your site" links in `(org)` at `SiteUrls.canonical()`.
6. Put a dated sentence in the stale "Vercel — the account problem" section of `docs/deployment.md` (tech-lead).

### Operator questions added by Phase 2

- **Q13.** Set up a second Resend team (its own Pro plan) as the `org` pool before Increment 2 sends real church mail? Architect recommends yes (F149).
- **Q14.** Approve `NEXT_PUBLIC_PLATFORM_HOSTS=presbyportal.org,www.presbyportal.org`, and confirm production moves to the `presby` project before the first attach. *(Orchestrator note, 2026-10-19: the operator deleted the legacy `presby-portal` project and connected `presby` to GitHub; `www.presbyportal.org` now serves from `presby`.)*

### Draft decisions (for integration)

**DECISION-176 — A request on any host outside the platform-host set is rewritten by `src/proxy.ts`, its first branch, to `/site/<host><path>` inside the existing `(public)/site/[slug]` tree. The segment carries a site key: a slug (no dot) or a verified host (with a dot). Host mode requires the request `Host` to equal the key and resolves through one `SECURITY DEFINER` read that collapses every non-serving state to zero rows. A host is a lookup key, never an identity, an origin or a redirect target. Custom hosts have no session, no cookies and no platform routes. The brandable surface is unchanged.** Rejected: a database lookup in the proxy, a parallel host route tree (a third emitter), host-branching root pages, Vercel-level redirects. Justified against DECISION-040: one code path and one read count for every non-serving state. (2026-10-19, Phase 2, `2026-10-19-custom-domains`.)

**DECISION-177 — `src/proxy.ts` runs on Node.js (Next 16; F146). "The proxy does not reach the database" is kept as a design rule, not a runtime fact.** Reasons: it runs on every matched request; a tenant decision there would be a second enumeration-sensitive path; it keeps the proxy a pure function of host, path and session claims. Enforced by `check:proxy-imports`. `CLAUDE.md`'s invariant is retitled and its rationale rewritten.

**DECISION-178 — Supersedes DECISION-041's canonicalisation (its routing contract stands).** One owner-only SQL predicate decides the serving host for both directions: verified serving state, org active, site live, `org_portal.domains` toggle on, plus `sites.public_render`; the category axis is excluded. Every host-level redirect is a 307 with `no-store`, issued in the app. The slug URL 307s to the serving host (HTML pages and sitemap only), and otherwise serves itself as its own canonical, indexable. The `<slug>.presby.app` premise is retired. HSTS `includeSubDomains` is limited to platform hosts (F147).

**DECISION-179 — New top-level module `src/lib/domains/`** (a pure `host.ts` safe for the proxy and `next.config.ts`; rules; a pure state table; a server-only service with a single transition-and-audit choke point; Vercel, DNS and mail adapters with fakes), plus `src/app/api/cron/domains/` and pure `src/lib/site-urls.ts`. No new dependency: Vercel REST over `fetch` (`@vercel/sdk` rejected), DNS-over-HTTPS over `fetch` with a two-resolver lapse quorum and an SOA apex check (`dns/promises` and PSL packages rejected), Resend through the existing SDK. Providers enabled by explicit Production-only configuration, default `unconfigured`. The Vercel token is project-scoped.

**DECISION-180 — `organization_domains` holds one row per DNS host.** A proof at the entered name N covers N and `www.N`. A cross-org partial unique index on held hostnames means first-to-verify wins. A `BEFORE UPDATE` transition trigger guards the lifecycle. Column-limited `presby_app` grants, no `DELETE`. Caps and expiry enforced race-safe. No provider call before proof. Lapse → parked (30 days) → `release_pending`. Mail is a child table (`0058`). `domains.manage` is tier 1, has no constitutional binding, and joins DECISION-155's administration half with a measured backfill (F150). The platform side reuses `FEATURES.ADMIN_ORGANIZATIONS`, and the platform admin never enables church mail.

**DECISION-181 — Every same-host URL on the public surface comes from `SiteUrls`, built only from the resolved database row; a source-scan test bans hand-built `/site/${…}`.** The slug may appear on a custom host only as the absolute platform portal link and as opaque action arguments. The donor return origin is `donorOrigin(slug)` (database canonical host, else `givingOrigin()`), never the request. Treasurer and statement links stay on the platform.

**DECISION-182 — Outbound mail goes through a closed sender registry: `account` | `org` | `org_fallback_only` (credential-bearing org mail), unknown keys treated as `account`.** For the org classes the sender is resolved at each attempt, never at enqueue. `email_queue` (still a platform outbox) gains `organization_id` and a composite `MATCH SIMPLE` `sender_mail_domain_id`. A reputation hold requeues without consuming an attempt and is never rerouted. No new `presby_app`-callable sender oracle. The resolver is keyed by sending pool, ready for a separate Resend team (F149). The fallback From is distinct from the account-mail From.

### Draft findings (for `docs/schema-design-2.md`)

- **F146 — the proxy is not an Edge function.** Next 16 runs `src/proxy.ts` on Node.js: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:253-255` (v16.3.6), and the built `.next/server/functions-config-manifest.json` shows `"/_middleware": {"runtime": "nodejs"}` with an empty edge middleware manifest. `CLAUDE.md`'s "importing `@/lib/db` breaks the build or the runtime" no longer holds, so the invariant is unenforced until `check:proxy-imports` lands.
- **F147 — HSTS would pin a church's whole domain.** `next.config.ts:22` sends `max-age=63072000; includeSubDomains` on every response. On a church whose canonical host is the apex, that pins HTTPS for *all* its subdomains for two years and outlives the church's departure. Vercel's own default for custom domains omits `includeSubDomains`.
- **F148 — Vercel's production-URL variable can name a church domain.** `VERCEL_PROJECT_PRODUCTION_URL` is "the shortest production custom domain". Once church domains attach to the same project, a short church apex can become its value; fed into the platform-host set, it would serve `/signin` and `/admin` on that church's domain. Forbidden as a host-set or origin source.
- **F149 — one church can pause everyone's sign-in mail.** Resend's limits (bounce under 4%, spam under 0.08%) are enforced on the whole account and pause sending for the whole team, sign-in and reset mail included. The pre-verification fallback sends church mail through the same account and domain. A per-domain breaker trips after webhook latency, too late for a single bad batch. Motivates sending pools.
- **F150 — the new permission is unreachable under F111.** No organization holds `domains.manage`, so `assertPermissionSubset()` makes it ungrantable everywhere unless the founding-administrator bundle delivers it, plus a backfill for organizations already designated.
- **F151 — some responses bypass the proxy's host branch.** `next.config.ts` `redirects()` (the `/orgs` 308) and `headers()` run before the proxy. The matcher's static exclusions (`favicon.ico`, `*.svg|png|…`, `public/brand/*`, the app icon routes, `_next/*`) answer on any attached host. Accepted as an enumerated residual, with the `/orgs` redirect scoped to platform hosts and a test listing exactly which static paths answer on a custom host.
- **F152 — widening the published-site function resets its grants.** Adding OUT columns to `presby_published_site(text)` requires DROP/CREATE, which resets its ACL (live: owner + `presby_app`, no `PUBLIC`) — the same drift as F38. Separately, `email_queue` has no RLS and `presby_app` holds full DML on it (live grants), so org-attributed church mail is readable across orgs by any tenant-connection bug. Accepted on two conditions: tenant reads reach it only by joining from their own RLS-filtered rows (as PR #31's `giving_statement_deliveries` does), and `test-rls.sql` asserts both ACLs.

### `CLAUDE.md` / `architecture.md` changes (for the orchestrator)

1. **Key Invariants.** Replace "The Edge Gate Cannot Reach the Database" with **"The Proxy Does Not Reach the Database"**: it runs on Node.js (Next 16), it imports `edgeAuth`, the permission constants and `src/lib/domains/host.ts`, nothing else, and `check:proxy-imports` enforces this (DECISION-177).
2. **New invariant, "A Custom Host Is a Key, Not an Identity."** The platform-host set and build assertion; host classification as the first proxy branch; the rewrite to `/site/<host>`; the `Host`-equality check; one definer read; no session or cookies; absolute URLs only from the database row; 307 only; `VERCEL_PROJECT_PRODUCTION_URL` forbidden (DECISIONS 176/178/181).
3. **"The Brand Is a Cascade Override."** One line: custom hosts render through `(public)/site/[slug]`, there is no third group, and `check:brand-scope` is unchanged.
4. **Project Layout.** Add `src/lib/domains/`, `src/lib/site-urls.ts`, `src/lib/email/senders.ts`, `src/app/api/cron/domains/`.
5. **Phase 4 gate.** Add `src/proxy.ts` to the auth-touching list.
6. **Common Commands.** Add `check:proxy-imports`; "six tripwires" becomes seven.
7. **New invariant, "Account Mail Stays on the Platform Domain".** State the three registry classes.
8. **`.claude/agents/architect.md` route-group rules.** Add: "`(public)/site/[slug]` — the segment is a site key: a slug on platform hosts, or a verified host reached only by the proxy's custom-host rewrite."
9. **`docs/architecture.md`, at Phase 6 (Rule 15; a new subsystem).** §8: a paragraph on custom domains (proof, then attach, then serve; one predicate both ways; mail sender pools). §10: correct that the proxy runs on Node.js.
10. **`docs/deployment.md`.** New variables: `VERCEL_API_TOKEN` (project-scoped), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `NEXT_PUBLIC_PLATFORM_HOSTS`, `DOMAINS_PROVIDER`, `MAIL_DOMAINS_PROVIDER`, `ORG_MAIL_FALLBACK_FROM`, optionally `RESEND_ORG_API_KEY`. All Production scope only.

### Handoff

**Next: tech-lead (Phase 3).** Design against R1–R14; rule on the [D] gaps with these rulings as constraints. Name the implementers per batch: database-admin for `0057`/`0058`, the definer functions and the `test-rls.sql` section; full-stack for 1a–1c; ux for 1d; api for 2a–2c. Schedule `check:proxy-imports` and the `next.config.ts` host split (HSTS, the `/orgs` redirect) in Batch 1c, after the PR #31 rebase. Operator answers needed before Phase 3 closes: Q1–Q4 (Phase 1), plus Q13 (second Resend team) and Q14 (platform-host value and the production project move). The R13 backfill must be measured on the production catalog.

**Sources:** [Vercel REST: Add a domain to a project](https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project) · [Vercel REST: Get a domain's configuration](https://vercel.com/docs/rest-api/reference/endpoints/domains/get-a-domain-s-configuration) · [Vercel: Project-scoped tokens](https://vercel.com/changelog/project-scoped-tokens) · [Vercel: Access tokens](https://vercel.com/docs/accounts/access-tokens) · [Vercel: Encryption / HSTS](https://vercel.com/docs/security/encryption) · [Vercel: System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) · [Vercel: Multi-tenant limits](https://vercel.com/docs/multi-tenant/limits) · [Vercel for Platforms](https://vercel.com/docs/multi-tenant) · [Resend: Create domain](https://resend.com/docs/api-reference/domains/create-domain) · [Resend: Account quotas and limits](https://www.resend.com/docs/knowledge-base/account-quotas-and-limits.md)

---

## Phase 2 addendum — rulings on T4–T7 (architect, 2026-10-19)

*Read-only; recorded verbatim by the orchestrator.*

**Verdict: Approved with suggestions.** T4, T5 and T6 are each ruled below. T4 and T6 carry binding amendments (A1–A6). The feature shape is unchanged, so nothing goes back to Phase 1. **Batch 1a-i may start**, as long as A1–A3 are folded into the Phase 3 Data Model first. They change the `0057` grant list, trigger and CHECKs, and the tech-lead can fold them in without another Phase 2 pass. 1a-ii may follow as planned.

### T4: who writes state and observation columns

**Ruling: the tech-lead's reading stands.** The writes use column-limited `presby_app` grants inside the tenant's own `withOrgContext` transaction, with the `BEFORE UPDATE` edge trigger as the authority on both connections.

- **Platform connection from an `(org)` action: rejected.** The house has kept to the `(org)` contract even through library code. `branding/actions.ts:60-68` accepted a named gap rather than reach `getPlatformDb()`, and `tickets-notifications.ts:23` uses `db` for the same reason. Domains does not get to be the first exception.
- **SECURITY DEFINER transition functions as the main mechanism: rejected.** The database cannot see DNS, Vercel or the probe. A definer function would trust the caller's claim exactly as much as a column grant does, and would add a second edge table to keep in step with `state.ts` and the trigger. 0047's own note (line 1661) says `current_user` is the wrong axis to rely on once a DEFINER function is in the picture.

Binding amendments, all in `0057`:

- **A1. The grace deadline belongs to the trigger, not the tenant.** As drafted, `grace_ends_at` is in `presby_app`'s UPDATE grant, and the `lapsed|parked → release_pending` side condition reads it, so a tenant write of a past date skips the grace — making T2's claim ("only a platform admin can … skip the grace") false. Fix: revoke `grace_ends_at` from `presby_app`; the trigger stamps it on entering `lapsed` or `parked` and refuses any other change to it on either connection; the 30-day constant lives in the trigger, and a test pins it to `policy.ts`, as the edge table is pinned.
- **A2. `release_cause` is tied to evidence the tenant cannot write, not to `current_user`.** Otherwise a tenant can record `evicted` or `force_released` on its own removal. CHECKs/trigger rules: `release_cause in ('force_released','evicted')` requires `force_release_reason is not null` (owner-only column); `lapsed_grace` requires `old.grace_ends_at <= now()`; `org_closed` requires the organization's lifecycle status to be closed (a trigger read).
- **A3. Correct the named residual.** "It cannot reach another org" is wrong: `organization_domains_hostname_holding_uq` is a cross-org fact, so a tenant-path write into a holding state blocks every other org from that name. Corrected wording: an app bug on the tenant path can move its own org's rows along legal edges; because the holding index is global, entering a holding state without real proof denies that name to other orgs. The cure is the platform's `disputed` hold plus `force_release`. The F150-neighbourhood and edge-case entries should say this.
- **A4. Writes to `organizationDomains` happen only in `src/lib/domains/service.ts`.** A Vitest source-scan test (like F148's) fails on `.update(organizationDomains` or `.insert(organizationDomains` anywhere else under `src/`.

1a-i's gate already checks `has_column_privilege` (test-rls-47 (h)); extend (h) to cover `grace_ends_at`.

### T5: org-class mail is enqueue-only

**Ruling: enqueue-only, as designed.** Replace R11's inline-attempt sentence with: "org-class mail has no inline attempt; sender resolution happens only in the worker, on the platform connection." R11's premise does not match the code: `enqueueEmail` (`src/lib/email/queue.ts:228-282`) runs on bare `db` with no transaction, and callers such as `statistics-grants.ts:319` call it outside any tx handle. An inline path would split sender resolution across two connections and two code paths; DECISION-182 already says "never at enqueue and never by a `presby_app`" caller.

The cost: org-class mail, including credential-bearing statistics grants, now depends entirely on the email-queue cron. Binding conditions:
- **A5. Something must notice a stalled queue.** A staleness signal for org-class rows still `queued` more than 15 minutes past `next_attempt_at`, surfaced where the tech-lead chooses (the maintenance sweep's operator alert or the platform admin email surface); ships in 2a. A test pins `sentInline: false` for both org classes.
- The T6 exemption (A6) is now required, not optional — a cron that silently 404s stops all church mail.

### T6: which host a Vercel cron uses

**Finding:** Vercel's docs say only "an HTTP GET request to your project's production deployment URL", with `https://*.vercel.app/api/cron` as the example; they do not rule out a custom domain (the same ambiguity behind F148). Crons are not retried, do not follow redirects (a 3xx is final), redirect/cached responses do not appear in the logs, and delivery is best effort. A cron sent to a church host would fail silently.

**Ruling: build the exemption now, in Batch 1c. Do not wait for the observation** (the planned pre-attach observation will always see the platform host).

- **A6. Amends R4 and DECISION-176.** In the custom-host branch of `src/proxy.ts`, before the rewrite: `NextResponse.next()` only if `CRON_SECRET` is set and non-empty, the pathname **exactly equals** one of the `vercel.json` cron paths (exact allow-list `/api/cron/email-queue`, `/api/cron/maintenance`, `/api/cron/domains`, pinned to `vercel.json`'s `crons[].path` by a test), and `Authorization` equals `Bearer ${CRON_SECRET}` compared in constant time (`node:crypto` `timingSafeEqual` with a length check; Node runtime per F146). Not keyed on the user agent or `x-vercel-cron-schedule`. No database. Handlers keep their own bearer check. Tests on a custom host: a valid bearer reaches the handler with no `Set-Cookie`; a missing or wrong bearer, or unset `CRON_SECRET`, gets a response byte-identical to the custom-host 404 for any other `/api/*` path; encoded or dot-segment path variants do not match. **Gate change:** the cron host observation moves to the acceptance pass, after the first attach of the throwaway domain (ideally shorter than the platform host); record the logged host class for at least two scheduled runs of each cron; keep the one-line host-class log.

### T1–T3, T7 and the other choices the tech-lead made alone

- **T1 (only `live` serves; the proxy answers an HMAC probe): confirmed.** The ack binds both the host and a fresh random nonce from the sweeper (no replay). Add the probe's 204 to R4's no-`Set-Cookie` test list.
- **T2 (pause is a hold column): confirmed, conditional on A1.**
- **T3 (`purpose` column): confirmed.** Residual for DECISION-180: holding uniqueness is per purpose, so two orgs can hold the same hostname for web and for mail (requires the DNS owner to have published both tokens; accepted). If ever unwanted, a `btree_gist` exclusion constraint on (hostname `=`, organization_id `<>`). Not required now.
- **T7 (no `requires_two_factor` on `domains.manage`; notification on claim and release): confirmed for Increment 1.** **Binding for 2a:** `setOfficeEmailAction` (sets the Reply-To on all church mail, no DNS proof) must notify every holder **and the previous office address** (account-class mail), alongside the `office_email.changed` audit row. TODO S3 stays tracked.
- **Also confirmed:** T8 (boot assertion); T10 (no category axis on the admin page); T12 (`presby_current_org_site_status()` takes no argument); `tx.insert(auditEvents)` instead of `recordAudit()`; a 5-minute cadence with the 10-minute lease and `skip locked`.

### Suggestions (not binding)

1. Have the trigger also stamp `proof_verified_at`, `attached_at`, `live_at` and `released_at` on their edges, and remove them from the grant.
2. Cap any `next_check_at` that `presby_app` writes to no more than now plus the longest backoff (6 hours).

### Decisions (amendments to drafts, no new numbers)

- **DECISION-176:** add A6.
- **DECISION-180:** add A1 and A2, A3's corrected residual and T3's cross-purpose residual.
- **DECISION-182:** strike the inline attempt for org classes (T5) and add A5.

**Per-Phase Status:** | 2 — Architectural review (addendum T4–T7) | architect | Complete | Approved with suggestions (A1–A6 binding) | 2026-10-19 |

**Handoff:** tech-lead short fold pass (A1–A4 into the Data Model; A5 into the 2a gate; A6 into 1c's scope and gate; cron host observation to the post-attach acceptance pass), then database-admin starts Batch 1a-i.

**Sources:** [Vercel — Cron Jobs](https://vercel.com/docs/cron-jobs) · [Vercel — Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) · [Vercel Community — Why my production URL is not my actual domain?](https://community.vercel.com/t/why-my-production-url-is-not-my-actual-domain/1790)

---

## Operator rulings on the Phase 1/2 open questions (2026-10-19)

- **Q1 — who flips the org toggles:** **platform admin only, for now** (the org toggles `org_portal.domains` / `org_portal.mail_domain` are operator-enabled during the first-customers era; self-service later).
- **Q2 — platform admin may record a web claim on an org's behalf:** **yes, for web** (DNS proof still required; audited as the platform actor). Mail stays church-only.
- **Q3 — Reply-To:** **a new "office email" field on the org profile**; blank → replies go to PresbyPortal support and the "via PresbyPortal" sender stays.
- **Q13 — second Resend team for church mail:** **decide later** — design for sending pools (R11) so either answer works; decide before Increment 2 sends real church mail.
- **Q14:** answered by events — the operator deleted the legacy `presby-portal` Vercel project and connected `presby` to GitHub (`www.presbyportal.org` serves from `presby`); `NEXT_PUBLIC_PLATFORM_HOSTS=presbyportal.org,www.presbyportal.org` stands as proposed.
- **Q4–Q12 not asked:** take the analyst's recommended defaults (Q4 platform admin resumes, conservative thresholds; Q5 alert at 8 of 10; Q6 7-day claim expiry, 30-day parked; Q7 require grey-cloud DNS-only for now; Q8 legacy-URL redirects a separate pipeline; Q9 the operator's throwaway test domain is asked for at the acceptance pass; Q10 PR #31 first; Q11 fixed `notifications@`; Q12 all `domains.manage` holders plus the platform admin).
- **R13 production measurement (orchestrator, read-only, 2026-10-19):** production holds **0** `founding_administrator` roles (8 roles total, all in one org), so the `domains.manage` backfill touches zero rows today; design it anyway for whatever exists at deploy time.

---

# Phase 3 — Technical Design (tech-lead)

*2026-10-19, tech-lead. Designed against the live trees: `presby-domains` (main) for everything except Batch 1c, and `presby-giving` (PR #31, v0.34.0) for the files Batch 1c touches. Read-only so far: no code, migration, or shared file has been edited.*

> **Fold note, 2026-10-19 (tech-lead): Phase 2 addendum A1–A6 folded in place. Batch 1a-i is READY for database-admin.**
> The architect's addendum ("Phase 2 addendum — rulings on T4–T7") confirmed T1–T7 and bound six amendments. ("A1–A6" here and in the text below are the architect's amendments; they are not the adversarial-table rows A1–A18 under Edge Cases, which keep their own numbers.) Where each landed (sections below carry the text; nothing here is a second source):
> - **A1** (grace deadline belongs to the trigger): Data Model → `grace_ends_at` row, Grants, Trigger 2, the 30-day constant and its `policy.ts` pin.
> - **A2** (`release_cause` tied to evidence the tenant cannot write): Data Model → Trigger 2 "release_cause rules" and the side-condition CHECKs.
> - **A3** (corrected cross-org residual): Edge Cases ("State columns writable by `presby_app`"), F150-neighbourhood note, DECISION-180 draft.
> - **A4** (service-only writes): Data Model → item 7 (source-scan test), a 1a-i deliverable.
> - **A5** (stalled-queue signal): Implementation Order → Batch 2a gate; DECISION-182 draft.
> - **A6** (bearer-keyed cron pass-through on custom hosts): API Contract §1/§2, Batch 1c scope and gate, Edge Cases, DECISION-176 draft. The cron host observation moved to the post-attach acceptance pass (step 5).
> - **T1** nonce-bound probe ack: §1 `probe.ts`, §2 proxy. **T3** cross-purpose residual: DECISION-180. **T7** binding 2a notification: §6 `setOfficeEmailAction`, Batch 2a gate.
> - **Non-binding suggestions** (decided): (1) trigger-stamped timestamps, **adopted** (and extended to `state_changed_at`); (2) capped `next_check_at`, **adopted with a state-aware cap**, 6 h everywhere except `parked` at 24 h, because `policy.ts` runs `parked` on a 24 h cadence and the architect's flat 6 h would have contradicted it. See Trigger 2.
> - **Surfaced by the fold (design consequences, not new scope):** (i) tests can no longer backdate `grace_ends_at` through a column grant, so `expires_at`/`grace_ends_at` backdating uses one sanctioned seam (Data Model item 8); (ii) `org_closed` is tied to `organizations.lifecycle_status <> 'active'`, so an org that is merely `status`-inactive is darkened by the predicate but not auto-removed (Edge Cases, amended).

## Summary

A congregation (or presbytery, or synod: nothing here is congregation-specific) proves it controls a domain by publishing one TXT record, and only then do we attach the host to the `presby` Vercel project and serve that org's public site on it. The host is a lookup key and never an identity: `src/proxy.ts` (Node runtime on Next 16, F146) classifies the request `Host` as platform or not using only the env-derived platform-host set; a non-platform host is rewritten to `/site/<host><path>` inside the existing `(public)/site/[slug]` tree. There, one cached resolver checks the request `Host` equals the key and makes one `SECURITY DEFINER` read that collapses every non-serving state to zero rows. A new top-level module `src/lib/domains/` owns the claim record (`organization_domains`, one row per DNS host), a database-guarded state machine with a single transition-and-audit choke point, DNS-over-HTTPS (two resolvers) and Vercel REST adapters behind interfaces with fakes, a 5-minute cron sweeper, and the checklist view-model. A pure `SiteUrls` builder replaces every hand-built `/site/${slug}` URL. Increment 2 adds church-domain email on the same proof: a closed sender registry, send-time sender resolution on the platform connection, sending pools (so a second Resend team stays a config decision), a per-domain breaker that holds (never reroutes) reputation failures, and `organization_mail_domains` (0058). Two org toggles, enabled by a platform admin only (Q1), gate the features; `domains.manage` (tier 1) joins the founding-administrator bundle (F150), with an on-behalf path for platform admins on web claims only (Q2).

## Phase 3 refinements to the Phase 2 text (architect addendum 2026-10-19: T1–T7 confirmed; A1–A6 folded and marked below)

R1–R14 are honoured. Where design needed a finer decision than the architect text gave, the choice is numbered here so it is visible rather than buried.

| # | Refinement | Why |
|---|---|---|
| T1 | **`live` is the only serving state.** `attached` means "on Vercel, DNS/TLS not yet confirmed." The slug-URL redirect, the host lookup, `donorOrigin()` and the alias redirect all test the same predicate, so the interlock is structural. `attached → live` is driven by a proxy-answered HMAC probe (suggestion 1, adopted), so it needs no tenant read. *Architect: confirmed; the ack binds the host **and** a fresh random nonce from the sweeper (no replay), and the probe's 204 joins the no-`Set-Cookie` test list.* | One predicate beats two. The cost is a post-flip 404 of at most one cron interval (5 min); "Check now" and the runbook cover it. |
| T2 | **Pause is a hold column, not a state:** `platform_hold` (`paused` or `disputed`), `hold_reason` and `force_release_reason` are not granted to `presby_app`. The serving predicate requires `platform_hold is null`. | A pause needs no "state to resume to", and the column is unwritable from the tenant connection. This is what makes "only a platform admin can pause, resume or skip the grace" a database fact. |
| T3 | **`purpose` column (`web` or `mail`).** A mail proof is a row in `organization_domains` with `purpose = 'mail'`, which can never attach or go live. `organization_mail_domains` (0058) references that row with the composite FK R10 asked for. Hostname uniqueness is per purpose. | Reuses the proof, state machine, trigger and cron. A mail-only org never creates a Vercel attachment. A web org that enables mail reuses its TXT (same token, same name). |
| T4 | **State and observation columns are writable by `presby_app`** (own org via RLS, legal edges only via the trigger). R10's "tenant-intent columns" is applied as *column-limited*: `hostname`, `claim_name`, `proof_token`, `organization_id`, `expires_at`, `created_*`, `platform_hold`, `hold_reason` and `force_release_reason` are not writable. | "Check now" observes DNS inside the tenant's own transaction; the alternative (an `(org)` action reaching `getPlatformDb()`) is forbidden by the `(org)` contract. RLS plus the edge trigger still bound an app bug to its own org's legal edges. The residual is named in F150's neighbourhood and in the edge-case table. *Architect: ruled, my reading stands; amended by A1–A4 and the corrected residual (a tenant-path write into a holding state denies that name to other orgs, because the holding index is global). The platform connection from an `(org)` action and SECURITY DEFINER transition functions were both rejected.* |
| T5 | **Org-class mail is enqueue-only.** `enqueueEmail` for `org`/`org_fallback_only` makes no inline attempt; the cron worker resolves the sender on the platform connection. Account-class mail keeps its inline attempt. | R11 says no new `presby_app`-callable sender oracle. The worker is the only caller that needs the platform connection, and an inline attempt resolving "inside the caller's org transaction" would force `enqueueEmail` to take a transaction it does not currently use. Cost: org-class mail waits up to one 5-minute tick. *Architect: ruled, enqueue-only stands (R11's inline sentence is struck: "org-class mail has no inline attempt; sender resolution happens only in the worker, on the platform connection"). Binding **A5**: a staleness signal for org-class rows (Batch 2a gate), and **A6** is now required, not optional.* |
| T6 | **Cron host risk (new, high).** Vercel's cron docs do not say which host a scheduled invocation uses. If Vercel ever invokes `/api/cron/*` on a church's host (the same shape as F148), R4 would 404 every cron, silently. **Ruled by the architect (A6): build the exemption now, in Batch 1c; do not wait for the observation** (a pre-attach observation can only ever see the platform host). The proxy's custom-host branch passes a request through (`NextResponse.next()`) only when `CRON_SECRET` is set and non-empty, the pathname **exactly equals** one of the `vercel.json` cron paths (exact allow-list, pinned to `vercel.json` by a test), and `Authorization` equals `Bearer ${CRON_SECRET}` compared in constant time. Not keyed on the user agent or `x-vercel-cron-schedule`; no database. Each cron handler still logs a one-line host class, and the **observation moved to the post-attach acceptance pass**. Full spec in API Contract §2. | A silent loss of the email-queue worker would be worse than any host-resolution bug, and org-class mail now depends entirely on that worker (T5). |
| T7 | **`domains.manage` does not set `permissions.requires_two_factor`** (PR #31's mechanism, "extending it to tier-3 keys is a tracked follow-up"). Instead every claim, canonical change, removal and force-release notifies all holders plus the platform admin, and the actions sit behind the existing `/o/*` 2FA gate. Logged as TODO S3. *Architect: confirmed for Increment 1. **Binding for 2a:** `setOfficeEmailAction` must notify every holder and the previous office address (account-class mail) alongside the `office_email.changed` audit row.* | Extending the 2FA arm needs DECISION-175-style commission/delegation triggers and a drift pin; that is its own pipeline. |
| T8 | **Boot assertion scope is `VERCEL_ENV === "production"`**, not `NODE_ENV`. | `next build` always sets `NODE_ENV=production`; CI and local builds use `http://localhost:3000` and must not fail. |
| T9 | **Operator-only org toggles:** `ORG_FEATURE_CATALOG` entries gain `operatorEnabled: true`. `listFeatureToggles` omits them, `toggleOrgFeature` returns `invalid_key` for them, and a platform-connection writer flips them from `/admin/organizations/[id]`. | Q1 ruled "platform admin only, for now." Flipping `operatorEnabled` off later is the self-service switch. |
| T10 | **The domains admin page ignores the category axis** (`categoryAxisOn = false`). | R6 keeps the category axis out of serving; management should not be hideable by a curation preference either. The tile may still hide with its category. |
| T11 | **Cron cadence is every 5 minutes** (not the suggested 15), due-row driven. Thresholds are constants in `src/lib/domains/policy.ts` for operator review. | Cutover feel; the work is bounded by `next_check_at`. |
| T12 | **`presby_current_org_site_status()`** (tenant-callable, no argument, returns the caller's own `organization_sites.status`). | `organization_sites` has no `presby_app` grant; the pre-flight check ("your site isn't published yet") needs it. No oracle: it takes its org from the GUC. |
| T13 | **The enforced give CSP must follow the clean path.** PR #31's `giveRouteHeaders` source is `/site/:slug/give/:path*`; `headers()` matches the *incoming* path, so a custom host's `/give` would get the report-only policy. Add `/give/:path*` (host-agnostic; a 404 on platform hosts). Folded into F151. | Found reading the #31 tree. |
| T14 | **`office_email` is tenant-set only** (by a `domains.manage` holder, on the mail section); the platform form shows it read-only. | Reply-To is a representation attribute (Two Hierarchies). `presby_published_site` never projects it. |
| T15 | **Reserved bundle segments grow** from `give` to `give, assets, robots.txt, sitemap.xml` (suggestion 2, narrowed to what actually shadows). | These are platform routes on a custom host as well. |
| T16 | **`platformOrigin()`** in `host.ts` is the single env-to-origin validator; `givingOrigin()` becomes a re-export so its tests keep passing. | One validator, not two. |

## Permissions & Flags

- **Tenant permission:** `domains.manage`, tier 1, module `domains`. One key for web and mail. Row inserted by `0057` (`insert … on conflict (key) do nothing`, the `0030` form; `requires_two_factor` is left at its default, see T7).
- **DECISION-078 test:** domain control is software-administration, not a constitutional duty, so no `stated_clerk` binding (the `brand_admin` precedent, DECISION-101). No new role either: a web volunteer who must hold it without `roles.manage` is served by the org granting `domains.manage` through a custom role (`roles.manage` is already in the bundle).
- **F111 / F150 (R13):** `foundingAdministratorPlan()` gains `"domains.manage"` in the `base` array (all org types get sites). It meets the amended criterion (i): no template can deliver it, because under `assertPermissionSubset()` a key nobody at the org holds can never be granted. Changes: `src/lib/founding-administrator.ts` plus its pinned bundle test, and the DECISION-155 amendment (carried by DECISION-180). The additive-only reconcile in step 9 of the designation transaction already tops up a *reused* role, so a re-designation self-heals.
- **Backfill (in `0057`):** `insert into app_role_permissions (role_id, permission_key) select id, 'domains.manage' from app_roles where key = 'founding_administrator' and organization_id is not null on conflict do nothing;`. Production measured 0 such roles on 2026-10-19 (8 roles, one org), so it is a no-op today and exists for whatever is designated before deploy. Dev currently has none either. **Mitigation if designation slips past go-live:** Q2's on-behalf web claim (the first customer's claim is made by a platform admin, DNS proof still required). The one existing production org has no `founding_administrator` role and nobody holds `domains.manage` there; its web claim, if ever wanted, is also on-behalf.
- **Platform side:** reuse `FEATURES.ADMIN_ORGANIZATIONS` (R9). `src/lib/permissions.ts` and `PROTECTION_RULES` untouched. Platform actions: view all, record a web claim on an org's behalf (Q2, audited as the platform actor, DNS proof still required), check now, pause/resume (`platform_hold`), force-release or evict (reason required), flip the two org toggles. It cannot enable mail-from-church or set `office_email`.
- **Flags:** no new platform flag. Chain for any tenant surface: existing `sites.public_render` (outer kill switch for serving) → org toggle → permission. Serving itself has no permission (anonymous).
- **Org toggles** (`ORG_FEATURE_CATALOG`, `flag: null`, `provisionedOn: false`, `orgTypes: null`, `operatorEnabled: true`, `category: "communications"`):
  - `org_portal.domains` — "Website domain": gates web claims, the admin page and serving (the owner-only SQL helper reads the toggle row).
  - `org_portal.mail_domain` — "Email from your domain": gates the mail section (Increment 2). Also the practical valve for the Resend domain cap.
  - Both default off; a platform admin turns them on per org.
- **Portal tile:** `domains` (`category: "administer"`, `domain: "communications"`, `orgFeatureKey: "org_portal.domains"`, href `/o/<slug>/admin/domains`). Permission-blind per DECISION-162; the page renders its own honest Forbidden / toggle-off state.

## Data Model

### Migration `0057_presby_org_domains.sql` (database-admin)

Hand-written, idempotent, registered in `drizzle/meta/_journal.json`. Before authoring, the implementer reads the **live** definition of `presby_published_site(text)` with `pg_get_functiondef` on the Neon branch and reproduces its OUT list exactly (not from `0024`), since later pipelines may have widened it.

**1. Permission and backfill.** `domains.manage` row; the `founding_administrator` backfill above.

**2. `organization_domains`.**

| Column | Type / default | Notes |
|---|---|---|
| `id` | uuid pk, `gen_random_uuid()` | |
| `organization_id` | uuid not null → `organizations(id)` **on delete cascade** | The cascade is only reachable through D10's guarded fixture teardown, exactly as `giving_*`. |
| `purpose` | text not null default `'web'`, check in (`web`,`mail`) | T3 |
| `hostname` | text not null | normalized punycode, lowercase. CHECK: `hostname = lower(hostname)`, label regex, ≥ 2 labels, ≤ 253 chars, no `.vercel.app` suffix, no `localhost`, last label not all digits |
| `claim_name` | text not null | what the admin typed (punycode). CHECK `hostname = claim_name or hostname = 'www.' \|\| claim_name`. The TXT sits at `_presby-challenge.<claim_name>` |
| `web_role` | text null | `canonical`/`alias`. CHECK `(purpose = 'web') = (web_role is not null)` |
| `state` | text not null default `'pending'` | CHECK in (`pending`,`verified`,`attach_pending`,`attached`,`live`,`lapsed`,`parked`,`release_pending`,`released`,`expired`) |
| `state_changed_at` | timestamptz not null default now() | **trigger-stamped** on every state change; not in the `presby_app` grant (suggestion 1) |
| `proof_token` | text not null | CHECK `~ '^[A-Za-z0-9_-]{32,}$'`; app generates `randomBytes(24).toString('base64url')`. Shared by the rows of one claim group (same org + `claim_name`); a mail row reuses the web group's token when one exists |
| `proof_verified_at` | timestamptz null | **trigger-stamped** on every edge entering `verified`; not in the grant (suggestion 1) |
| `proof_last_ok_at` | timestamptz null | service-written observation |
| `proof_miss_count` | int not null default 0 | consecutive *definitive-absent* observations |
| `probe_miss_count` | int not null default 0 | consecutive definitive-negative HTTPS probes |
| `expires_at` | timestamptz not null default `now() + interval '7 days'` | immutable; governs `pending → expired` |
| `grace_ends_at` | timestamptz null | **trigger-owned (A1).** Stamped `now() + interval '30 days'` by `organization_domains_guard_update` on entering `lapsed` or `parked` from any state other than `lapsed` (a `lapsed → parked` removal keeps the running deadline, so removing cannot extend a grace), cleared to null on entering `verified`, and refused on any other change **on either connection**. Not in the `presby_app` grant. The `30 days` literal is the one definition of the constant; a test pins `policy.ts`'s lapsed and parked grace values to it |
| `attached_at` | timestamptz null | **trigger-stamped** on `attach_pending → attached`; not in the grant (suggestion 1) |
| `live_at` | timestamptz null | **trigger-stamped** on every edge entering `live`; not in the grant (suggestion 1) |
| `platform_hold` | text null, check in (`paused`,`disputed`) | **owner-only** (T2) |
| `hold_reason`, `force_release_reason` | text null, ≤ 500 chars | **owner-only** |
| `released_at` | timestamptz null | **trigger-stamped** on entering `released`; not in the grant (suggestion 1) |
| `release_cause` | text null, check in (`removed`,`lapsed_grace`,`force_released`,`evicted`,`org_closed`) | granted to `presby_app`, but the trigger ties every value to evidence the tenant cannot write (A2, Trigger 2 "release_cause rules") |
| `next_check_at`, `last_checked_at` | timestamptz null | cron driver; the cron "leases" a row by bumping `next_check_at` 10 min at pick time. A write to `next_check_at` is capped by the trigger (suggestion 2, adopted state-aware: `now() + 6 h`, or `now() + 24 h` for `parked`) so a tenant cannot starve the sweeper's lapse detection |
| `last_check_class` | text null | `ok`, `dns_unknown`, `proof_absent`, `routing_wrong`, `held_elsewhere`, `provider_unavailable`, `provider_rejected`, `rate_limited`, `config_error` |
| `observation` | jsonb not null default `'{}'` | last per-record statuses (what the UI renders without re-querying DNS) |
| `provider_challenge` | jsonb null | Vercel's own `verification[]` TXT, when the domain is in another Vercel account |
| `ns_fingerprint` | text null | sorted NS set at first verification; a later mismatch only notifies (never enforces) — the passive-DNS-replay tripwire |
| `notify_state` | jsonb not null default `'{}'` | which warning emails were sent this episode |
| `created_via` | text not null, check in (`tenant`,`platform`) | |
| `created_by_user_id` | uuid not null → `users(id)` | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

**Keys and indexes**

- `unique (id, organization_id)` — Composite Tenant Keys.
- **Holding states** = `verified, attach_pending, attached, live, lapsed, parked, release_pending`. **Non-terminal** = everything except `expired` and `released`.
- `organization_domains_hostname_holding_uq`: unique `(hostname, purpose)` where `state in (holding states)` — cross-org, first to *verify* wins, database-enforced. The loser's `pending → verified` UPDATE raises `23505`; the service maps it to `held_elsewhere`, naming no org (A12).
- `organization_domains_org_host_uq`: unique `(organization_id, hostname, purpose)` where non-terminal.
- `organization_domains_one_canonical_uq`: unique `(organization_id)` where `web_role = 'canonical'` and non-terminal.
- `organization_domains_due_ix`: `(next_check_at)` where non-terminal.
- `organization_domains_org_ix`: `(organization_id, state)`.

**Row-level security.** `enable` + `force`, policy `tenant_isolation using (organization_id = presby_current_org())`, created in the `0021` style. The suite's C-3 catch-all is satisfied (FORCE).

**Grants** (`presby_app`)

- `select` (all columns).
- `insert (organization_id, purpose, hostname, claim_name, web_role, proof_token, created_via, created_by_user_id)`.
- `update (web_role, state, proof_last_ok_at, proof_miss_count, probe_miss_count, release_cause, next_check_at, last_checked_at, last_check_class, observation, provider_challenge, ns_fingerprint, notify_state, updated_at)`. **Deliberately absent (A1, suggestion 1):** `grace_ends_at`, `state_changed_at`, `proof_verified_at`, `attached_at`, `live_at`, `released_at`. The trigger stamps all six; a column named in no grant cannot be written by `presby_app` at all, and the trigger refuses an out-of-edge change on the owner connection too. (A `BEFORE` trigger assigning to `NEW` is not subject to the invoker's column privileges, which are checked against the `SET` list only; test-rls-47 proves the stamping works under `presby_app`.)
- No `delete`. Column grants bind `presby_app` only (F44); the triggers below are what bind the owner.

**Triggers** (all `SECURITY INVOKER`, `set search_path = public, pg_temp`)

1. `BEFORE INSERT organization_domains_guard_insert`: `state = 'pending'`, `platform_hold`, `hold_reason`, `force_release_reason`, `released_at` all null; takes `pg_advisory_xact_lock(hashtextextended('org_domains:' || organization_id::text, 0))`; counts non-terminal rows of the same purpose for the org and refuses the 4th web / 2nd mail row (`errcode check_violation`, message prefix `organization_domains: cap`), so the cap is race-safe without `FOR UPDATE` on `organizations` (which `presby_app` cannot do). It does **not** look at other orgs: pending claims never conflict and reveal nothing (G3); the cross-org check is the holding-state unique index at verify time.
2. `BEFORE UPDATE organization_domains_guard_update`:
   - immutable columns (`id, organization_id, purpose, hostname, claim_name, proof_token, expires_at, created_at, created_by_user_id, created_via`) compared with the `to_jsonb(old) - cols` idiom (as `0055`'s gift guard);
   - terminal rows (`expired`, `released`) are frozen;
   - a state change must be one of the **25 legal edges** (table below) and satisfies the edge side-conditions; the trigger itself stamps `state_changed_at := now()` and refuses a change to it outside a state change;
   - **stamps (A1, suggestion 1):** `proof_verified_at := now()` on every edge entering `verified`; `attached_at := now()` on `attach_pending → attached`; `live_at := now()` on every edge entering `live`; `released_at := now()` on entering `released`; `grace_ends_at := now() + interval '30 days'` on entering `lapsed` or `parked` from any state other than `lapsed`, and `null` on entering `verified`. Each of these columns is refused if it changes by any other route, on either connection;
   - `purpose = 'mail'` rows may never enter `attach_pending`, `attached`, `live`, `parked`, `release_pending` (a mail row's exits are `lapsed`, `verified`, `released`, `expired`);
   - `pending → expired` requires `old.expires_at <= now()`;
   - `lapsed|parked → release_pending` requires `old.grace_ends_at <= now()` **or** `new.force_release_reason is not null`. `grace_ends_at` is now trigger-owned, so a tenant can no longer satisfy the first arm by writing a past date; the only ways to skip the grace are the owner-only `force_release_reason` or the clock;
   - `platform_hold` may only change to `null`, `paused` or `disputed`;
   - **`release_cause` rules (A2).** `release_cause` may change only on an exit edge (one whose target is `parked`, `release_pending` or `released`), is cleared to null by the trigger on entering `verified` (a recovered or reconnected row carries no stale cause) and by nothing else, and is tied to evidence the tenant cannot write, not to `current_user`:
     - `force_released` or `evicted` requires `new.force_release_reason is not null` (an owner-only column); conversely, an exit edge with `force_release_reason` set must carry one of those two causes, so a tenant cannot record either on its own removal and the platform's reason cannot be relabelled;
     - `lapsed_grace` requires the edge `lapsed → release_pending` with `old.grace_ends_at <= now()`;
     - `org_closed` requires the edge `remove` and the organization's `lifecycle_status <> 'active'` (a read of `organizations` inside the trigger; the org tree is readable by `presby_app`, which test-rls-47 proves);
     - `removed` is the `remove` edge with `force_release_reason is null`;
     - `parked → release_pending` by `grace_elapsed` carries the cause set when the row was parked, unchanged and non-null; a force-release of a parked row replaces it with `force_released` or `evicted`;
     - entering `release_pending` or `released` requires a non-null `release_cause` (a table CHECK, below);
   - **`next_check_at` cap (suggestion 2).** When `next_check_at` changes, the new value must be `<= now() + interval '6 hours'`, or `<= now() + interval '24 hours'` when `new.state = 'parked'`. The caps are the longest cadence `policy.ts` assigns each state (`parked` 24 h; everything else at most 6 h); a test fails if any `policy.ts` cadence exceeds its trigger cap. This applies on both connections.
3. `BEFORE DELETE organization_domains_guard_delete`: the `presby_giving_guard_delete()` idiom — passes only when the parent `organizations` row is already gone (the sanctioned teardown cascade). Rows are never deleted otherwise (Never Hard-Delete).

**Legal edges** (the trigger holds this as a `values` table; `state.ts` holds the identical table and a test pins that they agree)

| From | Event → To |
|---|---|
| `pending` | `proof_ok` → `verified` · `expire` → `expired` · `remove` / `force_release` → `released` |
| `verified` | `attach_start` → `attach_pending` (web only) · `proof_lost` → `lapsed` · `remove` / `force_release` → `released` |
| `attach_pending` | `attach_ok` → `attached` · `proof_lost` → `lapsed` · `remove` → `parked` · `force_release` → `release_pending` |
| `attached` | `live_ok` → `live` · `proof_lost` → `lapsed` · `remove` → `parked` · `force_release` → `release_pending` |
| `live` | `live_lost` → `attached` · `proof_lost` → `lapsed` · `remove` → `parked` · `force_release` → `release_pending` |
| `lapsed` | `proof_ok` → `verified` · `remove` → `parked` · `grace_elapsed` / `force_release` → `release_pending` |
| `parked` | `reconnect` → `verified` (the service first confirms the proof is live) · `grace_elapsed` / `force_release` → `release_pending` |
| `release_pending` | `detach_ok` → `released` |
| `expired`, `released` | terminal |

One purpose-specific edge is added: `lapsed → released` (event `remove`) for `purpose = 'mail'` rows only, which never attach and so have nothing to park (the 25th edge).

**Side-condition CHECKs:** `state not in ('verified','attach_pending','attached','live') or proof_verified_at is not null`; `state not in ('attached','live') or attached_at is not null`; `state <> 'live' or live_at is not null`; `state not in ('lapsed','parked') or grace_ends_at is not null`; `state <> 'released' or released_at is not null`; `state not in ('release_pending','released') or release_cause is not null`.

**3. Functions** (all `security definer`, `set search_path = public, pg_temp`, `revoke all … from public`)

| Function | Callable by | Behaviour |
|---|---|---|
| `presby_org_serving_canonical_host(p_org uuid) returns text` | **owner only** (also revoked from `presby_app`) | The one serving predicate. Returns the canonical web host's `hostname` iff: that row is `web_role = 'canonical'`, `state = 'live'`, `platform_hold is null`; the org is `active`; its `organization_sites.status = 'live'`; and an enabled `organization_feature_toggles` row exists for `org_portal.domains`. The category axis is deliberately absent (R6). The caller (app) additionally checks `sites.public_render`. |
| `presby_published_site(p_slug text)` | `presby_app` | **DROP + CREATE** (F152). Existing OUT columns unchanged, plus `serving_host text` at the end (`presby_org_serving_canonical_host(o.id)`). Re-applies `set search_path = public, pg_temp` (0048 pinned it; a recreate loses it), `revoke all … from public`, `grant execute … to presby_app`, and the comment. |
| `presby_published_site_by_host(p_host text)` | `presby_app` | Same OUT list as `presby_published_site` plus `slug text`, `canonical_host text`, `request_is_canonical boolean`. Zero rows unless the requested host's row is `purpose = 'web'`, `state = 'live'`, `platform_hold is null`, **and** the org's canonical host is serving (so an alias can never redirect to a dark host). Implemented as a thin wrapper that calls `presby_published_site(o.slug)` — the projection stays single-sourced. A test pins `by_host`'s column list = `published_site`'s + three. |
| `presby_current_org_site_status() returns text` | `presby_app` | `organization_sites.status` for `presby_current_org()` only; null if none. No argument, so it is not an oracle (T12). |

`email_queue`, `presby_published_site`'s seven callers in `src/lib/sites.ts`, and `presby_public_staff_roster` / `presby_public_committee_roster` / the giving public-config function are **not** altered: the latter three stay slug-keyed and are called with the slug the database returned (R1).

**4. Feasibility checks (done against the live tree):** every function has no defaulted parameters; `DROP FUNCTION presby_published_site(text)` has no dependents (no view, and no `SECURITY DEFINER` body references it — `grep` of `drizzle/` finds only comments and the `0048` `ALTER`); the new CHECKs and triggers validate no existing fixture (the table is new and `seed-dev.sql` has no domain rows; the `\ir`'d `seed-dev-domains.sql` below inserts through `pending` and legal edges); the new composite FK (0058) names `organization_id` on both sides; `organization_domains` joins no existing `unique (id, organization_id)`. Added with the fold: the `org_closed` trigger read targets `organizations.lifecycle_status` (exists since `0044`, CHECK in `active|merged|divided|dismissed|dissolved`, so `<> 'active'` is exactly "a lifecycle act has closed it"); `release_pending` and `released` rows can only be created through edges that now require a non-null `release_cause`, and no shipped fixture or seed creates a domain row, so the new CHECK contradicts nothing; the trigger's `now() + interval '30 days'` and the `next_check_at` caps have no function-signature surface.

**5. Test suite.** `scripts/domains/test-rls-47.sql` (run as `presby_app`; one-line `\ir domains/test-rls-47.sql` appended to `scripts/test-rls.sql` **at integration**, Rule 16, exactly as `giving/test-rls-46.sql`). Each block ends in `rollback`. Assertions:
  - (a) `relforcerowsecurity`, policy text; (b) cross-org `select` returns zero; (c) cross-org `insert` refused by the policy; (d) cross-org holding uniqueness: org A holds `h`, org B inserts a pending `h` fine, B's `pending → verified` raises `23505`; (e) for each non-serving condition — each non-`live` state, `platform_hold` set, toggle off, toggle row absent, site `suspended`/`provisioning`, org not active — `presby_published_site_by_host` and `…serving_host` return zero rows/null; (f) alias with a dark canonical returns zero rows; (g) ACLs: helper not executable by `presby_app`, no `PUBLIC` entry in `proacl` for any of the four functions, `proconfig` pins `search_path`, `by_host` and `published_site` executable; (h) `has_column_privilege('presby_app', …, 'UPDATE')` is false for the owner-only and immutable columns **and for `grace_ends_at`, `state_changed_at`, `proof_verified_at`, `attached_at`, `live_at`, `released_at`** (A1, suggestion 1), no `delete`; (h2) as `presby_app`, an `UPDATE … SET grace_ends_at = …` is refused (permission denied) and a legal edge into `lapsed` stamps `grace_ends_at` within a second of `now() + 30 days` and the timestamps above on their edges; (h3) `release_cause` evidence (A2): `evicted`/`force_released` on a tenant `remove` refused, `lapsed_grace` refused before the grace, `org_closed` refused while the org is `active`, an exit edge into `release_pending`/`released` with a null cause refused; (h4) a tenant `next_check_at` beyond the cap refused (6 h; 24 h only when `parked`); (i) illegal edges (`pending → live`, `released → anything`, mail row to `attached`) refused, insert with a non-`pending` state refused; (j) cap: 4th web row refused, 2nd mail row refused; (k) duplicate host and second canonical refused; (l) hostname CHECK table (uppercase, 254 chars, `a..b`, trailing dot, IP, `x.vercel.app`, `localhost`); (m) `presby_current_org_site_status()` returns only the caller's own; (n) permission row tier 1; every `founding_administrator` role holds it; (o) F152 column-list pins.
  - The `lapsed → release_pending` positive path and the positive `org_closed` and `lapsed_grace` causes need a past clock or a closed org, which the `presby_app` suite cannot fabricate; they are owner-path Vitest cases (item 8).
  - Fixture rows: none durable. The e2e specs walk legal edges as the owner; `scripts/domains/seed-dev-domains.sql` (own file, `\ir`'d from `seed-dev.sql` at integration) inserts only the toggle row `org_portal.domains` for Alder Creek and the `domains.manage` binding to Alder Creek's `brand_admin` role so the existing sign-in-capable fixture user (Marguerite Ashcombe, `elder.fixture`) can drive the UI.
  - Vitest (`*.db.test.ts`, owner connection, serial per `docs/testing.md`): triggers on the owner path (edges, immutables, terminal freeze, delete guard, cap), the cascade premise on a `deletable_until` fixture org, one test per transition proving exactly one `audit_events` row (R8).

**7. Service-only writes (A4).** `src/lib/domains/service-only-writes.test.ts` (Vitest source scan in the F148 style; a 1a-i deliverable, vacuously green until `service.ts` exists) walks `src/**` and fails on `.update(organizationDomains` or `.insert(organizationDomains` anywhere except `src/lib/domains/service.ts` and the scan test itself, and on a raw `insert into organization_domains` / `update organization_domains` string in any non-test file. Owner-path fixtures use raw SQL in `*.test.ts`/`e2e/support/domains-fixture.ts`, which is why raw SQL is banned only outside tests. Mail rows (`purpose = 'mail'`) go through the same service.

**8. The one backdating seam.** Because `expires_at` is immutable and `grace_ends_at` is trigger-owned, tests that need a past clock (`pending → expired`, `grace_elapsed`, `lapsed_grace`) use a single helper, `backdateDomainClock(tx, domainId, { expiresAt?, graceEndsAt? })` in `e2e/support/domains-fixture.ts` (re-exported to `*.db.test.ts`): inside one owner transaction it runs `alter table organization_domains disable trigger organization_domains_guard_update`, updates the date, and re-enables the trigger before commit. It takes the table lock, so it runs only in the serial DB suites and e2e fixtures on the Neon branch, never from application code (the A4 scan covers `alter table organization_domains` strings in non-test files as well), and a test asserts `pg_trigger.tgenabled = 'O'` for all three guards after each use. The alternative considered and rejected: a GUC-driven clock override in the trigger, which any `presby_app` transaction could set.

**6. Drizzle schema.** `src/lib/db/domain/domains.ts` (`organizationDomains`), exported from `src/lib/db/domain/index.ts`. Registered with `npm run docs:erd`. The composite-FK-by-convention comment pattern from `sites.ts` applies where Drizzle would create an import cycle.

### Migration `0058_presby_mail_domains.sql` (database-admin; Batch 2a)

1. **`organization_mail_domains`.** `id`, `organization_id` (→ `organizations(id)` cascade), `domain_id uuid not null`, `mail_domain text not null`, `provider text not null default 'resend'`, `provider_domain_id text null`, `pool text not null` (`account`/`org`, copied from the sending pool at provisioning), `state text not null default 'awaiting_proof'`, `provider_status text null` (Resend's `not_started|pending|verified|failed|temporary_failure`, verbatim), `records jsonb not null default '[]'` (the DKIM/SPF/MX the UI shows), `reputation_hold_at timestamptz null`, `reputation_hold_reason text null`, `platform_hold text null`, `last_checked_at`, `next_check_at`, `last_check_class`, `removed_at`, `created_by_user_id`, `created_at`, `updated_at`.
   - `unique (id, organization_id)`; **composite FK** `(domain_id, organization_id) → organization_domains(id, organization_id)`; a `BEFORE INSERT` trigger checks the referenced row is `purpose = 'mail'` and `mail_domain = hostname`.
   - **States:** `awaiting_proof → provisioning → dns_pending → verified`, `failed`, `remove_pending → removed`, `rejected` (terminal: exists elsewhere / cap). Edges: `awaiting_proof→{provisioning, removed}`, `provisioning→{dns_pending, rejected, remove_pending}`, `dns_pending→{verified, failed, remove_pending}`, `verified→{dns_pending, failed, remove_pending}`, `failed→{dns_pending, remove_pending}`, `remove_pending→removed`. Same guard-trigger pattern as above (immutables, terminal freeze, edge table).
   - Indexes: unique `(mail_domain)` where state not in (`rejected`,`removed`) (cross-org); unique `(organization_id)` where state not in (`rejected`,`removed`) (**at most one active per org**).
   - RLS FORCE + `tenant_isolation`. Grants: `select`; `insert (organization_id, domain_id, mail_domain, pool, created_by_user_id)`; `update (state, provider_domain_id, provider_status, records, last_checked_at, next_check_at, last_check_class, removed_at, updated_at)`. **Owner-only:** `platform_hold`, `reputation_hold_at`, `reputation_hold_reason` (the breaker and the resume are platform acts). No delete; the teardown-cascade delete guard.
2. **`email_queue` attribution (R11).** `alter table email_queue add column if not exists organization_id uuid references organizations(id)`, `sender_mail_domain_id uuid`, `hold_started_at timestamptz`. Composite FK `(sender_mail_domain_id, organization_id) references organization_mail_domains(id, organization_id) match simple` (null on either side skips the check). Index `(sender_mail_domain_id, sent_at)` where `sender_mail_domain_id is not null` (the breaker's rolling window needs no counter columns, so counters cannot drift). `email_queue` stays RLS-less and already sits on the C-3 allow-list by name; F152's tenant-connection-bug residual stands with its two conditions. `src/lib/db/schema.ts` `emailQueue` gains the three columns (plain `uuid`; the FK lives in SQL, as `0056` did for `email_queue_id`), and `check:schema-parity` is updated in the same commit.
3. **Office email (Q3, T14).** `alter table organization_profiles add column if not exists office_email text`, CHECK `office_email is null or (length(office_email) <= 254 and office_email ~ '^[^\s<>",;:()\[\]\\]+@[^\s<>",;:()\[\]\\@]+\.[^\s<>",;:()\[\]\\@]+$')` — no CR/LF, quotes, angle brackets or comma, so header injection is closed at the table. Not added to any `presby_published_site*` projection (a test-rls assertion pins that the column is absent from both OUT lists).
4. **Test suite.** `scripts/domains/test-rls-48.sql`: FORCE/policy, one-active-per-org, cross-org mail-domain uniqueness, composite-FK refusal (queue row naming org B with org A's `sender_mail_domain_id`) and null-skip, grants (owner-only columns), edge table, CHECK table for `office_email`, projection pin, and `email_queue` still on the allow-list.

## API Contract

### 1. Module map and import rules

| File | Runtime / imports | Contents |
|---|---|---|
| `src/lib/domains/host.ts` | **pure, imports nothing** (safe for `proxy.ts` and `next.config.ts`) | `requestHost(headers)`, `normalizeHost(raw)`, `platformHosts()` (memoized), `isPlatformHost(host)`, `platformOrigin()` (T16), `parseSiteKey(param)`, `siteKeyRewritePath(host, pathname)`, `assertPlatformHostConfig(env)` (used by `next.config.ts`) |
| `src/lib/domains/probe.ts` | `node:crypto` only (proxy-safe) | `makeProbe(host)` → `{ header, expectedAck }` (the sweeper; the header is `<nonce>.<mac>` with a fresh 16-byte random `nonce` and `mac = HMAC(key, "req" ‖ host ‖ nonce)`), `answerProbe(host, headerValue)` → `ack | null` (the proxy; null if the MAC does not verify for that exact host and nonce; `ack = HMAC(key, "ack" ‖ host ‖ nonce)`, so an ack for one probe cannot be replayed for another — T1), `ackMatches(expected, got)` (constant time). Key = `HMAC-SHA256(AUTH_SECRET, "presby-domain-probe")` derived at call time (no new secret). |
| `src/lib/domains/cron-passthrough.ts` | `node:crypto` only (proxy-safe) | `CRON_PATHS` (the exact allow-list: `/api/cron/email-queue`, `/api/cron/maintenance`, `/api/cron/domains`) and `isCronRequest(pathname, authorization, secret)` → boolean (A6): false unless `secret` is a non-empty string, `pathname` is strictly equal to a `CRON_PATHS` entry, and `authorization` equals `Bearer ${secret}` under `timingSafeEqual` with a length check. Pure; no DB; no user-agent or `x-vercel-cron-schedule` input. |
| `src/lib/domains/hostname-rules.ts` | server-only, `node:url` | `normalizeClaimInput(raw)` → `{ ok, claimName, hostnames[] }` or `{ ok:false, reason }`; the G2 rules |
| `src/lib/domains/state.ts` | pure | `DOMAIN_STATES`, `EDGES`, `nextState(state, event, purpose)`, `TRANSITION_AUDIT` (event → `AUDIT_ACTIONS` key), `isHolding`, `isTerminal` |
| `src/lib/domains/policy.ts` | pure constants | thresholds and cadences (below) |
| `src/lib/domains/checklist.ts` | pure | `buildChecklist(rows, observation, targets)` → the view-model the pages render (record rows with `correct \| missing \| wrong_value \| conflicting \| unknown`, hints, step, banners) |
| `src/lib/domains/service.ts` | server-only | claim, check, canonical, remove, reconnect, hold, force-release, sweep, and `transitionDomain` |
| `src/lib/domains/notify.ts` | server-only | recipients and templates; always the `account`-class (platform) sender |
| `src/lib/domains/adapters/{dns,vercel,mail-provider,fake}.ts` + `index.ts` (`getAdapters()`) | server-only | interfaces, real adapters, fakes, provider selection |
| `src/lib/domains/toggles.ts` | server-only | platform-connection writer for the two `operatorEnabled` toggles |
| `src/lib/site-urls.ts` | pure | `buildSiteUrls(...)`, `slugSitePath(slug, path)` (the only platform-host `/site/<slug>` builder) |
| `src/lib/email/senders.ts` | server-only | registry, `resolveOrgSender`, `sanitizeDisplayName`, pool config |

Rules: `host.ts`, `probe.ts` and `cron-passthrough.ts` are the only files `src/proxy.ts` may import from this module (A6 adds the third; `check:proxy-imports`' allow-list is updated in the same change). Nothing under `src/lib/domains/` except `host.ts` and `probe.ts` may be imported by `next.config.ts` or a Client Component.

**`policy.ts` defaults** (operator-reviewable): pending expiry 7 d; parked grace 30 d; lapsed grace 30 d (**both pinned by a test to the trigger's `interval '30 days'`, A1**; the trigger holds the stamping, `policy.ts` holds the number the UI and emails quote); `proof_lost` after **6 consecutive definitive-absent observations spanning ≥ 10 h**; `live_lost` after **2 consecutive scheduled definitive-negative probes, or 1 when the check was forced**; cadences — `pending` 5 min, `attach_pending` backoff 1/2/5/15/60 min (alert after 24 h of failure), `attached` 5 min for 2 h then 30 min for 7 d then 6 h, `live` 2 h, `lapsed` 6 h, `parked` 24 h (weekly "records still point at us" email; its 24 h is the one cadence above the 6 h `next_check_at` cap, which the trigger lifts for `parked` only), `release_pending` backoff 5 min/15 min/1 h/6 h; "Check now" 6 per 10 min per domain and 30 per hour per org; new claims 5 per 24 h per org; caps 3 web / 1 mail.

### 2. Host classification and the proxy (`src/proxy.ts`, Batch 1c)

`requestHost(headers)` reads **only** the `host` header (never `x-forwarded-host`, `forwarded`, `x-original-host` or `nextUrl.host`), lowercases it, strips a `:port` and one trailing dot, and returns `null` for anything that is not ASCII hostname syntax (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.…)*$`, ≤ 253 chars) or, in production, an IP literal. `platformHosts()` is the union specified in R2 (host of `NEXT_PUBLIC_APP_URL`; `NEXT_PUBLIC_PLATFORM_HOSTS`; any `*.vercel.app`; outside production only: loopback, `DEV_ALLOWED_ORIGINS`, `*.trycloudflare.com`). `VERCEL_PROJECT_PRODUCTION_URL` is never read (F148) and a source-scan test bans the string outside comments.

First branch of `proxy()`, before the `/api/` bypass and before `PUBLIC_PATHS`:

```ts
const host = requestHost(req.headers);
if (host === null) return new NextResponse(null, { status: 404 });          // no DB, no session
if (!isPlatformHost(host)) {
  const probe = req.headers.get("x-presby-probe");
  if (probe) { const ack = answerProbe(host, probe); if (ack) return new NextResponse(null, { status: 204, headers: { "x-presby-probe-ack": ack } }); }
  // A6: bearer-keyed, exact-path cron pass-through (before the rewrite, no DB, no cookies)
  if (isCronRequest(req.nextUrl.pathname, req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.next();
  return NextResponse.rewrite(new URL(siteKeyRewritePath(host, req.nextUrl.pathname) + req.nextUrl.search, req.url));
}
// platform host: unchanged logic below, plus
if (/^\/site\/[^/]*(\.|%2e)/i.test(req.nextUrl.pathname)) return new NextResponse(null, { status: 404 });
```

The custom-host branch never calls `edgeAuth()`, never reads cookies, never branches on anything but host and the probe header. The probe responder reveals only that the host routes to this deployment, and only to a caller holding a valid `nonce.mac` for that exact host; the ack is bound to the host **and** the sweeper's fresh nonce (T1), so it cannot be replayed; nothing in the response depends on the database.

**Cron pass-through (A6; amends R4 and DECISION-176).** Vercel's docs do not say which host a scheduled invocation uses, and a cron that lands on a church host would otherwise 404 silently and stop all church mail (T5 made org-class mail depend entirely on the email-queue cron). `isCronRequest` passes a custom-host request through only when `CRON_SECRET` is set and non-empty, the pathname **exactly equals** an entry of `CRON_PATHS`, and `Authorization` is `Bearer ${CRON_SECRET}` under a constant-time compare (`timingSafeEqual` with a length check; Node runtime per F146). `CRON_PATHS` is pinned to `vercel.json`'s `crons[].path` set by a test (set equality, so adding a cron without the allow-list, or the reverse, fails CI; `/api/cron/domains` is in `vercel.json` from Batch 1b, ahead of 1c). It is not keyed on the user agent or `x-vercel-cron-schedule`, and consults no database. The handlers keep their own bearer check. Every other outcome falls through to the same rewrite as any other `/api/*` path, so a missing or wrong bearer, an unset `CRON_SECRET`, or a near-miss path is byte-identical to the custom-host 404 by construction, and the tests assert it anyway. Tests on a custom host: a valid bearer reaches each handler with no `Set-Cookie`; missing bearer, wrong bearer, empty bearer, unset `CRON_SECRET`, and a wrong-length bearer all return a status, body and header set byte-identical to a custom-host `/api/auth/csrf`; encoded and dot-segment variants (`/api/cron/email-queue/`, `%2F`, `%65mail-queue`, `/api/cron/./email-queue`-style raw forms, upper-case, double slash) do not match the allow-list unless Next has already normalized them to the exact path; the probe's 204 carries no `Set-Cookie`. `siteKeyRewritePath` = `/site/${host}${pathname === "/" ? "" : pathname}`. Server Actions posted to a custom host rewrite the same way, and Next's Origin-versus-Host check compares the church host with itself (verified in the e2e).

**`check:proxy-imports`** (`scripts/check-proxy-imports.mjs` + `.test.mjs`, wired into `npm run check`): walks the static *and* dynamic (`import()`) import graph from `src/proxy.ts` (resolving `@/` to `src/`), and fails if it reaches `src/lib/db/**`, `src/lib/sites*.ts`, `src/lib/domains/` other than `host.ts`/`probe.ts`, any file containing `import "server-only"`, or a bare import of `@neondatabase/*`, `drizzle-orm*`, `pg`, `ws`, `resend`, `bcryptjs`. Test fixtures: a clean graph, each forbidden class, a transitive violation, a dynamic import. Today's graph (`@/lib/auth/config`, `@/lib/permissions`, `next/server`) must pass on day one.

### 3. `next.config.ts` (Batch 1c)

- **Host split for HSTS (F147).** Replace the single `securityHeaders` HSTS entry with two `headers()` entries: `has: [{ type: "host", value: <platform-host regex> }]` → `max-age=63072000; includeSubDomains`; `missing: [{ type: "host", value: <same regex> }]` → `max-age=63072000`. The regex is built at config time from `platformHosts()` (dots escaped, `*.vercel.app` as `.+\.vercel\.app`) plus loopback outside production. **Verification the implementer owes before relying on it:** `curl -H 'Host: …'` against `next dev` and against `next build && next start` (the prod-build lane), asserting both headers; host matching ignores the port. **Fallback if `has`/`missing` host matching misbehaves:** set HSTS from `proxy()` on both host classes and drop it from config (the proxy matcher excludes static assets, which is acceptable: HSTS is per host and every host's first response is HTML).
- **`/orgs` redirect (F151).** Add `has: [{ type: "host", value: <platform regex> }]`; on a custom host it falls through to the rewrite and 404s.
- **Give CSP (T13).** Add `{ source: "/give/:path*", headers: giveRouteHeaders }` next to the two existing entries.
- **Boot assertion (R2, T8).** `assertPlatformHostConfig(process.env)` runs when `VERCEL_ENV === "production"`: `NEXT_PUBLIC_APP_URL` present and `https:`; its host is in the set; every `NEXT_PUBLIC_PLATFORM_HOSTS` entry is a valid hostname; `DOMAINS_ALLOW_RESERVED_TLDS`, `DOMAINS_DNS_PROVIDER=fake`, `DOMAINS_PROVIDER=fake` and `DOMAINS_FAKE_STATE_FILE` are all unset. Throws with a message naming the variable. **Feasibility hedge:** try `import { assertPlatformHostConfig } from "./src/lib/domains/host"` in `next.config.ts`; if the config loader will not take a relative `.ts` import, inline the function and keep a Vitest parity test over a table of inputs.

### 4. Site-key resolution, `SiteUrls`, and every call site (Batch 1c)

**`parseSiteKey(param)`** → `{ kind:"host", host } | { kind:"slug", slug } | { kind:"invalid" }`. A value containing a dot that normalizes as a hostname is a host; a value matching the slug label regex (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`) is a slug; anything else is `invalid` (→ `notFound()`).

**`resolveSite(key)`** — `src/lib/sites.ts`, `cache()`-wrapped, entire body in one `try/catch` (house style). Reads `requestHost(await headers())` and refuses on any mismatch:

| Key | Required request host | Read | On any failure |
|---|---|---|---|
| host `h` | `h` itself, and `h` is **not** a platform host | `isFlagEnabled("sites.public_render")` then `select * from presby_published_site_by_host(h)` | `{ kind:"not_found" }` (one shape, one read count for unknown / pending / lapsed / paused / released / toggle-off / DB blip) |
| slug `s` | any platform host | flag, then `select * from presby_published_site(s)` | same |

Success returns `{ kind:"ok", site, slug, urls: SiteUrls, redirect: { to: string; status: 307 } | null }`. `slug` is **always the value the database returned**; staff, committee, giving and contact-message reads use it, never the segment. `redirect` is set when (a) host mode and `request_is_canonical` is false (alias → `https://<canonical_host><path><query>`), or (b) slug mode and `serving_host` is non-null (→ `https://<serving_host><path><query>`, HTML pages and `sitemap.xml` only). The shared bundle/brand hydration moves out of `getPublishedSite` into `hydratePublishedSite(row)`. `getPublishedSite(slug)` stays exported as the slug-mode core and for the existing callers/tests. **Host mode never renders `PresbyteryFallback`** (a miss has no slug).

**`buildSiteUrls`** is called only by `resolveSite` and `slugSitePath`. Host mode: `origin = https://<host>`, `page("/about") = "/about"`, `asset(k) = "/assets/<k>"`, `sitemap() = "/sitemap.xml"`, `give() = "/give"`, `giveReturn(id) = "/give/return?session_id=…"`, `canonical(path) = origin + path`, `portal() = "<platformOrigin>/o/<slug>"` (absolute, fixed), `home() = "/"`. Slug mode: the same methods return today's `/site/<slug>…` paths with `origin = platformOrigin()`. Relative paths are safe because they resolve against the visitor's current host; every *absolute* URL comes from the verified row or the validated platform origin, never the request.

**Redirect mechanics.** A shared helper `redirectIfNeeded(resolved, { path, searchParams })` calls `redirect()` (307) from `[[...path]]/page.tsx`, `give/page.tsx`, and returns `NextResponse.redirect(url, 307)` from `sitemap.xml/route.ts` and `robots.txt/route.ts`. Each segment is re-encoded with `encodeURIComponent`. **Acceptance for the header:** the response carries `Cache-Control` containing `no-store` (verified in the e2e; if Next 16.3.6 omits it on RSC redirects, call `connection()` before `redirect()` so the dynamic-render default applies). Never a 301/308, never configured at Vercel.

**New files:** `(public)/site/[slug]/robots.txt/route.ts` (host mode: `User-agent: *`, `Allow: /`, `Sitemap: https://<canonical>/sitemap.xml`; slug mode: 404; alias: redirect) and `(public)/site/[slug]/not-found.tsx` (neutral, no product title; suggestion 3).

**Every hand-built `/site/${…}` and what replaces it** (the source-scan test bans `` `/site/${ `` outside `site-urls.ts` and `host.ts`):

| File (tree) | Today | Change |
|---|---|---|
| `render-site-page.tsx` (giving) `siteBundleMetadata`, `renderSitePage` | `pageUrl`, `imageUrl`, `resolveLogoUrl`, `siteOrigin()`, `portalUrl: /o/${slug}` | `urls.page`, `urls.asset`, `urls.asset(brand.markAssetKey)`, `urls.origin`, `urls.portal()`; both functions take the resolved site, not `slug`; `siteBundleHasPage(key, …)` takes the key; `<ContactForm action={submitContactMessageAction.bind(null, key)} />` |
| `[[...path]]/page.tsx` (giving) | `slug` param | param is the key; calls `redirectIfNeeded`, `notFound()` on miss |
| `layout.tsx` | `getPublishedSite(slug)` | `resolveSite(key)` (brand tokens from the result) |
| `sitemap.xml/route.ts` | `NEXT_PUBLIC_APP_URL` + `/site/${slug}` | `urls.origin`, `urls.page`; redirect when applicable |
| `assets/[key]/route.ts` | `resolvePublishedOrganization(slug)` | `resolveSite(key)`'s organization id; never redirects |
| `staff-directory.tsx:90`, `committee-directory.tsx:150` | `/site/${slug}/assets/…` | take `urls` (or a `photoUrl` builder) from the slot closure |
| `presbytery-fallback.tsx` | `/o/${slug}` | unchanged (slug mode only; platform host) — uses `slugSitePath` if it ever needs a site URL |
| `give/page.tsx` (giving) | back-link `/site/${slug}` | `urls.home()`; metadata via the resolved site |
| `give/return/page.tsx` | three `/site/${slug}…` hrefs | `urls.give()`, `urls.home()`, `urls.giveReturn(id)` |
| `public-giving-slot.tsx`, `give/actions.ts` | `createPublicGiveSessionAction.bind(null, slug)` | bind the **site key**; the action re-resolves it |
| `contact-form.tsx`, `actions.ts` | hidden `__slug` field | **delete the field**; the action receives the server-bound key, re-resolves it (host mode requires `requestHost() === key`), then uses the DB-returned slug for the rate-limit key and `submitSiteContactMessage` |
| `src/lib/sites.ts:566` (`getPublishedSiteBrand`) | `/site/${slug}/assets/…` | `slugSitePath(slug, "/assets/…")` (platform-host `/signin` context) |
| `(auth)/signin/page.tsx:84`, `components/shared/global-nav.tsx:127`, `(org)/o/[slug]/layout.tsx:159`, `org-states.tsx` ×2, `lib/auth/sign-out-action.ts` | `/site/${slug}` | `slugSitePath(slug)` — these are platform-host links; the slug URL 307s to the custom host while it is serving, which is exactly the intent |
| `src/lib/giving/give-session.ts` `checkoutReturnUrls` (giving) | `${origin}/site/${slug}/give` | `origin` is `donorOrigin(slug)`; the path built by `slugSitePath` when the origin is the platform, `/give` when it is a custom host; `{CHECKOUT_SESSION_ID}` placeholder untouched |
| `src/lib/giving/origin.ts` (giving) | `givingOrigin()` | now `export { platformOrigin as givingOrigin }`; plus `donorOrigin(slug)` in `src/lib/giving/donor-origin.ts`: `select serving_host from presby_published_site(slug)` → `https://<host>`, else `givingOrigin()`; computed in the action from the DB-returned slug, **never from the request** |
| `connection.ts` (treasurer return/refresh), `statements.ts` notice link | `givingOrigin()` | unchanged: treasurer and statement links stay on the platform host |
| `api/sites/ingest/route.ts:267`, `admin/organizations/[id]/actions.ts:137,529` | `revalidatePath("/site/…")` | unchanged: every segment is `force-dynamic` so revalidation is a no-op; a test asserts the `dynamic` exports so a future cached segment is noticed |
| `sites-reserved-paths.ts` | `["give"]` | `["give","assets","robots.txt","sitemap.xml"]` (T15) |

**Robots / indexing (G8).** `src/app/robots.ts` is unchanged for platform hosts. On a custom host the root layout's `robots: noindex` is overridden by each page's own `robots` metadata (bundle pages via `buildPageMetadata`); the 404 keeps `noindex`. The alias never renders (it redirects).

**Favicon and static exclusions (F151, accepted).** `/favicon.ico`, `/_next/*`, and image-extension paths bypass the proxy matcher and answer on any attached host with the platform's assets. Per-site favicons are deferred (TODO). A test enumerates exactly which paths answer on a custom host.

### 5. Adapters

```ts
// adapters/dns.ts
type DnsType = "A" | "AAAA" | "CNAME" | "TXT" | "CAA" | "SOA" | "NS";
type DnsAnswer =
  | { kind: "ok"; rcode: "noerror" | "nxdomain"; records: Array<{ type: DnsType; name: string; data: string; ttl: number }>; authenticated: boolean }
  | { kind: "error"; reason: "timeout" | "servfail" | "http_error" | "malformed" };
interface DnsResolver { query(name: string, type: DnsType): Promise<DnsAnswer> }
interface DnsObserver {
  /** Positive: at least one resolver shows the record. Negative ("absent"): BOTH resolvers answer ok and neither shows it.
   *  Any error or disagreement on a negative is "unknown". */
  lookup(name: string, type: DnsType): Promise<{ kind: "present"; records } | { kind: "absent" } | { kind: "unknown" }>;
}
```

- **Resolvers:** `https://cloudflare-dns.com/dns-query` and `https://dns.google/resolve`, `Accept: application/dns-json`, 4 s timeout each, no retry (the cron is the retry), `name` validated as a hostname before the request (fixed endpoints, so no SSRF surface). `AD` bit read for DNSSEC. TXT answers are unquoted and multi-segment strings joined.
- **Checks built on the observer:** proof TXT at `_presby-challenge.<claim_name>` (`present` with the value `presby-verify=<token>`; other `presby-verify=` values present but none matching → `wrong_value`); routing (A/CNAME vs Vercel's targets); leftover AAAA at the host; CNAME-at-apex via an SOA lookup at the exact name (an SOA answer means zone apex, so instruct A/ALIAS not CNAME); Cloudflare proxy detection (A answers inside Cloudflare's published ranges — `adapters/cloudflare-ranges.ts`, copied from Cloudflare's published IP list at implementation time and reviewed in the monthly dependency review) → `wrong_value` with hint `proxied`; CAA walk up the name tree, blocking if present and `letsencrypt.org` is not authorized for `issue`; DNSSEC (`servfail` that succeeds with checking disabled, or `AD` without matching DS → hint `dnssec`); `ns_fingerprint`.
- **Fake:** `FakeDns` is a zone map (`name+type → records`), per-resolver override, and error injection. State is read from `process.env.DOMAINS_FAKE_STATE_FILE` (default `.tmp/domains-fake.json`, gitignored) **on every call** so Playwright can set DNS, Vercel and probe state by writing a file; honoured only when `NODE_ENV !== "production"` (and rejected by the build assertion).

```ts
// adapters/vercel.ts  — REST over fetch, 8 s timeout, no SDK
interface HostingProvider {
  addDomain(host: string): Promise<AddResult>;       // POST /v10/projects/{id}/domains?teamId  body {name}
  getDomain(host: string): Promise<GetResult>;       // GET  /v9/projects/{id}/domains/{host}
  verifyDomain(host: string): Promise<VerifyResult>; // POST /v9/projects/{id}/domains/{host}/verify
  getConfig(host: string): Promise<ConfigResult>;    // GET  /v6/domains/{host}/config?projectIdOrName={id}  (best effort)
  removeDomain(host: string): Promise<RemoveResult>; // DELETE /v9/projects/{id}/domains/{host}
}
type AddResult =
  | { kind: "ok"; verified: boolean; verification: Array<{ type: string; domain: string; value: string; reason: string }> }
  | { kind: "already_on_project" }                    // idempotent success
  | { kind: "blocked"; reason: "other_project" | "no_access" }   // 409 / 403
  | { kind: "retryable"; reason: "rate_limited" | "unavailable" | "deployment_not_ready"; retryAfterSeconds?: number }
  | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
  | { kind: "rejected"; reason: "invalid_domain" | "unknown" };
```

Error mapping (the status classes come from Vercel's documented responses; exact `error.code` strings are pinned from recorded fixtures during the acceptance pass, and an unknown 4xx maps to `rejected: unknown` plus an operator alert, never to a guess):

| Response | Maps to | Effect |
|---|---|---|
| 200 | `ok` (carries `verified` and `verification[]`) | `verified:false` → store `provider_challenge`, show the extra TXT, call `verifyDomain` on later checks |
| 400, message "already exists on the project" | `already_on_project` | success: follow with `getDomain` to confirm |
| 400, "latest production deployment … not successful" | `retryable: deployment_not_ready` | stays `attach_pending`, backoff |
| 400, other | `rejected: invalid_domain` | row stays `attach_pending`, admin sees "We couldn't connect this name; contact support", operator alert |
| 401 | `config_error: token_invalid` | operator alert; every attach/detach retries on backoff |
| 402 | `config_error: payment_required` | operator alert |
| 403 | `blocked: no_access` ("You don't have access to the domain you are adding") | admin: "This name is attached to another Vercel account; contact support" |
| 404 | `config_error: project_missing` | operator alert |
| 409 | `blocked: other_project` | same message class as 403 |
| 429 | `retryable: rate_limited` (honours `retry-after`) | backoff |
| 5xx, network, abort | `retryable: unavailable` | backoff; admin sees "Connecting is temporarily unavailable; your DNS changes are safe to make" |
| `DELETE` 404 | `removeDomain` ok | idempotent |

`getConfig` is team-scoped and may be denied to a project-scoped token: a 401/403 there degrades to `getDomain` (`verified`, `verification`) plus our own DNS observations; correctness never depends on it. Recommended targets are read from `recommendedCNAME[rank=1].value` and `recommendedIPv4[rank=1].value[]`; when `getConfig` is unavailable the adapter uses the last cached targets in `observation`. `DOMAINS_PROVIDER` unset → `unconfigured` (every call returns `retryable: unavailable` and the UI says so); `vercel` is honoured only when `VERCEL_ENV` is unset or `production`; `fake` only outside production. `FakeHosting` simulates: absent, attached-unverified (with challenge), attached-verified-misconfigured/configured, plus injected `blocked`, `rate_limited`, `unavailable`, `token_invalid`, `deployment_not_ready`.

```ts
// adapters/mail-provider.ts — Resend SDK (existing dependency), Increment 2
interface MailDomainProvider {
  create(name: string): Promise<
    | { kind: "ok"; providerId: string; status: ProviderStatus; records: MailRecord[] }
    | { kind: "exists_elsewhere" } | { kind: "cap_reached" }
    | { kind: "retryable"; reason: "rate_limited" | "unavailable" } | { kind: "rejected"; reason: string }>;
  get(providerId: string): Promise<{ kind: "ok"; status: ProviderStatus; records: MailRecord[] } | { kind: "not_found" } | { kind: "retryable"; reason: string }>;
  verify(providerId: string): Promise<{ kind: "ok" } | { kind: "retryable"; reason: string }>;
  remove(providerId: string): Promise<{ kind: "ok" } | { kind: "not_found" } | { kind: "retryable"; reason: string }>;
  count(): Promise<number | null>;
}
type ProviderStatus = "not_started" | "pending" | "verified" | "failed" | "temporary_failure";
```

`create` always sends `{ name, region: "us-east-1", custom_return_path: "send", open_tracking: false, click_tracking: false, tls: "opportunistic", capabilities: { sending: "enabled", receiving: "disabled" } }` (tracking off: privacy, and tracking rewrites links that church-domain mail should keep plain). Mapping: `statusCode` 429 → rate_limited, ≥ 500 / network → unavailable; "already registered" → `exists_elsewhere`; "limit/upgrade/quota" → `cap_reached`; message classifiers are pinned from recorded fixtures in the acceptance pass, unknown 4xx → `rejected` plus operator alert. The adapter is constructed from the **org pool's** key (below), because a church domain must be created in the team whose key will send from it.

### 6. Service layer and actions

All state changes pass `transitionDomain(tx, row, event, actor, patch?)`: it validates the edge with `state.ts`, `update … where id = $ and state = $from` (optimistic; zero rows → `stale`), and inserts **exactly one** `audit_events` row **in the same transaction** with `tx.insert(auditEvents)` (not `recordAudit()`, which opens its own connection and swallows failures), `resourceType: "organization_domain"`, `resourceId: <domain id>`, `metadata: { organizationId, hostname, purpose, from, to, actorKind: "tenant" | "platform" | "machine", trigger, … }`. Machine transitions pass `actorUserId: null`.

```ts
type DomainActor =
  | { kind: "tenant"; userId: string; email: string | null; personId: string }
  | { kind: "platform"; userId: string; email: string | null }
  | { kind: "machine"; trigger: "cron" | "probe" | "webhook" };
/** Runs fn inside the right transaction: withOrgContext(person, org, fn) for tenants, getPlatformDb().transaction for platform/machine. */
type DomainExec = <T>(fn: (tx: DomainTx) => Promise<T>) => Promise<T>;
```

`observeAndAdvance(exec, actor, domainId, { forced })` is the **one** check routine used by the cron, "Check now" and the platform "Check now": (1) `exec` reads the row; (2) network I/O with **no transaction held** — DNS quorum, Vercel calls, the probe; (3) `exec` re-reads `for update`, confirms `state` is unchanged, applies `transitionDomain` per the evidence and writes the observation columns. Provider-first/database-second is realised as *intent-first*: `verified → attach_pending` is committed before `addDomain`, and `attach_pending`/`release_pending` rows are retried idempotently, so a crash between the call and the write leaves a retryable state, never a half-attached one.

Per-state behaviour of `observeAndAdvance`:

| State | What a check does |
|---|---|
| `pending` | Proof lookup. `present` → `proof_ok` (unique-index conflict → `last_check_class = held_elsewhere`, stay `pending`). `absent` → record only. Past `expires_at` → `expire`. |
| `verified` | web: `attach_start`, then immediately the attach call (`attach_ok` → `attached`, `blocked`/`rejected` → stay `attach_pending` with a class, `retryable` → backoff). mail: nothing. |
| `attach_pending` | Retry `addDomain`. |
| `attached` | Proof + routing + CAA/DNSSEC + `getDomain`/`getConfig` + HTTPS probe. All good → `live_ok`. TLS not ready but DNS correct → "Securing your site…", no counters. |
| `live` | Same checks. Definitive-negative probe → `probe_miss_count++`; threshold → `live_lost`. Definitive-absent proof → `proof_miss_count++`; threshold → `proof_lost`. `unknown` never counts. A positive observation resets both counters. NS fingerprint mismatch → notify, no transition. |
| `lapsed` | Proof `present` → `proof_ok`; `grace_ends_at` passed → `grace_elapsed`. |
| `parked` | `grace_ends_at` passed → `grace_elapsed`; weekly "records still point at us" email while DNS still routes to Vercel. |
| `release_pending` | `removeDomain` (404 = success) → `detach_ok` → `released`. |

**Tenant actions** (`src/app/(org)/o/[slug]/admin/domains/actions.ts`, `"use server"`; each begins with `resolveActingIdentity(slug)` — `auth()` then `resolveOrgContext()`, the `branding/actions.ts` shape — then inside `withOrgContext`: `presby_has_permission(person, org, 'domains.manage')`, `orgFeatureEnabledInTx(tx, org, 'org_portal.domains', false)`; `organizationId` never from the client). The file header states that audit is delegated to `transitionDomain` (R8) and QA verifies it through the per-transition DB test, not `check:audit`.

| Action | Input | Result |
|---|---|---|
| `claimDomainAction(slug, input: { domain: string; canonical: "www" \| "apex" })` | typed name | `ok` (rows + the TXT record to publish) · `invalid` (field message from the G2 rules) · `exists` (the org already holds the name; links to it, or to "Reconnect" if parked) · `cap_reached` · `rate_limited` · `forbidden` · `feature_off` |
| `checkDomainAction(slug, claimName)` | claim group | `observeAndAdvance` for the group; `rate_limited` · `ok { view }` |
| `changeCanonicalAction(slug, domainId)` | target host | only when the target is `live`; demote-then-promote in one transaction; `not_live` otherwise |
| `removeClaimAction(slug, claimName, promoteDomainId?)` | group | `remove` per row (pending/verified → `released`; attached-class → `parked`); refuses with `needs_canonical` if it would leave live aliases with no canonical and no `promoteDomainId` |
| `reconnectClaimAction(slug, claimName)` | parked group | confirms the proof is live, then `reconnect` |
| `setOfficeEmailAction(slug, email \| "")` (Batch 2a) | | validated by the same rule as the column CHECK. **Binding notification (T7, 2a):** on every change it audits `office_email.changed` **and** sends an `account`-class `domain_notification` to every `domains.manage` holder **and the previous office address** (when one was set and differs), because it sets the Reply-To on all church mail without any DNS proof. Notification and audit failures do not roll back the change, but a failed send is logged and counted. |

Claim details: `normalizeClaimInput` yields `claimName` and the hostname set (typed apex → apex + `www.` pair, the chosen `canonical` takes `web_role = canonical`; typed `www.`-prefixed or deeper → one row). A second claim group on a different name can only be an `alias`. Pairs already partly held by the org add only the missing row. New claims check `checkRateLimit` (5/24 h/org) before the insert; the cap trigger is the authority.

**Platform actions** (`src/app/(admin)/admin/organizations/[id]/domains-actions.ts` and `…/domains/actions.ts`; each re-checks `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)`; `getPlatformDb()`; precedent `designateFoundingAdministratorAction`):

- `claimDomainForOrgAction(organizationId, input)` — Q2; same `claimDomain`, `actor.kind = "platform"`, `created_via = 'platform'`; requires the org toggle to be on; **web only** (a `purpose: "mail"` request is refused).
- `checkDomainPlatformAction(domainId)`.
- `setDomainHoldAction(domainId, hold: "paused" | "disputed" | null, reason)`; audited `domain.hold_set` / `domain.hold_cleared`, notifies the org's holders.
- `forceReleaseDomainAction(domainId, reason)` — also serves eviction and dispute resolution (`release_cause` `force_released` or `evicted`); writes `force_release_reason` then fires `force_release`; notifies the evicted org's holders; reason required (≥ 10 chars).
- `setOrgDomainFeatureAction(organizationId, key: "org_portal.domains" | "org_portal.mail_domain", enabled)` — `toggles.ts`, owner connection, audited with the existing `ORG_FEATURE_TOGGLED` key and `metadata.via = "platform"`.
- No platform action enables a mail domain or sets `office_email`.

**Cron** `GET /api/cron/domains` (`src/app/api/cron/domains/route.ts`, `vercel.json` `*/5 * * * *`, `maxDuration = 60`): the house `CRON_SECRET` bearer shape (503 if unset, 401 on mismatch); `limit` query param (default 50, max 200). It picks due rows with `select … where next_check_at <= now() and state not in ('expired','released') order by next_check_at limit $n for update skip locked`, bumps `next_check_at` by 10 minutes (the lease), then processes with bounded concurrency 5, each row through `observeAndAdvance` as `{ kind:"machine", trigger:"cron" }`. Idempotent and reconciling (Vercel may miss or duplicate a run). Returns counts only; logs the host class once per invocation (T6) and never an error message or hostname. Increment 2 adds mail-domain polling and capacity monitoring to the same sweep (2c).

### 7. Mail (Increment 2)

**Registry** (`src/lib/email/senders.ts`; closed; unknown key → `account`):

| Class | templateKeys | From | Reply-To |
|---|---|---|---|
| `account` | `password_reset`, `email_change_verify`, `feedback_notification`, `ticket_*` (all six), `domain_notification` (new) | platform From (unchanged) | caller's, as today |
| `org` | `giving.statement.notice`; future invitations, event/roll notices | church domain once verified and healthy, else the fallback | office email, else platform support |
| `org_fallback_only` | `statistics_submission_grant` | always the fallback form | office email, else platform support |

A guard test greps every `templateKey:` literal and imported template-key constant under `src/` and fails if one is not in the registry (so "unknown → account" can never silently misclassify a new church mail). `enqueueEmail` requires `organizationId` for the two org classes and throws on a supplied `from`/`replyTo` for them; `statements.ts` and `statistics-grants.ts` pass it. **No inline attempt for org classes** (T5): the row is inserted with `next_attempt_at = now()` and the worker sends.

**Send-time resolution** (`resolveOrgSender(platformDb, { organizationId, templateKey })`, called only by `attemptSend` on the worker's platform connection):

1. class `org_fallback_only`, or no `organization_mail_domains` row, or its state ≠ `verified`, or the proof row not `verified`, or provider infrastructure unhealthy → **fallback**: `"<sanitised org name> via PresbyPortal" <ORG_MAIL_FALLBACK_FROM address>`, Reply-To = `office_email` or `PLATFORM_SUPPORT_EMAIL`, a footer naming the org and where replies go.
2. class `org` and `verified` and `reputation_hold_at is null` and `platform_hold is null` → **church**: `"<org name>" <notifications@<mail_domain>>` (fixed local part, Q11), pool `org`, `sender_mail_domain_id` set on the attempt.
3. reputation hold or platform hold → **hold**: requeue without incrementing `attempt_count`, set `hold_started_at` once; after 72 h in hold the row fails and is audited. Never rerouted to the platform sender (G21).
4. `ORG_MAIL_FALLBACK_FROM` unset in production, or equal in domain to the account From → **hold** with an operator alert (R11: the fallback From must differ). The operator sets it, and verifies the subdomain in the org pool's Resend team, before Batch 2a deploys (deployment.md; 2a gate).

`sanitizeDisplayName`: strips control characters and `" < > \`, collapses whitespace, caps at 60, falls back to "PresbyPortal"; the "via PresbyPortal" suffix is appended in code and is not an input.

**Pools** (Q13 either way): `type SendPool = "account" | "org"`; `poolConfig(pool)` → `{ apiKey, webhookSecret }`: `account` is `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET`; `org` is `RESEND_ORG_API_KEY ?? RESEND_API_KEY` and `RESEND_ORG_WEBHOOK_SECRET ?? RESEND_WEBHOOK_SECRET`. `sendEmail` gains `pool?: SendPool` (default `account`) and holds one client per distinct key. The Resend webhook verifies against each configured secret. The mail-domain provider uses the `org` key. With one team, pools share a key and the breaker is the only isolation (F149 residual, named); with a second team, setting the two env vars moves the whole `org` pool with no code change.

**Breaker** (webhook, platform connection; `policy.ts`): rolling 24 h per `sender_mail_domain_id` (and per `organization_id` for fallback sends), computed from `email_queue` by the new index, evaluated on each bounce/complaint event. Defaults: hold when sends ≥ 40 and bounce rate ≥ 2.5%, or sends ≥ 100 and (complaints ≥ 3 or complaint rate ≥ 0.05%) — conservatively under Resend's 4% / 0.08% account limits. Sets `reputation_hold_at`, audits `mail_domain.held`, notifies holders and platform admins. Resume is a platform action (`domain.hold_cleared` equivalent `mail_domain.resumed`). Per-recipient hard-bounce suppression is separate and out of scope (TODO).

### 8. Audit keys (added to `AUDIT_ACTIONS`; one explicit key per edge, mapped by `TRANSITION_AUDIT`)

`domain.claimed`, `domain.proof_verified`, `domain.attach_requested`, `domain.attached`, `domain.live`, `domain.live_lost`, `domain.lapsed`, `domain.recovered` (lapsed → verified), `domain.parked`, `domain.reconnected`, `domain.release_requested`, `domain.released`, `domain.expired`, `domain.canonical_changed`, `domain.hold_set`, `domain.hold_cleared`; Increment 2: `mail_domain.requested`, `.provisioned`, `.verified`, `.failed`, `.held`, `.resumed`, `.remove_requested`, `.removed`, `.capacity_warning`, `office_email.changed`. Convention note: one `domain.*` family with `metadata.actorKind`, instead of the `org.*` / `tenant.*` actor-axis split, because a single choke point serves all three actor kinds.

## Component / Page Plan

**Org admin: `/o/[slug]/admin/domains`** (Batch 1d; constrained width, `max-w-3xl`; the `(org)` layout supplies padding; inherits the brand cascade like its `branding` sibling). Server Component page: auth and membership in the page (`resolveOrgContext`), then toggle (`categoryAxisOn = false`, T10), then `domains.manage` → honest `DomainsForbidden` / `DomainsFeatureOff` / `DomainsUnavailable` (DB blip) states (the `branding-states.tsx` pattern). The pre-flight uses `presby_current_org_site_status()`.

| Component | Kind | Notes |
|---|---|---|
| `page.tsx`, `domains-states.tsx` | server | four states; skeleton `loading.tsx` is fine here (the segment renders, it does not redirect) |
| `domains-empty.tsx` | server | before any claim: explains the two paths ("bring a domain you already own" / "you can get one later; connect it then"), says "your site works at `<platform host>/site/<slug>` in the meantime", one primary **Start** button (G29) |
| `claim-form.tsx` | **client**, react-hook-form inside `<HydrationGate>` (DECISION-159) | field: domain; radio (www / no www) shown only for an apex entry; server errors mapped per field; `check:hydration-gate` covers it |
| `claim-card.tsx` | server | one card per claim group: header (Unicode display name, state chip, "View your site" link to `SiteUrls.canonical()` when live — suggestion 5), step list, records, actions |
| `step-list.tsx`, `status-chip.tsx` | server | steps: 1 Prove you own it · 2 Connect it · 3 Secure it (HTTPS) · 4 Live. Chips: Correct · Missing · Wrong value · Conflicting · Couldn't check — never colour alone |
| `record-row.tsx` | server | **stacked `<dl>` per record at 360px** (Type / Name / Value / Status), value `break-all` monospace, `min-h-11` Copy control; a table only from `md:` up |
| `copy-button.tsx`, `copy-all-button.tsx` | **client** | `navigator.clipboard` with a visible fallback (select-all text); "Copy all records as text"; a `mailto:` link prefilled for the DNS person (never server-sent mail to an arbitrary address) |
| `check-now-button.tsx` | **client**, `useTransition` | disabled while pending; shows "Last checked 3 minutes ago"; surfaces `rate_limited` as "Try again in N minutes" |
| `diagnosis-panel.tsx` | **client** | a button-controlled region (`aria-expanded`), **not `<details>`/`<summary>`** (the iOS bug in CLAUDE.md → Verify in a Browser). First-line causes: proxied (grey-cloud) record, leftover AAAA, CAA, wrong canonical host, "DNS changes can take up to an hour to be seen" |
| `canonical-dialog.tsx`, `remove-dialog.tsx` | **client**, `AlertDialog` | no native dialogs. Remove explains the 30-day parked period and the exit checklist |
| `offboarding-card.tsx` | server | parked/lapsed/release_pending: "Delete these records from your DNS", a **valid-HTTPS-first warning** (HSTS, G26), the weekly still-pointing-at-us status |
| `banners.tsx` | server | one banner per condition below |

Banners and microcopy (plain English; provider text is never shown, G30): *Unavailable provider* "Connecting is temporarily unavailable. Your DNS changes are safe to make; we'll finish connecting when it's back." · *Lookup failed* "We couldn't check right now. Try again in a few minutes." (never "missing") · *Held elsewhere* "This domain is already connected to another organization. Contact support." (no org named) · *Blocked at host* "This name is attached to another hosting account; contact support." · *Paused* "Your domain is paused by PresbyPortal support. Your site is still available at `<platform URL>`." · *Lapsed* "We can no longer find your verification record. Your site is serving from `<platform URL>` until it's restored." · *Pre-flight* "Your site isn't published yet. Point your domain here after it is." · *Securing* "Securing your site… this usually takes a few minutes." · *Keep the TXT* "Keep this record in place; it protects your domain from being claimed by someone else."

**Platform:** a **Domains section** on `/admin/organizations/[id]` (`domains-section.tsx`: the org's rows with exactly what the church sees plus last-checked, `last_check_class`, claim age; Check now, Pause/Resume, Force-release, Record a claim on this org's behalf; and a **Domain features card** with the two operator toggles), and a **cross-org list** at `/admin/organizations/domains` (host, org, state, hold, canonical, `last_check_class`, last verified, days since attached with no live, mail state in 2c; filter by state/attention). Client islands: `platform-domain-actions.tsx` (AlertDialogs with a required reason textarea) and `domain-toggles-card.tsx`. Platform palette, no brand.

**Files created (summary):** `src/lib/domains/**`, `src/lib/site-urls.ts`, `src/lib/email/senders.ts`, `src/lib/db/domain/domains.ts`, `src/lib/giving/donor-origin.ts`, `src/app/api/cron/domains/route.ts`, `src/app/(public)/site/[slug]/{robots.txt/route.ts,not-found.tsx}`, `src/app/(org)/o/[slug]/admin/domains/**`, `src/app/(admin)/admin/organizations/[id]/domains-*`, `src/app/(admin)/admin/organizations/domains/**`, `scripts/check-proxy-imports.mjs(+test)`, `scripts/domains/{test-rls-47.sql,test-rls-48.sql,seed-dev-domains.sql,reattach.ts}`, `e2e/custom-domains/**`, `e2e/hydration/domains-claim-form.spec.ts`, `e2e/support/domains-fixture.ts`, `drizzle/0057_*`, `drizzle/0058_*`, `docs/release-notes/v0.35.md` (and `v0.36`).

**Files modified (summary):** `src/proxy.ts`, `next.config.ts`, `src/lib/sites.ts`, `src/lib/org-features.ts`, `src/lib/org-portal/tiles.ts`, `src/lib/founding-administrator.ts`, `src/lib/audit.ts`, `src/lib/sites-reserved-paths.ts`, `src/lib/giving/{origin.ts,give-session.ts}`, `src/lib/email/{queue.ts,send.ts,index.ts}`, `src/lib/db/schema.ts` (`emailQueue`), `src/app/api/webhooks/resend/route.ts`, `src/app/(public)/site/[slug]/**` (the table in §4), the platform/shared `/site/${slug}` call sites in §4, `src/app/(admin)/admin/organizations/[id]/page.tsx`, `vercel.json`, `package.json` (`check:proxy-imports`, version), `playwright.config.ts` (project `custom-hosts`), `.gitignore` (`.tmp/`), `scripts/seed-dev.sql` / `scripts/test-rls.sql` / `src/lib/db/domain/index.ts` / `drizzle/meta/_journal.json` (one appended line each, at integration where Rule 16 requires).

## Implementation Order

Phase 4 starts by creating the Neon child branch from `development` (Phases 1–3 were read-only) and pointing the worktree's `.env.local` at it. Numbers are pre-assigned: migrations `0057`/`0058`, DECISION-176–182, F146–F152. The mandatory order inside every batch is schema → catalog/permission seed → services/actions → UI → audit → release notes, so each batch below lists only what lands in it.

| Batch | Implementer | Scope | Gate (in addition to typecheck, lint, `npm run build`, `npm run check` zero violations, unit + `test:db` green, no `console.log`, no native dialogs) |
|---|---|---|---|
| **1a-i** | **database-admin** | `0057` in full (table, triggers, grants, RLS, four functions, F152 re-grant, permission + backfill) **including the A1/A2 fold: `grace_ends_at` and the five trigger-stamped timestamps out of the grant, the trigger-owned 30-day grace, the `release_cause` evidence rules, the `release_pending`/`released` cause CHECK, the state-aware `next_check_at` cap**; Drizzle `domains.ts`; `test-rls-47.sql` (with (h)/(h2)–(h4) extended); `seed-dev-domains.sql`; owner-path DB tests including the grace/stamp/cause/cap cases and the `backdateDomainClock` helper; `service-only-writes.test.ts` (A4); per-transition audit tests are written in 1a-ii once `transitionDomain` exists | applied to the Neon branch; `scripts/test-rls.sql` (with `\ir` to 47) green **as `presby_app`**; `check:schema-parity`; `docs:erd`; live-catalog check that the recreated `presby_published_site` ACL is `neondb_owner` + `presby_app` with no `PUBLIC` entry and `search_path = public, pg_temp`; `has_column_privilege` false for `grace_ends_at` and the six trigger-stamped columns (test-rls-47 (h)); the policy-constant pin (`policy.ts` grace values = the trigger's 30 days; every cadence <= its `next_check_at` cap) is written in 1a-ii where `policy.ts` is created |
| **1a-ii** | **full-stack-developer** | `host.ts`, `hostname-rules.ts`, `state.ts`, `policy.ts`, `checklist.ts`, DNS adapter + observer + fake, `service.ts` (claim, cap/rate-limit mapping, proof check, expiry, canonical/remove/reconnect for non-attached rows), `toggles.ts`, catalog entries + `operatorEnabled`, tile, `founding-administrator.ts` bundle + test, audit keys, tenant actions (claim/check/remove) | hostname-rules table tests; state-table ↔ trigger agreement test; one DB test per implemented transition proving **exactly one** audit row; actions' auth/permission/toggle matrix; `operatorEnabled` hidden from the tenant list and refused by `toggleOrgFeature`; bundle pin updated |
| **1b** | **full-stack-developer** | Vercel adapter + fake; full `observeAndAdvance`; `/api/cron/domains` + `vercel.json`; `notify.ts`; platform service functions + platform actions (no UI); `scripts/domains/reattach.ts` + runbook paragraph | adapter tests against recorded-shape fixtures for every row of the error table; a cron walk on the dev server with `DOMAINS_PROVIDER=fake` (`pending → live → lapsed → parked → released`) via the fake state file; debounce tests (a single miss, an `unknown`, a flapping resolver never transition) |
| *(wait)* | — | **PR #31 merges; `git rebase main`** (R14). Files in conflict: `(public)/site/[slug]/{render-site-page.tsx,[[...path]]/page.tsx,give/page.tsx,give/actions.ts,give/return/page.tsx,public-giving-slot.tsx}`, `src/lib/giving/{give-session.ts,origin.ts}`, `src/lib/email/queue.ts`, `next.config.ts` (give CSP entries), `package.json` (`check`), `scripts/{test-rls.sql,seed-dev.sql}`, journal. Re-run `0057` against the rebased branch and the full RLS suite. | |
| **1c** | **full-stack-developer** | proxy first branch + probe responder (nonce-bound ack, T1) **+ the A6 cron pass-through (`cron-passthrough.ts`, `CRON_PATHS` pinned to `vercel.json`)**; `check:proxy-imports` (allow-list now `host.ts`, `probe.ts`, `cron-passthrough.ts`); `next.config.ts` (HSTS split, `/orgs`, give CSP, boot assertion); `resolveSite` + `SiteUrls` + the §4 table; redirects; `robots.txt`; `not-found.tsx`; `donorOrigin`; reserved paths; Playwright project `custom-hosts` and the e2e suite | **Auth-touching gate (R12): `src/proxy.ts` counts as auth-touching.** The running-server login e2e with an **MFA-enrolled seeded user** (`totp-full-login`, `post-login-routing`, `admin-login`, `totp-callback-bypass`) must pass; a preview/production **platform-host smoke** (`/`, `/signin`, `/api/auth/csrf` 200, `/home` 307→`/signin`, `/site/<slug>`); `npm run test:e2e:prod`; header tests on dev **and** prod build; **A6 tests green:** valid bearer reaches all three cron handlers on a custom host with no `Set-Cookie`; missing/wrong/empty/wrong-length bearer and unset `CRON_SECRET` are byte-identical to the custom-host 404; encoded and dot-segment variants do not match; `CRON_PATHS` equals `vercel.json`'s `crons[].path` set; the probe 204 carries no `Set-Cookie`. The **cron host observation moved out of this gate** to the acceptance pass (step 5), after the first attach, because a pre-attach run can only ever see the platform host; the one-line host-class log in each cron handler still ships here |
| **1d** | **ux-developer** | the org page and every component in the plan, the platform section/list, toggles UI | Browser pass at **360px** and desktop, every state in the banner list; `e2e/hydration/domains-claim-form.spec.ts` in **both** lanes; copy buttons on a real phone viewport; no `<details>`; Four-State and Empty-State checks per `ui-standards.md` |
| **Phase 5/6, then ship** | qa / analyst | QA runs everything; **manual real-domain acceptance pass** (script below) before the first customer's go-live; release `v0.35.0` | Increment 2 Phase 4 does not start until Increment 1 is merged and shipped |
| **2a** | **database-admin**, then **api-developer** | `0058` + `test-rls-48.sql` + `schema.ts` `emailQueue`; then registry, `senders.ts`, `enqueueEmail` contract, org-class enqueue-only (no inline attempt, T5), pools, `office_email` action **with its T7 notification to every holder and the previous office address**, `domain_notification`, the templateKey guard test, **and the A5 stalled-queue signal**: the `/api/cron/domains` sweep (5 min, a separate invocation from the email-queue cron) counts org-class rows (`template_key` in the registry's `org`/`org_fallback_only` classes) still `status = 'queued'` more than 15 minutes past `next_attempt_at` and, when the count is above zero, sends one `account`-class operator alert to the platform admins at most once per hour (`checkRateLimit`); the same count renders as a request-time banner on `/admin/email-queue`, which depends on no cron. The alert uses `account` mail because that class keeps its inline attempt and so does not depend on the stalled worker | `ORG_MAIL_FALLBACK_FROM` (a verified subdomain in the org pool's team) and `PLATFORM_SUPPORT_EMAIL` set in Production **before deploy**; fallback sender alone ships. **A5/T5 tests:** `enqueueEmail` returns `sentInline: false` for both org classes (pinned); a queued org-class row 14 min past `next_attempt_at` is not counted and 16 min is; account-class rows are never counted; the hourly alert limiter; the banner renders and hides. **T7 test:** `setOfficeEmailAction` enqueues notifications to each holder and the previous address and writes `office_email.changed` |
| **2b** | **api-developer** | Resend adapter + fake; mail rows (`purpose = 'mail'`); provision-after-proof; removal order (switch to fallback, then delete); cap handling and the 8-of-10 alert | removal-order test; `exists_elsewhere` / `cap_reached` honest states |
| **2c** | **api-developer** | webhook attribution (platform connection), breaker, hold/requeue, resume, notifications, the mail section in the existing page (small extension of 1d's components; split a 2d to **ux-developer** if it grows beyond a section) | Q13 decided and Q4 thresholds confirmed **before** real church mail; Resend test inboxes (`delivered`/`bounced`/`complained`) drive the breaker e2e |

**Blast radius: existing specs that assert behaviour this change alters** (retro 2026-07-11)

| Existing test | Why it breaks | Owner batch |
|---|---|---|
| `src/proxy.test.ts` | `request()` builds `https://presby.example.invalid`, which is not a platform host and now takes the rewrite branch. Set `NEXT_PUBLIC_PLATFORM_HOSTS` in the test setup (or change the helper's host); add the new branch's tests | 1c |
| `src/lib/sites.test.ts`, `sites-render-fail-closed.test.ts` | `getPublishedSite` body split into `hydratePublishedSite`; new `resolveSite` | 1c |
| `(public)/site/[slug]/` tests: `page`, `layout`, `sitemap.xml/route`, `assets/[key]/route`, `actions`, `contact-form`, `staff-directory`, `committee-directory`, `give/{page,actions,return/page,fall-through}` | resolver, key binding, removed `__slug` field, `urls` | 1c |
| `src/lib/giving/{give-session,csp,origin}.test.ts`, `providers/stripe/checkout.test.ts` | `checkoutReturnUrls` origin source; CSP entry list | 1c |
| `components/shared/{global-nav,avatar-menu}.test.tsx`, `(org)/o/[slug]/org-states.test.tsx`, `api/sites/ingest/route.test.ts`, `(admin)/admin/organizations/[id]/{actions,page}.test.ts*` | `slugSitePath`; reserved paths; new section | 1c / 1d |
| `src/lib/org-feature-catalog.test.ts`, `org-features.test.ts`, `org-portal/{tiles,visible-tiles}.test.ts`, `src/lib/founding-administrator.test.ts` | new catalog entries, `operatorEnabled`, tile registry set-equality pins, the pinned bundle | 1a-ii |
| `e2e/security-headers.spec.ts` | HSTS split (current assertion still holds), CSP path lists gain `/give` | 1c |
| `e2e/public-sites.spec.ts` | 404 body now from `not-found.tsx` (the byte-identical comparisons still compare like with like); sitemap origin unchanged in slug mode | 1c |
| `e2e/branded-signin.spec.ts`, `e2e/giving-public.spec.ts`, `e2e/hydration/giving-give-form.spec.ts` | link hrefs now come from `slugSitePath`/`urls`; form action binds the key | 1c |
| `e2e/admin-organizations*.spec.ts` | new Domains section on the org page | 1d |
| login/MFA suite | proxy first branch (must be green, not just unchanged) | 1c |

**Tests per batch (new):** unit — `host.ts` (every normalization/classification row, forwarded headers ignored, IP literal, trailing dot, port), `hostname-rules` (the A13 table), `state.ts`, `checklist`, `site-urls`, `probe`, `senders`; DB — triggers on the owner path, cap, cascade, one-audit-per-transition; RLS — sections 47/48; e2e (project `custom-hosts`, below).

**E2E approach.** A Playwright project `custom-hosts` (Desktop Chrome, `launchOptions.args: ["--host-resolver-rules=MAP *.invalid 127.0.0.1"]`) navigates `http://church-one.invalid:3000/…` against the normal dev server; `request`-fixture tests send an explicit `Host` header to `localhost:3000`. The first test is a **canary** proving the mapping works (so every later failure is real). Non-production treats loopback as a platform host and `*.invalid` as custom. `playwright.config.ts` sets `DOMAINS_ALLOW_RESERVED_TLDS=1`, `DOMAINS_PROVIDER=fake`, `DOMAINS_DNS_PROVIDER=fake` and `DOMAINS_FAKE_STATE_FILE` on the server it starts; like `RATE_LIMIT_DISABLED`, they do not reach a reused dev server, so `e2e/support/global-setup.ts` gains the same fail-with-instructions check. Fixtures are staged with raw SQL on `PLATFORM_DATABASE_URL`, as `public-sites.spec.ts` does, by **walking legal edges** (`e2e/support/domains-fixture.ts`); cleanup walks rows to `released`/`expired` (rows are never deleted) and the spec confirms by SELECT. UI flows that need DNS/Vercel answers write `DOMAINS_FAKE_STATE_FILE`. Specs: (1) canary + spoofed `X-Forwarded-Host`/`Forwarded`/`X-Original-Host` both directions; (2) serving matrix — every non-serving state, toggle off, site suspended, org inactive, flag off, unknown host → identical status/body/headers, live → renders, alias → 307 `no-store` preserving path and query, slug URL → 307 when live and self-serving when not, assets and `give/return` never redirected; (3) lockdown — `/api/auth/csrf`, `/api/cron/*` without the bearer, `/api/webhooks/*`, `/api/sites/ingest`, `/signin`, `/totp`, `/forgot-password`, `/reset-password`, `/file-statistics`, `/home`, `/o/x`, `/admin`, `/account`, `/orgs`, `/site/<other-slug>`, `/site/church-one.invalid` → 404, and **no `Set-Cookie`** on page/404/asset/sitemap/robots/redirect/server-action POST **and on the probe's 204 and the cron pass-through (A6)**; the cron paths additionally prove the byte-identical 404 for a missing, wrong, empty or wrong-length bearer; (4) robots/sitemap/canonical/OG all name the canonical host, no `noindex`; (5) contact form on a custom host (server action Origin check, honeypot, rate limit, wrong-org impossible); (6) give page/back-link/return hrefs and the **enforced CSP** on `/give`; (7) headers — HSTS with/without `includeSubDomains` by host; (8) the probe; (9) in 1d: the checklist at 360px (no horizontal scroll, copy works), empty state, every banner, hydration spec; (10) platform — toggles, on-behalf claim, pause → 404 → resume, force-release; (11) the tenant `/admin/features` page does not list the operator-only toggles.

## Rulings on the [D] gaps

| Gap | Ruling |
|---|---|
| G2 | `normalizeClaimInput` pipeline: trim; reject whitespace/control; lowercase; strip scheme; cut at first `/ ? #`; reject if `@` remains; strip `:port` and one trailing dot; `domainToASCII` (empty → invalid); ≤ 253 chars, labels 1–63, ≥ 2 labels; reject IP literals, wildcards, platform hosts and any subdomain of a platform apex, `*.vercel.app`, `localhost`, special-use TLDs (`invalid`, `test`, `example`, `localhost`, `local`, `internal`, `onion`, `arpa`…) unless `DOMAINS_ALLOW_RESERVED_TLDS=1`; mixed-script labels refused (every letter in one Unicode script; Common/Inherited/digits/hyphen ignored). Store punycode; show Unicode via `domainToUnicode`. DB CHECKs backstop the shape. No PSL (Phase 2): a suffix-only name cannot prove control and expires. |
| G3 | First to *verify* wins, by the holding-state unique index. Pre-proof responses are identical to a fresh claim (no cross-org read at claim time). Post-proof loser: `held_elsewhere`, "contact support," no org named. Dispute: platform admin sets `platform_hold = 'disputed'` on the incumbent and/or force-releases it (reason, audited, evicted org's holders notified); the winner's pending claim proceeds on the next sweep. Named residual: a lapsed incumbent holds the name through its 30-day grace; the force-release path is the remedy. Same cure for the A3 residual (a tenant-path write into a holding state denies the name to every other org). |
| G4 | One row per host; `claim_name` groups the apex/`www` pair and shares one proof; exactly one `canonical` per org; others `alias` (307); at most one mail row. Web host and mail domain may differ. |
| G8 | `robots.txt` route (host mode only); platform `robots.ts` untouched; alias never renders. |
| G9 | `unknown` never counts; `proof_lost` needs 6 consecutive definitive-absent observations spanning ≥ 10 h; `live_lost` needs 2 scheduled (1 forced) definitive-negative probes; admins are emailed on the first miss (once per episode), on `lapsed`, on `parked`, and on `released`. The takeover window for a lapsed domain is bounded by that debounce (≈ 12 h) plus the passive-DNS-replay residual, mitigated by the NS-change notification. |
| G10 | Removal and lapse both end in a 30-day attached-and-dark grace (neutral 404) with weekly "records still point at us" email and an offboarding card; then `release_pending` until the detach succeeds. Nothing removes the dangling-DNS risk after detach; it is named in the UI and in the release notes. |
| G11 | Per-record statuses and hints as in §5; "Copy all records," `mailto:`, Cloudflare/GoDaddy/registrar apex-flattening instructions; never an instruction to delete MX or SPF. |
| G12 | Targets read from Vercel's config response (cached in `observation`); idempotent `addDomain` plus `scripts/domains/reattach.ts --dry-run` and a runbook paragraph for a project move. |
| G13 | "Live" = proof valid + routing correct + the proxy probe acknowledged over HTTPS. Cloudflare orange cloud detected; Q7 default: require grey cloud (DNS only). |
| G16 | `email_queue` attribution columns and the rolling-window index (0058). |
| G18 | `office_email` column CHECK + action validation; display-name sanitiser; "via PresbyPortal" appended in code. |
| G19 | Provider states stored verbatim and mapped to per-record statuses; `exists_elsewhere`/`cap_reached` are honest rejected states; an existing strict DMARC policy is explained in the UI (DKIM is aligned). |
| G23 | Removal order is fixed in code: mark `remove_pending` → resolution already falls back (a non-`verified` state means fallback) → delete the Resend domain → `removed`. Domain change = remove + new request; the old Resend domain is deleted immediately after the switch. |
| G26 | HSTS split (F147); the exit checklist leads with "make sure your new site has valid HTTPS first"; Server Action Origin check verified in e2e and the acceptance pass; CSP unchanged for custom hosts apart from the give entry. |
| G27 | `transitionDomain` is the single choke point; one explicit audit key per edge; machine rows have a null actor and `metadata.trigger`; coverage proven by DB tests, with headers on the cron route and `actions.ts` files saying so. |
| G28 | No separate re-authentication (T7); the `/o/*` 2FA gate applies; every claim, canonical change, removal and force-release emails all holders and the platform admin. TODO S3. |
| G29, G30 | Empty state and the banner list above. |
| G31 | The platform list shows what the church sees plus `last_check_class`, last-checked time and age-in-state; the "Why isn't it working?" panel covers the four common causes. |
| G32 | No congregation-specific copy or logic; names come from `organizations.name`; presbyteries and synods get the same page. |

## Edge Cases & Risks

**Adversarial table as design rules**

| # | Rule | Where it is enforced / proven |
|---|---|---|
| A1 | Every non-serving state is one code path, one read count, one 404. Shape-invalid hosts 404 in the proxy with no DB read (not tenant-shaped). The Vercel-layer "attached vs not" difference is accepted (proof-before-attach keeps unproven names unattached). | `presby_published_site_by_host` zero-row test per state; e2e serving matrix compares bodies and headers |
| A2 | Only `Host` is read. A platform-host request with a custom `Host`-like value in any forwarded header changes nothing; a custom-host request with spoofed forwarded headers never switches org. | `requestHost` unit table; e2e both directions |
| A3 | `/site/<other-slug>` and `/site/<host>` cannot reach a tenant on a custom or platform host. | proxy platform-host guard (incl. `%2e`); resolver requires `Host === key` (host mode) and a platform host (slug mode); e2e |
| A4, A5 | Proof before any provider call; caps; 7-day expiry; claim and check rate limits. | trigger + `checkRateLimit`; fake provider asserts zero calls before `proof_ok` |
| A6 | Persistent TXT + debounce + parked grace + NS tripwire. | state tests; cron walk; notification test |
| A7 | Redirect targets come only from the verified row; `portal()` is a fixed absolute platform URL; `sanitizeCallbackUrl` is untouched and platform-only. | `site-urls` tests; source scan |
| A8, A9 | Custom hosts have no `/api`, auth pages, `/o`, `/admin`, `/launch`, `/home`; no `Set-Cookie`. | lockdown e2e; header assertions per response class |
| A10 | Contact/give actions take a server-bound key, re-resolve it, require `Host === key` in host mode, then use the DB-returned slug; the old client `__slug` field is deleted. | action tests (tampered key → generic failure) |
| A11 | `donorOrigin(slug)` reads the DB; spoofed `Host`/`X-Forwarded-Host` cannot change `success_url`/`cancel_url`. | give-session test with spoofed headers |
| A12 | The conflict surfaces only after proof and names no org; pre-proof is identical to a fresh claim. | RLS (d); action test |
| A13 | The input table (empty, 10,000 chars, trailing dot, uppercase, mixed-script, `a..b`, trailing space, port, scheme) is a unit table; `office_email` and display name get the same treatment. | `hostname-rules` tests; CHECK table in RLS 47/48 |
| A14 | Everything goes through `withOrgContext` + `domains.manage`; `audit_events` is `select, insert` for `presby_app`; the platform act is audited. | action matrix; RLS grants |
| A15 | Transitions are server-side against stored state; the edge trigger refuses illegal jumps including from the owner; the UI never decides. | RLS (i); DB tests |
| A16 | Different registrable domains plus no cookies on custom hosts. | e2e |
| A17 | Display-name sanitiser, address CHECK, fixed suffix. | unit + RLS 48 |
| A18 | Svix verification stays the only webhook authenticator and the route 404s on custom hosts. | existing webhook tests + lockdown e2e |

**Risks and edge rules**

- **Cron host (T6, A6)** — high; **built in Batch 1c, not contingent** (architect ruling): exact-path, bearer-keyed, constant-time pass-through in the proxy's custom-host branch (API Contract §2). Residual: it protects the crons only if the bearer reaches the proxy intact; the post-attach acceptance observation (step 5) records the real host class for at least two scheduled runs of each cron. Cost of getting it wrong in the other direction is bounded: the exemption answers only to the secret, on three exact paths.
- **Post-flip 404 gap (T1)** up to 5 min; "Check now" and the runbook (lower TTL a day early, rehearse on the throwaway domain).
- **Negative DNS caching** delays *seeing* a newly added TXT by the zone's negative TTL; the UI says "DNS changes can take up to an hour to be seen."
- **Org inactive / site suspended / org closed.** Serving stops through the predicate in every case. An organization whose `lifecycle_status` is no longer `active` (A2: the trigger's `org_closed` evidence) found by the sweep gets `remove` as the machine actor with cause `org_closed`: attached rows go `parked`, then released after grace. An organization that is only `status`-inactive, or whose site is suspended, is darkened by the predicate but **not** auto-removed (a suspension is reversible; the platform can force-release if it is not).
- **Canonical safety.** A swap needs a `live` target; removing the canonical group while live aliases remain requires naming a new canonical; the predicate returns null if no canonical is live, which darkens aliases rather than redirecting them nowhere.
- **Cross-purpose holding (T3).** Holding uniqueness is per purpose, so two orgs can hold the same hostname once for `web` and once for `mail` (it requires the DNS owner to have published both tokens). Accepted; if ever unwanted, a `btree_gist` exclusion constraint on (hostname `=`, organization_id `<>`) closes it. Not required now.
- **Retries after removal (mail).** Resolution is per attempt, so a removed or lapsed mail domain degrades to the fallback; a reputation hold waits (bounded 72 h) and never reroutes.
- **State columns writable by `presby_app` (T4; corrected per A3).** Named residual: an app bug on the tenant path can move its **own** org's rows along legal edges, and cannot skip an edge, change identity columns or tokens, touch holds, write the grace deadline or any trigger-stamped timestamp (A1), or record a `release_cause` the evidence does not support (A2). **It is not true that it cannot affect another org:** `organization_domains_hostname_holding_uq` is a cross-org fact, so a tenant-path write that moves a row into a holding state without real proof blocks every other org from that name (per purpose). The cures are the platform's `disputed` hold and `force_release` (G3), both owner-only. The write surface is further narrowed by A4: only `src/lib/domains/service.ts` may write the table, enforced by a source-scan test.
- **`email_queue` readable across orgs on a tenant-connection bug (F152).** Accepted on F152's two conditions; both pinned by tests.
- **Single Resend team (F149)** until Q13: the breaker is the only isolation. Documented, decided before Increment 2 sends real church mail.
- **Probe fetch** is an outbound request to a church-controlled name: it follows no redirects, returns no body, pre-checks that DoH answers are public addresses, and exposes only a boolean.
- **Dev/test fakes** are unreachable in production by the boot assertion and by `NODE_ENV` checks in the adapter factory.
- **Vercel domain limits / plan.** Not a design constraint at this scale; revisit if > 50 attached hosts.

## Out of Scope (confirm with user)

Registering or buying domains · Cloudflare-API auto-DNS · sign-in, sessions or the portal on a custom host (no SSO) · branding `/signin` beyond DECISION-094 · redirecting a closed or merged congregation's domain to its successor · wildcard or unlimited aliases · **legacy-URL redirect maps for the first customer's cutover (Q8: a separate pipeline; recorded in TODO as a cutover dependency)** · per-site favicons and icons on custom hosts (F151 residual; TODO) · per-recipient hard-bounce suppression (TODO) · extending `permissions.requires_two_factor` to `domains.manage` (TODO S3) · dedicated IPs, custom certificates, DMARC authoring, inbound mail, church-chosen sender local-parts · moving account mail to church domains · enforcing (rather than notifying on) an NS-change · automatic takeover of a lapsed incumbent's name.

## Manual real-domain acceptance pass (before the first customer's go-live; Increment 2 steps before any real church mail)

*Run by the operator against an operator-owned throwaway domain whose DNS the operator controls (Q9). The name lives only in the operator's private notes and is never committed. Production, `DOMAINS_PROVIDER=vercel`, the project-scoped token, and `NEXT_PUBLIC_PLATFORM_HOSTS` set. Record the evidence in the work-log as "passed/failed" lines with no domain name.*

1. **Pre-flight.** Platform-host smoke passes. Confirm the Vercel token is project-scoped and that `getConfig` works with it (or note the degraded path). *(The cron host observation (T6) moved to step 5: before a custom domain is attached it can only ever see the platform host.)*
2. **Toggle and claim.** As platform admin enable `org_portal.domains` for a test org with a live fixture site; claim the apex as a tenant `domains.manage` holder (founding-administrator designation exercised in the same pass).
3. **Proof first.** Confirm Vercel shows **no** attachment and Resend none until the TXT is published; publish it; "Check now" → `verified` → `attached`; capture Vercel's `verification[]` behaviour if any.
4. **Routing.** Apex via A/ALIAS and `www` via CNAME; confirm the targets shown equal Vercel's recommendation; deliberately add a leftover AAAA, a restrictive CAA, then a Cloudflare **proxied** record; confirm each is diagnosed with the right hint; fix each.
5. **Go live.** *Cron host observation (T6/A6), after the first attach:* with the throwaway domain attached (ideally a host name shorter than the platform host, so any "shortest host" rule would pick it), record the host class each cron handler logs for **at least two scheduled runs of each** (`email-queue`, `maintenance`, `domains`; `maintenance` is daily, so it spans two days and may close after go-live of the pass), and confirm the email queue still drained and the sweep still ran. Whatever the class, the A6 pass-through must have kept the crons working; record any run that arrived on a custom host. Then: time DNS flip → certificate → `live`; confirm the probe, the site, canonical/OG/sitemap/robots, the alias 307 (path + query, `no-store`), and the slug URL 307; confirm **no `Set-Cookie`** and `/signin`, `/api/auth/csrf`, `/admin` all 404 on the host; check HSTS has no `includeSubDomains` on the church host and has it on the platform host.
6. **Forms.** Submit the contact form from the custom host (Server Action Origin/Host check). If giving is live in Stripe test mode: start a gift from the custom host and confirm the donor lands back on the custom host and the treasurer onboarding return stays on the platform.
7. **Drift.** Remove the TXT; confirm the warning email at first miss; leave it overnight; confirm `lapsed`, the neutral 404, the slug URL self-serving, and the email. Restore the TXT; confirm recovery.
8. **Exit.** Remove the domain as the church; confirm `parked`, the offboarding card and the HSTS warning; platform force-release with a reason; confirm `release_pending → released` and that Vercel no longer lists the host. Confirm all emails arrive from the platform sender.
9. **Dispute.** Claim the same name from a second org; confirm it proves, then sees the generic "already connected" message; resolve with a force-release.
10. **Mail (Increment 2).** With a verified fallback subdomain: confirm fallback sends ("<Church> via PresbyPortal", Reply-To the office address). Enable mail; confirm no Resend domain until the proof; publish the DKIM/SPF/MX records; confirm they do not touch the root MX/SPF; verify; send a statement-style notice and confirm it comes from `notifications@` on the church domain. Using Resend's test inboxes, drive `bounced` and `complained` past the thresholds and confirm the hold, the notification, that nothing reroutes to the platform sender, that account mail is unaffected, and that a platform-admin resume works. Remove the mail domain and confirm the order (fallback first, then Resend deletion).
11. **Cleanup.** Remove records and the Vercel/Resend objects; confirm no residue.

## Integration drafts (for the orchestrator; Rule 16 files are edited only at integration)

### `docs/decisions.md` — DECISION-176 to DECISION-182 (refining the architect's drafts; newest first when inserted)

**DECISION-182 — Outbound mail goes through a closed sender registry: `account` | `org` | `org_fallback_only` (credential-bearing org mail); an unknown template key is `account`, and a guard test fails any `templateKey` not in the registry.** For the org classes the sender is resolved at each send attempt, by the queue worker on the platform connection, never at enqueue and never by a `presby_app`-callable function; **org-class mail has no inline attempt: sender resolution happens only in the worker, on the platform connection** (the earlier inline-attempt sentence is struck). Because org-class mail, including credential-bearing statistics grants, now depends entirely on the email-queue cron, a stalled-queue signal ships with it (A5): org-class rows still `queued` more than 15 minutes past `next_attempt_at` raise an hourly `account`-class operator alert from the domains sweep and a request-time banner on `/admin/email-queue`, and a test pins `sentInline: false` for both org classes. `setOfficeEmailAction` notifies every holder and the previous office address (T7). `email_queue` (still a platform outbox with no RLS) gains `organization_id`, `sender_mail_domain_id` and `hold_started_at`, with a composite `MATCH SIMPLE` FK. A reputation hold requeues without consuming an attempt for at most 72 hours and is never rerouted to the platform sender. The resolver is keyed by sending pool (`account` | `org`), so a second Resend team is configuration. The fallback From (`ORG_MAIL_FALLBACK_FROM`) must differ in domain from the account From, else org mail is held with an operator alert. The display-name suffix "via PresbyPortal" is appended in code; `office_email` is set only by a `domains.manage` holder. Tradeoff named: org mail waits up to one five-minute tick; revisit if invitations need to be instant. (Phase 3, `2026-10-19-custom-domains`.)

**DECISION-181 — Every same-host URL on the public surface comes from `SiteUrls`, built only by `resolveSite()` from the database row (or `slugSitePath()` for platform-host contexts); a source-scan test bans hand-built `` `/site/${…}` `` outside `site-urls.ts` and `host.ts`.** The slug may appear on a custom host only as the absolute platform portal link and as opaque, server-bound action arguments. Actions take a server-bound site key (the client `__slug` field is deleted), re-resolve it, and use the slug the database returned. The donor return origin is `donorOrigin(slug)` (the live canonical host from the database, else `givingOrigin()`), computed from the DB-returned slug and never from the request; treasurer and statement links stay on the platform origin. `givingOrigin()` becomes a re-export of `platformOrigin()`. (Phase 3.)

**DECISION-180 — `organization_domains` holds one row per DNS host, with a `purpose` (`web` | `mail`).** A proof at the typed name N covers N and `www.N`; the token is shared by the group. States: `pending → verified → attach_pending → attached → live`, with `lapsed`, `parked`, `release_pending`, `released`, `expired`; 25 legal edges enforced by a `BEFORE UPDATE` trigger that binds the owner connection. **The grace deadline belongs to the trigger, not the tenant (A1):** `grace_ends_at` is not in `presby_app`'s grant, is stamped `now() + 30 days` by the trigger on entering `lapsed` or `parked`, and is refused on any other change on either connection; `state_changed_at`, `proof_verified_at`, `attached_at`, `live_at` and `released_at` are trigger-stamped and likewise ungranted; the 30-day constant lives in the trigger and a test pins `policy.ts` to it. **`release_cause` is tied to evidence the tenant cannot write (A2):** `force_released`/`evicted` require the owner-only `force_release_reason`, `lapsed_grace` requires an elapsed `grace_ends_at`, `org_closed` requires the organization's `lifecycle_status` to be non-active, and `next_check_at` writes are capped by the trigger (6 h; 24 h for `parked`). Only `src/lib/domains/service.ts` writes the table, source-scan pinned (A4). **`live` is the only serving state.** Pause, dispute and the grace bypass are owner-only columns (`platform_hold`, `hold_reason`, `force_release_reason`), not states. A cross-org partial unique index on held hostnames means first to *verify* wins; caps (3 web, 1 mail) are trigger-enforced under an advisory lock; unproven claims expire in 7 days; no provider call precedes proof. `presby_app` holds column-limited `SELECT/INSERT/UPDATE`, no `DELETE`; state and observation columns are writable inside the tenant's own transaction (so "Check now" never needs the platform connection from an `(org)` route), and identity, token, hold and timestamp columns are not. **Named residuals:** (i) an app bug on the tenant path can move its own org's rows along legal edges, and because the holding-state unique index is global, entering a holding state without real proof denies that name to every other org (it does *not* "stay in its own org"); the cure is the platform's `disputed` hold plus `force_release`; (ii) holding uniqueness is per purpose, so two orgs can hold the same hostname once for web and once for mail when the DNS owner has published both tokens (T3); accepted, and a `btree_gist` exclusion on (hostname `=`, organization_id `<>`) closes it if ever unwanted. Lapse and removal both end in a 30-day attached-and-dark grace, then `release_pending` until the detach succeeds. `domains.manage` is tier 1, has no constitutional binding (DECISION-078/101 test), is added to DECISION-155's enumerated administration half with a backfill, and does not set `requires_two_factor` (S3). Operator-only org toggles (`org_portal.domains`, `org_portal.mail_domain`, `operatorEnabled`) are flipped by a platform admin; a platform admin may record a *web* claim on an org's behalf (DNS proof still required) and may pause, resume or force-release, never enable church mail or set the office email. (Phase 3; amends DECISION-155.)

**DECISION-179 — New top-level module `src/lib/domains/`:** a pure `host.ts` and a node-crypto-only `probe.ts` (the only files `src/proxy.ts` may import from it), hostname rules, a pure state table, a server-only service whose single `transitionDomain()` choke point writes the state change and exactly one `audit_events` row in the same transaction (Workflow Rule 7 for non-`actions.ts` paths, proven by a DB test per transition), Vercel / DNS / mail adapters behind interfaces with fakes, plus `src/app/api/cron/domains/` (every 5 minutes, due-row driven, lease-based) and pure `src/lib/site-urls.ts`. No new dependency: Vercel REST over `fetch` (`@vercel/sdk` rejected), DNS-over-HTTPS over `fetch` with a two-resolver quorum for lapse and an SOA apex check (`dns/promises`, PSL packages rejected), Resend through the existing SDK. Providers are selected by explicit Production-only configuration (`DOMAINS_PROVIDER`, `MAIL_DOMAINS_PROVIDER`), default `unconfigured`; the Vercel token is project-scoped; a test-only fake driven by a state file is unreachable in production. (Phase 3.)

**DECISION-178 — Supersedes DECISION-041's canonicalisation (its routing contract stands).** One owner-only SQL predicate (`presby_org_serving_canonical_host`) answers "which host serves this org?" for both directions: the canonical host row is `live` with no platform hold, the org is active, the site is live, and the `org_portal.domains` toggle is on; the app adds `sites.public_render`; the category axis is excluded. Every host-level redirect is a **307 with `no-store`**, issued in the app, never a 301/308 and never at Vercel. The slug URL 307s to the serving host (HTML pages and the sitemap only; assets, `give/return` and action POSTs never), and otherwise serves itself as its own canonical, indexable. "Live" is proven by an HMAC probe the proxy answers (proof valid, routing correct, HTTPS ack). The `<slug>.presby.app` premise and the "never canonical, always noindex" text are retired. HSTS `includeSubDomains` is limited to platform hosts (F147). (Phase 3.)

**DECISION-177 — `src/proxy.ts` runs on Node.js (Next 16; F146). "The proxy does not reach the database" is kept as a design rule, not a runtime fact,** because it runs on every matched request, a tenant decision there would be a second enumeration-sensitive path, and it keeps the proxy a pure function of host, path and session claims. Enforced by `check:proxy-imports`. `src/proxy.ts` is treated as auth-touching for Phase 4's login-e2e gate. (Phase 3.)

**DECISION-176 — A request on any host outside the platform-host set is rewritten by `src/proxy.ts`, as its first branch, to `/site/<host><path>` inside the existing `(public)/site/[slug]` tree, with one exact-path exception for the crons (A6).** Before the rewrite, the custom-host branch passes a request through only if `CRON_SECRET` is set and non-empty, the pathname exactly equals one of the `vercel.json` cron paths (an allow-list pinned to `vercel.json` by a test), and `Authorization` equals `Bearer ${CRON_SECRET}` under a constant-time compare; no database, not keyed on the user agent. Everything else falls through to the same 404 as any other `/api/*` path, byte-identical. It amends R4 and exists because Vercel's docs do not rule out a cron arriving on a custom host (the F148 ambiguity) and a silent cron 404 would stop all church mail. The segment is a *site key*: a slug (no dot) or a verified host (with a dot). Host mode requires the request `Host` to equal the key, that the key not be a platform host, and one `SECURITY DEFINER` read that collapses every non-serving state to zero rows. A host is a lookup key, never an identity, an origin or a redirect target. Custom hosts have no session, no cookies and no platform routes. The brandable surface is unchanged (`check:brand-scope` untouched). Rejected: a database lookup in the proxy, a parallel host route tree (a third emitter), host-branching root pages, Vercel-level redirects. Justified against DECISION-040: one code path and one read count for every non-serving state. (Phase 3.)

### `docs/schema-design-2.md` — F146 to F152 (refined)

- **F146 — the proxy is not an Edge function** (unchanged from Phase 2): Next 16 runs `src/proxy.ts` on Node.js; the "importing `@/lib/db` breaks the build" premise is false, so the invariant is unenforced until `check:proxy-imports` lands.
- **F147 — HSTS would pin a church's whole domain** (unchanged): `includeSubDomains` on every response; fixed by the host split.
- **F148 — Vercel's production-URL variable can name a church domain** (unchanged); forbidden as a host-set or origin source, source-scan pinned. *Related, handled by construction rather than by finding out:* whether the same ambiguity affects the host Vercel uses to invoke crons is unknown, so A6's exact-path, bearer-keyed pass-through is built in Batch 1c and the real host class is recorded in the acceptance pass.
- **F149 — one church can pause everyone's sign-in mail** (unchanged): Resend's limits are account-level; sending pools and the breaker are the mitigation, a second team the remedy (Q13).
- **F150 — the new permission is unreachable under F111:** no organization holds `domains.manage`, so `assertPermissionSubset()` makes it ungrantable unless the founding-administrator bundle delivers it; the backfill measured 0 rows in production (2026-10-19) and the on-behalf path covers a slipped designation. *Neighbouring residual (T4/A3):* `organization_domains` state columns are writable by `presby_app` in the tenant's own transaction, so an app bug on the tenant path can move its own org's rows along legal edges, and, because `organization_domains_hostname_holding_uq` is global, entering a holding state without real proof denies that name to other orgs (the earlier wording, "it cannot reach another org," was wrong). Bounded by the edge trigger, the A1 ungranted timestamps and grace, the A2 `release_cause` evidence rules, and A4 (service-only writes); cured by the platform's `disputed` hold plus `force_release`.
- **F151 — some responses bypass the proxy's host branch:** `redirects()` (`/orgs`), `headers()`, and the matcher's static exclusions. Resolved by scoping `/orgs` to platform hosts and enumerating the static paths that answer on a custom host in a test; **plus** (Phase 3) the enforced give CSP is matched on the *incoming* path, so a custom host's clean `/give` needed its own entry; and per-site favicons are an accepted residual.
- **F152 — widening the published-site function resets its grants:** `DROP`/`CREATE` of `presby_published_site(text)` resets the ACL **and the `search_path` pin from `0048`**; both are re-applied and asserted. Separately, `email_queue` has no RLS and `presby_app` holds full DML, so org-attributed mail is readable across orgs on a tenant-connection bug; accepted on two conditions (tenant reads reach it only by joining from their own RLS-filtered rows; `test-rls` asserts both ACLs).

### `CLAUDE.md` (apply at integration)

1. **Key Invariants.** Replace "The Edge Gate Cannot Reach the Database" with: *"The Proxy Does Not Reach the Database. `src/proxy.ts` runs on **Node.js** (Next 16; F146), so the old runtime reason no longer holds, but the rule stands (DECISION-177): it runs on every matched request, a tenant decision there would be a second enumeration-sensitive path, and it must stay a pure function of host, path and session claims. It imports `edgeAuth`, the permission constants, `src/lib/domains/host.ts` and `probe.ts`, nothing else; `npm run check:proxy-imports` enforces it."*
2. **New invariant, "A Custom Host Is a Key, Not an Identity"** (DECISIONS 176/178/181): the platform-host set and its build assertion; host classification is the proxy's first branch; a non-platform host rewrites to `/site/<host>`; host mode requires `Host === key` and one definer read that collapses every non-serving state; `live` is the only serving state; no session, no cookies, no platform routes on a custom host; absolute URLs come only from the database row or the validated platform origin; redirects are 307 with `no-store`; `VERCEL_PROJECT_PRODUCTION_URL` is never read.
3. **The Brand Is a Cascade Override** — add: "Custom hosts render through `(public)/site/[slug]`; there is no third group and `check:brand-scope` is unchanged."
4. **New invariant, "Account Mail Stays on the Platform Domain"** (DECISION-182): the three registry classes; org mail never reroutes on a reputation hold.
5. **Project Layout** — add `src/lib/domains/`, `src/lib/site-urls.ts`, `src/lib/email/senders.ts`, `src/app/api/cron/domains/`, `scripts/domains/`.
6. **Phase 4 gate** — add `src/proxy.ts` to the auth-touching list.
7. **Common Commands** — add `npm run check:proxy-imports`; update the tripwire count (it is "six" in the text today; seven with `check:giving-boundaries` after PR #31; eight with this).
8. **Post-Login Landing / (org) contract** — one sentence: "`/launch`, `/home` and every platform route exist only on platform hosts."

### `docs/architecture.md` (Phase 6, Rule 15 — a new subsystem)

§8: a paragraph on custom domains (proof, then attach, then serve; one predicate both ways; the host is a key; mail sender pools). §10: correct "the Edge gate" to "the proxy (Node.js)".

### `.claude/agents/architect.md` route-group rules

Add: "`(public)/site/[slug]` — the segment is a *site key*: a slug on platform hosts, or a verified host reached only by the proxy's custom-host rewrite."

### `docs/deployment.md`

- Dated sentence in "Vercel — the account problem": *"**Update 2026-10-19:** operator access to the `community-collective` team was restored, the legacy `presby-portal` project was deleted, and `presby` is connected to GitHub and serves `www.presbyportal.org`. The table above is historical."*
- Environment variables (**Production scope only**; Preview and Development must never receive the provider variables):

| Variable | Purpose | Needed by |
|---|---|---|
| `NEXT_PUBLIC_PLATFORM_HOSTS` | `presbyportal.org,www.presbyportal.org`. **Build-time** (`NEXT_PUBLIC_`): set before the production build; a change needs a redeploy. | 1c |
| `VERCEL_API_TOKEN` | a token **scoped to the `presby` project** | 1b/1c |
| `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | the project and team ids | 1b/1c |
| `DOMAINS_PROVIDER` | `vercel` (unset = `unconfigured`) | 1b/1c |
| `MAIL_DOMAINS_PROVIDER` | `resend` (unset = `unconfigured`) | 2b |
| `ORG_MAIL_FALLBACK_FROM` | e.g. a `notifications.` subdomain From, verified in the org pool's Resend team; **must differ from `RESEND_FROM_EMAIL`'s domain** | 2a gate |
| `PLATFORM_SUPPORT_EMAIL` | Reply-To when an org has no office email | 2a gate |
| `RESEND_ORG_API_KEY`, `RESEND_ORG_WEBHOOK_SECRET` | optional; only if Q13 = a second team | 2c |
| `MAIL_DOMAINS_CAP` | optional, default 10 (the 80% alert uses it) | 2b |
| *test/dev only, never in Vercel Production (build-asserted):* `DOMAINS_PROVIDER=fake`, `DOMAINS_DNS_PROVIDER=fake`, `DOMAINS_FAKE_STATE_FILE`, `DOMAINS_ALLOW_RESERVED_TLDS=1` | e2e and local development | 1a+ |

No new secret for the probe (derived from `AUTH_SECRET`). `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `RESEND_API_KEY` are existing.
- A bulk re-attach runbook paragraph (project move) pointing at `scripts/domains/reattach.ts`.

### `docs/TODO.md` (Rule 10, at integration)

Rewrite the Track F line to remove the real domain and point at this work-log (the architect flagged `TODO.md:39`); add: legacy-URL redirects for the first customer's cutover (Q8, a cutover dependency); per-site favicon on custom hosts; per-recipient hard-bounce suppression; S3 `domains.manage` → `requires_two_factor`; Q13 second Resend team; the NS-change tripwire is notify-only; vercel domain re-attach runbook; `docs/product/functionality-map.md` entry (a new "Connect your domain" line under the public-site area plus the Index) at ship.

### Release notes

`docs/release-notes/v0.35.md` (Increment 1: church-domain websites) and `v0.36.md` (church-domain email), via `/release-notes`. Written for a non-engineer, and must not deny the named residuals (dangling DNS after detach; org mail waits up to five minutes; a single Resend team until Q13).

## Open items going back

**To the architect:** none outstanding. T4, T5 and T6 were ruled and T1–T3, T7 confirmed in the Phase 2 addendum (2026-10-19); A1–A6 and the suggestion decisions are folded (see the fold note at the top of Phase 3). Nothing here needs another Phase 2 pass.

**To the operator (nothing blocks Phase 4; needed later):**
- Before **1c deploys:** create the `presby`-project-scoped Vercel token; set `NEXT_PUBLIC_PLATFORM_HOSTS`, `VERCEL_*`, `DOMAINS_PROVIDER` in Production.
- Before the **acceptance pass:** the throwaway domain (Q9) and who controls its DNS.
- Before **2a deploys:** create/verify the fallback sending subdomain and `PLATFORM_SUPPORT_EMAIL`.
- Before **2c sends real church mail:** decide Q13 (second Resend team) and confirm the breaker thresholds (Q4).
- Note: the pre-live default of "everything off per org" means the first customer's onboarding order is: designate the founding administrator → platform admin enables `org_portal.domains` → claim.

## Implementer

**Batch 1a-i: database-admin** (`0057` with the A1/A2 fold, the Drizzle schema file, `test-rls-47.sql`, `seed-dev-domains.sql`, owner-path DB tests, `service-only-writes.test.ts`), then **full-stack-developer** for 1a-ii. 1b: full-stack-developer. 1c: full-stack-developer, after PR #31 merges and the branch rebases. 1d: ux-developer. 2a: database-admin then api-developer; 2b, 2c: api-developer.

---

# Phase 4 — Implementation

## Batch 1a-i — schema 0057 (database-admin)

*2026-10-19, database-admin. Worktree `presby-domains`, branch `pipeline/custom-domains`, Neon branch `pipeline-custom-domains` (endpoint `ep-dry-tree-axyn61wx`; every write command was guarded to refuse any other endpoint). Nothing committed. No Rule-16 shared file edited.*

### Files Created

- `drizzle/0057_presby_org_domains.sql`: the migration, hand-written and whole-file idempotent. In order: the `domains.manage` permission row; the `founding_administrator` backfill (F150); `organization_domains` with 21 drop-then-add CHECKs; 5 indexes, including the cross-org holding partial unique; three guard triggers (insert, update, delete); FORCE RLS and `tenant_isolation`; revoke-then-grant column grants; four SECURITY DEFINER functions; comments.
- `src/lib/db/domain/domains.ts`: the `organizationDomains` Drizzle table, which declares every constraint and index name 0057 creates. Also the exported enumerations (`ORGANIZATION_DOMAIN_STATES`, `…_HOLDING_STATES`, `…_TERMINAL_STATES`, `…_RELEASE_CAUSES`, `…_CHECK_CLASSES`, `…_PLATFORM_HOLDS`, purposes, web roles, `created_via`) and the `OrganizationDomain` type. The header names every rule the table builder cannot express and points at the 0057 section that enforces it. It is not yet re-exported from `index.ts` (integration item 1).
- `src/lib/db/domain/domains.schema.test.ts`: a pure test (16 tests) in the `events.schema.test.ts` shape. It checks that the constraint and index names match the migration in both directions and that the TS enumerations equal the migration's CHECK lists and index predicates. It also parses the trigger's `-- BEGIN LEGAL EDGES` / `-- END LEGAL EDGES` block (25 edges, the right states, mail scoping) and pins the single definition of each policy constant (`30 days`, `6 hours`, `24 hours`, caps 3 and 1).
- `src/lib/db/domain/domains.db.test.ts`: the owner-path DB suite, 35 tests, serial. It covers:
  - every guard on `neondb_owner`;
  - stamps, the 30-day grace, and the rule that `lapsed → parked` keeps the running deadline;
  - every `release_cause` positive path (`lapsed_grace`, a parked row's carried cause, `force_released`, `evicted`, `org_closed`, `pending → expired`);
  - the cap, including two concurrent claims shown waiting on the advisory lock in `pg_locks`;
  - the delete guard and the teardown cascade;
  - **the serving matrix**, with a committed positive control read back through `presby_app` and then 13 flips, each changing one condition.
- `src/lib/domains/service-only-writes.test.ts` (A4): a source scan over `src/**` (4 tests, including matcher controls so it cannot pass vacuously). It passes trivially until `service.ts` exists.
- `e2e/support/domains-fixture.ts`: the one backdating seam:
  - `backdateDomainClock(db, id, { expiresAt?, graceEndsAt? })` for Drizzle databases and transactions;
  - `backdateDomainClockHttp(sql, …)` for the e2e neon-HTTP client;
  - `domainGuardStates()` and `DOMAIN_GUARD_TRIGGERS`.
- `scripts/domains/test-rls-47.sql`: section 47, sections (a)–(o) including (h)–(h4). It runs as `presby_app` and every block ends in `rollback`.
- `scripts/domains/seed-dev-domains.sql`: the `org_portal.domains` toggle ON for Alder Creek, and `domains.manage` bound to Alder Creek's `brand_admin` role (f…000a). It creates no domain row.

### Files Modified

- None tracked. (`npm ci` populated the worktree's empty `node_modules`; `package-lock.json` is unchanged.)

### Schema Changes

- **New table `organization_domains`.** 33 columns, exactly the Phase 3 table. Key shape:
  - `unique (id, organization_id)`.
  - `organization_id → organizations` ON DELETE CASCADE.
  - `created_by_user_id → users`, NO ACTION.
- **Indexes:**
  - `organization_domains_hostname_holding_uq`: `(hostname, purpose)`, holding states, cross-org;
  - `…_org_host_uq`, `…_one_canonical_uq`, `…_due_ix`: all non-terminal;
  - `…_org_ix`.
- **Triggers** (all SECURITY INVOKER, `search_path = public, pg_temp`, EXECUTE revoked from PUBLIC, `presby_app` and `presby_platform`):
  - `presby_org_domains_guard_insert`: rows are born `pending`, with no hold or reason and no trigger-owned column set; `next_check_at` is capped at 6 h; the cap is 3 web / 1 mail under `pg_advisory_xact_lock(hashtextextended('org_domains:'‖org, 0))`.
  - `presby_org_domains_guard_update`:
    - immutable columns;
    - terminal freeze;
    - the six trigger-owned columns;
    - the 25-edge values table;
    - side conditions;
    - `release_cause` evidence (A2);
    - stamps, and the 30-day grace (A1);
    - the state-aware `next_check_at` cap.
  - `presby_org_domains_guard_delete`: lets a delete through only once the parent organization is gone.
- **RLS:** `enable` + `force`; `tenant_isolation` with both `using` and `with check`.
- **Grants, `presby_app`:**
  - `select`;
  - `insert` on the 8 tenant-intent columns;
  - `update` on the 14 state and observation columns;
  - no `delete`.
- **Grants, `presby_platform`:** `select, insert, update`, no `delete`. This documents intent; `getPlatformDb()` is the owner today.
- **Functions** (all SECURITY DEFINER, `search_path = public, pg_temp`, explicit ACL, no PUBLIC):
  - `presby_org_serving_canonical_host(uuid)`: owner only;
  - `presby_published_site(text)`: DROP + CREATE with a trailing `serving_host`. The ACL is re-applied (owner + `presby_app`), as are `search_path` and the comment, inside one `begin … commit`, so no caller ever sees it missing or PUBLIC-executable (F152);
  - `presby_published_site_by_host(text)`: `published_site`'s columns plus `slug`, `canonical_host`, `request_is_canonical`;
  - `presby_current_org_site_status()`.
- **Permission:** `domains.manage` (module `domains`, tier 1, `requires_two_factor = false`), plus the `founding_administrator` backfill.
- **Migration mode: hand-written** (`db:generate` is broken repo-wide; `db:migrate` does not track past idx 9). Applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0057_presby_org_domains.sql` against `pipeline-custom-domains`.
- **Journal:** not registered. That is a Rule-16 file, so the entry is integration item 2.

### Audit Events

- None in this batch. A migration is provisioning and writes no audit row. Every runtime transition writes exactly one `audit_events` row through `transitionDomain()` in Batch 1a-ii (R8), which owns the per-transition tests.

### Commands and results

| Command | Result |
|---|---|
| Stock `scripts/test-rls.sql` **before** 0057, no-stop copy, as `presby_app` | baseline: **654 passes**; FAIL at `:127, :153, :184, :472, :825, :837, :7333, :7849`. These are the five known development drifts plus three from this branch's giving seed rows. As written, the script stops at `:127`, exit 3, exactly as on `development`. |
| `psql $MIGRATE… -v ON_ERROR_STOP=1 -f drizzle/0057…` run 1 | exit 0 (a first attempt aborted at plpgsql parse; see Notes) |
| Catalog snapshot (perm, binding counts, row count, FORCE, policy, every constraint and index definition as md5, triggers, table and column ACLs, the 7 functions' secdef/proconfig/proacl/def md5) | captured |
| Whole-file re-apply, run 2 | exit 0; both inserts `INSERT 0 0`; **snapshot byte-identical** |
| Backfill, failing-first: a `deletable_until` fixture org with a `founding_administrator` role lacking the key, then whole-file run 3 | before 0 bindings; run 3 exit 0 with `INSERT 0 1`; after 1 binding; fixture deleted (org and role 0) |
| `rolbypassrls` for `$APP_DATABASE_URL` | `presby_app` / `f` |
| `psql $APP… -v ON_ERROR_STOP=1 -f scripts/domains/test-rls-47.sql` | exit 0, **114/114** passes; also 114/114 after the seed was applied |
| Section 47, failing-first (one mutation each on the owner, then the whole file re-applied to restore): no FORCE · holding index dropped · update guard disabled · insert guard disabled · `grace_ends_at` granted · helper EXECUTE to PUBLIC · `published_site` `search_path` reset · `published_site` to PUBLIC · DELETE granted · one-canonical index dropped | every one exits 3 at its assertion: `:65` 47a FORCE; `:198` 47d "two organizations both hold"; `:105` 47a guards enabled (×2); `:339` 47h grace_ends_at; `:293` 47g no PUBLIC (×2); `:286` 47g search_path; `:371` 47h no DELETE; `:729` 47k "two canonical hosts". Restored: exit 0, 114/114 |
| Owner-path suite, failing-first (a mutated copy of 0057 applied, the matching test run, the real file re-applied): grace re-stamped on lapsed→parked · no advisory lock · delete guard always passes · predicate ignores the toggle · `lapsed_grace` evidence dropped · `org_closed` evidence dropped · expiry side-condition dropped | each fails exactly its test ("KEEPS the running deadline", "serializes two concurrent claims", "refuses an owner-path DELETE", "org_portal.domains toggled off" + "toggle row absent", "lapsed_grace: refused before…", "org_closed: refused while…", "pending -> expired: refused…"). Restored |
| A4 scan, failing-first: a temporary `src/lib/domains/zz-a4-probe.ts` with a raw `update organization_domains` and a `.update(organizationDomains)` | both rules fail and name the file; probe removed; 4/4 |
| `scripts/domains/seed-dev-domains.sql` ×2 | exit 0 both times (`INSERT 0 1` ×2, then `INSERT 0 0` ×2). `presby_has_permission(Marguerite, alder, 'domains.manage')` = t; at bramblewood = f |
| Stock `scripts/test-rls.sql` **after** 0057 and the seed, no-stop | **654 passes; FAIL set byte-identical to the baseline** |
| Integrated simulation: a temporary copy of the stock suite with the one `\ir domains/test-rls-47.sql` line appended, no-stop | **768 passes** (654 + 114), the same 8 baseline FAILs, 0 errors in section 47 |
| `npx dotenv -e .env.local -- vitest run --no-file-parallelism` on the three new files | **55/55** (35 DB + 16 schema + 4 scan), 45 s |
| `npm run test:db` (full, serial) | 343 files, **5471 passed, 10 failed**: 4 in `calendar.test.ts`, 6 in `org-features.test.ts`, all 20 s timeouts. Part of this run overlapped my own psql suites on the same branch (my error, noted). Rerun in isolation: `org-features.test.ts` failed 2 timeouts at the default 20 s, then **22/22 with `--testTimeout=180000`** (the two "every axis x category x toggle" loops take 28 s and 29 s against Neon). `calendar.test.ts` was **142/142 with `--testTimeout=180000 --hookTimeout=180000`** (255 s). Neither file touches `organization_domains` or the changed function. **Timeouts were raised for these two files only, because of Neon latency.** |
| `npm run typecheck` | exit 0 |
| `npm run lint` (`--max-warnings=0`) | exit 0 |
| `npm run check` (six tripwires) | exit 0. `check:secrets` scans only git-tracked files, so I also ran `checkSecretsPii()` directly over the 9 untracked new files: **0 findings** |
| `npm run check:schema-parity` | exits 1 **before and after**, with one identical failing difference: `permissions.requires_two_factor` exists in the database (PR #31's 0055 is on this branch) but not in main's `authz.ts`. A temporary copy of the script that also imports `domains.ts` compares 69 tables (vs 68) with the same 7 differences, so `organization_domains` contributes no difference. It goes green when PR #31 merges. |
| `npm run docs:erd` | not run. The ERD is built from the `index.ts` re-export, which is integration item 1, so running it now would change nothing. |
| `npm run build` | exit 0; no tracked file touched |
| Final catalog snapshot vs the run-1 snapshot | differs only in `app_role_permissions` (+1, the seed's `brand_admin` binding) |

### Implementer Notes

**What Phase 3 got wrong against the live catalog:**

1. **test-rls-47 (e)/(f) cannot carry a positive control as `presby_app`.** `organization_sites` has no `presby_app` grant (DECISION-081; section 16 records the same limit), and the only seeded site, Alder Creek's, is `provisioning`. Every zero in (e)/(f) is therefore also explained by the site. The SQL section states this as an explicit precondition assertion rather than hiding it. It still proves what only `presby_app` can show: the anonymous path calls both functions and gets no row in any state, by host (canonical and alias) or by slug. The differential lives in `domains.db.test.ts` "serving matrix":
   - a committed fixture (site live, toggle on, canonical and alias live) is read through the **`presby_app`** connection with no GUC;
   - each of 13 conditions is then flipped alone and goes to zero: canonical `attached`/`lapsed`/`parked`, `paused`, `disputed`, toggle off, toggle row absent, site `suspended`/`provisioning`, org not active, a dark alias alone, and a committed pause read back through `presby_app`;
   - a check that the predicate's body reads no category axis.
2. **`presby_giving_guard_delete()` exists only in PR #31's 0055**, which main does not carry. I wrote `presby_org_domains_guard_delete()` with the same idiom so 0057 does not depend on 0055.
3. **The live `presby_published_site` OUT list** (read with `pg_get_functiondef` on this branch) is 0024's 17 columns; nothing later widened it. Its live ACL was owner + `presby_app` and its `search_path` was pinned, as Phase 2 said. Both are reproduced and asserted.
4. **Stock `check:schema-parity` already fails on this branch** (`permissions.requires_two_factor`, from PR #31). This is pre-existing, not mine (see the table).

**Deviations from the design (each tightens it; none loosens it):**

- **The mail row's `lapsed → released` edge also accepts a force-release** (`force_released`/`evicted` with the owner-only reason), not only `remove`. A mail row can never enter `release_pending`, so without this a platform admin could not force-release a lapsed mail row with a reason. The trigger works on `(from, to)` pairs, so this is a cause rule, not a new edge; the count is still 25. **`state.ts` must list both events on that pair.**
- **`force_release_reason` may be written only on the force-release edge itself** (the same UPDATE that moves the row into `release_pending`/`released`). Otherwise a reason set early on a live row would later force every ordinary removal to carry a platform cause. This is what makes A2's "the platform's reason cannot be relabelled" hold.
- **Additional CHECKs:**
  - `claim_name` gets the same shape rule as `hostname`;
  - `proof_miss_count`/`probe_miss_count` ≥ 0;
  - `hold_reason`/`force_release_reason` must be non-blank (so "reason is not null" is real evidence);
  - closed lists for `last_check_class` and `created_via`;
  - jsonb shape (`observation`/`notify_state` objects);
  - `proof_token` length capped at 128.
- **The insert guard also refuses any trigger-owned column set at insert,** and caps an inserted `next_check_at` at 6 h. Both guards stamp `updated_at` themselves.
- **`presby_platform` gets `select, insert, update`, no `delete`.** Phase 3 was silent on this. It mirrors 0054's posture and documents that platform writes are ordinary DML.
- **`backdateDomainClock` takes a Drizzle database *or* transaction** and always runs inside its own `transaction()` (a SAVEPOINT when it is passed a transaction). With the pooled driver, separate statements outside a transaction could land on different connections, so the DISABLE/UPDATE/ENABLE must be one transaction; transactional DDL then guarantees the trigger is never left disabled (tested, including the failure path). The call shape matches Phase 3's `(tx, id, {…})`. An HTTP variant was added for 1c's e2e.
- **The A4 scan exempts `service.ts` from the raw-SQL rule as well** as from the builder rule. It is the sanctioned writer, and a cron lease (`update … where id in (select … for update skip locked)`) is naturally raw SQL. `select … for update` does not match the scan.

**Smaller notes:**

- The first apply aborted at `create function presby_org_domains_guard_update`: plpgsql reads an `IF` condition up to the first `THEN`, and a `CASE … THEN` inside it supplied one. Fixed by computing the cap first. The partial first run left the table and indexes behind. Every later whole-file run exited 0 except the one transient restore below.
- Postgres evaluates CHECKs in constraint-name order, so where host = claim, `claim_name_shape` fires before `hostname_shape`. Section 47 (l) accepts either for those rows and adds one row that isolates each.
- One restore during the failing-first loop exited non-zero once. Re-running the same mutation-then-restore exited 0, and the next case's restore and the final suite were green. I take it as transient (the Neon transport hiccup the giving pipeline also recorded); the final catalog diff confirms the restored state.
- **Named residual (unchanged from DECISION-180):** `created_via` is tenant-supplied at insert. The database does not tie it to the connection, so a tenant could label its own claim `platform`. This affects only its own org and leaves the audit row as the record. Not closed: doing so would need `current_user`, the axis 0047 warns against.

### Integration edits for the orchestrator (Rule 16)

1. `src/lib/db/domain/index.ts`: append `export * from "./domains";`. Then run `npm run docs:erd` (updates `docs/schema-design.md`) and re-run `npm run check:schema-parity`.
2. `drizzle/meta/_journal.json`: append `{ "idx": 57, "version": "7", "when": 1787014313186, "tag": "0057_presby_org_domains", "breakpoints": true }`, after PR #31's 55/56 (its 56 has `when` 1787014283186).
3. `scripts/test-rls.sql`: append `\ir domains/test-rls-47.sql` after section 46's include and banner. Renumber if another pipeline took 47 first. Re-run against merged `development` as `presby_app`.
4. `scripts/seed-dev.sql`: append `\ir domains/seed-dev-domains.sql` after its final `commit;` (and after giving's `\ir`).
5. `docs/decisions.md`, `docs/schema-design-2.md`, `docs/TODO.md`, `CLAUDE.md`: the Phase 3 drafts stand. For DECISION-180, add the two deviations above (the mail force-release pair; `force_release_reason` written only on its edge). `docs/TODO.md` should note that `check:schema-parity` stays red on any branch carrying 0055 until PR #31's `authz.ts` lands.
6. On `development` at integration: apply `0057` twice (the idempotence proof), then the seed.

### What 1a-ii must know

- **Edge table:** the 25 `(from, to, scope)` rows sit between `-- BEGIN LEGAL EDGES` and `-- END LEGAL EDGES` in 0057 §4b. `domains.schema.test.ts` already parses them (`parseLegalEdges`); the `state.ts` agreement test can reuse that parser. Mail `lapsed → released` is both `remove` and `force_release` (see Notes).
- **Error mapping:**
  - Every guard refusal is SQLSTATE **23514** with message prefix `organization_domains:`; the cap is `organization_domains: cap …`.
  - A grant refusal is **42501**.
  - Unique violations are **23505**, and `constraint_name` tells you which:
    - `organization_domains_hostname_holding_uq` → `held_elsewhere` (name no org);
    - `organization_domains_org_host_uq` → duplicate in this org;
    - `organization_domains_one_canonical_uq` → second canonical.
  - The delete guard is 42501.
- **Canonical swap:** `one_canonical_uq` is not deferrable, so demote the old canonical to `alias` **before** promoting the new one, in one transaction.
- **Writes the trigger expects:**
  - put `release_cause` in the same UPDATE as the exit edge;
  - never set it on an edge into `verified` (the trigger clears it);
  - `force_release_reason` goes in the same UPDATE as the force-release edge;
  - never `.set()` any of the six trigger-owned columns.
- **Policy constants to pin `policy.ts` against:** the literals `c_grace_period … '30 days'`, `c_next_check_cap … '6 hours'`, `c_next_check_cap_parked … '24 hours'`, `c_web_cap … 3`, `c_mail_cap … 1`. `domains.schema.test.ts` guarantees each has exactly one definition.
- **Reads:**
  - `presby_current_org_site_status()` is the pre-flight read.
  - `presby_published_site_by_host(p_host)` matches **exactly**; pass `requestHost()`'s normalized value.
  - `presby_published_site` now returns a trailing `serving_host` (`sites.ts` uses `select *`, so nothing breaks; `PublishedSiteRow` can gain `serving_host: string | null` in 1c).
- **Not DDL, and yours:** `org_portal.domains` and `org_portal.mail_domain` are TypeScript catalog entries (`ORG_FEATURE_CATALOG`, `operatorEnabled`; `feature_key` has no CHECK). The `foundingAdministratorPlan()` `base` array and its pinned test are yours too; 0057's backfill covers only roles that already exist.
- **Fixtures:** `e2e/support/domains-fixture.ts` (`backdateDomainClock`, `domainGuardStates`). `domains.db.test.ts` shows the pattern: a fresh `createCalendarFixture` org per test (the cap otherwise bites), raw owner SQL, unique `*.invalid` hosts per run (the holding index is global).
- **Timeouts:** run DB tests with `--no-file-parallelism`. `org-features.test.ts` and `calendar.test.ts` need a raised `--testTimeout` against this Neon branch, and you will be editing the catalog that `org-features.test.ts` pins.

### Handoff

**Next: full-stack-developer, Batch 1a-ii.**

Apply locally, against the worktree's own Neon branch:

```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0057_presby_org_domains.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/domains/seed-dev-domains.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/domains/test-rls-47.sql
```

`test-rls-47` is a new section, (a)–(o). It touches no existing `scripts/test-rls.sql` section.

---

## Batch 1a-ii — domain service and actions (full-stack-developer)

*2026-10-19, full-stack-developer. Worktree `presby-domains`, branch `pipeline/custom-domains`, Neon branch `pipeline-custom-domains` (endpoint `ep-dry-tree-axyn61wx`; all four URLs in `.env.local` checked before any write). Nothing committed. No Rule-16 shared file edited. No real Vercel, Resend or DNS call was made: every test uses the fakes, and the DoH adapter is exercised through an injected `fetch`.*

### Files Created

`src/lib/domains/` (all new; `service-only-writes.test.ts` is 1a-i's and stays green):

- `host.ts`: PURE, imports nothing. `requestHost()` (reads only `host`), `normalizeHost()`, `platformHosts()` (memoized on `process.env`), `isPlatformHost()`, `platformOrigin()` (T16: `givingOrigin()`'s rule verbatim), `parseSiteKey()`, `siteKeyRewritePath()`, `assertPlatformHostConfig()`, `isProductionDeployment()`, `isIpLiteral()`. Built to the full Phase 3 contract rather than the classifier subset the claim path alone needs, because Phase 3 puts `host.ts` in this batch and 1c consumes all of it. `probe.ts` and `cron-passthrough.ts` are 1c's and are not built.
- `hostname-rules.ts`: `normalizeClaimInput()`, the G2 pipeline, ten refusal reasons, the apex/`www` pair rule.
- `proof.ts`: PURE; the `_presby-challenge.<claim>` / `presby-verify=<token>` naming.
- `state.ts`: PURE; `DOMAIN_STATES`, `EDGES` (30 rows over the 25 legal pairs), `nextState()`, `edgePairs()`, `auditKeyNameFor()`, `isHolding()`, `isTerminal()`.
- `policy.ts`: PURE; `DOMAIN_POLICY`, `NEXT_CHECK_CAP_MS`, `cadenceMs()`, `nextCheckCapMs()`.
- `checklist.ts`: the view-model (`buildChecklist()`, `readObservation()`, record statuses, steps, phases, banners with the exact Phase 3 microcopy).
- `adapters/dns.ts`: the `DnsResolver` / `DnsObserver` interfaces, `DohResolver` (Cloudflare and Google JSON), `QuorumDnsObserver`, `parseDohResponse()`, `parseTxtData()`, `isQueryableName()`, `createDohObserver()`.
- `adapters/fake.ts`: `FakeDnsResolver`, `createFakeDns()`, and the `DOMAINS_FAKE_STATE_FILE` reader (`fileStateReader()`, read on every query, ignored when `NODE_ENV === "production"`).
- `adapters/index.ts`: `getAdapters()` (`DOMAINS_DNS_PROVIDER`: unset or `doh` is the real quorum; `fake` only outside production).
- `dns-checks.ts`: `checkProof()` (present / absent / wrong_value / unknown).
- `audit-tx.ts`: `insertAuditRow(tx, …)`, the in-transaction audit write (not `recordAudit()`).
- `notify.ts`: `collectNotificationContext()` (on the caller's own tx, in a savepoint), `sendDomainNotification()`, `buildDomainNotification()`; account-class `domain_notification`; ten event copies (only four are used in this batch).
- `messages.ts`: PURE; `claimRefusalMessage()` (shared by the tenant and platform actions).
- `service.ts`: the ONLY writer of `organization_domains` (A4). `transitionDomain()`, `claimDomain()`, `checkClaim()`, `changeCanonical()`, `removeClaim()`, `reconnectClaim()`, `readDomainsView()`, `domainExec()`, `classifyDomainDbError()`, `DomainTransitionError`.
- `toggles.ts`: `setOperatorOrgToggle()`, `OPERATOR_TOGGLE_KEYS`.
- Tests: `host.test.ts` (81), `hostname-rules.test.ts` (75), `state.test.ts` (12), `policy.test.ts` (20), `checklist.test.ts` (38), `adapters/dns.test.ts` (61), `notify.test.ts` (13), `service.db.test.ts` (97, DB-backed), `toggles.db.test.ts` (8, DB-backed).

Actions:

- `src/app/(org)/o/[slug]/admin/domains/actions.ts` and `actions.test.ts` (51): the five tenant actions.
- `src/app/(admin)/admin/organizations/[id]/domains-actions.ts` and `domains-actions.test.ts` (20): the Q2 on-behalf claim and the Q1 toggle action. Named `domains-actions.ts`, so `check:audit` does not scan it; its header says audit is delegated.

### Files Modified

- `src/lib/audit.ts` (+16 `DOMAIN_*` keys) and `audit.test.ts` (the catalog pin).
- `src/lib/org-features.ts`: two catalog entries (`org_portal.domains`, `org_portal.mail_domain`), `operatorEnabled` on every entry (`true` for those two), `listFeatureToggles()` omits operator entries, `toggleOrgFeature()` answers `invalid_key` for them (after the permission check). `org-feature-catalog.test.ts` updated.
- `src/lib/org-portal/tiles.ts`: the `domains` tile (22 tiles). `tiles.test.ts` and `visible-tiles.test.ts` updated.
- `src/lib/founding-administrator.ts`: `"domains.manage"` in the `base` array. `founding-administrator.test.ts` (pinned bundles, plus new plan tests) and `founding-administrator-section.tsx` / `.test.tsx` (a label, so the raw key never renders).

### Endpoints / action signatures and gates

No route handlers. Server actions (all return `{ ok: true; data? } | { ok: false; error; code; field?; retryAfterSeconds? }`, structurally an `ActionResult`):

| Action | Gate |
|---|---|
| `claimDomainAction(slug, { domain, canonical: "www" \| "apex" })` | `auth()` → `resolveOrgContext(user, slug)` → in `withOrgContext`: `presby_has_permission(domains.manage)` then `org_portal.domains` toggle (`orgFeatureEnabledInTx`, category axis off, T10) → rate limit 5 / 24 h / org |
| `checkDomainAction(slug, claimName)` | same gate; "Check now" is forced: 6 / 10 min / claim and 30 / h / org |
| `changeCanonicalAction(slug, domainId)` | same gate; target must be `live` with no hold |
| `removeClaimAction(slug, claimName, promoteDomainId?)` | same gate; `needs_canonical` / `invalid_target` |
| `reconnectClaimAction(slug, claimName)` | same gate; confirms the TXT proof first; shares the check-now limits |
| `claimDomainForOrgAction(organizationId, input)` (Q2) | `auth()` → `hasFeature(ADMIN_ORGANIZATIONS)`; platform actor; web only; the org toggle must already be on; `created_via = 'platform'` |
| `setOrgDomainFeatureAction(organizationId, key, enabled)` (Q1) | same platform gate; `key` must be one of the two operator keys |

`organizationId` is never read from client input on a tenant action. A tenant person from another org gets `forbidden` (membership is verified before the GUC is set).

### Schema changes

None. Migration `0057` was applied by 1a-i; nothing was applied in this batch. No new env var needs documenting for production. `DOMAINS_DNS_PROVIDER` (`doh` default | `fake`) is new and joins the test/dev-only row already in Phase 3's `docs/deployment.md` draft (the build assertion in `host.ts` already refuses `fake`).

### Audit events

Written by `transitionDomain()` (one row, same transaction) or, for the two non-edge writes, by `claimDomain()` / `changeCanonical()` / `removeClaim()` in their own transaction: `domain.claimed` (one per inserted row), `domain.proof_verified`, `domain.recovered`, `domain.expired`, `domain.parked`, `domain.released`, `domain.reconnected`, `domain.canonical_changed`; `tenant.org_feature.toggled` with `via: "platform"` from `toggles.ts`. All 16 `domain.*` keys are declared in `audit.ts` up front (1b needs `attach_requested`, `attached`, `live`, `live_lost`, `lapsed`, `release_requested`, `hold_set`, `hold_cleared`). Metadata: `organizationId, hostname, claimName, purpose, from, to, event, actorKind`, plus `trigger` (machine or `check_now`), `releaseCause`, `reason` (force-release only), `via`. **The proof token appears in no audit row, notification or log; tests assert it.** An observation-only check (no state change) writes no audit row, by design.

**`check:audit` cannot see any of this** (it scans `actions.ts` text for direct mutation calls; there are none in these actions). Each actions file carries a header saying audit is delegated per R8. Coverage is proven by `service.db.test.ts`: it generates one test per `EDGES` row (30) and asserts that `transitionDomain()` writes the new state and **exactly one** audit row with the right key and actor, that a rollback after the transition leaves neither, and that a hand-listed title table equals `EDGES` (so a new edge cannot ship without a test). QA verifies through that file, not the tripwire.

### Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` (`--max-warnings=0`) | exit 0 |
| `npm run check` (seven tripwires: audit-coverage, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries) | all pass. `check:secrets` scans git-tracked files only, so I ran `checkSecretsPii()` over all 39 new and modified files: 0 findings |
| `npm run check:schema-parity` | green, 83 tables, 0 failing (1a-i recorded it red on this branch; it is green now) |
| `npm run test` (no DB env) | 424 files passed, 61 skipped; 6252 tests passed, 1786 skipped |
| New unit tests | 371 pass: host 81, hostname-rules 75, state 12, policy 20, checklist 38, dns 61, notify 13, tenant actions 51, platform actions 20 |
| `service.db.test.ts`, serial, `vi.setConfig` timeouts 90 s / 120 s | **97/97**, 319 s |
| `toggles.db.test.ts`, serial | **8/8**, 13 s |
| DB subset, serial, `--testTimeout=180000`: `org-features`, `founding-administrator`, `org-provisioning`, `treasurer-designation`, `giving/access`, `org-feature-warnings.db`, `domains.db`, `domains.schema`, and `src/lib/domains/**` | 608 tests, 606 pass. The 2 failures were `Connection terminated unexpectedly` on Neon (one in `giving/access.test.ts` cleanup, two `organizations` inserts in `domains.db.test.ts`); **both files re-run alone: 63/63**. This is the Neon transport hiccup 1a-i and the giving pipeline also recorded |
| `psql $APP_DATABASE_URL -f scripts/domains/test-rls-47.sql` (`rolbypassrls = f`) | exit 0, **114/114** |
| `npm run build` | exit 0 |
| Leftovers on the branch | none from this batch. I deleted one stray `domain.claimed` audit row from my own mutation run and one 1a-i fixture user (`domains-db-actor-…@example.invalid`) that 1a-i's run had left |

**Timeouts.** `service.db.test.ts` makes hundreds of round trips to a remote Neon branch and takes about five minutes, so it raises the file's timeouts with `vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })` (this file only). The repo-wide `org-features.test.ts` and `calendar.test.ts` still need `--testTimeout=180000` against this branch, as 1a-i recorded.

**Failing-first, and where I used mutation checks instead.** This batch is new behaviour, so the tests were written with the code, not before it. One genuine failing-first: the first DB run failed 43 tests with `42501 permission denied for table organization_domains`, because a Drizzle `insert().values()` names every column with DEFAULT and Postgres checks INSERT privilege on every named column, while `presby_app`'s grant is eight columns. The fix is the raw column-limited insert (see Deviations 1), after which all 97 pass. Everything else was **mutation-checked**: I applied each of these to the code, ran the named test, saw it fail, and restored the file. All 19 were caught:

| Mutation | Caught by |
|---|---|
| `state.ts`: drop a scope; add an extra edge | `state.test.ts` (pairs equal both directions; A15 shortcuts) |
| `policy.ts`: grace 14 d; a cadence over its cap | `policy.test.ts` (trigger pin; cap test) |
| DNS quorum: absent on one ok answer | `dns.test.ts` (4 error reasons, throwing resolver, wrong_value, state file) |
| hostname rules: allow `%`; drop the mixed-script check | `hostname-rules.test.ts` |
| `host.ts`: read `x-forwarded-host`; allow an IP literal in production | `host.test.ts` |
| `transitionDomain()`: a second audit row; no audit row | `service.db.test.ts` edge cases |
| gate: skip the permission check | "a member without domains.manage is forbidden" |
| check: an `unknown` lookup expires a claim | "a resolver error is dns_unknown… never expires a claim" |
| check: do not catch the cross-org unique violation | "the first organization to VERIFY wins" (A12) |
| check: drop the forced-check rate limit | "rate-limits a person's 'Check now'" |
| remove: do not demote the removed canonical | "needs a replacement" (unique-index violation) |
| reconnect: skip the proof check | "without the proof it refuses" |
| catalog: list operator toggles to tenants; let a tenant toggle them | `toggles.db.test.ts` "the TENANT path cannot flip it" |

### Deviations

1. **The claim insert is a raw SQL `INSERT` naming exactly the eight granted columns, and `next_check_at` is set by a following `UPDATE`.** Phase 3 did not specify the insert form; the natural one, the query builder, cannot work for `presby_app` (above). `next_check_at` is not in the insert grant (it is in the update grant), and without it a new claim would never be due for the cron, so the UPDATE is required, not cosmetic. Updates through the builder are fine (only the SET columns are named). **Any future tenant-path INSERT into this table must be raw with granted columns.** The A4 scan exempts `service.ts` from the raw-SQL rule, so this is legal.
2. **`notify.ts` is built here, not in 1b.** T7 binds every claim, canonical change and removal to notify all holders plus the platform admins, and those actions are in this batch. To keep tenant paths off the platform connection (the `(org)` contract; `tickets-notifications.ts` precedent), recipients are collected on the caller's OWN transaction, in a savepoint, and the mail is sent after commit. The platform path uses a platform transaction, where the same query works on the owner connection.
3. **Five tenant actions, not three.** Phase 3's 1a-ii row says "claim/check/remove"; §6 lists five, the service functions for `changeCanonical` and `reconnectClaim` are in scope, and a service function with no action cannot be used by 1d. They share one plumbing function and are tested the same way.
4. **Two platform actions (the Q2 claim and the Q1 toggle) with no UI.** The brief names the on-behalf claim; the toggle action is what makes `toggles.ts` reachable. Pause, force-release and platform check-now stay 1b.
5. **Two "production" predicates in `host.ts`**, on purpose: `VERCEL_ENV === "production"` for the host set and IP-literal refusal (so the production-build e2e lane on localhost still treats localhost as the platform, T8), and `NODE_ENV` for `platformOrigin()` so `givingOrigin()`'s existing tests keep passing when it becomes a re-export (T16).
6. **The apex/`www` pairing uses a heuristic, not a public-suffix list** (Phase 2 rejected the PSL): exactly two labels, or three where the middle label is a well-known registry label under a two-letter code (`church.co.uk`). A wrong guess costs the admin one extra row to remove or one `www.` claim to add; the proof, not the guess, decides what is held. Named residual.
7. **DNS `present` needs one resolver; `absent` needs every resolver.** An error from either resolver is `unknown`. A resolver showing the record while the other errors is `present`; one showing another `presby-verify=` value while the other errors is `unknown`, not `wrong_value`.
8. **`checkClaim` handles two states** (`pending`; `lapsed` recovery). Every other state is `deferred` with no DNS query and no write. Phase 3 scoped 1a-ii to "proof check, expiry"; the rest is 1b's.
9. **`claimDomain`, `changeCanonical` and `removeClaim` work on WEB rows only** (the org's web-row query); `checkClaim` and `readDomainsView` group by claim name for any purpose, so a lapsed mail row's proof recovery already works. The mail `lapsed → released` edge (both `remove` and `force_release`, per 1a-i's note) is exercised through `transitionDomain()` in the 30-row audit table; removing a mail row through a service function is Batch 2b.
10. **`readDomainsView()`** (the page's gated read, with `presby_current_org_site_status()`) is in `service.ts`. It is data access, not UI, and it puts the read side of the gate in the same file as the writes.
11. **`DomainTx = OrgTx` for both connections** (they are the same Drizzle type); `domainExec()` casts the platform transaction.
12. **All 16 `domain.*` audit keys** are declared now, including the 1b-only ones, so 1b does not edit `audit.ts`.

### What 1b must know

- **The seams.** `checkClaim()` is the three-step routine (read; network with no transaction held; re-read `FOR UPDATE`, confirm the state, apply). 1b extends it: `PROOF_STATES` in `service.ts` is the set of states whose check is a proof lookup, and `applyProof()` is the per-state apply. Add `verified` (attach), `attach_pending`, `attached`, `live` and the grace/`release_pending` handling there. Rename to `observeAndAdvance` if you like; nothing outside `service.ts` calls the internals.
- **`transitionDomain(tx, row, event, actor, opts)` rules.** It picks `release_cause` for you (`remove` → `removed`, or `opts.cause = "org_closed"`; `grace_elapsed` from `lapsed` → `lapsed_grace`, from `parked` carries the row's cause; `detach_ok` carries it; `force_release` needs `opts.cause` in `force_released | evicted` plus `opts.forceReleaseReason`, and only a **platform** actor). It sets `next_check_at` from `cadenceMs(to)` unless the patch names one. A tenant actor can drive every edge except `force_release`, because the grants cover state and observation columns. Never put a trigger-owned column in a patch.
- **Always write `next_check_at` with `dbNowPlus(ms)`** (SQL, the transaction's `now()`). An app-clock `Date` can exceed the trigger's cap by clock skew and be refused; `parked` at exactly 24 h is only safe this way.
- **Savepoint idiom** for an operation that can raise a unique violation: `tx.transaction((sp) => transitionDomain(sp, …))` inside `try/catch`, then `classifyDomainDbError(err)`. `held_elsewhere` is what `pending → verified` raises when another org verified first (A12, names no org). The audit row rolls back with the failed write.
- **Canonical promotion gap (a design call for you).** If an org's canonical group is removed with no live host elsewhere, the org has no canonical row. When a later host reaches `live`, nothing promotes it, so the serving predicate returns null (the site keeps serving from its slug URL; fail-soft, not broken). Either `live_ok` should promote the first live host when none is canonical (a role write beside the transition, one `canonical_changed` row), or the admin must call `changeCanonical`. I did not decide this.
- **Notifications.** Events already have copy: `lapsed`, `parked`, `released`, `force_released`, `hold_set`, `hold_cleared`. Call `collectNotificationContext(tx, orgId)` INSIDE the transaction (it opens its own savepoint), and `sendDomainNotification()` AFTER commit, never inside. `notifyAfterCommit` in `service.ts` is the wrapper. Sends are sequential and each `enqueueEmail` makes an inline attempt, so many recipients add latency to the request that triggered it; the cron does not care.
- **The gate.** `gate()` is private to `service.ts`: tenants need the permission then the toggle; platform actors need the org to exist and the toggle on; machine actors skip it (the sweep keeps observing after an operator turns the toggle off, which only darkens serving). Reuse it for the platform check-now.
- **Adapters.** `getAdapters()` returns `{ dns }` only; add `hosting` on the same seam (`DOMAINS_PROVIDER` unset = `unconfigured`). The fake state file has only a `dns` section; add `hosting` and `probe` to `FakeState` in `adapters/fake.ts`. `DnsObserver.lookup(name, type, match?)` already supports `A`, `AAAA`, `CNAME`, `CAA`, `SOA`, `NS`; the routing, apex (SOA), CAA, DNSSEC and Cloudflare-range checks are `dns-checks.ts` additions.
- **Observation shape.** `DomainObservation` in `checklist.ts` already reserves `targets` (`{ cname, ipv4[] }`) and `routing.records[]` (`{ hostname, status, hint }`); write exactly that and the checklist renders it. `proofMissCount`, `probeMissCount` and the `policy.ts` debounce numbers (`proofLostMisses` 6 spanning ≥ 10 h, `liveLost*`) are defined and unused until you write the debounced lapse.
- **Test pattern.** `service.db.test.ts`: `tenant()` builds an org, toggle, member and role; `walkTo(id, state)` arranges any state through legal owner edges; `backdateDomainClock` is the only past-clock seam; `createFakeDns()` gives a two-resolver quorum with error injection. The 30-row edge table asserts "exactly one audit row" for every edge, so a 1b transition needs no new audit test, only a behaviour test.
- **A12.** `claimDomain` reads no other org's rows. Do not add a cross-org read to a claim or a check; the conflict surfaces only at verification.

### Integration edits for the orchestrator (Rule 16)

None are new from this batch beyond 1a-i's list. For the drafts:

1. `docs/decisions.md`: amend DECISION-180 with "tenant-path inserts are raw SQL naming the eight granted columns, and `next_check_at` is set by an UPDATE (Deviation 1)". Amend DECISION-179's module map: `proof.ts`, `dns-checks.ts`, `audit-tx.ts` and `messages.ts` exist beyond the draft's list.
2. `docs/TODO.md` (add): the canonical-promotion gap above; revisit the apex heuristic if a public-suffix list is ever adopted; the `domains` tile links to a page that does not exist until Batch 1d (dev only, once `seed-dev-domains.sql` is applied); `service.db.test.ts` takes about five minutes (split if CI minutes matter); sequential inline-attempt notifications in the request path.
3. `docs/deployment.md`: `DOMAINS_DNS_PROVIDER` (`doh` default, `fake` dev/test only, refused by the production build assertion) joins the dev/test-only row.

### Handoff

**Next: full-stack-developer, Batch 1b** (Vercel adapter + fake; full `observeAndAdvance`; `/api/cron/domains` + `vercel.json`; the platform service functions and actions for check / pause / resume / force-release; `scripts/domains/reattach.ts`). QA (Phase 5) runs after 1d; it should read `service.db.test.ts` as the R8 evidence.

**Nothing to test in a browser yet.** There is no page or form in this batch (1d). If `scripts/domains/seed-dev-domains.sql` has been applied to the branch, Alder Creek's admin hub now shows a "Website domain" tile that links to `/o/alder-creek/admin/domains`, which 404s until 1d. The actions can be exercised by the DB tests only.

---

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]

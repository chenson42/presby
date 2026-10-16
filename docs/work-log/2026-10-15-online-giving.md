# Online Giving (Stripe) and Contribution Statements — Work Log

> **Slug:** `2026-10-15-online-giving`
> **Surface:** mixed — anonymous (the public site's sealed giving section → Stripe-hosted Checkout), `(org)` member (own giving history, own statements), `(org)` admin/treasurer (funds, provider connection, gift recording, statements), and an unauthenticated `/api/webhooks/stripe` receiver
> **Permission(s):** new tenant-catalog keys (not `FEATURES.*`), names for Phase 3 to fix — at least a giving read key, a giving-recording key (the operator's "role for recording offline gifts"), a giving-administration key (funds, provider connection, statements), and whatever the treasurer role template binds. `giving.*` keys are **tier 2** (`permissions.sensitivity_tier = 2`).
> **Flag(s):** none new (operator ruling 2026-10-14: no new platform flags before go-live). A toggle-only `ORG_FEATURE_CATALOG` entry (`flag: null`) in the DECISION-160 shape replaces the `org_portal.giving` coming-soon placeholder; whether existing orgs are provisioned ON or OFF is a Phase 1/3 question (a congregation with no Stripe connection has nothing to show).
> **Estimated complexity:** large — full pipeline, ONE work-log, Phase 4 in batches (schema → provider core + Stripe adapter + webhook → giving pages → statements)
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-15 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-15 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named (Batch 1: database-admin) | 2026-10-15 |
| 4 — Implementation | Batch 1 database-admin → full-stack-developer; B2 full-stack-developer; B3 api-developer → ux-developer; B4 api-developer + ux-developer; B5 database-admin → full-stack-developer; B6 full-stack-developer | Batches 1–4 complete; Batch 5 pending (database-admin → full-stack-developer) | — | 2026-10-16 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Kickoff — pre-assigned numbers (Rule 16)

- Migration: `drizzle/0055_presby_giving.sql` (next after 0054). A second migration, if statements need one, is `0056`.
- Decisions: `DECISION-168` through `DECISION-175` reserved for this pipeline (168 = the spike's provider/Stripe ruling, adopted or amended at Phase 2; 169 = the `stripe` npm dependency; the rest for Phase 2/3 rulings).
- Findings: `F138` onward. F138 (Phase 2), F139–F141 (Phase 3). F142 = a SECURITY DEFINER `language sql` function is never inlined, so planning, not execution, sets the cost of a many-join predicate (Batch 1a, 2FA arm: 12 ms plan vs 1 ms execute). F143 = BEFORE INSERT guards fire before ON CONFLICT is checked, so `on conflict do nothing` is not an idempotence tool on a guarded table (Batch 1a, seed reversal). Both go to `docs/schema-design-2.md` at integration.
- Worktree: `/Users/cshenso/git/presby-platform/presby-giving` on `pipeline/online-giving`. Neon branch `pipeline-online-giving` (`br-winter-band-axb6tzax`, endpoint `ep-wispy-mode-axymely1`, child of `development`, created 2026-10-16); the worktree's `.env.local` points every connection at it. Template role ids `…0005` (`treasurer`) and `…0006` (`giving_recorder`) confirmed free on 2026-10-16 (templates occupy `…0001`–`…0004`).
- Shared files (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`) are edited only at integration.

## Kickoff — operator rulings (2026-10-15, verbatim intent)

Request: "lets work on giving and finance next." Then: "for giving i'd like to be able to support multiple providers … the first of which is an integration with stripe." Rulings on the five kickoff questions:

1. **Stripe account shape:** "lets start with per congregation" — each congregation's own Stripe account. Follow-up ruling: **PresbyPortal (the operator) is the Stripe Connect platform account; the platform takes no application fee at all.** Congregations onboard through the Stripe-hosted flow and keep their own money and dashboard.
2. **First scope:** "we can do online giving plus statements. lets plan to get through everything in phases." The general ledger, budgets, reconciliation and the reimbursement treasury half come as later pipelines; gifts must be able to post to a ledger later.
3. **Fee coverage:** "yes" — donors may choose to cover processing fees.
4. **Vanco:** "yes. not sure. we just need to design for it. not implment vanco right now. lets do implement stripe." Multi-provider by design; Stripe implemented; Vanco designed-for only.
5. **Envelope numbers / who records offline gifts:** "i don't think we need envelope numbers. we should have a role for that. obviously the treasurer can do it too." No envelope numbers; a dedicated giving-recording role; the treasurer also can.
6. **Split gifts:** one fund per gift in v1 (a donor who wants two funds gives twice).
7. **Statements:** every donor with gifts in the year receives a year-end statement (Pub 1771's $250 written-acknowledgment rule is the floor, not the audience).
8. **Refunds v1:** started in the congregation's Stripe Dashboard only; presby records the reversal from the webhook.

Standing constraints from the schema design (`docs/schema-design-2.md` §7 Section Q, §10 item 5): giving is tier 2 and never widens through the directory; **per-member giving is never visible to a parent council** (an invariant with a test); `giving_donors` may not reference a person; gifts are the truth and settlements reconcile to them; statements are issued artifacts with retention; a public-site donate form is a sealed section (PCI SAQ-A — hosted page, never an embedded card form). From the feature-match review (§5b, Track E): finance is post-cutover; the SoR transition is two events; FPCW keeps issuing the cutover year's statements from Church360/Vanco.

Assumption stated for Phase 1 (operator to confirm, CPA to rule): a fee the donor chose to cover is part of the donor's contribution on the statement (the donor paid it; the processing fee is the congregation's expense).

## Kickoff — operator rulings on the Phase 1 open questions (2026-10-15)

Asked and answered after Phase 1 returned:

- **Q2 (G1 bootstrap):** "Yes, operator designates treasurer" — a one-time, audited platform step per congregation in the DECISION-155 shape; the control hides once anyone at the org holds `giving.manage`; no platform predicate enters any authority check.
- **Q3 (toggle):** OFF by default for every existing and new org (`provisionedOn: false`).
- **Q4 (org types):** congregations and new worshiping communities only; presbyteries and synods see no tile and cannot turn the toggle on.
- **Q10 (self-link):** a signed-in member's online gift auto-links to their membership; offline and anonymous online gifts still need manual confirmation.

Orchestrator defaults for the remaining questions, stated so Phase 2/3 can proceed; the operator may overrule any of them:

- **Q1:** PresbyPortal (the operator) owns the Connect platform account (ruled earlier today). A **test-mode platform account with Connect enabled is an operator prerequisite before Batch 3 verification** — tracked, not assumed.
- **Q5:** one statement per donor in v1 (no household/joint statements).
- **Q6:** CPA review of the statement wording and the four accounting questions is a **hard gate before any real statement is issued**, not before design. Design stores the donor-covered fee in its own column so the policy is one constant.
- **Q7:** v1 relies on Stripe's payment receipt; presby sends no per-gift email. The return page never calls the receipt an acknowledgment.
- **Q8:** automatic payouts are required for go-live (manual payouts cannot be reconciled).
- **Q9:** issued statements retained ≥ 7 years, never hard-deleted; raw provider bodies purged after 90 days once processed (the normalized rows are the record).
- **Q11:** CSV export of gifts is in v1, behind `giving.view`, audited as a bulk tier-2 export.
- **Q12:** fixed bounds $1–$25,000, USD only.
- **Q13:** both — the platform provides `/site/<slug>/give` whenever giving is live, and a `giving` live slot for site authors.
- **Q14:** no real congregation needs presby-issued statements for 2026 (FPCW keeps issuing the cutover year from Church360/Vanco); the first real run is January 2028, so statements have no calendar deadline in this pipeline.

## Kickoff — Spike result (architect, 2026-10-15, read-only; adopted or amended at Phase 2)

Operator rulings that framed it (2026-10-15): per-congregation Stripe account; first scope = online giving + Pub 1771 statements, ledger/budgets/reconciliation later, gifts must be able to post to a ledger later; donors may cover fees; multi-provider by design, Stripe implemented first, Vanco designed-for only; no envelope numbers; a dedicated giving-recording role for offline gifts, treasurer can too.

## A. Linking — Stripe Connect, direct charges, congregation-owned account
- Accounts v2 Merchant configuration: `dashboard: full`, `fees_collector: stripe`, `losses_collector: stripe`, Stripe-hosted onboarding. Standard/Express/Custom are now "legacy" labels.
- Connecting a pre-existing account needs OAuth `read_write` on Accounts v1 — defer until asked.
- Store only `acct_…`; no per-congregation secrets.
- One platform webhook endpoint scoped to "Connected accounts"; event's top-level `account` identifies the connection. Production endpoint receives live and test events — check `livemode` against the connection's mode.
- Rejected: pasted restricted key (secret custody, per-org endpoints, volunteer friction); Express/Custom (platform liable for fraud/disputes, costs extra; contradicts ruling 1).
- Sources: docs.stripe.com/connect/accounts, /connect/accounts-v2/connected-account-configuration, /connect/direct-charges, /connect/webhooks, /connect/oauth-reference, stripe.com/pricing.

## B. Giving page — redirect to Stripe-hosted Checkout
- Our sealed section collects amount, fund, cover-fees, method only; server creates the Checkout Session with `Stripe-Account` and inline `price_data`; `product_data.name` = fund display name; fund UUID in `metadata` and copied to `payment_intent_data.metadata` / `subscription_data.metadata`. No Stripe Product per fund.
- `billing_address_collection: required`, `customer_creation: always`; Checkout always collects email.
- Rejected: Payment Links (no per-gift fee math; pay-what-you-want can't be recurring), Payment Element / embedded Checkout (card form inside our page — sealed-section invariant).
- ACH Direct Debit supported in Checkout one-time and subscription; mandate shown and recorded.
- US pricing verified 2026-10-15: cards 2.9% + 30¢ (+1.5% intl, +1% FX); ACH 0.8% capped $5; disputes $15. Nonprofit discount is per-account, applied for, needs ≥80% donation volume; the commonly quoted 2.2% + 30¢ is unconfirmed by Stripe's own page.
- Donor-covers-fees gross-up: card `total = ceil((G + fixed) / (1 − pct))`; ACH `total = min(G / (1 − 0.008), G + 5)`. Rate stored on the connection, not in code. When cover-fees is ticked, ask card vs bank and restrict `payment_method_types`. Covered amount is donor intent; actual fee comes from the BalanceTransaction; difference accepted.

## C. Recurring — Checkout subscription mode, inline recurring `price_data`; Customer Portal by redirect
- Each subscription = a recurring-schedule row; each paid invoice = its own gift row keyed on its PaymentIntent.
- Pinned API version `2026-09-30.endive`; invoice→payment linkage moved to InvoicePayment objects — Phase 3 confirms the field.
- Changing an amount = cancel + new gift (portal can't edit custom inline prices). Portal can't be iframed; donors can't add a new bank account there; portal config is per platform — Phase 3 verifies behaviour for direct-charge customers.

## D. Reconciliation — one gift = one succeeded PaymentIntent
- `latest_charge.balance_transaction` → gross/fee/net. Payout contents: `balance_transactions?payout=po_…` with `Stripe-Account`; works only for automatic payouts.
- Refunds and disputes are reversal rows (append-only). Processing fees not returned on refund. ACH disputes are final; late ACH returns arrive as disputes.
- Events: checkout.session.completed / async_payment_succeeded / async_payment_failed; invoice.paid / payment_failed; customer.subscription.created / updated / deleted; charge.refunded, refund.updated, refund.failed; charge.dispute.created / closed; payout.paid / failed / reconciliation_completed; account.updated, account.application.deauthorized.
- Idempotency: at-least-once, unordered; unique (connection, event.id) inbox; unique (connection, external_transaction_id) on gifts; return 2xx fast, process from the queue; raw body + signature, 5-minute tolerance.

## E. Donor identity
- Stripe Customers many-to-one onto donor rows via a provider-identity child table keyed (connection, `cus_…`). Two emails = two identities, one donor. Donor merge like person merge (`merged_into_id`), never deleted.
- Email match to a person only PROPOSES a link, shown only to giving-recording permission holders, confirmed by hand. Confirmed link is a composite reference to `memberships`, never bare `person_id`. Match reads tier-1 email from inside giving; nothing flows back. "Anonymous" is a display flag.

## F. Provider-neutral interface (deliberately small)
- `provider_connections` (org, provider enum, external account id, live/test, status, connected/disconnected dates).
- On gifts: `provider_connection_id` (null for offline), `external_transaction_id`, integer cents gross/fee/net, `donor_covered_fee`, status `pending → succeeded | failed`; refund/dispute as reversal rows.
- `settlements` (connection, external batch id, deposit date, gross/fee/net) + settlement lines matching gifts.
- TS: `normalize(raw) → NormalizedEvent[]` (GiftSucceeded, GiftFailed, GiftReversed, SettlementPosted). Stripe feeds from webhooks; Vanco from settlement-file import.
- NOT abstracted: checkout creation, onboarding, recurring schedules/portal, fee formula, dispute evidence, refund initiation (v1: refunds started in the Stripe Dashboard, arrive by webhook).
- Raw payload: exact signed body as `raw_body text` in a provider-events inbox, not jsonb (avoids §9 rule 5 jsonb-spec requirement; keeps bytes for signature re-check).

## Structural rulings
- `src/lib/giving/` neutral core; `src/lib/giving/providers/stripe/` adapter; `src/app/api/webhooks/stripe/route.ts` (Node runtime, bypasses proxy, verifies its own signature per DECISION-028); `src/lib/db/domain/giving.ts`.
- Webhook has no session: writes only through a SECURITY DEFINER ingest function that derives the org from the connection row (DECISION-147 shape); never `set_config` directly.
- Permissions in the tenant catalog (`giving.record`, `giving.view`, …), never `src/lib/permissions.ts`. On/off = per-org toggle, no new global flag.
- Dependency: `stripe` 23.0.0 (MIT, Node ≥ 20; repo ≥ 22). Pin `apiVersion`. Server-only; never from `src/proxy.ts`/Edge. New dependency → its own decision entry.

## G. Open questions for the operator
1. Which legal entity owns the Connect platform account (each self-hosted fork is its own platform)?
2. Confirm presby never takes an application fee.
3. Any congregation needing to connect a pre-existing Stripe account (OAuth, Accounts v1; accounts controlled by another giving platform can't connect)?
4. Is a donor-covered fee part of the deductible contribution on the statement? (CPA.)
5. May we require automatic payouts (manual payouts can't be reconciled)?
6. Can one gift be split across several funds?
7. Statements: every donor, only ≥ $250, or on request?
8. ACH return after a statement is issued: corrected re-issue?
9. Retention for issued statements and raw provider bodies?
10. Refunds only from the Stripe Dashboard acceptable for v1?

## Kickoff — prior-art extraction (2026-10-15)

## westervillelions (`~/git/westervillelions/src/lib/db/schema.ts`)
Header 660-665: two entities (501c4 club + 501c3 foundation), cash basis, integer cents, FY named by start year, transfer = two linked rows, naive timestamps.
- ledger_entities (668): slug, name, tax_classification, ein, fiscal_year_end '06-30', donations_deductible.
- ledger_funds (718): entity_id, slug, name, kind (administrative|activity|charitable|scholarship), opening_balance_cents, is_active; unique (entity, slug).
- ledger_donors (883, "subject to Pub 1771"): name, emails text[] (replaced single email in 0077), address, member_id set null. No indexes.
- ledger_transactions (927): entity, fund, bank_account, txn_date, flow income|expense, category, amount_cents positive, party, memo, beneficiary_cause, public_note, payment_method (check|cash|zeffy|debit_card|bill_pay|other), check_number, receipt_storage_key, receipt waiver (at/by/reason), transfer_group_id self-join, status posted|pending|rejected, approval (by/at/board_minute/rejection_reason), reconciled(+at), recorded_by, dues_payment_id unique = idempotency key, donor_id, reconciled_session_id, budget_line_id.
- ledger_txn_cosigns (1031): append-only co-approvals, unique (txn, user).
- ledger_acknowledgments (1051): donation_txn_id (unique → one ack per gift), donor_id, donee_entity_id write-once, amount_cents + txn_date frozen copies, type written_ack_250|quid_pro_quo_75, quid_pro_quo value/description, purpose (editable until sent), sent_at (null = pending), sent_via email|print, letter_storage_key, letter_text snapshot, recorded_by.
- ledger_letter_templates (1166): single row; greeting "Dear {{donorName}},", body_text, closing, signature_name/title. No column for the IRS-required wording — generated in code so a treasurer can't edit it out; no version history because letter_text snapshots.
- ledger_settings (1344): philanthropy_visibility, treasurer_bonded, reserve_warn_threshold_cents, disb_approval_threshold_cents, retention_years 7, holding_period_warn_days.
- ledger_receipt_files (1711): bytea in Postgres, key `receipts/<uuid>/<name>` or `acknowledgments/…`.
- ledger_reimbursements (1552): submitted_by member/user, amount, description, receipt_storage_key not null, fund_id set at pay, status submitted|rejected|paid (+legacy approved), reviewed by/at, paid_at, ledger_transaction_id (paying creates an expense txn).

Acknowledgment letters: created per gift via POST .../transactions/[id]/acknowledge (`deriveAckType()`); composed in `src/lib/ledger-acknowledgment-letter.ts` — `composeAcknowledgmentLetter()` (255) merges template + `buildRequiredBlock()` (181-241: entity + IRC section, date, amount, optional purpose, "No goods or services…" OR quid-pro-quo FMV/deductible statement, EIN, retain line); batch generate writes letter_text (regenerate allowed until sent); print = `window.print()` (no PDF lib) or upload a PDF/JPEG/PNG to receipt_files; email claims rows (`sent_at`, `sent_via='email'` WHERE sent_at IS NULL) then sends via Resend/email_queue, reverting if every address fails. Per-gift letters only — NO annual/year-end statement exists.

Provider integration: Zeffy only (`src/app/api/zeffy/webhook/route.ts`, HMAC `zeffy-signature`, `ZEFFY_WEBHOOK_SECRET`, idempotent event store in `src/lib/zeffy/`); not connected to the ledger (gifts entered by hand as payment_method='zeffy'). No Stripe/Vanco/PayPal/Square.

## fpcw-directory (`~/git/fpcw-directory/src/lib/db/schema.ts`)
Enums 123-143: type reimbursement|vendor_expense; status draft|submitted|approved|paid|returned|void; return_kind needs_info|denied; event_type submitted|approved|returned|resubmitted|created_on_behalf|paid|voided|receipt_waived|note_added.
- payment_requests (2544): request_type, payee_name, payee_member_id, requested_by_member_id (restrict), created_on_behalf_by_member_id, request_date, amount numeric(10,2) via `src/lib/money.ts`, purpose, pre_approving_elder_name, committee_group_id (restrict), budget_category free text, status, approved_by/at, returned_reason, return_kind, payment_info (treasurer-only), paid_at/by, receipt waiver (requested/by/at).
- payment_request_attachments (2616): base64 image_data, append-only. payment_request_events (2635): append-only audit trail.
Lifecycle: draft → submit (receipt or waiver request) → routed to committee Chair/Elder Liaison (`src/lib/reimbursement/routing.ts`) → approved or returned (needs_info allows resubmit; denied ends) → treasurer marks paid with payment_info; payer ≠ approver enforced; waiver must be confirmed before pay; void possible; every transition writes an event row.

## presby
a. Permission catalog: `permissions` (key, module, description, sensitivity_tier) `src/lib/db/domain/authz.ts:36`; `app_role_permissions` :81. Org keys seeded only by hand-written migrations (0032/0036/0038/0040/0048/0051/0052/0054). `baselineRoleSeedPlan()` `src/lib/org-provisioning.ts:239-266` gives `member` → directory.view, events.view. Latest example: 0054 §5 (190-196) insert permissions on conflict do nothing; §6 (208-212) binds events.view to every org-owned member role; event_types.manage no default binding.
b. `ORG_FEATURE_CATALOG` `src/lib/org-features.ts:58-104` `{key,name,description,category,flag,provisionedOn}`; calendar entry 96-103 flag null, provisionedOn true, category worship; missing toggle row = off (DECISION-097); 0054 §7 inserts enabled rows for every org; createOrganization does likewise. Order: platform flag → org toggle → permission. Tiles `src/lib/org-portal/tiles.ts` (PortalDomain 113-120 includes "giving" = Giving & Finance); giving tile 392-400 `flagKey: "org_portal.giving"`, operate, comingSoon, placeholder block (flags seeded ON in dev only). `visible-tiles.ts` filter. Giving page `src/app/(org)/o/[slug]/admin/giving/page.tsx` reads no data. Icon `HandCoins` `tile-icons.tsx:46,95`.
c. Only encryption helper: `src/lib/two-factor.ts:13-60` AES-256-GCM, `encryptSecret`/`decryptSecret`, key `AUTH_TOTP_ENCRYPTION_KEY` (32 bytes). No per-org credential storage. Platform secrets read from process.env per module (`src/lib/email/send.ts:5-7` RESEND_*, `src/lib/turnstile.ts:18`, `src/lib/auth/config.ts:18`, RESEND_WEBHOOK_SECRET); dev email intercept `src/lib/email/queue.ts:180-203`.
d. DonateLink: `presby-site-kit/src/components/DonateLink.tsx` one external `<a data-block="donate-link" target=_blank>`; `renderDonateLinkBlock` `blocks.tsx:337-345`, registered `donateLink` (437). Nothing in presby src refers to it.
e. Webhook pattern: `src/app/api/webhooks/resend/route.ts` — runtime nodejs, force-dynamic; secret unset → 200 {received:false}; missing headers/bad sig → 400; `req.text()` raw body; DB error → 500; signature is the only auth (proxy lets /api/* through); no audit row. Verifier `verify-signature.ts:26` (Svix-style, timingSafeEqual). Audit: `AUDIT_ACTIONS` `src/lib/audit.ts:12` (existing values frozen); `recordAudit(input)` :388 {action, actor, resourceType, resourceId, metadata}.
f. `households.is_giving_unit` `src/lib/db/domain/people.ts:190` bool default true (SASR "potential giving units"). `organization_settings` `src/lib/db/domain/org.ts:116-160`: organization_id pk, settings jsonb, require_two_factor, time_zone (CHECK valid zone), updated_at; most orgs have no row.
g. ui-standards.md headings: Page Layout; Colour and Tokens; Type Scale; Page Header & Typography; Action Bar; Back Navigation; Toast Notifications; Forms: State Patterns; Forms: Unsaved Changes Guard; Component Rules; Select & Combobox Patterns; Loading & Error States; Four-State Component Design; Empty States; Accessibility; CLAUDE.md Invariants; Pre-merge UX Audit Checklist.

---

# Phase 1 — Functional Refinement (analyst)

*(Recorded verbatim from the analyst's return, 2026-10-15. Read-only agent; the orchestrator wrote it in.)*

## VERDICT

**READY WITH NOTES.** The operator's rulings are concrete enough to design against. Nothing needs to go back to the user before Phase 2.

Four items are structural findings that Phase 2 or 3 must resolve in the design:
- **G1:** nobody can ever be granted a tier-2 giving permission.
- **G28:** the unconfigured-webhook response.
- **G27:** the platform Stripe key is a wildcard credential.
- **G11:** statements go stale after they are issued.

The operator-only questions (listed under Open Questions) gate specific batches, not Phase 2. Gate points are marked in the batch order.

## ONE-LINE TAKE

> A congregation's treasurer connects the congregation's own Stripe account, donors give once or monthly through a sealed, hosted-Checkout flow, offline gifts are recorded by a dedicated recorder role, and every donor gets a year-end Pub 1771 statement. The hard problems are who can ever hold tier-2 giving access, what happens to an issued statement when money later reverses, and keeping per-member giving away from the presbytery and the platform operator.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous donor (public site) | opens the congregation's give page; chooses amount (preset or other), fund, once or monthly; ticks or leaves unticked "cover the processing fee"; chooses card or bank (only asked when covering fees); clicks Give | per gift |
| Anonymous donor | pays on Stripe-hosted Checkout (card, ACH, wallet); returns to the thank-you page; reads the Stripe receipt | per gift |
| Anonymous donor | stops or changes a monthly gift (via a Stripe-hosted link or by contacting the church; see G18) | rare |
| Newly-authenticated, no roles (`/access-pending`) | none. Has no giving surface and gives as an anonymous donor on the public site | n/a |
| Authenticated member | opens the Giving tile; clicks "Give online"; reads own gift history; downloads own statements | per session / annually |
| Treasurer | connects Stripe (starts onboarding, resumes, reads status, disconnects) | one-time / rare |
| Treasurer | manages funds (create, set restriction class, mark offered-online, retire) | occasional |
| Treasurer | reads all gifts, donors, reversals, failed gifts; reads settlements/payouts; exports gifts as CSV (open question) | weekly |
| Treasurer | previews and issues year-end statements; sends by email or prints; re-issues a corrected statement; reviews undeliverable and stale statements | annually (January) |
| Treasurer / giving recorder | records an offline gift (cash, cheque, stock): picks or creates the donor, fund, date, method, amount | weekly |
| Treasurer / giving recorder | confirms or rejects a proposed donor-to-person link; voids a mis-keyed offline gift with a reason | occasional |
| Org feature admin (`org_features.manage`) | turns the Giving toggle on or off | one-time |
| Platform operator | sets Stripe platform credentials (environment, not UI); reads webhook health (counts, last-seen, backlog, dead letters); replays a failed event | one-time / on incident |
| Presbytery / synod | none. Sees nothing per-member, by invariant | n/a |

## Flows

**Flow 1 — Connect Stripe (treasurer):**
- Entry: `/o/<slug>/admin/giving`, toggle ON, no connection.
- Steps:
  1. "Connect Stripe" shows a plain disclosure: the congregation owns the Stripe account, pays Stripe's fees, bears disputes, and presby charges nothing. It also says the person who completes onboarding becomes Stripe's named representative.
  2. The server creates the connected account and a single-use onboarding link, then redirects to Stripe.
  3. Stripe returns to a presby return URL.
  4. The page ignores the URL as proof and reads status from the provider and the `account.updated` webhook. The states are: not started, details due, pending verification, active (charges and payouts enabled), restricted, disconnected.
- Success: "Active" appears and "Go live" is enabled. Go-live also requires at least one online fund and automatic payouts.
- Failure:
  - Abandoned or expired onboarding link: "Continue setup" mints a fresh link.
  - Stripe unreachable: "We couldn't reach Stripe. Nothing was changed. Try again in a few minutes."
  - Account rejected or restricted: show Stripe's reason, with a link to Stripe to fix it.
  - Platform keys unset: "Online giving isn't enabled on this installation." This is not a stack trace and not a dead button.

**Flow 2 — Disconnect or deauthorize:**
- Entry: the treasurer clicks Disconnect, or Stripe sends `account.application.deauthorized`.
- Steps:
  1. Before a presby-initiated disconnect, a dialog (no native confirm) states how many monthly gifts are still active in Stripe and that they keep charging until cancelled there.
  2. The connection is marked disconnected and the public give page shows "online giving unavailable".
  3. History and statements are untouched.
  4. Webhook ingest keeps running for that account (see G22).
- Failure: if the toggle is turned OFF with an active connection, the same warning shows. The toggle hides surfaces and never stops ingest.

**Flow 3 — Anonymous one-time gift:**
- Entry: `/site/<slug>/give`, or a `giving` live slot on a site page.
- Steps:
  1. Amount, fund, frequency, cover-fees (default unchecked), then Give.
  2. A server action validates everything server-side and creates a Checkout Session on the connected account.
  3. The donor leaves for Stripe and pays.
  4. The return page shows the gift state read from presby's own database, not the query string. If the webhook has not landed yet, it shows "We've received your gift and are confirming it".
- Success: a thank-you shows amount and fund only, with no name or email. It says the Stripe receipt was emailed, a year-end statement will follow in January, and how to contact the church.
- Failure:
  - Session creation fails: "We couldn't start your gift. You haven't been charged. Try again, or contact <church>."
  - Donor cancels on Stripe: returns to the give page with nothing stored.
  - Connection inactive: the give page shows "Online giving isn't available right now" plus the church contact.

**Flow 4 — Monthly gift:**
- Same as Flow 3 with subscription mode. Each paid invoice becomes its own gift.
- Success: the return page names the monthly amount and says how to stop or change it (G18).
- Failure: a failed recurring charge becomes a failed gift visible to the treasurer. Whether Stripe notifies the donor must be verified in Phase 3.

**Flow 5 — Donor covers fees:**
- Entry: the cover-fees box is ticked.
- Steps:
  1. The form asks card or bank, because the fee differs.
  2. The server computes the gross-up from rates stored on the connection. The browser never sends a total.
  3. The donor sees the gift amount, the fee amount, and the total before leaving.
- Success: the gift records the total charged, of which the donor-covered amount is stored separately (G12).

**Flow 6 — Async bank (ACH) gift:**
- Steps: the gift is recorded `pending` on the Checkout completion event. It becomes `succeeded` or `failed` on the later events.
- Success: the donor was told "bank transfers take several days to confirm".
- Failure: a failed gift appears in the treasurer's "needs attention" list with the donor's contact.

**Flow 7 — Webhook ingest (system):**
- Entry: `POST /api/webhooks/stripe`.
- Steps:
  1. Verify the signature over the raw body.
  2. Insert into the inbox (unique per connection and event id).
  3. Return 2xx.
  4. Process from the queue through a SECURITY DEFINER ingest function that derives the org from the connection row.
- Success: gift, reversal, settlement, or connection-status rows are written.
- Failure:
  - Bad signature: 400.
  - Secret unset: 503, so Stripe retries. This deliberately differs from the Resend precedent (G28).
  - Unknown account: the same response as a known one, and nothing written.
  - Out-of-order event (a refund before its gift): parked and retried, never dropped.
  - Repeated processing failure: a dead letter, visible on the platform health page.

**Flow 8 — Record an offline gift:**
- Entry: `/o/<slug>/admin/giving/gifts/new`.
- Steps:
  1. Pick a donor by typing. Near-duplicate names are suggested. Or "New donor" (name; optional address and email), or "Unidentified (plate offering)", which can never receive a statement.
  2. Fund, date, method (cash, cheque with optional number, stock with description and quantity), amount.
  3. The form states "Record only the deductible amount. Dinners, raffles, and purchases are not gifts."
- Success: the gift appears in the list with `recorded_by`.
- Failure:
  - A future date, a zero or negative amount, or a retired fund is rejected inline.
  - A possible duplicate (same donor, date, amount, cheque number) warns and does not hard-block.
  - Voiding a gift needs a reason. It writes a reversal row and never edits the gift.

**Flow 9 — Donor to person link:**
- Steps:
  1. Someone with `giving.record` sees a proposed match ("Looks like <member>, same email") on the donor.
  2. They confirm or dismiss it.
  3. A confirmed link makes that gift history visible to that member and to no one else (G3).
  4. A link can be removed.
- Rules:
  - Shared emails (`person_identifiers.is_shared`) never produce a proposal.
  - Proposals honor `directory_hidden` and `hide_email` (G24).
  - Every link and unlink is audited.

**Flow 10 — Refund or dispute (from the Stripe Dashboard):**
- Steps: the treasurer refunds in Stripe. `charge.refunded` or `charge.dispute.*` arrives. A reversal row is appended and the gift shows "Refunded" or "Disputed".
- Success: the gift list shows net of reversals.
- Failure: if the original gift's year has an issued statement, that statement is flagged stale (Flow 11).

**Flow 11 — Year-end statements:**
- Entry: `/o/<slug>/admin/giving/statements`, year picker defaulting to last calendar year.
- Steps:
  1. Generate a draft for every donor with at least one succeeded live-mode gift in the year. Gift year uses the org's time zone.
  2. An exceptions panel lists: pending gifts excluded, donors with no email and no address, non-cash gifts, unidentified plate cash (no statement), and stale statements.
  3. Review a sample, then Issue. Issuing freezes the document (text snapshot and stored file) and records the date, the delivery address, and the issuer.
  4. Deliver by email (queued, bounce shown) or print batch.
- Late changes:
  - A later reversal, a late success of a pending gift, or a late-dated offline gift into an issued year does not alter the issued statement.
  - It marks the statement stale in a "needs correction" list.
  - "Re-issue" creates version n+1, titled "Corrected statement, replaces statement dated X".
  - The original is retained and marked superseded, never deleted.
- Failure: an email bounce moves the donor to the print list. Generation errors name the donor and the reason.

**Flow 12 — Member sees own giving:**
- Entry: the Giving tile, then "Your giving".
- Steps: a list of the member's linked gifts (date, fund, amount, status) and their statements for download.
- Empty state: "No gifts are linked to you yet. Gifts you give while signed in, or that your church office links to you, will appear here."
- Failure: a database error says "We can't load your giving history right now", not an empty list, which would read as lost money.

**Flow 13 — Platform operator health:**
- Entry: a platform-palette page under `/admin`.
- Steps: counts, last-event-seen, backlog age, and dead letters per connection. Replay is available for a dead letter.
- Rules:
  - No donor names, amounts, or payload bodies appear.
  - Replay is audited.

## Permissions & Flags

- **Permission(s):** new tenant-catalog keys (never `src/lib/permissions.ts`), all `sensitivity_tier = 2`. Names are for Phase 3 to fix:
  - `giving.view` (read all gifts, donors, reversals, settlements; CSV export if approved).
  - `giving.record` (create donors, record and void offline gifts, confirm links).
  - `giving.manage` (Stripe connection, funds, statements issue and re-issue, fee-rate settings).
  - Separating view, record, and manage is deliberate. The recorder's job is counting. Statements, Stripe, and lifetime totals are not.
  - Member self-view needs no catalog key. It is identity-based through a confirmed link, scoped to the viewer's own membership. Household membership is never a basis (G3).
- **DECISION-078 test, run per office and role:**

| Office or role | Verdict |
|---|---|
| `treasurer` | Passes for `giving.view/record/manage`. Receiving and reporting funds is the constitutional job (G-3.0205 is already cited in DECISION-080). |
| Giving recorder | A new custom, unprotected role carrying only `giving.record` (`support_contact` shape: no PC(USA) office exists). |
| `stated_clerk` | Fails. Register-keeping, not money. Already carries accreted permissions. |
| `session_member` | Fails. A collective body, and it would put every member's giving in front of every elder. |
| `installed_pastor` | Fails. No default. Many polities bar pastors from individual giving data. |
| `founding_administrator` | Fails. Tier 2 must not ride on the person who administers the site. |

- **Default roles:**
  - `treasurer` as a new template role (`organization_id IS NULL`, congregation scope), adoptable through the existing `/admin/roles/new` flow, binding all three keys.
  - `giving_recorder` as a template role binding `giving.record`.
  - No default binding to any other role.
  - Today `treasurer` exists only as a dev-fixture per-org row. It is bound to `ledger.approve` and no `drizzle/` migration seeds it, so a production org has no treasurer role. Phase 3 must reconcile the fixture and the new template (key collision on adopt).
- **Flag(s):** none new (operator rule: no new platform flags before go-live).
  - A toggle-only `ORG_FEATURE_CATALOG` entry in DECISION-160 shape: `flag: null`, with a new key such as `org_portal.giving`.
  - Provisioned OFF for existing orgs and for new orgs (`provisionedOn: false`; a missing row is off). Unlike the calendar, a Giving tile with nothing behind it is noise to every member. Turning it on is also a deliberate data-handling decision (donor PII, a Stripe relationship) that the congregation should make. The open question lists this for confirmation.
  - Gate order for every giving surface: org toggle, then permission (or link, for self-view). The public give page checks: toggle ON, connection active, at least one online fund.
  - The existing platform flag `org_portal.giving` (seeded ON in production per STATE.md, gating the inert placeholder) is retired in favor of the toggle. The tile and page switch from `flagKey` to `orgFeatureKey`.
  - Category: `giving` (PortalDomain). Per the DECISION-160 pattern, member surface (give, history, statements) goes in the operate tiles and authoring (funds, connection, gifts, statements) on the admin hub.
- **Org-type scope:** the tile is universal today. Recommend congregation (and possibly new worshiping communities) only in v1. Presbytery and synod giving is not requested and raises the parent-council question (G5).

## Gaps the Request Didn't Address

### Authorization and bootstrap

- **G1. No one can ever be granted giving permissions.** This is the most important finding.
  - `assertPermissionSubset` refuses to grant or adopt any key the actor does not hold. `adoptTemplate` checks the full proposed set.
  - `foundingAdministratorPlan` binds `people.manage`, `roles.manage`, `role_grants.manage`, `groups.manage`, `officers.manage`, `org_features.manage`, `tickets.file`, `staff.manage`. No giving key is among them.
  - So a template `treasurer` role can be created but never adopted or granted by anyone. This is the same ceiling shape as F111/F118.
  - Recommended resolution, for the architect to rule on: a platform-assisted "designate treasurer" step modeled on DECISION-155. It is platform to one org, uses the owner connection, writes provenance and an audit row, adds no platform predicate to any authority check, and leaves the resolver and the subset check unchanged.
  - Explicitly forbidden: deriving a giving grant from an `officer_terms` row. `officers.manage` is held by the founding admin, so that path would let a non-tier-2 holder cause a tier-2 grant, bypassing the subset rule.
- **G2. Escalation and self-grant.**
  - A `role_grants.manage` holder must not be able to give themselves `giving.*`. The subset rule already blocks this once G1 is solved, and a test must pin it.
  - Edit-in-place of an existing role to add `giving.*` is covered by DECISION-106's delta check and needs a regression test.
- **G3. Member self-view needs an explicit rule.**
  - Specified rule: a member sees only gifts on donors with a confirmed link to their own membership. A spouse, parent, or Session member sees nothing by relationship.
  - `person_privacy` directory flags are orthogonal and do not affect giving. A directory-hidden member still sees their own history and still gets statements.
  - A person-merge follows `merged_into_id`, so links migrate. A minor's gifts are the paying adult's.
  - Whether couples get a joint statement is an open question; v1 default is per donor.
- **G4. 2FA expectation.** Giving admin surfaces are under `/o/*`, so the Edge 2FA gate applies, and a mid-enrolment treasurer is pushed to `/totp` and returns through the sanitized `callbackUrl`. Open design question for Phase 2: should holding `giving.manage` or `giving.record` force enrolment regardless of the org setting? The Edge cannot read the database, so this is not a free add.
- **G5. Other org types.** The toggle must be unavailable (or the tile hidden) for types the pipeline does not support, rather than appearing and failing.

### Money and compliance

- **G6. Donee identity for statements is not stored.**
  - Organizations have a display name and a public-site profile (address, phone), but no legal name or EIN. `organization_identifiers` kinds are `pcusa_pin`, `psvonline_congregation_id`, `church360`, `legacy_import`.
  - The statement needs the legal donee name, mailing address, and (by westervillelions precedent) EIN.
  - Phase 2 decides: a new identifier kind, or a giving-settings table.
  - Statements must not be issuable until legal name and address are present.
- **G7. The "no goods or services" assertion must be true for every line.**
  - Pub 1771's wording is a legal statement. The westerville quid-pro-quo type is out of scope, so the recorder form and the online form must make "pure contribution only" explicit. Events, dinners, and raffles cannot become gifts.
  - Wording is generated in code, never in an editable template (westerville precedent). Only greeting, closing, and signature are editable.
  - Likely wording: "no goods or services other than intangible religious benefits." CPA to confirm.
- **G8. Stock and other non-cash gifts.** The IRS acknowledgment describes the property and omits the value, which the donor determines. The statement therefore needs a non-cash line shape. Cash totals must not include stock.
- **G9. Gift date and the year boundary.**
  - Year is computed in `organization_settings.time_zone`, never UTC. A Dec 31 11 pm ET gift is Jan 1 in UTC.
  - An ACH initiated Dec 30 and settled Jan 3 needs a rule (recommend the date the donor authorized it; CPA to confirm).
  - Test-mode gifts are excluded from every statement and total (G14).
- **G10. Fee coverage accounting.** The operator's assumption stands (donor-covered fee is part of the contribution). Store the covered amount in its own column so the statement policy is one constant. That keeps the choice reversible if the CPA rules differently.
- **G11. Statements go stale.** An ACH can fail or be disputed after January. Pending gifts at generation time are excluded and listed. Any later change to a year with an issued statement raises a stale flag and a "needs correction" queue, and the answer is a corrected version, never an edit. Late-dated offline gifts into an issued year behave the same. Which year a refund or return in a later year is attributed to is a CPA question; recommended default is the original gift's year plus a corrected statement.
- **G12. Statement audience and deliverability.**
  - Unidentified plate cash never gets a statement.
  - Donors without email or address go to an "undeliverable" list rather than silently skipping.
  - The delivery address is snapshotted on the issued artifact.
  - An edit to a donor's email or address after issue is audited, so a statement cannot be quietly redirected.
- **G13. Retention.**
  - Issued statements are kept at least seven years (the westerville default) and are never hard-deleted.
  - Donors are merged, never deleted.
  - Raw provider bodies are PII and need a shorter, explicit purge window (open question).
  - A donor's erasure request is answered with the retention obligation, in the privacy copy.
- **G14. Test mode versus live.** A connection carries a mode. Events whose `livemode` does not match are ignored. A test-mode connection shows a visible "Test mode" badge on every admin screen, and its gifts never reach totals or statements. Without this, a treasurer's Stripe test payments pollute year-end numbers.
- **G15. Disclosures.**
  - Connect copy states: the congregation bears Stripe fees and disputes, presby charges no fee, presby gives no tax advice, and statements are generated from the congregation's records.
  - The Stripe statement descriptor must show the congregation's name. A "what is this charge?" mystery is a dispute generator.

### Donor-facing

- **G16. Where the give surface lives.**
  - Recommend a presby-owned `/site/<slug>/give` route that always exists when giving is live, so a congregation with no site editor still has a page.
  - Also offer a `giving` live slot through site-kit's existing `liveSlots` resolver. That needs no site-kit change, so a site author can embed it on any page and AI skinning cannot touch it.
  - The existing external `donateLink` block is unaffected (FPCW keeps using its external Vanco link).
- **G17. Recurring management is a real hole.** A monthly gift with no stop path is a reputation and consumer-protection problem. Minimum for v1:
  - The return page and the Stripe receipt explain how to stop or change it, using the Stripe portal login link if Phase 3 confirms it works for direct-charge customers. Otherwise the page shows the church contact.
  - The treasurer sees active schedules read-only.
  - Amount changes mean cancel plus a new gift (the spike's finding that the portal cannot edit custom inline prices).
- **G18. Receipt versus statement.** The Stripe receipt is a payment receipt, not the IRS acknowledgment. The return page must not call it one. Whether presby sends its own per-gift email or relies on Stripe's is an open question.
- **G19. Form hygiene.**
  - Server-validated bounds. Recommend a fixed $1 to $25,000 range in v1, USD only.
  - Fee-cover defaults to unchecked.
  - The give form is a `useForm` root, so it needs `<HydrationGate>` (DECISION-159). It is a money form, so a pre-hydration overwrite is worse here than anywhere.
  - Must work at 360 px.
  - Double-submit idempotency key per form instance.
- **G20. Signed-in member giving.** A member who gives while signed in could auto-link the donor to their membership, because presby authenticated them. This removes most of the manual link work for online gifts but changes the spike's "propose-only" ruling. Operator to decide.

### Treasurer-facing

- **G21. Fee rates.** Rates live on the connection (spike). Who maintains them is unspecified: the platform default populated at connect, and treasurer-editable only if the congregation holds the nonprofit discount.
- **G22. Connect lifecycle.**
  - The onboarding return URL is not proof of completion (status comes from the provider).
  - Onboarding links expire and are single-use.
  - The person who onboards becomes Stripe's named representative. Volunteer turnover is the congregation's risk. Add one sentence of guidance.
  - Disconnect with active subscriptions and a toggle-OFF with active subscriptions both need the warning in Flow 2. Ingest must never depend on the toggle, or recurring gifts silently stop being recorded.
- **G23. Funds.**
  - A brand-new install has zero funds. Seed one unrestricted "General Fund" when the toggle goes ON, otherwise the give page is empty.
  - A fund has a restriction class (unrestricted, temporarily restricted, permanently restricted), an active or retired state, and an offered-online flag (default off).
  - A fund with gifts can be retired but never deleted.
  - A retired fund still receives in-flight gifts.
  - Fund names offered online are public. Do not default restricted or discretionary fund names to public.
- **G24. Offline recording.**
  - Search for an existing donor before creating one, to prevent duplicates.
  - One person counting cash is a real control weakness (churches use two counters). Accept for v1 with `recorded_by` visible, and name dual-count as a follow-up.
  - Proposal logic must not leak directory-hidden members (honor `directory_hidden` and `hide_email`).
  - Hidden members can still be linked manually.
- **G25. Export.** The ledger is a later pipeline, so a treasurer's books live elsewhere in the meantime. A CSV export of gifts is a small, high-value bridge. It is also a bulk tier-2 exposure, so it is audited. Operator to decide.
- **G26. Settlements and payouts.** Reconciliation works only for automatic payouts. Read-only, last in the build order, and droppable without harming the rest.

### Operator and platform

- **G27. The platform secret key is a wildcard credential.**
  - With Connect, the platform's Stripe key can read every connected congregation's customers and charges. "Platform admin is not above a congregation" holds in presby's database but not at Stripe.
  - Required:
    - The key lives only in the production environment.
    - Presby code never fetches donor PII from Stripe beyond what webhooks deliver.
    - API responses are never logged.
    - There is a rotation procedure in `docs/deployment.md`.
    - The privacy copy discloses the platform's technical reach.
- **G28. Webhook semantics for money.**
  - The Resend precedent returns 200 `{received:false}` when its secret is unset. For Stripe that would mean "delivered" while nothing is recorded, and Stripe would not retry. An unset secret must return 503.
  - The inbox stores raw bodies containing names, emails, and addresses. Under the platform connection (`neondb_owner`, which bypasses RLS) the bodies must be unreadable to any platform page. Either tenant-RLS the inbox or never select the body column from `getPlatformDb()`. A platform-admin page reading donor data would violate the invariant in practice even if it is "paper" in code.
  - Out-of-order and duplicate events (spike D).
  - `account` is validated against the connection.
  - `metadata.fund_id` is validated as belonging to that connection's org before writing, so a crafted event cannot post a gift into another org's fund.
- **G29. Testability.**
  - QA cannot drive Stripe-hosted Checkout. Phase 5 for this feature means signed synthetic events replayed against the real route against a seeded DB, plus a documented operator smoke in Stripe test mode. The operator must have a test-mode platform account with Connect enabled before Batch 3 can be verified. This is a prerequisite.
  - Fixtures use invented names and `example.invalid` addresses. Placeholder keys must use obviously fake strings, and `check:secrets` should be run early since it matches key shapes.
- **G30. CSP.** The current policy is report-only and has `form-action 'self'`. Checkout must be reached by a server-action redirect, not a native form POST to Stripe. No Stripe.js or iframe loads on presby pages. That is what keeps this SAQ-A, and the architect should record it.
- **G31. Audit story** (Rule 7). Proposed new `AUDIT_ACTIONS` keys; the names are Phase 3's.
  - Connection: created, status changed, disconnected or deauthorized.
  - Funds: created, updated, retired.
  - Gifts: offline recorded, voided.
  - Donors: created, merged, contact changed, link confirmed or removed.
  - Statements: issued, re-issued, sent, bulk downloaded.
  - Other: CSV exported, toggle changed, role-bound permission changes, webhook replay.
  - System-actor reversal rows (refund, dispute) and deauthorization from the webhook are also audited, because `check:audit` does not scan route handlers. QA must read the webhook by hand.

### Presbytery invariant: how it is tested

Tests live in `scripts/test-rls.sql`, run as `presby_app`, plus Vitest:
1. With a presbytery person's context set, `select` on every `giving_*` table returns zero rows for a member congregation's data, even when the presbytery has `giving.view` for its own org.
2. No giving table carries `about_org_id`. No giving policy or function calls `presby_org_affiliated`, `presby_transfer_affiliation`, or any publication function.
3. No giving table is reachable from any existing cross-council function (`presby_list_published_returns_to_me`, the SASR publish chain). The pipeline publishes nothing.
4. The ingest function accepts an event only for the org derived from its own connection row. A test posts an event whose metadata names another org's fund and expects rejection.
5. `getPlatformDb()` is not imported by any file under `src/lib/giving/` except the platform health read, and that read selects counts and timestamps only. This is a static test and `check:brand-scope`-style grep.
6. A platform admin session that is not a member of the org gets the four-way miss response on every `/o/<slug>/admin/giving/*` URL.
7. The inbox body column is covered by the same negative tests (G28).

### Adversarial pass (Pass 5)

| Vector | Finding | Status |
|---|---|---|
| Redirect targets | Checkout success and cancel URLs must be built server-side from the site's known hostnames (including custom domains), never from the request `Host` or any client field. | Gap. Must be specified. |
| Amount and fee tampering | Client sends amount and a boolean. The server computes cents and the gross-up. Reject decimals with more than 2 places, negatives, exponents, and Unicode digits. | Gap, design states it. |
| Cross-org fund | `org` comes only from the slug, never the client. The fund must belong to that org, be active, and be offered online, checked at session creation and again at the webhook. | Gap. |
| State-machine shortcuts | The return page must not mark a gift paid from the URL. A `session_id` alone must not reveal donor PII. | Gap. |
| Card testing and abuse | The anonymous endpoint creates sessions on the congregation's account. Needs rate limit per site and IP, the existing honeypot, and Turnstile (the repo already has it). Note the contact-form limiter is in-memory unless Upstash is set. | Gap. |
| Enumeration | "Manage my recurring gift" by email must respond identically for known and unknown emails. The give page must not prefill or reveal previous donors. Webhook responses are uniform for unknown accounts. Statement and download URLs for other donors return the same denial as nonexistent ones. | Gap. |
| Webhook forgery and replay | Signature over the raw body, 5-minute tolerance, inbox uniqueness. | Addressed by the spike, plus G28. |
| Account-takeover-by-link | A wrong donor-to-person link would show a stranger's gifts to a member. The confirm step shows the person's name. Statements go to the donor's email, not the person's. Links are removable and audited. | Partly addressed. |
| Self-targeting | A recorder voiding their own entry is allowed but the audit shows recorded_by and voided_by. A `giving.manage` holder cannot grant themselves anything new (G2). | Addressed once G1 is solved. |
| Input boundaries | Donor name from Stripe is untrusted text of unbounded length. Escape in admin UI and statement composition (no template injection into "Dear {{donorName}}"). | Gap. |
| Open redirect on connect return | The return and refresh URLs are fixed paths. The `?next` convention goes through the existing sanitizer. | Gap. |
| Server-side validation | All of the above is server-side. The UI is advisory. | Design must state it. |

## Out of Scope (confirm with user)

- General ledger, chart of accounts, budgets, bank reconciliation (later pipelines). Gifts are the truth and the schema must not preclude a later ledger link. Do not add a speculative `ledger_transaction_id` column now.
- The reimbursement treasury half (Track E5).
- A Vanco adapter or a `vanco` enum value. The provider-neutral interface is designed and only Stripe is implemented.
- Pledges and campaigns (`giving_pledges`).
- Recurring-gift management inside presby beyond the Stripe-hosted portal or church contact.
- Refunds initiated from presby (Stripe Dashboard only).
- Split gifts (one fund per gift).
- Envelope numbers.
- Quid-pro-quo gifts, event or ticket purchases, and any gift with a benefit (G7).
- Donor accounts or a donor portal for non-members.
- Presbytery or synod giving, and per-capita payments through Stripe.
- Terminal or in-person card readers, kiosk giving (`white-binder`), text-to-give.
- Matching gifts, tribute or memorial gifts, multi-currency.
- Dispute evidence handling.
- Connecting an existing Stripe account (OAuth).
- Dual-count cash controls.
- Automatic reconciliation of payouts to bank lines.

## Open Questions

Operator-only. Gating notes in brackets.

1. Which legal entity owns the Stripe Connect platform account, and can a test-mode platform account with Connect enabled exist before Batch 3? [gates Batch 3 smoke and Batch 4]
2. May a platform-assisted "designate treasurer" step (DECISION-155 style) bootstrap the first holder of `giving.manage` at each congregation? [gates Batch 1]
3. Should the Giving toggle be OFF for every existing and new org (the recommendation)?
4. Congregations only in v1, or also new worshiping communities and presbyteries?
5. One statement per donor, or one per household giving unit?
6. Will the CPA review the statement wording and rule on four things before any real statement is issued: fee-cover as contribution, the ACH gift date, the year a later-year refund is attributed to, and the stock-gift line? [gates Batch 5 enablement]
7. Does presby send its own per-gift email, or rely on Stripe's receipt?
8. May we require automatic payouts only?
9. What are the retention periods: statements (recommend 7 years) and raw provider bodies (recommend a short purge window)?
10. Should a signed-in member's online gift auto-link to their membership (G20)?
11. Include CSV export of gifts in v1 (G25)?
12. Are fixed gift bounds of $1 to $25,000 acceptable for v1, or must the treasurer set them?
13. Does the platform provide a `/site/<slug>/give` page automatically, or only the embeddable slot (G16)?
14. Does any real congregation have 2026 gifts presby must issue statements for, or is the first real statement run January 2028? (FPCW keeps issuing the cutover year from Church360/Vanco.)

## Recommended Phase 4 batch order (input to Phase 3)

Each batch is shippable with the org toggle OFF, and OFF means invisible. Risk-first: permissions before money, ingest before donor-facing checkout, the compliance artifact before the member view.

1. **Foundation** (database-admin, `drizzle/0055`). Tables with composite tenant keys and FORCE RLS: funds, donors, identities, gifts, reversals, connections, inbox, settlements, statements. Also the `giving.*` keys, the `treasurer` and `giving_recorder` template roles, the toggle catalog entry plus provisioning, and the G1 bootstrap. The presbytery and cross-org tests and the platform-read negative tests land here. Gate: Operator Q2. Visible result: none.
2. **Funds, offline recording, gift list, donors** (full-stack). Replace the placeholder page. Works with no Stripe at all and is useful on its own. Includes empty states, audit, duplicate handling, void, link confirmation, optional CSV, 360 px. This de-risks the whole permission model with low blast radius.
3. **Provider core and Stripe adapter** (api-developer). Signature verification, inbox, SECURITY DEFINER ingest, normalizer, reversal and settlement materialization, connection onboarding and status UI, the platform health page. Verified by signed-event replay and the operator test-mode smoke. No donor-facing surface yet, so no real money can arrive. Gate: Operator Q1.
4. **Public giving** (ux-developer plus api-developer). The sealed give route and slot, session creation, fee gross-up, recurring, return page, abuse controls, HydrationGate, failure microcopy. Money first moves here, so the connection starts in test mode and goes live per congregation by an explicit go-live step.
5. **Statements** (full-stack). Generate, exceptions, issue, deliver, stale flag, corrected re-issue, retention. Depends on gifts from Batches 2 and 3, and offline-only statements work from Batch 2. This batch can move ahead of Batch 4 if a real congregation needs statements first. Hard gate: Operator Q6 before enabling for any real congregation.
6. **Member surface and settlements** (ux-developer). Own history, own statements, the "Give online" entry from the tile, and the read-only settlements and payouts view. Droppable last item: settlements.

Then QA (the signed-event harness plus a phone-viewport browser pass on the give page and admin pages) and Phase 6.

## Handoff

Next agent: **architect (Phase 2)**. The architect should preserve all 31 gaps (G1 to G31) and the adversarial table in the work-log. It should adopt, amend, or reject each of the spike's rulings A to G and rule on these before Phase 3: **G1** (bootstrap mechanism), **G6** (where the donee's legal name and EIN live), **G28** (tenant-RLS versus never-select for the inbox body), **G30** (redirect-only CSP stance), **G4** (whether 2FA enrolment is forced for `giving.*` holders).

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-10-15. The architect read the files below and ran read-only catalog queries (`begin transaction read only … rollback`) against `development`, the branch the main checkout's `.env.local` points at. No pipeline Neon branch exists yet. The queries ran as the owner connection. Nothing was written. To confirm the Stripe SDK's pinned API version, `stripe@23.0.0` was unpacked into the session scratchpad, outside the repo.*

*Architect's cover note: the review found one gap Phase 1 didn't, **F138**, which R3 resolves — the `treasurer` designation alone does not let anyone grant `giving_recorder` or hand the treasurer role to a successor (`adoptTemplate()` needs `roles.manage`, `grantRole()` needs `role_grants.manage`, each also requiring the actor to hold every delegated key; after the designation the founding administrator holds the role keys and the treasurer the giving keys, and nobody holds both). R3 adds a narrow, audited grant path for giving-only roles, gated on `giving.manage`. Also for the operator: DECISION-028 is amended so the Stripe webhook returns 503 when its secret is unset; `stripe` 23.0.0 is adopted and `pdfkit` 0.20.2 is named but installed only when Batch 5 starts; statement contents never enter `email_queue` — the email is a notice with no amounts, signed-in members download from the portal, and for account-less donors Phase 3 chooses a token download link or print-only in v1 (no real run before January 2028).*

## Verdict

**Approved with suggestions.**

The rulings below settle every open point, and the operator's rulings and the orchestrator's defaults are honoured as written.

One gap Phase 1 did not see, **F138**, is resolved here by ruling R3; it changes no user verb. The binding items (R1–R15) are what Phase 3 must design to. The suggestions (S1–S5) are optional. New decisions: DECISION-168 to DECISION-174. DECISION-175 is left free for Phase 3.

## Placement

**Directory placement**

- **`src/lib/giving/`** is the provider-neutral core. Each module is `server-only` unless it is pure.
  - `funds.ts`, `gifts.ts`, `donors.ts`, `settings.ts`: gated, `withOrgContext()` only.
  - `team.ts`: the giving-role delegation (R3).
  - `statements.ts` (R12).
  - `self.ts`: the member self-read, kept outside every permission-gated module (DECISION-162 self-read conditions, R14).
  - `public.ts`: anonymous reads and intent creation through SECURITY DEFINER functions only (R13).
  - `ingest/process.ts`: the inbox processor (R6).
  - `types.ts`: `NormalizedEvent`.
  - Pure modules with no `server-only`: `money.ts` (parsing and formatting integer cents), `org-date.ts` or reuse of `src/lib/shared/org-time.ts`.
  - **`getPlatformDb()` is imported by no file under `src/lib/giving/`.** A static test pins this.
- **`src/lib/giving/providers/stripe/`**
  - `client.ts`: the **only** file in the repo that imports `stripe` at runtime (R8).
  - `normalize.ts`: pure; type-only imports from `stripe` are allowed.
  - `fees.ts`: pure gross-up math (spike B).
  - `checkout.ts`, `onboarding.ts`.
- **`src/lib/treasurer-designation.ts`** sits beside `founding-administrator.ts`. It is the platform-connection designation (R2). It is deliberately **not** under `src/lib/giving/`, and it writes authz tables only, never a giving table.
- **`src/lib/db/domain/giving.ts`** is one domain file. The single appended export in `domain/index.ts` is added at integration (Rule 16).
- **Migrations:** `drizzle/0055_presby_giving.sql` holds all giving DDL except statements. `drizzle/0056_presby_giving_statements.sql` lands with Batch 5 (R15).
- **Routes**
  - `src/app/api/webhooks/stripe/route.ts`: `runtime = "nodejs"`, `force-dynamic`. No separate verifier file; the SDK verifies, called through `client.ts`.
  - `src/app/api/cron/giving/route.ts`: backlog sweep and body purge, gated on `CRON_SECRET` like `/api/cron/maintenance`, plus one `vercel.json` entry.
  - `(org)` admin under `/o/[slug]/admin/giving/`:
    - overview (connection status, "needs attention");
    - `funds/`, `gifts/` (with `new/` and `[giftId]/`), `donors/` (with `[donorId]/`), `statements/`, `settings/`, `team/`;
    - `connect/return/` and `connect/refresh/` (fixed onboarding return paths);
    - `gifts/export/route.ts` (CSV, `giving.view`, audited inside the handler);
    - each with a co-located `actions.ts`.
  - `(org)` member under `/o/[slug]/giving/`:
    - the history and statements list;
    - `give/` and `give/return/`;
    - `statements/[statementId]/download/route.ts`.
  - Public:
    - `src/app/(public)/site/[slug]/give/page.tsx`, `give/actions.ts`, `give/return/page.tsx`. A static segment beats `[[...path]]`, and the existing brandable layout and the `/site/*` proxy bypass apply unchanged.
    - The `giving` resolver in `[[...path]]/page.tsx`'s `liveSlots` map, closing over `slug` only.
  - `(admin)`:
    - `treasurer-designation-section.tsx` and per-connection ingest health on `/admin/organizations/[id]`;
    - a cross-org health list at `src/app/(admin)/admin/giving/page.tsx`.
    - Both are page-gated on `FEATURES.ADMIN_ORGANIZATIONS` (no new `FEATURES.*` key; `permissions.ts` stays frozen). The Edge's existing `/admin` → `ADMIN_DASHBOARD` rule covers the prefix.
- **Components**
  - `src/components/giving/give-form.tsx` is a new feature folder. Exactly two brandable surfaces use it, the public give page and the member give page, so it does not belong in `shared/` (cross-cutting, platform-palette) or co-located with one route.
  - Everything else is co-located with its route.
- **No `loading.tsx`** on any segment that can redirect or `notFound()`: `/site/[slug]/give`, `give/return`, `/o/[slug]/giving/give/return`, `admin/giving/connect/*`, and the download handlers.

**Server vs Client split**

Server Components by default: every list, history, the statements list, settings display, both return pages (they read presby's own DB state), the connect-return page (it reads provider status server-side, then redirects), and the health pages.

These need `'use client'`:

- **Give form.** It has presets, an "other" amount, a fund picker, frequency, and cover-fees with a card-or-bank choice. Fee and total are displayed from rates passed as props and are display only; the server recomputes. It is a `useForm` root, so it is inside `<HydrationGate>` (DECISION-159). The idempotency key is rendered by the server into the form, not minted client-side.
- **Offline-gift form.** It uses `useForm` with `<HydrationGate>`. The donor typeahead calls a server action.
- **Statements issue dialog.** `AlertDialog` confirm plus progress. No native dialogs.
- **Fund create/edit forms, the team grant form, the settings form.** Each inside `<HydrationGate>`.
- **Disconnect and toggle-off warning dialogs.**
- **Link confirm/dismiss and void buttons.** These are plain `onClick` controls, so per F129 they render disabled until `useHydrated()` reports true.
- **CSV export** is a plain link to a GET route handler, so it stays server-side.

**Dependencies**

- **`stripe` 23.0.0: yes (DECISION-169).**
  - MIT, zero runtime dependencies, Node ≥ 20 (repo ≥ 22), maintained (published 2026-10-14).
  - It pins API version `2026-09-30.endive`, verified in the tarball.
  - It is not already solved by any dependency in `package.json`.
  - Edge: it is never imported by `src/proxy.ts` or anything it reaches. `client.ts` is `server-only` and every importer is Node runtime.
  - Bundle: server-only, so zero client bytes. It adds about 17 MB unpacked to the serverless function, mostly types.
- **`pdfkit`: yes, deferred to Batch 5 (DECISION-174).**
  - 0.20.2, MIT, active, all transitive dependencies MIT (`fontkit`, `linebreak`, `fflate`, `png-js`, `@noble/*`).
  - It is installed in the batch that first imports it, never earlier.
  - It is not in Next's default `serverExternalPackages` list (only `@react-pdf/renderer` is), so Batch 5 adds `serverExternalPackages: ["pdfkit"]` and checks the font data is traced.
- Rejected:
  - `pdf-lib`: unmaintained since 2022.
  - `@react-pdf/renderer`: wraps pdfkit and adds about ten more packages for layout we don't need.
  - Headless Chromium: function size.
- **No other dependency.** No Stripe.js, no `@stripe/*` client packages, no `date-fns`, no CSV library (export is a hand-rolled RFC 4180 writer).

## Invariants Touched

- **Isolation is a database property.**
  - Every giving table has `organization_id NOT NULL`, ENABLE + **FORCE** RLS, and the standard `tenant_isolation` policy (`USING` and `WITH CHECK`).
  - The webhook path has no session. It writes only through SECURITY DEFINER functions that derive the org from the connection row (R6). Nothing calls `set_config` outside `withOrgContext()`, and no "system org context" helper is created.
  - Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148), and `EXECUTE` is granted to `presby_app` alone.
- **Composite tenant keys (F2).** Every giving table has `unique (id, organization_id)`. Every FK between giving tables, and to `memberships` and `blob_assets` (both already carry `(id, organization_id)` unique, checked live), is composite with the default NO ACTION. Not RESTRICT: it can fail the `deletable_until` statement-level cascade (DECISION-161).
- **Two Hierarchies Intersect Nowhere.**
  - The designation (R2) leaves only provenance behind. No platform predicate enters any authority check.
  - `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010` are unchanged. A test pins that, as DECISION-155's did.
  - Giving tables have no `about_org_id`. No giving policy or function calls `presby_org_affiliated`, `presby_transfer_affiliation` or any publication function, and the pipeline publishes nothing.
  - Per-member giving is never visible to a parent council. That is enforced by tenancy and asserted in `scripts/test-rls.sql` (the analyst's seven tests, all adopted).
- **Append-only, like the roll.**
  - Gifts are trigger-frozen. The only updates allowed are the enumerated one-way transitions in R10.
  - Corrections are reversal rows in an insert-only table.
  - Issued statements are frozen, and a correction is version n+1.
  - There is no DELETE grant on any giving table, and a BEFORE DELETE guard (F44: grants don't bind the owner, only triggers do) covers gifts, reversals, donors and statements, with the `deletable_until` exemption.
- **Never hard-delete a person (by analogy).** Donors are never deleted; they merge (`merged_into_id`, composite self-FK, followed like a person merge). Funds are retired, never deleted.
- **No role carries a wildcard / tiers.** `giving.view`, `giving.record` and `giving.manage` are `sensitivity_tier = 2`. The DECISION-078 test is run per office (R3). No default binding to `stated_clerk`, `session_member`, `installed_pastor`, `founding_administrator`, or any group arm.
- **Permissions vs Flags (DECISION-003/097/160).**
  - `org_portal.giving` becomes a toggle-only catalog entry (`flag: null`, `provisionedOn: false`). A missing row stays off.
  - The platform flag row of the same name is retired.
  - Org-type applicability is a static catalog property, not a new axis (R11).
  - `FEATURES.*` is untouched.
- **The Edge gate cannot reach the database.** Unchanged. The 2FA requirement for giving-key holders is computed in Node at the jwt callback by the existing SECURITY DEFINER predicate, which gains an arm (R4). The Edge reads the claim as today. `stripe` never reaches the Edge bundle.
- **The Brand Is a Cascade Override.**
  - Every new surface is inside the two brandable groups (`(org)` and `(public)/site/<slug>`), except the `(admin)` designation and health surfaces, which are platform palette.
  - No new emitter. `check:brand-scope` is unchanged.
  - The statement PDF is a document, not chrome. It may carry the org logo as content (logo-as-content is legal).
  - If the token download route (R12) is built, it is a new un-brandable public group.
- **Verify in a browser / hydration (DECISION-159).** Every new `useForm` root is gated. The give form gets a 360 px phone-viewport pass and an `e2e/hydration/` spec, because a pre-hydration overwrite on a money form is the F116 failure with money attached.
- **The `(org)` contract.** Every page and route handler resolves through `resolveOrgContext()` and reads through `withOrgContext()`. `getPlatformDb()` is absent from the subtree.
- **No Real Data.** Fixtures use invented names and `example.invalid`. No Stripe key shape appears anywhere in the repo; `.env.example` lists the variable names empty. Run `check:secrets` early in Batch 3.
- **DECISION-028 is amended for money-bearing webhooks only** (R6).
- **No CLAUDE.md change is required by this phase.** At integration, the orchestrator may add `(statement-download)` to the route-group list in `.claude/agents/architect.md` and CLAUDE.md, if R12's token route is built.

## Notes

### Live catalog read (`development`, PostgreSQL 18.6, read-only)

- **Organizations:** 15 (9 congregations, 5 presbyteries, 1 synod). **No NWC exists on this branch**, so the NWC half of R11 needs a fixture or unit test.
- `organization_settings`: 15 rows (0054 applied).
- Toggle rows: `org_portal.calendar` 15, `members_create` 1, `sensitive_info` 1. **None for giving.**
- **Flags:** `org_portal.giving` **on**, `auth.require_2fa` on.
- **Permissions:** of the relevant keys, only `ledger.approve` (module `ledger`, tier 2) exists, seeded by `scripts/seed-dev.sql` only. No migration creates it.
- **Templates** (`organization_id is null`): `committee_chair`, `congregation_stated_clerk`, `personnel_admin`, `presbytery_stated_clerk`. **No `treasurer` or `giving_recorder` template exists.**
- **One org-owned `treasurer`** (fixture org `2222…`): `constitutional`, `is_protected = t`, carrying `ledger.approve`.
- **Row security** (`relrowsecurity = t`, `relforcerowsecurity = t`) on `app_roles`, `app_role_permissions`, `role_grants`, `memberships`, `households`, `blob_assets`, `organization_settings`, `organization_feature_toggles`, `organization_profiles`.
- **No RLS** on `permissions`, `email_queue`, `audit_events`, `organization_identifiers`.
- **`presby_app` table privileges:**
  - `blob_assets` SELECT/INSERT only, so issued-file retention holds on the tenant path. The owner path needs the composite FK in R12.
  - `email_queue` full DML, no RLS. This is why R12 keeps statement contents out of it.
  - `permissions` SELECT. `organization_identifiers` SELECT.
  - `app_roles` SIUD, `app_role_permissions` SID, `role_grants` SIUD.
- **Triggers:** only `role_grants_needs_membership` on the authz tables.
- **Functions:**
  - `presby_two_factor_required`, `presby_effective_permissions`, `presby_membership_is_active` and `presby_published_site` are SECURITY DEFINER with `search_path=public, pg_temp`.
  - `presby_has_permission` is invoker.
- **Roles:** `neondb_owner` and `presby_platform` are BYPASSRLS; `presby_platform` cannot log in. `presby_app` is NOBYPASSRLS.
- **Constraints:**
  - `blob_assets_id_org_key` and `memberships_id_org_key` exist. `blob_assets_content_type_allowed` already admits `application/pdf`.
  - No `giving*` or `provider*` relation exists yet.
- **Phase 5 must re-read this catalog on the pipeline branch after 0055/0056 apply,** not `drizzle/`'s text.

### Binding rulings

**R1. The spike (rulings A–G and its structural rulings), adopted with amendments (DECISION-168).**

- **A (Connect, direct charges, congregation-owned account): adopted.**
  - Accounts v2 merchant configuration, Stripe-hosted onboarding, `acct_…` stored and nothing else.
  - One platform endpoint scoped to connected accounts. `livemode` is checked against the connection's mode.
  - OAuth connection of a pre-existing account is deferred.
  - Phase 3 confirms the v2 controller fields against the pinned API version.
- **B (redirect to hosted Checkout): adopted, amended by R7 and R9.**
  - Fund identity in Stripe `metadata` is **correlation only, never authority**. The authority is presby's own intent row (R9).
  - `product_data.name` is the fund's public display name.
- **C (recurring by subscription Checkout): adopted.**
  - Amended: a billing-portal session is created **only** for a signed-in member, for a customer on a donor confirmed-linked to that member. Never from an email lookup, which would be an enumeration and account-takeover path.
  - Anonymous donors use Stripe's own portal login link if Phase 3 confirms it works for direct-charge customers. Otherwise they use the church contact (G17).
- **D (one gift = one succeeded PaymentIntent): adopted.**
  - Fee and net come from the balance transaction: from `charge.updated` when it arrives, otherwise one allowlisted retrieve (R8).
  - Settlements are read-only and the droppable last item.
- **E (donor identity): adopted, amended by Q10.**
  - A signed-in member's online gift auto-links through the intent's membership (R9).
  - Email matching only proposes, honouring `is_shared`, `directory_hidden` and `hide_email` (G24).
  - A link is a composite reference to `memberships`, never a bare `person_id`.
- **F (provider-neutral interface): adopted.**
  - `NormalizedEvent` gains `GiftPending` and `ConnectionStatusChanged`.
  - The raw body is `text`, never `jsonb` (§9 rule 5 holds).
  - It is purged after 90 days (Q9).
- **G (operator questions):** all answered by the kickoff rulings and defaults. Nothing open remains.
- **Structural rulings: adopted.** One change: the platform designation module lives outside `src/lib/giving/` (Placement).

**R2. G1, the treasurer designation (DECISION-170), in DECISION-155's shape.**

- `designateTreasurer(organizationId, email, operatorUserId)` is one `getPlatformDb()` transaction, called from `/admin/organizations/[id]`'s existing `actions.ts`, gated on `FEATURES.ADMIN_ORGANIZATIONS`.
- **Order:**
  1. Lock `organizations … for update` and read the type fresh. Anything other than `congregation` or `new_worshiping_community` returns `not_applicable`.
  2. **Gate:** zero currently-effective holders of `giving.manage`, counting person-arm and live group-arm grants, as a plain CTE in the `foundingAdministratorHolderCount` shape. Never `presby_effective_permissions()` (F107). Otherwise return `has_holders`.
  3. Resolve the user by email: `no_such_user` or `user_inactive`.
  4. The user's live person must hold an **active membership at this org**. Otherwise `not_a_member` or `membership_ended`. **It creates no person and no membership.** The treasurer is already someone at the congregation, and the founding administrator can enrol a staff-kind anchor first.
  5. Reuse-and-reactivate (F109) an org-owned role keyed `treasurer`, copied from the new `treasurer` template, with the additive-only permission reconcile (`on conflict do nothing`).
  6. Likewise mint, but do not grant, the org-owned `giving_recorder` role from its template.
  7. Insert one person-arm `role_grants` row: `granted_by = operator` (provenance only), `grant_reason = 'treasurer designation'`.
- **Audit:** new `ORG_TREASURER_DESIGNATED` (`"org.treasurer.designated"`, platform-actor axis), metadata `{organizationId, personId, roleId, permissionKeys}`.
- **Visibility:** the section renders only for the two org types. The control appears only while the holder count is 0, read fresh on every render. Otherwise the section shows the count, no names. The block condition and the lockout-recovery condition are the same sentence.
- **Independence:**
  - It neither requires nor flips the toggle.
  - It writes no giving table.
  - It does not add to `founding_administrator`'s bundle (that accretion stays refused).
  - It is not the F111 resolution. It is a second, narrow instance of DECISION-155's shape that the operator ruled, and the F111 pipeline may later subsume it.
- **`assertPermissionSubset()`, `adoptTemplate()` and `grantRole()` are untouched and not imported.**
- **Fixture collision:** the fixture's protected `treasurer` role at org `2222…` will be reused, gaining `giving.*` alongside `ledger.approve`. Phase 3 rules whether the orphan, fixture-only `ledger.approve` stays (S3).

**R3. F138, the giving-team delegation (DECISION-170). `giving_recorder` is not adoptable through `/admin/roles/new`.**

- **Why `/admin/roles/new` can't do it:**
  - `adoptTemplate()` needs `roles.manage`, plus the subset check over `giving.record`.
  - `grantRole()` needs `role_grants.manage`, plus the subset check.
  - After R2 the founding administrator holds the first and not the second, and the treasurer the reverse.
  - Without R3, a recorder could never be appointed, a successor treasurer could never be handed the role, and the operator's "role for recording offline gifts" would be unreachable at every congregation where one person doesn't hold both kinds of key.
- **Ruling:** `src/lib/giving/team.ts` exports `grantGivingRole` and `revokeGivingRole`, in `withOrgContext()`.
  - **Step 0 gate:** the actor holds `giving.manage` (one `presby_has_permission` call).
  - **Target role:** org-owned, active, a non-empty permission set, **every key with `permissions.module = 'giving'`**, read in the same transaction.
  - **Target person:** a current membership. Grants are **person-arm only**: giving by group membership (say, the Session group) would widen silently.
  - **Then `assertPermissionSubset()`, called unchanged.**
  - Insert, or end with `ends_on`, using `revokeRole()`'s semantics.
  - Audited with the existing `TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` keys, metadata `path: "giving_team"`.
- **Why it is safe:**
  - The actor can delegate only giving-only roles whose keys they already hold.
  - They cannot edit role definitions; that needs `roles.manage`.
  - If a `roles.manage` holder adds a non-giving key to `giving_recorder`, the module check refuses this path, and the role falls back to the ordinary `role_grants.manage` + subset path.
- **Lockout:** refuse revoking the last effective `giving.manage` grant with a named result. If it happens anyway (deactivation by a `roles.manage` holder), R2's gate reopens: recoverable, no data loss.

**R4. G4, 2FA (DECISION-170).**

- Every holder of any `giving.*` key is required to complete 2FA, regardless of the org setting.
- **What the Edge can't do:** read the DB.
- **What is possible, and ruled:**
  1. New column `permissions.requires_two_factor boolean not null default false`, set `true` for the three giving keys in 0055.
  2. `presby_two_factor_required(user)` gains an arm: true when the user's live person, at any active membership, effectively holds a key with `requires_two_factor`. The predicate must agree with `presby_effective_permissions()` on every resolver arm. A DB test pins agreement on the fixture; the implementation (inline CTE vs. a per-membership evaluation) is Phase 3/4's.
  3. Because the claim refreshes only when the session is re-derived, every giving **admin** page and action also refuses from the Node-side `auth()` session when `twoFactorRequired && !twoFactorVerified`, redirecting to `/totp?callbackUrl=…`. That closes the claim-refresh latency.
- DECISION-026 is preserved: the `auth.require_2fa` master switch still governs, and a DB error never newly imposes a challenge.
- Member self-view is not forced.
- Generalizing the column to tier-3 keys is S2, deliberately not taken here: it would change existing users' sign-in outside this pipeline.

**R5. G6, donee identity (DECISION-172).**

- A new tenant table `giving_settings`, keyed by org like `organization_settings`. Not an `organization_identifiers` kind, and not `organization_profiles`.
- Columns: donee legal name, structured mailing address, optional EIN (format CHECK), statement signatory name and title, editable greeting and closing.
- Edited by `giving.manage` only. Every change audited.
- **Statements cannot be issued while the legal name or mailing address is missing.**
- Values are **snapshotted onto each issued statement**.
- **Why not `organization_identifiers`:**
  - It has no tenant RLS.
  - Its sole writer, `presby_set_organization_identifier()`, grants write standing to an *affiliated council*. That would let a presbytery alter the donee identity printed on a congregation's tax documents, a cross-council write into a giving artifact.
- **Why not `organization_profiles`:** it is public-site content edited by site admins, not the treasurer.
- An EIN may additionally be recorded as an identifier kind later, for import matching. That is not this pipeline.

**R6. G28, ingest (DECISION-171).**

- **The inbox** `giving_provider_events`:
  - Tenant table: `organization_id` derived, FORCE RLS, composite keys, `unique (connection_id, external_event_id)`, `raw_body text` (nullable once purged).
  - **`presby_app` holds no table privilege on it at all.** Only SECURITY DEFINER functions touch it, so the body is unreachable from any tenant query and from every page.
  - The owner path is covered by a static test: no `getPlatformDb()` under `src/lib/giving/`, and the health page reads through a function.
- **The route**, on `db` (`presby_app`):
  - Secret unset → **503**. This amends DECISION-028 rule 3 for money-bearing providers: a 200 would tell Stripe "delivered" while nothing is recorded, and Stripe would never retry. An unset secret behind a configured endpoint is a misconfiguration, so retry is correct. Resend keeps its 200.
  - Missing header or bad signature → 400. Verification uses the SDK over `await req.text()`, with 300 s tolerance.
  - No top-level `account` (a platform-account event) → 200, handled false.
  - Otherwise call `presby_giving_ingest_event(provider, external_account_id, event_id, livemode, event_type, raw_body)`. It takes no org id. It resolves the connection by `(provider, external_account_id)`. Unknown account or mode mismatch returns `ignored` and writes nothing.
  - The route returns **one identical 200** for accepted, duplicate and ignored. A DB error returns 500 (DECISION-028 rule 5 stands).
- **Processing:**
  - `after()` claims the row through `presby_giving_claim_event(inbox_id)`, which returns the body and increments attempts.
  - The TS normalizer runs, then a small family of SECURITY DEFINER apply functions, one per `NormalizedEvent` kind. Each takes `inbox_id` plus typed parameters and no org id. Each re-derives the org from inbox → connection, validates every referenced row (intent, fund, membership, gift) belongs to that org, and is idempotent on `(connection_id, external_transaction_id)` for gifts and `(connection_id, external_reversal_id)` for reversals.
  - Out-of-order events return `parked`, and the row is retried.
  - Gift `occurred_on` is computed **in SQL** inside the apply function, from the authorization instant in `organization_settings.time_zone`, with the F132 fallback.
  - `/api/cron/giving` (every 5 min) sweeps pending and parked rows with backoff, dead-letters after N attempts, and nulls `raw_body` 90 days after a terminal status.
- **Platform health:** `presby_giving_ingest_health()` returns, per connection, the org id, provider, mode, status, counts by inbox status, last-received time and oldest-pending age. No amounts, names or bodies. `presby_giving_requeue_event(inbox_id)` replays a dead letter, audited `ORG_GIVING_EVENT_REQUEUED` (platform axis).
- **Ingest never reads the org toggle.** Turning giving off hides surfaces and never stops recording recurring gifts.
- **Accepted, recorded:** the DB functions cannot verify the Stripe signature themselves. They trust a `presby_app` caller exactly as far as `presby_app` is already trusted: it can `set_config` any org today. The SECURITY DEFINER surface adds a narrow cross-org lookup, not a capability.

**R7. G30, redirect-only and SAQ-A (DECISION-168).**

- The give form posts only amount (string), fund id, frequency, cover-fees and method to a **server action**.
- The action validates, computes cents and the gross-up, creates the intent and the Checkout Session, asserts the returned URL's origin is `https://checkout.stripe.com`, and returns `{kind: "checkout", url}`. The hydrated client re-asserts the origin and calls `window.location.assign(url)`.
  - Onboarding uses the same pattern (origin `https://connect.stripe.com`).
  - So does the member portal (`https://billing.stripe.com`).
- **No Stripe.js, no Payment Element, no embedded Checkout, no iframe.**
- `script-src`, `frame-src`, `connect-src` and **`form-action 'self'` are unchanged.** `form-action` is enforced on a redirect that follows a *native* form POST. `<HydrationGate>` makes a native pre-hydration submit impossible, and the hydrated path is a script navigation, which `form-action` does not govern. Adding `checkout.stripe.com` to `form-action` is not needed and must not be done.
- `success_url` and `cancel_url` are built from the site's canonical origin (`siteOrigin()`, later P5's configured hostname), **never from the request `Host`**.
- The return page reads gift state from presby's DB by Checkout session id through a SECURITY DEFINER read returning `{state, amountCents, fundDisplayName}` only. No PII. A URL parameter never marks a gift paid.
- **SAQ-A stance:** card and bank data never touch presby servers or pages. The congregation is merchant of record. **Go-live gate before any live-mode connection:** the existing policy is served **enforced** (not report-only) on `/site/:slug/give*` and `/o/:slug/giving/give*`. Nonce-based removal of `'unsafe-inline'` remains the tracked platform hardening.

**R8. G27, secret custody and what presby may fetch (DECISION-168).**

- **Env vars:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
  - Live values exist **only** in the production environment. Preview and development use the test-mode platform account (an operator prerequisite before Batch 3 verification).
  - Production uses a **restricted key** (`rk_live_…`) with Connect permissions limited to the allowlist, if Stripe exposes each needed resource for Connect calls. Phase 3 confirms resource by resource and records any resource that forces the full secret key.
- **`client.ts` is the only runtime importer of `stripe`.** Enforced by ESLint `no-restricted-imports`, `allowTypeImports: true`, outside `src/lib/giving/providers/stripe/`.
- **It exports named functions, never the client instance:**
  - Writes: create account, create account link, create Checkout session, create billing-portal session (R1 C).
  - Reads: retrieve account (status and requirements); retrieve one balance transaction; list balance transactions by payout (`Stripe-Account`); retrieve one event by an id **already in the inbox** (replay).
- **Forbidden:** any list or search on customers, charges, PaymentIntents, invoices or subscriptions, and any customer retrieve.
- **Logging:** never log response bodies or error payloads. Log error `type`, `code` and request id only.
- `isStripeConfigured()` lets pages render "Online giving isn't enabled on this installation." instead of throwing.
- `docs/deployment.md` gains the rotation procedure. The privacy copy discloses the platform account's technical reach at Stripe.

**R9. The checkout intent is the only path from a Stripe payment to a gift (DECISION-168/171).**

- Every give flow persists a `giving_checkout_intents` row before redirecting: fund, cents, cover-fee amount, method, frequency, idempotency key, Checkout session id, and `membership_id` (null on the public page).
  - Anonymous: through a SECURITY DEFINER function keyed by `slug`.
  - Member: through `withOrgContext()`, with `membership_id` taken from the server-resolved identity.
- The apply function takes fund and membership **from the intent, never from Stripe metadata**.
- A payment on the connected account with no presby intent (a dinner ticket, a Payment Link, a dashboard charge) is `ignored`, not a gift. That makes G7's "pure contribution only" structural for online money and closes the crafted-metadata cross-org-fund vector.
- Subscription invoices map through the subscription id recorded from the intent's completion.
- **Auto-link (Q10):** the donor is linked to the intent's membership only when it has no confirmed link. A conflicting existing link is left alone and surfaced for review.

**R10. Schema invariants (DECISION-172). The DDL is Phase 3/4's.**

- **Keys and RLS:** every table has composite keys, FORCE RLS, no DELETE grant, and an owner-path delete guard on gifts, reversals, donors and statements.
- **Money:**
  - Integer cents, `CHECK > 0` on every amount; `bigint` on aggregates (settlements).
  - `currency text not null default 'usd' check (currency = 'usd')`.
  - `donor_covered_fee_cents` is its own column, so the statement policy is one constant (G10).
- **Gifts:**
  - `occurred_on date not null`, the org-local date of authorization. `occurred_at timestamptz` is null for offline gifts. Statement year derives from `occurred_on` only.
  - `livemode boolean not null` on the connection and on every gift. Offline gifts are `true`. Every total and statement predicate includes `livemode`.
  - **Status is trigger-frozen:** `pending → succeeded | failed` one-way. Fee and net are set-once, null to a value. Every other update raises.
- **Reversals:** a separate insert-only table, with kinds such as refund, dispute, dispute reinstatement, ACH return and offline void-with-reason.
- **Provider:**
  - Enum `giving_provider` with the single value `stripe`. No `vanco` value now; `alter type … add value` later.
  - Offline gifts have a null provider and a method enum (cash, cheque, stock, other).
  - Stripe methods: card, `us_bank_account`, wallet.
- **Connections:**
  - Globally `unique (provider, external_account_id)`. The key is minted by Stripe, never tenant-supplied, so it is not an F103 oracle.
  - At most one non-disconnected connection per org.
- **Donors:**
  - No `person_id`. The link is a composite to `memberships`, plus `merged_into_id` (composite self-FK).
  - Kind `identified | unidentified`, where unidentified is plate cash and can never receive a statement (enforced in `statements`' DDL).
  - Provider identities are a child table, `unique (connection_id, external_customer_id)`.
- **Funds:**
  - A restriction class (unrestricted, temporarily restricted, permanently restricted) as a CHECK, not a free label.
  - `offered_online` defaults false. Retired, never deleted.
  - **No General Fund auto-seed:** the generic toggle module stays feature-agnostic, and the empty state offers one-click creation. The public page requires at least one online fund.
- **Untouched:** `households.is_giving_unit`, `organization_identifiers`, every publication and affiliation function.
- **No `jsonb` anywhere. No speculative `ledger_transaction_id`.**

**R11. The toggle, applicability, tiles and flag retirement (DECISION-172).**

- **The catalog entry:** `{ key: "org_portal.giving", name: "Giving", category: "giving", flag: null, provisionedOn: false, orgTypes: ["congregation", "new_worshiping_community"] }`.
- **`ORG_FEATURE_CATALOG` has no org-type scope today.** A required `orgTypes: readonly OrganizationType[] | null` is added; every existing entry gets `null`.
- **It is applicability, not a gating axis.** It is static, with no table, no admin surface and no per-org choice. It mirrors `PortalTile.orgTypeScope`, which already exists.
- **Enforced in three places:**
  - `listFeatureToggles` omits inapplicable entries.
  - `toggleOrgFeature` returns the existing `invalid_key` arm for an inapplicable org type. No new variant; the UI never offers it.
  - `orgFeatureEnabledInTx` returns `false` for an inapplicable type, with one read of `organizations.organization_type` in the same transaction, only when `orgTypes` is non-null. That is defense in depth against a stray row.
- **Tiles:**
  - Operate tile "Giving" → `/o/<slug>/giving`, with `orgFeatureKey: "org_portal.giving"`, `orgTypeScope` equal to the catalog's `orgTypes` (a test pins equality), no `flagKey`, no `comingSoon`.
  - A "Manage giving" tile on the admin hub → `/o/<slug>/admin/giving`.
  - Tiles stay permission-blind (DECISION-162). The member destination needs no key; the admin destination denies non-holders.
- **Flag retirement:**
  - 0055 deletes the `org_portal.giving` row from `feature_flags`.
  - `scripts/seed.ts` stops seeding it.
  - A test asserts no source calls `isFlagEnabled("org_portal.giving")`.
  - The go-live TODO sweep shrinks by one.
- `/site/<slug>/give` gates on toggle on, connection active, mode live, and at least one online fund (R13).

**R12. Statements (DECISION-173, DECISION-174).**

- **Issuing writes:**
  - (a) a frozen `giving_statements` row: donor, tax year, version, a `supersedes` composite, snapshots of the donee identity and delivery address, totals split cash vs non-cash, a code-generated wording version, issuer and issued time;
  - (b) frozen `giving_statement_lines`;
  - (c) a PDF rendered **once at issue** with `pdfkit`, stored through the blob adapter (`application/pdf` is already admitted). `(blob_asset_id, organization_id)` is a composite FK with NO ACTION, so a referenced blob cannot be deleted even on the owner path.
- **The record is the snapshot plus the bytes, never a re-render.** IRS wording is generated in code and versioned; only the greeting, closing and signature come from `giving_settings`.
- **Staleness is derived**, never stored on the frozen row: any gift or reversal for that donor and year created after `issued_at`. A correction is version n+1, and the predecessor is marked superseded through the version chain.
- **Member download:** `/o/[slug]/giving/statements/[statementId]/download/route.ts`.
  - It resolves the org, then reads in `withOrgContext()`: the statement exists, is issued or superseded, and its donor's confirmed link is the viewer's own membership.
  - "Not yours" and "doesn't exist" return the identical 404.
  - It streams the blob as `attachment` with `Cache-Control: private, no-store`.
  - Treasurer download uses `giving.manage`. Bulk download is audited.
- **Email delivery:**
  - **Statement contents never enter `email_queue`.** It is a platform table with full `presby_app` DML, no RLS, and indefinite retention, and it has no attachment column.
  - The email is a notice: no amounts, and no amounts in the subject.
  - For a signed-in member it links to the download.
  - For a donor without an account, Phase 3 chooses. **Either** a DECISION-147-shaped credential (a hashed, high-entropy, expiring token bound to one statement version, in a new un-brandable public group with exact proxy allow-list paths, one uniform response for every failure, rate-limited), **or** print delivery only in v1, with the token route as a tracked follow-up. No real run occurs before January 2028.
- **Retention:** issued statements at least 7 years. No DELETE grant. Owner-path delete guard.

**R13. Public give surface (DECISION-168).**

- `/site/[slug]/give` and the `giving` live slot read through one SECURITY DEFINER `presby_public_giving_config(slug)`. It returns the org display name, online funds (id and display name), fee rates, bounds and `live | unavailable`. It returns no `acct_` id.
- It fails closed in DECISION-154's shape: one `try/catch`, ids-only logging, and a confirmed-absent shape on error.
- **State machine:**
  - giving live → the form;
  - site published and giving not live → "Online giving isn't available right now" plus the church contact (tenancy is already public);
  - otherwise → the identical `notFound()`.
- **Live slot:** closes over `slug` only (never `headers()` or `cookies()`). An optional content-authored `filter.fund` is validated against the org's online funds. It never auto-links, even for a signed-in visitor; the member give page is the auto-link path.
- **Site bundles:** the ingest validator should reject a bundle page at `/give` or `/give/*`, which the static segment would shadow.
- **Abuse controls, in this order:** honeypot, then a per-site-and-IP rate limit (`checkRateLimit`, note it is in-memory without Upstash), then Turnstile when configured, then the bounds check ($1–$25,000, USD), then the server-computed gross-up (decimal more than 2 places, exponent, sign and Unicode digits rejected), then intent idempotency.

**R14. Member self-view (DECISION-170).**

- `src/lib/giving/self.ts` returns only gifts and statements on donors whose confirmed link is the viewer's own membership, resolved server-side.
- DECISION-162's four self-read conditions apply, including a DB test that another member's rows are not returned.
- Household and spouse relationships confer nothing (G3).
- A DB error renders "We can't load your giving history right now", never an empty list.

**R15. Batch order and parallelism.**

- **The Phase 1 order stands, with these amendments:**
  - **Batch 1 owns 0055:** every giving table except statements, the SECURITY DEFINER families, the `requires_two_factor` column and predicate arm, the three keys, the two templates, flag retirement, and test-rls/seed blocks.
  - Batch 1 also owns the catalog `orgTypes` change, `treasurer-designation.ts` with its `(admin)` section, and **every new `AUDIT_ACTIONS` key the pipeline will need, declared up front**. Later batches then never edit `src/lib/audit.ts`.
  - **Batch 2** adds `team.ts` and its page.
  - **Batch 5 owns `0056` (statements) and the `pdfkit` install.**
- **Parallel option:** after Batch 1 merges into `pipeline/online-giving`, Batches 2 and 3 may run in parallel worktrees, each on a Neon child branch of the pipeline's branch.
  - Batch 2 makes no DDL edits; a needed edit loops back.
  - Batch 3 owns any in-place 0055 corrections to the ingest functions, and the `package.json`/lockfile and `vercel.json` edits.
  - Batches 4 and 5 may then run in parallel, provided **5 starts after 3 merges** (lockfile serialization) and 4 starts after both 2 and 3 (it needs funds and the client).
  - Batch 6 is last.
- **Merges into the pipeline branch are serialized, with `scripts/test-rls.sql` re-run after each.** Sequential execution is the default; this is permission, not a requirement.
- **Gates:** Q1 (test-mode Connect platform account) gates Batch 3 verification. R7's enforced CSP gates the first live-mode connection. Q6 (CPA) gates issuing any real statement.

### Suggestions (optional)

- **S1.** Add a `check:giving-boundaries` tripwire, or fold it into an existing one: no runtime `stripe` import outside the provider folder, no `getPlatformDb` under `src/lib/giving/`, no `email_queue` write with a `giving.statement*` template carrying amounts. It is cheaper than relying on review.
- **S2.** Track in `docs/TODO.md` whether `requires_two_factor` should cover tier-3 keys (`pastoral_notes.manage`, `medical.manage`, `disabilities.manage`), as its own small pipeline.
- **S3.** Retire the orphan fixture-only `ledger.approve` binding on the fixture `treasurer` role when Phase 3 reconciles the fixture. No code reads it, and no migration creates it.
- **S4.** Phase 3 should define `giving.record`'s read scope tightly: the donor picker plus the recorder's own recent entries, not the full gift ledger or lifetime totals.
- **S5.** Name the "needs attention" query (failed ACH, parked events visible to the org, stale statements) once, in `src/lib/giving/`, so the overview page and any future home widget can't disagree.

## Handoff

**Next agent: tech-lead (Phase 3).** Design to R1–R15. Preserve the analyst's G1–G31, the adversarial table and the seven presbytery-invariant tests. Phase 3 decides: the DDL; the NormalizedEvent → apply-function signatures; the R4 predicate implementation; the R12 non-account delivery choice; the restricted-key resource list (R8); `giving.record`'s read scope (S4). Phase 3 confirms against the pinned API version: the Accounts v2 fields, the InvoicePayment linkage (spike C), and portal behaviour for direct-charge customers. DECISION-175 is free for a Phase 3 ruling. **Proposed finding F138** (below) belongs in `docs/schema-design-2.md`'s findings log at integration.

## Proposed finding (integration draft for `docs/schema-design-2.md`)

**F138: a platform-designated treasurer can never delegate giving.** After R2's designation, `giving_recorder` cannot be adopted or granted, and the treasurer role cannot be re-granted to a successor, by anyone.

- `adoptTemplate()` requires `roles.manage`, `grantRole()` requires `role_grants.manage`, and both also require the subset check over the giving keys.
- The founding administrator holds the first two and no giving key. The treasurer holds the giving keys and neither role key. No single person satisfies both.
- This is F111's ceiling showing up across two holders instead of one.
- Resolved by R3's module-scoped delegation (DECISION-170). F111 itself stays open.

## Decision entries (integration drafts for `docs/decisions.md`, newest first — written to the shared file only at integration, Rule 16)

**DECISION-174 — `pdfkit` is the statement renderer, installed in Batch 5 and not before.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

An issued year-end statement must be a byte-stable artifact with a retention obligation (§7 Section Q).

- **Why not westervillelions' `window.print()` of a stored letter:**
  - The printable output depends on today's code, not the issue-time code.
  - Serving stored HTML from presby's origin is an XSS surface.
  - It gives an account-less donor nothing to receive.
- **What `pdfkit` is:** 0.20.2, MIT, actively maintained, with MIT transitive dependencies (`fontkit`, `linebreak`, `fflate`, `png-js`, `@noble/hashes`, `@noble/ciphers`). It is server-only and renders the simple shape a statement needs: letterhead, address block, a table of gifts, totals, generated wording.
- **Rejected:**
  - `pdf-lib`: unmaintained since 2022.
  - `@react-pdf/renderer`: wraps pdfkit and adds about ten packages of layout machinery.
  - Headless Chromium: serverless function size.
  - A hand-written PDF emitter: text measurement and wrapping are the library's whole value.
- **Batch 5 obligations:**
  1. Confirm the then-current version and licence.
  2. Add `serverExternalPackages: ["pdfkit"]` (pdfkit is not in Next's default list) and prove its font data is traced into the function.
  3. Embed a committed OFL font with Latin Extended and Vietnamese coverage, because donor names arrive from Stripe in any script and the standard-14 fonts are WinAnsi only.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-173 — An issued statement is a frozen snapshot plus PDF bytes stored through the blob adapter, never a re-render. Staleness is derived, never stored. A correction is a new version. Statement contents never enter `email_queue`.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

**What issuing writes:**
- A `giving_statements` row with snapshots of the donee legal name, address and EIN, the delivery address, totals split cash vs non-cash, the code wording version, issuer and time.
- Frozen `giving_statement_lines` rows.
- A PDF rendered once (DECISION-174), stored by `store()`, and referenced by a composite `(blob_asset_id, organization_id)` FK with NO ACTION. An FK binds the owner connection where a grant cannot (F44), so a referenced blob cannot be deleted on any path.

**Immutability:** issued rows are trigger-frozen. There is no DELETE grant, and a BEFORE DELETE guard has the `deletable_until` exemption. Retention is at least 7 years.

**Late changes:** "Needs correction" is computed (a gift or reversal for that donor and year created after `issued_at`). It is never a flag written onto a frozen row. Re-issue is version n+1, titled "Corrected statement, replaces statement dated X".

**Wording:** IRS wording is generated in code and versioned. Only the greeting, closing and signatory come from `giving_settings`.

**Member download:** a route handler in `(org)` checks, inside `withOrgContext()`, that the statement's donor is confirmed-linked to the viewer's own membership. "Not yours" and "absent" return the same 404. The file is served as an attachment with `no-store`.

**Delivery:**
- **Why not `email_queue`:** it is a platform table with full `presby_app` DML, no RLS, indefinite retention and no attachment column. Putting statement contents there would make it a second, unscoped copy of tier-2 data.
- The email is a notice with no amounts.
- For donors without an account, Phase 3 chooses between a DECISION-147-shaped credential (hashed, expiring, bound to one version, uniform failure response, its own un-brandable public route group) and print-only delivery in v1. The first real run is January 2028.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-172 — The giving data model's invariants, at the shape level: composite tenant keys, FORCE RLS and no DELETE grant on every table; gifts trigger-frozen apart from one-way transitions, and corrected by insert-only reversal rows; integer cents, USD-only by CHECK; `occurred_on` in the org's zone; `livemode` on the connection and on every gift; a `stripe`-only provider enum; donors without `person_id`, linked through `memberships`; the donee identity in a new `giving_settings` table edited by `giving.manage`; `org_portal.giving` as a toggle-only, off-by-default catalog entry with static org-type applicability, and the platform flag of the same name retired.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

**Tables and freezes:**
- Every giving table carries `unique (id, organization_id)`. Every inter-table FK, and every FK to `memberships` and `blob_assets`, is composite with NO ACTION (RESTRICT can fail the fixture cascade, DECISION-161).
- Gifts follow `roll_actions`' rule: status moves one way, `pending → succeeded | failed`; fee and net are set-once, because the balance transaction can arrive after success; every other update raises.
- Refunds, disputes, dispute reinstatements, ACH returns and offline voids are rows in an insert-only reversal table.
- BEFORE DELETE guards cover the owner path (F44).

**Columns:**
- Money is integer cents with `CHECK > 0`, `bigint` for aggregates.
- `currency` is CHECK-pinned to `usd`, so adding a currency later is a constraint change, not a redesign.
- The donor-covered fee has its own column, so the CPA's ruling is one constant.
- `occurred_on` is the org-local date of authorization, computed in SQL from `organization_settings.time_zone` with the F132 fallback. Statements derive the year from it alone.
- `livemode` is on the connection and on gifts. Offline gifts are `true`. Every total and statement predicate filters on it.

**Provider enum and connections:**
- The provider enum holds `stripe` alone; Vanco arrives as `alter type … add value`.
- Connections are globally unique on `(provider, external_account_id)`. Stripe mints the key and a tenant never supplies it, so it is not an F103 oracle.

**Donors and funds:**
- Donors follow §7: no `person_id`. The link is a composite to `memberships`, plus `merged_into_id` and an `unidentified` kind that can never receive a statement.
- Funds carry a restriction class by CHECK and are retired, never deleted.

**What stays untouched:**
- No `about_org_id`, no affiliation or publication function, and no `jsonb` (§9 rule 5); the raw body is `text`.
- `households.is_giving_unit` and `organization_identifiers` are untouched.

**Donee identity:**
- A new `giving_settings` row, not an `organization_identifiers` kind. That table's sole writer grants standing to an affiliated council, which would let a presbytery rewrite the donee identity on a congregation's tax documents.
- Edited by `giving.manage`, audited, snapshotted at issue, and required before any statement can be issued.

**Catalog:**
- Every entry gains a required `orgTypes: readonly OrganizationType[] | null`.
- Giving is `["congregation", "new_worshiping_community"]`, with `flag: null` and `provisionedOn: false` (the operator's Q3 and Q4).
- Applicability is enforced in `listFeatureToggles`, in `toggleOrgFeature` (existing `invalid_key`) and in `orgFeatureEnabledInTx`.
- It is a static property mirroring `PortalTile.orgTypeScope`, not a gating axis: there is no table, no admin and no per-org choice.

**Tiles:** the operate "Giving" tile and the admin-hub "Manage giving" tile both carry `orgFeatureKey` and an `orgTypeScope` pinned equal to the catalog's.

**Flag retirement:** 0055 deletes the `org_portal.giving` flag row, which is ON in production behind an inert placeholder, and `scripts/seed.ts` stops seeding it.

**No General Fund auto-seed on toggle:** the generic toggle module stays feature-agnostic (DECISION-130's one-directional rule), and the give page requires an online fund anyway.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-171 — Webhook ingest is a tenant-RLS'd inbox that `presby_app` cannot touch directly. Rows are written, claimed, applied, replayed and summarized only through SECURITY DEFINER functions that take no organization id and derive it from the connection row. An unset secret on a money-bearing webhook returns 503, amending DECISION-028 rule 3.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

**The setting:** `/api/webhooks/stripe` has no session, and `withOrgContext()` requires a member. Two shortcuts are rejected:
- A "system org context" helper that calls `set_config` without a membership check. It would be a general bypass any future code could reach.
- Writes on `getPlatformDb()`. That would put the owner connection, which no grant binds (F44), into tenant giving data, and break the static guarantee that `src/lib/giving/` never imports it.

**The shape follows DECISION-147:** the verified signature is the credential, and the function derives everything from its own rows.

**Functions:**
- `presby_giving_ingest_event()`: unique on `(connection_id, external_event_id)`; unknown account or mode mismatch returns `ignored` and writes nothing.
- `presby_giving_claim_event()`: returns the body to the processor.
- A family of apply functions, one per normalized kind. Each re-derives the org from inbox → connection, validates the intent, fund, membership and gift belong to that org, and is idempotent on external ids.
- `presby_giving_ingest_health()`: counts and timestamps only.
- `presby_giving_requeue_event()`: replay, audited on the platform axis.

All pin `search_path = public, pg_temp`, and `EXECUTE` is granted to `presby_app` alone. `presby_app` holds no table privilege on the inbox, so the raw body (names, emails, addresses) is unreachable from any tenant query and from every page.

**Route contract:**
- Secret unset → **503**. A 200 tells Stripe the event was delivered when nothing was recorded, and Stripe never retries; for money that is silent loss. An unset secret behind a configured endpoint is a misconfiguration, which is the case a retry exists for. Resend's 200 is unchanged.
- Bad or missing signature → 400.
- Platform-account event → 200, not handled.
- Accepted, duplicate and ignored → one identical 200.
- DB error → 500.

**Processing and retention:**
- Processing runs in `after()`, with a 5-minute cron for backlog, backoff and dead letters.
- Bodies are nulled 90 days after a terminal status. The normalized rows are the record.
- Ingest never reads the org toggle.

**Accepted residual:** the functions cannot re-verify the signature. They trust a `presby_app` caller no further than `presby_app` is already trusted.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-170 — Giving authority: `treasurer` (`giving.view`, `giving.record`, `giving.manage`) and `giving_recorder` (`giving.record`) are new template roles, with no default binding elsewhere. The first treasurer is designated by the platform operator in DECISION-155's shape, gated on zero `giving.manage` holders, and the designation creates no person. A `giving.manage` holder may grant and revoke giving-only roles, person-arm, with `assertPermissionSubset()` called unchanged (F138). Holders of any `giving.*` key must complete 2FA, via a new `permissions.requires_two_factor` column read by the existing SECURITY DEFINER predicate. The member self-view is identity-based and needs no key.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

**DECISION-078, per office:** `treasurer` passes (G-3.0205, DECISION-080). `stated_clerk`, `session_member`, `installed_pastor` and `founding_administrator` fail. `giving_recorder` is a custom role, because no PC(USA) office exists for it.

**The designation:**
- `src/lib/treasurer-designation.ts`, one `getPlatformDb()` transaction from `/admin/organizations/[id]`, gated on `FEATURES.ADMIN_ORGANIZATIONS`.
- It locks the org row and requires a congregation or new worshiping community.
- The zero-holder gate is a plain CTE, never `presby_effective_permissions()` (F107).
- The designee must already hold an active membership. The act creates no person and no membership.
- It reuses or reactivates an org-owned `treasurer` (F109, additive reconcile), mints `giving_recorder` ungranted, and inserts one person-arm grant with `granted_by` as provenance.
- Audited as `ORG_TREASURER_DESIGNATED`. It neither requires nor flips the toggle, and writes no giving table.
- Not the F111 resolution, and no accretion to `founding_administrator`. `authz.ts`, `role-definitions.ts`, `role-grants.ts` and `drizzle/0010` are unchanged, and a test pins that.

**F138 and the delegation path:**
- Without delegation, nobody could ever grant the recorder role or hand over the treasurer role: the founding administrator lacks the giving keys and the treasurer lacks `roles.manage` and `role_grants.manage`.
- `src/lib/giving/team.ts` adds a step-0 gate of `giving.manage`.
- The target role must be org-owned, active, and contain only `permissions.module = 'giving'` keys. Grants are person-arm only, so group-arm can't widen access through, say, the Session group.
- The subset check runs unchanged, and the existing `TENANT_ROLE_*` audit keys are used.
- Revoking the last `giving.manage` holder is refused. If it happens anyway by role deactivation, the designation gate reopens.

**2FA:**
- `requires_two_factor` is true for the three giving keys.
- `presby_two_factor_required()` gains an arm that must agree with `presby_effective_permissions()` on every resolver arm; a DB test pins agreement.
- Giving admin pages and actions also check `twoFactorRequired && !twoFactorVerified` on the Node-side session, closing the claim-refresh latency.
- DECISION-026's master switch and DB-error posture are unchanged. Extending the column to tier-3 keys is a tracked follow-up.

**Self-view:** a member sees gifts and statements only on donors confirmed-linked to their own membership. It lives in `src/lib/giving/self.ts` under DECISION-162's self-read conditions, and household relationships confer nothing.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-169 — Adds the `stripe` npm SDK (23.0.0, API version `2026-09-30.endive`), server-only, imported at runtime by exactly one module.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect)

**Against the rubric:**
- Nothing in `package.json` does this.
- MIT, zero runtime dependencies, engines `node >= 20` (repo `>= 22`), actively released (2026-10-14).
- The pinned API version was verified in the published tarball (`esm/apiVersion.js`).
- About 17 MB unpacked, mostly types. Server-only, so zero client bytes.

**Constraints:**
- Never on the Edge: `src/proxy.ts` and everything it reaches never import it, and every importer is `runtime = "nodejs"`.
- `src/lib/giving/providers/stripe/client.ts` is the only runtime importer, enforced by ESLint `no-restricted-imports` (type-only imports allowed).
- The client sets `apiVersion` explicitly to the SDK's pinned version.
- A major-version upgrade of the SDK is an API-version change and gets its own work-log.
- Webhook verification uses the SDK's verifier over the raw body with a 300 s tolerance, replacing a hand-rolled verifier like Resend's.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

---

**DECISION-168 — Giving is provider-neutral at the event boundary and Stripe-specific everywhere else: Stripe Connect, direct charges, each congregation's own Stripe-hosted-onboarded account, no application fee. Donors reach Stripe-hosted Checkout by redirect only: no Stripe.js and no iframe on any presby page. That is the SAQ-A stance. A Stripe payment becomes a gift only through a presby-created checkout intent, never through Stripe metadata. The platform key calls an enumerated allowlist from one module, and production uses a restricted key where Stripe permits.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 2 architect, adopting the kickoff spike A–F with amendments)

**Spike A, adopted:**
- Accounts v2 merchant configuration; store only `acct_…`.
- One platform endpoint for connected accounts; `livemode` checked against the connection.
- OAuth connection of existing accounts deferred.
- Express and Custom rejected (platform liability), and pasted keys rejected (secret custody).

**Spike B–D, adopted:**
- Checkout with inline `price_data`; subscription mode for monthly gifts.
- One gift per succeeded PaymentIntent; reversal rows for refunds and disputes.
- Fee and net from the balance transaction.
- Amended for the portal: a portal session is only for a signed-in member's own linked customer, never from an email lookup.

**Spike E–F, adopted:**
- Q10 adds auto-linking through the intent.
- `NormalizedEvent` gains `GiftPending` and `ConnectionStatusChanged`.
- Refund initiation stays in the Stripe Dashboard.

**Redirect only:**
- The server action validates, computes cents and the gross-up, persists the intent, creates the session, asserts the origin `https://checkout.stripe.com`, and returns the URL. The hydrated client re-asserts the origin and navigates.
- `form-action 'self'` and every other CSP directive are unchanged. `form-action` governs redirects after native POSTs, which `<HydrationGate>` makes impossible.
- Return URLs come from the site's canonical origin, never `Host`.
- The return page reads presby's own state without PII.
- An enforced CSP on the give routes is a gate before any live-mode connection.

**Intent authority:**
- The fund and membership on a gift come from presby's `giving_checkout_intents` row.
- A connected-account payment presby didn't originate (a dinner ticket, a Payment Link) is ignored.
- That makes "pure contribution only" (G7) structural for online money and closes the crafted-metadata cross-org-fund vector.

**Key custody (G27):**
- Live keys only in production. Test-mode platform account elsewhere.
- Restricted key where Connect permits; Phase 3 confirms per resource.
- `client.ts` exports named functions only: create account, account link, Checkout session, portal session; retrieve account, one balance transaction, balance transactions by payout, one event already in the inbox.
- Forbidden: listing or searching customers, charges, PaymentIntents, invoices or subscriptions, and retrieving customers.
- Never log response or error bodies.
- A rotation procedure goes in `docs/deployment.md`.
- The privacy copy discloses the platform account's reach.

(2026-10-15, adopted at Phase 2; `docs/work-log/2026-10-15-online-giving.md`.)

*Sources the architect cited: Stripe — Restricted API keys (https://docs.stripe.com/keys/restricted-api-keys.md); Stripe — API permissions reference (https://docs.stripe.com/keys/permissions-reference).*

---

# Phase 3 — Technical Design (tech-lead)

*Authored 2026-10-15 by tech-lead against the live tree at `pipeline/online-giving` (read-only except this section). Designed strictly to R1–R15; the places where this design amends, narrows or fixes an architect ruling are listed once, in "Rulings and amendments" below, and each is repeated where it bites. Nothing here edits the shared files (Rule 16): every integration-only edit is named in "Implementation Order → Deferred to integration".*

## Summary

Build online giving as a provider-neutral core with a Stripe adapter at the edge, in six shippable batches, every one invisible while the per-org `org_portal.giving` toggle is OFF.

- **Money path.** A donor reaches the congregation's own Stripe-hosted Checkout by redirect only (server action → origin-asserted `window.location.assign`). Every online gift exists only because presby first wrote a `giving_checkout_intents` row; a Stripe payment with no intent is ignored (R9). Webhooks land in a tenant-RLS'd inbox that `presby_app` cannot touch; SECURITY DEFINER functions that take no org id write, claim, apply and summarize it.
- **Records.** Gifts and reversals are written only by SECURITY DEFINER functions (no INSERT/UPDATE grant to anyone), frozen by triggers on every connection, corrected by insert-only reversal rows, and torn down only with their organization.
- **Authority.** Three tier-2 keys (`giving.view`, `giving.record`, `giving.manage`) plus two template roles. The first treasurer is designated by the operator in DECISION-155's shape; after that a `giving.manage` holder runs the giving team through a giving-only delegation path (F138). Holding any `giving.*` key forces 2FA through a new `permissions.requires_two_factor` column read by the existing sign-in predicate.
- **Statements.** Frozen snapshot + PDF bytes, version chain, derived staleness. Delivery in v1 is **print plus a no-amounts portal notice**; the account-less-donor token download is deferred (R12 ruling below).
- **Scope guard.** Nothing in this pipeline publishes, affiliates or reads across councils. Per-member giving is invisible to a parent council by tenancy, and the one downward path (commission/delegation roles) is closed by trigger (DECISION-175).

## Rulings and amendments (read first)

| # | Ruling | Effect on R-rulings |
|---|---|---|
| P3-1 | **R12 delivery: print-only plus a no-amounts "portal notice" email. No token route in v1.** | Fills R12's open choice. No new route group, no credential table. Tracked follow-up. |
| P3-2 | **S1: add `check:giving-boundaries`** (Batch 1 creates it, later batches extend it). | Adopts S1. Wired into `npm run check`. |
| P3-3 | **S3: drop the fixture `treasurer` role's `ledger.approve` binding; keep the `permissions('ledger.approve')` row** in `seed-dev.sql`. | Adopts S3 narrowly. The row stays because `role-definitions.test.ts:910-920`, `authz.test.ts:682` and `test-rls.sql:8058` use it as "a key nobody holds". |
| P3-4 | **S4: `giving.record` reads exactly three things** — the donor picker (name, kind, "has email" boolean), its holder's own last-30-days entries, and the reduced donor page for link confirm/dismiss. No ledger, no totals, no contact detail. | Adopts S4. |
| P3-5 | **S5: one `loadAttention()` in `src/lib/giving/attention.ts`**, plus one DEFINER counts function for parked/dead-letter events. | Adopts S5. |
| P3-6 | **`presby_giving_ingest_health()` and `presby_giving_requeue_event()` are owner-only** (EXECUTE revoked from `presby_app`), called through `getPlatformDb()` from one file **outside** `src/lib/giving/`: `src/lib/admin/giving-ingest-health.ts`. | **Amends DECISION-171's "EXECUTE granted to `presby_app` alone"** for these two functions. Strictly tighter: no tenant-reachable cross-org summary exists, and `getPlatformDb()` appears nowhere under `src/lib/giving/`, `src/app/api/**/giving*`, `src/app/api/webhooks/stripe/`, or any `(org)` giving route. 0048 §6 precedent. |
| P3-7 | **Gifts and reversals have no INSERT or UPDATE grant for anyone.** Offline recording, voiding and every apply path are SECURITY DEFINER functions. A transaction-local marker `presby.giving_write_active` is the owner-path half (grant + marker, DECISION-141). | Narrows R10's "standard tenant policy + grants" for these two tables only. Creation is guarded as strongly as mutation. |
| P3-8 | **The BEFORE DELETE guard passes when the parent `organizations` row no longer exists** (a sanctioned org-teardown cascade) **or** the row's own `deletable_until` is in the future. | Fills R10. Needs a mandatory empirical test (below); fallback is a GUC arm in `presby_guard_organizations_delete()`. |
| P3-9 | **`retrieveInvoiceForPayment` is added to the Stripe allowlist; the billing-portal session is removed.** | **Amends R8's list and R1.C.** Reason in "Stripe confirmations". |
| P3-10 | **Account-onboarding link host is `accounts.stripe.com`** (Accounts v2 links), not `connect.stripe.com`. The origin assertion accepts exactly those two hosts. | **Corrects R7's text.** |
| P3-11 | **R11 "mode live" means presby's explicit go-live** (`public_enabled_at`), not `livemode = true`. A test-mode connection can be public in dev/preview and shows a "Test mode" banner. | Resolves an ambiguity. |
| P3-12 | **Reversal kinds:** `refund`, `dispute`, `ach_return`, `void`, `reinstatement` (a reinstatement references the reversal it offsets). | Gives R10's "dispute reinstatement" a shape that also covers a refund that later fails. |
| P3-13 | **Settlement lines are signed `bigint`** with `net = gross − fee`. | Carve-out from R10's "CHECK > 0 on every amount": ledger lines are signed by nature. Every other amount column keeps `> 0`. |
| P3-14 | **No cron connection-status refresh in v1.** Status comes from `account.updated` events plus the return page and a manual "Refresh status" button. | Drops one function and one cron branch. |
| P3-15 | **Donor dedupe on a new Stripe customer:** attach to an existing donor only when normalized email **and** case-folded name both match exactly one identified, unmerged donor; an email-only match becomes a "possible duplicate" suggestion for the treasurer. | Resolves the many-customers-per-donor consequence of `customer_creation: always`. |
| P3-16 | **Failed renewals do not create gift rows.** Only terminal, presby-originated failures do (first ACH payment via `async_payment_failed`). | Avoids a `failed → succeeded` transition on a retried PaymentIntent. |
| P3-17 | **Statement and reversal/gift reads are `livemode`-filtered in one shared SQL fragment**, pinned by a static test. | Implements G14. |
| P3-18 | **`team.ts` also exports `ensureGivingRole`** (reuse-and-reactivate the org-owned `treasurer`/`giving_recorder` role from its template, giving-only, subset-checked). | Extends R3: without it a deactivated recorder role strands delegation (F138 again). Does not edit existing role definitions. |

DECISION-175 (below) is one entry carrying P3-1, P3-6, P3-7, P3-8, P3-9, P3-10, P3-15 and the two authority rulings (downward-path guard, 2FA predicate shape); the remaining P3 items are design details recorded here only. Findings F139–F141 are drafted at the end.

## Stripe confirmations (API version `2026-09-30.endive`)

Fetched 2026-10-15 with WebFetch/WebSearch. "Confirmed" means the docs state it; "Unconfirmed" means the docs are silent or ambiguous and the batch that depends on it carries a test-mode probe.

### 1. Accounts v2 merchant account with a full Dashboard — **Confirmed**

Source: https://docs.stripe.com/api/v2/core/accounts/create.md (request/response example is stamped `Stripe-Version: 2026-09-30.endive`) and https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.

- Create with `POST /v2/core/accounts`: `dashboard: "full"`, `defaults.responsibilities.fees_collector: "stripe"`, `defaults.responsibilities.losses_collector: "stripe"`, `configuration.merchant.capabilities.card_payments.requested: true`, and `include: ["configuration.merchant","identity","defaults","requirements"]`.
- The ACH capability is **`configuration.merchant.capabilities.ach_debit_payments.requested: true`**. (`us_bank_transfer_payments` is a different capability — push-style bank transfer — and must not be requested.)
- `defaults.responsibilities` can't be changed after the merchant configuration is added, so the first create call must be right. `requirements_collector` is derived (`stripe`) and can't be set.
- Statement descriptor is settable at creation: `configuration.merchant.statement_descriptor.descriptor` (G15). Branding (`configuration.merchant.branding.logo/icon`) is also settable; v1 leaves branding to Stripe-hosted onboarding.
- Onboarding link: `POST /v2/core/account_links` with `account` and `use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], return_url, refresh_url } }`. The link is single-use and expires (the doc sample shows 10 minutes). Omitting the matching `configurations` yields `configs_must_match_to_use_account_links`. **The sample URL host is `https://accounts.stripe.com/r/acct_…`** (P3-10).
- Status fields in the v2 response: `configuration.merchant.capabilities.card_payments.status` (`active` …), and a `stripe_balance.payouts.status` entry under the merchant capabilities in the doc sample. **Unconfirmed:** the exact path of "payouts enabled" and the requirements shape (`requirements.summary` / `entries`) in this version. The retrieve-account projection therefore lives behind one pure mapper in `client.ts`/`status.ts`, unit-tested against a recorded test-mode response that the operator smoke captures (sanitized) in Batch 3.
- Events (https://docs.stripe.com/connect/webhooks): for Accounts v2, v2 objects emit **both** v1 snapshot events and v2 thin events with **different scopes**. v1 `account.updated` is delivered on the **Connected accounts** scope (our one endpoint), with top-level `account`; v2 thin events (`v2.core.account[...]`) use the **Your account** scope and would need a second, thin-event destination. **Ruling:** consume v1 `account.updated` only; no thin-event destination in v1. Batch 3's smoke must confirm `account.updated` arrives on the Connect endpoint for a v2 merchant account; the manual "Refresh status" action (retrieve account) is the fallback.
- `account.application.deauthorized` is documented as "available for connected accounts with access to the Stripe Dashboard" — which `dashboard: "full"` is.
- Production webhook URLs receive both live and test events; check `livemode` (already designed).

### 2. Paid invoice → PaymentIntent — **Confirmed**

Sources: https://docs.stripe.com/changelog/basil/2025-03-31/add-support-for-multiple-partial-payments-on-invoices, https://docs.stripe.com/api/invoice-payment, https://docs.stripe.com/api/invoice-payment/object.md.

- Since `2025-03-31.basil`, `Invoice.payment_intent`, `.charge`, `.paid`, `.paid_out_of_band` were **removed**, and `PaymentIntent.invoice`/`Charge.invoice` were removed. The link is the **InvoicePayment** object: `{ id: "inpay_…", invoice: "in_…", payment: { type: "payment_intent", payment_intent: "pi_…" }, amount_paid, amount_requested, currency, livemode, status: "open|paid|canceled", status_transitions.paid_at, created }`.
- There is an **`invoice_payment.paid`** event ("Occurs when an InvoicePayment is successfully paid"), so the webhook alone yields `(invoice id, pi_ id, amount_paid, livemode, created)`. It carries **no subscription or customer**.
- Therefore a renewal gift keyed on `pi_` needs one more fact — which subscription (hence which intent, fund, and customer) the invoice belongs to. **Ruling (P3-9): add `retrieveInvoiceForPayment(accountId, invoiceId)` to the `client.ts` allowlist.** It is a single retrieve of an invoice id named in an already-signed inbox event, projected inside `client.ts` to `{ subscriptionId, customerId, customerName, customerEmail, customerAddress, billingReason }` (the raw object never leaves the module), requires RAK `Invoices: Read` on connected accounts, and is neither a list nor a search nor a customer retrieve. It exposes nothing the corresponding `invoice.paid` webhook would not. If the retrieve fails, the event is `parked` and retried.
- Multiple payments per invoice (partial payments) exist in the model. A donation subscription has one default InvoicePayment per invoice; if more than one `invoice_payment.paid` ever arrives for one invoice, each is its own gift keyed on its own `pi_`.
- First payment of a **subscription-mode Checkout** also arrives as `invoice_payment.paid` (the session has no `payment_intent`). So gifts are created from `checkout.session.completed`/`async_payment_*` **only in payment mode**, and from `invoice_payment.paid` only for subscriptions. Subscription-mode `checkout.session.completed` records the subscription/customer on the intent and creates the donor, never a gift.

### 3. Billing portal for a direct-charge connected account — **Unconfirmed → not built in v1**

Sources: https://docs.stripe.com/api/customer_portal/sessions/create, https://docs.stripe.com/customer-management/integrate-customer-portal, https://docs.stripe.com/connect/subscriptions.

- `POST /v1/billing_portal/sessions` takes `customer`, `customer_account`, `configuration`, `return_url`, `on_behalf_of`, `flow_data`, `locale`. The docs' Connect guidance is: "If you're using the customer portal with Stripe Connect, make sure you configure the customer portal for the platform, not a connected account", and `on_behalf_of` is described for separate-charges-and-transfers. **Nothing documents a portal session for a customer that lives on a direct-charge connected account**, which `Stripe-Account` header would be required for, nor where its configuration lives.
- Documented and useful: "Only connected accounts with access to the full Stripe Dashboard can manage their customers' subscriptions" (ours have it), and after a disconnect "subscriptions continue to run on the connected account" (we take no application fee, so there is nothing to clean up).
- **Ruling:** v1 builds **no** portal session. A donor stops or changes a monthly gift by contacting the church; the treasurer cancels it in the congregation's own Stripe Dashboard. The return page, the member history page and the Stripe receipt copy say so (G17). A Batch 3 test-mode probe attempts a portal session with `Stripe-Account` for a direct-charge customer and records the result in the Batch 3 notes; if it works, a follow-up adds `createPortalSession` for confirmed-linked members only (R1.C's constraint stands).

### 4. R8 — restricted-key resources (https://docs.stripe.com/keys/permissions-reference, https://docs.stripe.com/keys/restricted-api-keys)

The reference lists each endpoint's RAK permission, and marks some **(Direct)** — "can't authorize Connect call patterns". The v1 `connected_account_*` and `account_link_write` permissions are (Direct); the v2 equivalents are not.

| Allowlisted call | Endpoint | RAK permission | Call pattern |
|---|---|---|---|
| createConnectedAccount | `POST /v2/core/accounts` | `v2_account_storer_write` | platform's own account |
| createOnboardingLink | `POST /v2/core/account_links` | `v2_account_storer_write` | platform's own account |
| retrieveConnectedAccount | `GET /v2/core/accounts/{id}` | `v2_account_storer_read` | platform's own account |
| createCheckoutSession | `POST /v1/checkout/sessions` | `checkout_session_write` | **Connect** (`Stripe-Account`) |
| retrieveBalanceTransaction, listBalanceTransactionsForPayout | `GET /v1/balance_transactions[/{id}]` | `balance_read` | **Connect** |
| retrieveEvent (replay) | `GET /v1/events/{id}` | `event_read` | **Connect** |
| retrieveInvoiceForPayment | `GET /v1/invoices/{id}` | `invoice_read` | **Connect** |

**Not granted:** Customers, Charges, Payment Intents, Subscriptions, Customer portal, Webhook endpoints, Refunds, Payouts, Transfers, anything in v1 `connected_account_*`. The dashboard key-creation flow has a separate per-permission choice for "when accessing connected accounts" (restricted-api-keys page, step 4); the four Connect-pattern rows above need it set. **Unconfirmed:** that the v2 account endpoints accept a `rk_` key in practice. Batch 3's smoke exercises create-account → account-link → retrieve with a test-mode RAK carrying exactly this set; if v2 refuses it, production falls back to the unrestricted key and a finding is logged (the allowlist module is unchanged either way).

## Permissions & Flags

**Keys** (tenant catalog, `permissions` table; never `FEATURES.*`; `src/lib/permissions.ts` stays frozen). All `module = 'giving'`, `sensitivity_tier = 2`, `requires_two_factor = true`:

| Key | Description | Reads | Writes |
|---|---|---|---|
| `giving.view` | View gifts, donors, settlements and statements; export gifts | everything in giving | nothing |
| `giving.record` | Record and void offline gifts, create donors, confirm donor links | the S4 scope only (P3-4) | offline gifts, donors, link confirm/dismiss |
| `giving.manage` | Connect Stripe, funds, settings, statements, giving team, donor contact edits and merges | connection, funds, settings, team | all configuration |

Rules that bind: statements **read** needs `giving.view`; **issue/re-issue** needs `giving.manage` *and* `giving.view` (a manage-only holder must not generate documents full of amounts they cannot otherwise read). No key implies another. No wildcard. No default binding to any role except the two templates below. The member self-view needs **no key** (identity-based, `self.ts`).

**Template roles** (0055, `organization_id IS NULL`, `organization_type_scope IS NULL` — NWCs are in scope and the scope column is single-valued; presbyteries cannot hold the keys because the toggle and designation both refuse them and `adoptTemplate()`'s subset check refuses the adopt):

| Id (to be confirmed free at Batch 1 start) | key | name | kind | protected | keys |
|---|---|---|---|---|---|
| `00000000-0000-0000-0000-000000000005` | `treasurer` | Treasurer | constitutional | true | `giving.view`, `giving.record`, `giving.manage` |
| `00000000-0000-0000-0000-000000000006` | `giving_recorder` | Giving Recorder | custom | false | `giving.record` |

DECISION-078 verdicts stand (Phase 2): `stated_clerk`, `session_member`, `installed_pastor`, `founding_administrator` get nothing. No group-arm binding anywhere.

**Org toggle** — `ORG_FEATURE_CATALOG` gains a required `orgTypes: readonly OrganizationType[] | null` on every entry (existing three: `null`) and:

```ts
{
  key: "org_portal.giving",
  name: "Giving",
  description: "Online giving, offline gift recording and year-end statements for this congregation. Turning this off hides every giving page; it never stops Stripe events from being recorded.",
  category: "giving" as const,
  flag: null,
  provisionedOn: false as const,
  orgTypes: ["congregation", "new_worshiping_community"] as const,
}
```

- Enforced in `listFeatureToggles` (omits inapplicable entries; reads `organizations.organization_type` once in the same tx, only when some entry has non-null `orgTypes`), `toggleOrgFeature` (returns the existing `invalid_key` for an inapplicable org type; same one read), and `orgFeatureEnabledInTx` (returns `false` for an inapplicable type; one read, only when the entry's `orgTypes` is non-null — so the calendar and people entries pay nothing).
- The `giving` category is already in `PortalDomain`/`OrgFeatureCategory`; the fourth (category) axis composes unchanged.
- **Platform flag**: none. 0055 deletes the `feature_flags` row `org_portal.giving`; `scripts/seed.ts` stops seeding it; `tiles.test.ts:75`'s hard-coded seed snapshot drops it; a Vitest test asserts no `src/**` file calls `isFlagEnabled("org_portal.giving")` (S1's tripwire also greps for it).
- **Existing orgs and new orgs: OFF** (a missing row is off). `createOrganization()` is unchanged (it only writes `provisionedOn` entries). 0055 backfills no toggle rows.

**Tiles** (`src/lib/org-portal/tiles.ts`): replace the placeholder with

| key | label | href | category | domain | gate | orgTypeScope |
|---|---|---|---|---|---|---|
| `giving` | Giving | `/o/<slug>/giving` | operate | giving | `orgFeatureKey: "org_portal.giving"` | `["congregation","new_worshiping_community"]` |
| `giving-admin` | Manage giving | `/o/<slug>/admin/giving` | administer | giving | same | same |

No `flagKey`, no `comingSoon`. `tiles.test.ts` pins `tile.orgTypeScope` equal to the catalog entry's `orgTypes` (set-equality). Tiles stay permission-blind (DECISION-162); the admin destination renders its own Forbidden. `tile-icons.tsx` maps `giving-admin` to `HandCoins`'s sibling (`Landmark`) so the two tiles are distinguishable.

**Gate order on every surface** (stated once, used by every page, action and route handler below):

1. Edge: authentication, active, 2FA claim (`src/proxy.ts`, unchanged).
2. `cachedAuth()`/`auth()` → `resolveOrgContext()` (four-way miss) → `assertOrgAccess()`.
3. **Node-side 2FA check (R4)**: refuse when `session.user.twoFactorRequired && !session.user.twoFactorVerified` — pages `redirect('/totp?callbackUrl=<sanitized path>')`; actions return `{ kind: "two_factor_required" }`; route handlers return a `307` to the same URL. Applies to every `admin/giving/**` surface and action. The member `giving/**` pages are **not** forced.
4. Org-type applicability, then the org toggle (`orgFeatureEnabledInTx`): off → an honest "Giving isn't turned on for this organization" state (never a 404), with a link to Features only if the viewer holds `org_features.manage` (that read comes from the function result, not a second page-level permission read — DECISION-162).
5. Permission (`presby_has_permission`) for admin surfaces; confirmed link for the member self-view; nothing for the public give page (it checks toggle on **and** `public_enabled_at` **and** connection `active` **and** at least one online fund, all inside `presby_public_giving_config`).

Ingest (webhook, cron, replay) never reads the toggle.

**`AUDIT_ACTIONS` keys — all declared up front in Batch 1** (`src/lib/audit.ts`, appended, with one comment block; later batches never edit that file). Metadata is ids and counts only — never names, emails, addresses or amounts-with-identity beyond `amountCents` where noted.

| Key | String value | Actor | Written from |
|---|---|---|---|
| `ORG_TREASURER_DESIGNATED` | `org.treasurer.designated` | platform | `(admin)/admin/organizations/[id]/actions.ts` |
| `ORG_GIVING_EVENT_REQUEUED` | `org.giving_event.requeued` | platform | `(admin)/admin/giving/actions.ts` |
| `GIVING_CONNECTION_CREATED` | `tenant.giving_connection.created` | user | `admin/giving/connect/actions.ts` |
| `GIVING_CONNECTION_STATUS_CHANGED` | `tenant.giving_connection.status_changed` | system | `ingest/process.ts`, return page action |
| `GIVING_CONNECTION_DISCONNECTED` | `tenant.giving_connection.disconnected` | user or system (deauthorized) | connect actions, `ingest/process.ts` |
| `GIVING_PUBLIC_PAGE_TOGGLED` | `tenant.giving_connection.public_toggled` | user | connect actions (go-live / take-offline; metadata `{enabled}`) |
| `GIVING_CONNECTION_RATES_CHANGED` | `tenant.giving_connection.rates_changed` | user | settings actions |
| `GIVING_FUND_CREATED` / `_UPDATED` / `_RETIRED` / `_REACTIVATED` | `tenant.giving_fund.created` / `.updated` / `.retired` / `.reactivated` | user | `funds/actions.ts` |
| `GIVING_SETTINGS_CHANGED` | `tenant.giving_settings.changed` | user | `settings/actions.ts` (field names only) |
| `GIVING_GIFT_RECORDED` | `tenant.giving_gift.recorded` | user | `gifts/actions.ts` (offline) |
| `GIVING_GIFT_VOIDED` | `tenant.giving_gift.voided` | user | `gifts/actions.ts` |
| `GIVING_REVERSAL_RECORDED` | `tenant.giving_reversal.recorded` | system | `ingest/process.ts` (refund, dispute, ach_return, reinstatement) |
| `GIVING_EVENT_DEAD_LETTERED` | `tenant.giving_event.dead_lettered` | system | `ingest/process.ts` |
| `GIVING_DONOR_CREATED` | `tenant.giving_donor.created` | user | `donors/actions.ts` |
| `GIVING_DONOR_CONTACT_CHANGED` | `tenant.giving_donor.contact_changed` | user | `donors/actions.ts` (which fields only) |
| `GIVING_DONOR_MERGED` | `tenant.giving_donor.merged` | user | `donors/actions.ts` |
| `GIVING_DONOR_LINK_CONFIRMED` / `_REMOVED` / `_DISMISSED` | `tenant.giving_donor.link_confirmed` / `.link_removed` / `.link_dismissed` | user | `donors/actions.ts` |
| `GIVING_DONOR_AUTOLINKED` / `_LINK_CONFLICT` | `tenant.giving_donor.autolinked` / `.link_conflict` | system | `ingest/process.ts` |
| `GIVING_GIFTS_EXPORTED` | `tenant.giving_gifts.exported` | user | `gifts/export/route.ts` (row count + filters, hand-audited) |
| `GIVING_STATEMENT_ISSUED` / `_REISSUED` | `tenant.giving_statement.issued` / `.reissued` | user | `statements/actions.ts` |
| `GIVING_STATEMENT_NOTICE_SENT` | `tenant.giving_statement.notice_sent` | user | `statements/actions.ts` |
| `GIVING_STATEMENT_DELIVERY_RECORDED` | `tenant.giving_statement.delivery_recorded` | user | `statements/actions.ts` |
| `GIVING_STATEMENT_DOWNLOADED` | `tenant.giving_statement.downloaded` | user | download route handlers (treasurer and member; hand-audited) |
| `GIVING_STATEMENTS_BULK_DOWNLOADED` | `tenant.giving_statements.bulk_downloaded` | user | print-run route (hand-audited) |

The giving-team grant/revoke reuses `TENANT_ROLE_GRANTED`/`TENANT_ROLE_REVOKED` with `metadata.path = "giving_team"`; the toggle reuses `ORG_FEATURE_TOGGLED`. `check:audit` scans only `actions.ts`; route handlers and `ingest/process.ts` are hand-audited and QA reads them.

## Data Model

**One migration, `drizzle/0055_presby_giving.sql`**, hand-written, whole-file idempotent (every statement `if not exists` / `on conflict` / drop-then-add), applied twice end to end as the proof. Statements tables go to **`0056_presby_giving_statements.sql`** with Batch 5. `drizzle/meta/_journal.json` entries (`{ idx: 55, tag: "0055_presby_giving" }`, later `56`) and `src/lib/db/domain/index.ts`'s `export * from "./giving"` are integration-only. Drizzle shapes live in **`src/lib/db/domain/giving.ts`**; the migration is ground truth.

### Feasibility checks run against the live tree (Phase 3 gate)

| Check | Result |
|---|---|
| Function signatures: defaults trail required | Only `presby_giving_finish_event(…, p_error_code text default null)` and `presby_giving_due_events(p_limit integer default 25)` carry defaults, both last. |
| `create or replace presby_two_factor_required(uuid)` | Same signature and return type. Callers: `computeEffectiveTwoFactor` → `organizationRequiresTwoFactor` (`src/lib/auth/local-login.ts`) only. No SECURITY DEFINER body in `drizzle/` references it (grep of `drizzle/*.sql`: 0013 definition, 0014/0015 comments, 0048 `alter function … set search_path`). `create or replace` resets `proconfig`, so the new definition **must restate** `set search_path = public, pg_temp`; the ACL is preserved but 0055 restates revoke/grant. |
| `alter table permissions add column requires_two_factor` | `presby_effective_permissions()` selects `pm.key, pm.sensitivity_tier` by name; adding a column is inert. `src/lib/db/domain/authz.ts` `permissions` **must** gain `requiresTwoFactor` or `check:schema-parity` reports `extra_column`. |
| `delete from feature_flags where key='org_portal.giving'` | Callers: `admin/giving/page.tsx`, `tiles.ts`, `scripts/seed.ts`, `tiles.test.ts`, `visible-tiles.test.ts`, `admin/giving/page.test.tsx` — all rewritten in Batches 1–2. No SECURITY DEFINER body reads the row. |
| New triggers on `administrative_commissions`, `org_delegations`, `app_role_permissions` vs `scripts/seed-dev.sql` | The only seeded commission (`seed-dev.sql:680`) uses role `f…0001` (`session_member`), no giving key. The fixture treasurer role `f…0007` is referenced by no commission or delegation. No existing row is refused. |
| New CHECKs | All on new tables; no fixture rows exist yet. The seed block (below) is written to satisfy them. |
| New FKs — which column carries the tenant id | Every giving table carries `organization_id`; `memberships (id, organization_id)` and `blob_assets (id, organization_id)` unique keys exist (Phase 2 live read). Every inter-table FK below names `organization_id` on both sides. `giving_provider_events` is referenced by gifts/reversals as `(source_event_id, organization_id)`; RI checks run as the referenced table's owner, so the FK needs no privilege for `presby_app`. |
| `deletable_until` cascade | See P3-8: the guard cannot consult the parent row (already deleted when the RI cascade runs), so "parent absent" is the sanctioned-cascade signal. **Batch 1 must prove it empirically** (test below) before relying on it. |

### 0055 — DDL

```sql
-- §1  the provider enum (one value; Vanco arrives as `alter type … add value`)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'giving_provider') then
    create type giving_provider as enum ('stripe');
  end if;
end $$;

-- §2  permission catalog
alter table permissions add column if not exists requires_two_factor boolean not null default false;
comment on column permissions.requires_two_factor is
  'When true, holding this key at any active membership requires 2FA at sign-in (read by presby_two_factor_required(); DECISION-170/175). Only the three giving keys set it in 0055; extending it to tier-3 keys is a tracked follow-up (S2).';
insert into permissions (key, module, description, sensitivity_tier, requires_two_factor) values
  ('giving.view',   'giving', 'View gifts, donors, settlements and statements, and export gifts', 2, true),
  ('giving.record', 'giving', 'Record and void offline gifts, create donors, and confirm donor-to-member links', 2, true),
  ('giving.manage', 'giving', 'Connect the congregation''s Stripe account; manage funds, giving settings, statements and the giving team', 2, true)
on conflict (key) do update set module = excluded.module, description = excluded.description,
  sensitivity_tier = excluded.sensitivity_tier, requires_two_factor = excluded.requires_two_factor;

-- §3  giving_settings — the donee identity (R5). PK is organization_id like organization_settings;
--     nothing references it (statements snapshot it), so it carries no (id, organization_id) key.
create table if not exists giving_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  donee_legal_name text, donee_address_line1 text, donee_address_line2 text,
  donee_city text, donee_region text, donee_postal_code text, donee_ein text,
  signatory_name text, signatory_title text, greeting_text text, closing_text text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
-- CHECKs (drop-then-add): legal name trimmed 1–200; address parts ≤120; region ~ '^[A-Z]{2}$';
-- postal ~ '^[0-9]{5}(-[0-9]{4})?$'; ein ~ '^[0-9]{2}-[0-9]{7}$'; signatory ≤120; greeting/closing ≤500.

-- §4  connections
create table if not exists giving_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider giving_provider not null,
  external_account_id text not null,
  livemode boolean not null,
  status text not null default 'onboarding',
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  card_enabled boolean not null default false,
  ach_enabled boolean not null default false,
  requirements_due boolean not null default false,
  disabled_reason text,
  card_fee_bps integer not null default 290,
  card_fee_fixed_cents integer not null default 30,
  ach_fee_bps integer not null default 80,
  ach_fee_cap_cents integer not null default 500,
  payouts_attested_at timestamptz, payouts_attested_by uuid references users(id),
  public_enabled_at timestamptz,   public_enabled_by uuid references users(id),
  disconnected_at timestamptz, disconnected_reason text,
  last_status_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giving_connections_id_org_key unique (id, organization_id),
  constraint giving_connections_provider_account_key unique (provider, external_account_id)
);
-- CHECKs: external_account_id ~ '^acct_[A-Za-z0-9]{8,64}$'; status in ('onboarding','active','restricted','disconnected');
-- fee rates bounded (bps 0–1000/0–500, fixed 0–100, cap 0–2000); disabled_reason ≤120;
-- (status = 'disconnected') = (disconnected_at is not null); disconnected_reason in ('treasurer','deauthorized') or null,
-- required when disconnected; public_enabled_at is null or payouts_attested_at is not null.
create unique index if not exists giving_connections_one_open_idx
  on giving_provider_connections (organization_id) where status <> 'disconnected';

-- §5  funds
create table if not exists giving_funds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  online_display_name text,
  description text,
  restriction_class text not null default 'unrestricted',
  offered_online boolean not null default false,
  is_active boolean not null default true,
  retired_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references users(id), created_at timestamptz not null default now(),
  updated_by uuid references users(id), updated_at timestamptz not null default now(),
  constraint giving_funds_id_org_key unique (id, organization_id)
);
-- CHECKs: name trimmed 1–80; online_display_name null or trimmed 1–80; description ≤500;
-- restriction_class in ('unrestricted','temporarily_restricted','permanently_restricted');
-- (not offered_online) or (is_active and online_display_name is not null);   -- G23: nothing public by default
-- is_active = (retired_at is null).
create unique index if not exists giving_funds_org_lower_name_idx on giving_funds (organization_id, lower(name));

-- §6  donors — no person_id (schema-design §7). Link is a composite reference to memberships.
create table if not exists giving_donors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null default 'identified',
  display_name text not null,
  email text,
  address_line1 text, address_line2 text, city text, region text, postal_code text,
  country text not null default 'US',
  linked_membership_id uuid, link_source text, linked_at timestamptz, linked_by uuid references users(id),
  merged_into_id uuid, merged_at timestamptz, merged_by uuid references users(id),
  created_by uuid references users(id), created_at timestamptz not null default now(),
  updated_by uuid references users(id), updated_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_donors_id_org_key unique (id, organization_id),
  constraint giving_donors_link_fk  foreign key (linked_membership_id, organization_id) references memberships (id, organization_id),
  constraint giving_donors_merge_fk foreign key (merged_into_id, organization_id) references giving_donors (id, organization_id)
);
-- CHECKs: kind in ('identified','unidentified'); display_name trimmed 1–120;
-- email null or (email = lower(btrim(email)) and ≤254 and ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
-- address parts ≤120, country ~ '^[A-Z]{2}$';
-- link_source in ('self_online','recorder_confirmed') or null; (linked_membership_id is null) = (link_source is null) = (linked_at is null);
-- (merged_into_id is null) = (merged_at is null) and merged_into_id is distinct from id;
-- kind = 'identified' or (email, every address part, linked_membership_id, merged_into_id all null).
create unique index if not exists giving_donors_one_unidentified_idx on giving_donors (organization_id) where kind = 'unidentified';
create index if not exists giving_donors_org_name_idx  on giving_donors (organization_id, lower(display_name));
create index if not exists giving_donors_org_email_idx on giving_donors (organization_id, email) where email is not null;
create index if not exists giving_donors_org_link_idx  on giving_donors (organization_id, linked_membership_id) where linked_membership_id is not null;
create index if not exists giving_donors_org_merged_idx on giving_donors (organization_id, merged_into_id) where merged_into_id is not null;

-- §7  provider identities and dismissed link proposals
create table if not exists giving_donor_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null, connection_id uuid not null,
  external_customer_id text not null check (external_customer_id ~ '^cus_[A-Za-z0-9]{8,64}$'),
  created_at timestamptz not null default now(),
  constraint giving_identities_id_org_key unique (id, organization_id),
  constraint giving_identities_customer_key unique (connection_id, external_customer_id),
  constraint giving_identities_donor_fk foreign key (donor_id, organization_id) references giving_donors (id, organization_id),
  constraint giving_identities_conn_fk  foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id)
);
create index if not exists giving_identities_donor_idx on giving_donor_identities (organization_id, donor_id);

create table if not exists giving_donor_link_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null, membership_id uuid not null,
  decision text not null check (decision = 'dismissed'),
  decided_by uuid references users(id), decided_at timestamptz not null default now(),
  constraint giving_link_decisions_id_org_key unique (id, organization_id),
  constraint giving_link_decisions_once_key unique (donor_id, membership_id),
  constraint giving_link_decisions_donor_fk foreign key (donor_id, organization_id) references giving_donors (id, organization_id),
  constraint giving_link_decisions_member_fk foreign key (membership_id, organization_id) references memberships (id, organization_id)
);

-- §8  checkout intents — the ONLY path from a Stripe payment to a gift (R9). Carries no donor PII.
create table if not exists giving_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null, fund_id uuid not null,
  membership_id uuid,                       -- null on the public page; set only by the member path
  donor_id uuid,                            -- set when the donor is first resolved
  frequency text not null, method_choice text not null, cover_fees boolean not null default false,
  gift_amount_cents integer not null,        -- the gift itself (G); the gift row's amount_cents is the TOTAL charged
  donor_covered_fee_cents integer not null default 0, total_cents integer not null,
  currency text not null default 'usd', livemode boolean not null,
  idempotency_key text not null,
  status text not null default 'created',
  checkout_session_id text, payment_intent_id text, subscription_id text, customer_id text,
  expires_at timestamptz not null,
  completed_at timestamptz, subscription_ended_at timestamptz, last_payment_failed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint giving_intents_id_org_key unique (id, organization_id),
  constraint giving_intents_idem_key unique (organization_id, idempotency_key),
  constraint giving_intents_conn_fk   foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id),
  constraint giving_intents_fund_fk   foreign key (fund_id, organization_id) references giving_funds (id, organization_id),
  constraint giving_intents_member_fk foreign key (membership_id, organization_id) references memberships (id, organization_id),
  constraint giving_intents_donor_fk  foreign key (donor_id, organization_id) references giving_donors (id, organization_id)
);
-- CHECKs: frequency in ('once','monthly'); method_choice in ('card','bank','either'); cover_fees → method_choice <> 'either';
-- gift_amount_cents between 100 and 2500000 ($1–$25,000); donor_covered_fee_cents ≥ 0; total_cents = gift_amount_cents + donor_covered_fee_cents;
-- currency = 'usd'; idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- status in ('created','open','completed','expired','failed'); external ids shaped (cs_/pi_/sub_/cus_).
create unique index if not exists giving_intents_session_idx on giving_checkout_intents (connection_id, checkout_session_id) where checkout_session_id is not null;
create unique index if not exists giving_intents_subscription_idx on giving_checkout_intents (connection_id, subscription_id) where subscription_id is not null;
create index if not exists giving_intents_org_status_idx on giving_checkout_intents (organization_id, status, created_at);

-- §9  the provider-events inbox (R6). presby_app holds NO privilege here; only DEFINER functions touch it.
create table if not exists giving_provider_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  provider giving_provider not null,
  external_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  raw_body text,                              -- exact signed bytes (text, not jsonb: §9 rule 5); nulled 90 days after a terminal status
  body_purged_at timestamptz,
  status text not null default 'received',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,                            -- a short code only, never a payload fragment
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint giving_events_id_org_key unique (id, organization_id),
  constraint giving_events_once_key unique (connection_id, external_event_id),
  constraint giving_events_conn_fk foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id)
);
-- CHECKs: status in ('received','processing','applied','ignored','parked','dead_letter'); attempts ≥ 0;
-- external_event_id ~ '^evt_[A-Za-z0-9_]{8,64}$'; last_error ≤ 60 and ~ '^[a-z0-9_:]*$'; octet_length(raw_body) ≤ 1000000;
-- (body_purged_at is null) = (raw_body is not null).
create index if not exists giving_events_due_idx on giving_provider_events (next_attempt_at) where status in ('received','parked','processing');

-- §10 gifts. Writes ONLY through DEFINER functions (P3-7). amount_cents is the TOTAL charged;
--     donor_covered_fee_cents is the part the donor added to cover fees (its own column: the statement
--     policy is one constant, G10). For stock, amount_cents is the recorded value for the congregation's
--     books and is never printed on a statement.
create table if not exists giving_gifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null, fund_id uuid not null,
  source text not null,
  provider giving_provider, connection_id uuid, intent_id uuid, external_transaction_id text,
  method text,
  check_number text, stock_description text, stock_quantity numeric(18,6), memo text,
  amount_cents integer not null,
  donor_covered_fee_cents integer not null default 0,
  fee_cents integer, net_cents integer,
  currency text not null default 'usd',
  status text not null,
  failure_code text,
  occurred_on date not null,                 -- the ORG-LOCAL date of authorization; statement year derives from this alone
  occurred_at timestamptz,                   -- null for offline gifts
  livemode boolean not null,
  recorded_by uuid references users(id),     -- offline only
  source_event_id uuid,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_gifts_id_org_key unique (id, organization_id),
  constraint giving_gifts_donor_fk  foreign key (donor_id, organization_id) references giving_donors (id, organization_id),
  constraint giving_gifts_fund_fk   foreign key (fund_id, organization_id) references giving_funds (id, organization_id),
  constraint giving_gifts_conn_fk   foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id),
  constraint giving_gifts_intent_fk foreign key (intent_id, organization_id) references giving_checkout_intents (id, organization_id),
  constraint giving_gifts_event_fk  foreign key (source_event_id, organization_id) references giving_provider_events (id, organization_id)
);
-- CHECKs:
--   source in ('online','offline'); status in ('pending','succeeded','failed'); currency = 'usd';
--   amount_cents between 1 and 100000000; donor_covered_fee_cents ≥ 0 and < amount_cents;
--   occurred_on ≥ date '2000-01-01'; check_number/stock_description/memo/failure_code length bounds;
--   method in ('card','us_bank_account','wallet','cash','check','stock','other') or null;
--   online:  provider, connection_id, intent_id, external_transaction_id, occurred_at all NOT NULL, recorded_by null,
--            method null or in ('card','us_bank_account','wallet');
--   offline: provider, connection_id, intent_id, external_transaction_id, occurred_at, fee_cents all null; recorded_by not null;
--            livemode; status = 'succeeded'; method in ('cash','check','stock','other'); donor_covered_fee_cents = 0;
--   check_number only when method = 'check'; (method = 'stock') = (stock_description is not null);
--   stock_quantity only when method = 'stock'; (fee_cents is null) = (net_cents is null); net_cents = amount_cents − fee_cents;
--   fee_cents ≥ 0.
create unique index if not exists giving_gifts_txn_idx on giving_gifts (connection_id, external_transaction_id) where external_transaction_id is not null;
create index if not exists giving_gifts_org_date_idx   on giving_gifts (organization_id, occurred_on desc, id desc);
create index if not exists giving_gifts_org_donor_idx  on giving_gifts (organization_id, donor_id, occurred_on);
create index if not exists giving_gifts_org_fund_idx   on giving_gifts (organization_id, fund_id);
create index if not exists giving_gifts_org_status_idx on giving_gifts (organization_id, status, status_changed_at) where status <> 'succeeded';
create index if not exists giving_gifts_org_rec_idx    on giving_gifts (organization_id, recorded_by, created_at) where recorded_by is not null;

-- §11 reversals — insert-only (P3-12)
create table if not exists giving_gift_reversals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  gift_id uuid not null, connection_id uuid,
  kind text not null,
  amount_cents integer not null,
  external_reversal_id text, offsets_reversal_id uuid,
  reason text,
  occurred_on date not null, occurred_at timestamptz,
  recorded_by uuid references users(id),       -- void only
  livemode boolean not null,
  source_event_id uuid,
  created_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_reversals_id_org_key unique (id, organization_id),
  constraint giving_reversals_gift_fk    foreign key (gift_id, organization_id) references giving_gifts (id, organization_id),
  constraint giving_reversals_conn_fk    foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id),
  constraint giving_reversals_offsets_fk foreign key (offsets_reversal_id, organization_id) references giving_gift_reversals (id, organization_id),
  constraint giving_reversals_event_fk   foreign key (source_event_id, organization_id) references giving_provider_events (id, organization_id)
);
-- CHECKs: kind in ('refund','dispute','ach_return','void','reinstatement'); amount_cents > 0; reason ≤200;
--   void:          reason not null, recorded_by not null, connection_id/external_reversal_id/offsets_reversal_id null;
--   refund|dispute|ach_return: connection_id and external_reversal_id not null, offsets null, recorded_by null;
--   reinstatement: connection_id, external_reversal_id, offsets_reversal_id not null.
create unique index if not exists giving_reversals_ext_idx  on giving_gift_reversals (connection_id, external_reversal_id) where external_reversal_id is not null;
create unique index if not exists giving_reversals_void_idx on giving_gift_reversals (gift_id) where kind = 'void';
create index if not exists giving_reversals_gift_idx on giving_gift_reversals (organization_id, gift_id);

-- §12 settlements (read-only; Batch 6 is the droppable reader). bigint aggregates; lines are signed (P3-13).
create table if not exists giving_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null,
  external_settlement_id text not null,
  arrival_date date, status text not null, automatic boolean not null default true,
  gross_cents bigint not null, livemode boolean not null,
  lines_loaded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint giving_settlements_id_org_key unique (id, organization_id),
  constraint giving_settlements_ext_key unique (connection_id, external_settlement_id),
  constraint giving_settlements_conn_fk foreign key (connection_id, organization_id) references giving_provider_connections (id, organization_id)
);   -- status in ('paid','failed'); gross_cents ≥ 0; external_settlement_id ~ '^po_[A-Za-z0-9_]{8,64}$'
create table if not exists giving_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  settlement_id uuid not null, gift_id uuid,
  external_balance_transaction_id text not null, payment_intent_id text,
  kind text not null, gross_cents bigint not null, fee_cents bigint not null, net_cents bigint not null,
  constraint giving_settlement_lines_id_org_key unique (id, organization_id),
  constraint giving_settlement_lines_txn_key unique (settlement_id, external_balance_transaction_id),
  constraint giving_settlement_lines_settlement_fk foreign key (settlement_id, organization_id) references giving_settlements (id, organization_id),
  constraint giving_settlement_lines_gift_fk foreign key (gift_id, organization_id) references giving_gifts (id, organization_id)
);   -- kind in ('charge','refund','dispute','fee','adjustment','other'); net_cents = gross_cents − fee_cents
```

All FKs above are the Postgres default **NO ACTION** (never RESTRICT — immediate checks can fail the statement-level `deletable_until` cascade, DECISION-161); every `organization_id` FK to `organizations` is `on delete cascade` as in 0054. All `drop constraint if exists … ; add constraint …` pairs for CHECKs follow the 0054 idiom so an in-place correction takes effect.

### 0055 — RLS, grants, comments

- **RLS:** `enable` + **`force`** + `tenant_isolation` (`using` and `with check (organization_id = presby_current_org())`) on all twelve tables, in one `do $$ foreach` block (0020's shape). `giving_provider_events` carries the policy too, although no tenant role can reach it: if a grant is ever added by mistake, tenancy still holds.
- **Grants** (`presby_platform` receives **nothing** on any giving table: nobody logs in as it and platform reach is the owner connection's; §46 asserts it):

| Table | `presby_app` |
|---|---|
| `giving_settings` | SELECT, INSERT, UPDATE |
| `giving_provider_connections` | SELECT, INSERT, **UPDATE (public_enabled_at, public_enabled_by, payouts_attested_at, payouts_attested_by, card_fee_bps, card_fee_fixed_cents, ach_fee_bps, ach_fee_cap_cents, updated_at)** column-level. Status/flags move only through DEFINER functions. |
| `giving_funds` | SELECT, INSERT, UPDATE |
| `giving_donors` | SELECT, INSERT, UPDATE |
| `giving_donor_identities` | SELECT |
| `giving_donor_link_decisions` | SELECT, INSERT |
| `giving_checkout_intents` | SELECT |
| `giving_provider_events` | **none** (`revoke all … from presby_app, presby_platform, public` — an `alter default privileges` may have granted otherwise; assert, don't assume, F38) |
| `giving_gifts`, `giving_gift_reversals` | SELECT |
| `giving_settlements`, `giving_settlement_lines` | SELECT |

  **No DELETE grant on any table.** `revoke delete … from presby_app, presby_platform` is restated per table so an in-place re-apply corrects a hand-added grant.
- Every table and every non-obvious column gets a `comment on` (the 0054 style), including the P3-7 marker and the `amount_cents` = total semantics.

### 0055 — triggers (fire on every connection, the owner path included — F44)

| Trigger | Table / event | Rule |
|---|---|---|
| `giving_donors_guard` | `giving_donors` BEFORE INSERT OR UPDATE | `kind` immutable; a merge target must itself be unmerged (`merged_into_id` depth ≤ 1); a donor that other donors point at cannot itself be merged until they are repointed; a merged donor takes no further field updates except `updated_*`; `unidentified` donors reject every contact/link/merge field (also a CHECK). |
| `giving_donors_delete_guard` | `giving_donors` BEFORE DELETE | Refuse unless **(A)** `old.deletable_until` is non-null and in the future **or (B)** `not exists (select 1 from organizations where id = old.organization_id)` (P3-8). SECURITY DEFINER, `search_path = public, pg_temp`. Same function body parameterised by table name for gifts, reversals, events, and (0056) statements. |
| `giving_connections_status_guard` | `giving_provider_connections` BEFORE UPDATE OF status | `disconnected` is terminal. |
| `giving_gifts_write_guard` | `giving_gifts` BEFORE INSERT OR UPDATE | Requires `current_setting('presby.giving_write_active', true) = 'true'`. UPDATE additionally allows **only**: `status` `pending→succeeded|failed` (sets `status_changed_at = now()`; `failure_code` null→value only on `→failed`), `fee_cents`+`net_cents` null→value together (set-once), `method` null→value on an online gift, `donor_id` repoint is **not** allowed. Everything else raises (compared via `to_jsonb(old) - cols = to_jsonb(new) - cols`, the 0047 idiom). |
| `giving_gifts_delete_guard` | `giving_gifts` BEFORE DELETE | As above (A or B). |
| `giving_reversals_write_guard` | `giving_gift_reversals` BEFORE INSERT OR UPDATE | INSERT requires the marker; UPDATE always raises. |
| `giving_reversals_bound` | `giving_gift_reversals` BEFORE INSERT | The gift must be `succeeded`; `void` only on an `offline` gift; `reinstatement.offsets` must reference a non-reinstatement reversal of the same gift and `amount ≤ offsetted − already reinstated`; net reversed (refund+dispute+ach_return+void − reinstatement) must stay within `0..gift.amount_cents`. The apply function catches the raise and dead-letters with `over_reversal` (reality is never silently clamped). |
| `giving_reversals_delete_guard`, `giving_events_delete_guard` | as above | A or B. |
| `administrative_commissions_giving_guard`, `org_delegations_giving_guard` | BEFORE INSERT OR UPDATE OF role_id | DECISION-175 (1): refuse a role that carries any key with `permissions.module = 'giving'`. |
| `app_role_permissions_giving_guard` | `app_role_permissions` BEFORE INSERT | Refuse binding a giving-module key to a role currently referenced by a commission or delegation. SECURITY DEFINER (it must see across orgs — F26). |

The marker `presby.giving_write_active` is armed (`set_config(…, 'true', true)`) at the top of every writer function below and disarmed (`'false'`) at the bottom — the 0052 shape. `scripts/seed-dev.sql` and `e2e/support` fixtures arm it explicitly before inserting gifts/reversals (`src/lib/testing/giving-fixture.ts` exports `armGivingWrite()`).

### 0055 — the SECURITY DEFINER family

Every function: `language plpgsql` (or `sql`), `security definer`, `set search_path = public, pg_temp` (DECISION-148), `revoke all … from public`, then an explicit grant. **Org-derivation rule, one per caller class:** webhook/cron path = inbox row → connection row → organization (never a parameter); public path = `p_slug` → `organizations.slug`; tenant path = `presby_current_org()` (already verified by `withOrgContext`) with a uniform `insufficient_privilege` when null; owner-only = no org needed.

| Function | Grant | Org derived from | Purpose / vocabulary |
|---|---|---|---|
| `presby_giving_ingest_event(p_provider giving_provider, p_account text, p_event_id text, p_livemode boolean, p_event_type text, p_raw_body text) → table(outcome text, inbox_id uuid)` | presby_app | connection by `(provider, external_account_id)` | `accepted` / `duplicate` / `ignored` (unknown account, malformed ids, or `livemode ≠ connection.livemode`; writes nothing). Resolves the connection **regardless of its status** (a disconnected connection still ingests, G22). |
| `presby_giving_claim_event(p_inbox_id uuid) → table(raw_body text, event_type text, attempts int, body_purged boolean, connection_id uuid, external_account_id text, livemode boolean)` | presby_app | inbox | Zero rows unless claimable (`received`/`parked` and due, or `processing` with an expired lease); sets `processing`, `locked_until = now() + 2 min`, `attempts + 1`. |
| `presby_giving_finish_event(p_inbox_id uuid, p_outcome text, p_error_code text default null) → text` | presby_app | inbox | `p_outcome` ∈ `applied`, `ignored`, `parked`, `failed`, `dead`. `parked`/`failed` schedule `next_attempt_at` by backoff (1, 5, 15, 60, 240, 720 min); `failed` with `attempts ≥ 8` becomes `dead_letter`; `parked` with reason `no_gift`/`no_subscription` ages out to `ignored` 24 h after `received_at`. Sets `processed_at` on terminal states. |
| `presby_giving_due_events(p_limit integer default 25) → table(inbox_id uuid)` | presby_app | system | Due `received`/`parked` rows and expired leases, oldest first. Cross-org by nature; returns opaque ids only (residual accepted, DECISION-171). |
| `presby_giving_apply_gift(p_inbox_id uuid, p_status text, p_session_id text, p_subscription_id text, p_invoice_id text, p_payment_intent_id text, p_amount_cents integer, p_authorized_at timestamptz, p_failure_code text, p_customer_id text, p_donor_name text, p_donor_email text, p_addr_line1 text, p_addr_line2 text, p_addr_city text, p_addr_region text, p_addr_postal text, p_addr_country text, p_method text) → text` | presby_app | inbox | `p_status` ∈ pending/succeeded/failed. Intent by session (payment mode) or subscription (renewal). No intent for a session → `ignored:no_intent`. No intent yet for a subscription → `parked:no_subscription`. Resolves/creates donor + identity (P3-15), computes `occurred_on` **in SQL** (`(p_authorized_at at time zone coalesce((select time_zone from organization_settings where organization_id = v_org), 'America/New_York'))::date`, F132), inserts the gift idempotently on `(connection_id, external_transaction_id)` or applies a legal `pending → succeeded|failed` transition, marks the intent completed. Fund and membership come **from the intent only**. First-payment `amount ≠ intent.total_cents` → `dead:amount_mismatch`; a renewal that differs records the collected amount with `donor_covered_fee_cents = 0`. Returns `applied`, `applied:autolinked`, `applied:link_conflict`, `noop`, `parked:<code>`, `ignored:<code>`, `dead:<code>`. |
| `presby_giving_apply_gift_fee(p_inbox_id uuid, p_payment_intent_id text, p_fee_cents integer, p_net_cents integer, p_method text) → text` | presby_app | inbox | Set-once fee/net (and method) on an existing gift; `parked:no_gift` if the gift isn't there yet. |
| `presby_giving_apply_reversal(p_inbox_id uuid, p_payment_intent_id text, p_kind text, p_external_reversal_id text, p_amount_cents integer, p_occurred_at timestamptz, p_offsets_external_reversal_id text) → text` | presby_app | inbox | Idempotent on `(connection_id, external_reversal_id)`; `parked:no_gift`; over-reversal → `dead:over_reversal`. |
| `presby_giving_apply_subscription(p_inbox_id uuid, p_kind text, p_session_id text, p_subscription_id text, p_customer_id text, p_donor_name text, p_donor_email text, p_addr_line1 text, p_addr_line2 text, p_addr_city text, p_addr_region text, p_addr_postal text, p_addr_country text, p_at timestamptz) → text` | presby_app | inbox | `p_kind` ∈ `started` (records subscription/customer on the intent, creates/resolves the donor, auto-links), `ended`, `payment_failed`. |
| `presby_giving_apply_intent_expired(p_inbox_id uuid, p_session_id text) → text` | presby_app | inbox | `created`/`open → expired`. |
| `presby_giving_apply_settlement(p_inbox_id uuid, p_external_settlement_id text, p_status text, p_arrival_date date, p_gross_cents bigint, p_automatic boolean) → text` | presby_app | inbox | Header only (Batch 3). |
| `presby_giving_apply_settlement_lines(p_inbox_id uuid, p_external_settlement_id text, p_txn_ids text[], p_kinds text[], p_gross bigint[], p_fee bigint[], p_net bigint[], p_payment_intents text[]) → text` | presby_app | inbox | Typed parallel arrays, no jsonb. Called by Batch 6. |
| `presby_giving_apply_connection_status(p_inbox_id uuid, p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean, p_card_enabled boolean, p_ach_enabled boolean, p_requirements_due boolean, p_disabled_reason text, p_deauthorized boolean) → text` | presby_app | inbox | Status mapping (below). `p_deauthorized` → `disconnected`, reason `deauthorized`. |
| `presby_giving_refresh_my_connection(p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean, p_card_enabled boolean, p_ach_enabled boolean, p_requirements_due boolean, p_disabled_reason text) → text` | presby_app | `presby_current_org()` | The return-page / "Refresh status" path. |
| `presby_giving_disconnect_my_connection() → text` | presby_app | `presby_current_org()` | `disconnected`, reason `treasurer`; also clears `public_enabled_at`. Local only — the Stripe account is neither closed nor deauthorized. |
| `presby_giving_record_offline_gift(p_donor_id uuid, p_fund_id uuid, p_occurred_on date, p_method text, p_amount_cents integer, p_check_number text, p_stock_description text, p_stock_quantity numeric, p_memo text, p_recorded_by uuid) → uuid` | presby_app | `presby_current_org()` | Donor in org, unmerged, and `unidentified` ⇒ method `cash` only; fund in org and active; `occurred_on` between 2000-01-01 and **org-local today**; shape per method; `p_recorded_by` must be an active member of the acting org (the bounded identity claim of 0052 note 3). Arms the marker. |
| `presby_giving_void_gift(p_gift_id uuid, p_reason text, p_voided_by uuid) → uuid` | presby_app | `presby_current_org()` | Offline, `succeeded`, not already voided; inserts the `void` reversal for the full amount. |
| `presby_giving_create_intent_public(p_slug text, p_fund_id uuid, p_gift_amount_cents integer, p_cover_fees boolean, p_method text, p_frequency text, p_idempotency_key text) → table(outcome text, intent_id uuid, external_account_id text, livemode boolean, fund_name text, gift_amount_cents integer, covered_cents integer, total_cents integer, methods text[], already_attached boolean)` | presby_app | slug | **No membership parameter** — structurally unable to link. Checks toggle on, applicability, connection `active` and public, fund active + `offered_online` in that org, bounds, method vs `card_enabled`/`ach_enabled`, a flood cap (> 200 `created` intents for the org in the last hour → `rate_limited`). **Computes the gross-up in SQL** via `presby_giving_gross_up`; the app's figures are display only. `outcome` ∈ `created`, `existing`, `unavailable`, `invalid`, `rate_limited`. |
| `presby_giving_create_intent_member(p_membership_id uuid, p_fund_id uuid, p_gift_amount_cents integer, p_cover_fees boolean, p_method text, p_frequency text, p_idempotency_key text) → table(…same…)` | presby_app | `presby_current_org()` | The only path that sets `membership_id`; verifies the membership is active in the acting org. Shares an internal ungranted core with the public variant. |
| `presby_giving_attach_session(p_intent_id uuid, p_session_id text) → boolean` | presby_app | intent | Set-once, only while `created` and < 15 min old → `open`. |
| `presby_giving_fail_intent(p_intent_id uuid) → boolean` | presby_app | intent | `created → failed`. |
| `presby_public_giving_config(p_slug text) → one row` | presby_app | slug | `state` ∈ `live` / `unavailable` / `absent`; `organization_name`, `livemode`, `contact_phone` (from the public `organization_profiles`), `fund_ids uuid[]`, `fund_names text[]`, `card_enabled`, `ach_enabled`, the four fee-rate columns, `min_amount_cents`, `max_amount_cents`. **No `acct_` id, no org id.** `absent` = no such org, or org without a live published site and giving not live; `unavailable` = site published and giving not live. Always exactly one row; a DB error is handled by the caller as the `absent` shape (DECISION-154). |
| `presby_giving_return_state(p_slug text, p_session_id text) → one row` | presby_app | slug + intent | `state` ∈ `received`, `bank_pending`, `confirming`, `failed`, `unknown`; plus `gift_amount_cents`, `covered_cents`, `fund_name`, `frequency`, `livemode`. No PII. Not-found and other-org return the identical `unknown` row. |
| `presby_giving_attention_events() → one row` | presby_app | `presby_current_org()` | `parked_count`, `dead_letter_count`, `oldest_pending_seconds` for the caller's org — the tenant-visible slice of the inbox, counts only (S5). |
| `presby_giving_active_schedule_count() → integer` | presby_app | `presby_current_org()` | Active monthly gifts (`frequency = 'monthly'`, subscription set, not ended) — feeds the disconnect and toggle-off warnings. |
| `presby_giving_purge_bodies() → integer` | presby_app | system | Nulls `raw_body` for `applied`/`ignored` events 90 days past `processed_at`, and for `dead_letter` events 90 days after their last attempt that were not replayed; sets `body_purged_at`. Monotone data minimisation: a rogue caller can only do early what cron does. |
| `presby_giving_expire_intents() → integer` | presby_app | system | `created`/`open` past `expires_at` → `expired`. |
| `presby_giving_gross_up(p_amount_cents integer, p_method text, p_card_fee_bps integer, p_card_fee_fixed_cents integer, p_ach_fee_bps integer, p_ach_fee_cap_cents integer) → integer` | presby_app | — | `immutable`, invoker. `card`: `ceil((G + fixed) · 10⁴ / (10⁴ − bps))`; `bank`: `least(ceil(G · 10⁴ / (10⁴ − bps)), G + cap)`, exact `numeric` math. |
| `presby_giving_ingest_health() → table(organization_id uuid, connection_id uuid, provider text, livemode boolean, status text, received_count bigint, applied_count bigint, parked_count bigint, dead_letter_count bigint, last_received_at timestamptz, oldest_pending_seconds integer)` | **owner only** (P3-6) | all | Counts and timestamps. No amounts, names, bodies, event ids. |
| `presby_giving_requeue_event(p_inbox_id uuid) → text` | **owner only** | inbox | `dead_letter → received`, `attempts = 0`. A purged body is re-fetched by the processor through `retrieveEvent`. |

**Connection-status mapping (pure, one place — `providers/stripe/status.ts`, fixture-tested, mirrored by the DEFINER functions only as storage):**

- `active` = `charges_enabled` ∧ `payouts_enabled` ∧ `¬requirements_due` ∧ `disabled_reason` null.
- `restricted` = was active, or `details_submitted`, but not active (`requirements_due` or `disabled_reason` set).
- `onboarding` = everything else. `disconnected` is terminal.
- `card_enabled`/`ach_enabled` come from the `card_payments` / `ach_debit_payments` capability status (v2) or `capabilities.card_payments`/`us_bank_account_ach_payments` (the v1 `account.updated` snapshot). The give form hides "bank" when `ach_enabled` is false.
- `public_enabled_at` survives a status flip to `restricted`, but `presby_public_giving_config` returns `unavailable` unless status is `active`.

### 0055 — 2FA predicate (R4, DECISION-170/175)

`presby_two_factor_required(p_user_id uuid)` is replaced with two OR-ed arms — **arm A** is the 0013 body unchanged; **arm B** is new: *the user's live person, at any active membership, effectively holds a key whose `permissions.requires_two_factor` is true*. Chosen implementation: **an inline CTE reproducing the resolver's four arms**, not a refactor of `presby_effective_permissions()`.

```sql
create or replace function presby_two_factor_required(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select
    exists (  -- arm A (drizzle/0013, verbatim)
      select 1 from people p
        join memberships m on m.person_id = p.id and m.ended_on is null
        join organization_settings s on s.organization_id = m.organization_id
       where p.user_id = p_user_id and p.merged_into_id is null and s.require_two_factor)
    or exists (  -- arm B
      with me as (
        select p.id as person_id, m.organization_id as org_id
          from people p join memberships m on m.person_id = p.id and m.ended_on is null
         where p.user_id = p_user_id and p.merged_into_id is null),
      tfa as (select key from permissions where requires_two_factor)
      select 1 from me                                              -- resolver arm 1: direct
        join role_grants rg on rg.organization_id = me.org_id and rg.person_id = me.person_id
         and rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
        join app_roles r on r.id = rg.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
      union all
      select 1 from me                                              -- arm 2: via group membership
        join role_grants rg on rg.organization_id = me.org_id and rg.group_id is not null
        join groups g on g.id = rg.group_id
        join group_memberships gm on gm.group_id = g.id and gm.person_id = me.person_id
        join app_roles r on r.id = rg.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where rg.starts_on <= current_date and (rg.ends_on is null or rg.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
      union all
      select 1 from me                                              -- arm 3: administrative commission
        join group_memberships gm on gm.person_id = me.person_id
        join groups g on g.id = gm.group_id
        join administrative_commissions ac on ac.group_id = g.id and ac.target_org_id = me.org_id
        join app_roles r on r.id = ac.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where ac.starts_on <= current_date and (ac.ends_on is null or ac.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date)
      union all
      select 1 from me                                              -- arm 4: delegation
        join org_delegations od on od.grantor_org_id = me.org_id and od.revoked_at is null
        join groups g on g.id = od.group_id
        join group_memberships gm on gm.group_id = g.id and gm.person_id = me.person_id
        join app_roles r on r.id = od.role_id
        join app_role_permissions rp on rp.role_id = r.id join tfa on tfa.key = rp.permission_key
       where od.starts_on <= current_date and (od.ends_on is null or od.ends_on > current_date)
         and gm.starts_on <= current_date and (gm.ends_on is null or gm.ends_on > current_date));
$$;
revoke all on function presby_two_factor_required(uuid) from public;
grant execute on function presby_two_factor_required(uuid) to presby_app;
```

- **Why inline, not a shared core:** `presby_effective_permissions()` raises unless `presby_current_org()` equals its org argument, and this predicate runs at sign-in with no org context (F26); a refactor would also edit the central resolver (`drizzle/0010`), which R2's "unchanged" pin and every other pipeline rely on.
- **Agreement test (the writeable form of "agrees on every arm"):** a DB-backed Vitest + a `test-rls.sql` §46 block. For each scenario build a `(user, person, membership, role, grant)` set, then assert `presby_two_factor_required(user)` equals `exists (the giving-arm contribution)` computed by **calling the real resolver** under `set_config('app.current_org_id', org, true)` for every `(person, org)` active-membership pair and testing `permission_key in (select key from permissions where requires_two_factor)`. Scenarios: direct current; direct expired; direct future-dated; group arm current / membership ended / grant expired; commission current / expired; delegation current / revoked; membership ended; merged person; two memberships with the key at the second; a user with only arm-A policy (must still be true); a user with none (false); every row of `scripts/seed-dev.sql`'s fixture people.
- **Drift tripwire (F140):** §46 pins `md5(prosrc)` of `presby_effective_permissions` (value captured by Batch 1 from `development` and written into the assertion with a message pointing at the 2FA arm). Any later edit to the resolver fails the suite until the arm is re-checked.
- **Cost:** the function runs in the `jwt` callback on every authenticated request. Batch 1 records `explain (analyze)` on `development` for a typical two-membership user and a fixture treasurer; budget ≤ 5 ms, otherwise the arm is restructured before merge.
- DECISION-026 is untouched: `auth.require_2fa` (the master switch) still governs through `computeEffectiveTwoFactor`, and a DB error never newly imposes a challenge. **Consequence stated plainly:** with the master switch off, R4's guarantee lapses — the go-live checklist (below) includes "`auth.require_2fa` is on".

### 0055 — DECISION-175 (1): the downward paths stay closed

The three triggers above make "per-member giving is never visible to a parent council" a database property on the one path the resolver would otherwise allow (a commission or delegation role may legally be any role). Existing rows are unaffected; nothing in the fixture or production carries a giving key.

### 0055 — templates, flag, bindings

- Insert the two template roles and their `app_role_permissions` (`on conflict (id) do nothing` / `on conflict do nothing`).
- `delete from feature_flags where key = 'org_portal.giving';`
- **Fixture reconciliation (S3 / P3-3):** `scripts/seed-dev.sql` (integration) replaces `('f0000000-0000-0000-0000-000000000007','ledger.approve')` with the three giving bindings, **keeps** `('ledger.approve','ledger','Approve a disbursement',2)` in the permissions insert, and the fixture `treasurer` role stays `constitutional`/`is_protected`. The designation reuses that role (F109), adding the giving keys additively; `adoptTemplate()` copies are always `custom`/unprotected, so the protected fixture is a dev artifact that production never reproduces.

### Drizzle shape — `src/lib/db/domain/giving.ts`

One file, `pgTable` per table above, `pgEnum("giving_provider", ["stripe"])`, every composite FK declared with `foreignKey({ columns, foreignColumns, name })` using the DDL's constraint names (so `check:schema-parity` sees FK parity), `users` references via `.references(() => users.id)`. The `memberships` import comes from `./people`; `blob_assets` FKs (0056) are **not** declared in Drizzle (the `assets.ts` ↔ `org.ts` cycle precedent) and get three-row `ALLOWLIST` entries in `scripts/check-schema-parity.ts` in Batch 5. Header comment states what Drizzle cannot express and points at 0055 line ranges: FORCE RLS, the policies, every trigger, the column-level grants, the partial indexes, the CHECKs. `src/lib/db/domain/authz.ts` gains `requiresTwoFactor`. Dates read through the Neon driver are cast in SQL (`occurred_on::text`) — `check:sql-date` stays green.

### 0056 — `drizzle/0056_presby_giving_statements.sql` (Batch 5, database-admin)

```sql
create table if not exists giving_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  donor_id uuid not null,
  tax_year smallint not null,
  version smallint not null default 1,
  supersedes_id uuid,
  -- snapshots (G6/G12): the donee identity and the delivery address AS ISSUED
  donee_legal_name text not null, donee_address_line1 text not null, donee_address_line2 text,
  donee_city text not null, donee_region text not null, donee_postal_code text not null, donee_ein text,
  signatory_name text, signatory_title text, greeting_text text not null, closing_text text not null,
  wording_version smallint not null,                        -- the code-generated IRS wording's version
  donor_name text not null,
  delivery_line1 text, delivery_line2 text, delivery_city text, delivery_region text, delivery_postal_code text, delivery_email text,
  period_start date not null, period_end date not null,
  cash_total_cents bigint not null, gift_count integer not null, non_cash_count integer not null default 0,
  covered_fee_counted boolean not null,                     -- the policy constant in force when issued (G10)
  blob_asset_id uuid not null, pdf_sha256 text not null,
  issued_by uuid not null references users(id),
  issued_at timestamptz not null default now(),
  deletable_until timestamptz,
  constraint giving_statements_id_org_key unique (id, organization_id),
  constraint giving_statements_version_key unique (donor_id, tax_year, version),
  constraint giving_statements_donor_fk foreign key (donor_id, organization_id) references giving_donors (id, organization_id),
  constraint giving_statements_supersedes_fk foreign key (supersedes_id, organization_id) references giving_statements (id, organization_id),
  constraint giving_statements_blob_fk foreign key (blob_asset_id, organization_id) references blob_assets (id, organization_id)  -- NO ACTION: a referenced blob cannot be deleted, even on the owner path
);
-- CHECKs: tax_year between 2000 and 2100; version ≥ 1; (version = 1) = (supersedes_id is null);
--   period is the calendar year of tax_year; cash_total_cents ≥ 0; gift_count ≥ 1; pdf_sha256 ~ '^[0-9a-f]{64}$';
--   address parts bounded; wording_version ≥ 1.
create unique index if not exists giving_statements_supersedes_once_idx on giving_statements (supersedes_id) where supersedes_id is not null;  -- the chain cannot fork
create index if not exists giving_statements_org_year_idx on giving_statements (organization_id, tax_year);

create table if not exists giving_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  statement_id uuid not null, gift_id uuid not null,
  line_no smallint not null,
  occurred_on date not null,
  fund_label text not null, description text not null,
  kind text not null,                                        -- 'cash' | 'non_cash'
  amount_cents integer,                                      -- counted amount, null for non_cash
  gross_cents integer not null, reversed_cents integer not null default 0, covered_fee_cents integer not null default 0,
  constraint giving_statement_lines_id_org_key unique (id, organization_id),
  constraint giving_statement_lines_gift_key unique (statement_id, gift_id),
  constraint giving_statement_lines_no_key unique (statement_id, line_no),
  constraint giving_statement_lines_statement_fk foreign key (statement_id, organization_id) references giving_statements (id, organization_id),
  constraint giving_statement_lines_gift_fk foreign key (gift_id, organization_id) references giving_gifts (id, organization_id)
);   -- (kind = 'cash') = (amount_cents is not null and amount_cents > 0)

create table if not exists giving_statement_deliveries (       -- insert-only
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  statement_id uuid not null,
  channel text not null,                                     -- 'print_mailed' | 'email_notice'
  recorded_by uuid not null references users(id),
  occurred_at timestamptz not null default now(),
  email_queue_id uuid,                                       -- plain reference: email_queue has no tenant key
  constraint giving_statement_deliveries_id_org_key unique (id, organization_id),
  constraint giving_statement_deliveries_statement_fk foreign key (statement_id, organization_id) references giving_statements (id, organization_id)
);
```

- RLS: ENABLE + FORCE + `tenant_isolation` on all three. Grants to `presby_app`: **SELECT, INSERT** on all three; **no UPDATE, no DELETE**.
- **Freeze:** `giving_statements_freeze` (BEFORE UPDATE OR DELETE) — UPDATE always raises; DELETE per the A-or-B guard. Same for lines and deliveries.
- **Insert guards:** `giving_statements_insert_guard` (BEFORE INSERT): donor must be `identified` and unmerged (unidentified plate cash can never receive a statement); the donee name and address snapshot columns must be non-empty; `supersedes_id`, when set, must reference the donor's latest version for the same year.
- **Consistency constraint trigger** (deferred, AFTER INSERT on lines, `initially deferred`): the header's `cash_total_cents`, `gift_count`, `non_cash_count` equal the lines; each line's `gift_id` belongs to the statement's donor-root, `occurred_on` lies inside `[period_start, period_end]`, the gift is `succeeded` and `livemode`, and `gross_cents` equals the gift's `amount_cents`. This is the database half of "the PDF was rendered from the rows that were frozen": the totals can't disagree with the lines.
- The three blob FKs are DDL-only; `check-schema-parity.ts` gets `ALLOWLIST` entries (`kind: "missing_fk"`, `category: "architectural"`, citing the Drizzle cycle comment and the 0056 line).
- **Staleness is derived, never stored** (DECISION-173): a *latest-version* statement is stale when, for any donor in its donor-root group and gifts dated inside its period, there exists a gift with `created_at > issued_at`, or `status_changed_at > issued_at`, or a reversal with `created_at > issued_at`. One SQL function-free query in `statements.ts` (a `with` over the donor-root group), unit- and DB-tested.

### Integration drafts — `scripts/test-rls.sql` §46 and the `scripts/seed-dev.sql` block

Batch 1 authors both as **new files** — `scripts/giving/test-rls-46.sql` and `scripts/giving/seed-dev-giving.sql` — and the orchestrator adds one `\ir giving/…` line to each shared file at integration (psql `\ir` is relative to the including file; both shared files are only ever run with `psql -f`). Neither shared file is edited by a batch. Section 46 is the next free number (`grep '^-- [0-9]\+\.' scripts/test-rls.sql` ends at 45).

**§46 must assert (as `presby_app`, failing-first per `database-admin.md`):**

| § | Assertion |
|---|---|
| 46a | All 12 tables: `relrowsecurity` and `relforcerowsecurity`; a `tenant_isolation` policy with both `qual` and `with_check`; `unique (id, organization_id)` on all but `giving_settings`; every FK between giving tables and to `memberships` is composite, `confdeltype = 'a'` (NO ACTION), and lists `organization_id` as the second column on both sides. |
| 46b | The grant matrix above, via `aclexplode(relacl)`: no DELETE for anyone; `presby_platform` holds nothing; `presby_app` holds no privilege on `giving_provider_events` (`has_table_privilege` false for every privilege) and no INSERT/UPDATE on gifts, reversals, intents, identities, settlements, lines; the `giving_provider_connections` column-level UPDATE list is exactly the nine columns. |
| 46c | Tenancy: with org A's context, org B's rows in every giving table are invisible; a cross-org insert into donors/funds/decisions is refused by `with check`; an owner-path insert of a gift whose `fund_id` belongs to another org is refused by the composite FK (marker armed so the FK, not the guard, is what refuses). |
| 46d | **Presbytery invariant (analyst tests 1–3, 7):** (1) set a presbytery person's context (the presbytery org id), seed `giving.view` for that person **at the presbytery**, and select every giving table: zero rows for member-congregation data; (2) no giving table has an `about_org_id` column; no giving policy, trigger or function source mentions `presby_org_affiliated`, `presby_transfer_affiliation`, `presby_publish_sasr_snapshot`, `presby_list_published_returns_to_me` or `publications`; (3) none of those functions' sources mentions any `giving_` relation. |
| 46e | `presby_app` selecting `giving_provider_events` fails `permission denied`; the body column is reachable only through `presby_giving_claim_event`; `presby_giving_ingest_health`/`requeue_event` are **not** executable by `presby_app` (`has_function_privilege` false), are executable by the owner. |
| 46f | **Ingest (analyst test 4):** unknown account → `ignored`, zero rows; `livemode` mismatch → `ignored`; replay of the same event id → `duplicate`, one row; `inbox.organization_id = connection.organization_id` always; an `apply_gift` whose session id belongs to **another org's** intent → `ignored:no_intent`, nothing written; a body naming a foreign fund id is irrelevant because the fund comes from the intent (assert by construction: `apply_gift` has no fund parameter). |
| 46g | **Apply semantics:** `apply_gift` idempotent (twice → one gift); `pending → succeeded` legal, `succeeded → failed`, `failed → succeeded` and `succeeded → pending` raise; fee/net set-once; reversal before the gift → `parked:no_gift`; over-reversal → `dead:over_reversal` and no row; `void` only on offline gifts and only once; reinstatement bound; `occurred_on` for an `authorized_at` of `2027-01-01T03:00:00Z` in `America/New_York` is `2026-12-31`, and falls back to `America/New_York` for an org with **no** `organization_settings` row (F132). |
| 46h | **Freeze/guards on the owner connection:** `update giving_gifts set amount_cents = amount_cents + 1` raises with the marker armed; any update without the marker raises; `delete` on gifts/reversals/donors/events raises; with `deletable_until` in the future the delete succeeds; **org-teardown premise (P3-8): a fixture org created with `deletable_until` future, with donors, gifts, reversals and events, is deleted with one `delete from organizations` and everything cascades** — if this assertion fails the premise is false and Batch 1 adds the `presby.giving_trigger_active` arm to `presby_guard_organizations_delete()` instead (named deviation in the batch notes). |
| 46i | **Inventory:** every `presby_giving_*` and `presby_public_giving_config` function is `prosecdef` (except `presby_giving_gross_up`), `proconfig` contains `search_path=public, pg_temp`, `proacl` has no PUBLIC entry; the grant list equals the table above. `presby_giving_ingest_event` has no parameter named `*org*`. |
| 46j | **2FA:** `requires_two_factor` is true for exactly `giving.view/record/manage` and false for every other key; the agreement matrix above; the resolver `md5(prosrc)` pin. |
| 46k | **DECISION-175 (1):** inserting an `administrative_commissions` or `org_delegations` row whose role carries a giving key raises; binding a giving key to a role a commission already uses raises; the seeded `session_member` commission is unaffected. |
| 46l | **Public functions:** `presby_public_giving_config` returns `absent` for an unknown slug, for a non-tenant slug, and for a congregation with the toggle off (no row) — **identical rows**; `unavailable` only with a live site; never contains `acct_`; `create_intent_public` refuses a retired fund, a fund not `offered_online`, a fund of another org, amount 99 / 2,500,001 / 0 / negative, toggle off, connection `onboarding`/`restricted`/`disconnected`, `public_enabled_at` null, `cover_fees` with `either`, and the 201st created intent in an hour; the SQL gross-up equals the TS grid; `attach_session` is set-once; `return_state` is identical for unknown, malformed and other-org session ids. |
| 46m | **Catalog:** the two templates exist with exactly their key sets and no other role in the database (other than fixtures the seed binds) carries a giving key; `feature_flags` has no `org_portal.giving`; no `organization_feature_toggles` row for `org_portal.giving` exists except the fixture's. |
| 46n | **Livemode:** the shared live-gift predicate excludes a `livemode = false` gift from every aggregate the app uses (assert with the same SQL fragment the TS exports, read from a fixture string). |

**Seed block (`seed-dev-giving.sql`) must contain** — arming `presby.giving_write_active` first and using invented names and `example.invalid` addresses only:

- Alder Creek (`2222…`, the fixture congregation): toggle row `org_portal.giving` **on**; the fixture `treasurer` role bound to the three giving keys (replacing `ledger.approve`, P3-3), Priya Balakrishnan already granted; a new `giving_recorder` role (custom, unprotected) granted to one non-treasurer fixture person; a connection `acct_FIXTUREALDER01`-style id, `livemode = false`, `active`, attested, public; `giving_settings` with an invented donee name, address and an `00-0000000`-shaped placeholder EIN; funds: "General Fund" (offered online), "Building Fund" (temporarily restricted, not online), "Missions" (offered online, **retired** and carrying an in-flight gift).
- Donors: an identified donor with a Stripe identity; one linked (`recorder_confirmed`) to a fixture member; one with an email identical to a fixture person's `person_identifiers` email (a link proposal); one `is_shared` case (no proposal); one merged into another; the unidentified plate-cash donor; one with no email and no address (statement exception).
- Gifts: offline cash, check (with number), stock; online succeeded with fee/net and a covered fee; online **pending** ACH; online **failed** ACH; a refunded gift with its reversal; a gift dated in the previous calendar year (statements); a **test-mode** (`livemode = false`) gift (proves exclusion); a late-dated gift created after a fixture "issued" marker (stale test, Batch 5).
- Bramblewood (`3333…`): a donor, a fund and a gift of its own (isolation fixtures). A presbytery fixture gets **no** giving data.
- A pending-intent set: one `open`, one `completed` subscription intent for the member path.

Everything the seed adds must be removable with `delete from organizations` of a fixture org (the P3-8 cascade) or carry `deletable_until`.

## API Contract

**Conventions (every module below).** `server-only`; one `withOrgContext()` transaction per exported function doing gate → validate → write (the `role-grants.ts` shape); typed result unions for every expected outcome, thrown errors only for genuine failure; `OrgAccessError` re-thrown. Server actions live in a co-located `actions.ts`, start with `auth()` → `resolveOrgContext()` → Node 2FA check → toggle → permission (the gate order above), call exactly one lib function, `recordAudit()` **after** the transaction commits and only on `ok`, then `revalidatePath`. Failure vocabulary is *uniform where enumeration matters* (anonymous and cross-tenant surfaces) and *honest where the caller already holds the row* (DECISION-152). Money is integer cents everywhere; a user-typed amount is a **string** parsed once by `money.ts`.

### Pure helpers (no `server-only`, unit-tested to the digit)

| Module | Exports |
|---|---|
| `src/lib/giving/money.ts` | `parseAmountToCents(input: string): { ok: true; cents: number } \| { ok: false; reason: "empty"\|"format"\|"too_small"\|"too_large" }` — accepts only `^\d{1,5}(\.\d{1,2})?$` after trim (rejects exponents, signs, Unicode digits, thousands separators, 3+ decimals); bounds 100..2_500_000 for online, 1..100_000_000 for offline via a `kind` argument. `formatCents(cents: number): string` (`$1,234.56`, `en-US`, via the shared formatter, never `toLocaleString` on a Date). |
| `src/lib/giving/providers/stripe/fees.ts` | `grossUp(amountCents, method: "card"\|"bank", rates): { totalCents; coveredCents }` — BigInt ceil-division of the SQL formula; `DEFAULT_RATES = { cardBps: 290, cardFixedCents: 30, achBps: 80, achCapCents: 500 }` mirrors the column defaults (a test reads the 0055 file and pins them). **Display only** — `presby_giving_create_intent_*` recomputes in SQL and the action uses the DB's numbers. A DB-backed grid test (amounts `100, 101, 999, 1000, 2500, 9999, 10000, 123456, 2500000` × both methods × default and 200 fuzzed rate sets) asserts `grossUp == presby_giving_gross_up`. |
| `src/lib/giving/statement-policy.ts` | `COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION = true` (G10: one constant for the CPA ruling, Q6) and `STATEMENT_WORDING_VERSION = 1`. |
| `src/lib/giving/live-predicate.ts` | exports the SQL fragment `LIVE_SUCCEEDED_GIFT` (`g.livemode and g.status = 'succeeded'`); a static test fails any file under `src/lib/giving/` containing `sum(`/`count(` over `giving_gifts` without it (P3-17). |
| `src/lib/giving/providers/stripe/status.ts` | `mapAccountSnapshotToStatus()` (v1 `account.updated` fields) and `mapV2AccountToStatus()` → `ConnectionStatusInput`; both fixture-tested against the same expected table. |
| `src/lib/giving/providers/stripe/normalize.ts` | `normalize(rawBody: string): NormalizedEvent[]` (below). Pure; type-only imports from `stripe`. |

### `NormalizedEvent` (provider-neutral; `src/lib/giving/types.ts`)

```ts
type DonorDetails = { externalCustomerId: string; name: string | null; email: string | null;
  address: { line1: string|null; line2: string|null; city: string|null; region: string|null; postal: string|null; country: string|null } };

export type NormalizedEvent =
  | { kind: "gift"; status: "pending" | "succeeded" | "failed";
      sessionId: string | null; subscriptionId: string | null; invoiceId: string | null; paymentIntentId: string;
      amountCents: number; authorizedAt: Date; failureCode: string | null; method: "card"|"us_bank_account"|null; donor: DonorDetails }
  | { kind: "gift_fee"; paymentIntentId: string; balanceTransactionId: string; method: "card"|"us_bank_account"|"wallet"|null }
  | { kind: "reversal"; paymentIntentId: string; reversalKind: "refund"|"dispute"|"ach_return"|"reinstatement";
      externalReversalId: string; amountCents: number; occurredAt: Date; offsetsExternalReversalId: string | null }
  | { kind: "subscription"; action: "started"|"ended"|"payment_failed"; sessionId: string | null; subscriptionId: string;
      donor: DonorDetails | null; at: Date }
  | { kind: "intent_expired"; sessionId: string }
  | { kind: "settlement"; externalSettlementId: string; status: "paid"|"failed"; arrivalDate: string | null; grossCents: number; automatic: boolean }
  | { kind: "connection_status"; status: ConnectionStatusInput; deauthorized: boolean };
```

`gift_fee` carries only the balance-transaction id: the processor retrieves it through the allowlist and passes fee/net to the apply function (a number from a signed event body is never the source of fee data). `invoice_payment.paid` normalizes to `{ kind: "gift", subscriptionId: null, invoiceId, paymentIntentId, … donor: null }` and the processor **completes** it with `retrieveInvoiceForPayment` (fills `subscriptionId` and `donor`) before calling `presby_giving_apply_gift`.

**Event-type → kind map (the endpoint is subscribed to exactly these; anything else is acknowledged and dropped before the inbox):**

| Stripe event | Becomes |
|---|---|
| `checkout.session.completed` (payment mode) | `gift` — `paid` → `succeeded`, `unpaid` → `pending` (ACH), method inferred (`paid` = card, `unpaid` = us_bank_account) |
| `checkout.session.completed` (subscription mode) | `subscription` `started` (no gift) |
| `checkout.session.async_payment_succeeded` / `_failed` | `gift` `succeeded` / `failed` |
| `checkout.session.expired` | `intent_expired` |
| `invoice_payment.paid` | `gift` `succeeded` (renewals and first subscription payments) |
| `charge.succeeded` | `gift_fee` |
| `refund.created`, `refund.updated` | `reversal` `refund` when `status = succeeded`; `refund.updated` to `failed`/`canceled` after a recorded success → `reinstatement` of `<re_id>` (external id `<re_id>:failed`) |
| `charge.dispute.created` | `reversal` `dispute` (or `ach_return` when the disputed payment method is `us_bank_account`) |
| `charge.dispute.closed` | `reinstatement` of the dispute when `status = won`; no event for `lost` |
| `customer.subscription.deleted` | `subscription` `ended` |
| `invoice.payment_failed` | `subscription` `payment_failed` (sets `last_payment_failed_at`; **no gift row**, P3-16) |
| `payout.paid`, `payout.failed` | `settlement` |
| `account.updated`, `account.application.deauthorized` | `connection_status` |

A body whose `api_version` is not `2026-09-30.endive` is finished `failed:api_version` (dead-letters visibly) — the endpoint must be created at the pinned version (deployment runbook).

### The Stripe allowlist — `src/lib/giving/providers/stripe/client.ts` (the only runtime importer of `stripe`)

Imports `stripe`, `server-only`; constructs the SDK **lazily** per call with `apiVersion: STRIPE_API_VERSION` (`"2026-09-30.endive"`, the SDK's pinned value, asserted equal in a test), `maxNetworkRetries: 2`, and the idempotency key per write. Logs only `error.type`, `error.code`, request id. Returns projections, never SDK objects. **Exports (a test asserts this exact set and greps the file for forbidden resource methods — `customers.`, `charges.`, `paymentIntents.`, `subscriptions.`, `.search(`, `invoices.list`):**

| Export | Stripe call | Notes |
|---|---|---|
| `STRIPE_API_VERSION`, `isStripeConfigured()`, `platformMode(): "live"\|"test"` | — | mode from the key prefix; `isStripeConfigured` = both env vars non-empty |
| `verifyWebhook(rawBody, signatureHeader): { id; type; account: string \| null; livemode; apiVersion }` | `Stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET, 300)` (the static helper — verification must work with `STRIPE_SECRET_KEY` unset, as in CI and the replay harness) | throws `WebhookSignatureError`; never returns the SDK event |
| `createConnectedAccount({ displayName, contactEmail, statementDescriptor, idempotencyKey })` → `{ accountId; livemode }` | `v2.core.accounts.create` | body exactly as confirmed: `dashboard: "full"`, `fees_collector`/`losses_collector: "stripe"`, `identity: { country: "us", entity_type: "company" }`, merchant capabilities `card_payments` + `ach_debit_payments` requested, `defaults.currency: "usd"`. Idempotency key `giving-connect:<organizationId>` |
| `createOnboardingLink({ accountId, returnUrl, refreshUrl })` → `{ url; expiresAt }` | `v2.core.accountLinks.create` | `use_case.account_onboarding.configurations: ["merchant"]`; the returned URL's origin must be `accounts.stripe.com` or `connect.stripe.com` (exact hostname, `https`, no userinfo/port) else `ProviderError("bad_origin")` |
| `retrieveConnectedAccount(accountId)` → `ConnectionStatusInput` | `v2.core.accounts.retrieve(id, { include: ["configuration.merchant","requirements"] })` | through `mapV2AccountToStatus` |
| `createCheckoutSession({ accountId, mode, totalCents, fundDisplayName, coveredFeeCents, methods, intentId, successUrl, cancelUrl, expiresAt, idempotencyKey })` → `{ sessionId; url }` | `checkout.sessions.create(params, { stripeAccount, idempotencyKey })` | `payment`: `submit_type: "donate"`, `customer_creation: "always"`, `payment_intent_data.metadata`; `subscription`: `subscription_data.metadata`, recurring `price_data` `month`. Both: inline `price_data` (`currency: "usd"`, `unit_amount: totalCents`, `product_data.name: fundDisplayName`, `description` says "includes $X.XX to cover processing fees" when covered), `billing_address_collection: "required"`, `payment_method_types: methods`, `client_reference_id`/`metadata.presby_intent_id: intentId`, `expires_at`. The returned URL's origin must be exactly `checkout.stripe.com`. Metadata is correlation only (R9). |
| `retrieveBalanceTransaction(accountId, id)` → `{ amountCents; feeCents; netCents; currency }` | `balanceTransactions.retrieve` | requires `currency === "usd"` |
| `listBalanceTransactionsForPayout(accountId, payoutId, startingAfter?)` → `{ rows; hasMore }` | `balanceTransactions.list({ payout })` | Batch 6 |
| `retrieveEvent(accountId, eventId)` → `string` (JSON) | `events.retrieve` | replay of a purged body only |
| `retrieveInvoiceForPayment(accountId, invoiceId)` → `{ subscriptionId; donor: DonorDetails; billingReason }` | `invoices.retrieve` | P3-9; called only from `ingest/process.ts` with an id taken from a claimed inbox event (a test greps importers) |

ESLint `no-restricted-imports` for `stripe` and `stripe/*` (`allowTypeImports: true`) everywhere except `src/lib/giving/providers/stripe/**` (Batch 1 lands the rule; the package arrives in Batch 3).

### Webhook — `POST /api/webhooks/stripe` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 30`)

| Step | Outcome |
|---|---|
| `STRIPE_WEBHOOK_SECRET` unset | **503** `{ error: "Webhook not configured." }` (amends DECISION-028 r3 for money; Stripe retries) |
| missing `stripe-signature` | 400 `{ error: "Missing webhook headers." }` |
| `rawBody = await req.text()`; `verifyWebhook` throws | 400 `{ error: "Invalid webhook signature." }` |
| no top-level `account` (platform-scope event) | 200 `{ received: true, handled: false }`, nothing written |
| event type not in the handled set | 200 `{ received: true, handled: false }`, nothing written |
| `presby_giving_ingest_event(...)` throws | 500 `{ error: "Internal server error." }` (Stripe retries; DECISION-028 r5) |
| `accepted` / `duplicate` / `ignored` | **one identical** 200 `{ received: true }`; on `accepted`, `after(() => processInboxEvent(inboxId))` |

No audit row on the route itself (informational), logging is event id + type only, never the body. Uses `db` only. Proxy: `/api/*` bypasses the Edge; the signature is the credential.

**`processInboxEvent(inboxId)` (`ingest/process.ts`)**: `presby_giving_claim_event` → if `body_purged`, `retrieveEvent` → `normalize` → for each event in order: `gift_fee` → `retrieveBalanceTransaction` then `apply_gift_fee`; `gift` from `invoice_payment.paid` → `retrieveInvoiceForPayment` then `apply_gift`; everything else straight to its apply function → aggregate outcomes (any `dead:*` → `dead`; any `parked:*` → `parked`; any `failed` → `failed`; else `applied`, or `ignored` when every part was `ignored:*`) → `presby_giving_finish_event`. Audit after finish: `GIVING_REVERSAL_RECORDED` per reversal, `GIVING_CONNECTION_STATUS_CHANGED`/`_DISCONNECTED`, `GIVING_DONOR_AUTOLINKED`/`_LINK_CONFLICT` from the outcome suffix, `GIVING_EVENT_DEAD_LETTERED`. Never throws to the caller (it runs in `after()` and from cron); an unexpected exception finishes the event `failed:exception`.

### Cron — `GET /api/cron/giving` (`*/5 * * * *` in `vercel.json`; Batch 3)

`CRON_SECRET` unset → 503; wrong bearer → 401 (the `maintenance` shape). Then, on `db` only: `presby_giving_due_events(25)` → `processInboxEvent` each (serially, 25 s budget); `presby_giving_purge_bodies()`; `presby_giving_expire_intents()`. Response `{ ok, processed, purged, expired }`; structured one-line summary log.

### Checkout-intent lifecycle

```
created ──attach_session──▶ open ──completed event──▶ completed
   │                         └──expired event / cron──▶ expired
   └──Stripe call failed──▶ failed
```

1. The form renders with a **server-minted** `idempotencyKey` (a UUID) in a hidden field (so a hydrated re-render never re-keys).
2. The action validates, calls `presby_giving_create_intent_{public,member}` (the DB computes the total) → `created` row, **before** any Stripe call.
3. `isStripeConfigured()` false → `fail_intent`, return `unavailable` (the page itself renders from DB state, so e2e can exercise the form with no key — see the hydration spec).
4. `createCheckoutSession` (Stripe idempotency key `giving-session:<intentId>`); on success `attach_session`; assert the URL origin; return `{ kind: "checkout", url }`. On Stripe failure `fail_intent`, return `error`.
5. A repeat of the same `idempotencyKey` returns `existing`: if a session is attached → `already_started`, else it continues from step 4.
6. `success_url = <origin>/site/<slug>/give/return?session_id={CHECKOUT_SESSION_ID}` (member: `/o/<slug>/giving/give/return?…`), `cancel_url = <origin>/site/<slug>/give` — `<origin>` from `givingOrigin()` in `src/lib/giving/origin.ts` (`NEXT_PUBLIC_APP_URL`, required and `https:` in production, else the action returns `unavailable`; **never** the request `Host`).
7. Checkout `expires_at` = now + 30 min; `presby_giving_expire_intents` closes stale rows.

### Public surface actions — `src/app/(public)/site/[slug]/give/actions.ts` (no `auth()`, no session)

`createPublicGiveSessionAction(slug: string, formData: FormData): Promise<GiveResult>`

```ts
type GiveResult =
  | { kind: "checkout"; url: string }                      // client re-asserts origin === https://checkout.stripe.com, then window.location.assign
  | { kind: "invalid"; field: "amount"|"fund"|"frequency"|"method"|"form"; message: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "unavailable" }                                // toggle off, not live, no online fund, Stripe unset — one message
  | { kind: "already_started" }
  | { kind: "error" };                                     // "We couldn't start your gift. You haven't been charged."
```

FormData: `amount` (string), `fundId` (uuid), `frequency` (`once|monthly`), `coverFees` (`on`/absent), `method` (`card|bank|either`), `idempotencyKey` (uuid), `_hp` (honeypot), Turnstile token. **Order (R13):** honeypot (fake `unavailable`-shaped success, no rate-limit spend) → `checkRateLimit` three keys — `giving_session:<slug>:<ip>` 10 per 10 min, `giving_session_site:<slug>` 120/hour, `giving_session_global` 2000/hour (the platform key is shared across every congregation; a Stripe rate-limit starvation is cross-tenant) → `verifyTurnstile` → `parseAmountToCents` → `create_intent_public` → Stripe. The in-memory limiter is per-instance on Vercel: **Upstash configured is a go-live item**; the DB flood cap in `create_intent_public` is the infrastructure-independent backstop. No audit (anonymous, low-stakes; `// audit-exempt:` annotated).

`/site/[slug]/give/page.tsx` and the `giving` live slot call `presby_public_giving_config(slug)` in one `try/catch` (ids-only logging, `absent` on error), render `<GiveForm>` for `live`, the unavailable notice for `unavailable`, `notFound()` for `absent`. The live slot returns `null` for `absent`.

`/site/[slug]/give/return/page.tsx` → `presby_giving_return_state(slug, session_id)` → one of five panels. It never calls the Stripe receipt an acknowledgment, never prints a name or email, `robots: noindex`, no `loading.tsx`.

### Member give — `src/app/(org)/o/[slug]/giving/give/actions.ts`

`createMemberGiveSessionAction(slug, formData): Promise<GiveResult>` — same shape, plus the gate order (no giving key needed, only the toggle), and `membership_id` taken from `resolved.org` (never the form) via `presby_giving_create_intent_member`. Rate-limited by user id.

### Admin — connection (`admin/giving/connect/actions.ts`, `giving.manage`)

| Action / handler | Result union |
|---|---|
| `startConnectAction(slug)` → creates the account (if no open connection), inserts the row, mints the link, returns `{ kind: "redirect"; url }` (origin-asserted; client navigates) | `ok`, `forbidden`, `not_applicable`, `toggle_off`, `two_factor_required`, `stripe_unconfigured`, `already_connected`, `provider_error` ("We couldn't reach Stripe. Nothing was changed.") |
| `continueConnectAction(slug)` → new link for the open connection | same minus `already_connected` |
| `GET connect/return` (page) → `retrieveConnectedAccount` → `presby_giving_refresh_my_connection` → status UI; **the URL proves nothing** | renders the six connection states |
| `GET connect/refresh` (route) → mints a fresh link and `redirect()`s | 307; any failure → back to `/admin/giving` with a notice |
| `refreshConnectionAction(slug)` | `ok`, `provider_error`, `forbidden` |
| `attestPayoutsAction(slug)` | records `payouts_attested_at/by` (the Q8 go-live attestation) |
| `setPublicPageAction(slug, enabled: boolean)` | refuses `enable` unless status `active`, ≥1 online fund, attested (`not_ready` with the missing items named); audited `GIVING_PUBLIC_PAGE_TOGGLED` |
| `disconnectAction(slug)` | shows `activeSchedules` first via a dialog; calls `presby_giving_disconnect_my_connection`; audited |
| `updateRatesAction(slug, input)` | card/ACH rates (treasurer-editable for nonprofit-discount accounts, G21); bounded by the CHECKs; audited |

### Admin — funds, gifts, donors, settings, team

| Module / action | Gate | Notes |
|---|---|---|
| `funds.ts`: `listFunds`, `createFund`, `updateFund`, `retireFund`, `reactivateFund` | manage | retiring also clears `offered_online`; retiring the last online fund while public is on needs `confirm: true` (dialog) |
| `gifts.ts`: `listGifts({ filters, cursor })` (keyset on `(occurred_on desc, id desc)`, 50/page, joined — no N+1), `getGift`, `recordOfflineGift`, `voidGift`, `listRecentOwnEntries` | view / record / record-or-manage | `recordOfflineGift` runs a pre-check `findPossibleDuplicate` (same donor, date, amount, check number) returning `{ kind: "duplicate_warning", giftId }` unless `acknowledgeDuplicate: true`; it calls `presby_giving_record_offline_gift`. `voidGift` allowed to `giving.manage` for any offline gift, and to `giving.record` holders for their own entries ≤ 30 days (`recorded_by = actor`, checked in SQL); reason 3–200 chars. Results: `ok`, `forbidden`, `invalid` (inline field errors), `retired_fund`, `future_date`, `unidentified_method`, `duplicate_warning`, `not_found`, `not_voidable`. |
| `donors.ts`: `searchDonors(q)` (record or view: `{ id; displayName; kind; hasEmail }`, ≤ 20, no contact detail), `listDonors`, `getDonor`, `createDonor`, `updateDonorContact` (**manage**), `mergeDonors(sourceId, targetId)` (**manage**; repoints dependents, inherits the link when the target has none, refuses `link_conflict` when both are linked to different memberships), `proposeLink(donorId)` (computed, never stored: exact normalized email → `person_identifiers` kind `email`, `not is_shared`, current membership in this org, **excluding** `person_privacy.directory_hidden` / `hide_email` people, excluding dismissed pairs), `confirmLink`, `removeLink`, `dismissLink` | record (reads: S4 reduced), view | the reduced donor page shows name, kind and the proposal ("Looks like <member name> — same email on file"); never the email, gifts or totals. Confirm shows the person's name in an `AlertDialog` (account-takeover-by-link defence). |
| `settings.ts`: `getGivingSettings`, `updateGivingSettings` | manage | donee identity, signatory, greeting/closing; the single allowed greeting token is `{donor_name}`, substituted by plain string replacement of a validated value (no template engine); audited with field names only |
| `team.ts` (R3): `listGivingTeam`, `grantGivingRole(actorPersonId, orgId, actorUserId, { roleId, personId })`, `revokeGivingRole(…, { grantId })`, `ensureGivingRole(…, { templateKey: "treasurer"\|"giving_recorder" })` (P3-18) | manage | step-0 `giving.manage`; target role org-owned, active, non-empty, **every key `module = 'giving'`**; person-arm only, current membership; then `assertPermissionSubset()` unchanged; audited `TENANT_ROLE_GRANTED/REVOKED` with `path: "giving_team"`. `ensureGivingRole` reuses-and-reactivates (F109) the org-owned role from one of the two giving templates, reconciling its permissions additively and only with keys the actor holds, so a deactivated or missing `giving_recorder` role cannot strand delegation (without it, the founding administrator lacks `giving.record` and the treasurer lacks `roles.manage`, so no one could re-adopt it); audited `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE` with `path: "giving_team"`; it never edits an existing role's definition beyond adding template keys. Results: `ok`, `forbidden`, `invalid_role`, `invalid_target`, `not_giving_only`, `escalation_denied`, `last_manager_blocked` (refuses ending the last effective `giving.manage` grant, person or group arm) |
| `attention.ts` (S5): `loadAttention(tx, ctx)` → `{ failedGifts; stuckPending; monthlyPaymentFailures; connection: …; parkedEvents; deadLetters; staleStatements; possibleDuplicateDonors; linkProposals }` | view (recorder sees only `linkProposals`) | the only definition; the overview page and any future widget call it |

**CSV export — `GET /o/[slug]/admin/giving/gifts/export?from&to&fund&status&source`** (route handler; `giving.view`; gate order as above, 403/404 shapes via `resolveOrgContext`): live-mode gifts only; header row `gift_id,date,donor_id,donor_name,fund,source,method,status,amount,donor_covered_fee,stripe_fee,net,reversed,check_number`; **no email, address or memo**; RFC 4180 quoting; a cell starting with `= + - @ tab CR` is prefixed with `'` (formula injection); ≤ 50,000 rows (more → 413 `Narrow the date range`); `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`; **audited inside the handler** (`GIVING_GIFTS_EXPORTED`: row count, date range, filters — not names).

### Designation — `src/lib/treasurer-designation.ts` (beside `founding-administrator.ts`) and the `(admin)` section

`designateTreasurer(organizationId: string, email: string, operatorUserId: string): Promise<TreasurerDesignationResult>` — one `getPlatformDb()` transaction, R2's order verbatim: lock the org row and read its type → `not_applicable` unless congregation/NWC → zero-holder gate (a plain CTE shaped like `foundingAdministratorHolderCount`, counting `giving.manage` by person-arm and live group-arm; **never** `presby_effective_permissions()`) → `has_holders` → user lookup (`no_such_user`, `user_inactive`) → the user's live person must hold an **active membership at this org** (`not_a_member` | `membership_ended`; **no person, no membership is created**) → reuse-and-reactivate the org-owned `treasurer` role from the template with additive-only permission reconcile → mint, **ungranted**, the org-owned `giving_recorder` role → one person-arm `role_grants` row (`granted_by` = operator, `grant_reason` = "treasurer designation"). Result: `ok { personId; userId; treasurerRoleId; recorderRoleId; permissionKeys; priorHolderCount: 0 }` or one of the refusals above plus `provisioning_incomplete` (template missing), `race` (unique violation), `db_error`. Same error-chain catches as `designateFoundingAdministrator`. Imports no giving table, no `authz.ts`, `role-definitions.ts` or `role-grants.ts`; a Vitest test hashes those four files plus `drizzle/0010` (the DECISION-155 pin).

Action `designateTreasurerAction(formData)` in `(admin)/admin/organizations/[id]/actions.ts`: `auth()` → `FEATURES.ADMIN_ORGANIZATIONS` → zod email → lib → `ORG_TREASURER_DESIGNATED` audit on `ok` → `revalidatePath`. `treasurer-designation-section.tsx` renders only for the two org types; the control appears only while a fresh holder count is 0, otherwise it shows the count and **no names**.

### Statements (Batch 5)

| Function | Gate | Contract |
|---|---|---|
| `previewStatementRun(year)` | view | `{ eligibleDonors; excludedPending; undeliverable; nonCash; plateCashExcluded; stale; possibleDuplicates; blockers: ("donee_name"\|"donee_address")[] }`; no writes. |
| `issueStatementBatch({ year, donorIds?: string[], cursor? })` | manage **and** view | Processes up to 25 donors per call, **each in its own transaction** keyed `(donor, year, version 1)`: lock donor → gather live, succeeded gifts in `[Jan 1, Dec 31]` by `occurred_on` for the donor-root group, net of reversals existing now → if net total is zero skip → compose snapshot → render PDF (pure function of the snapshot) → `store()` the blob → insert statement + lines. Returns `{ issued; skipped; failed: { donorId; reason }[]; nextCursor }`; the dialog loops until `nextCursor` is null. A failure after `store()` leaves an unreferenced blob (accepted, noted below). |
| `reissueStatement(statementId)` | manage | Only for a *latest, stale* statement; version n+1, `supersedes_id`, "Corrected statement, replaces statement dated X". |
| `listStatements({ year, filter })` / `getStale()` | view | derived staleness (above). |
| `recordDelivery(statementId, channel)` | manage | `print_mailed`. |
| `sendStatementNotices(year)` | manage | For issued statements whose donor is linked to a membership and has an email: `enqueueEmail` template `giving.statement.notice` — organization name, year, link to `/o/<slug>/giving`; **no amounts anywhere, subject included**; logs `email_notice` deliveries. Bounces surface by joining `email_queue.bounced_at` on `email_queue_id`. |
| `GET …/statements/[statementId]/download` | view or manage | `resolveOrgContext` → statement exists in this org → streams the blob; `attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`; audited `GIVING_STATEMENT_DOWNLOADED`. |
| `GET …/statements/print?year=` | view | The **print run**: one PDF, one statement per page, generated on demand from the frozen snapshots by the **same** pure renderer used at issue (never stored, `no-store`); audited `GIVING_STATEMENTS_BULK_DOWNLOADED`. A test renders one snapshot alone and inside a batch and compares extracted text (metadata dates pinned). |

**R12 ruling (P3-1): print + portal notice; no token download in v1.** Reasons: the first real run is January 2028 and nothing pressures v1; a token download is a new un-brandable public route group, proxy allow-list entries, a credential table and a security review (a mini-pipeline); an email with no attachment and no amounts adds nothing for an account-less donor; Pub 1771 is satisfied by a mailed or handed-over written acknowledgment. Follow-up (TODO): `(statement-download)` group in the DECISION-147 shape, with its own pipeline — then `CLAUDE.md`/`architect.md` gain the group name.

### Member self-read — `src/lib/giving/self.ts` (outside every permission-gated module; DECISION-162's four conditions)

`getMyGiving(viewerPersonId, organizationId): Promise<{ kind: "ok"; gifts: MyGift[]; statements: MyStatement[] } | { kind: "not_applicable"|"toggle_off" } >`. The membership id is **resolved inside the function** from `viewerPersonId` + `organizationId` (current membership); there is **no target-person parameter**. Rows: gifts and statements whose donor is a donor linked to that membership, or merged into one (`merged_into_id` is flat). Projection: gift `id, occurred_on::text, fund display name, amount_cents, status`, net of reversals as `reversedCents`; statement `id, tax_year, version, issued_at, superseded`. `livemode` gifts only. A DB error throws (the page renders "We can't load your giving history right now", never an empty list). A DB test proves another member's donors, another org's donors, an unlinked household member, and a directory-hidden member's own history behave as specified. The download route re-derives the same ownership and returns the **identical 404** for "not yours" and "doesn't exist".

## Component / Page Plan

**Rules for every page below.** The four states are designed, not implied: **loading** — **no `loading.tsx` anywhere in this pipeline**: every `(org)` page can `notFound()`/redirect on the four-way miss, and the repo's only `loading.tsx` is `/no-organization` (CLAUDE.md → "No `loading.tsx` on a segment whose job is to redirect or 404"); loading is therefore expressed where the user acts — pending buttons, `useTransition` on filters and pickers, skeleton rows in the donor typeahead, the statement-issue progress dialog, `<ReturnPoller>` — and the pages stay fully server-rendered; **empty** (a dashed-border card with a one-sentence description and the one action that populates it — `ui-standards.md` Empty States), **error** (an honest message from the function result, never a blank list: "We can't load … right now"), **populated**. 360 px is a design target: single column below `sm`, tables collapse to labelled cards, 44 px touch targets, no horizontal scroll. Every `useForm` root renders inside `<HydrationGate>` (`check:hydration-gate`); plain `onClick` controls render disabled until `useHydrated()` (F129). **No native `alert/confirm/prompt`** — `AlertDialog` for: disconnect, toggle-off, void gift, issue statements, merge donors, remove link, confirm link, take the public page offline. Page headers, action bars, back navigation and toasts follow `ui-standards.md`. Every `(org)` page repeats the full auth pattern (the check lives in the page, not the layout). Brandable surfaces (`(org)`, `/site/<slug>/give*`) inherit tokens by cascade; the `(admin)` surfaces are platform palette.

### Pages to create

| Route | Server / client | Files | Notes |
|---|---|---|---|
| `/o/[slug]/giving` (member) | server | `giving/page.tsx`, `giving/giving-states.tsx`, `giving/history-list.tsx`, `giving/statements-list.tsx` | "Give online" button (→ `give/`), "Your giving" list, statements for download; empty copy per Flow 12; toggle-off and not-applicable states; no 2FA force. Batch 6. |
| `/o/[slug]/giving/give` | server page + client form | `give/page.tsx`, `give/actions.ts` | `<GiveForm mode="member">`. No `loading.tsx`. Batch 4. |
| `/o/[slug]/giving/give/return` | server | `give/return/page.tsx` | five return panels; `<ReturnPoller>` (client, ≤ 6 × 5 s `router.refresh()` while `confirming`). Batch 4. |
| `/o/[slug]/giving/statements/[statementId]/download` | route handler | `route.ts` | Batch 5. |
| `/o/[slug]/admin/giving` (overview) | server | replaces the placeholder `page.tsx`; `giving-admin-states.tsx` (Forbidden / ToggleOff / NotApplicable / LoadError), `connection-card.tsx` (server), `connect-panel.tsx` (**client**: start/continue/refresh/attest/go-live/disconnect/take-offline with `AlertDialog`s), `attention-list.tsx` | Test-mode badge on every admin page when the open connection has `livemode = false`. Connection states: not started, details due, pending verification, active, restricted, disconnected. The disclosure copy (G15) is a constant in `giving-copy.ts`. |
| `…/admin/giving/connect/return` | server page | `connect/return/page.tsx` | reads provider status server-side, applies it, shows the result; no `loading.tsx`. |
| `…/admin/giving/connect/refresh` | route handler | `connect/refresh/route.ts` | mints a fresh link, `redirect()`. |
| `…/admin/giving/funds` | server + client | `funds/page.tsx`, `funds/fund-form.tsx` (**client**, `useForm` + gate), `funds/fund-row-actions.tsx` (client), `funds/actions.ts` | empty state offers one-click "Create General Fund". |
| `…/admin/giving/gifts` | server | `gifts/page.tsx`, `gifts/gifts-table.tsx`, `gifts/gift-filters.tsx` (client, URL-state) | recorders get the **recent-own-entries** variant of this route (S4), not the ledger. |
| `…/admin/giving/gifts/new` | server + client | `gifts/new/page.tsx`, `gifts/new/offline-gift-form.tsx` (**client**, `useForm` + gate), `gifts/new/donor-picker.tsx` (client combobox → `searchDonors` server action), `gifts/actions.ts` | "Record only the deductible amount. Dinners, raffles and purchases are not gifts."; duplicate warning is inline, not blocking. |
| `…/admin/giving/gifts/[giftId]` | server | `gifts/[giftId]/page.tsx`, `void-dialog.tsx` (client) | gift + reversals + provenance (`recorded_by`, source event kind). |
| `…/admin/giving/gifts/export` | route handler | `gifts/export/route.ts` | see API Contract. |
| `…/admin/giving/donors`, `…/donors/[donorId]` | server | `donors/page.tsx`, `donors/[donorId]/page.tsx`, `donor-form.tsx` (client, gate), `link-panel.tsx` (client; confirm shows the person's name), `merge-dialog.tsx` (client), `donors/actions.ts` | reduced variant for `giving.record`-only viewers (S4); "possible duplicates" panel. |
| `…/admin/giving/settings` | server + client | `settings/page.tsx`, `settings/settings-form.tsx` (client, gate), `settings/actions.ts` | donee identity, signatory, greeting/closing, fee rates; shows what blocks statement issue. |
| `…/admin/giving/team` | server + client | `team/page.tsx`, `team/grant-form.tsx` (client, gate), `team/team-list.tsx`, `team/actions.ts` | Batch 2. |
| `…/admin/giving/statements` | server | `statements/page.tsx`, `statements-table.tsx`, `issue-dialog.tsx` (client; progress loop over `issueStatementBatch`), `exceptions-panel.tsx`, `statements/actions.ts`, `download/route.ts`, `print/route.ts` | year picker defaults to last calendar year. Batch 5. |
| `/site/[slug]/give` | server + client form | `give/page.tsx`, `give/actions.ts` | public, anonymous; static segment beats `[[...path]]`. Batch 4. |
| `/site/[slug]/give/return` | server | `give/return/page.tsx` | `noindex`. |
| `giving` live slot | server | resolver added to `liveSlots` in `[[...path]]/page.tsx`: `giving: (filter) => <PublicGivingSlot slug={slug} filter={filter} />` (closes over `slug` only) | `filter.fund` validated against online funds; never auto-links. |
| `/admin/giving` (platform) | server | `(admin)/admin/giving/page.tsx`, `ingest-health-table.tsx`, `actions.ts` (requeue) | gate `FEATURES.ADMIN_ORGANIZATIONS`; names come from the public `organizations` join; **no donor data**. |
| `/admin/organizations/[id]` (section) | server + client | `treasurer-designation-section.tsx`, `ingest-health-section.tsx` | platform palette. |

### Components to create

- `src/components/giving/give-form.tsx` (**client**, `useForm`, `<HydrationGate>`, 360 px): preset amount chips + "other" (string input, `inputMode="decimal"`), fund select (hidden when one fund), once/monthly, cover-fees checkbox (default **off**; ticking it shows the card/bank choice and a live "gift $X + fees $Y = total $Z" from `grossUp()` — display only), Turnstile widget when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, honeypot, hidden server-minted `idempotencyKey`; submit label "Give"; "pure contribution only" and processing disclosures; test-mode banner when `livemode` is false. Pending state disables the button; on `checkout` result re-asserts `new URL(url).origin === "https://checkout.stripe.com"` then `window.location.assign(url)`. **Zero Stripe.js, zero iframe.**
- `src/components/giving/give-return-panel.tsx`, `giving-unavailable-notice.tsx` (shared with the slot), `test-mode-badge.tsx`.
- `src/lib/giving/giving-copy.ts` — the disclosure, receipt-vs-acknowledgment, monthly-stop and microcopy strings, one place, unit-tested for the forbidden word ("acknowledgment" never describes the Stripe receipt).
- Everything else is co-located with its route (above).

### Files to modify

- `src/lib/org-features.ts` (`orgTypes`, applicability in three places, the giving entry), `org-feature-catalog.test.ts`, `org-features.test.ts`.
- `src/lib/org-portal/tiles.ts`, `tile-icons.tsx`, `tiles.test.ts`, `visible-tiles.test.ts`, `admin/page.test.tsx`, `portal-nav.test.tsx`.
- `admin/features/page.tsx`, `features-list.tsx`, `features-list.test.tsx` — a page-side `offWarning` for `org_portal.giving` from `src/lib/org-feature-warnings.ts` (a registry `org-features.ts` never imports, preserving DECISION-130's one-way rule): turning it OFF with active monthly gifts opens an `AlertDialog` ("N monthly gifts are still active in Stripe and keep charging until cancelled there. Turning this off hides Giving; it does not stop recording."); the count comes from `presby_giving_active_schedule_count()` and is readable by an `org_features.manage` holder because it is a bare count.
- `src/lib/audit.ts` (Batch 1 only), `src/lib/db/domain/authz.ts`, `scripts/seed.ts`, `package.json` (`check:giving-boundaries`, later `stripe`/`pdfkit`), `eslint.config.mjs`, `vercel.json` (Batch 3), `next.config.ts` (Batch 4 CSP; Batch 5 `serverExternalPackages`), `.env.example` (names only, empty), `docs/deployment.md`, `docs/testing.md`, `src/lib/sites.ts` / `src/app/api/sites/ingest/route.ts` (the ingest validator rejects a bundle page at `/give` or `/give/*`, which the static segment would shadow).
- `(admin)/admin/organizations/[id]/{page,actions}.tsx` for the two new sections.

## Implementation Order

**Six batches (R15), one pipeline branch, serialized merges.** Each batch below is *shippable with the toggle OFF*: OFF means every giving route renders the honest toggle-off state before any giving read, the tiles are absent, and no giving page issues a tenant query. A batch that cannot meet that sentence is mis-scoped and loops back to Phase 3.

```
B1 foundation ──merge──▶ ┬─ B2 funds/gifts/donors/team/settings ─┐
                         └─ B3 provider core / Stripe / webhook ─┴─▶ B4 public giving ─┐
                                                          └──────▶ B5 statements ──────┴─▶ B6 member surface + settlements
```

- **Parallel worktrees** (permission, not requirement; sequential is the default): B2 ∥ B3 after B1 merges, each on a Neon child branch of the pipeline branch. B2 makes **no DDL edits** — a needed edit loops back. B3 owns any in-place 0055 corrections to the ingest/apply functions, the `package.json`/lockfile edit (`stripe`), `vercel.json`, `docs/deployment.md`. B4 starts after **both** B2 and B3; B5 starts after B3 (lockfile serialization: `pdfkit`) and may run beside B4; B6 last. Merges into the pipeline branch are serialized, and **`scripts/test-rls.sql` is re-run as `presby_app` after each merge** before the next lands.
- **In-place 0055 corrections** while unreleased follow the Project Layout rule (same file, same number, re-apply twice); each is named in the correcting batch's notes with the §46 assertion that would have caught it.
- **Deferred to integration (orchestrator, Rule 16)** — never edited by a batch: `docs/decisions.md` (DECISION-168…175), `docs/TODO.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/schema-design-2.md` (F138–F141), `scripts/test-rls.sql` (one `\ir giving/test-rls-46.sql` line), `scripts/seed-dev.sql` (one `\ir giving/seed-dev-giving.sql` line), `src/lib/db/domain/index.ts` (`export * from "./giving"`), `drizzle/meta/_journal.json` (idx 55 and 56), `docs/product/functionality-map.md`, `docs/architecture.md` (only if a subsystem boundary changed — the inbox/adapter shape arguably is; the orchestrator rules at Phase 6), release notes, what's-new.

### Batch 1 — Foundation (invisible)

**Implementers:** `database-admin` (1a: DDL, Drizzle, DB tests, drafts) then `full-stack-developer` (1b: catalog, tiles, audit keys, designation, access helper, tripwire, ESLint rule, fixtures). **This is the named implementer for Batch 1: database-admin.** 1b starts when 1a's migration is applied to the pipeline branch.

**Files.**
- 1a: `drizzle/0055_presby_giving.sql`; `src/lib/db/domain/giving.ts`; `src/lib/db/domain/authz.ts` (`requiresTwoFactor`); `scripts/giving/test-rls-46.sql`; `scripts/giving/seed-dev-giving.sql`; `src/lib/testing/giving-fixture.ts` (`armGivingWrite`, org/donor/gift builders using invented names); `scripts/seed.ts` (flag removal); `npm run docs:erd` output.
- 1b: `src/lib/audit.ts` (all keys); `src/lib/org-features.ts` (+ tests); `src/lib/org-portal/tiles.ts` (+ tests, icons); `src/lib/treasurer-designation.ts` (+ test); `(admin)/admin/organizations/[id]/{actions.ts,page.tsx,treasurer-designation-section.tsx}`; `src/lib/giving/access.ts` (`assertGivingSession`, `loadGivingContext`); `src/lib/giving/types.ts`; `src/lib/giving/money.ts`; `src/lib/giving/statement-policy.ts`; `src/lib/giving/live-predicate.ts`; `scripts/check-giving-boundaries.mjs` (+ `.test.mjs`) and the `check:giving-boundaries` npm script appended to `npm run check`; `eslint.config.mjs` (`stripe` restriction); `admin/giving/page.tsx` replaced by the **toggle-aware shell** (Forbidden / ToggleOff / NotApplicable, no data) and its test.

**Batch 1 implementation notes (feasibility catches).** `RETURNS TABLE` OUT-parameter names in plpgsql shadow table columns (`raw_body`, `status`, `connection_id`): prefix them `out_` or start the body with `#variable_conflict use_column` — the design's column names in the signature table are the *logical* names. The `presby_two_factor_required` replacement is `language sql`, not plpgsql, so its CTE names (`me`, `tfa`) cannot collide. `giving_provider_events.attempts` increments in `claim`, not `finish`. The partial unique index `giving_connections_one_open_idx` is what makes `startConnect` idempotent; the TS pre-check is only for the friendly message.

**Tests the implementers write.**
- *DB / SQL:* `scripts/giving/test-rls-46.sql` §46a–§46n above, each proven failing-first (drop or disable the specific mechanism, cite the failing assertion, restore); the P3-8 cascade premise test; **whole-file re-apply of 0055 twice** with no row-count change; `explain (analyze)` of `presby_two_factor_required` recorded in the batch notes; the resolver `md5(prosrc)` captured from `development`.
- *Vitest (DB-backed, `npm run test:db`):* the 2FA agreement matrix (`src/lib/giving/two-factor-agreement.test.ts`); `treasurer-designation.test.ts` (every refusal, reuse-and-reactivate of the fixture's protected `treasurer`, additive reconcile, `giving_recorder` minted ungranted, **no person/membership created**, gate flips once a holder exists, org-type refusal, the unchanged-files hash pin for `authz.ts`, `role-definitions.ts`, `role-grants.ts`, `drizzle/0010`); `org-features.test.ts` (applicability in `listFeatureToggles`, `toggleOrgFeature` → `invalid_key`, `orgFeatureEnabledInTx` → false for a presbytery with a stray row; the NWC half uses an inserted fixture org — none exists on `development`); `tiles.test.ts` (scope equality with the catalog).
- *Unit:* `money.ts` (accept/reject table incl. `1e3`, `-5`, `１２`, `10.999`, `0`, `250001`); audit-keys snapshot (existing string values frozen; every new key present); `check-giving-boundaries.test.mjs` (fixture trees that violate each rule fail).
- *e2e:* extend `admin-organizations.spec.ts`: the designation control renders for a congregation with no `giving.manage` holder, is absent for a presbytery and for an org that has one (count shown, no names), and designating the fixture user makes the control disappear.

**Gate it waits on:** none (Operator Q2 answered). **Done =** typecheck, lint (`--max-warnings=0`), `npm run check`, `npm run test`, `npm run test:db`, `psql … test-rls.sql` as `presby_app` (with the draft included locally), `npm run check:schema-parity`, `npm run test:e2e` green. **Shippable OFF:** nothing is visible; the toggle row is absent everywhere; the only user-visible delta is the retired placeholder.

### Batch 2 — Funds, offline recording, gift list, donors, settings, team (works with no Stripe)

**Implementer:** `full-stack-developer`. **Gate:** B1 merged.

**Files:** `src/lib/giving/{funds,gifts,donors,settings,team,attention}.ts`; the `admin/giving/{funds,gifts,donors,settings,team}/**` routes and co-located `actions.ts`; `gifts/export/route.ts`; the overview page's non-Stripe cards (`attention-list.tsx`; a "Connect Stripe" placeholder card that says Stripe isn't set up yet — the real panel arrives in B3); `src/lib/org-feature-warnings.ts` + the features-page dialog; `e2e/support/giving-fixture.ts` (follows `calendar-fixture.ts`, but holding any giving key now forces 2FA — so it grants giving roles **only** to the `mfa-enrolled` user, given a membership at `e2e-alpha`, and to dedicated throwaway users, and tears them down in `afterAll`; the spec completes TOTP with `totp-fixture.ts`, and one negative test uses an unverified session).

**Tests:** *unit* — gift/fund/donor validators, duplicate detection, `proposeLink` privacy filters (`is_shared`, `directory_hidden`, `hide_email`, dismissed), CSV writer (quoting, formula-injection prefix, no email/address columns, 50k cap), copy constants; *DB-backed* — funds (unique name incl. retired, `offered_online` needs a display name), `record/void` through the functions (future date, retired fund, unidentified+check refused, `recorded_by` bounded to org members, own-entry void window), donor merge (flatten, link inheritance, `link_conflict`), team (**G2 self-grant**: a `roles.manage + role_grants.manage` holder without giving keys cannot grant a giving role through `grantRole` — the subset check; **F138**: a `giving.manage` holder can grant `giving_recorder` and a successor `treasurer` through `grantGivingRole`; a role containing a non-giving key is refused with `not_giving_only`; group-arm refused; last-manager revoke refused; DECISION-106 delta regression for adding a giving key to a role by a `roles.manage` holder without that key), S4 scope (a record-only holder gets only picker + own entries, never `listGifts`/totals/`getDonor`), the `loadAttention` queries incl. S5's parity with the page; *e2e* — `giving-admin.spec.ts`: treasurer records a cash, a check and a stock gift, sees it in the list, exports CSV (content-type, no PII columns), voids with a reason; recorder sees the reduced variant; toggle OFF renders the toggle-off state on **every** route in the route table; **a platform admin who is not a member gets the four-way miss on every `/o/<slug>/admin/giving/**` URL** (analyst test 6, looped over the route list); an **MFA-enrolled seeded user** with a giving role who has not verified TOTP is redirected to `/totp?callbackUrl=…` on the admin pages (the R4 Node-side check, using the `totp-full-login` pattern) while the member `giving` page is not forced; `e2e/hydration/giving-offline-gift-form.spec.ts` (hold the JS chunks, assert the amount/fund/date/method controls and Save are disabled, release, pick a **non-default** fund and type an amount, submit, and assert the **persisted** gift row via `platformSql`); 360 px viewport run of the overview, gifts list and new-gift form; `npm run test:e2e` for the whole suite (blast radius below).

**Shippable OFF:** the toggle-off state renders on all routes; the features page can switch the toggle on for a fixture org.

### Batch 3 — Provider core, Stripe adapter, webhook, cron, connection UI, platform health

**Implementers:** `api-developer` (3a: everything server) then `ux-developer` (3b: connect panel, connect pages, platform health pages). **Gate:** B1 merged; **Operator Q1 — a test-mode platform account with Connect enabled — before 3a's verification** (tracked, not assumed); B2 merge not required.

**Files (3a):** `npm i --save-exact stripe@23.0.0` (DECISION-169; first and only dependency change in this batch); `src/lib/giving/providers/stripe/{client,normalize,status,fees,checkout,onboarding}.ts`; `src/lib/giving/ingest/process.ts`; `src/lib/giving/origin.ts`; `src/app/api/webhooks/stripe/route.ts`; `src/app/api/cron/giving/route.ts`; `vercel.json`; `src/lib/admin/giving-ingest-health.ts` (the only `getPlatformDb()` use); the connect actions; `src/lib/giving/providers/stripe/testing/{sign-event.ts,fixtures/*.json}`; `.env.example`; `docs/deployment.md` (env vars, webhook endpoint creation — scope **Connected accounts**, API version pinned to `2026-09-30.endive`, the exact event list, key rotation, restricted-key permission table, the go-live checklist) and `docs/testing.md`; extend `check:giving-boundaries` (stripe import location, `getPlatformDb` bans, `email_queue`/amount rule, `form-action`/`script-src`/`frame-src` contain no `stripe.com`). **3b:** `connect-panel.tsx`, `connect/**` pages, `(admin)/admin/giving/**`, `ingest-health-section.tsx`.

**Tests:** *unit* — `normalize` table-driven over a fixture per handled event type (incl. unknown types, malformed JSON, `livemode` flip, wrong `api_version`, amount/currency anomalies, missing `account`); `status.ts` v1/v2 agreement table; `client.ts` allowlist (exact export set, forbidden-method grep, origin assertions for `checkout.stripe.com` / `accounts.stripe.com` / `connect.stripe.com` incl. look-alike hosts and userinfo tricks, secret never appears in a thrown message); `process.ts` outcome aggregation and audit emission with a mocked client; *DB-backed* — every apply function through the real functions (idempotent replay, out-of-order parking and the 24 h ageing rule, one-way status, fee set-once, reversal bound, over-reversal, subscription start/renewal/end, intent mismatch, foreign intent, donor dedupe P3-15, auto-link and link-conflict, `occurred_on` year-boundary and F132 fallback); *e2e — the signed-event replay harness* (`e2e/giving-webhook.spec.ts`): the spec signs fixture bodies with `STRIPE_WEBHOOK_SECRET` from the test environment (CI uses a non-key-shaped literal such as `giving-e2e-signing-secret`; the SDK only needs HMAC bytes) and POSTs to the **real route** against the seeded DB: bad signature 400, good signature 200 and an applied gift row, byte-identical replay is a no-op, unknown account is the same 200 and writes nothing, `livemode` mismatch is the same 200 and writes nothing, a refund arriving **before** its gift parks then applies once the gift event is replayed, a body naming a foreign fund id is ignored (fund comes from the intent), `account.application.deauthorized` disconnects and is audited, an over-reversal dead-letters and appears on `/admin/giving` with counts only; secret-unset 503 is a unit test (process env cannot be toggled per request in the dev server). *Operator test-mode smoke (documented, executed by the operator):* create account → onboarding → return page shows `active`; one-time card and ACH gifts (`4242…`, test bank), a monthly gift, a refund and a dispute from the Stripe Dashboard, a payout; confirm `account.updated` reaches the Connect endpoint for a v2 account; capture and sanitize one recorded `GET /v2/core/accounts/{id}` response into `fixtures/`; attempt the portal-session probe (Stripe confirmation 3); verify the restricted key set (confirmation 4); run `check:secrets` before the first fixture commit. QA's Phase 5 for this batch is the replay harness plus a documented smoke — never Stripe-hosted Checkout automation.

**Shippable OFF:** with the toggle off nothing in the UI changes; the webhook route exists and returns 503 until the secret is set and Stripe is pointed at it; with the secret set it records events for connections that don't exist as `ignored`.

### Batch 4 — Public giving (the first batch where money can move)

**Implementers:** `api-developer` (4a: actions, intent wiring, rate limits, ingest-validator change) and `ux-developer` (4b: `GiveForm`, pages, live slot, return panels, CSP header). **Gate:** B2 **and** B3 merged; a connection exists in test mode.

**Files:** `src/components/giving/*`; `src/app/(public)/site/[slug]/give/**`; `src/app/(org)/o/[slug]/giving/give/**`; the `giving` resolver in `[[...path]]/page.tsx`; `next.config.ts` — a **second `headers()` entry with an *enforced* `Content-Security-Policy`** for `source: "/site/:slug/give/:path*"` and `"/o/:slug/giving/give/:path*"`, the same string as today's report-only policy (`form-action 'self'`, no Stripe origins anywhere — a `check:giving-boundaries` rule pins it); `src/lib/sites.ts` ingest validator; `e2e/security-headers.spec.ts` assertions for the enforced header on those paths.

**Tests:** *unit* — `GiveForm` (jsdom: amount parsing display, fee preview math vs `grossUp`, cover-fees default unchecked and reveals card/bank, honeypot present, Turnstile conditional, pending state, origin re-assertion rejects `https://checkout.stripe.com.evil.example`), actions (every `GiveResult` arm; rate-limit order; honeypot spends no budget; `Host` header spoofing cannot change `successUrl`; an `amount` of `"10.999"`, `"1e3"`, `"-5"`, `"٣٠"` is `invalid`), page state machine (`live`/`unavailable`/`absent` with identical `absent` markup for an unknown slug, a non-tenant slug and a toggle-off org); *DB-backed* — `create_intent_public` refusals (46l list) and the TS/SQL gross-up grid; *e2e* — `giving-public.spec.ts` (the three page states; submit with Stripe unconfigured lands on `unavailable` after writing a `failed` intent; the return page's five panels seeded directly; no Stripe origin in any response header or script tag; an enforced `Content-Security-Policy` header is present on the give routes and **not** on others), **`e2e/hydration/giving-give-form.spec.ts`** (in both lanes, `npm run test:e2e:prod` included; hold the chunks, assert amount/fund/frequency/cover-fees/Give are `disabled` pre-hydration, release, choose a **non-default** fund and a monthly frequency and type `37.50`, submit, and assert the **persisted `giving_checkout_intents` row** — fund id, `gift_amount_cents = 3750`, `total_cents = 3750`, frequency, `status = failed` because Stripe is unset in e2e — then the negative control: revert `<HydrationGate>` in the scratch copy, the spec must go red), and a 360 px pass of give, unavailable and each return panel in a browser (Verify in a Browser).

**Shippable OFF:** the give page, the slot and the member give page all collapse to the neutral `absent`/toggle-off state; the enforced CSP header applies only to routes that render nothing sensitive while OFF.

### Batch 5 — Statements

**Implementers:** `database-admin` (5a: `0056`, Drizzle additions, §46 additions, `check-schema-parity` allowlist rows) then `full-stack-developer` (5b: renderer, lib, pages, routes, notice email). **Gate:** B3 merged (lockfile); `pdfkit` installed here first (`npm i --save-exact pdfkit@0.20.2 @types/pdfkit`, DECISION-174's three obligations: re-confirm version/licence, `serverExternalPackages: ["pdfkit"]` plus an `outputFileTracingIncludes` entry proving the font data is traced into the function, and a committed OFL font with Latin Extended and Vietnamese coverage); **Operator Q6 (CPA review of wording and the four accounting questions) gates *enabling* statements for any real congregation** — enforced in code: `issueStatementBatch`/`reissueStatement` refuse when `process.env.NODE_ENV === "production"` unless `GIVING_STATEMENTS_ENABLED === "1"` (an operator-set environment variable, not a platform flag; removed once the CPA has ruled).

**Files:** `src/lib/giving/statements.ts`, `statements/{compose,render-pdf,wording,notice}.ts`, the statements routes, `giving.statement.notice` email template, `next.config.ts` (`serverExternalPackages`, tracing), `package.json`, committed font + licence under `src/lib/giving/statements/fonts/`.

**Tests:** *unit* — `wording.ts` golden text per wording version (the IRS block is code, never editable; greeting substitution is plain replacement; hostile donor names such as `{{x}}`, `<script>`, a 10,000-character name and RTL text render as inert text), `compose` (totals split cash vs non-cash; stock line omits value; covered fee follows the policy constant; reversals netted; a fully reversed gift is excluded; year boundary by `occurred_on` only), `render-pdf` (`%PDF` header, text extraction contains the donee name, EIN when set, address, totals; pinned metadata dates make output stable; a batch print equals the individual pages' text); *DB-backed* — issue idempotency under concurrency (two parallel issues for one donor/year: one wins, one `already_issued`), staleness (late-dated gift, late pending→succeeded, later refund, test-mode gift does **not** make a statement stale), re-issue chain (`supersedes`, no fork, original retained), unidentified donor refused by the insert guard, consistency trigger refuses a tampered total, frozen rows (`update`/`delete` raise on the owner connection), blob FK keeps the PDF undeletable, merged-donor statements appear under the root for the member; *e2e* — `giving-statements.spec.ts`: issue a run for the fixture prior-year gifts, download the PDF (`application/pdf`, `%PDF`, `attachment`, `no-store`), a replayed refund (B3 harness) turns the statement stale, re-issue produces version 2 titled "Corrected statement…", the member download returns the **identical 404** for another member's statement and for a nonexistent id, the notice email contains no `$` and no digits-with-decimals (assert against the dev email intercept), print run is audited; a 360 px pass of the statements page.

**Shippable OFF:** statements routes sit behind the toggle; in production they additionally refuse to issue until `GIVING_STATEMENTS_ENABLED=1`.

### Batch 6 — Member surface and settlements (settlements droppable)

**Implementer:** `full-stack-developer`. **Gate:** B5 merged (statements to list); B3 merged for settlements.

**Files:** `src/lib/giving/self.ts` (+ DB test per DECISION-162's four conditions), the member `giving/**` pages, the "Give online" entry, `statements/[statementId]/download/route.ts` (member), `src/lib/giving/settlements.ts` and the settlements page under `admin/giving/settlements`, `fillSettlementLines` (cron branch + `listBalanceTransactionsForPayout` → `apply_settlement_lines`), manual-payout detection ("reconciliation unavailable").

**Tests:** DB test that **another member's rows, another org's rows, a spouse/household member's rows, and a Session member's view return nothing**, and a directory-hidden member still sees their own history; the download route's identical-404 parity (unit + e2e); empty and error states ("We can't load your giving history right now" on a forced DB error); settlements read-only list with automatic-payout and manual-payout fixtures; 360 px pass; `giving-member.spec.ts`. If settlements slip, B6 ships without them and the TODO carries the line.

**Shippable OFF:** the member page renders the toggle-off state; the tile is absent.

### Go-live checklist (operator; recorded in `docs/deployment.md` by Batch 3, enforced by humans)

`STRIPE_SECRET_KEY` (restricted key per the table) and `STRIPE_WEBHOOK_SECRET` set in production **only**; webhook endpoint scope = Connected accounts, API version pinned, event list exact; `NEXT_PUBLIC_APP_URL` set to the canonical `https` origin; `CRON_SECRET` set; Upstash and Turnstile configured; `auth.require_2fa` on; the enforced CSP verified on the give routes in a browser; the congregation's Stripe payouts are automatic (attested in-app); Stripe statement descriptor shows the congregation name; `GIVING_STATEMENTS_ENABLED` unset until the CPA rules; privacy copy discloses the platform account's technical reach at Stripe (G27); `docs/deployment.md` carries the key-rotation procedure.

## Edge Cases & Risks

### The analyst's adversarial table, as design rules

| Vector | Rule (where it lives) | Proven by |
|---|---|---|
| Redirect targets | `success_url`/`cancel_url` from `givingOrigin()` (env, `https` in production), never `Host` or a form field; return URL carries only Stripe's `{CHECKOUT_SESSION_ID}` | `actions.test.ts` spoofs `Host`/`X-Forwarded-Host` |
| Amount and fee tampering | Client sends a string and booleans; the DB recomputes the total (`presby_giving_gross_up`) and the action uses the DB's figures; strict `^\d{1,5}(\.\d{1,2})?$`; bounds 100..2,500,000 | `money.test.ts`, 46l, the TS/SQL grid |
| Cross-org fund | `org` comes from the slug only; the fund must be active, `offered_online`, in that org — in `create_intent_public` **and** implicitly at the webhook (the fund comes from the intent, never from Stripe metadata) | 46f, 46l, the replay spec |
| State-machine shortcuts | The return page reads presby's own rows by session id and returns `{state, amount, fund}` only; no query parameter marks anything paid; `unknown` is identical for absent/foreign/malformed ids | 46l, `give/return` page tests |
| Card testing and abuse | honeypot → three rate-limit keys (incl. a global one for the shared platform key) → Turnstile → DB flood cap (201st `created` intent/hour) | `actions.test.ts`, 46l |
| Enumeration | No "manage my gift by email" exists in v1; the give page never prefills; webhook returns one 200 for accepted/duplicate/ignored/unknown-account; statement download returns the identical 404 for "not yours" and "absent"; `absent` markup is identical for unknown slug, non-tenant slug and toggle-off org | page tests, 46e/46l, download parity test |
| Webhook forgery/replay | SDK signature check over raw bytes, 300 s tolerance, unique `(connection, event id)`, idempotent apply keyed on external ids | replay spec |
| Account-takeover-by-link | Proposals only; the confirm dialog shows the person's **name**; statements go to the donor's own snapshotted email/address; links removable, audited; auto-link only via a signed-in member's own intent | `donors.test.ts`, 46g |
| Self-targeting | A recorder may void their own entries (≤ 30 days) and the audit shows `recorded_by`; a `giving.manage` holder cannot grant beyond what they hold (subset check, unchanged) | team tests |
| Input boundaries | Donor names/addresses from Stripe are bounded and control-character-stripped in SQL, stored as text, escaped by React everywhere, and substituted into the statement greeting by plain string replacement; PDF text is drawn, not interpreted; CSV cells are formula-prefixed | wording, CSV and render tests |
| Open redirect on connect return | `return_url`/`refresh_url` are fixed paths on `givingOrigin()`; the only `?next`-like input goes through the existing sanitizer | connect action test |
| Server-side validation | Everything above is server-side; the form is advisory | — |

### Concrete edge cases

- **Year boundary.** `occurred_on` is computed once, in SQL, in `organization_settings.time_zone` with the `America/New_York` fallback when the org has **no settings row** (F132 — 13 of 15 dev orgs). A 23:30 ET gift on Dec 31 is a Dec 31 gift; its UTC instant is Jan 1. Changing an org's zone later never rewrites history. Statement ranges use `occurred_on` alone. ACH gifts use the authorization instant (the checkout-completion event time), per G9's recommendation — one function to change if the CPA rules otherwise.
- **Livemode.** A connection's `livemode` is fixed at creation from the key mode. Events whose `livemode` disagrees are `ignored`. A test-mode connection shows the badge on every admin page; its gifts carry `livemode = false` and are excluded from every total, export and statement by the shared predicate. Offline gifts are `livemode = true`.
- **Out-of-order and duplicate events.** Duplicate delivery → `duplicate`; duplicate apply → `noop`. A reversal/fee before its gift → `parked:no_gift`; a renewal before its subscription → `parked:no_subscription`; both retry on backoff for 24 h from first receipt, then finish `ignored` (a foreign payment, e.g. a dinner-ticket refund, must not clutter dead letters). Any other failure dead-letters after 8 attempts.
- **Dead letters.** Visible to the operator at `/admin/giving` (counts and ages, no payloads) and to the congregation as a count in "needs attention" (S5). Replay is audited and, for a purged body, re-fetches through `retrieveEvent`.
- **Donor merge with links.** Merge flattens (every donor that pointed at the source is repointed first; depth stays 1). A source's link moves to the target only if the target has none; two different links refuse with `link_conflict` until one is removed. New events resolve identity → donor → root. Issued statements stay on the donor they were issued to and appear to the member through the root.
- **Retired fund in flight.** The fund on a gift comes from the intent, so a Checkout session opened before retirement still completes into the retired fund. Offline recording rejects a retired fund. Statements show the fund's name.
- **Disconnect with active subscriptions.** Presby's disconnect is local — the Stripe account is neither closed nor deauthorized (a platform cannot deauthorize a v2 account it created without closing it, and closing would harm the congregation). The dialog states the number of active monthly gifts and that they keep charging in Stripe until cancelled there. Ingest continues for a disconnected connection so recurring gifts stay recorded. A Stripe-side deauthorization arrives as `account.application.deauthorized` and is audited as a system act. Toggle-OFF shows the same warning and never stops ingest.
- **Failed first ACH.** `async_payment_failed` → a `failed` gift in "needs attention" with the donor's contact (for `giving.view`). A failed *renewal* is a `last_payment_failed_at` flag on the schedule (P3-16), shown to the treasurer, never a gift row.
- **A subscription changed in the Stripe Dashboard.** A renewal whose amount differs from the intent is recorded at the amount actually collected with `donor_covered_fee_cents = 0` (a first payment that differs dead-letters as `amount_mismatch` — a tamper signal).
- **Unconfigured installation.** `isStripeConfigured()` false → the Connect panel says "Online giving isn't enabled on this installation" (a state, not a stack trace); the give page renders from database state and its action fails the intent and returns `unavailable`. The webhook returns 503.
- **Webhook processing in `after()`.** If the function is cut off, the event stays `received`/`processing` and the 5-minute cron picks it up once its lease expires. Nothing depends on `after()` finishing.
- **Platform key rate limits.** One platform key serves every congregation, so the global limiter key exists; `maxNetworkRetries` is 2; Checkout creation failures return the generic `error` and fail the intent.
- **Orphan blob after a statement-issue failure.** `store()` runs on its own transaction before the statement insert; a failure between them leaves an unreferenced blob row (no DELETE grant, so it stays). Accepted: it holds one donor's statement, is unreachable from any page, and retries are idempotent on `(donor, year, version)`.
- **Untrusted display text.** Donor name falls back to "Online donor"; email and address are validated shapes, otherwise dropped; nothing from Stripe is ever interpolated into HTML or a template engine.
- **Reconnect.** Disconnect is terminal for the row; reconnecting creates a new Stripe account (a pre-existing account needs OAuth, out of scope). History stays attached to the old connection.
- **Platform admin on `/o/<slug>/admin/giving/*`.** A non-member gets the four-way miss; there is no platform branch anywhere in these pages.
- **Template visibility.** The `treasurer` and `giving_recorder` templates are `organization_type_scope = NULL`, so a presbytery's role picker lists them; adopting fails the subset check. Cosmetic, accepted; narrowing needs a multi-type scope column.

### Existing e2e/unit specs this change will alter (blast radius)

- `e2e/portal-home-cards.spec.ts` (the domain-section assertions near line 214) and `e2e/member-home.spec.ts`: in dev the placeholder tile appeared because `org_portal.giving` was seeded ON; it now disappears, and the "Giving & Finance" section only appears for orgs with the toggle on. Verify no count/heading assertion depends on it; the fixture that turns the toggle on (Alder Creek) changes what those specs see.
- `e2e/admin-organizations.spec.ts`: the organization detail page gains two sections (designation, ingest health); any assertion counting sections or snapshotting the page changes.
- `e2e/role-boundaries.spec.ts` and any route-matrix spec: new admin routes join the matrix.
- `e2e/public-sites.spec.ts` and `visual-parity.spec.ts`: the static `give` segment now precedes `[[...path]]`; a fixture bundle with a `/give` page would be shadowed (the ingest validator now rejects one).
- `e2e/security-headers.spec.ts`: new enforced-CSP assertions on the give routes; the existing report-only assertion on `/` is unchanged.
- `e2e/totp-full-login.spec.ts`, `post-login-routing.spec.ts`, `totp-callback-bypass.spec.ts`: the jwt callback's `twoFactorRequired` now also depends on arm B. The e2e roster (`e2e/support/users.ts`) is separate from `seed-dev.sql`'s people (Priya is not an e2e login), so nobody on it newly requires 2FA — **unless `giving-fixture.ts` grants a giving role to a user another spec relies on without TOTP**. Rule for B2: the fixture grants giving roles only to the `mfa-enrolled` user (given a membership at `e2e-alpha`) and to dedicated throwaway users, and removes them in `afterAll`; `congregation-clerk` and the presbytery users never receive one.
- Vitest: `tiles.test.ts:75,167,242`, `visible-tiles.test.ts:184-187`, `admin/giving/page.test.tsx`, `admin/page.test.tsx`, `portal-nav.test.tsx`, `org-states.test.tsx`, `org-features.test.ts`, `org-feature-catalog.test.ts`, `features-list.test.tsx`, `src/app/page.test.tsx` if it mentions Giving, and `src/lib/org-provisioning.test.ts` (unchanged behavior, must still pass).
- DB: `scripts/test-rls.sql` §15/§44a count roles and test sample keys; the seed change (P3-3) must keep the fixture `treasurer` role present and `ledger.approve` present in `permissions`.

### Gap coverage index (G1–G31)

G1 → R2 designation + P3 team path; G2 → `team.ts` tests + DECISION-106 delta regression; G3 → `self.ts`; G4 → R4 arm B + Node check; G5 → `orgTypes`; G6 → `giving_settings` + issue blockers; G7 → code-generated wording + form copy + R9 structural; G8 → non-cash line shape, stock fields; G9 → `occurred_on`; G10 → `donor_covered_fee_cents` + policy constant; G11 → derived staleness + versions; G12 → delivery snapshot, undeliverable list, contact-change audit; G13 → no DELETE, retention, 90-day body purge; G14 → `livemode`; G15 → `giving-copy.ts`, statement descriptor; G16 → page + slot; G17 → church-contact stop path (P3 confirmation 3); G18 → copy rule; G19 → bounds, HydrationGate, idempotency key; G20 → auto-link; G21 → rates on the connection; G22 → local disconnect + ingest independence; G23 → funds; G24 → search-before-create, `recorded_by`, privacy-honoring proposals; G25 → CSV; G26 → settlements; G27 → R8 allowlist + RAK table + no-log rule; G28 → 503, inbox without grants, `account` validation, intent-sourced funds; G29 → replay harness + operator smoke; G30 → redirect-only + enforced CSP + pinned static check; G31 → audit table.

### Risks, ranked

1. **Stripe v2 specifics are partly unconfirmed** (payouts-enabled path, `account.updated` for v2, RAK acceptance of v2 endpoints, the portal). Each is isolated behind `client.ts`/`status.ts`, covered by a Batch 3 probe, and none changes a table.
2. **Per-request cost of the 2FA arm** (runs in the `jwt` callback). Measured in Batch 1 against a 5 ms budget.
3. **The P3-8 cascade premise** (parent row invisible to the child's BEFORE DELETE). Tested first in Batch 1; the fallback is a one-line GUC arm.
4. **Resolver drift** (F140). Hash tripwire plus the agreement matrix.
5. **In-memory rate limiting on Vercel.** DB flood cap and the Upstash go-live item.
6. **Platform key breadth at Stripe** (G27). Allowlist, RAK, no-log rule, rotation runbook, disclosure.
7. **CPA rulings** may flip G9/G10/G11 policy — each is one constant or one function by construction.

## Out of Scope (explicit non-goals — confirm)

Everything the analyst listed, plus these Phase 3 consequences: billing-portal sessions and any self-service stop/change of a monthly gift (church contact in v1); the account-less-donor statement token download; Stripe thin-event destinations; cron connection-status polling; donor-recognition surfaces and an "anonymous" display flag; customer reuse for signed-in members (a new Stripe customer per checkout, deduped by P3-15); refunds initiated from presby; household/joint statements; CSV export of donor contact data; presbytery or synod giving; any ledger link column; tier-3 extension of `requires_two_factor` (S2, tracked); dual-count cash controls; OAuth connection of an existing Stripe account.

## Decision draft and findings (integration drafts — not written to the shared files)

**DECISION-175 — Phase 3 implementation rulings for online giving: giving keys never travel the commission/delegation arms; the giving 2FA arm is an independent inline predicate pinned to the resolver; gifts and reversals are written only by SECURITY DEFINER functions; platform ingest-health is owner-only; the cascade-aware delete guard; print-only statement delivery; two allowlist amendments.**

**Status:** Resolved · **Date:** 2026-10-15 · **Feature:** `2026-10-15-online-giving` (Phase 3 tech-lead). *(One entry carrying numbered sub-rulings; the orchestrator may split it into DECISION-176+ at integration if those numbers are free.)*

1. **Downward paths closed (F139).** `presby_effective_permissions()` allows any role as a commission or delegation role, which would let a parent council's commission members read a congregation's per-member giving. Three triggers (0055) refuse a role carrying a `permissions.module = 'giving'` key as an `administrative_commissions`/`org_delegations` role and refuse binding such a key to a role already so used. Cost: a presbytery commission cannot be granted treasury powers; lifting that is a deliberate future pipeline.
2. **2FA arm shape (F140).** `presby_two_factor_required()` gains an inline CTE reproducing the resolver's four arms rather than calling or refactoring `presby_effective_permissions()` (which needs an org context sign-in doesn't have, and whose file R2 pins as unchanged). Agreement is pinned by a DB test over scenario matrices and the real resolver, and drift is tripwired by an `md5(prosrc)` assertion on the resolver.
3. **Writers.** Gifts and reversals have no INSERT/UPDATE grant for any role; offline recording, voiding and every apply path are SECURITY DEFINER, and triggers require the transaction-local marker `presby.giving_write_active` on every connection (grant + marker, DECISION-141).
4. **Owner-only health.** `presby_giving_ingest_health()` and `presby_giving_requeue_event()` are executable by the owner only, called from one file outside `src/lib/giving/` through `getPlatformDb()`. This amends DECISION-171's "EXECUTE granted to `presby_app` alone" for these two functions; `getPlatformDb()` appears nowhere under `src/lib/giving/`.
5. **Delete guard.** Gifts, reversals, donors, events (and, in 0056, statements) refuse DELETE unless the row's own `deletable_until` is in the future or the parent `organizations` row no longer exists (the sanctioned teardown cascade). Verified empirically in Batch 1; fallback is a GUC arm in `presby_guard_organizations_delete()`.
6. **Statements.** Print plus a no-amounts portal notice in v1; the token download is a tracked follow-up. Issuing is refused in production until `GIVING_STATEMENTS_ENABLED=1` (CPA gate, an operator-set environment variable).
7. **Stripe allowlist.** Adds `retrieveInvoiceForPayment` (an event-anchored single retrieve, required because Invoice no longer links to its PaymentIntent) and removes the portal session (unconfirmed for direct-charge customers). Account-onboarding links are served from `accounts.stripe.com`, so the origin assertion accepts that host and `connect.stripe.com`. The restricted-key table (Stripe confirmation 4) is the production key contract.
8. **Donor dedupe.** A new Stripe customer attaches to an existing donor only on an exact normalized email and exact case-folded name match to a single donor; otherwise it is a new donor and a possible-duplicate suggestion.

(2026-10-15, tech-lead Phase 3; `docs/work-log/2026-10-15-online-giving.md`.)

**Proposed findings (drafts for `docs/schema-design-2.md`, numbered after F138):**

- **F139: the resolver's commission and delegation arms accept any role, so a giving role could carry per-member giving to a parent council.** Closed by the three DECISION-175 (1) triggers; not reachable today because `withOrgContext()` needs an active membership at the target.
- **F140: the giving 2FA arm duplicates the resolver's four arms.** An edit to the resolver that is not mirrored silently under-requires 2FA for giving holders. Mitigated by the agreement matrix and the `md5(prosrc)` pin; the durable fix is a shared core function in a future resolver pipeline.
- **F141: the R8 allowlist, as ruled, could not complete a recurring-gift path.** Basil-era Invoices no longer carry their PaymentIntent and `invoice_payment.paid` carries no subscription or customer, so one event-anchored invoice retrieve is required. Process finding: Phase 2 should confirm the linkage *before* fixing an allowlist; Phase 3 confirmed and amended.

## Implementer

**Batch 1: `database-admin`** (0055, Drizzle, §46 and seed drafts, DB tests), then `full-stack-developer` (catalog, tiles, audit keys, designation, access helper, tripwire, ESLint rule). Later batches: B2 `full-stack-developer`; B3 `api-developer` then `ux-developer`; B4 `api-developer` + `ux-developer`; B5 `database-admin` then `full-stack-developer`; B6 `full-stack-developer`. QA (Phase 5) runs the replay harness, the DB suites, the whole e2e suite on a phone viewport and the feature-gate audit by reading `route.ts` and `ingest/process.ts` by hand (`check:audit` does not scan route handlers).

---

# Phase 4 — Implementation

## Batch 1a — schema (database-admin)

*2026-10-15, database-admin, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax` (child of `development`). Nothing committed. No server started or stopped.*

### Files Created

- `drizzle/0055_presby_giving.sql`: the whole Batch 1 DDL, hand-written. It has the `giving_provider` enum; `permissions.requires_two_factor` and the three `giving.*` keys; the twelve giving tables with composite tenant keys and NO ACTION composite FKs; ENABLE + FORCE RLS plus `tenant_isolation` on all twelve; the grant matrix; thirteen triggers; nine ungranted internal helpers; the SECURITY DEFINER family (27 granted to `presby_app`, 2 owner-only); the arm-B rewrite of `presby_two_factor_required()`; the `treasurer`/`giving_recorder` templates (`…0005`/`…0006`) and their bindings; and the deletion of the `org_portal.giving` row from `feature_flags`.
- `src/lib/db/domain/giving.ts`: Drizzle declarations for the twelve tables plus `givingProvider`. Types only. Every CHECK, index, unique and composite FK is declared under the migration's own constraint name. The header says what Drizzle cannot express and points at 0055's line ranges.
- `scripts/giving/test-rls-46.sql`: the §46 draft (46a–46n), in `test-rls.sql` style with `assert_eq()`. It must run as `presby_app` and runs standalone.
- `scripts/giving/seed-dev-giving.sql`: the fixture block, as its own transaction, including the S3/P3-3 reconciliation (see Implementer Notes).
- `src/lib/testing/giving-fixture.ts`: `armGivingWrite()`/`disarmGivingWrite()` and `createGivingFixture()` (orgs, connections, funds, donors, offline gifts, `linkUser`, `membershipOf`). It sits on top of `createCalendarFixture()`; teardown is the org cascade.
- `src/lib/db/domain/giving.schema.test.ts`: pure, no database. Every constraint and index name 0055 creates is mirrored in `giving.ts` and the other way round. Also pins the 23 composite NO ACTION FKs, no `person_id`, the `(id, organization_id)` keys, the enum, `requires_two_factor`, and the bigint/integer amount types. 20 tests.
- `src/lib/db/domain/giving.db.test.ts`: DB-backed, owner and `presby_app`. Covers the P3-8 teardown premise, the guards on the OWNER path, the owner-path composite-FK refusal, DEFINER org derivation and cross-org rejection, the owner-only grants, the `unavailable`/`onboarding` public states, and "another member's rows are not returned". 17 tests.
- `src/lib/giving/two-factor-agreement.test.ts`: DB-backed. The 2FA agreement matrix runs 17 scenarios over all four resolver arms against the REAL `presby_effective_permissions()`, plus every seed fixture user. 3 tests.

### Files Modified

- `src/lib/db/domain/authz.ts`: `permissions.requiresTwoFactor` (`boolean not null default false`). Without it `check:schema-parity` reports `extra_column`.
- `scripts/seed.ts`: stops seeding the `org_portal.giving` platform flag (R11). The comment records why; the go-live placeholder block now holds three flags. `org-feature-catalog.test.ts` and `tiles.test.ts` still pass. `tiles.test.ts`'s hard-coded `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS` and `tiles.ts`'s `flagKey` are 1b's.

### Schema Changes

**Mode: hand-written** (`drizzle/0055_presby_giving.sql`). `db:generate` is broken repo-wide (TODO), and Drizzle Kit emits none of the RLS, triggers, functions or grants this file is made of.

New, available to 1b and later batches:

- Tables: `giving_settings` (PK `organization_id`), `giving_provider_connections`, `giving_funds`, `giving_donors`, `giving_donor_identities`, `giving_donor_link_decisions`, `giving_checkout_intents`, `giving_provider_events` (no `presby_app` privilege at all), `giving_gifts`, `giving_gift_reversals`, `giving_settlements`, `giving_settlement_lines`. Columns and CHECKs follow the Phase 3 Data Model; the deviations are listed below.
- Column: `permissions.requires_two_factor`. It is true for exactly `giving.view`, `giving.record` and `giving.manage` (module `giving`, tier 2).
- Functions granted to `presby_app`: `presby_giving_{gross_up, ingest_event, claim_event, finish_event, due_events, apply_gift, apply_gift_fee, apply_reversal, apply_subscription, apply_intent_expired, apply_settlement, apply_settlement_lines, apply_connection_status, refresh_my_connection, disconnect_my_connection, record_offline_gift, void_gift, create_intent_public, create_intent_member, attach_session, fail_intent, return_state, attention_events, active_schedule_count, purge_bodies, expire_intents}` and `presby_public_giving_config`. Owner only: `presby_giving_ingest_health()` and `presby_giving_requeue_event(uuid)`. The signatures are exactly the Phase 3 table.
- Template roles `00000000-…-0005` `treasurer` (constitutional, protected: view/record/manage) and `…-0006` `giving_recorder` (custom: record). Organization and type scope are NULL.
- The `feature_flags` row `org_portal.giving` is deleted.

**Apply (local, pipeline branch):**

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0055_presby_giving.sql        # owner, direct endpoint
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/giving/seed-dev-giving.sql    # fixture (after seed-dev.sql)
psql "$APP_DATABASE_URL"     -v ON_ERROR_STOP=1 -f scripts/giving/test-rls-46.sql        # MUST be presby_app
```

**Whole-file idempotence, proven by applying the file and re-applying it.** I took a snapshot of row and object counts before and after each full apply. It covers all 12 tables, `permissions` (and the `requires_two_factor` subset), `app_roles`, `app_role_permissions`, `feature_flags`, `organization_feature_toggles`, the giving functions, triggers, policies, constraints, indexes, and table ACL entries. Apply #1 exited 0 and apply #2 exited 0, with zero ERRORs and byte-identical snapshots (`acl=115 … constraints=262 … fns=50 … indexes=54 … policies=12 … triggers=13 …`). The seed draft is also re-applied twice: exit 0 both times, identical snapshot. That proof caught a bug, fixed in the seed: see Implementer Notes (5).

**`scripts/giving/test-rls-46.sql` as `presby_app`, pipeline branch: 193 passes, exit 0.**

**Existing `scripts/test-rls.sql` as `presby_app`, pipeline branch.** Before any change (baseline), a no-stop run gave 664 passes and 5 pre-existing FAILs, all demo-row deltas on `development`. They are at lines 126 (Alder memberships 10 vs 9), 152 (people 10 vs 9), 183 (presbytery members 3 vs 2), 471 (Alder's `require_two_factor` is off on this branch) and 7863 (`statistics.publish` org-owned holders 2 vs 1). After 0055 and the seed, the stock file gives 657 passes. Three assertions now fail, each because the two new TEMPLATE roles exist (the design's blast-radius note: "§15/§44a count roles"):
- line 824 `alder: sees its own three new roles` (4 vs 3): the template keyed `treasurer` is visible to every tenant through `app_roles_select` (`organization_id is null`).
- line 836 `bramblewood: sees no alder treasurer/…` (1 vs 0): same cause.
- line 7848 `DECISION-152: there are now FOUR template roles` (6 vs 4).

With the integration edits below plus §46, the suite gives **857 passes (664 + 193)**. Its error set is identical to the pre-change baseline (the 5 demo-row deltas only). No regression.

**Integration edits the orchestrator makes (Rule 16; none were made by this batch):**

1. `scripts/seed-dev.sql`: one line AFTER its final `commit;` (currently line 1942). It must be after, because the block is its own transaction (the write marker is transaction-local):
   ```
   \ir giving/seed-dev-giving.sql
   ```
2. `scripts/test-rls.sql`: one line at the end, after section 45's closing banner:
   ```
   \ir giving/test-rls-46.sql
   ```
   Plus three assertion edits that the new templates require:
   - lines 822–824 (section 15, alder) and lines 834–836 (section 15, bramblewood): add `and organization_id is not null` to the `app_roles where key in ('treasurer', 'installed_pastor', 'support_contact')` predicate. The section is about Alder's org-owned roles.
   - lines 7847–7849 (section 41): expected `4` becomes `6`. Message: `'DECISION-152: there are now SIX template roles — committee_chair, presbytery_stated_clerk, personnel_admin, congregation_stated_clerk (0052 added exactly one), and treasurer + giving_recorder (drizzle/0055)'`.
3. `drizzle/meta/_journal.json`: append
   ```json
   { "idx": 55, "version": "7", "when": 1787014253186, "tag": "0055_presby_giving", "breakpoints": true }
   ```
   (`when` = 0054's + 30000, the existing spacing).
4. `src/lib/db/domain/index.ts`: `export * from "./giving";`. Also correct its header ("Ledger, giving, worship, and check-in are deliberately absent"), since giving is now present.
5. After (4): `npm run docs:erd`, which regenerates `docs/schema-design.md` from the schema. It is deferred because before the export it would only pick up `requires_two_factor`.

**From-scratch path (`docs/testing.md`).** I ran it on a scratch database inside the pipeline branch: `create database presby_scratch_giving` as owner. `drizzle-kit migrate` used a scratch copy of `drizzle/` whose `_journal.json` carried the idx-55 entry above; the shared file is untouched. Results:
- migrate: **56/56 applied**; `drizzle.__drizzle_migrations` = 56; 12 giving tables.
- `scripts/install-test-helpers.sql`, then `scripts/seed.ts` (`db:seed`): OK. `org_portal.giving` is absent from `feature_flags` afterwards.
- `seed-dev.sql`, then `seed-dev-giving.sql`: both exit 0.
- stock `test-rls.sql` as `presby_app`: 670 passes, and exactly the three template-count FAILs above.
- integrated (with the edits) plus §46: **exit 0, 871 passes (678 + 193)**.
- the three giving Vitest files against the scratch DB: 40/40.
- the resolver `md5(prosrc)` on the scratch DB is `4c79e30535229f6fd44730c38add28d0`, the same value as on the pipeline branch (a child of `development`), so the F140 pin holds from scratch.
- Dropped with `drop database presby_scratch_giving with (force)`; confirmed gone.

**`check:schema-parity`:** stock, 68 tables, 0 failing. With `giving.ts` merged in through a temporary copy of the checker (deleted afterwards), 80 tables, 0 differences beyond the six existing architectural allowlist rows, 0 failing.

**2FA predicate cost (Phase 3 budget ≤ 5 ms; `explain (analyze, buffers)` as `presby_app`, PG 18.6, pipeline branch).** As first written (`language sql`, the design's text), every call took 11.7–13.1 ms. The cause is that the body **executes in ~0.9–1.0 ms but plans in 10.2–13.7 ms**: a SECURITY DEFINER SQL function is never inlined, so the four-arm union is re-planned on every call. The design itself says "otherwise the arm is restructured before merge". I compared:

| Variant | Per call (same session) | First call on a fresh session |
|---|---|---|
| as designed | 11.7–13.1 ms | ~12–13 ms |
| plpgsql + `plan_cache_mode = force_generic_plan` | 0.55–0.97 ms | ~17 ms |
| **`language sql` + `set join_collapse_limit = 1, from_collapse_limit = 1` (shipped)** | **2.35–3.36 ms** | **7.4–8.3 ms** |

The shipped variant keeps the designed language and SQL text. The planner takes the written join order, and every arm is written to start from `me`. Planning drops to 2.1–4.1 ms and execution stays ~0.8–1.1 ms. Typical two-membership user (clerk.fixture): 3.36, 2.97 ms. Fixture treasurer (Priya linked to a user for the measurement transaction, Alder's org policy off so arm B answers): `t`, 2.35, 2.41 ms.

**Flagged for the orchestrator/tech-lead:** the first call on a brand-new database session costs 7.4–8.3 ms. The old arm-A-only body costs 1.6 ms cold and 0.5 ms warm on the same measure. The excess is relation-cache warm-up for the eight extra relations arm B reads, and no join-order or language choice I measured avoids it. Whether the 5 ms budget covers the cold-connection case (once per pooled connection) is a ruling, not something to decide inside a schema batch. Steady state meets the budget.

**Failing-first proofs.** In each case I broke one mechanism as owner, ran the test as `presby_app` (SQL) or on its own connections (Vitest), recorded the failure, then restored by re-applying 0055 and confirmed green. Line numbers are those of `test-rls-46.sql` as it stood at that run; the file gained blocks between runs, so the assertion label (46a–46n plus its message) is the stable reference. After the last restore, §46 is 193/193 and the three giving Vitest files are 40/40.

| Mechanism broken | Fails (file:line / test) |
|---|---|
| `no force row level security` on `giving_gifts` | `test-rls-46.sql:69` 46a FORCE count 11≠12 |
| `giving_donors` policy replaced with `using (true)` | `:75` 46a policy shape; `:201` unset-GUC invisibility 8≠0; `:207` alder donors 8≠7; `:234` cross-org donor insert accepted; `:303` 46d(1) presbytery reads 8 rows |
| `grant delete on giving_funds to presby_app` | `:143` 46b grant matrix; `:183` the DELETE attempt reached the FK instead of a privilege error |
| `grant select on giving_provider_events` | `:143` 46b; `:345` 46e "presby_app read the inbox" |
| `grant update (status)` on connections | `:172` 46b column list 10≠9; `:190` status update accepted |
| `grant insert on giving_gift_reversals` | `:143` 46b; `:682` 46h insert by arming the marker accepted |
| `giving_donors_link_fk` made single-column | `:105` 46a composite count 22≠23; `:268` cross-org membership link accepted |
| `giving_donors_guard` disabled | `:698` 46h guard count; `:711` "a donor changed kind" |
| `giving_connections_insert_guard` disabled | `:698`; `:773` "created a connection already active" (Fernwood: no open connection, so only the guard can refuse) |
| `giving_reversals_bound` disabled | `:499` 46g over-reinstatement not dead-lettered; `:698` |
| the three DECISION-175 triggers disabled | `:698` 12→10; `:921` commission accepted; `:946` delegation accepted |
| arm B removed (0013 body only) | `:843` treasurer direct arm; `:861` group arm; `:904` agreement loop (elder user) |
| `requires_two_factor` set on `events.view` | `:824` key count 4≠3; `:846`; `:856` |
| `giving_donors_one_unidentified_idx` dropped | `:749` second plate-cash donor accepted |
| `presby_giving_ingest_health()` granted to `presby_app` | `:354` 46e; `:810` 46i EXECUTE list |
| a 6th function with the default (NULL, i.e. PUBLIC) ACL | `:799` 46i PUBLIC grant. The first version of this assertion missed a NULL `proacl`; the proof caught it and I fixed it. |
| a 6th function arming the marker, PUBLIC revoked | `:828` 46i arming count 6≠5 |
| Vitest: arm B removed | `two-factor-agreement.test.ts` › "each scenario…" (1 failed / 2 passed) |
| Vitest: only arm B's delegation arm removed | same test, scenario `delegation arm, current` |
| Vitest: `giving_gifts_write_guard` disabled | `giving.db.test.ts` › insert without marker; amount frozen; status transitions (3 failed) |
| Vitest: `giving_gifts_delete_guard` disabled | `giving.db.test.ts` › "DELETE is refused…" |
| Vitest: delete guard without the parent-absent arm | `giving.db.test.ts` › "one `delete from organizations`…removes every giving row". This proves the P3-8 premise is load-bearing. |

**P3-8 premise: TRUE, empirically.** The giving BEFORE DELETE guards see the parent `organizations` row as already gone when the RI cascade fires. One `delete from organizations` of a deletable fixture org removed its donors (including a merged one), gifts (offline and online), a void reversal, an inbox event, an intent, an identity, the connection and the funds. Without arm B of the guard the same delete fails. **No fallback GUC arm was needed in `presby_guard_organizations_delete()`.**

**Vitest.** All run with `npx dotenv -e .env.local -- vitest run --no-file-parallelism …`:
- `src/lib/db/domain/giving.schema.test.ts`: 20 passed.
- `src/lib/db/domain/giving.db.test.ts`: 17 passed.
- `src/lib/giving/two-factor-agreement.test.ts`: 3 passed. The 17 scenarios are: direct current, expired, future, ending today, non-2FA key; group current, membership ended, grant expired; commission current and expired; delegation current and revoked; membership ended; merged person; two memberships with the key at the second; arm A only; none. Every one equals both its known answer and the real resolver, and so does every seed fixture user.
- 40/40 on the pipeline branch and 40/40 on the from-scratch database.
- `npm run test`: 303 files passed, 40 skipped (the DB-backed ones without env); 4264 tests passed.
- `npm run typecheck` 0, `npm run lint` (`--max-warnings=0`) 0, `npm run check` 0.
- `check:secrets` scans git-tracked files only and every new file here is untracked, so I ran its exported `checkSecretsPii()` over all 11 new and modified files: 0 findings.

### Audit Events

None. Batch 1a writes no audit rows, and the DEFINER functions write none either: their callers audit after commit, per the API contract. All `AUDIT_ACTIONS` keys are 1b's (`src/lib/audit.ts`).

### Implementer Notes

**Deviations from the Phase 3 DDL text.** Each is within the design's intent, is named in 0055's header, and is pinned by §46. None is a design-level change.

1. **(D1) `giving_connections_insert_guard`, a new BEFORE INSERT trigger.** A connection is born `onboarding` with every capability flag false and with no attestation, go-live, disconnect or `last_status_at` fields, unless the write marker is armed (fixtures only). The design grants `presby_app` table-level INSERT on connections and also says "Status/flags move only through DEFINER functions". Without the guard, one INSERT could create an already-`active`, public row. This is the creation-guarded-as-strongly-as-mutation rule (F54–F58).
2. **(D2) `record_offline_gift`/`void_gift` require the claimed actor to hold `giving.record`** at the acting org (`presby_has_permission` inside `presby_giving__actor_may_record`), not just to be an active member. Strictly tighter: the database refuses a member the app forgot to gate. 1b and B2 should gate on `giving.record` anyway.
3. **(D3) Apply functions act only on an inbox row in `processing`.** It must have been claimed through `presby_giving_claim_event()`; otherwise they return `ignored:not_claimed` and write nothing. The row is locked `for update` for the apply.
4. **(D4) A merge target must be an `identified`, unmerged donor.** Merging into plate cash would move identified giving onto a donor that can never get a statement.
5. **(D5) Two extra state CHECKs that follow from the design's rules:** `giving_gifts_failure_code_shape` (a `failure_code` only on a failed gift, `^[a-z0-9_]+$`) and `giving_intents_covered_shape` (no covered fee unless `cover_fees`). I also added two indexes the readers need: `giving_gifts_org_intent_idx` (return-state and first-payment lookups by intent) and `giving_events_org_status_idx` (the tenant attention counts), plus `giving_settlement_lines_gift_idx`.
6. **2FA cost restructure (above):** `set join_collapse_limit = 1, from_collapse_limit = 1` on `presby_two_factor_required`. This is the design's own contingency, but the cold-session residual is flagged.

**Design notes resolved during build:**

- **`RETURNS TABLE` shadowing** (Batch 1 note): handled with `#variable_conflict use_column`, so the OUT columns keep the design's logical names (`raw_body`, `status`, `connection_id`, …).
- **Seed idempotence bug, found by the re-apply proof and fixed.** `giving_reversals_bound` is a BEFORE INSERT trigger, and **BEFORE triggers fire before ON CONFLICT is checked**. A seed reversal written as `insert … on conflict (id) do nothing` was therefore bound-checked as a second refund on re-run and raised. The seed now uses `where not exists`. **B3 must remember the same thing:** any idempotent insert into `giving_gift_reversals` must test existence first. `presby_giving_apply_reversal()` already does.
- **Fixture shape.** Because the design says Alder's connection is `livemode = false`, every online gift on it is test-mode and excluded from totals. Statements (B5) need live online money, so the seed adds an earlier live-mode, disconnected connection (`acct_fixture000000000003`) that carries the live online gifts (G4 with fee and covered fee, and G7 refunded). The active test-mode connection carries the pending ACH, the failed ACH, the test-mode gift and the open intents. Missions is retired with `offered_online = false` (the CHECK forbids online and retired together); its "in-flight gift" is an `open` intent against it.
- **S3/P3-3.** The seed draft deletes the fixture treasurer's `ledger.approve` binding and binds the three giving keys; the `permissions('ledger.approve')` row stays. At integration, the orchestrator may instead edit `seed-dev.sql:470` directly. Either is equivalent; the draft's `delete` is what makes it work standalone and on `development`, where the binding already exists.
- **Nobody given a giving key in the fixture has a linked user** (Priya, Desmond), so arm B changes no fixture sign-in. elder, clerk and presbytery.clerk fixtures are unchanged, and the e2e roster is untouched.
- **Leaked fixtures cleaned.** One failing-first run (the delete guard without its parent-absent arm) blocked its own teardown, as intended. That left 5 `giving-db-test-*` orgs, 4 fixture people and 2 users on the pipeline branch, all `deletable_until`-stamped; I deleted them. `giving.db.test.ts` now uses a per-org `organization_sites.repo`, so a leak cannot collide.

**What 1b must know:**

- `src/lib/testing/giving-fixture.ts` exists and exports `armGivingWrite(tx)` (the design listed it under 1a).
- The `org_portal.giving` flag row is gone from the pipeline branch and `seed.ts` no longer seeds it. Until 1b rewires `tiles.ts`, the placeholder tile simply does not render, because `isFlagEnabled` returns false. 1b drops it from `tiles.test.ts:75`'s `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`.
- `money.ts`'s TS grid must equal `presby_giving_gross_up()`. §46 pins card $50.00 → 5181, bank $100.00 → 10081, and bank $1000.00 → 100500 (the $5 cap).
- `live-predicate.ts` exports the fragment §46n uses literally: `g.livemode`. Its test should read that line.
- Error vocabulary from the tenant writers. `record_offline_gift`: `insufficient_privilege` "giving: not permitted" (identity), or `check_violation` "giving_offline_gift: donor_unavailable | fund_unavailable | method_not_allowed | date_out_of_range | amount_out_of_range | shape_invalid". `void_gift`: "giving_void: gift_unavailable | not_offline | already_voided | reason_required". The date check uses ORG-LOCAL today (New York trails UTC), so tests should use `current_date - 1`.
- `check:giving-boundaries` (S1): `src/lib/giving/two-factor-agreement.test.ts` lives under `src/lib/giving/`. It contains no `getPlatformDb` token, but its fixture reaches the owner connection. The tripwire should exempt `*.test.ts` or account for it.
- The treasurer TEMPLATE's key is `treasurer`, the same as the fixture's org-owned role (F109 reuse). Any test that counts `app_roles` by key without `organization_id is not null` now sees the template too. That is exactly the test-rls §15 edit above.
- For B3: `apply_connection_status`/`refresh_my_connection` return `applied` | `applied:status_changed` | `applied:disconnected` | `noop` | `none` (audit on the latter forms). `finish_event('failed')` parks with backoff and dead-letters at attempt 8. `parked` with `no_gift`/`no_subscription` ages out to `ignored` 24 h after receipt. A renewal failure is `ignored:renewal_failed` plus `last_payment_failed_at`, never a gift row.

**Candidate findings for the orchestrator** (unnumbered; F138–F141 are already claimed by Phase 2 and 3):
- (a) A SECURITY DEFINER `language sql` function is never inlined, so its body is planned on every call. For a many-join predicate on a hot path, planning, not execution, sets the cost (12 ms against 1 ms here).
- (b) BEFORE INSERT guards run before ON CONFLICT, so `on conflict do nothing` is not an idempotence tool on a guarded table.

**Next agent:** full-stack-developer (Batch 1b). The migration is applied to the pipeline branch and the seed draft is loaded there.

### Orchestrator ruling on the Batch 1a flags (2026-10-15)

- **2FA predicate cold-session cost — accepted, budget read as steady-state per call.** The Phase 3 budget (≤ 5 ms) governs the per-call cost on a warm connection, which the shipped variant meets (2.4–3.4 ms). The 7.4–8.3 ms first call on a brand-new pooled connection is relation-cache warm-up for the eight relations arm B reads; it is paid once per connection, by whichever query first touches those relations, and no language or join-order choice the implementer measured removes it. The predicate runs once per sign-in and on the Edge gate's session refresh, never in a per-row loop. Accepted as a residual; recorded here so tech-lead can revisit it at the retrospective or if Phase 5 measures sign-in latency regressing. Candidate findings (a) and (b) are now F142 and F143 (kickoff block).
- **The three `scripts/test-rls.sql` assertion edits** (§15 lines 822–824 and 834–836 add `and organization_id is not null`; §41 line 7847–7849 count 4 → 6) are integration edits under Rule 16 and are queued with the `\ir` lines, the journal entry and the domain index export. Not made mid-pipeline.
- Deviations D1–D5 and the `join_collapse_limit` restructure are within the design's stated intent; no Phase 3 loop-back.

## Batch 1b — foundation (full-stack-developer)

*2026-10-15, full-stack-developer, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. Dev servers were started from the worktree on port 3100 (PIDs 55437/55438, then 58827/58829/58830, all started by this batch) for the e2e and browser checks and stopped by PID when done (once before `next build`); the demo server on port 3000 (PID 15271) was never touched.*

### Files Created

- `src/lib/treasurer-designation.ts` — `designateTreasurer(organizationId, email, operatorUserId)`, `countGivingManageHolders(tx|db, organizationId)`, `treasurerDesignationApplies()`, `TREASURER_DESIGNATION_ORG_TYPES`. One `getPlatformDb()` transaction in R2's order (lock org row → `not_applicable` unless congregation/NWC → zero-holder gate → user lookup → active membership at this org → read both templates → reuse-and-reactivate `treasurer` and `giving_recorder` with additive reconcile → one person-arm grant on `treasurer` only). Creates no person and no membership. Imports no giving table and none of `authz.ts` / `role-definitions.ts` / `role-grants.ts`.
- `src/lib/treasurer-designation.test.ts` — the DECISION-155 import boundary (static assertions that the module imports none of `src/lib/authz.ts`, `role-definitions.ts`, `role-grants.ts` and no giving table, never calls `presby_effective_permissions()` or `withOrgContext()`, and uses `getPlatformDb()` only) and 21 DB-backed cases: every refusal (`not_applicable` for presbytery, synod and GA; `has_holders` by person arm and by live group arm, with the group-end reopening the gate; `no_such_user`; `user_inactive`; `not_a_member` for no person and for a member of another org; `membership_ended` with the real date; `provisioning_incomplete` with the template renamed and restored in `finally`; `db_error` rolled back); reuse-and-reactivate of a deactivated protected `treasurer` role (its own extra key kept); additive reconcile of `giving_recorder`; `giving_recorder` minted ungranted; no person and no membership created; the gate flipping once a holder exists; the concurrency case (two simultaneous designations: exactly one `ok`, the other `has_holders`); set-equality with the catalog's `orgTypes`.
- `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.tsx` (+ `.test.tsx`, 8 cases) — client section: email control while the fresh holder count is 0, a collapsed COUNT line (never a name) once anyone holds `giving.manage`, `AlertDialog` confirm, inline error banner, `<HydrationGate>` around the controls.
- `src/lib/giving/access-pure.ts`, `src/lib/giving/access.ts` (+ `access.test.ts`) — `GIVING_KEYS`, `GIVING_TOGGLE_KEY`, `assertGivingSession()` (Node-side 2FA check, R4), `givingTotpRedirectUrl()` (sanitized `/totp?callbackUrl=`), `loadGivingContext(viewer)` → `not_applicable | toggle_off{canManageFeatures} | forbidden | ok{has:{view,record,manage}}`. `access.ts` re-exports the pure half; see Deviation 4.
- `src/lib/giving/types.ts` — `NormalizedEvent`, `DonorDetails`, `ConnectionStatusInput`, `GiftMethod` (types only, zero imports).
- `src/lib/giving/money.ts` (+ `money.test.ts`, `money.db.test.ts`) — `parseAmountToCents(input, kind)`, `formatCents`, `grossUp(amount, "card"|"bank", rates)`, `DEFAULT_RATES`, `AMOUNT_BOUNDS`, `FeeRates`.
- `src/lib/giving/statement-policy.ts` (+ test), `src/lib/giving/live-predicate.ts` (+ `live-predicate.test.ts`) — `COUNT_DONOR_COVERED_FEE_AS_CONTRIBUTION`, `STATEMENT_WORDING_VERSION`; `LIVE_SUCCEEDED_GIFT` (the literal `"g.livemode and g.status = 'succeeded'"`) and `liveSucceededGift` (`sql.raw`), with a static tripwire test over every non-test file in `src/lib/giving/`.
- `src/lib/giving/eslint-stripe-restriction.test.ts` — runs the real ESLint with the real config over in-memory snippets (6 cases).
- `scripts/check-giving-boundaries.mjs` (+ `.test.mjs`, 54 cases) and the `check:giving-boundaries` npm script, appended to `npm run check`.
- `src/app/(org)/o/[slug]/admin/giving/giving-admin-states.tsx` — `GivingNotApplicable`, `GivingToggleOff`, `GivingForbidden`, `GivingLoadError` (server components, no data).
- `src/components/org-portal/tile-icons.test.tsx` (3 cases).
- `e2e/giving-shell.spec.ts` (7 cases) — not on the Batch 1 list; added because the shell's gate (2FA redirect, four honest states) is invisible to unit tests.

### Files Modified

- `src/lib/audit.ts` + `src/lib/audit.test.ts` — all 31 giving keys of every batch appended under one comment block (string values exactly as the Phase 3 table; the table's `_UPDATED / _RETIRED` shorthand rows are expanded to one key each). Snapshot test updated; three new cases (31 giving keys; every string unique across the catalog; `org.*` vs `tenant.giving_*` shape).
- `src/lib/org-features.ts` — `orgTypes` on every catalog entry (`null` for the three existing); the toggle-only `org_portal.giving` entry (`flag: null`, `provisionedOn: false`, `orgTypes: ["congregation","new_worshiping_community"]`); exports `orgTypeAdmitted()` and `OrgFeatureOrgTypes`; applicability enforced in `listFeatureToggles` (omits the entry), `toggleOrgFeature` (`invalid_key`, after the permission check) and `orgFeatureEnabledInTx` (false). One extra read of `organizations.organization_type`, made only when an entry has an allow-list.
- `src/lib/org-features.test.ts` (+7 DB-backed cases, a presbytery and an NWC fixture org), `src/lib/org-feature-catalog.test.ts` (toggle-only set is now calendar + giving; `orgTypes` shape; tile-scope set-equality with the catalog; `orgTypeAdmitted` allow-list; a source grep that no non-test `src/**` file calls `isFlagEnabled("org_portal.giving")` or sets a tile `flagKey` to it).
- `src/lib/org-portal/tiles.ts` — the placeholder is replaced by `giving` (operate, `/o/<slug>/giving`) and `giving-admin` (administer, `/o/<slug>/admin/giving`), both `orgFeatureKey: "org_portal.giving"`, no `flagKey`, no `comingSoon`, `orgTypeScope` = the catalog's list. `tiles.test.ts` (21 tiles, `org_portal.giving` dropped from `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`, EXPECTED rows, giving-tile pins), `visible-tiles.test.ts` (giving cases rewritten for the toggle; read-count cases updated), `src/components/org-portal/tile-icons.tsx` (`giving-admin` → `Landmark`).
- `src/app/(admin)/admin/organizations/[id]/actions.ts` (+`designateTreasurerAction`, +`actions.test.ts` 18 cases), `page.tsx` (+`page.test.tsx` 7 cases): the section renders only for an applicable type and reads the holder count fresh; a presbytery pays for no read.
- `src/app/(org)/o/[slug]/admin/giving/page.tsx` — the inert placeholder is replaced by the toggle-aware shell; `page.test.tsx` rewritten (17 cases).
- `eslint.config.mjs` — three layers of `no-restricted-imports` for `stripe` / `stripe/*`.
- `package.json` — `check:giving-boundaries`, appended to `check`.
- `e2e/admin-organizations.spec.ts` — +5 tests (Test 7 block) per line 2293.

### Schema Changes

None. 1b is application code only; 0055 is untouched.

### Audit Events

All 31 keys declared in `src/lib/audit.ts`. Written in this batch: `ORG_TREASURER_DESIGNATED` (`org.treasurer.designated`) from `designateTreasurerAction`, after the transaction commits and only on `ok`; `resourceType: "organization"`, `resourceId` = the organization id, metadata `{ organizationId, personId, roleId, permissionKeys }` (ids and key names only: no email, no name). A refused designation writes no row. `npm run check:audit`: zero violations.

### Endpoints / action signatures and gates

- `designateTreasurerAction(formData: FormData): Promise<PolicyResult>` — `auth()` → `FEATURES.ADMIN_ORGANIZATIONS` → uuid + zod email → `designateTreasurer` → audit on `ok` → `revalidatePath`. Platform axis, `getPlatformDb()` only. No org toggle and no platform flag involved.
- `GET /o/[slug]/admin/giving` (page): sign-in → four-way org miss → `assertOrgAccess` → `assertGivingSession` (redirect `/totp?callbackUrl=…`) → `loadGivingContext` (applicability, org toggle, then the three keys). No `FEATURES.*`, no platform flag. No `loading.tsx`.
- No new env var. No new `FEATURES` entry. No new platform flag.

### Implementer Notes

**Deviations from the Phase 3 design (each with its reason).**

1. **`grossUp` / `DEFAULT_RATES` live in `src/lib/giving/money.ts`, not `providers/stripe/fees.ts`.** The batch brief put the digit-for-digit equality with `presby_giving_gross_up()` on `money.ts`, and the math is provider-neutral (it is the donor-facing preview of a database formula). Batch 3 may add `providers/stripe/fees.ts` as a re-export if it wants the Phase 3 path.

2. **`parseAmountToCents` shape rule.** Phase 3 said `^\d{1,5}(\.\d{1,2})?$` for both kinds, but the offline ceiling ($1,000,000.00 = 7 integer digits, the DB's own `100000000`) is unreachable under a 5-digit cap. The shape is `^\d+(\.\d{1,2})?$` and the bounds are checked on the cents value; an out-of-range but well-formed amount is `too_small` / `too_large` (so `250001` is `too_large`, not `format`: a donor deserves "that is more than we can take"). Everything else Phase 3 lists (`1e3`, `-5`, `１２`, `10.999`, `0`) rejects with `format` / `too_small` exactly as designed; integer parts over 12 digits short-circuit to `too_large` before any arithmetic.

3. **The zero-holder gate counts EFFECTIVE holders**, not every grant row: the grant is inside its date window, the person is unmerged and holds an active membership at this org, and a group-arm holder's group membership is inside its window (resolver arms 1 and 2). `foundingAdministratorHolderCount` omits the membership and group-start conditions; copying it verbatim would let a stranded grant block the control and lockout recovery forever. (`presby_guard_membership_end()` refuses to end a membership under an open grant, so that state is unreachable today; the condition is defence in depth and is documented in the test.)

4. **`access-pure.ts` split.** `access.ts` imports `@/lib/authz` → `@/lib/db`, which throws at import without `DATABASE_URL`, so the pure half (keys, 2FA check, redirect builder) could not be unit-tested in the CI lane. The pure half is its own module and `access.ts` re-exports it; callers still import from `@/lib/giving/access`.

5. **Two giving tiles are live behind the toggle now, but the member tile's destination `/o/<slug>/giving` is Batch 6.** Phase 3 specifies both tiles; the member page does not exist yet, so with the toggle ON the member "Giving" tile 404s until B6. The toggle is OFF everywhere and the Features page lists a "Giving" card only for congregations/NWCs, so nothing is visible by default; but an `org_features.manage` holder who flips it on in dev sees that 404. RULED: keep the tile (see "What Batch 2 must know").

6. **Tripwire scope is wider than S1's three clauses.** S1: no runtime `stripe` import outside the provider folder (B1, narrowed per the brief to `client.ts` only), no `getPlatformDb` under `src/lib/giving/` (B3, widened to the webhook, cron, any `api/**` path containing "giving", any `(org)` route directory named `giving`, and `(public)/site/[slug]/give/`; tests exempt), no `giving.statement` email with amounts (B5, a file-level rule: a file naming a `giving.statement` template may not also touch `formatCents` / `amountCents` / `amount_cents` / `totalCents` / `giving_gifts` / `giving_statement_lines`; `// giving-amounts-ok: <reason>` is the only exemption). Added: B2 (type-only `stripe` imports legal only under `providers/stripe/`), B4 (the retired `org_portal.giving` platform flag: `isFlagEnabled`, tile `flagKey`, and `scripts/seed.ts`), B6 (`presby_giving_ingest_health` / `presby_giving_requeue_event` named only in `src/lib/admin/giving-ingest-health.ts`, P3-6). B1/B2 are belt-and-braces with the ESLint rule.

7. **No hash pin on the four resolver-side files (coordinator ruling, applied after the first draft).** The first draft pinned the sha256 of `src/lib/authz.ts`, `role-definitions.ts`, `role-grants.ts` and `drizzle/0010_presby_resolver.sql`. Dropped on the F131 precedent: a pin that breaks on every legitimate edit gets updated blindly and protects nothing. Kept: the static assertion that `treasurer-designation.ts` imports none of the three TypeScript files (and no giving table, no `presby_effective_permissions`, no `withOrgContext`), plus the behavioural §44/§46 SQL assertions. No TODO line.

8. **Designation section is not a `useForm` root.** It copies the founding-administrator section's structure (controlled input + `AlertDialog`), so `check:hydration-gate` does not require the gate; it is wrapped in `<HydrationGate>` anyway, per the brief. The designation audit metadata is exactly Phase 3's four fields (no `userId`).

9. **ESLint**: core `no-restricted-imports` has no type-import allowance, so the provider folder uses `@typescript-eslint/no-restricted-imports` with `allowTypeImports: true` (layer 2) and `client.ts` plus provider-folder tests are unrestricted (layer 3). Pinned by a test that runs the real ESLint over snippets.

**Commands run and results** (all in `/Users/cshenso/git/presby-platform/presby-giving`):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run check` (all seven tripwires incl. the new `check:giving-boundaries`) | all pass; `check:audit` zero violations |
| `npm run test` (CI lane, no DB env) | 312 files passed, 41 skipped; 4470 tests passed, 1248 skipped |
| `npm run test:db` (`dotenv -e .env.local -- vitest run --no-file-parallelism`, whole suite, pipeline branch) | first run 351 files passed, 1 failed (5713 / 5714 tests): `org-feature-categories.test.ts` "presbytery: also offers every domain". Cause: both giving tiles are scoped to congregation/NWC, so `offeredCategories("presbytery")` correctly no longer includes `giving`. Test updated (presbytery excludes `giving`; NWC offers it); that file re-run: 17 / 17 |
| DB-backed files this batch authored or extended, run on their own | `treasurer-designation.test.ts` 28 (7 always-run cases + 21 DB), `org-features.test.ts` 29 (22 + 7 new), `src/lib/giving/` 6 files 142 passed / 20 skipped without env, `money.db.test.ts` 2 (3,618 grid comparisons: 9 amounts x 2 methods x default + 200 fuzzed + 2 boundary rate sets) |
| `npm run build` | passes (dev server stopped first) |
| `npx playwright test e2e/admin-organizations.spec.ts e2e/giving-shell.spec.ts` against `npm run dev` on port 3100 from this worktree (`E2E_BASE_URL=http://localhost:3100`) | 21 passed (14 + 7) |
| `npx playwright test` (the whole suite, same server) | **207 passed (4.7 m)**, including `portal-home-cards`, `member-home`, `role-boundaries`, `totp-full-login`, `post-login-routing`, `totp-callback-bypass`. After the run: no giving toggle row, no `treasurer` / `giving_recorder` / `e2e_giving_view` role left at the e2e orgs |
| `check:secrets` over every new and modified path (untracked files are invisible to the git-based script, so I ran its exported `checkSecretsPii()` over 48 paths) | 0 findings |
| Browser, phone viewport | Playwright at 360 x 740, device scale 2, screenshots read back: the Treasurer control and the toggle-off shell render correctly. Both e2e specs also assert 360 px fit (the section inside the viewport, a 44 px trigger, no horizontal scroll). I did not open a real phone |


**Failing-first proofs** (mutate, run, record the failing assertion, restore, re-run green):

| Mechanism broken | Fails |
|---|---|
| `org_portal.giving` `orgTypes` set to `null` | `org-features.test.ts`: "listFeatureToggles OMITS the giving entry for a presbytery", "toggleOrgFeature returns invalid_key for a presbytery…", "orgFeatureEnabledInTx is FALSE for a presbytery even with a stray enabled row" (3 failed / 4 passed in the block) |
| designation: applicability check removed and the gate threshold raised to 99 | `treasurer-designation.test.ts`: 7 failed (not_applicable ×3, has_holders person-arm and group-arm, "flips the gate", the concurrency case) |
| `grossUp`'s ceiling division changed to floor | `money.test.ts` card $50.00 → 5181 and bank $100.00 → 10081; `money.db.test.ts` grid (3 failed) |
| `assertGivingSession` 2FA branch disabled in the page | `e2e/giving-shell.spec.ts` "holding a giving key while the session says 2FA is not verified…": expected `/totp|account/2fa`, received `/o/e2e-alpha/admin/giving` |
| each tripwire rule | one violating fixture tree per rule in `check-giving-boundaries.test.mjs` (B1 ×9 import shapes, B2, B3 ×7 paths + 2 env names, B4 ×5, B5 ×6, B6 ×2) |

**What Batch 2 must know.**

- Gate every `admin/giving/**` page and action with `assertGivingSession(session)` (pages: `redirect(givingTotpRedirectUrl(path))`; actions: return `{ kind: "two_factor_required" }`; route handlers: a 307 to the same URL), then `loadGivingContext({ personId, organizationId, organizationType })` from `resolveOrgContext()`'s `ok` branch, then check the one key the surface needs on `context.has` (`has.manage`, `has.view`, `has.record`; no key implies another). `toggle_off` already carries `canManageFeatures`. `loadGivingContext` throws on a database failure and on a membership that ended mid-request (`OrgAccessError`); render `GivingLoadError` for the first and rethrow the second (see `page.tsx`). Reuse `giving-admin-states.tsx`; do not add `loading.tsx`.
- Money: `parseAmountToCents(input, "offline" | "online")`, `formatCents`, `grossUp`. A user-typed amount stays a string until `money.ts` parses it once.
- Every aggregate over `giving_gifts` must apply `liveSucceededGift` / `LIVE_SUCCEEDED_GIFT` through alias `g` (the static test in `live-predicate.test.ts` fails a file that does not).
- `check:giving-boundaries` will fail B3 on any `getPlatformDb` / `PLATFORM_DATABASE_URL` / `MIGRATE_DATABASE_URL` under `src/lib/giving/**` or any `(org)` `giving/` route: B2's gifts/donors/team code must use `db` via `withOrgContext()`. A statement-notice email builder must live in a file with no money token in it (B5).
- The e2e giving fixture rule: holding ANY giving key makes that user's sign-in require 2FA. `giving-shell.spec.ts` shows the shape (a temporary role + grant to `org-single`, removed in a `finally`); B2's `e2e/support/giving-fixture.ts` should grant only to the `mfa-enrolled` user (with a membership at `e2e-alpha`) and to throwaway users, as Phase 3 says.
- The member `giving` tile's target does not exist until Batch 6; QA must not run before Batch 6 lands. (Coordinator ruling: the tile stays in `PORTAL_TILES`; the pipeline ships as one PR and B6 lands before Phase 5.)
- The Features page now lists a "Giving" card for congregations and NWCs (the catalog entry), off by default. The `offWarning` registry/dialog is B2's.
- `ORG_TREASURER_DESIGNATED` is the only giving audit key written so far. The treasurer designation mints the org-owned `treasurer` role as `constitutional` + protected (copied from the template) and `giving_recorder` as `custom`.

**Observations, not fixed (out of scope).** `TILE_ICONS` has no entry for the pre-existing `staff`, `credentials` and `filings` tiles (they fall back to `LayoutGrid`); `tile-icons.test.tsx` asserts only the two giving keys and says so.

**Open questions for the orchestrator.** None. Both were ruled: keep the member `giving` tile (Deviation 5); drop the hash pin (Deviation 7).

### Handoff

**What to test in the browser (phone viewport, 360 px).** (1) `/admin/organizations/<a congregation id>` as a platform admin: a "Treasurer" section with the email control when nobody holds `giving.manage`; the confirm dialog names the account and the organization; a non-member email is refused in plain words and creates nothing; after a successful designation the control is gone and the section says "one person" with no name. (2) The same page for a presbytery: no Treasurer section. (3) `/o/<slug>/admin/giving` as a member: the toggle-off page (HTTP 200, no 404), Forbidden with the toggle on and no key, not-available for a presbytery; a user holding a giving key who has not completed 2FA is sent to `/totp`. **Next agent: qa (Phase 5), after Batch 2 per the pipeline order (B1 ships on its own, invisible with the toggle OFF).**

## Batch 2 — funds, recording, donors, settings, team (full-stack-developer)

*2026-10-15, full-stack-developer, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. One dev server was started from the worktree on port 3100 (PIDs 65165 / 65182, both started by this batch) for the e2e and browser checks and stopped by PID before `next build`; the demo server on port 3000 (PID 15271) was never touched. `next dev`'s `.next` and the prod lane's build do not overlap: the prod lane ran with nothing on 3100.*

### Files Created

**Library (`src/lib/giving/`, all `server-only` unless marked pure)**
- `funds.ts` (+ `funds.db.test.ts`), `gifts.ts` (+ `gifts.db.test.ts`), `donors.ts` and `link-proposals.ts` (+ `donors.db.test.ts`), `settings.ts` (+ `settings.db.test.ts`), `team.ts` (+ `team.db.test.ts`), `attention.ts` (+ `attention.db.test.ts`).
- `keys.ts` — `holdsPermissions()` / `givingKeysInTx()`: the one authorization read every data function makes first. Split out of `access.ts` (see Deviation 5).
- `action-gate.ts` (+ `action-gate.test.ts`) — `gateGivingAction(slug, anyOf)`: auth → Node-side 2FA → `resolveOrgContext` → applicability/toggle → key; `GivingActionResult`, `invalidInput()`.
- Pure (no `server-only`; unit-tested): `csv.ts`, `duplicate-gift.ts`, `gift-input.ts`, `gift-form-mapping.ts`, `donor-input.ts`, `fund-input.ts`, `settings-input.ts`, `field-errors.ts`, `attention-pure.ts`, `db-util.ts` (server-only plumbing). Tests: `csv.test.ts`, `duplicate-gift.test.ts`, `gift-input.test.ts`, `donor-fund-settings-input.test.ts`.
- `src/lib/org-feature-warnings.ts` (+ `org-feature-warnings.db.test.ts`) — the page-side OFF-warning registry (`loadOffWarnings`, entry for `org_portal.giving`).

**Routes under `src/app/(org)/o/[slug]/admin/giving/`**
- Shared: `giving-page-gate.tsx` (+ test) — `gateGivingPage()`, the one gate all eleven pages call; `attention-list.tsx` (+ test); `connection-placeholder-card.tsx`.
- `funds/`: `page.tsx`, `fund-form.tsx`, `fund-row-actions.tsx`, `create-general-fund-button.tsx`, `actions.ts` (+ a test for each).
- `gifts/`: `page.tsx`, `gifts-list.tsx`, `gift-filters.tsx` (a plain GET form), `recent-entries.tsx`, `void-dialog.tsx`, `actions.ts`; `new/page.tsx`, `new/offline-gift-form.tsx`, `new/donor-picker.tsx`; `[giftId]/page.tsx`; `export/route.ts` (+ tests for all of them, including the route's).
- `donors/`: `page.tsx`, `donors-list.tsx`, `donor-form.tsx`, `link-panel.tsx`, `merge-dialog.tsx`, `actions.ts`; `[donorId]/page.tsx` (+ tests).
- `settings/`: `page.tsx`, `settings-form.tsx`, `actions.ts` (+ tests). `team/`: `page.tsx`, `grant-form.tsx`, `team-list.tsx`, `setup-role-button.tsx`, `actions.ts` (+ tests).
- `src/components/giving/form-field.tsx` — `FormField`, `fieldA11y`, `NativeSelect`, `CheckboxField` (label + hint + error wiring; the docs/ui-standards native-select pattern).

**e2e**
- `e2e/giving-admin.spec.ts` (12 tests), `e2e/hydration/giving-offline-gift-form.spec.ts` (1 test, both lanes), `e2e/support/giving-fixture.ts`.

### Files Modified
- `src/app/(org)/o/[slug]/admin/giving/page.tsx` — the 1b shell becomes the overview (attention list, "Online giving" placeholder, one tile per area the viewer's keys open); it calls `gateGivingPage()` instead of carrying the gate inline. `page.test.tsx` rewritten (21 cases: the gate order and states are still pinned THROUGH the page, plus what each key sees).
- `giving-admin-states.tsx` — `GivingSectionForbidden`, `GivingBackLink`, and an optional `href` on `GivingLoadError` (its retry link returns to THAT page).
- `src/lib/giving/access.ts` — `holds()` moved to `keys.ts`; `access.ts` imports it and re-exports `givingKeysInTx`. Behaviour unchanged (`access.test.ts` green).
- `src/lib/testing/giving-fixture.ts` — `makeActor()`, `makeOnlineGift()`, `makeReversal()`, and `makeOfflineGift()` gained `recordedBy` / `createdDaysAgo` (a gift's `created_at` and `recorded_by` are frozen after insert, so back-dating is only possible at insert).
- `admin/features/page.tsx`, `features-list.tsx` (+ both tests): the page-side `offWarning` — `loadOffWarnings()` for the toggles that are ON; an `AlertDialog` before an OFF switch.

### Schema Changes
None. `drizzle/0055` is untouched; every write goes through the two DEFINER functions (`presby_giving_record_offline_gift`, `presby_giving_void_gift`) or an ordinary tenant-RLS insert/update on `giving_funds`, `giving_donors`, `giving_donor_link_decisions`, `giving_settings`, `role_grants`, `app_roles`, `app_role_permissions`.

### Endpoints / action signatures and gates

Gate for every page, action and the route: sign-in → four-way org miss → Node-side 2FA (R4) → org-type applicability → org toggle → key. Pages: `gateGivingPage({slug, path, anyOf, section})`. Actions: `gateGivingAction(slug, anyOf)`. No `FEATURES.*`, no platform flag, no `getPlatformDb()`. Every data function re-checks its own key inside its own `withOrgContext()` transaction (the page gate is a courtesy, not the authority).

| Surface | Keys | Notes |
|---|---|---|
| `/admin/giving` | any of view / record / manage | `loadAttention()` is narrowed to one number for a recorder |
| `/funds`, `createFundAction`, `updateFundAction`, `retireFundAction(slug,{fundId,confirm?})`, `reactivateFundAction`, `createGeneralFundAction` | manage | retire-last-online-fund returns `{ok:true,data:{confirmRequired}}` |
| `/gifts` | view (ledger) or record (own entries only) | recorder branch never calls `listGifts` |
| `/gifts/new`, `recordOfflineGiftAction`, `voidGiftAction` | record (void: record AND (manage OR own entry ≤ 30 d)) | soft warnings are `ok:true` with `data.status` |
| `searchDonorsAction(slug, q)` | record OR view | name match only; `{id, displayName, kind, hasEmail}` |
| `/gifts/[giftId]`, `GET /gifts/export?from&to&fund&status&source&donor` | view | CSV audited inside the handler; 307/403/404/413/503 shapes pinned by `route.test.ts` |
| `/donors`, `/donors/[donorId]` | view (full) / record (reduced, S4) | |
| `createDonorAction`, `confirmLinkAction`, `dismissLinkAction`, `removeLinkAction` | record | |
| `updateDonorContactAction`, `mergeDonorsAction` | manage | |
| `/settings`, `updateGivingSettingsAction` | manage | |
| `/team`, `grantGivingRoleAction`, `revokeGivingRoleAction`, `ensureGivingRoleAction` | manage | person-arm only; giving-only roles only |

`GivingActionResult<T> = {ok:true,data?} | {ok:false, error, kind?:"two_factor_required", redirectTo?, fieldErrors?}`. The 2FA refusal carries `redirectTo` (`/totp?callbackUrl=…`) and every form sends the user there rather than leaving them with a toast.

### Audit Events

Written after the transaction commits, only on success, ids/flags/field names only (a test per action pins "no name, email, address, memo, reason, amount-with-identity beyond `amountCents`"):

| Action | Key | Metadata |
|---|---|---|
| create / update / retire / reactivate fund | `GIVING_FUND_CREATED/UPDATED/RETIRED/REACTIVATED` | org, fundId, (class, offeredOnline) / (field names) |
| record gift | `GIVING_GIFT_RECORDED` (+ `GIVING_DONOR_CREATED` if it made a donor) | org, giftId, donorId, fundId, method, amountCents |
| void gift | `GIVING_GIFT_VOIDED` | org, giftId, reversalId, amountCents (not the reason) |
| create / edit / merge donor | `GIVING_DONOR_CREATED/CONTACT_CHANGED/MERGED` | ids; field NAMES; repointedCount, inheritedLink |
| link | `GIVING_DONOR_LINK_CONFIRMED/DISMISSED/REMOVED` | donorId, membershipId (not the member's name) |
| settings | `GIVING_SETTINGS_CHANGED` | field names |
| CSV export | `GIVING_GIFTS_EXPORTED` | row count + filters, **hand-audited in `export/route.ts`** |
| team | `TENANT_ROLE_GRANTED` / `TENANT_ROLE_REVOKED` / `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE` | `path: "giving_team"` |

A no-op edit (nothing changed) writes no row. `npm run check:audit`: zero violations. All 31 keys were already declared; none added.

### Implementer Notes

**Commands and results** (all in `/Users/cshenso/git/presby-platform/presby-giving`):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 (caught and fixed: JSX in `try/catch`, `watch()` → `useWatch`, `toLocaleString` in a test) |
| `npm run check` (all seven tripwires) | all pass; `check:audit` zero violations; `check:giving-boundaries` clean |
| `check:secrets` over all 154 new and modified paths (untracked files are invisible to the git-based script, so via the exported `checkSecretsPii()`) | 0 findings |
| `npm run test` (CI lane, no DB env) | 347 files passed / 48 skipped; 4814 passed / 1356 skipped (was 312 / 4470 after 1b) |
| `npm run test:db` (`dotenv -e .env.local -- vitest run --no-file-parallelism`, the whole suite on the pipeline branch) | **395 files, 6170 tests, all passed** (was 351 / 5714 after 1b) |
| `npm run build` | passes (dev server stopped first) |
| `npx playwright test` (whole suite) against `next dev -p 3100` from this worktree (`E2E_BASE_URL=http://localhost:3100`) | **220 passed (6.3 min)** = the 207 from 1b + `giving-admin` 12 + hydration 1; includes `portal-home-cards`, `member-home`, `role-boundaries`, `totp-*`, `post-login-routing`, `admin-organizations`, `giving-shell` |
| `npm run test:e2e:prod` (hydration specs against `next build && next start` on 3800) | 5 passed, including the new giving spec |

Fixture hygiene afterwards (owner connection): no `e2e-giving-*` org, no `deletable_until` org or person, no `*-db-test-*` user, no `e2e_giving*` grant, no giving toggle at an e2e org; `org_portal.features` restored (`true`, as captured). One early DB run failed mid-teardown (a test left a person merged into another, which blocked `delete from people`) and leaked 16 fixture people and 12 users on the pipeline branch; I deleted them and fixed the test.

**Failing-first proofs** (mutate one mechanism, run, record the failing assertion, restore from a backup copy, re-run green):

| Mechanism broken | Fails |
|---|---|
| `listGifts` also admits `giving.record` (S4) | `gifts.db.test.ts` "the ledger is giving.view ONLY…" |
| `loadAttention` stops narrowing a recorder | `attention.db.test.ts` "S4: a recorder sees ONE number…" |
| proposal drops `not pi.is_shared` | `donors.db.test.ts` "never proposes from a SHARED email" |
| proposal drops `directory_hidden` | "never proposes a directory-hidden member…" and the count/panel parity test |
| `voidGift` drops the own-entry rule | "a recorder may NOT void someone else's entry" and the 30-day test |
| CSV formula prefix loses `=` | `csv.test.ts` "prefixes '=SUM(A1:A9)'…" |
| `confirmLink` stops requiring a current proposal | "confirm: only a CURRENT proposal can be confirmed…" |
| `grantGivingRole` drops `assertPermissionSubset` | "the subset check runs unchanged…" |
| `revokeGivingRole` drops the last-manager guard | "refuses to end the LAST effective giving.manage grant…" |
| `exportGifts` drops `g.livemode` | "exportGifts: live-mode gifts only…" |
| `OfflineGiftForm` loses its `<HydrationGate>` | `e2e/hydration/giving-offline-gift-form.spec.ts` (`aria-busy` never `true`) |

**Deviations from the Phase 3 design, each with its reason.**

1. **The e2e giving fixture uses a throwaway congregation (`e2e-giving-<stamp>`), not `e2e-alpha`.** The brief said "given a membership at e2e-alpha". Gifts and reversals are delete-guarded (P3-8): a row is deletable only with its own future `deletable_until` or after its organization is gone, and a gift recorded through the app never carries one. On the permanent `e2e-alpha` the specs could not clean up after themselves. The fixture org is stamped `deletable_until` at insert and removed with one `delete from organizations`; its id is unique per run because `audit_events` is append-only and a reused id would make every audit count include earlier runs. The `mfa-enrolled` user gets a person and membership there; no other roster user is touched.
2. **"The member `giving` page is not forced to TOTP" is not asserted here.** That page is Batch 6. The R4 half (an MFA-enrolled giving-key holder who has not verified TOTP is redirected to `/totp?callbackUrl=<that page>` on every admin route, and the CSV 307s) is covered for all nine admin routes. **B6 must add the member-page half.**
3. **No `giving-copy.ts` in this batch**, so the Phase 3 test item "copy constants" has no subject; its place is taken by `attention-list.test.tsx` (every attention sentence, singular and plural) and the action tests' message mappings. `giving-copy.ts` is B3/B4's.
4. **A void needs `giving.record` even for a `giving.manage` holder.** Phase 3 says manage may void any offline gift; the DEFINER function requires its claimed actor to hold `giving.record` (1a deviation D2). `voidGift` therefore requires record AND (manage OR own entry ≤ 30 days) and the UI shows the control only then; a manage-only holder is refused with a plain message. **Open question 1.**
5. **`keys.ts` split out of `access.ts`, `attention-pure.ts` out of `attention.ts`.** The data modules need the permission read but not the toggle machinery (`org-features.ts` → audit → `@/auth`, which a unit test cannot load); `attention-list.tsx` and its test need the shapes without a database import. Same reason as 1b's `access-pure.ts`.
6. **The gift ledger is a list of cards, not a `<Table>`.** One DOM at every width, phone first, no duplicated desktop/mobile markup; each row is a link with donor and amount, then date · fund · method, then state badges (words, never colour).
7. **The gift list shows test-mode gifts with a "Test" badge; the CSV and every attention count exclude them.** An operator exercising Stripe in test mode can see their rehearsal; nothing financial counts it (P3-17).
8. **`removeLink` is allowed to `giving.record` (not only manage) and also records the pair as dismissed.** A recorder who confirmed a link by mistake must be able to undo it, and an unlink that the next page load re-proposes is not an unlink.
9. **Soft warnings (possible duplicate gift, possible duplicate donor) are `ok:true` with `data.status`**, not failures: nothing was written, and the form re-submits with `acknowledgeDuplicate`. A new donor whose name or email matches an existing one is also warned (G24), server-side, in `recordOfflineGift` and `createDonor`.
10. **`searchDonors` matches on the name only**, so the result can never confirm that an email exists in the book.
11. **"Today" in the org's zone is computed in SQL in `gifts.ts` (`orgLocalToday`)**, a re-statement of the ungranted `presby_giving__local_date()` rule (`organization_settings.time_zone`, `America/New_York` fallback). It feeds only the form's default date; the database remains the authority on "future". Drift risk noted; a granted `presby_giving_local_today()` would remove it.
12. **No fee-rate section on the settings page**; rates live on the connection (B3).
13. **Team grant form has no default selection** (a placeholder "Choose a role" / "Choose a person"). The first alphabetical role can be the treasurer's, and a one-tap accidental treasurer grant is the wrong default for a privilege path. Caught by reading the 360 px screenshot.
14. **The "possible duplicates" definition** (same email, or same name ignoring case) is a single SQL fragment shared by the donors page, the donor page and `loadAttention` (`DUPLICATE_PAIRS`), the same way proposals are (`proposalRows`).
15. **`HydrationGate` carries `m-0`**, which cancels a parent's `space-y-*` gap above and below it. The new-gift page wraps the form in a plain `<div>`. (Found in the 360 px screenshot: the Save button ran into the next heading.) Worth a line in `docs/ui-standards.md` at integration; I did not edit it.

**Things I verified and did not change.** A merge never touches a gift (no UPDATE grant): merged donors point at the survivor through `merged_into_id` and every read goes through the root; the merge takes a per-org advisory lock and flattens before it merges. TOTP has no replay protection, so the e2e's several logins in one 30-second step are fine.

**Browser, phone viewport.** Playwright at 360 × 740 over the overview, gifts list, new-gift form, donor page and team page; every page asserts no horizontal scroll and no visible control shorter than 40 px; the screenshots (`test-results/giving-360/*.png`) were read back. Findings fixed: the spacing bug (15) and the team-form default (13). The Next dev indicator overlaps content in dev only. I did not open a real phone.

**What Batch 3 must know.**
- Replace `connection-placeholder-card.tsx` in the overview; the "Online giving" section is already gated on `has.manage`. `loadAttention().connection` already carries `{state, testMode, requirementsDue, publicPageOn}`, and the overview's attention list already words `restricted` and `requirementsDue`. A **Test-mode badge on every admin page** while the open connection has `livemode = false` is B3's (the gift list's per-row "Test" badge exists).
- New pages call `gateGivingPage()`; new actions call `gateGivingAction()` and return `GivingActionResult`; use `invalidInput(zodError)` for field errors. Every data function starts with `givingKeysInTx()` (from `keys.ts`, not `access.ts`).
- `listFunds().publicPageLive` and the retire-last-online-fund confirm already read `giving_provider_connections.public_enabled_at`; B3's go-live/take-offline must keep that column the single source.
- `loadOffWarnings()` already counts monthly gifts via `presby_giving_active_schedule_count()`; the B3 disconnect dialog should use the same function. The `org_portal.giving` registry entry is the only one.
- `e2e/support/giving-fixture.ts`: `setupGivingFixture`, `setGivingToggle`, `setGivingRole(sql, fx, "treasurer"|"recorder"|"viewer"|"manager"|"none", {features})`, `addActiveMonthlyGift` (inserts ONE onboarding connection at the fixture org; `giving_connections_one_open_idx` means a B3 e2e that connects must not also call it), `addForeignEntry`, `verifiedContext(browser)` (completes a real TOTP once). Unit-side: `createGivingFixture` gained `makeActor`, `makeOnlineGift`, `makeReversal`.
- Statements (B5): `attention.ts` returns `staleStatements: 0` today; B5 replaces that with the derived count. The overview already links the row to `/statements`.
- `check:giving-boundaries` is clean; nothing under `src/lib/giving/`, `(org)` giving routes or these actions touches `getPlatformDb()`.

**Open questions for the orchestrator.**
1. **D2 vs "manage may void any offline gift".** A `giving.manage`-only holder cannot void (the DEFINER function wants `giving.record`). The seeded treasurer holds all three so nobody is blocked today. Either accept (the page says so) or loosen `presby_giving__actor_may_record` for void in a follow-up migration (a schema change, not mine).
2. **"Hidden members can still be linked manually" (G24)** has no UI: Phase 3's contract has no manual-pick link, and a recorder has no directory read to pick a member from. A hidden member is simply never suggested. Tracked follow-up unless the analyst wants it in v1.
3. **Org-local "today"** (Deviation 11): add a granted `presby_giving_local_today()`? Low priority.

### Handoff

**What to test in the browser (phone viewport, 360 px), with `org_portal.giving` ON for a congregation and a user holding the roles named:** (1) `/o/<slug>/admin/giving` as a treasurer: Needs attention, the "Stripe isn't set up yet" card, six tiles; as a recorder: only Record a gift, Your recent entries and Donors, and at most one attention line. (2) Record a cash, a check and a stock gift (search-then-pick donor, a new donor, a plate offering); a repeated gift warns inline; a future date is an inline error. (3) Gifts: filters, "Show older gifts", Download CSV (open it: no email column), open a gift, void with a reason. (4) Donors: search; a donor with a matching member email shows "Looks like <name>", and Confirm opens a dialog naming her. Merge two donors. (5) Funds, Statement details (blockers named), Giving team (set up the recorder role, give it, end it; ending the last manager is refused). (6) Features: turn Giving on; with an active monthly gift, turning it off asks first. (7) Toggle OFF: every route says "Giving isn't turned on" at HTTP 200. **Next agent: api-developer (Batch 3a), then ux-developer (3b).** B3's Operator Q1 (a test-mode Stripe platform account) gates 3a's verification.

---
### Orchestrator ruling on the Batch 2 open questions (2026-10-15)

1. **Void by a manage-only holder — the stricter rule stands for v1.** `presby_giving__actor_may_record` requires `giving.record` for both record and void (1a deviation D2). The `treasurer` template holds all three keys, so every designated treasurer can void; only a custom giving-only role with `manage` and no `record` would be refused, and the team page can add `record` to it. Loosening it is a one-line in-place correction to 0055 (unreleased) if Phase 5 or 6 finds a real need; not opened now. Tech-lead may revisit at the retrospective.
2. **G24 manual link for hidden members — tracked follow-up, not v1.** A hidden member is never proposed and there is no manual-link UI; the recorder has no directory read to pick from. Goes to `docs/TODO.md` at integration as a Phase 6 note candidate ("giving: manual donor→member link for directory-hidden people").
3. **`presby_giving_local_today()` — follow-up, low priority.** The org-local-today SQL restated in `gifts.ts` is pinned by its test; a granted helper is a Batch 5/6 or post-ship tidy. TODO line at integration.

## Batch 3a — provider core, Stripe adapter, webhook, cron, connection actions (api-developer)

*2026-10-16, api-developer, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. No schema change. No live Stripe call: every Stripe interaction is the SDK's own signing helper, fixture bodies, or a fake SDK. One dev server was started from the worktree on port 3100 (PIDs 72211 wrapper / 72228 listener, both started by this batch) for the replay harness and the full e2e run, and stopped by PID before `next build`; the demo server on port 3000 (PID 15271) was never touched.*

### Files Created

**Dependency.** `stripe@23.0.0` (exact, DECISION-169) in `package.json`/`package-lock.json` — the only dependency change. (npm also bumped the lockfile's own `version` 0.29.0 to 0.33.0; reverted to keep the diff to the dependency.)

**Provider adapter — `src/lib/giving/providers/stripe/`**
- `client.ts` — the allowlist, the only runtime importer of `stripe`. Exports exactly `STRIPE_API_VERSION, isStripeConfigured, platformMode, verifyWebhook, createConnectedAccount, createOnboardingLink, retrieveConnectedAccount, createCheckoutSession, retrieveBalanceTransaction, listBalanceTransactionsForPayout, retrieveEvent, retrieveInvoiceForPayment`.
- `constants.ts` (API version, the sixteen handled event types), `errors.ts` (`ProviderError` with fixed-text messages, `WebhookSignatureError`), `urls.ts` (pure origin assertions, shared server/client), `status.ts`, `normalize.ts`, `fees.ts` (re-export of `money.ts`), `onboarding.ts` and `checkout.ts` (pure request builders; type-only `stripe` imports).
- Tests: `client.test.ts` (real SDK: export set, forbidden-method grep, SDK-version pin, `verifyWebhook`), `client.sdk.test.ts` (fake SDK: call shapes, secret never leaks), `normalize.test.ts` (56), `status.test.ts`, `urls.test.ts`, `onboarding.test.ts`, `checkout.test.ts`, `constants.test.ts`.
- `testing/sign-event.ts` + `testing/sign-event.test.ts`, and `testing/fixtures/*.json` (20 bodies: one per handled event type plus variants).

**Ingest — `src/lib/giving/ingest/`**
- `functions.ts` (the SECURITY DEFINER wrappers on `db`; the webhook/cron path's only door), `outcome.ts` (pure aggregation + audit planning), `process.ts` (`processInboxEvent`).
- Tests: `outcome.test.ts`, `process.test.ts` (mocked), `apply.db.test.ts` (53), `lifecycle.db.test.ts` (32), `process.db.test.ts` (18, real DB + mocked Stripe client/audit).

**Routes and actions**
- `src/app/api/webhooks/stripe/route.ts` (+ `route.test.ts`), `src/app/api/cron/giving/route.ts` (+ `route.test.ts`).
- `src/app/(org)/o/[slug]/admin/giving/connect/actions.ts` (+ test), `connect/refresh/route.ts` (+ test).
- `src/lib/giving/connection.ts`, `connection-input.ts`, `connection.db.test.ts` (36).
- `src/lib/giving/origin.ts` (+ test).
- `src/lib/admin/giving-ingest-health.ts` (+ `.db.test.ts`) — the only `getPlatformDb()` user in giving.
- `src/lib/testing/giving-ingest-fixture.ts` — DB-test harness (claimed inbox rows, intents).
- `e2e/giving-webhook.spec.ts` — the signed-event replay harness (11 cases).

### Files Modified
- `src/lib/giving/types.ts` — the `gift` event's `donor` is `DonorDetails | null` (an `invoice_payment.paid` has none; the Phase 3 text said so, 1b's type did not).
- `src/lib/giving/action-gate.ts` (+ test) — `GivingActionIdentity.email`; `GivingActionFailure.kind` widened to `GivingFailureKind` (adds `stripe_unconfigured | already_connected | provider_error | no_connection | not_ready`) and an optional `missing`.
- `scripts/check-giving-boundaries.mjs` (+ test, 79 cases) — new rules B7, B8, B9 (below).
- `vercel.json` (cron `/api/cron/giving`, `*/5 * * * *`), `.env.example` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, empty), `playwright.config.ts` (the dev server it starts gets `STRIPE_WEBHOOK_SECRET`/`CRON_SECRET` defaults), `docs/deployment.md`, `docs/testing.md`.

### Schema Changes
None. Every database interaction is an existing `presby_giving_*` function or the column-limited grants 0055 already gives `presby_app` (go-live, attestation, rates, connection insert).

### Audit Events
No key added; all already in `AUDIT_ACTIONS`. `npm run check:audit`: zero violations. `check:audit` scans `actions.ts` only, so the paths it cannot see are hand-audited here:

| Path | Audit |
|---|---|
| `connect/actions.ts` (`check:audit` scope) | `startConnectAction` → `GIVING_CONNECTION_CREATED` (also when the link then fails); `setPublicPageAction` → `GIVING_PUBLIC_PAGE_TOGGLED {enabled}` on change; `disconnectAction` → `GIVING_CONNECTION_DISCONNECTED {reason:"treasurer", activeSchedules}`; `updateRatesAction` → `GIVING_CONNECTION_RATES_CHANGED {fields}` (names only). After the transaction, only on success, ids/flags only (a test greps the calls for account ids, emails and names). |
| `connection.ts` `refreshConnection` | Writes `GIVING_CONNECTION_STATUS_CHANGED` itself on `applied:status_changed` (the connect-return PAGE calls it directly and has no action). User actor via the session. |
| `ingest/process.ts` | Hand-audited, system actor (`actor: null`), AFTER `finish_event`, from `planAudits()`: `GIVING_REVERSAL_RECORDED {reversalKind, amountCents}`, `GIVING_CONNECTION_STATUS_CHANGED`, `GIVING_CONNECTION_DISCONNECTED {reason:"deauthorized"}`, `GIVING_DONOR_AUTOLINKED`/`_LINK_CONFLICT`, `GIVING_EVENT_DEAD_LETTERED {lastError}`. A duplicate delivery (`noop`) and a lost lease (`finish_event` → `not_processing`) audit nothing. |
| `webhook/stripe/route.ts` | None, deliberately: receipt is informational; the processor audits what it applies. Logs event id + type only. |
| `cron/giving/route.ts` | None: processing audits itself; purge and expiry are data hygiene. |
| `connect/refresh/route.ts` | None: mints a link, changes nothing in presby. |
| `attestPayoutsAction` | **No audit row**: `AUDIT_ACTIONS` has no key for it and this batch adds none. The row records who/when (`payouts_attested_by/at`), and the go-live toggle (which refuses without it) is audited. Open question 3. |

### Endpoints and gates

| Surface | Auth + gate | Request / response |
|---|---|---|
| `POST /api/webhooks/stripe` | none; the Stripe signature is the credential (`/api/*` bypasses the Edge). `db` only. | `Stripe-Signature` + raw body. 503 `{error:"Webhook not configured."}` (secret unset) · 400 `{error:"Missing webhook headers."}` / `{error:"Invalid webhook signature."}` · 200 `{received:true,handled:false}` (no top-level `account`, or type not handled) · 500 `{error:"Internal server error."}` · **one byte-identical 200 `{"received":true}`** for accepted / duplicate / ignored. Processing in `after()`. |
| `GET /api/cron/giving` | `Authorization: Bearer $CRON_SECRET`; 503 unset, 401 wrong. `db` only. | `{ok:true, processed, purged, expired}`; 500 `{error:"Internal server error."}`. 25 s budget, 25 events. |
| `GET /o/[slug]/admin/giving/connect/refresh` | signed in → Node-side 2FA → four-way org miss → toggle → `giving.manage` | 307 to the minted `accounts.stripe.com`/`connect.stripe.com` URL; otherwise 307 to `/o/<slug>/admin/giving?connect=<code>`, code in `no_access | unavailable | no_connection | unconfigured | refresh_failed`; signed out → `/signin?callbackUrl=…`; unverified 2FA → `/totp?callbackUrl=…`. |
| connect actions (below) | `gateGivingAction(slug, ["manage"])`: auth → Node 2FA → org resolve → applicability/toggle → `giving.manage` | `GivingActionResult<T>` |
| `listIngestHealth()` / `requeueDeadLetter(id)` | none in the module; the caller (3b, platform axis) gates `FEATURES.ADMIN_ORGANIZATIONS` | below |

No new `FEATURES` entry, no platform flag, no seed change.

### Implementer Notes

**Commands and results** (all in `/Users/cshenso/git/presby-platform/presby-giving`):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run check` (all seven tripwires, incl. `check:audit` zero violations and the extended `check:giving-boundaries`) | all pass |
| `check:secrets` over every untracked and modified path (224 files, via the exported `checkSecretsPii()`; the script itself only sees tracked files) | 0 findings after annotating 10 soft findings (hostile-URL test inputs that look like `user@host`, and the non-key-shaped `giving-e2e-*` literals) with `leak-ok` reasons; the tracked-file run also needed one on `docs/testing.md`. No `sk_`/`rk_`/`whsec_` key material in any file: key-shaped values in tests are assembled at runtime. |
| `npm run test` (CI lane, no DB env) | 363 files passed, 53 skipped; 5211 tests passed, 1500 skipped |
| `npm run test:db` (the whole suite, pipeline branch) | **416 files, 6711 tests, all passed** (was 395 / 6170 after Batch 2) |
| `npm run build` | passes (dev server stopped first); `/api/webhooks/stripe`, `/api/cron/giving`, `/o/[slug]/admin/giving/connect/refresh` registered as dynamic routes |
| `e2e/giving-webhook.spec.ts` against `next dev -p 3100` started with `STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret CRON_SECRET=giving-e2e-cron-secret` (and `STRIPE_SECRET_KEY` unset) | **11 passed** | <!-- leak-ok: non-key-shaped test literals, not credentials -->
| `npx playwright test` (whole suite, same server) | 228 passed, 1 failed, 2 not run: `statistics-submit.spec.ts` test 5 failed with `apiRequestContext.get: read ECONNRESET` (a dev-server socket reset, unrelated to giving) and its two serial followers did not run. Re-run of that file alone: **7 passed**. So 235 of 235 pass across the two runs. |

Fixture hygiene afterwards (owner connection): no `e2e-giving-*` or ingest/connection test org, no fixture user, no `e2e_giving*` role; the only `acct_fixture…` connections left are the three from Batch 1a's seed draft. Audit rows from the e2e deauthorize case remain by design (append-only; ids unique per run).

**Failing-first proofs** (mutate one mechanism, run, record the failing assertion, restore from a backup, re-run green):

| Mechanism broken | Fails |
|---|---|
| signature check replaced by `JSON.parse` in `verifyWebhook` | `client.test.ts` (wrong secret, altered body, stale timestamp, garbage header: 8+), `route.test.ts` (400 cases), and **`e2e/giving-webhook.spec.ts` "a bad signature is a 400"** against the live server (received 200) |
| route answers a duplicate differently | `route.test.ts` "ONE byte-identical 200" |
| unset secret answers 200 | `route.test.ts` 503 cases (2) |
| route passes `livemode: true` regardless | `route.test.ts` "passes the verified facts and the EXACT raw bytes" |
| normalizer carries a metadata fund id | `normalize.test.ts` "ignores fund / membership / intent metadata entirely" |
| origin assertion accepts any `*.stripe.com` | `urls.test.ts` (8) and `client.sdk.test.ts` bad-origin cases |
| origin assertion stops checking userinfo/port | `urls.test.ts` "rejects an explicit default port" |
| a parked part aggregated as failed | `outcome.test.ts`, `process.test.ts` (refund-before-gift parks with `no_gift`; reinstatement grace) |
| a dead part dropped from the verdict (over-reversal) | `outcome.test.ts`, `process.test.ts` over-reversal, non-USD/bad-response cases |
| deauthorization not planned for audit | `outcome.test.ts`, `process.test.ts` |
| audit written before `finish_event` | `process.test.ts` (6, incl. "audits AFTER finishing" and lost-lease) |
| fee taken from a constant instead of the balance transaction | `process.test.ts` "passes ITS numbers, never the body's" |
| NUL bytes not stripped before the database | `apply.db.test.ts` "hostile donor text" (found for real first: the test's `\u0000` made `presby_giving_apply_gift` throw `22021`; fixed in `functions.ts`) |
| `startConnect` without the open-connection pre-check | `connection.db.test.ts` "a second start … calls Stripe no further" |
| go-live without the readiness check | `connection.db.test.ts` (2) |
| re-connect reuses the idempotency key | `connection.db.test.ts` "a RE-connect … fresh idempotency key" |
| `setPublicPage` without the `giving.manage` check | `connection.db.test.ts` "every function refuses a holder of no manage key" |
| tripwire B7 / B8 / B9 each disabled | `check-giving-boundaries.test.mjs` (7 / 5 / 1 failures) |
| (real, not a mutation) `card.wallet` read as a string | `normalize.test.ts` "a wallet card is reported as a wallet" failed on first run; `wallet` is an object. Fixed. |

The SQL-owned mechanisms the Batch 3 list names (replay no-op, unknown-account and `livemode` silence, refund-before-gift parking, over-reversal bound, fee set-once) were proven failing-first in Batch 1a against the SQL; here they are exercised end to end by `apply.db`, `lifecycle.db`, `process.db` and the e2e spec, and the TypeScript halves (verdict aggregation, audit planning, what the route passes) have the mutations above.

**Deviations from the Phase 3 design, each with its reason.**

1. **Onboarding link has no `configurations: ["merchant"]`.** Phase 3 "Confirmed" it from a docs page; stripe-node 23.0.0's CHANGELOG records "Remove support for `configurations` on `V2.Core.AccountLinkCreateParams.use_case.account_onboarding`" in the very release that pins `2026-09-30.endive`, and the generated typings have no such field. The typings are generated from the pinned version, so they win. If the operator smoke is answered `configs_must_match_to_use_account_links`, it is a one-line add in `onboarding.ts` (documented there and in `docs/deployment.md`).
2. **Checkout uses `allowed_payment_method_types`, not `payment_method_types`** (removed from `Checkout.SessionCreateParams` in the pinned version, same CHANGELOG). It is a filter over the methods the connected account makes eligible, which is the behaviour wanted.
3. **Checkout `expires_at` is now + 31 minutes (`checkoutExpiresAt()`), not 30.** Stripe measures the 30-minute minimum from when it receives the request, so "now + 30" computed earlier is refused on latency alone.
4. **Connect idempotency key is `giving-connect:<org>:<n>`**, `n` = connection rows the organization has ever had. `giving-connect:<org>` alone would, for 24 hours after a disconnect, make Stripe hand back the disconnected account and the re-connect insert would collide with it. Concurrent clicks still share a key.
5. **`api_version` mismatch (and any normalizer refusal) finishes the event `dead`, not `failed:api_version`.** The mismatch is deterministic, so eight back-off retries cannot help; `dead` is the same visible dead letter, immediately. Codes: `normalize_<api_version|malformed_json|bad_shape|missing_account|account_mismatch|livemode_mismatch|bad_amount>`.
6. **`fees.ts` is a re-export of `money.ts`** (1b's deviation 1 stands).
7. **A `warning_*` dispute is not recorded** (no funds move) and **a reinstatement whose target reversal was never recorded is given up on (`ignored:no_reversal`) once the event's attempt count reaches 4**, about 20 minutes. Without it, a refund that went pending→failed without ever succeeding would walk to the dead-letter queue. A `warning_*` that escalates to a real withdrawal is an event the endpoint is not subscribed to (open question 4).
8. **NUL stripping** (`ingest/functions.ts`): Postgres text cannot hold NUL and a JSON string from Stripe can decode to one; every provider string is stripped on its way into an apply function.
9. **Audit rows from the processor carry `connectionId`/`inboxId`/`eventType` but no `organizationId`**, and use the connection as `resourceId`: `presby_giving_claim_event()` does not return the organization (open question 1). `ingest/functions.ts` already reads `organization_id`/`external_event_id` if a corrected claim returns them, and `process.ts` then includes the former and re-fetches purged bodies with the latter.
10. **New tripwire rules are B7–B9, not a new `email_queue` rule**: that rule already exists as B5 (1b), as do the stripe-import-location (B1/B2) and `getPlatformDb` (B3) rules. Added: **B7** no `stripe.com` in `default-src`/`script-src`/`script-src-elem`/`frame-src`/`child-src`/`form-action` of `next.config.ts` (the file is now scanned); **B8** no session machinery (`@/auth`, `auth()`, `cachedAuth`, `resolveOrgContext`, `withOrgContext`) in the webhook route, the giving cron or `ingest/`; **B9** `retrieveInvoiceForPayment` only from `ingest/process.ts` (F141) and the account-lifecycle trio only from `connection.ts`. A violating fixture per rule, plus the legal neighbours.
11. **`sign-event.ts` signs with `node:crypto`, not the SDK's `generateTestHeaderString`**, so Playwright and tripwire-restricted trees can import it without a runtime `stripe` import (B1). `sign-event.test.ts` proves the header is byte-identical to the SDK's and accepted by `Stripe.webhooks.constructEvent`.
12. **The connect-return PAGE is 3b's.** The library function it calls (`refreshConnection`) is mine, and audits its own status change.

**What is blocked on the operator (Operator Q1: no test-mode Stripe platform account exists).** Everything below is *unverified*, not failing; the runbook is `docs/deployment.md` → "Online giving (Stripe)":
1. The create-account body is accepted as sent (Accounts v2, `dashboard: full`, both capabilities, descriptor).
2. The onboarding link is accepted without `configurations` (deviation 1) and the URL host is `accounts.stripe.com`.
3. Checkout accepts `allowed_payment_method_types` and a 31-minute `expires_at` (deviations 2, 3); the Checkout URL host is `checkout.stripe.com`.
4. A restricted key with exactly the seven-row table can make every call, including the v2 endpoints (if not: unrestricted key + a finding).
5. `account.updated` reaches the Connect endpoint for a v2 account (else "Refresh status" is the only path).
6. The real `GET /v2/core/accounts/{id}` shape: `mapV2AccountToStatus` is fixture-tested against the SDK's typings, not a recorded response; capture and sanitize one into `fixtures/` (closes the "payouts-enabled path / requirements shape" question).
7. A real card gift, ACH gift (delayed success and failure), monthly gift, refund, dispute and payout drive `normalize` correctly — in particular `charge.dispute.created`'s `payment_method_details.type` for an ACH return, `invoice_payment.paid`'s shape and `retrieveInvoiceForPayment` for a renewal, and the balance-transaction fee read.
8. The billing-portal probe (Stripe confirmation 3).
9. What Stripe sends when a dispute inquiry escalates (open question 4).

Not blocked: signature verification, the replay harness, every apply function, the processor, the cron, the connection library and the actions — all verified here with signed fixtures and fakes.

### Contract for 3b

**Imports.** Types/pure helpers are importable from client code with `import type` / the pure module: `isOnboardingUrl`, `isCheckoutUrl` from `@/lib/giving/providers/stripe/urls` (re-assert before `window.location.assign`; the server already asserted). Server-only: everything in `@/lib/giving/connection`.

**Actions** (`src/app/(org)/o/[slug]/admin/giving/connect/actions.ts`, all `"use server"`, all take `slug` first, all `GivingActionResult<T> = {ok:true; data?: T} | GivingActionFailure`, `GivingActionFailure = {ok:false; error: string; kind?: GivingFailureKind; redirectTo?: string; fieldErrors?: Record<string,string>; missing?: string[]}`):

| Action | `data` on `ok` | Failure `kind`s (besides the shared gate's refusals, which have no `kind` except `two_factor_required` + `redirectTo`) |
|---|---|---|
| `startConnectAction(slug)` | `{kind:"redirect"; url}` | `stripe_unconfigured`, `already_connected` (use Continue), `provider_error` (message differs when the account WAS created: "…choose Continue") |
| `continueConnectAction(slug)` | `{kind:"redirect"; url}` | `stripe_unconfigured`, `no_connection`, `provider_error` |
| `refreshConnectionAction(slug)` | `{outcome:"applied"\|"applied:status_changed"\|"noop"; status: ConnectionStatusInput}` | `stripe_unconfigured`, `no_connection`, `provider_error` |
| `attestPayoutsAction(slug)` | `{changed:boolean}` | `no_connection` |
| `setPublicPageAction(slug, enabled:boolean)` | `{enabled:boolean; changed:boolean}` | `not_ready` + `missing: ("connection_active"\|"online_fund"\|"payouts_attested")[]`, `no_connection` |
| `disconnectAction(slug)` | `{activeSchedules:number}` (monthly gifts that keep charging in Stripe) | `no_connection` |
| `updateRatesAction(slug, input:{cardFeeBps:0..1000; cardFeeFixedCents:0..100; achFeeBps:0..500; achFeeCapCents:0..2000})` | none | `fieldErrors` keyed by those four names |

A redirect result: navigate with `window.location.assign(url)` after `isOnboardingUrl(url)`. The disconnect dialog is the UI's job: read `panel.activeSchedules` first (the action does not demand a confirm flag).

**Status projection the panel renders — `loadConnectionPanel(personId, organizationId)`** (call from the page after `gateGivingPage({ anyOf: ["manage"] })`; returns `{kind:"forbidden"} | {kind:"ok"; panel}`; throws on DB failure like the other loaders):

```ts
panel: {
  state: "unconfigured" | "none" | "onboarding" | "restricted" | "active" | "disconnected"; // the six states
  stripeConfigured: boolean;       // false => "Online giving isn't enabled on this installation"
  platformMode: "live" | "test";   // only meaningful when stripeConfigured
  connection: null | {
    id; status: "onboarding"|"active"|"restricted"|"disconnected";
    livemode: boolean;             // false => "Test mode" badge on EVERY admin giving page while the open connection is test mode
    chargesEnabled; payoutsEnabled; detailsSubmitted; cardEnabled; achEnabled; requirementsDue: boolean;
    disabledReason: string | null; // short machine code
    payoutsAttestedAt; publicEnabledAt; disconnectedAt; lastStatusAt; createdAt: string | null (ISO UTC);
    disconnectedReason: "treasurer" | "deauthorized" | null;
    rates: { cardFeeBps; cardFeeFixedCents; achFeeBps; achFeeCapCents };
  };                                // the open connection, else the most recent disconnected one, else null
  onlineFundCount: number;
  activeSchedules: number;
  readiness: { missing: ("connection_active"|"online_fund"|"payouts_attested")[]; canGoPublic: boolean };
}
```
Mapping: `none` → "Connect Stripe" (`startConnectAction`); `onboarding` → "Continue setup" + "Refresh status"; `restricted` → requirements/disabled copy + Continue + Refresh; `active` → go-live checklist (`readiness.missing`) + attest + public toggle + rates; `disconnected` → shows `disconnectedReason` and "Connect again" (`startConnectAction`; history stays on the old row); `unconfigured` → the installation notice, no buttons.

**Pages 3b owns.** `connect/return` (page): after `gateGivingPage`, call `refreshConnection({ personId: gate.org.personId, organizationId: gate.org.organizationId, userId: gate.userId })` (`email` optional) then `loadConnectionPanel`; render by `state`. The URL proves nothing; the retrieve does. Result kinds: `ok | forbidden | stripe_unconfigured | no_connection | provider_error`. The `connect/refresh` handler's `?connect=<code>` notices land on `/admin/giving`; render the five codes as messages. Replace `connection-placeholder-card.tsx`. `loadAttention().connection` already carries `{state, testMode, requirementsDue, publicPageOn}`.

**Platform health reader — `src/lib/admin/giving-ingest-health.ts`** (server-only; gate the caller on `FEATURES.ADMIN_ORGANIZATIONS`; add `ORG_GIVING_EVENT_REQUEUED` audit in `(admin)/admin/giving/actions.ts`):

```ts
listIngestHealth(): Promise<IngestHealthRow[]>
IngestHealthRow = { organizationId: string; connectionId: string; provider: string; livemode: boolean;
  status: string /* onboarding|active|restricted|disconnected */;
  receivedCount: number; appliedCount: number; parkedCount: number; deadLetterCount: number;
  lastReceivedAt: string | null /* ISO UTC */; oldestPendingSeconds: number | null }
requeueDeadLetter(inboxId: string): Promise<"requeued" | "not_dead_letter" | "not_found">
```
Counts and timestamps only; organization names come from the `organizations` join in the page. **Caveat: the requeue control cannot be built yet** — the health function returns no event ids, so a platform page has nothing to pass to `requeueDeadLetter` (open question 2). Build the health table (counts, ages, a "dead letters" cell) now; add requeue when the schema gap is closed.

### Open questions for the orchestrator

1. **0055 correction (database-admin, in place):** `presby_giving_claim_event()` should also return `external_event_id` and `organization_id`. Today a *purged* body cannot be re-fetched through `retrieveEvent` (the processor does not know the event id, so a requeued purged event finishes `dead:body_purged`) and the processor's audit rows cannot carry `organizationId`. `process.ts`/`functions.ts` are already written to light up when the columns appear.
2. **0055 correction (database-admin):** nothing lets the platform enumerate dead-letter event ids: `presby_giving_ingest_health()` returns none by design and `presby_giving_requeue_event(uuid)` needs one. Options: an owner-only `presby_giving_dead_letters()` (inbox id, connection id, event type, last_error, attempts, received_at; still no body/amounts), or make requeue take a connection id. Blocks the requeue control in 3b, not the health table.
3. **No audit key for the Q8 payouts attestation** (`AUDIT_ACTIONS` is frozen for this batch). The row records who/when; decide whether `GIVING_CONNECTION_*` needs a key.
4. **Dispute escalation:** only `charge.dispute.created` is subscribed. A `warning_*` inquiry is ignored (correct: no funds move); if Stripe later withdraws funds, that arrives as `charge.dispute.funds_withdrawn`/`.updated`, which the endpoint is not subscribed to, so that reversal would be missed. Either add `charge.dispute.funds_withdrawn` to the list (Phase 3 amendment; `HANDLED_EVENT_TYPES` and the runbook move together) or confirm in the smoke that inquiries arrive as `created` with a funds-moving status.
5. **Phase 3 research corrections to record as a finding/process note:** the two SDK-vs-docs divergences (deviations 1 and 2) are the second instance of "a docs page read in Phase 3 disagrees with the generated typings of the pinned SDK"; Phase 3 should check the changelog of the version it pins.

### Handoff

Next agent: **ux-developer (Batch 3b)** — connect panel, `connect/return` page, platform health pages (`(admin)/admin/giving`, `ingest-health-section.tsx`) from the contract above. Operator Q1 gates the live smoke, not 3b's UI work. Open questions 1 and 2 are schema asks for database-admin before 3b's requeue control; they do not block the rest.


---
### Orchestrator ruling on the Batch 3a open questions (2026-10-16)

Batches 1, 2 and 3a are committed on `pipeline/online-giving` as `591f6a1`, `e880147`, `05e3636` (operator authorized commit-per-batch on 2026-10-16). Files touched by more than one batch sit in the commit of the batch that created them.

1. **`presby_giving_claim_event()` return shape — in-place correction to 0055 (unreleased, `drizzle/` rule).** It also returns `external_event_id` and `organization_id`, so a purged body can be re-fetched through `retrieveEvent` and the processor's audit rows carry `organizationId`. `database-admin`, with the §46 draft and `giving.db.test.ts` pinned, then `api-developer` wires the two columns (the code path already exists).
2. **Dead-letter enumeration — same correction.** `presby_giving_ingest_health()` gains a bounded dead-letter list (event id, connection id, organization id, event type, received_at, attempts, last error class — no body), or an owner-only sibling `presby_giving_dead_letters(limit)` if the health function's shape is better left as counts. Either way owner-only, no `presby_app` grant, pinned by §46i. 3b builds the requeue control against it.
3. **Payouts attestation audit — add `GIVING_PAYOUTS_ATTESTED` to `AUDIT_ACTIONS`** (existing values frozen) and write it from `attestPayoutsAction`. `api-developer` addendum.
4. **Dispute escalation — subscribe to `charge.dispute.funds_withdrawn` and `charge.dispute.funds_reinstated` in addition to `created`/`closed`.** The reversal is keyed on the dispute id: whichever of `created` (non-warning status) or `funds_withdrawn` arrives first records it, the other is `noop` (the existing `apply_reversal` existence check, F143). `funds_reinstated` and `closed: won` both map to the reinstatement reversal, same idempotence. An inquiry (`warning_*`) still records nothing. `api-developer` addendum: `normalize`, the handled-event set, the deployment doc's endpoint event list, fixtures and the replay harness. 
5. **Process note for the retrospective:** twice in this pipeline a docs page read at Phase 3 disagreed with the pinned SDK's typings (`configurations` on account links, `payment_method_types` on Checkout). Phase 3 reads the changelog of the version it pins before marking an API fact "confirmed". Tech-lead records it at the next retrospective; `.claude/agents/tech-lead.md` gets the line then.

Order: database-admin (1, 2) → api-developer addendum (1–4 wiring) → ux-developer 3b. Each writes its own subsection below.

## Batch 3a-fix — 0055 in-place correction (database-admin)

*2026-10-16, database-admin, worktree `presby-giving` on `pipeline/online-giving` (HEAD `05e3636`), Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. No server started or stopped. Scope: items 1 and 2 of the orchestrator's 3a ruling, nothing else.*

### Files Modified

- `drizzle/0055_presby_giving.sql`, corrected in place (unreleased; same file, same number, no 0056):
  - Header: a new **CORRECTION (2026-10-16)** block after D1–D5. It names C1 and C2 and cites the Batch 3a open questions 1–2 and the ruling.
  - Section 17c, C1. A guarded `do` block comes first. It drops `presby_giving_claim_event(uuid)` only while `pg_get_function_result()` differs from the corrected shape, because `create or replace` cannot change a return type. Then the corrected function. The join to connections is now composite (`c.id = cl.connection_id and c.organization_id = cl.organization_id`); the result is unchanged and the FK already guaranteed it.
  - Section 17aa, C2: the new `presby_giving_dead_letters(integer)`. The 17aa comment now says only this function returns event ids.
  - Section 17bb: "two owner-only" becomes "three". The NOT-granted note names `dead_letters`. New `comment on function` for `claim_event` and `dead_letters`. The revoke loop already covers every `presby_giving_%`, so the new function is revoked from `public, presby_app, presby_platform` with no new statement.
- `scripts/giving/test-rls-46.sql`: the §46e header now names the three owner-only functions. The owner-only privilege assertions cover three, not two. New C2 block: permission denied for `presby_app`, the result shape pinned exactly, no body/amount/donor column, and the body never reads `raw_body`. New C1 block: the result shape pinned, plus a live claim as `presby_app` returning the event id and Alder. §46i gains its own transaction with the arming set **by name** and the owner-only callable set **by name**.
- `src/lib/db/domain/giving.db.test.ts`: the owner-only test now covers `dead_letters` (refused with and without an org context; the ACL of all three names the owner alone). Two new tests: `claim_event returns external_event_id and organization_id…` and `dead_letters lists a dead-lettered event…never a body, and feeds requeue`.
- `src/lib/db/domain/giving.ts`: comments only. The approximate 0055 line references moved with the header (13 ~804, grants ~835/~839, 14 ~888, 15 ~1197, 17 ~1565, 18 ~2656). The inbox doc comment names the reader functions and C1/C2. No table, column, constraint or index changed, so there is nothing for `giving.schema.test.ts` to mirror.

### Schema Changes

**Mode: hand-written, in-place correction** of `drizzle/0055_presby_giving.sql`. It is unreleased, applied only to the pipeline branch. `_journal.json` is unchanged: the integration entry `{ "idx": 55, … "tag": "0055_presby_giving" }` from Batch 1a still stands.

**Choice for item 2: the sibling `presby_giving_dead_letters()`, not a widened health function.** `listIngestHealth()` (`src/lib/admin/giving-ingest-health.ts:63`) reads `select * from presby_giving_ingest_health()` into a fixed one-row-per-connection counts type. `giving.db.test.ts` filters that function `where connection_id = …`. A per-event list is a different cardinality, and folding it in as an array column would change a shape both callers rely on. Separately, the health function's documented promise ("no event ids") stays true.

**Exact signatures, for the api-developer:**

```sql
presby_giving_claim_event(p_inbox_id uuid)
  returns table (raw_body text, event_type text, attempts integer, body_purged boolean,
                 connection_id uuid, external_account_id text, livemode boolean,
                 external_event_id text,      -- NEW (C1): the provider's evt_… id
                 organization_id uuid)        -- NEW (C1): from the inbox row, never a parameter
  -- plpgsql, SECURITY DEFINER, search_path = public, pg_temp, #variable_conflict use_column
  -- EXECUTE: presby_app (unchanged). Zero rows when not claimable (unchanged).

presby_giving_dead_letters(p_limit integer default 100)
  returns table (event_id uuid,               -- the inbox id: what presby_giving_requeue_event(uuid) takes
                 connection_id uuid, organization_id uuid,
                 external_event_id text, event_type text,
                 received_at timestamptz, attempts integer,
                 last_error_class text)       -- giving_provider_events.last_error: a short code,
                                              -- CHECK-bounded ^[a-z0-9_:]*$, <= 60 chars; may be null
  -- language sql, STABLE, SECURITY DEFINER, search_path = public, pg_temp
  -- (#variable_conflict is plpgsql-only and does not apply; every column is qualified)
  -- status = 'dead_letter' only; oldest first (received_at, id); p_limit clamped to 1..100
  -- OWNER ONLY: EXECUTE revoked from public, presby_app, presby_platform. Does NOT arm the write marker.
```

No body, amount, donor field or payload fragment is returned.

**Whole-file idempotence, proven by applying the finished file and re-applying it.** The snapshot is Batch 1a's: row counts on all 12 tables plus `permissions`/`app_roles`/`app_role_permissions`/`feature_flags`/toggles, and counts of giving functions, triggers, policies, constraints, indexes and table ACL entries. It adds a function-ACL count, an md5 over `pg_get_functiondef ‖ proacl ‖ oid` of every giving function (so a re-apply that silently dropped and recreated `claim_event` would show as a new OID), and an md5 of the inbox rows.
- Apply #1: exit 0, 0 ERRORs. Apply #2: exit 0, 0 ERRORs. **Snapshots byte-identical**, so the guarded drop does not fire on a re-apply:
  `acl=115 app_roles=31 arp=163 connections=3 constraints=262 … fnacl=78 fns=51 … indexes=54 … policies=12 … triggers=13`.
- Against the pre-change baseline, only `fns` 50→51 (`dead_letters`) and `fnacl` 77→78 (its owner-only ACL entry) differ. Every row count and the inbox digest are unchanged.
- The guarded drop's other branch, the old seven-column shape installed when 0055 is applied, is the path the pipeline branch first took and is exercised again by the M3 restore below. Exit 0, and `claim_event` keeps its `presby_app` grant (`{neondb_owner=X/neondb_owner,presby_app=X/neondb_owner}`).

**`scripts/giving/test-rls-46.sql` as `presby_app`: 201 passes, exit 0** (was 193; +8). After integration the integrated `test-rls.sql` count from Batch 1a moves from 857 to **865** (664 + 201); no other section is touched.

**Failing-first.** I broke one mechanism as owner, ran a no-stop copy of §46 as `presby_app` and `giving.db.test.ts`, restored by re-applying 0055 (dropping the mutated function first where its return type changed), and confirmed §46 green at 201 each time. Lines are `test-rls-46.sql` as it now stands. In a no-stop run, the first failure in a transaction masks later assertions in that transaction; that is why the by-name §46i checks have their own transaction.

| Mechanism broken | Fails |
|---|---|
| M1 `grant execute on presby_giving_dead_letters(integer) to presby_app` | `:362` 46e owner-only not executable (got 1); `:385` 46e "presby_app executed presby_giving_dead_letters()"; `:874` 46i EXECUTE list ≠ the 27; `:912` 46i owner-only callable set ≠ {ingest_health, dead_letters, requeue_event}; Vitest › "the owner-only functions are not executable by presby_app" |
| M2 `dead_letters` also returns `raw_body` | `:390` 46e result shape (got 0); Vitest › "dead_letters lists a dead-lettered event…" (column list). The two assertions masked behind `:390` were checked directly in the mutated state: `:395` "no result column is a body" → 1 and `:400` "never reads raw_body" → 1, both expected 0 |
| M3 `claim_event` reverted to the original seven columns | `:420` 46e C1 result shape (got 0); Vitest › "claim_event returns external_event_id and organization_id…" |
| M4 `dead_letters` rewritten to arm `presby.giving_write_active` | `:879` 46i arming count 6≠5; `:897` 46i arming set by name (diff of 1). Vitest unaffected: the marker is §46i's pin |
| M5 `grant execute on presby_giving_dead_letters(integer) to public` | `:362`, `:385` 46e; `:850` 46i "no giving function grants EXECUTE to PUBLIC"; `:912` 46i owner-only set; Vitest › owner-only test (the ACL now names PUBLIC) |

§46e's "presby_app cannot read the inbox" (`:349` permission denied and `:356` the privilege-count assertion) is unchanged and green.

**Commands** (worktree):

| Command | Result |
|---|---|
| `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0055_presby_giving.sql` ×2 | exit 0 / exit 0, identical snapshots |
| `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/giving/test-rls-46.sql` | exit 0, **201 passes** |
| `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/giving.db.test.ts src/lib/db/domain/giving.schema.test.ts src/lib/giving/two-factor-agreement.test.ts src/lib/giving/ingest/ src/lib/admin/giving-ingest-health.db.test.ts` | **9 files, 201 tests, all passed**: giving.db 19 (was 17), giving.schema 20, two-factor-agreement 3, apply.db 53, lifecycle.db 32, process.db 18, process 27, outcome 24, giving-ingest-health.db 5 |
| `npm run typecheck` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run check` (all seven tripwires; `check:secrets` sees every file touched here, all tracked) | exit 0 |
| `npx dotenv -e .env.local -- npm run check:schema-parity` | exit 0: 68 tables, 6 allowlisted, 0 failing. `giving.ts` is still not exported from the domain index (integration step 4); no table shape changed, so Batch 1a's 80-table merged-copy result stands |

No existing 3a test broke. `functions.ts`'s `claimEvent()` already read both columns when present, so with the correction live the processor fills `organizationId` and `externalEventId`, and `process.db.test.ts` (18) and `process.test.ts` (27) pass unchanged.

**Fixture hygiene.** The new Vitest cases leave their inbox rows terminal (`ignored`), so no sweep can pick them up before teardown, and the org cascade removes them in `afterAll`. Afterwards there are 0 `giving-db-test*` orgs, and the inbox digest equals the pre-change baseline. §46's C1 block rolls back.

### Audit Events

None. Schema only. `presby_giving_requeue_event()` remains audited `ORG_GIVING_EVENT_REQUEUED` by its caller.

### Implementer Notes

**Found on arrival, before any change: §46 was red on the pipeline branch.** Baseline §46 failed at `test-rls-46.sql:363` (then line numbering) with "46e: …alder: one parked, one dead letter — expected 1, got 0". The seed draft's parked inbox row `d9100000-…-000000000070` (`scripts/giving/seed-dev-giving.sql:282–285`) had become `dead_letter / normalize_api_version`, `processed_at` 2026-10-16 04:26 UTC. That is during Batch 3a's run, when `e2e/giving-webhook.spec.ts` (`:115`, `:160`) called `GET /api/cron/giving`. The cron sweeps every due event on the branch, and the seed stamps that row `next_attempt_at = now() + 5 minutes` with a fixture body that has no `api_version`. I restored the row to its seeded shape on the owner connection (fixture data, pipeline branch only), and the baseline was then 193/193. **For the orchestrator, before integration:** the same thing will happen on `development` the first time anything runs the giving cron there (the e2e spec, or a deployment's cron), and §46e will go red. Either the seed's parked row gets a far-future `next_attempt_at`, or the e2e spec stops running a global cron sweep. I made neither change, because both are outside this correction's scope. If the e2e spec is run on this branch again before then, the row will need the same restore.

**Residual, accepted:** `dead_letters` has no supporting index. It filters `status = 'dead_letter'` across all orgs, and `giving_events_org_status_idx` leads with `organization_id`. The page that calls it also calls `presby_giving_ingest_health()`, which already scans the whole inbox, so an index here would not change the page's cost. A partial index `(received_at) where status = 'dead_letter'` is the fix if the platform page ever measures slow.

**What the api-developer must know (addendum, items 1–2 wiring):**
1. `src/lib/giving/ingest/functions.ts` `ClaimedEvent`: `externalEventId` and `organizationId` are now always returned. Make them required (`string`) and delete the "Not returned … today" comment. `process.ts:119–122`'s comment and its `if (!claim.externalEventId) return dead("body_purged")` fallback are now dead code for a real claim; keep or drop the guard as you prefer, but the comment is stale. `process.ts:261` now always includes `organizationId` in the audit metadata; per 3a deviation 9, consider whether `resourceId` should still be the connection.
2. Add the reader to `src/lib/admin/giving-ingest-health.ts` (the one file B6 allows), for example `listDeadLetters(limit = 100): Promise<DeadLetterRow[]>` with `{ eventId, connectionId, organizationId, externalEventId, eventType, receivedAt: string /* ISO via toIso */, attempts: number, lastErrorClass: string | null }`, via `getPlatformDb().execute(sql\`select * from presby_giving_dead_letters(${limit}::integer)\`)`. `eventId` is the argument `requeueDeadLetter()` takes.
3. **`scripts/check-giving-boundaries.mjs:118` `OWNER_ONLY_FUNCTIONS` must gain `"presby_giving_dead_letters"`**, with a matching case in `check-giving-boundaries.test.mjs`'s B6 `it.each` and the B6 header comment (`:47`). Until then the tripwire does not keep the new owner-only name out of the rest of the giving tree. The database still refuses `presby_app` either way.
4. Tests to add on your side: a `process.db.test.ts` case that a purged-body event re-fetches through `retrieveEvent` with the claim's `externalEventId` (mocked client), and that processor audit rows carry `organizationId`.

**Next agent:** api-developer (3a addendum: ruling items 1–4 wiring, including the four points above), then ux-developer (3b) builds the requeue control against `listDeadLetters()`/`requeueDeadLetter()`.

---
### Orchestrator ruling on the 3a-fix seed question (2026-10-16)

Committed as `70cab12`. The seed's parked inbox row (`scripts/giving/seed-dev-giving.sql` `…0070`) gets a far-future `next_attempt_at` (`now() + interval '100 years'`) so it stays parked by design: §46e's "one parked, one dead letter" is a fixture assertion, not a liveness claim, and the giving cron on `development` (and the replay harness calling `/api/cron/giving`) must not be able to change it. The e2e spec keeps calling the real cron; its own assertions already scope to its fixture connection. `api-developer` addendum applies the seed change (a draft under `scripts/giving/`, not a Rule 16 file) and re-runs §46.

---

## Batch 3a addendum — rulings wired (api-developer)

*2026-10-16, api-developer, worktree `presby-giving` on `pipeline/online-giving` (HEAD `70cab12`), Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. No schema change (0055 as corrected by 3a-fix). No live Stripe call. One dev server was started from the worktree on port 3100 (wrapper PID 92180 / listener PID 92197, both started by this addendum) for `e2e/giving-webhook.spec.ts` and stopped by PID afterwards; the demo server on port 3000 was never touched.*

### Files Modified

**1. Claim shape.**
- `src/lib/giving/ingest/functions.ts`: `ClaimedEvent.externalEventId` and `organizationId` are required `string`s; the "not returned today" comment is replaced. `claimEvent()` throws if either column is missing from a claimed row (a database without the 0055 C1 correction) rather than process an event it could not re-fetch or attribute. The throw happens inside `processInboxEvent`'s claim `try`, so it still never throws out of the processor.
- `src/lib/giving/ingest/process.ts`: stale comment at the purged-body branch replaced; the `if (!claim.externalEventId) return dead("body_purged")` guard is **dropped** (dead code for a real claim). A purged body is re-fetched through `retrieveEvent(claim.accountId, claim.externalEventId)`. `writeAudits` always includes `organizationId` in metadata (it was conditional). `resourceId` stays the connection (3a deviation 9 unchanged), the event id for the dead-letter row.
- Tests: new `src/lib/giving/ingest/functions.test.ts` (3: both columns returned, null when unclaimable, refuses a row that lacks them); `process.test.ts` (the claim helper now carries both ids, the "without an event id" case is removed, a failed re-fetch is a `failed:stripe_*` retry, a new case proves all three audit kinds carry `organizationId`); `process.db.test.ts` (a purged inbox row goes through the REAL claim, `retrieveEvent` is called with the connection's account and the row's own `external_event_id`, the event applies; a re-fetched bad-version body dead-letters and its audit row names the organization).

**2. Dead letters.**
- `src/lib/admin/giving-ingest-health.ts`: `listDeadLetters(limit = 100): Promise<DeadLetterRow[]>` over `presby_giving_dead_letters` (owner connection; limit clamped 1..100 here as well as in SQL), exported `DeadLetterRow`; `requeueDeadLetter(eventId)` (parameter renamed from `inboxId`, same behaviour). File header updated: still the only `getPlatformDb()` user.
- `scripts/check-giving-boundaries.mjs`: `presby_giving_dead_letters` added to `OWNER_ONLY_FUNCTIONS`; B6 header comment updated. `scripts/check-giving-boundaries.test.mjs`: B6 `it.each` and the allowed-in-health-file case cover all three names.
- `src/lib/admin/giving-ingest-health.db.test.ts`: dead-letters a fixture event, lists it, asserts the exact row (equality, not subset), the closed key set (no body, amount, donor or payload field exists in the type, and none of the fixture's donor/amount strings appear in the values), parked and applied events are not listed, limit clamping, oldest-first, and that the returned `eventId` feeds `requeueDeadLetter` and the event then leaves the list.

**3. Audit key.**
- `src/lib/audit.ts`: `GIVING_PAYOUTS_ATTESTED: "tenant.giving_connection.payouts_attested"` (existing values untouched; value follows `GIVING_PUBLIC_PAGE_TOGGLED`'s `tenant.giving_connection.*` family, which the ruling left to me). `src/lib/audit.test.ts`: the snapshot entry and the giving-key count (31 to 32).
- `src/lib/giving/connection.ts`: `AttestResult` ok-case now carries `connectionId` (both the changed and the already-attested branches; no SQL change beyond `returning id` / `select id`). `connection.db.test.ts` updated to match.
- `src/app/(org)/o/[slug]/admin/giving/connect/actions.ts`: `attestPayoutsAction` writes `GIVING_PAYOUTS_ATTESTED` after the write, **only when `changed`** (a repeat writes nothing, like `setPublicPageAction`). Metadata `{ organizationId, connectionId }`; the actor, time, IP and user agent are `recordAudit`'s own. The old "AUDIT_ACTIONS has no key" docblock is replaced. `actions.test.ts`: three cases (change audited with the exact payload, repeat silent, no-connection silent). `npm run check:audit` still reports zero.

**4. Disputes.**
- `src/lib/giving/providers/stripe/constants.ts`: `HANDLED_EVENT_TYPES` is now **eighteen** (`charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated` added). `constants.test.ts` pins eighteen, and gains a test that parses the runbook's endpoint list and requires it to **equal** the code's set (the old test only checked the code's list was a subset of the doc, so a stale extra in the doc would have passed). `route.test.ts`: the "every handled type" title.
- `src/lib/giving/providers/stripe/normalize.ts`: one block of dispute code. `created` (non-`warning_*`) and `funds_withdrawn` both produce the reversal keyed on the dispute id; `closed` with `won` and `funds_reinstated` both produce the reinstatement keyed `<dispute id>:won` offsetting the dispute id. `ach_return` vs `dispute` is by `payment_method_details.type` for both. Non-USD returns `[]`, a zero amount throws `bad_amount`.
- Fixtures (sanitized, `acct_fixtureAccount0001`, `pi_fixturePaid000001`, `dp_fixtureDispute00001`, no key shapes): `charge-dispute-funds-withdrawn.json`, `charge-dispute-funds-reinstated.json`; both added to `FIXTURE_NAMES` in `testing/sign-event.ts`. `check:secrets` is clean on them (run over the untracked files through `checkSecretsPii()`; the script itself scans tracked files only).
- Tests: `normalize.test.ts` (table rows for both fixtures; funds_withdrawn equals created; an inquiry-status object still records on funds_withdrawn; ACH kind; funds_reinstated equals closed:won; non-USD and zero amount), `process.db.test.ts` (six cases: created then withdrawn, withdrawn then created, inquiry then escalation, an ACH return, closed:won then reinstated and the reverse, and a reinstatement that beats its withdrawal parks then applies), `e2e/giving-webhook.spec.ts` (the replay harness: withdrawn, created, reinstated, closed:won through the real route and cron, plus a byte-identical redelivery).
- `docs/deployment.md`: step 4 now lists exactly eighteen events (the two new ones between `charge.dispute.created` and `charge.dispute.closed`); go-live checklist says eighteen; smoke step 7 is rewritten from an open question into the dispute rule and what to confirm.

**5. Seed.** `scripts/giving/seed-dev-giving.sql`: parked row `…0070` gets `now() + interval '100 years'` with a comment citing the ruling. The seed is `on conflict (id) do nothing`, so re-applying it (exit 0) cannot change a row that already exists; the pipeline branch's row was set with one owner-connection `update` (fixture data, branch only). A fresh database (and `development` at integration) gets the far-future value from the seed itself.

### Deviations and judgment calls

1. **`funds_withdrawn` always records; it does not apply the `warning_*` filter.** The ruling says `warning_*` records nothing; read as written for `created`. The reason an escalated inquiry needs `funds_withdrawn` at all is that the money has moved, and the embedded dispute object can still carry an early status. The event is the fact. Tested both ways in `normalize.test.ts`.
2. **`funds_withdrawn` uses the event's time for `occurred_at`; `created` uses the dispute's own `created`.** For an ordinary dispute the two are the same instant. For an escalated inquiry the dispute's `created` is the earlier inquiry and the money moved at the event. Consequence: the row's `occurred_at` can differ by seconds between the two arrival orders, never the id, kind, or amount. Same convention `closed`/`funds_reinstated` already use.
3. **The purged-body DB test passes against the pre-addendum processor** (the code path was already live and read the columns when present, as the 3a-fix note said). Failing-first was therefore shown by mutation: with the two `claimEvent()` column reads removed, the new DB case fails (`retrieveEvent` not called); against the original `functions.ts` the new strictness test fails (`claimEvent` resolves instead of rejecting). The six dispute DB cases all fail against the original `normalize.ts` and pass now. The B6 case fails with `presby_giving_dead_letters` removed from the tripwire list.
4. `body_purged` is no longer a code the processor can produce. Nothing else referenced it.

### Failing-first record

| Change | Reverted to | Result |
|---|---|---|
| Strict claim | original `functions.ts` | `functions.test.ts` "refuses a row from a database that lacks the 0055 correction" fails |
| Purged re-fetch | claim mapping without the two columns | `process.db.test.ts` PURGED case fails: `retrieveEvent` never called |
| Dispute arrival orders | original `normalize.ts` | all six `process.db.test.ts` dispute cases fail |
| B6 | tripwire list without the new name | "flags presby_giving_dead_letters outside the health file" fails |

### Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint -- --max-warnings=0` | exit 0 |
| `npm run check` (seven tripwires, incl. `check:audit`, `check:giving-boundaries`, `check:secrets`) | exit 0, all passed |
| `npm run test` | 364 files passed, 53 skipped; 5225 tests passed, 1510 skipped (DB-backed files skip without `.env.local`) |
| DB lane: `npx dotenv -e .env.local -- vitest run --no-file-parallelism` over all 13 `*.db.test.ts` under `src/**/giving*`, plus `giving.schema.test.ts`, `two-factor-agreement.test.ts`, `access.test.ts` | **16 files, 323 tests, all passed** |
| `npm run build` | exit 0 |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/giving-webhook.spec.ts` (server started with `STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret`, `CRON_SECRET=giving-e2e-cron-secret`, no `STRIPE_SECRET_KEY`) <!-- leak-ok: non-key-shaped test literals --> | **12 passed** (was 11; +1 dispute case) |
| `psql "$APP_DATABASE_URL" -f scripts/giving/test-rls-46.sql` | **201 passes**, run twice: after the seed fix, and again after the e2e spec had called the real cron (row `…0070` still `parked`, attempts 1: the seed fix holds) |

Fixture hygiene: no `e2e-giving*`, `giving-*test*` or `ingest-*` organizations remain; the two seed inbox rows are `parked` / `dead_letter` as seeded; the dev server on 3100 is stopped and port 3000 is untouched.

### Contract for 3b (delta to the 3a contract above)

```ts
// src/lib/admin/giving-ingest-health.ts  (server-only; gate the caller on FEATURES.ADMIN_ORGANIZATIONS)
listDeadLetters(limit?: number /* default and max 100, min 1 */): Promise<DeadLetterRow[]>
DeadLetterRow = {
  eventId: string;            // the INBOX row id; the argument requeueDeadLetter takes
  connectionId: string; organizationId: string;
  externalEventId: string;    // the provider's evt_... id
  eventType: string;
  receivedAt: string | null;  // ISO UTC; oldest first
  attempts: number;
  lastErrorClass: string | null; // a short code, e.g. "over_reversal", "normalize_api_version"; never free text
}
requeueDeadLetter(eventId: string): Promise<"requeued" | "not_dead_letter" | "not_found">
```
- **The requeue control can now be built.** The platform page calls `listIngestHealth()` and `listDeadLetters()`; organization names come from the `organizations` join on `organizationId`. `(admin)/admin/giving/actions.ts` calls `requeueDeadLetter(eventId)` and writes `ORG_GIVING_EVENT_REQUEUED` (the module does no audit of its own). `lastErrorClass` is safe to render; there is no body, amount or donor field in the row.
- **`attestPayoutsAction(slug)`**: result unchanged (`{changed:boolean}`); a `changed: true` now writes `GIVING_PAYOUTS_ATTESTED` (`tenant.giving_connection.payouts_attested`), who/when/org on the audit row. A repeat attest is `changed: false` and silent. `AUDIT_ACTIONS` has the key; the tenant audit viewer, if it lists giving acts, should label it.
- **Webhook endpoint event list is now eighteen** (`docs/deployment.md` step 4 is the copy-source). Operator Q1's smoke should confirm one reversal per dispute whichever event lands first.
- No other 3a contract line changed. `connection.attestPayouts()`'s ok-result gained `connectionId` (internal to `src/lib/giving/`; 3b does not call it).

### Open items

- ~~A purged body older than Stripe's event retention would 404 on re-fetch and walk the retry ladder.~~ **Done on the coordinator's follow-up (2026-10-16):** `retrieveEvent` `not_found` on a purged body now finishes the event `dead:body_unavailable` (audited as a dead letter) in `process.ts`, with two unit tests in `process.test.ts` (`not_found` is final; `rate_limited`/`network`/`unconfigured` stay retryable). Other provider errors are unchanged.
- **Accepted by the coordinator as built (2026-10-16):** deviation 1 (`funds_withdrawn` always records, no `warning_*` filter) and deviation 2 (`funds_withdrawn` uses the event's time for `occurred_at`).
- The platform-page requeue control and health table are 3b (ux-developer). Nothing else is blocked.

### Handoff

Next agent: **ux-developer (Batch 3b)** with the contract above (connect panel, `connect/return`, platform health page including the dead-letter list and requeue control). QA follows 3b. The 3a-fix and this addendum are uncommitted on `pipeline/online-giving`; the orchestrator commits.


## Batch 3b — connect panel, return page, platform health (ux-developer)

**Date:** 2026-10-16. Built only against the 3a contract, fix and addendum. Nothing committed. No live Stripe account exists: every state was exercised through fixture rows and mocked actions; nothing called Stripe.

### Files

New, org side (`src/app/(org)/o/[slug]/admin/giving/`): `connection-card.tsx` (server: state badge, facts, go-live checklist, rates summary, G15 disclosure), `connect-panel.tsx` (client: one primary action per state, AlertDialogs for disconnect / take-offline / attest, `isOnboardingUrl` re-assertion before `window.location.assign`), `rates-form.tsx` (percent and dollars in, bps and cents out), `connect/return/page.tsx` (server; retrieves via `refreshConnection`, then `loadConnectionPanel`; no `loading.tsx`), `layout.tsx` + `test-mode-slot.tsx` (badge on every giving admin page without touching the nine pages), `connect-fixtures.ts` (test-only builders). Deleted `connection-placeholder-card.tsx`. `page.tsx` now loads the panel for `giving.manage` holders (failure renders in place; the rest of the page survives) and renders the `?connect=<code>` notices.
New, shared: `src/components/giving/test-mode-badge.tsx`; `src/lib/giving/{giving-copy,connection-display,rates-format}.ts` with tests.
New, platform: `(admin)/admin/giving/{page,ingest-health-table,dead-letters-table,actions}` (+ tests), `(admin)/admin/organizations/[id]/ingest-health-section.tsx` (+ test), `src/lib/admin/format-age.ts`; "Giving health" link in the admin nav (`(admin)/admin/layout.tsx`).
Edited server-side files (small, additive): `src/lib/giving/connection.ts` (+`readOpenConnectionMode`), `src/lib/admin/giving-ingest-health.ts` (+`listOrganizationNames`), `(admin)/admin/organizations/[id]/page.tsx` (section, same applicability as the treasurer section), `e2e/support/giving-fixture.ts` (+`setConnection`, `clearConnections`, `offerFundOnline`, `addInboxEvent`). Tests: `giving-copy.test.ts`, `connection-card.test.tsx` (all six states), `connect-panel.test.tsx` (redirects incl. look-alike hosts, dialogs, not_ready, 2FA bounce), `rates-form.test.tsx`, `connect/return/page.test.tsx`, `test-mode-slot.test.tsx`, the platform page/tables/action/section tests, `page.test.tsx` updates (overview, org detail), DB tests in `connection.db.test.ts` and `giving-ingest-health.db.test.ts`, `e2e/giving-connect.spec.ts` (16 tests).

### Commands and results

| Command | Result |
|---|---|
| `npm run typecheck`; `npm run lint -- --max-warnings=0` | clean |
| `npm run check` (all seven incl. `check:audit`, `check:hydration-gate`, `check:giving-boundaries`) | all passed |
| `npm run test` | 379 files passed, 53 skipped; 5358 tests passed, 1514 skipped |
| DB lane: `connection.db.test.ts` + `giving-ingest-health.db.test.ts` (serial, `.env.local`) | all passed (this caught a real bug: an array parameter in `listOrganizationNames` expanded to a record list; fixed with an `in (...)` of casts) |
| `npm run build` | exit 0 |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/giving-connect.spec.ts` | 16 passed |
| Whole suite on 3100 | **248 passed** (an earlier full run failed `giving-admin.spec.ts:259`, see deviation 2) |
| Browser at 360 px | screenshots in `test-results/giving-connect-360/` (01-11) read: not started, details due, pending, active, restricted, disconnected, badge, return page x2, platform page, organization section; no horizontal scroll, controls at least 40 px |

Hygiene: no `e2e-giving*` organization remains; my 3100 server is stopped; the port 3000 server was never touched.

### Deviations (with reasons)

1. **`listOrganizationNames()` added to `giving-ingest-health.ts`.** The brief says the platform page reads only through that module and takes names from the public join; one module keeps `getPlatformDb()` in a single file.
2. **The test-mode badge is shown to `giving.view` and `giving.manage` holders, never to a record-only holder.** First version showed it to everyone passing the gate; the existing S4 test (`giving-admin.spec.ts:259`, recorder sees no provider state) caught it. The slot is silent for every other non-ok case, and for any failure.
3. **Badge wiring is a layout plus an async slot**, not the gate: a gate result cannot reach the nine pages without editing them. The slot repeats the gate's cheap reads (session claim, resolve, toggle and keys); it is not a gate, and every page still runs `gateGivingPage()`.
4. **Onboarding splits into "details due" and "waiting for Stripe"** on `detailsSubmitted && !requirementsDue` (the panel's own `state` has one `onboarding` value); the primary action differs (Continue vs Refresh).
5. **Platform tables are real `<table>`s in the shared scroll container**, not collapsing cards: operator-only pages; the page itself never scrolls sideways, and the scroll cue shows.
6. **No `STRIPE_SECRET_KEY` in the Playwright server env** (Batch 4's e2e needs it unset), so the spec's "not started" step asserts whichever the page truthfully shows (installation notice, or Connect button when the server has a key). I ran it once with a dummy key set to exercise the Connect-button branch; CI exercises the notice branch.
7. **Attestation also uses an AlertDialog** (it is an audited statement of fact), beyond the plan's list.

### Operator smoke still needed (once a Stripe test account exists)

Click **Connect Stripe** and confirm the redirect lands on `accounts.stripe.com` and back on `connect/return` showing the real status; **Continue setup** after abandoning onboarding; the **refresh** route after an expired link; **Refresh status** with a v2 account (payouts-enabled and requirements shapes); then attest, go live and the give page. The Start/Continue buttons were tested only with mocked actions and a re-asserted origin.

### What Batch 4 must know

- `<TestModeBadge>` exists in `src/components/giving/`; the public give page and `GiveForm` can reuse it (a test-mode banner when `livemode` is false).
- `giving-copy.ts` already holds `STRIPE_RECEIPT_NOTE` and `MONTHLY_STOP_NOTE` for the return panels; its test forbids "acknowledgment" next to "receipt" and walks every exported string, so add new copy to `allGivingCopy()`.
- The overview does not link to the public give page (Batch 4's route does not exist); add the link to the card's give-page section.
- Do not set `STRIPE_SECRET_KEY` globally in the Playwright config.
- `e2e/support/giving-fixture.ts` now has `setConnection(sql, fx, spec)` (any connection state, schedules, armed write marker), `offerFundOnline`, and `addInboxEvent`; reuse them for public-giving states.
- The admin nav has a "Giving health" link; the org detail page's section is read-only counts.

## Batch 4a — give actions, intents, rate limits, enforced CSP (api-developer)

*2026-10-16, api-developer, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. No schema change. No live Stripe call and no Stripe key anywhere: Stripe is the mocked allowlist in unit and DB tests, and unset in e2e. One dev server on port 3100 (started and stopped by PID, three times: a `next.config.ts` change needs a restart) and one `next start` on 3100 to read the production headers; the demo server on 3000 (PID 15271) was never touched.*

### Files Created

**Library — `src/lib/giving/`**
- `give-input.ts` — PURE (client-importable): the `GiveResult` union, `GIVE_FORM_FIELDS`, `parseGiveForm(formData)`, `isSlugShaped`. The first wrong field is named, in form order.
- `give-session.ts` — server-only: `createPublicIntent`, `createMemberIntent`, `startGiveSession` (lifecycle steps 2 to 6), `checkoutReturnUrls`, `toIntentRow`.
- `public-config.ts` — server-only page readers: `readPublicGivingConfig(slug)` and `readReturnState(slug, sessionId)` (+ the two row mappers, exported for tests).
- Tests: `give-input.test.ts` (29), `give-session.test.ts` (24), `public-config.test.ts` (16), `give-session.db.test.ts` (23, DB), `csp.test.ts` (7).

**Actions**
- `src/app/(public)/site/[slug]/give/actions.ts` — `createPublicGiveSessionAction`; test `actions.test.ts` (32).
- `src/app/(org)/o/[slug]/giving/give/actions.ts` — `createMemberGiveSessionAction`; test `actions.test.ts` (24).

**Ingest validator** — `src/lib/sites-reserved-paths.ts` (pure `reservedSitePath()`; `RESERVED_SITE_SEGMENTS = ["give"]`) + `sites-reserved-paths.test.ts` (25).

### Files Modified
- `src/app/api/sites/ingest/route.ts` — `validateBundle` refuses a bundle page at `/give` or anywhere beneath it (case-, slash-, `.`-segment- and percent-encoding-insensitive) with a 422 naming the page; `route.test.ts` +4 cases (`/give`, `/give/return`, `/Give/`, `/give/anything/deeper`; asserts nothing is revalidated). The near-names (`/giving`, `/give-now`, `/about/give`) are pinned in the pure test, not the route test, because a 200 ingest there would pollute the shared fixture the happy-path test counts blobs on.
- `next.config.ts` — the policy string hoisted to one constant; **two new `headers()` entries** (`/site/:slug/give/:path*`, `/o/:slug/giving/give/:path*`) carrying an **enforced** `Content-Security-Policy` identical to the report-only value. The report-only header still applies to those routes too. See "CSP" below for the dev-only `'unsafe-eval'`.
- `src/lib/giving/access.ts` (+ `access.test.ts`, +5 DB cases) — additive `loadGivingToggle(viewer)` → `"not_applicable" | "toggle_off" | "on"`: applicability and the org toggle with **no key lookup** (the member give gate). `loadGivingContext` is unchanged.
- `src/lib/giving/giving-copy.ts` (+ `giving-copy.test.ts`, +3) — `GIVE_MESSAGES` and `rateLimitedMessage()`, added to `allGivingCopy()` (so the forbidden-word walk covers them; the min/max wording is pinned to `AMOUNT_BOUNDS`).
- `e2e/security-headers.spec.ts` — +18 tests (below).
- `docs/deployment.md` (operator smoke step 8, the CSP go-live line), `docs/testing.md` (a "Starting a gift" table and the restart-after-config-change gotcha).

### Schema Changes
None. Every database interaction is an existing 0055 function on `db` (`presby_giving_create_intent_public/member`, `attach_session`, `fail_intent`, `presby_public_giving_config`, `presby_giving_return_state`); the member intent runs inside `withOrgContext`.

### Audit Events
None added. Both actions carry an `// audit-exempt:` annotation (a request to START a gift is not a security-sensitive mutation, and money moves only when Stripe's signed webhook is applied, which audits what it records). `checkRateLimit` writes its own `RATE_LIMIT_BLOCKED` row on a refusal, as everywhere. `npm run check:audit`: zero violations (the actions hold no `db.` call; the writes are in `give-session.ts`).

### Endpoints and gates

| Surface | Auth + gate | Request / response |
|---|---|---|
| `createPublicGiveSessionAction(slug: string, formData: FormData): Promise<GiveResult>` — `(public)/site/[slug]/give/actions.ts` | none (anonymous). honeypot → three limiter keys → Turnstile → parse → DB intent → Stripe. The org comes from `slug` only. | FormData and `GiveResult` below |
| `createMemberGiveSessionAction(slug: string, formData: FormData): Promise<GiveResult>` — `(org)/o/[slug]/giving/give/actions.ts` | honeypot → `auth()` → Node-side 2FA claim → `resolveOrgContext()` → applicability + `org_portal.giving` toggle (**no giving key**) → own active membership → limiter → parse → intent → Stripe | same |
| `readPublicGivingConfig(slug)` / `readReturnState(slug, sessionId)` — `@/lib/giving/public-config` | none (anonymous `db`, SECURITY DEFINER reads) | below |
| `POST /api/sites/ingest` | unchanged (OIDC) | new 422: `Page "/give" is reserved: PresbyPortal serves its own /give page for online giving. Rename or remove it.` |
| `Content-Security-Policy` response header | — | on `/site/<slug>/give[/...]` and `/o/<slug>/giving/give[/...]` only |

No new `FEATURES` entry, no platform flag, no seed change, no new route handler.

### Contract for 4b

**Imports.**
```ts
import type { GiveResult, GiveField, ParsedGive } from "@/lib/giving/give-input"; // pure: client-safe
import { GIVE_FORM_FIELDS } from "@/lib/giving/give-input";                          // pure: client-safe
import { GIVE_MESSAGES, rateLimitedMessage } from "@/lib/giving/giving-copy";        // pure
import { grossUp } from "@/lib/giving/money";                                        // pure, DISPLAY ONLY
import { isCheckoutUrl } from "@/lib/giving/providers/stripe/urls";                  // pure (3a)
import { readPublicGivingConfig, readReturnState } from "@/lib/giving/public-config"; // server-only
import { loadGivingToggle } from "@/lib/giving/access";                              // server-only (member page)
```

**`GiveResult` — exactly as implemented** (`src/lib/giving/give-input.ts`):
```ts
export type GiveResult =
  | { kind: "checkout"; url: string }          // re-assert isCheckoutUrl(url) [origin === https://checkout.stripe.com], then window.location.assign(url); if it fails, show GIVE_MESSAGES.error
  | { kind: "invalid"; field: GiveField; message: string }   // message is display-ready; field = "amount"|"fund"|"frequency"|"method"|"form"
  | { kind: "rate_limited"; retryAfterSeconds: number }      // show rateLimitedMessage(retryAfterSeconds)
  | { kind: "unavailable" }                    // show GIVE_MESSAGES.unavailable (also what a bot gets from the honeypot)
  | { kind: "already_started" }                // show GIVE_MESSAGES.alreadyStarted
  | { kind: "error" };                         // show GIVE_MESSAGES.error
```

**FormData field names** (`GIVE_FORM_FIELDS`; the action ignores every other field, including any `membershipId`/`organizationId`):

| Field | Value |
|---|---|
| `amount` | the typed string, e.g. `"37.50"` (never a float; server regex `^\d{1,5}(\.\d{1,2})?$` after trim; $1.00 to $25,000.00) |
| `fundId` | the fund's uuid (send it even when the select is hidden for a single fund) |
| `frequency` | `once` or `monthly` |
| `coverFees` | `on` when checked, **absent** otherwise |
| `method` | `card`, `bank` or `either`. `coverFees` with `either` is refused (`invalid`, field `method`): the fee depends on the method, so the form must require card/bank once "cover fees" is ticked |
| `idempotencyKey` | the **server-minted** uuid in a hidden input (lowercase hex; the server lowercases) |
| `_hp` | the honeypot: a hidden, `tabIndex={-1}`, `aria-hidden`, `autoComplete="off"` text input, empty. Non-empty → a fake `unavailable`, no budget spent |
| `turnstileToken` | the Turnstile token, only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set (the widget's own `cf-turnstile-response` field is accepted too) |

**Idempotency key rule (important).** The key identifies ONE attempt. Re-key with `crypto.randomUUID()` **in the result handler** (never during render) after every result except `checkout` and `already_started` - in particular after `error` and `unavailable`: when Stripe is unset or fails, presby has already written the intent as `failed`, and a retry with the same key finds that dead intent and answers `error` again. (`invalid` and `rate_limited` write nothing, so reusing the key is harmless, and re-keying is also harmless.)

**Per-surface notes.** Public: `createPublicGiveSessionAction.bind(null, slug)` or a closure over `slug`; the page calls `readPublicGivingConfig(slug)`. Member: same action shape; the page must repeat the full `(org)` auth pattern (`auth()` → `resolveOrgContext()` → `loadGivingToggle()`: `not_applicable`/`toggle_off` render the honest states, `on` renders the form), then `readPublicGivingConfig(slug)` for the funds/rates (the same `live` predicate the intent function enforces). No giving key is needed to give; no 2FA force beyond the Edge's.

**`readPublicGivingConfig(slug: string): Promise<PublicGivingConfig>`** — never throws; one try/catch; ids-only logging; a database failure or a non-slug is `absent`:
```ts
type PublicGivingConfig =
  | { state: "absent" }                                  // page: notFound(); slot: null. Byte-identical for an unknown slug, a non-tenant slug and a toggle-off org: render the SAME markup
  | { state: "unavailable"; organizationName: string; contactPhone: string | null }   // the notice, never the form
  | { state: "live"; organizationName: string; livemode: boolean /* false => <TestModeBadge> */;
      contactPhone: string | null; funds: { id: string; name: string }[] /* never empty */;
      cardEnabled: boolean; achEnabled: boolean;
      rates: { cardBps: number; cardFixedCents: number; achBps: number; achCapCents: number } /* for grossUp(amountCents, "card" | "bank", rates) */;
      minAmountCents: number; maxAmountCents: number };   // 100 and 2_500_000
```
`unavailable` appears only for an organization with a LIVE published site (`organization_sites.status = 'live'`) and giving not live; without a live site it is `absent`.

**`readReturnState(slug: string, sessionId: string): Promise<ReturnState>`** — never throws; a malformed id answers `unknown` without touching the database; pass `session_id` only when `typeof === "string"`:
```ts
type ReturnState =
  | { state: "unknown" }     // absent, malformed, or another organization's session: ONE panel
  | { state: "error" }       // a database failure: "We can't load this right now - your gift is not affected", never a guess
  | { state: "confirming" | "received" | "bank_pending" | "failed";
      giftAmountCents: number; coveredCents: number /* total = gift + covered */;
      fundName: string; frequency: "once" | "monthly"; livemode: boolean /* false => <TestModeBadge> */ };
```
`confirming` is what `<ReturnPoller>` refreshes while it lasts. Nothing in `ReturnState` is a name, email, address or id.

**The enforced CSP** (one string, production; development differs by `'unsafe-eval'` after `'unsafe-inline'` in `script-src`, nothing else):
```
default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
What it means for the give pages: no Stripe.js and no Stripe iframe (the redirect needs neither); the Turnstile widget is the only third-party script/frame; `connect-src 'self'` (server actions are same-origin); images only from `'self'`, `data:` and the one Google host, so a give page must not embed a cross-origin image; `frame-ancestors 'none'`. `frame-src` includes YouTube/Vimeo only because the string is shared; do not embed video on a give page. **Browser-verify the CSP on the real pages** (a clean console): I could prove the header and a clean dev console on an existing give-path 404 page, but no give page existed to hydrate.

**What the e2e paths do with Stripe unset** (`STRIPE_SECRET_KEY` is never set in the Playwright env; `STRIPE_WEBHOOK_SECRET` is, so the webhook spec runs; `isStripeConfigured()` needs both). The give action writes the intent (`created`), then `fail_intent`, and answers `{ kind: "unavailable" }`; the persisted row is `status = 'failed'` with `fund_id`, `gift_amount_cents`, `total_cents` (= gift unless covering fees), `frequency` — exactly the hydration spec's assertion. `RATE_LIMIT_DISABLED=true` in the Playwright server env bypasses the limiter. Page states for a spec: `live` needs the toggle on + an `active` + public connection (`setConnection`) + an online fund (`offerFundOnline`, 3b); `unavailable` needs additionally a live `organization_sites` row and no live connection; the five return panels are seeded with an intent row carrying a `checkout_session_id` matching `^cs_[A-Za-z0-9_]{8,255}$` (`received` = a succeeded gift for the intent, or `frequency = 'monthly'` with a `subscription_id`; `bank_pending` = a pending gift; `failed` = a failed gift or an intent `failed`/`expired`; otherwise `confirming`).

**Requests that reach the server.** The page must not set any `Host`-derived URL: the return URLs are `NEXT_PUBLIC_APP_URL` + `/site/<slug>/give/return?session_id={CHECKOUT_SESSION_ID}` (member: `/o/<slug>/giving/give/return?...`), cancel `/site/<slug>/give` (member `/o/<slug>/giving/give`). In development with the variable unset the origin falls back to `http://localhost:3000`; in production an unset or non-`https` value makes giving `unavailable`.

### Implementer Notes

**Commands and results** (all in `/Users/cshenso/git/presby-platform/presby-giving`):

| Command | Result |
|---|---|
| `npm run typecheck`; `npm run lint -- --max-warnings=0` | clean |
| `npm run check` (all seven tripwires, incl. `check:audit` and `check:giving-boundaries` B7) | all passed |
| `check:secrets` over every untracked and modified path (22 files, via the exported `checkSecretsPii()`) | 0 findings |
| `npm run test` | 386 files passed, 54 skipped; 5518 tests passed, 1546 skipped |
| DB lane, the files I touch: `give-session.db`, `access`, `sites/ingest/route`, `money.db` (the TS/SQL gross-up grid, unchanged), `giving.db` | 5 files, 96 tests, all passed |
| `npm run test:db` (the whole suite, pipeline branch, serial) | **440 files, 7064 tests, all passed** (was 416 / 6711 after Batch 3a) |
| `npm run build` | exit 0 (dev server stopped first) |
| `next start -p 3100`, `curl -D -` the give paths | production emits `Content-Security-Policy` AND `-Report-Only` on `/site/zzz/give`, `/give/return`, `/o/zzz/giving/give`, and only report-only on `/site/zzz/giver`; **no** `'unsafe-eval'` |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/security-headers.spec.ts e2e/giving-webhook.spec.ts` (dev server, `STRIPE_SECRET_KEY` unset) | **32 passed** (the 11 replay cases and 21 header cases) |

**e2e added to `security-headers.spec.ts` (18 new):** an enforced `Content-Security-Policy` is present and byte-identical to the report-only one on `/site/alder-creek/give`, `.../give/return`, `.../give/return?session_id=...`, an unknown slug's `/give`, `/o/alder-creek/giving/give` and `.../give/return`; ABSENT (with report-only still present) on `/`, `/signin`, `/site/alder-creek`, `/about`, `/about/give`, `/giving`, `/giver`, `/give-now`, `/o/alder-creek/giving`, `/giving/giveaway`, `/admin/giving`; and the enforced string keeps `form-action 'self'`, `frame-ancestors 'none'` and names no Stripe origin (nor does any other response header).

**Failing-first proofs** (mutate one mechanism, run the owning test, record the failing assertion, restore from a backup, re-run green):

| Mechanism broken | Fails |
|---|---|
| a give route dropped from `headers()` / the report-only key used for the give entries / the source widened to `/site/:slug/:path*` | `csp.test.ts` (1 / 2 / 1) |
| a `stripe.com` origin added to `script-src` | `csp.test.ts` "names no Stripe origin" **and**, over HTTP, `security-headers.spec.ts:84` (found for real: my own mutation was still loaded by the dev server; see "Findings") and B7 |
| `'unsafe-eval'` shipped in production | `csp.test.ts` |
| honeypot checked after the limiter | public `actions.test.ts` "a filled honeypot ... spends NO budget" |
| limiter keys swapped / Turnstile before the limiter | public `actions.test.ts` (2 / 4) |
| total taken from the form instead of the database | `give-session.test.ts` (2) |
| no `fail_intent` when Stripe is unset | `give-session.test.ts` |
| repeat key not short-circuited to `already_started` | `give-session.test.ts` |
| a URL handed out after a refused attach | `give-session.test.ts` "never a URL for a dead intent" |
| the origin assertion dropped (a fallback used in production) | `give-session.test.ts` (2) |

The amount cases (`"10.999"`, `"1e3"`, `"-5"`, `"٣٠"`) are asserted in `give-input.test.ts` and in both action tests; `parseAmountToCents` itself is Batch 1's.

**Deviations from the Phase 3 design, each with its reason.**

1. **Honeypot answer is `{ kind: "unavailable" }`.** The design said "fake `unavailable`-shaped success"; `GiveResult` has no success without a URL, so the one arm that reads as a normal refusal is used.
2. **Member action: user + global limiter keys only; no per-site key; no Turnstile.** The brief said "rate-limited by user id". A per-site key shared with anonymous traffic would let a flood of visitors starve the congregation's own members; the global key is shared by necessity (one platform Stripe key). The member form should still carry `_hp` (honoured) and need not render Turnstile.
3. **Member gate failures map to the fixed union.** Signed out or 2FA lapsed → `error` (the person only needs to sign in again; the Edge does it on the next navigation); not a member / ended / forbidden / wrong org type / toggle off → the one `unavailable`; a membership that ended between the resolve and the toggle read → `unavailable`; a database blip in the toggle read → `error`, never a silent "off".
4. **`membership_id` comes from `userOrganizations()`, not `resolved.org`.** `OrgContext` carries no membership id (only `UserOrganization` does). Adding it to `OrgContext` would touch `authz.ts` and every test that `toEqual`s it, so the action reads the viewer's own active row with a second (cheap) query. Suggestion in the open questions.
5. **A repeat key whose session is not attached CONTINUES** (design step 5) using the DATABASE's amounts, but the function's `existing` row does not repeat `frequency` or `method_choice`, so the continued session uses the repeat form's. A form that lied between the two submits could pair a monthly session with a once-intent; that is self-harm only (the donor's own gift) and the webhook still resolves fund and amount from the intent. The Checkout methods for that path come from `readPublicGivingConfig` (a second read on this rare path only).
6. **Attach race returns the URL, not `already_started`.** If `attach_session` refuses because a concurrent submit of the same key attached the (Stripe-idempotent, so identical) session first, the second request already holds that URL and returns `checkout`. If the intent is dead (`failed`/`expired`/older than 15 min) it re-asks, sees no attached session, and answers `error`: a URL is never handed out for a dead intent. A retry after a Stripe failure can therefore create one orphan Checkout session at Stripe for a dead intent (nothing is chargeable until someone opens it, and it expires in 31 minutes).
7. **The database flood cap's `retryAfterSeconds` is a fixed 300.** The function reports the refusal, not a window.
8. **A non-slug-shaped `slug` is `unavailable` before any limiter key is minted** (the in-memory store is bounded but shared). The slug is the URL segment, and a DNS label is the only thing that can be a congregation.
9. **`loadGivingToggle` added to `access.ts`** (additive). `loadGivingContext` returns `forbidden` for a member with no key, which is exactly who may give.
10. **Dev-only `'unsafe-eval'` in the CSP.** Measured, not assumed: with the enforced policy on a give path in `next dev`, React's dev build threw (`eval() is not supported in this environment ... React requires eval() in development`) and Chromium logged some 66 `unsafe-eval` violations; Next's own CSP guide says the same. The keyword is appended in development to the one shared constant, so the report-only and enforced headers stay identical in every mode, and the production build emits neither (proved by `csp.test.ts` and by `next start`). After the change a give path's dev console is clean.
11. **The ingest check lives in a pure module, not `sites.ts`.** `route.test.ts` is a DB-backed harness and other suites mock `@/lib/sites`; a pure `sites-reserved-paths.ts` is importable from the route and from a plain unit test. A bundle ingested BEFORE this change that already holds a `/give` page is unaffected (shadowed, as before); only new ingests are refused.

**Findings.**
- **`check:giving-boundaries` B7 can be blinded by an unrelated string literal.** B7 finds a CSP by pairing quote characters with a regex over `next.config.ts`. A bare string that contains a single quote and no directive name (my first draft's `" 'unsafe-eval'"`) desynchronised the pairing, so a `stripe.com` added to `script-src` was NOT reported (the committed file is correct; I proved it with a mutation before and after). `next.config.ts` is shaped around the defect now (both policy literals name `script-src`, with a comment saying why). A real tokenizer for B7 is a small follow-up worth taking (TODO line suggested; I did not edit the shared file).
- **A dev server reloads `next.config.ts` mid-run.** A temporary mutation to prove a test fails was picked up by the running dev server and the next e2e run caught it (header test 84 red). Restart the server after any config edit (recorded in `docs/testing.md`).

**What is blocked on the operator (Operator Q1: no test-mode Stripe platform account).** Unverified, not failing: that Checkout accepts the session as built (`allowed_payment_method_types`, the 31-minute `expires_at`, `{CHECKOUT_SESSION_ID}` in `success_url`), the real hosted-Checkout redirect, the return page's `confirming` → `received` transition on a real webhook, and the enforced CSP in a browser on real give pages. Runbook: `docs/deployment.md` → "Operator test-mode smoke" step 8 (new) and the go-live checklist.

### Open questions for the orchestrator

1. **`OrgContext` has no `membershipId`** (deviation 4). Optional follow-up: add it to `OrgContext` in `authz.ts` (and the tests that `toEqual` it) so member actions do not re-read `userOrganizations()`. Not needed for correctness.
2. **Optional 0055 tightening (database-admin):** make `presby_giving__create_intent` return `frequency` and `method_choice` on an `existing` row (deviation 5), so a continued session can never differ from its intent. Self-harm only today.
3. **B7 hardening** (Findings): replace the quote-pairing regex with a tokenizer, with a fixture for "a single-quote-bearing literal before the CSP". Suggest a `docs/TODO.md` line; the file is Rule 16's.
4. **Go-live items already on the list and now load-bearing:** Upstash (the in-memory limiter is per serverless instance; the DB flood cap is the only infrastructure-independent backstop), `NEXT_PUBLIC_APP_URL`, and Turnstile keys for the public form.

### Handoff

Next agent: **ux-developer (Batch 4b)** — `GiveForm` (public and member), `/site/[slug]/give` and `give/return` pages, `/o/[slug]/giving/give` and `give/return`, the `giving` live slot, the return panels and `<ReturnPoller>`, `giving-unavailable-notice.tsx`, and the hydration/page-state/e2e specs, all from the "Contract for 4b" above. The CSP is already served; 4b's job is to browser-verify it on the real pages at 360 px.


## Batch 4b — give form, pages, live slot, return panels (ux-developer)

*2026-10-16, ux-developer, worktree `presby-giving` on `pipeline/online-giving`, Neon branch `br-winter-band-axb6tzax`. Nothing committed. No Rule 16 shared file edited. No schema change, no new dependency, no new route handler. No Stripe account, no Stripe key, no Stripe.js, no iframe: the only third-party origin on any give page is the Turnstile widget (and only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set). Own dev server on 3100 (started and stopped by PID, twice: once for development, once restarted after `npm run build`); the demo server on 3000 (PID 15271) was never touched; the prod lane used 3800 and left nothing listening.*

### Files Created

**Components — `src/components/giving/`**
- `give-form.tsx` (client; `useForm` + `<HydrationGate>`) - the one form for the public page, the live slot and the member page (`mode="public" | "member"`; member renders no Turnstile). Preset chips ($25/$50/$100/$250, fill the amount), "Amount (US dollars)" text input with `inputMode="decimal"` (the "other"), fund select (hidden when one fund, hidden input still sends `fundId`), once/monthly radios, cover-fees checkbox (default off) that reveals card/bank (only when both are enabled) and a live `gift + fees = total` line from `grossUp()` with the org's own rates (display only, `role="status"`), Turnstile (`key`-ed so a fresh widget follows every non-checkout result), honeypot `_hp`, hidden `idempotencyKey`, "Give", pending relabel "Starting your gift…", gift-only and processing disclosures, the monthly stop note once monthly is chosen, the church phone line, and the donor-worded test-mode notice. Builds its `FormData` explicitly from the contract field names (never a total; `coverFees` is `on` or absent; `method` is `either` only when both methods are enabled and fees are not being covered). Re-keys with `crypto.randomUUID()` in the result handler after every result except `checkout` and `already_started`. `checkout` is asserted with `isCheckoutUrl(url)` AND `new URL(url).origin === "https://checkout.stripe.com"` before `window.location.assign`; anything else is the generic error plus a fresh attempt. A `pageshow` (bfcache) handler un-sticks a form the donor returns to with Stripe's back button.
- `give-return-panel.tsx` (server) - the five panels plus `error`; `return-poller.tsx` (client; 6 x 5 s `router.refresh()`, then "Still confirming…", timer in a ref so a re-render cannot restart it); `giving-unavailable-notice.tsx` (shared with the slot; `headingLevel` 1 or 2); `contact-line.tsx` (the church phone as a `tel:` link only when it is phone-shaped).
- Tests beside each: `give-form.test.tsx` (43), `give-return-panel.test.tsx` (15), `return-poller.test.tsx` (2), `giving-unavailable-notice.test.tsx` (4).

**Pages**
- `src/app/(public)/site/[slug]/give/page.tsx` (+ `page.test.tsx`, 9) and `give/return/page.tsx` (+ test, 7). Give: `force-dynamic` (a per-request idempotency key must never be cached and shared), `cache()`d config read, `absent` -> `notFound()`, `unavailable` -> notice, `live` -> form. Return: `noindex, nofollow`, `referrer: no-referrer`, reads no organization at all (its markup does not depend on whether the slug is a tenant), a missing or repeated `session_id` is `unknown` with no database call. No `loading.tsx` on either.
- `src/app/(org)/o/[slug]/giving/give/page.tsx` (+ test, 11) and `give/return/page.tsx` (+ test, 6). Full `(org)` pattern in the page: `cachedAuth` -> `resolveOrgContext` four-way -> `assertOrgAccess` -> `loadGivingToggle` (member give only; the return page deliberately does NOT read the toggle, so turning it off cannot strand a donor mid-gift). No giving permission is checked anywhere.
- `src/app/(public)/site/[slug]/public-giving-slot.tsx` (+ test, 11) - the `giving` slot; wired as `giving: (filter) => <PublicGivingSlot slug={slug} filter={filter} />` in `[[...path]]/page.tsx` (closes over `slug` only); `filter.fund` honoured only when it is one of the org's online funds; ids namespaced (`slot-give-*`).

**Specs**
- `e2e/giving-public.spec.ts` (22 tests), `e2e/hydration/giving-give-form.spec.ts` (1, both lanes).

### Files Modified
- `src/lib/giving/giving-copy.ts` (+ `giving-copy.test.ts`, +5): `GIVE_PAGE`, `TEST_MODE_DONOR_DETAIL`, `GIVING_UNAVAILABLE`, `RETURN_PANELS`, `RETURN_COPY`, `giveHeading`, `feePreviewText`, `returnGiftLine`, all added to `allGivingCopy()` (so the forbidden-word walk covers them).
- `src/components/giving/test-mode-badge.tsx`: optional `detail` prop (the default still speaks to the treasurer; the give page passes the donor's wording).
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx` + `page.test.tsx` (the exact-slot-set assertion is now `committeeDirectory, giving, staffDirectory`, plus a case that the `giving` resolver closes over the page's slug).
- `e2e/support/giving-fixture.ts`: `offerFundOnline(..., which)` (a second online fund with its own display name), `addLiveSite`/`removeSite` (live `organization_sites` row, optional staged bundle), `seedReturnIntent`, `latestIntents`.

### Schema Changes / Audit Events
None. Starting a gift is `audit-exempt` (4a); the new pages and the form write nothing themselves.

### Commands and results (all in `/Users/cshenso/git/presby-platform/presby-giving`)

| Command | Result |
|---|---|
| `npm run typecheck`; `npm run lint -- --max-warnings=0` | clean |
| `npm run check` (all seven tripwires) | passed. `check:brand-scope` C2 caught three button-shaped class strings in my first return panel; replaced with `<Button asChild>` |
| `check:secrets` over the 27 new and modified `.ts/.tsx/.md` paths (`checkSecretsPii`) | first pass: 8 soft findings (phones outside the 555-01xx convention in my tests); fixed to `614-555-01xx`; re-run: 0 findings |
| `npm run test` | 395 files passed, 54 skipped; 5633 tests passed, 1546 skipped |
| DB-backed lane | not run: Batch 4b touches no DB-backed module (`giving-copy`, `test-mode-badge` and components are pure; no `src/lib/giving` query module changed). The page-to-database path is exercised by the e2e below against the real functions |
| `npm run build` (dev server stopped first) | exit 0; `/site/[slug]/give` and `/site/[slug]/give/return` listed dynamic |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/giving-public.spec.ts e2e/hydration/giving-give-form.spec.ts` (dev server started with `RATE_LIMIT_DISABLED`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`; `STRIPE_SECRET_KEY` unset) | 23 passed |
| `E2E_BASE_URL=http://localhost:3100 npx playwright test` (whole suite) | **289 passed (9.1 min)** |
| `npm run test:e2e:prod` (`next build && next start` on 3800) | **6 passed**, including `giving-give-form.spec.ts` under the enforced CSP on a production build |
| Fixture cleanup | `select count(*) from organizations where slug like 'e2e-giving-%'` = 0; no intents left on `alder-creek`; servers stopped, nothing on 3100 or 3800 |

**Failing-first proofs** (mutate one mechanism, run the owning test, restore from a backup, re-run green):

| Mechanism broken | Fails |
|---|---|
| the Checkout origin assertion replaced with `allowed = true` | `give-form.test.tsx`: all 8 refusal cases (look-alike `checkout.stripe.com.evil.example`, `evilcheckout.stripe.com`, userinfo, port, `http:`, `javascript:`, nested, empty) |
| no re-key after `unavailable` | `give-form.test.tsx` "unavailable: ... the NEXT submit carries a fresh key" |
| `<HydrationGate>` removed from `give-form.tsx` (negative control) | `e2e/hydration/giving-give-form.spec.ts` red at the first `aria-busy="true"` assertion (dev lane); restored, green in both lanes |
| the `ReturnPoller` timer tied to router identity | `return-poller.test.tsx` (found for real: the first draft restarted its interval after "spent"; fixed with a ref) |

### Browser verification (phone viewport, screenshots read)
- 360 px, Chromium: `/site/alder-creek/give` (live, test mode, cover-fees ticked with the preview), the fixture's unavailable page, the slot on a staged site page, and every return panel (`confirming`, `received` monthly, `bank_pending`, `failed`, `unknown`). No sideways scroll on any (asserted in the spec), every form button, checkbox/radio label and select at least 40 px tall (the amount input is `min-h-11`). Screenshots: `test-results/giving-public-360/` (gitignored).
- **Enforced CSP on the real pages**: the give page and every return panel return `content-security-policy` and a console with zero errors or violations (asserted in the spec, dev lane; the production build ran the same page under the policy in the prod lane and hydrated). The slot page carries only the report-only policy (by design) and its console is clean too. No script, iframe or response header names a Stripe origin.

### Deviations from the design, each with its reason
1. **Toggle-off with a live public site is `unavailable`, not `absent`.** The database function returns `absent` for a toggle-off org only when it has no live site; with a live site it returns `unavailable` (the site is already public, so the notice reveals nothing). The page renders what the function says. The byte-identical `absent` proof (unknown slug, non-tenant presbytery, toggle-off org without a site) compares status, the CSP header and the full markup, with only Next's per-request `__next_r` / `_rsc` tokens masked; a second test pins the with-site behaviour. Tell the analyst: the Phase 3 sentence "toggle-off org renders `absent`" is true only without a live site.
2. **The slot renders the unavailable notice when giving is off (it is only reachable for a live site).** `absent` renders nothing but is effectively unreachable inside a slot (it needs no live site, yet the host page is a live site's page). The notice is more honest than a hole where the author placed a form.
3. **The form builds its `FormData` itself** rather than posting the DOM form, so `method` is computed (`either` / the single enabled method / the explicit card-or-bank when fees are covered) and `coverFees` follows the contract exactly. The hidden `idempotencyKey` input and the honeypot are still real DOM inputs.
4. **Member return page carries the `session_id` through the sign-in callback** so a member who was signed out lands back on the same panel (`/signin` sanitizes the callback to a same-origin path).
5. **The return page shows no organization name and no church phone**, because `ReturnState` carries neither and reading the organization would make the page's markup depend on whether the slug is a tenant. The panels say "contact the church" and link back to the church's site or the portal. If the product wants the phone on a thank-you panel, that needs a field on `presby_giving_return_state` (a 4a/0055 change).
6. **`TestModeBadge` gained a `detail` prop** instead of a second component; the default text is unchanged.
7. **Preset chips are fixed at $25/$50/$100/$250**, not per-congregation. A per-org list is a future setting, not a Batch 4 need.

### UX tradeoffs
- Cover-fees preselects nothing visible until ticked, then defaults the method to Card (the fee preview needs one; the donor can switch to Bank account and the preview recomputes).
- "Still confirming" after 30 s is a calm statement, not an error: a slow webhook is not a problem.
- The gift-only sentence says "no goods or services in return" and does not use the "intangible religious benefits" phrase; that wording is the CPA question (Operator Q6).

### New copy a fork's branding pass should review
`GIVE_PAGE`, `TEST_MODE_DONOR_DETAIL`, `GIVING_UNAVAILABLE`, `RETURN_PANELS`, `RETURN_COPY` in `src/lib/giving/giving-copy.ts`. Review the `received` panel (receipt versus year-end statement) and the `giftOnly` sentence with the CPA.

### Operator smoke still owed
A real redirect to Hosted Checkout and back (docs/deployment.md, "Operator test-mode smoke", step 8): the `checkout` branch is proven only with a mocked action result and the origin assertion; the `confirming` -> `received` flip is proven with a gift row seeded directly (the poller picks it up within one 5 s round), not with a real webhook.

### What Batch 5 must know
- Nothing in 4b touches statements. The `received` panel promises only that the year-end statement is "separate" and "comes after the year ends"; it does not promise a month or that statements are enabled (they stay disabled in production until Operator Q6).
- `giving-fixture.ts` gained `seedReturnIntent` and `addLiveSite`; gifts and reversals are append-only and delete-guarded, so a spec that seeds a gift must remove the whole fixture organization (as `removeGivingFixture` does) and must NOT call `setConnection(sql, fx, null)` afterwards (`clearConnections` deletes intents, which the gift FK refuses).
- The give routes are `force-dynamic` on purpose; do not add `generateStaticParams` or a cache to them.
- Open items already on the list and now load-bearing: Upstash, `NEXT_PUBLIC_APP_URL` (an unset or non-https value makes giving `unavailable` in production), Turnstile keys for the public form, and the B7 tokenizer follow-up from 4a.

### Handoff
Next: **Batch 5, database-admin (5a: `0056`) then full-stack-developer (5b)**, per the Implementation Order. Phase 5 (qa) follows Batch 6 for the whole pipeline, or per batch if the orchestrator runs it that way; QA for Batch 4 should run `e2e/giving-public.spec.ts` and `e2e/hydration/giving-give-form.spec.ts` (both lanes) and re-read the negative control above.


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

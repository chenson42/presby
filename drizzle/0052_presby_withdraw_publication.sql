-- Withdrawing a published statistical return: the sanctioned pair writer
-- drizzle/0047 named but deliberately did not build
-- (docs/work-log/2026-09-26-withdraw-publication.md, Phase 3 Data Model;
-- DECISION-152; F52/F56/DECISION-140/DECISION-141;
-- docs/schema-design-2.md sec 2f-2g).
--
-- WHAT SHIPPED BEFORE THIS FILE, AND WHY NOTHING COULD WITHDRAW ANYTHING.
-- drizzle/0047 added `publications.withdrawn_at/withdrawn_by/
-- withdrawn_minute_reference` and `congregation_statistics.withdrawn_at`,
-- taught BOTH freeze triggers to permit exactly one withdrawal transition
-- each, and gated both on ONE unshared transaction-local marker,
-- `presby.withdrawal_write_active` — which nothing in the database armed.
-- That was deliberate ("the schema ships ahead of its writer"), and it is
-- what this file supplies: one SECURITY DEFINER function that arms the
-- marker once, writes BOTH halves of the pair with ONE timestamp, and
-- disarms. It adds no column, no index, no table and — this is the load-
-- bearing negative — NO GRANT of any kind on either table or on any of the
-- four withdrawal columns.
--
-- APPLY (owner, direct/unpooled endpoint — `db:generate` emits none of this):
--   psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f drizzle/0052_presby_withdraw_publication.sql
--
-- IDEMPOTENT, whole file: `create or replace function` throughout, revokes
-- and grants that are no-ops when already in force, `comment on` which is a
-- pure overwrite, and two `insert ... on conflict (…) do nothing` seeds.
-- Applied twice end to end during Phase 4 Batch A; both runs exit 0 and the
-- second changes no row.
--
--
-- THE FIVE THINGS THAT NEED EXPLAINING, stated here rather than left for a
-- reviewer to reconstruct (this codebase's own discipline: name every
-- deviation and every "why not the obvious alternative").
--
-- (1) WHY THE REFUSAL VOCABULARY IS SPLIT — uniform for identity, honest for
--     state (DECISION-152). Steps 1-3 below all raise ONE literal through
--     presby_deny_publication_withdrawal(): "no org context", "no such
--     publication", "that publication belongs to another council", "that is
--     not a statistical return" and "that user is not an active member
--     here" are each, on their own, an EXISTENCE ORACLE — the thing F40's
--     one-claim-one-literal rule exists to close. Steps 4a and 4b raise
--     DISTINCT, honest messages, and the test for why that is safe is
--     presby_freeze_publication()'s own: "every branch of this function is
--     reachable only by someone who already holds the row." By step 4 the
--     caller has proven organization_id = presby_current_org(), so it can
--     already SELECT withdrawn_at and the supersession chain off
--     `publications` under its own tenant_isolation policy. A distinct
--     message there discloses nothing the caller could not otherwise read;
--     a uniform one would only make a legitimate clerk's UI lie about why
--     the button did nothing.
--
-- (2) WHY THERE IS NO ORGANIZATION PARAMETER. The confused-deputy shape,
--     with two precedents in this same subsystem: presby_transfer_
--     affiliation() (drizzle/0044) and presby_write_return_publication_
--     chain() (drizzle/0049) both derive the acting council from
--     presby_current_org() and expose no parameter through which a caller
--     could name another. withOrgContext() has already verified membership
--     BEFORE the GUC was set, so the GUC is a verified claim, not an input.
--     An org parameter here would be that verification deleted.
--
-- (3) WHY p_withdrawn_by IS ACCEPTED AT ALL, AND BOUNDED RATHER THAN
--     REFUSED. presby_transfer_affiliation() refuses a caller-supplied user
--     id outright and writes closed_by = null; this function cannot, because
--     `publications_withdrawal_shape` (drizzle/0047) requires all THREE
--     withdrawal columns or none — a null withdrawn_by is not a legal row,
--     so there is nothing to write instead of the claim. The claim is
--     therefore CONSTRAINED instead: step 3 refuses any p_withdrawn_by that
--     is not an active member of the acting council. That converts an
--     unbounded identity claim into a same-tenant, active-member one, cross-
--     checkable against the audit event's independently recorded actor. The
--     application binds it server-side from the session
--     (setCongregationStatistics()'s actingUserId precedent) and never from
--     client input; this check is the database's own half of that, because
--     DECISION-141's principle is that the boundary is a database property,
--     not a wrapper convention. The residual — misattribution to a colleague
--     of the same congregation — is bounded and named, not closed.
--
-- (4) WHY THE DISARM CALL EXISTS EVEN THOUGH TRANSACTION SEMANTICS DO NOT
--     REQUIRE IT. `set_config(..., true)` is transaction-local: it reverts
--     at commit or rollback with no action, which is exactly what
--     presby_publish_sasr_snapshot() and presby_write_return_publication_
--     chain() rely on today — neither disarms. This function disarms anyway,
--     as an explicit Phase 2 structural requirement (architect item 5): the
--     marker's window is narrowed to the two statements that need it, so a
--     future edit that appends another write to the end of this function
--     does not silently inherit the armed state.
--
-- (5) WHY THE NEW TEMPLATE ROLE IS NOT BACKFILLED. Section 3 CREATES the
--     congregation `stated_clerk` template (it did not exist — verified in
--     the live catalog, not read off drizzle/: app_roles where
--     organization_id is null held exactly committee_chair, presbytery_
--     stated_clerk and personnel_admin) and binds `statistics.publish` to
--     it. It touches no tenant's own app_role_permissions. A migration that
--     added a tier-2 permission to a live tenant's existing role would be
--     the PLATFORM granting ECCLESIASTICAL authority the tenant's own
--     roles.manage act never granted — the Two Hierarchies line. It is also
--     the precedent already set: drizzle/0037 bound credentials.manage to
--     the presbytery template with no backfill for presbyteries that had
--     already adopted. Adoption mints an org-owned copy at adopt time
--     (listTemplateRoles/adoptTemplate, /admin/roles/new); nothing needs
--     rewriting for that to work.

-- ---------------------------------------------------------------------------
-- 1. presby_deny_publication_withdrawal() — the ONE uniform literal
--    (F40 / DECISION-139's discipline, applied to the withdrawal path)
-- ---------------------------------------------------------------------------
-- presby_deny_affiliation_change()'s shape (drizzle/0044 section 9): a void
-- helper called from every identity-class refusal, so the string cannot
-- drift into three near-identical near-copies and so `grep` finds every site
-- that can raise it. It interpolates NOTHING — an id in the message would
-- re-open the oracle the single literal closes.
--
-- NOT reused for the two state-class refusals in section 2 (already
-- withdrawn, superseded); see header note (1).
--
-- SECURITY INVOKER, and no search_path pin, deliberately: it reads no
-- relation and holds no privilege, so there is nothing for a caller's
-- pg_temp schema to shadow and no owner privilege to escalate into. Same
-- ruling as DECISION-121's three GUC-only guards.
create or replace function presby_deny_publication_withdrawal()
returns void language plpgsql as $$
begin
  raise exception 'publications: this withdrawal is not permitted'
    using errcode = 'insufficient_privilege';
end $$;

revoke all on function presby_deny_publication_withdrawal() from public;
grant execute on function presby_deny_publication_withdrawal() to presby_app, presby_platform;
-- presby_app KEEPS execute, unlike presby_deny_affiliation_change() which
-- B-M1 revoked (drizzle/0044). The rule B-M1 actually states is "a function
-- that only ever runs INSIDE another function or a trigger needs no grant",
-- and the enumeration here reaches the opposite answer for the same reason
-- presby_deny_publication_write() keeps its grant (drizzle/0046 section 4b):
-- the day a real, non-owner presby_app login exists, a call that raises this
-- table's own literal must raise THAT literal, not "permission denied for
-- function presby_deny_publication_withdrawal" — which would be a second,
-- distinguishable refusal string and so a hole in the single-literal
-- discipline the helper exists to enforce.

-- ---------------------------------------------------------------------------
-- 2. presby_withdraw_publication() — the sanctioned pair writer
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, and it must be: `publications` and
-- `congregation_statistics` are both FORCE ROW LEVEL SECURITY, the two rows
-- of the pair live in DIFFERENT tenants (the publication belongs to the
-- congregation, its projection to the recipient presbytery), and no single
-- app.current_org_id value satisfies both policies. The function runs as
-- neondb_owner, which is rolbypassrls (F44, measured on this branch), so RLS
-- gives it NO safety net at all. The `organization_id = v_actor` test in
-- step 2 and the `about_org_id = v_actor` predicate in step 6 are therefore
-- the ONLY tenancy boundary in this function. Neither is redundant with the
-- other and neither may be simplified away.
--
-- search_path = public, pg_temp — pg_temp named explicitly and LAST
-- (DECISION-148 / F60): an unqualified search_path searches the caller's
-- temp namespace FIRST, so a caller holding TEMP could shadow `publications`
-- or `people` with its own table and watch this function read it as the
-- owner.
create or replace function presby_withdraw_publication(
  p_publication_id uuid,
  p_withdrawn_by uuid,
  p_minute_reference text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor        uuid := presby_current_org();
  v_org          uuid;
  v_record_class text;
  v_withdrawn_at timestamptz;
  v_now          timestamptz := now();
  v_rows         integer;
begin
  -- Step 1 — no context, no standing. (The anonymous grant-submission path
  -- deliberately sets no org GUC, so it lands here: a token authorizes ONE
  -- write of one return, never the retraction of a council's act.)
  if v_actor is null then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 2 — lookup + ownership + record class, ALL in the uniform arm.
  -- Not found, wrong owning council and wrong record class are
  -- indistinguishable to the caller by design (F40): each is "you may not
  -- withdraw this." This is also where the unmanaged/invited congregation's
  -- grant-submitted return closes BY CONSTRUCTION rather than by a rule
  -- someone has to remember — no session ever resolves to such an org, so
  -- presby_current_org() can never equal its id, so its publications are
  -- unreachable here for every caller including its own presbytery
  -- (Phase 1 Flow 3; the presbytery's remedy stays a presbytery_entered
  -- correction under its own provenance and its own minute, F39).
  select organization_id, record_class, withdrawn_at
    into v_org, v_record_class, v_withdrawn_at
    from publications
   where id = p_publication_id;

  if v_org is null
     or v_org is distinct from v_actor
     or v_record_class is distinct from 'statistical_return'
  then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 3 — p_withdrawn_by must be an ACTIVE MEMBER of the acting council.
  -- Also the uniform arm: "that person is not a member here" is a
  -- same-tenant person-existence oracle in miniature (DECISION-152). See
  -- header note (3) for why the claim is bounded rather than refused.
  --
  -- CORRECTED AGAINST THE LIVE CATALOG, 2026-09-26 (Phase 4 Batch A). The
  -- Phase 2/3 design wrote this as `pe.organization_id = v_actor` — and
  -- `people` HAS NO organization_id column. A person is scoped to an
  -- organization by `memberships` (that is exactly what the table's own RLS
  -- policies test: `exists (select 1 from memberships m where m.person_id =
  -- people.id and m.organization_id = presby_current_org())`), so the
  -- org-scoping half of this claim is carried by
  -- presby_membership_is_active(), which asks precisely "is there a
  -- memberships row for this person at this organization with ended_on
  -- null". plpgsql does not resolve column references at CREATE time, so
  -- the design's spelling would have compiled cleanly and failed at the
  -- first call — on the one branch the whole check exists to close.
  --
  -- presby_membership_is_active() is itself SECURITY DEFINER (drizzle/0015,
  -- F26): `memberships` is FORCE RLS on presby_current_org(), and this
  -- function's own GUC names the acting council, so an INVOKER read would
  -- answer correctly here by accident and wrongly the moment the predicate
  -- is reused. Leave the call as the single source of "active member".
  if not exists (
    select 1 from people pe
     where pe.user_id = p_withdrawn_by
       and presby_membership_is_active(pe.id, v_actor)
  ) then
    perform presby_deny_publication_withdrawal();
  end if;

  -- Step 4 — STATE checks, only now, each with its own honest message
  -- (check_violation). The caller has already proven it owns this row and
  -- can read both of these facts under its own policy; see header note (1).
  if v_withdrawn_at is not null then
    raise exception
      'publications: this filing was already withdrawn at %', v_withdrawn_at
      using errcode = 'check_violation';
  end if;

  -- Only the CURRENT head may be withdrawn (orchestrator ruling 4). A direct
  -- child test is exact rather than approximate because the chain cannot
  -- fork — publications_supersedes_once_idx (drizzle/0047 section 5) is a
  -- partial UNIQUE on supersedes_id — and because the chain writer only ever
  -- links to the most recent NON-WITHDRAWN publication for the year
  -- (drizzle/0049 section 3).
  if exists (select 1 from publications where supersedes_id = p_publication_id) then
    raise exception
      'publications: a later filing supersedes this one; only the current filing may be withdrawn'
      using errcode = 'check_violation';
  end if;

  -- Step 5 — arm, now that every check has passed. A call that will be
  -- refused arms nothing (the chain writer's own rule, drizzle/0049 section
  -- 3). Transaction-local, never session-scoped: the pooled neon-serverless
  -- connection is reused by the next unrelated request.
  --
  -- THIS IS THE ONLY SITE IN THE DATABASE THAT ARMS
  -- presby.withdrawal_write_active — the property scripts/test-rls.sql
  -- section 41 pins with an exact count, and the one section 35's
  -- placeholder assertion used to pin at zero (F90).
  perform set_config('presby.withdrawal_write_active', 'true', true);

  -- Step 6 — the pair, ONE v_now written to both halves so the two
  -- timestamps are exactly equal rather than approximately so (drizzle/0049's
  -- F39-exactness precedent, the same reason the publish chain writes one
  -- v_now to the publication and its projection).
  --
  -- The publication's triple only: presby_freeze_publication() rejects any
  -- UPDATE in which anything else on the row moves.
  update publications
     set withdrawn_at = v_now,
         withdrawn_by = p_withdrawn_by,
         withdrawn_minute_reference = p_minute_reference
   where id = p_publication_id;

  -- The projection's single column only: presby_reject_published_statistics_
  -- write() compares `to_jsonb(old) - 'withdrawn_at'` and refuses if
  -- anything else differs. Scoped by about_org_id = v_actor as well as by
  -- publication_id — see the SECURITY DEFINER note above: this predicate is
  -- half of the function's entire tenancy boundary, not a belt-and-braces
  -- restatement of the FK.
  update congregation_statistics
     set withdrawn_at = v_now
   where publication_id = p_publication_id
     and about_org_id = v_actor;
  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    -- NOT a user-facing state. Zero or many projection rows for one
    -- publication means the pair was already inconsistent before this call
    -- (F39 violated upstream), and half-applying a withdrawal on top of that
    -- would make it worse. Raised rather than translated into a friendly
    -- FilingsResult kind — src/types/actions.ts's own "truly unexpected
    -- errors may throw" contract — because it is a bug signal, not a state a
    -- congregation's clerk caused or can act on.
    raise exception
      'publications: the withdrawal pair could not be applied consistently for % (% projection row(s) matched)',
      p_publication_id, v_rows
      using errcode = 'data_exception';
  end if;

  -- Step 7 — disarm; see header note (4) for why this is here at all.
  perform set_config('presby.withdrawal_write_active', 'false', true);

  return p_publication_id;
end $$;

revoke all on function presby_withdraw_publication(uuid, uuid, text) from public;
revoke execute on function presby_withdraw_publication(uuid, uuid, text) from presby_platform;
grant execute on function presby_withdraw_publication(uuid, uuid, text) to presby_app;
-- presby_platform is revoked for the same reason it holds SELECT and nothing
-- else on `publications` (drizzle/0049's narrowing): a platform-shell
-- connection reading across every tenant may never perform a council's act.
--
-- AND NO GRANT OF ANY KIND, HERE OR ANYWHERE ELSE IN THIS FILE, ON
-- publications.withdrawn_at / withdrawn_by / withdrawn_minute_reference OR
-- congregation_statistics.withdrawn_at / publication_id. That absence is the
-- mechanism, not an omission (DECISION-141): the GUC is a workflow marker any
-- role can set, the GRANT is the privilege, and this function — running as
-- the owner, which no grant binds — is the only path to either column. A
-- grant on those columns appearing in a future diff is the specific failure
-- mode scripts/test-rls.sql section 35(e) and section 41 both watch for.

comment on function presby_withdraw_publication(uuid, uuid, text) is
  'The sanctioned withdrawal writer named but deliberately not built in drizzle/0047 (F56 / DECISION-141). Confused-deputy shape: no organization parameter, the actor is presby_current_org(). Refuses with ONE uniform literal (insufficient_privilege, via presby_deny_publication_withdrawal()) when there is no org context, the publication does not exist, it belongs to another council, it is not a statistical_return, or p_withdrawn_by is not an active member of the acting council; refuses with distinct, honest check_violation messages when the filing is already withdrawn or is superseded by a later one. Arms presby.withdrawal_write_active only after every check passes — the only site in the database that arms it — writes publications'' withdrawal triple and congregation_statistics.withdrawn_at with ONE shared timestamp, asserts exactly one projection row matched, disarms, and returns the publication id. No transaction control: it runs inside the caller''s transaction, so the pair is atomic by construction. DECISION-152.';

-- ---------------------------------------------------------------------------
-- 3. The congregation `stated_clerk` TEMPLATE role (Two Hierarchies — no
--    backfill; see header note (5))
-- ---------------------------------------------------------------------------
-- drizzle/0037 section 4's exact shape, one axis over: organization_id IS
-- NULL and organization_type_scope = 'congregation' (0037's was
-- 'presbytery'). Readable by every tenant through the widened app_roles
-- SELECT policy (drizzle/0032) and adoptable through the already-wired
-- /admin/roles/new UI — no new backend or admin surface.
--
-- The id is PRE-ASSIGNED by the orchestrator under Workflow Rule 16
-- (…0004, the next in the shipped sequence) so a parallel pipeline cannot
-- claim it. `key` is 'congregation_stated_clerk' and not 'stated_clerk':
-- app_roles_org_key is unique on (organization_id, key), and tenants already
-- own roles keyed 'stated_clerk' — but more to the point, 0037 set the
-- convention that a scoped template names its scope
-- ('presbytery_stated_clerk'), and the display `name` is what a clerk
-- actually reads.
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000004', null, 'congregation',
        'congregation_stated_clerk', 'Stated Clerk', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000004', 'statistics.publish')
on conflict (role_id, permission_key) do nothing;

-- KNOWN, PRE-EXISTING, NOT CLOSED HERE: the founding-administrator gap
-- (DECISION-100/101/106). assertPermissionSubset() is a strict subset check
-- with no wildcard exemption, so a congregation where nobody yet holds
-- statistics.publish cannot adopt this template. That is the same standing
-- gap stated_clerk, brand_admin and role_admin all carry; the org_portal.
-- filings flag shipping seeded OFF buys the same time it has always bought,
-- and the real fix belongs to the queued backbone/onboarding pipeline.
-- scripts/seed-dev.sql direct-grants the permission, so local dev and e2e
-- are unaffected.

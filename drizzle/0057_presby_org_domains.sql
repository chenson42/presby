-- drizzle/0057_presby_org_domains.sql
--
-- Custom web domains, Increment 1 (docs/work-log/2026-10-19-custom-domains.md,
-- Phase 3 Data Model "Migration 0057"; Phase 2 R10/R13 and addendum A1-A4;
-- DECISION-178, DECISION-180; findings F150, F152).
--
-- Seven things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, `on conflict do nothing`, drop-then-add,
-- `create or replace`, or revoke-then-grant, so it replays cleanly (including
-- as an in-place correction while this migration is unreleased, CLAUDE.md ->
-- Project Layout -> drizzle/). Proven by applying the whole file twice
-- (work-log, Batch 1a-i).
--
--   1. permission catalog     domains.manage (tier 1, module `domains`)
--   2. founding backfill      domains.manage onto every org-owned
--                             founding_administrator role (F150, R13)
--   3. organization_domains   one row per DNS host (DECISION-180), CHECKs,
--                             indexes incl. the cross-org holding unique
--   4. guards                 BEFORE INSERT (shape + race-safe cap),
--                             BEFORE UPDATE (25 legal edges, immutables,
--                             trigger-stamped timestamps, the trigger-owned
--                             30-day grace, release_cause evidence, the
--                             next_check_at cap), BEFORE DELETE (teardown
--                             cascade only). All three bind the OWNER too
--                             (F44: getPlatformDb() is neondb_owner, which
--                             no grant binds - only triggers do).
--   5. RLS + grants           FORCE, tenant_isolation, column-limited
--                             presby_app grants, no DELETE anywhere
--   6. functions              presby_org_serving_canonical_host (owner only,
--                             THE serving predicate), presby_published_site
--                             re-created with serving_host (F152: ACL and
--                             search_path re-applied), presby_published_site_
--                             by_host, presby_current_org_site_status
--   7. comments
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored. Drizzle mirror: src/lib/db/domain/domains.ts.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No provider call, no audit row: a migration is provisioning. Every
--     runtime state change writes exactly one audit_events row through
--     src/lib/domains/service.ts transitionDomain() (Batch 1a-ii, R8).
--   * No org toggle row. org_portal.domains / org_portal.mail_domain default
--     OFF and are flipped by a platform admin only (operator ruling Q1). The
--     toggle catalog is TypeScript (ORG_FEATURE_CATALOG, Batch 1a-ii):
--     organization_feature_toggles.feature_key carries no CHECK (0026).
--   * presby_public_staff_roster / presby_public_committee_roster and the
--     giving public-config function stay slug-keyed and untouched (R1).
--   * email_queue is untouched (that is 0058, Increment 2).

-- ---------------------------------------------------------------------------
-- 1. permission catalog
-- ---------------------------------------------------------------------------
-- Tier 1, no constitutional binding (the brand_admin precedent, DECISION-101;
-- DECISION-078 test: domain control is software administration, not a
-- constitutional duty). requires_two_factor is left at its default (false):
-- T7 / TODO S3. The 0030 `on conflict do nothing` form.
insert into permissions (key, module, description, sensitivity_tier)
values ('domains.manage', 'domains',
        'Connect, check and remove this organization''s own web domain (and, later, its email domain)', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. founding_administrator backfill (F150 / R13)
-- ---------------------------------------------------------------------------
-- Under assertPermissionSubset() (F111) a key that nobody at an org holds can
-- never be granted there, so binding domains.manage to a template is not
-- enough: the founding-administrator bundle must deliver it
-- (src/lib/founding-administrator.ts, Batch 1a-ii) and every role designated
-- before this file runs must be topped up here. Production measured 0 such
-- roles on 2026-10-19; development has none either. It exists for whatever
-- is designated before deploy. app_role_permissions_giving_guard ignores a
-- non-giving key.
insert into app_role_permissions (role_id, permission_key)
select r.id, 'domains.manage'
  from app_roles r
 where r.key = 'founding_administrator'
   and r.organization_id is not null
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. organization_domains
-- ---------------------------------------------------------------------------
create table if not exists organization_domains (
  id uuid primary key default gen_random_uuid(),
  -- The cascade is reachable only through D10's guarded fixture teardown
  -- (organizations_guard_delete + deletable_until), exactly as giving_*.
  organization_id uuid not null references organizations(id) on delete cascade,
  purpose text not null default 'web',
  hostname text not null,
  claim_name text not null,
  web_role text,
  state text not null default 'pending',
  state_changed_at timestamptz not null default now(),
  proof_token text not null,
  proof_verified_at timestamptz,
  proof_last_ok_at timestamptz,
  proof_miss_count integer not null default 0,
  probe_miss_count integer not null default 0,
  expires_at timestamptz not null default (now() + interval '7 days'),
  grace_ends_at timestamptz,
  attached_at timestamptz,
  live_at timestamptz,
  platform_hold text,
  hold_reason text,
  force_release_reason text,
  released_at timestamptz,
  release_cause text,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_check_class text,
  observation jsonb not null default '{}'::jsonb,
  provider_challenge jsonb,
  ns_fingerprint text,
  notify_state jsonb not null default '{}'::jsonb,
  created_via text not null,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite Tenant Keys (F2): the target of 0058's
  -- organization_mail_domains (domain_id, organization_id) FK.
  constraint organization_domains_id_org_key unique (id, organization_id)
);

-- CHECKs are drop-then-add (the drizzle/0048 idiom), not inline, so an
-- in-place correction of this unreleased migration actually changes them.

alter table organization_domains drop constraint if exists organization_domains_purpose_allowed;
alter table organization_domains add constraint organization_domains_purpose_allowed
  check (purpose in ('web', 'mail'));

-- Lowercase punycode, at least two labels, each 1-63 of [a-z0-9-] with no
-- leading/trailing hyphen (so no empty label, no trailing dot, no wildcard,
-- no port, no scheme), at most 253 characters, last label not all digits (no
-- IPv4 literal; an IPv6 literal has no dot-separated alnum labels), never
-- *.vercel.app and never localhost. The app's normalizeClaimInput() (Batch
-- 1a-ii, G2) is the real rule set; this is the backstop.
alter table organization_domains drop constraint if exists organization_domains_hostname_shape;
alter table organization_domains add constraint organization_domains_hostname_shape
  check (
    hostname = lower(hostname)
    and char_length(hostname) <= 253
    and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    and hostname !~ '\.[0-9]+$'
    and hostname <> 'vercel.app' and hostname not like '%.vercel.app'
    and hostname not like '%.localhost'
  );

-- The claim name is what the admin typed (punycode); the proof TXT sits at
-- `_presby-challenge.<claim_name>`. Same shape rule, and a host row is either
-- the claim name itself or its www. A proof at N covers N and www.N; a proof
-- at www.N covers only itself (R10).
alter table organization_domains drop constraint if exists organization_domains_claim_name_shape;
alter table organization_domains add constraint organization_domains_claim_name_shape
  check (
    claim_name = lower(claim_name)
    and char_length(claim_name) <= 253
    and claim_name ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    and claim_name !~ '\.[0-9]+$'
    and claim_name <> 'vercel.app' and claim_name not like '%.vercel.app'
    and claim_name not like '%.localhost'
  );

alter table organization_domains drop constraint if exists organization_domains_host_in_claim;
alter table organization_domains add constraint organization_domains_host_in_claim
  check (hostname = claim_name or hostname = 'www.' || claim_name);

alter table organization_domains drop constraint if exists organization_domains_web_role_allowed;
alter table organization_domains add constraint organization_domains_web_role_allowed
  check (web_role in ('canonical', 'alias'));

alter table organization_domains drop constraint if exists organization_domains_web_role_iff_web;
alter table organization_domains add constraint organization_domains_web_role_iff_web
  check ((purpose = 'web') = (web_role is not null));

alter table organization_domains drop constraint if exists organization_domains_state_allowed;
alter table organization_domains add constraint organization_domains_state_allowed
  check (state in ('pending', 'verified', 'attach_pending', 'attached', 'live',
                   'lapsed', 'parked', 'release_pending', 'released', 'expired'));

-- randomBytes(24).toString('base64url') is 32 characters.
alter table organization_domains drop constraint if exists organization_domains_proof_token_shape;
alter table organization_domains add constraint organization_domains_proof_token_shape
  check (proof_token ~ '^[A-Za-z0-9_-]{32,128}$');

alter table organization_domains drop constraint if exists organization_domains_counts_nonnegative;
alter table organization_domains add constraint organization_domains_counts_nonnegative
  check (proof_miss_count >= 0 and probe_miss_count >= 0);

-- T2: pause and dispute are a hold column, not a state. Owner-only (no
-- presby_app grant on any of the three).
alter table organization_domains drop constraint if exists organization_domains_platform_hold_allowed;
alter table organization_domains add constraint organization_domains_platform_hold_allowed
  check (platform_hold in ('paused', 'disputed'));

-- A blank reason is not evidence: force_release_reason non-null is what A2's
-- force_released / evicted causes key on, so it must say something.
alter table organization_domains drop constraint if exists organization_domains_reasons_shape;
alter table organization_domains add constraint organization_domains_reasons_shape
  check (
    (hold_reason is null or char_length(btrim(hold_reason)) between 1 and 500)
    and (force_release_reason is null or char_length(btrim(force_release_reason)) between 1 and 500)
  );

alter table organization_domains drop constraint if exists organization_domains_release_cause_allowed;
alter table organization_domains add constraint organization_domains_release_cause_allowed
  check (release_cause in ('removed', 'lapsed_grace', 'force_released', 'evicted', 'org_closed'));

alter table organization_domains drop constraint if exists organization_domains_last_check_class_allowed;
alter table organization_domains add constraint organization_domains_last_check_class_allowed
  check (last_check_class in ('ok', 'dns_unknown', 'proof_absent', 'routing_wrong', 'held_elsewhere',
                              'provider_unavailable', 'provider_rejected', 'rate_limited', 'config_error'));

alter table organization_domains drop constraint if exists organization_domains_created_via_allowed;
alter table organization_domains add constraint organization_domains_created_via_allowed
  check (created_via in ('tenant', 'platform'));

alter table organization_domains drop constraint if exists organization_domains_jsonb_shape;
alter table organization_domains add constraint organization_domains_jsonb_shape
  check (
    jsonb_typeof(observation) = 'object'
    and jsonb_typeof(notify_state) = 'object'
    and (provider_challenge is null or jsonb_typeof(provider_challenge) in ('object', 'array'))
  );

-- Side conditions (Phase 3): the trigger stamps each of these on its edge, so
-- a row can never sit in a state without the timestamp that got it there.
alter table organization_domains drop constraint if exists organization_domains_verified_stamped;
alter table organization_domains add constraint organization_domains_verified_stamped
  check (state not in ('verified', 'attach_pending', 'attached', 'live') or proof_verified_at is not null);

alter table organization_domains drop constraint if exists organization_domains_attached_stamped;
alter table organization_domains add constraint organization_domains_attached_stamped
  check (state not in ('attached', 'live') or attached_at is not null);

alter table organization_domains drop constraint if exists organization_domains_live_stamped;
alter table organization_domains add constraint organization_domains_live_stamped
  check (state <> 'live' or live_at is not null);

alter table organization_domains drop constraint if exists organization_domains_grace_stamped;
alter table organization_domains add constraint organization_domains_grace_stamped
  check (state not in ('lapsed', 'parked') or grace_ends_at is not null);

alter table organization_domains drop constraint if exists organization_domains_released_stamped;
alter table organization_domains add constraint organization_domains_released_stamped
  check (state <> 'released' or released_at is not null);

alter table organization_domains drop constraint if exists organization_domains_release_has_cause;
alter table organization_domains add constraint organization_domains_release_has_cause
  check (state not in ('release_pending', 'released') or release_cause is not null);

-- Holding states = verified, attach_pending, attached, live, lapsed, parked,
-- release_pending. Non-terminal = everything except expired and released.
--
-- THE cross-org fact (DECISION-180, G3/A12): first to VERIFY wins. A pending
-- claim never conflicts (pre-proof responses are identical to a fresh claim);
-- the loser's pending -> verified UPDATE raises 23505, which the service maps
-- to held_elsewhere naming no org. Per purpose (T3 residual: one org may hold
-- a name for web while another holds it for mail).
create unique index if not exists organization_domains_hostname_holding_uq
  on organization_domains (hostname, purpose)
  where state in ('verified', 'attach_pending', 'attached', 'live', 'lapsed', 'parked', 'release_pending');

create unique index if not exists organization_domains_org_host_uq
  on organization_domains (organization_id, hostname, purpose)
  where state not in ('expired', 'released');

create unique index if not exists organization_domains_one_canonical_uq
  on organization_domains (organization_id)
  where web_role = 'canonical' and state not in ('expired', 'released');

-- The cron's due-row scan (R8, T11).
create index if not exists organization_domains_due_ix
  on organization_domains (next_check_at)
  where state not in ('expired', 'released');

create index if not exists organization_domains_org_ix
  on organization_domains (organization_id, state);

-- ---------------------------------------------------------------------------
-- 4. guards
-- ---------------------------------------------------------------------------
-- All SECURITY INVOKER with a pinned search_path (Phase 3). INVOKER is
-- enough: the insert cap counts only the row's own org (which RLS lets the
-- tenant see, and the owner sees regardless), the org_closed evidence reads
-- `organizations` (no RLS; presby_app holds SELECT), and the delete guard
-- reads `organizations` likewise. No owner privilege is needed or lent.
--
-- Error codes: every refusal by the insert/update guards is check_violation
-- (23514) with an `organization_domains:` message prefix, so a caller (and
-- the tests) can tell a trigger refusal from a grant refusal
-- (insufficient_privilege, 42501). The delete guard raises
-- insufficient_privilege, the house idiom for "this record is permanent".

-- 4a. BEFORE INSERT ----------------------------------------------------------
create or replace function presby_org_domains_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  -- The caps (R10, DECISION-180): 3 non-terminal web hosts, 1 non-terminal
  -- mail row per organization. src/lib/domains/policy.ts mirrors them.
  c_web_cap  constant integer := 3;
  c_mail_cap constant integer := 1;
  v_count integer;
begin
  if new.state is distinct from 'pending' then
    raise exception 'organization_domains: a domain row is created pending (got %)', new.state
      using errcode = 'check_violation';
  end if;
  if new.platform_hold is not null or new.hold_reason is not null
     or new.force_release_reason is not null then
    raise exception 'organization_domains: a domain row is created with no platform hold and no reason'
      using errcode = 'check_violation';
  end if;
  if new.proof_verified_at is not null or new.attached_at is not null or new.live_at is not null
     or new.released_at is not null or new.grace_ends_at is not null or new.release_cause is not null then
    raise exception 'organization_domains: trigger-owned columns are stamped on their edges, never inserted'
      using errcode = 'check_violation';
  end if;
  if new.next_check_at is not null and new.next_check_at > now() + interval '6 hours' then
    raise exception 'organization_domains: next_check_at may be at most 6 hours ahead'
      using errcode = 'check_violation';
  end if;
  new.state_changed_at := now();
  new.updated_at := now();

  -- Race-safe cap without FOR UPDATE on organizations (which presby_app
  -- cannot take): serialize every claim for this org on a transaction-scoped
  -- advisory lock, then count. Under READ COMMITTED the count runs in a fresh
  -- snapshot taken after the lock is held, so it sees the competing
  -- transaction's committed row. It looks at no other org: pending claims
  -- never conflict across orgs and reveal nothing (G3).
  perform pg_advisory_xact_lock(hashtextextended('org_domains:' || new.organization_id::text, 0));
  select count(*) into v_count
    from organization_domains d
   where d.organization_id = new.organization_id
     and d.purpose = new.purpose
     and d.state not in ('expired', 'released');
  if new.purpose = 'web' and v_count >= c_web_cap then
    raise exception 'organization_domains: cap - at most % web hosts per organization', c_web_cap
      using errcode = 'check_violation';
  elsif new.purpose = 'mail' and v_count >= c_mail_cap then
    raise exception 'organization_domains: cap - at most % mail domain per organization', c_mail_cap
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;

-- 4b. BEFORE UPDATE ----------------------------------------------------------
create or replace function presby_org_domains_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  -- A1: THE one definition of the grace period. src/lib/domains/policy.ts's
  -- lapsed and parked grace values are pinned to this literal by a test
  -- (Batch 1a-ii).
  c_grace_period constant interval := interval '30 days';
  -- Suggestion 2 (state-aware): the longest cadence policy.ts assigns each
  -- state. A tenant cannot push next_check_at past these and so cannot
  -- starve the sweeper's lapse detection. Pinned by a test in 1a-ii.
  c_next_check_cap        constant interval := interval '6 hours';
  c_next_check_cap_parked constant interval := interval '24 hours';
  v_scope text;
  v_found boolean := false;
  v_state_change boolean := new.state is distinct from old.state;
  v_exit boolean;
  v_has_reason boolean;
  v_lifecycle text;
  v_cap interval;
begin
  -- Immutable identity, token and provenance columns.
  if (new.id, new.organization_id, new.purpose, new.hostname, new.claim_name, new.proof_token,
      new.expires_at, new.created_at, new.created_by_user_id, new.created_via)
     is distinct from
     (old.id, old.organization_id, old.purpose, old.hostname, old.claim_name, old.proof_token,
      old.expires_at, old.created_at, old.created_by_user_id, old.created_via) then
    raise exception 'organization_domains: identity, token and provenance columns are immutable'
      using errcode = 'check_violation';
  end if;

  -- Terminal rows are frozen: they stay as history and takeover forensics.
  if old.state in ('expired', 'released') then
    raise exception 'organization_domains: a % row is terminal and frozen', old.state
      using errcode = 'check_violation';
  end if;

  -- A1 + suggestion 1: six trigger-owned columns. The writer may not move any
  -- of them, on either connection; the trigger stamps them below. (presby_app
  -- holds no column grant on them at all; this binds the owner.)
  if (new.state_changed_at, new.proof_verified_at, new.attached_at, new.live_at,
      new.released_at, new.grace_ends_at)
     is distinct from
     (old.state_changed_at, old.proof_verified_at, old.attached_at, old.live_at,
      old.released_at, old.grace_ends_at) then
    raise exception 'organization_domains: state_changed_at, proof_verified_at, attached_at, live_at, released_at and grace_ends_at are trigger-owned'
      using errcode = 'check_violation';
  end if;

  -- force_release_reason (owner-only by grant) is evidence: it may be written
  -- only on the force-release edge itself (a state change into
  -- release_pending or released), so a reason left on a live row cannot
  -- later relabel an ordinary removal.
  if new.force_release_reason is distinct from old.force_release_reason
     and not (v_state_change and new.state in ('release_pending', 'released')
              and old.state <> 'release_pending') then
    raise exception 'organization_domains: force_release_reason is written only on a force-release edge'
      using errcode = 'check_violation';
  end if;

  if v_state_change then
    -- BEGIN LEGAL EDGES (25). src/lib/domains/state.ts holds the identical
    -- table keyed by event; a test pins that they agree (Batch 1a-ii). The
    -- third column scopes an edge to one purpose (null = both).
    select e.scope, true into v_scope, v_found
      from (values
        ('pending',         'verified',        null),
        ('pending',         'expired',         null),
        ('pending',         'released',        null),
        ('verified',        'attach_pending',  'web'),
        ('verified',        'lapsed',          null),
        ('verified',        'released',        null),
        ('attach_pending',  'attached',        'web'),
        ('attach_pending',  'lapsed',          'web'),
        ('attach_pending',  'parked',          'web'),
        ('attach_pending',  'release_pending', 'web'),
        ('attached',        'live',            'web'),
        ('attached',        'lapsed',          'web'),
        ('attached',        'parked',          'web'),
        ('attached',        'release_pending', 'web'),
        ('live',            'attached',        'web'),
        ('live',            'lapsed',          'web'),
        ('live',            'parked',          'web'),
        ('live',            'release_pending', 'web'),
        ('lapsed',          'verified',        null),
        ('lapsed',          'parked',          'web'),
        ('lapsed',          'release_pending', 'web'),
        ('lapsed',          'released',        'mail'),
        ('parked',          'verified',        'web'),
        ('parked',          'release_pending', 'web'),
        ('release_pending', 'released',        'web')
      ) as e(from_state, to_state, scope)
     where e.from_state = old.state and e.to_state = new.state
       and (e.scope is null or e.scope = new.purpose);
    -- END LEGAL EDGES
    if not coalesce(v_found, false) then
      raise exception 'organization_domains: % -> % is not a legal edge for a % row',
        old.state, new.state, new.purpose
        using errcode = 'check_violation';
    end if;

    -- Edge side conditions.
    if old.state = 'pending' and new.state = 'expired' and old.expires_at > now() then
      raise exception 'organization_domains: a claim expires only after expires_at'
        using errcode = 'check_violation';
    end if;

    -- release_cause evidence (A2). An exit edge is one whose target is
    -- parked, release_pending or released. The evidence is never
    -- current_user: it is the owner-only force_release_reason, the
    -- trigger-owned grace deadline, and the organization's lifecycle.
    v_exit := new.state in ('parked', 'release_pending', 'released');
    v_has_reason := new.force_release_reason is not null;
    if v_exit then
      if old.state = 'release_pending' then
        -- detach_ok: the cause recorded when the release began is carried.
        if new.release_cause is distinct from old.release_cause then
          raise exception 'organization_domains: release_pending -> released carries its release_cause unchanged'
            using errcode = 'check_violation';
        end if;
      elsif v_has_reason then
        -- A platform force-release or eviction, and only that: a reason on an
        -- exit edge must carry one of the two platform causes, so the
        -- platform's reason cannot be relabelled. Parked is never a
        -- force-release target.
        if new.state = 'parked' or new.release_cause is null
           or new.release_cause not in ('force_released', 'evicted') then
          raise exception 'organization_domains: an exit edge with force_release_reason must carry force_released or evicted, and is never -> parked'
            using errcode = 'check_violation';
        end if;
      elsif new.release_cause in ('force_released', 'evicted') then
        raise exception 'organization_domains: % requires force_release_reason (owner-only)', new.release_cause
          using errcode = 'check_violation';
      elsif new.state = 'release_pending' and old.state in ('attach_pending', 'attached', 'live') then
        -- These three reach release_pending only by force_release.
        raise exception 'organization_domains: % -> release_pending is a force-release and requires force_release_reason', old.state
          using errcode = 'check_violation';
      elsif new.state = 'release_pending' and old.state in ('lapsed', 'parked') then
        -- grace_elapsed: only the clock (the trigger-owned deadline) skips nothing.
        if old.grace_ends_at is null or old.grace_ends_at > now() then
          raise exception 'organization_domains: % -> release_pending before the grace deadline requires force_release_reason', old.state
            using errcode = 'check_violation';
        end if;
        if old.state = 'lapsed' and new.release_cause is distinct from 'lapsed_grace' then
          raise exception 'organization_domains: lapsed -> release_pending by grace carries release_cause lapsed_grace'
            using errcode = 'check_violation';
        end if;
        if old.state = 'parked'
           and (old.release_cause is null or new.release_cause is distinct from old.release_cause) then
          raise exception 'organization_domains: parked -> release_pending by grace carries the cause set when the row was parked'
            using errcode = 'check_violation';
        end if;
      else
        -- The `remove` edge: -> parked (attached or lapsed web rows) or
        -- -> released (pending, verified, or a lapsed mail row).
        if new.release_cause is null or new.release_cause not in ('removed', 'org_closed') then
          raise exception 'organization_domains: a removal carries release_cause removed or org_closed (got %)',
            coalesce(new.release_cause, 'null')
            using errcode = 'check_violation';
        end if;
        if new.release_cause = 'org_closed' then
          select o.lifecycle_status into v_lifecycle
            from organizations o where o.id = new.organization_id;
          if v_lifecycle is null or v_lifecycle = 'active' then
            raise exception 'organization_domains: org_closed requires the organization''s lifecycle_status to be closed'
              using errcode = 'check_violation';
          end if;
        end if;
      end if;
    elsif new.release_cause is distinct from old.release_cause then
      raise exception 'organization_domains: release_cause changes only on an exit edge'
        using errcode = 'check_violation';
    end if;

    -- Stamps (A1, suggestion 1).
    new.state_changed_at := now();
    if new.state = 'verified' then
      new.proof_verified_at := now();
      new.grace_ends_at := null;
      new.release_cause := null;   -- a recovered or reconnected row carries no stale cause
    end if;
    if old.state = 'attach_pending' and new.state = 'attached' then
      new.attached_at := now();
    end if;
    if new.state = 'live' then
      new.live_at := now();
    end if;
    if new.state = 'released' then
      new.released_at := now();
    end if;
    -- A lapsed -> parked removal keeps the running deadline, so removing
    -- cannot extend a grace.
    if new.state in ('lapsed', 'parked') and old.state <> 'lapsed' then
      new.grace_ends_at := now() + c_grace_period;
    end if;
  elsif new.release_cause is distinct from old.release_cause then
    raise exception 'organization_domains: release_cause changes only on an exit edge'
      using errcode = 'check_violation';
  end if;

  -- next_check_at cap (suggestion 2, state-aware), both connections. (The
  -- cap is computed first: plpgsql reads an IF condition up to the first
  -- THEN, which a CASE expression inside it would supply.)
  v_cap := c_next_check_cap;
  if new.state = 'parked' then
    v_cap := c_next_check_cap_parked;
  end if;
  if new.next_check_at is distinct from old.next_check_at and new.next_check_at is not null
     and new.next_check_at > now() + v_cap then
    raise exception 'organization_domains: next_check_at may be at most % ahead in state %',
      v_cap, new.state
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

-- 4c. BEFORE DELETE ----------------------------------------------------------
-- Never Hard-Delete: domain rows are history (released and expired rows stay,
-- for takeover forensics). The one way out is the sanctioned fixture teardown
-- cascade: by the time the RI cascade fires, the parent organizations row is
-- already gone (and organizations_guard_delete only lets that happen for a
-- deletable_until fixture). Same idiom as presby_giving_guard_delete(),
-- written out here so this file does not depend on 0055.
create or replace function presby_org_domains_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if not exists (select 1 from organizations o where o.id = old.organization_id) then
    return old;
  end if;
  raise exception 'organization_domains: domain rows are permanent; release or expire them instead of deleting'
    using errcode = 'insufficient_privilege';
end
$function$;

revoke all on function presby_org_domains_guard_insert() from public, presby_app, presby_platform;
revoke all on function presby_org_domains_guard_update() from public, presby_app, presby_platform;
revoke all on function presby_org_domains_guard_delete() from public, presby_app, presby_platform;

drop trigger if exists organization_domains_guard_insert on organization_domains;
create trigger organization_domains_guard_insert
  before insert on organization_domains
  for each row execute function presby_org_domains_guard_insert();

drop trigger if exists organization_domains_guard_update on organization_domains;
create trigger organization_domains_guard_update
  before update on organization_domains
  for each row execute function presby_org_domains_guard_update();

drop trigger if exists organization_domains_guard_delete on organization_domains;
create trigger organization_domains_guard_delete
  before delete on organization_domains
  for each row execute function presby_org_domains_guard_delete();

-- ---------------------------------------------------------------------------
-- 5. RLS + grants
-- ---------------------------------------------------------------------------
alter table organization_domains enable row level security;
alter table organization_domains force row level security;

drop policy if exists tenant_isolation on organization_domains;
create policy tenant_isolation on organization_domains
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Revoke-then-grant (F38): a re-apply corrects a hand-added grant. REVOKE ALL
-- on a table also revokes every column-level privilege on it, so the column
-- lists below are re-established exactly.
revoke all on organization_domains from public, presby_app, presby_platform;

-- presby_app (T4 as amended by A1): SELECT all; INSERT the tenant-intent
-- columns; UPDATE state and observation columns only. Deliberately absent:
-- hostname, claim_name, proof_token, organization_id, expires_at, created_*
-- (immutable), platform_hold, hold_reason, force_release_reason (owner-only,
-- T2), and the six trigger-owned columns grace_ends_at, state_changed_at,
-- proof_verified_at, attached_at, live_at, released_at (A1, suggestion 1).
-- A BEFORE trigger assigning NEW.x is not subject to the invoker's column
-- privileges (they are checked against the statement's SET/target list), so
-- the stamps still land under presby_app; test-rls-47 (h2) proves it.
-- No DELETE.
grant select on organization_domains to presby_app;
grant insert (organization_id, purpose, hostname, claim_name, web_role, proof_token,
              created_via, created_by_user_id)
  on organization_domains to presby_app;
grant update (web_role, state, proof_last_ok_at, proof_miss_count, probe_miss_count, release_cause,
              next_check_at, last_checked_at, last_check_class, observation, provider_challenge,
              ns_fingerprint, notify_state, updated_at)
  on organization_domains to presby_app;

-- presby_platform: documents intent for the day a real non-owner platform
-- login exists (today getPlatformDb() is neondb_owner, which no grant binds -
-- F44; the guards above are what bind it). Platform writes (cron, pause,
-- force-release, on-behalf claims) are ordinary DML; DELETE never.
grant select, insert, update on organization_domains to presby_platform;

-- ---------------------------------------------------------------------------
-- 6. functions
-- ---------------------------------------------------------------------------
-- All SECURITY DEFINER (F26: the anonymous public path has no org GUC, and
-- organization_sites / organization_feature_toggles / organization_domains
-- are FORCE RLS), `set search_path = public, pg_temp` (F60/F70, pg_temp
-- last), EXECUTE revoked from PUBLIC.

-- 6a. THE serving predicate (DECISION-178). Owner only: no presby_app or
-- presby_platform EXECUTE (R10). Both directions call it - the slug
-- projection (serving_host, for the slug -> custom 307) and the host lookup
-- (presby_published_site_by_host) - so the fail-soft interlock is
-- structural. "Serving" = the org's canonical web host row is live with no
-- platform hold, the org is active, its site is live, and an ENABLED
-- org_portal.domains toggle row exists. The category axis is deliberately
-- absent (R6: a curation preference never takes a site off the internet);
-- the app additionally checks the sites.public_render flag.
create or replace function presby_org_serving_canonical_host(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select d.hostname
    from organization_domains d
    join organizations o on o.id = d.organization_id
    join organization_sites s on s.organization_id = d.organization_id
    join organization_feature_toggles t
      on t.organization_id = d.organization_id
     and t.feature_key = 'org_portal.domains'
     and t.enabled
   where d.organization_id = p_org
     and d.purpose = 'web'
     and d.web_role = 'canonical'
     and d.state = 'live'
     and d.platform_hold is null
     and o.status = 'active'
     and s.status = 'live';
$function$;

revoke all on function presby_org_serving_canonical_host(uuid) from public, presby_app, presby_platform;

-- 6b. presby_published_site(text), widened by ONE trailing OUT column,
-- serving_host. Widening OUT columns needs DROP + CREATE, and a DROP resets
-- the ACL to the PUBLIC-execute default AND loses 0048's search_path pin
-- (F152, the F38 drift class) - so both are re-applied here, inside one
-- transaction, so no caller ever observes the function missing or
-- PUBLIC-executable. The OUT list before serving_host is reproduced from the
-- LIVE definition (pg_get_functiondef on the pipeline branch, 2026-10-19),
-- not from 0024. No dependents: no view, and presby_published_site_by_host
-- below is a string-bodied SQL function (no pg_depend edge).
begin;

drop function if exists presby_published_site(text);

create function presby_published_site(p_slug text)
returns table (
  organization_id uuid,
  organization_name text,
  organization_type text,
  content_bundle_key uuid,
  brand_seed_hex text,
  brand_type_pairing text,
  brand_token_version integer,
  brand_light_only boolean,
  profile_address text,
  profile_phone text,
  profile_facebook_url text,
  profile_instagram_url text,
  profile_x_twitter_url text,
  profile_youtube_url text,
  profile_other_url text,
  service_times jsonb,
  office_hours jsonb,
  serving_host text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version, b.light_only,
         p.address, p.phone, p.facebook_url, p.instagram_url,
         p.x_twitter_url, p.youtube_url, p.other_url,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'service') as service_times,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'office_hours') as office_hours,
         presby_org_serving_canonical_host(o.id) as serving_host
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
    left join organization_profiles p on p.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$function$;

revoke all on function presby_published_site(text) from public, presby_platform;
grant execute on function presby_published_site(text) to presby_app;

comment on function presby_published_site(text) is
  'The ONLY presby_app-reachable read of organization_sites, organization_profiles/organization_service_times (DECISION-092), and organization_brands.light_only (docs/work-log/2026-08-24-light-only-brand.md). Collapses never-provisioned / suspended / nonexistent-slug / org-not-active into the same zero-row result (enumeration-safety, unchanged since 0020). brand_light_only LEFT JOINs in exactly like the other brand_* columns - nullable, so a live site with no organization_brands row returns NULL, which the read path (src/lib/sites.ts) treats the same as false. serving_host (drizzle/0057, DECISION-178) is presby_org_serving_canonical_host(o.id): the live canonical custom host when one is serving, else NULL; the slug URL 307s to it (HTML pages and sitemap only) and is otherwise its own canonical. SECURITY DEFINER for the identical F26 reason as before: the anonymous (public)/site/[slug] page reads through presby_app with NO org GUC set. Re-created by DROP + CREATE in 0057, which resets the ACL and the search_path pin; both are re-applied there and asserted by scripts/domains/test-rls-47.sql (g)/(o) (F152).';

commit;

-- 6c. presby_published_site_by_host(text): host mode's single read (R1).
-- The existing projection plus slug, canonical_host, request_is_canonical -
-- implemented as a thin wrapper over presby_published_site(o.slug), so the
-- projection stays single-sourced (test-rls-47 (o) pins by_host's column
-- list = published_site's + these three). Zero rows unless the requested
-- host's row is a web row, live, with no platform hold, AND the org's
-- canonical host is serving (so an alias can never redirect to a dark host).
-- Every non-serving state - unknown, pending, lapsed, parked, paused,
-- released, toggle off, site not live, org not active - is the same zero-row
-- result with the same read count (DECISION-040, DECISION-176).
--
-- p_host is matched exactly. The app passes requestHost()'s normalized value;
-- the hostname CHECK guarantees stored hosts are lowercase punycode, so a
-- non-normalized input simply misses, indistinguishable from an unknown host.
create or replace function presby_published_site_by_host(p_host text)
returns table (
  organization_id uuid,
  organization_name text,
  organization_type text,
  content_bundle_key uuid,
  brand_seed_hex text,
  brand_type_pairing text,
  brand_token_version integer,
  brand_light_only boolean,
  profile_address text,
  profile_phone text,
  profile_facebook_url text,
  profile_instagram_url text,
  profile_x_twitter_url text,
  profile_youtube_url text,
  profile_other_url text,
  service_times jsonb,
  office_hours jsonb,
  serving_host text,
  slug text,
  canonical_host text,
  request_is_canonical boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select ps.organization_id, ps.organization_name, ps.organization_type,
         ps.content_bundle_key,
         ps.brand_seed_hex, ps.brand_type_pairing, ps.brand_token_version, ps.brand_light_only,
         ps.profile_address, ps.profile_phone, ps.profile_facebook_url, ps.profile_instagram_url,
         ps.profile_x_twitter_url, ps.profile_youtube_url, ps.profile_other_url,
         ps.service_times, ps.office_hours, ps.serving_host,
         o.slug,
         ps.serving_host as canonical_host,
         (d.hostname = ps.serving_host) as request_is_canonical
    from organization_domains d
    join organizations o on o.id = d.organization_id
    cross join lateral presby_published_site(o.slug) ps
   where d.hostname = p_host
     and d.purpose = 'web'
     and d.state = 'live'
     and d.platform_hold is null
     and ps.serving_host is not null;
$function$;

revoke all on function presby_published_site_by_host(text) from public, presby_platform;
grant execute on function presby_published_site_by_host(text) to presby_app;

-- 6d. presby_current_org_site_status() (T12): the caller's OWN
-- organization_sites.status, for the domains page's pre-flight ("your site
-- isn't published yet"). organization_sites has no presby_app grant
-- (DECISION-081). No argument, so it is not an oracle: the org comes from
-- the GUC withOrgContext() set after verifying membership. NULL when no GUC
-- or no site row.
create or replace function presby_current_org_site_status()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select s.status
    from organization_sites s
   where s.organization_id = presby_current_org();
$function$;

revoke all on function presby_current_org_site_status() from public, presby_platform;
grant execute on function presby_current_org_site_status() to presby_app;

-- ---------------------------------------------------------------------------
-- 7. comments
-- ---------------------------------------------------------------------------
comment on table organization_domains is
  'One row per DNS host an organization has claimed (DECISION-180), purpose web or mail. A TXT proof at _presby-challenge.<claim_name> covers claim_name and www.<claim_name>; no provider call precedes proof. Lifecycle pending -> verified -> attach_pending -> attached -> live, plus lapsed, parked, release_pending, released, expired; 25 legal edges enforced by organization_domains_guard_update on EVERY connection (drizzle/0057 section 4b). live is the only serving state. First to verify wins across orgs (organization_domains_hostname_holding_uq). Never deleted (no DELETE grant; organization_domains_guard_delete passes only the fixture-teardown cascade). presby_app holds column-limited grants: state and observation columns are tenant-writable inside the tenant''s own transaction; identity, token, hold and trigger-stamped columns are not. Named residual (A3): because the holding index is global, a tenant-path write into a holding state without real proof denies that name to other orgs; the cure is the platform disputed hold plus force_release. Only src/lib/domains/service.ts writes this table (A4, source-scan pinned).';
comment on column organization_domains.hostname is
  'The DNS host, lowercase punycode (organization_domains_hostname_shape). A lookup key, never an identity, an origin or a redirect target (DECISION-176).';
comment on column organization_domains.claim_name is
  'What the admin typed (punycode). The proof TXT sits at _presby-challenge.<claim_name>; hostname is claim_name or www.<claim_name>.';
comment on column organization_domains.grace_ends_at is
  'Trigger-owned (A1). Stamped now() + 30 days on entering lapsed or parked from any state other than lapsed (lapsed -> parked keeps the running deadline), cleared on entering verified, refused on any other change on either connection. Not in any presby_app grant. The 30-day literal in presby_org_domains_guard_update() is the one definition of the constant.';
comment on column organization_domains.release_cause is
  'Why the row left (A2): removed | lapsed_grace | force_released | evicted | org_closed. Tied to evidence the tenant cannot write, never to current_user: force_released/evicted need the owner-only force_release_reason; lapsed_grace needs an elapsed grace_ends_at; org_closed needs organizations.lifecycle_status <> active. Changes only on an exit edge; cleared on entering verified.';
comment on column organization_domains.platform_hold is
  'Owner-only (T2): paused | disputed. A hold, not a state; the serving predicate requires it null.';
comment on column organization_domains.next_check_at is
  'Cron driver (R8). The sweeper leases a row by bumping it 10 minutes at pick time. Writes are capped by the trigger at now() + 6 hours (24 hours while parked) on either connection, so a tenant cannot starve lapse detection.';
comment on function presby_org_serving_canonical_host(uuid) is
  'THE serving predicate (DECISION-178): the org''s canonical web host iff that row is live with no platform hold, the org is active, its site is live, and an enabled org_portal.domains toggle row exists. Category axis deliberately excluded (R6). Owner only - no presby_app or presby_platform EXECUTE (R10); reached by presby_app only through presby_published_site and presby_published_site_by_host.';
comment on function presby_published_site_by_host(text) is
  'Host mode''s single read (R1, DECISION-176): presby_published_site(slug) of the organization whose live, unheld web row has this exact hostname, plus slug, canonical_host and request_is_canonical - zero rows unless that org''s canonical host is serving. Every non-serving state collapses to the same zero-row result (DECISION-040).';
comment on function presby_current_org_site_status() is
  'organization_sites.status for presby_current_org() only (T12); NULL with no GUC or no site row. No argument, so not an oracle.';

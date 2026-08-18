-- Per-congregation two-factor requirement.
--
-- Until now "is 2FA required?" had exactly two inputs: users.two_factor_required
-- (per person) and the auth.require_2fa feature flag (per INSTALLATION). There
-- was no way for one congregation to require 2FA while another did not, because
-- feature_flags has no organization_id — and it should not grow one. A flag is
-- an environment toggle; a congregation's security policy is tenant state
-- (DECISION-003).
--
-- It lands on organization_settings, not organizations, because org.ts already
-- draws that line: `organizations` is deliberately NOT tenant-isolated (the
-- PC(USA) org tree is public information) and per-org configuration lives in
-- organization_settings. A security policy is configuration.
--
-- A typed column rather than a key in the settings jsonb: this one is read on
-- the sign-in path, and a boolean that decides whether 2FA is enforced should
-- be constrained by the database, not by whatever last wrote the blob.
--
-- Absent settings row = not required, which falls out of the join for free and
-- means every existing congregation keeps today's behavior.

alter table organization_settings
  add column if not exists require_two_factor boolean not null default false;

comment on column organization_settings.require_two_factor is
  'When true, every member of this organization must complete 2FA to sign in. '
  'Resolved at sign-in by presby_two_factor_required() and projected into the '
  'session; the Edge gate reads the session claim, never the database.';

-- ---------------------------------------------------------------------------
-- presby_two_factor_required(user_id)
-- ---------------------------------------------------------------------------
-- "Does any organization this user belongs to require 2FA?"
--
-- SECURITY DEFINER is not optional here, and the reason is finding F26. This
-- runs during sign-in on the RLS-enforced connection, at a moment when NO org
-- context has been set — there cannot be one, because choosing an organization
-- happens after authentication. Read naively, every tenant policy filters the
-- query to zero rows and the function returns false for exactly the users it
-- exists to protect: the ones who belong to a church that requires 2FA. It
-- would fail silently, look like it worked, and quietly disable the feature.
--
-- MOST-RESTRICTIVE WINS. A person can hold memberships in more than one
-- organization — a minister of Word and Sacrament is a member of the presbytery
-- while serving a congregation (G-2.0502). Since the requirement is resolved
-- before any organization is selected, there is no "current org" to consult, so
-- any one requiring org makes the user required.
--
-- Membership predicate matches presby_available_organizations(): ended_on is
-- null (still a member) and the person is not a merge tombstone.
create or replace function presby_two_factor_required(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from people p
      join memberships m           on m.person_id = p.id and m.ended_on is null
      join organization_settings s on s.organization_id = m.organization_id
     where p.user_id = p_user_id
       and p.merged_into_id is null
       and s.require_two_factor
  );
$$;

comment on function presby_two_factor_required(uuid) is
  'True when any organization the user holds an active membership in requires '
  'two-factor authentication. SECURITY DEFINER: runs at sign-in with no org '
  'GUC set, so RLS would otherwise filter it to zero rows (F26).';

revoke all on function presby_two_factor_required(uuid) from public;
grant execute on function presby_two_factor_required(uuid) to presby_app;

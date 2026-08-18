-- The roll read path.
--
-- roll_actions is the record of what the session did. Everything else about
-- membership is derived from it:
--
--   presby_roll_as_of()        one person's roll on a given date
--   presby_sync_current_roll   maintains the memberships.current_roll cache
--   presby_roll_counts_as_of() the four roll counts for a congregation
--   presby_roll_changes()      the gains and losses the annual report asks for
--
-- Until now memberships.current_roll existed with nothing maintaining it, which
-- is worse than not having the column: it reads as authoritative and is always
-- null.

-- ---------------------------------------------------------------------------
-- Voided actions
-- ---------------------------------------------------------------------------
-- An approved action is immutable, so a correction is a new action of kind
-- 'void' pointing at the mistaken one. Every read below has to exclude BOTH:
-- the void itself carries no roll, and the action it cancels never happened.
create or replace view presby_effective_roll_actions as
  select ra.*
    from roll_actions ra
   where ra.approval_status = 'approved'
     and ra.kind <> 'void'
     and not exists (
       select 1 from roll_actions v
        where v.voids_action_id = ra.id
          and v.approval_status = 'approved'
     );

comment on view presby_effective_roll_actions is
  'Approved roll actions with voids applied. Every roll read goes through this, so the void rule lives in one place rather than being re-implemented per query.';

-- ---------------------------------------------------------------------------
-- One person, one date
-- ---------------------------------------------------------------------------
-- The cache on memberships answers "now". This answers "then", which is what
-- the annual report needs (the roll as of 31 December) and what an audit needs
-- ("was this person a member when they voted?").
--
-- Ordering is by effective_date first, then recorded_at: two actions can share
-- an effective date, and the one recorded later is the later decision.
create or replace function presby_roll_as_of(
  p_person_id uuid,
  p_organization_id uuid,
  p_as_of date default current_date
)
returns text
language sql stable as $$
  select ra.resulting_roll
    from presby_effective_roll_actions ra
   where ra.person_id = p_person_id
     and ra.organization_id = p_organization_id
     and ra.effective_date <= p_as_of
   order by ra.effective_date desc, ra.recorded_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The cache
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, but narrowly: it only ever touches the membership belonging
-- to the same organization as the action that fired it, so it cannot reach
-- across tenants. Without it, a seed or an admin script running outside an org
-- context would silently update zero rows and leave the cache wrong — the same
-- shape of failure as F26, where a trigger's own query was filtered by the RLS
-- it was meant to complement.
create or replace function presby_sync_current_roll()
returns trigger language plpgsql security definer as $$
declare
  new_roll  text;
  roll_since date;
begin
  if new.approval_status <> 'approved' then
    return new;
  end if;

  select ra.resulting_roll, ra.effective_date
    into new_roll, roll_since
    from presby_effective_roll_actions ra
   where ra.person_id = new.person_id
     and ra.organization_id = new.organization_id
     and ra.effective_date <= current_date
   order by ra.effective_date desc, ra.recorded_at desc
   limit 1;

  update memberships
     set current_roll = new_roll,
         current_roll_since = roll_since,
         updated_at = now()
   where person_id = new.person_id
     and organization_id = new.organization_id;

  return new;
end $$;

drop trigger if exists roll_actions_sync_current on roll_actions;
create trigger roll_actions_sync_current
  after insert or update on roll_actions
  for each row execute function presby_sync_current_roll();

-- ---------------------------------------------------------------------------
-- Congregation-level counts
-- ---------------------------------------------------------------------------
-- The four rolls the statistical report asks for, plus Total Adherents, which
-- the report defines as active + baptized + other participants. Affiliate is
-- reported separately and is deliberately NOT in that sum.
create or replace function presby_roll_counts_as_of(
  p_organization_id uuid,
  p_as_of date default current_date
)
returns table (
  active            integer,
  baptized          integer,
  affiliate         integer,
  other_participant integer,
  total_adherents   integer
)
language sql stable as $$
  with current_rolls as (
    select m.person_id,
           presby_roll_as_of(m.person_id, p_organization_id, p_as_of) as roll
      from memberships m
     where m.organization_id = p_organization_id
  )
  select count(*) filter (where roll = 'active')::int,
         count(*) filter (where roll = 'baptized')::int,
         count(*) filter (where roll = 'affiliate')::int,
         count(*) filter (where roll = 'other_participant')::int,
         count(*) filter (where roll in ('active','baptized','other_participant'))::int
    from current_rolls;
$$;

-- ---------------------------------------------------------------------------
-- The report's membership section
-- ---------------------------------------------------------------------------
-- GAINS AND LOSSES ARE ACTIVE-ROLL ONLY. The other three rolls are reported as
-- point-in-time counts, which is why moving from other-participant to active is
-- one gain with no matching loss line.
--
-- The profession-of-faith split reads age_at_action, frozen when the action was
-- recorded, so a birthday correction cannot move a member between lines of a
-- report that was already filed.
create or replace function presby_roll_changes(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns table (line text, count integer)
language sql stable as $$
  with acts as (
    select * from presby_effective_roll_actions
     where organization_id = p_organization_id
       and effective_date between p_from and p_to
  )
  select 'gain_profession_17_and_under',
         count(*) filter (
           where kind in ('profession_of_faith','reaffirmation','restoration')
             and coalesce(age_at_action, 99) <= 17)::int from acts
  union all
  select 'gain_profession_18_and_older',
         count(*) filter (
           where kind in ('profession_of_faith','reaffirmation','restoration')
             and coalesce(age_at_action, 99) >= 18)::int from acts
  union all
  select 'gain_certificate',
         count(*) filter (where kind = 'certificate_received')::int from acts
  union all
  select 'gain_other',
         count(*) filter (where kind = 'other_gain')::int from acts
  union all
  select 'loss_certificate',
         count(*) filter (where kind = 'certificate_dismissed')::int from acts
  union all
  select 'loss_death',
         count(*) filter (where kind = 'death')::int from acts
  union all
  -- The report's single "Other" losses line covers removal by session action
  -- and renunciation of jurisdiction as well.
  select 'loss_other',
         count(*) filter (
           where kind in ('other_loss','removed_by_session',
                          'renunciation_of_jurisdiction'))::int from acts;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on presby_effective_roll_actions to presby_app;
grant execute on function presby_roll_as_of(uuid, uuid, date) to presby_app;
grant execute on function presby_roll_counts_as_of(uuid, date) to presby_app;
grant execute on function presby_roll_changes(uuid, date, date) to presby_app;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- The column has been shipping empty. Populate it from the actions that already
-- exist so the cache and the replay agree from here on.
update memberships m
   set current_roll = presby_roll_as_of(m.person_id, m.organization_id),
       current_roll_since = (
         select ra.effective_date
           from presby_effective_roll_actions ra
          where ra.person_id = m.person_id
            and ra.organization_id = m.organization_id
            and ra.effective_date <= current_date
          order by ra.effective_date desc, ra.recorded_at desc
          limit 1
       );

-- ---------------------------------------------------------------------------
-- F29: the cache goes stale with the passage of time, not only on writes
-- ---------------------------------------------------------------------------
-- Roll actions are routinely future-dated - a session approves a transfer
-- effective at month end. The trigger fires when the action is APPROVED, but
-- the correct answer changes on its EFFECTIVE DATE, and nothing writes that
-- day. So memberships.current_roll silently diverges from the replay, and the
-- directory shows a stale roll while every report shows the right one.
--
-- Found by running it: a profession of faith approved in August and effective
-- in September left the cache reading other_participant into September.
--
-- Two halves: a reconcile that catches up, run daily, and a drift count that
-- can be asserted in tests and alerted on. The drift count is the important
-- one - a cache nobody checks is a cache nobody can trust.
create or replace function presby_reconcile_current_roll()
returns integer
language plpgsql security definer as $$
declare
  fixed integer;
begin
  with truth as (
    select m.person_id,
           m.organization_id,
           presby_roll_as_of(m.person_id, m.organization_id) as roll
      from memberships m
  ),
  stale as (
    select t.* from truth t
      join memberships m
        on m.person_id = t.person_id
       and m.organization_id = t.organization_id
     where m.current_roll is distinct from t.roll
  ),
  updated as (
    update memberships m
       set current_roll = s.roll,
           current_roll_since = (
             select ra.effective_date
               from presby_effective_roll_actions ra
              where ra.person_id = s.person_id
                and ra.organization_id = s.organization_id
                and ra.effective_date <= current_date
              order by ra.effective_date desc, ra.recorded_at desc
              limit 1
           ),
           updated_at = now()
      from stale s
     where m.person_id = s.person_id
       and m.organization_id = s.organization_id
     returning 1
  )
  select count(*)::int into fixed from updated;

  return fixed;
end $$;

comment on function presby_reconcile_current_roll is
  'Catches the current_roll cache up with the replay. Run daily: future-dated actions take effect on a date with no corresponding write, so the trigger alone cannot keep the cache correct (F29).';

-- Drift detector. Zero is the only acceptable answer outside a reconcile.
create or replace function presby_roll_cache_drift()
returns table (organization_id uuid, person_id uuid, cached text, actual text)
language sql stable security definer as $$
  select m.organization_id,
         m.person_id,
         m.current_roll,
         presby_roll_as_of(m.person_id, m.organization_id)
    from memberships m
   where m.current_roll is distinct from
         presby_roll_as_of(m.person_id, m.organization_id);
$$;

grant execute on function presby_reconcile_current_roll() to presby_app;
grant execute on function presby_roll_cache_drift() to presby_app;

-- Fixes two live schema defects found while building member management's
-- server logic layer (docs/work-log/2026-08-25-member-management.md, "Two
-- schema-layer findings, verified live — BLOCKING for database-admin"). Both
-- are pre-existing gaps in drizzle/0009_presby_rls.sql, unrelated to that
-- pipeline's own application code.
--
-- Hand-written, idempotent throughout: every DROP POLICY is IF EXISTS
-- immediately followed by an unconditional CREATE POLICY, and the trigger
-- function is CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- Finding 1 — `people`/`addresses`/`contact_methods`/`person_relationships`/
-- `person_identifiers` carried ONE policy (`visible_via_membership`, FOR ALL,
-- USING only, no WITH CHECK). Postgres's documented default for a write with
-- no WITH CHECK reuses the USING clause — which requires an EXISTING
-- membership referencing the row. For a brand-new person that can NEVER
-- hold: no `memberships` row can reference a `people.id` that doesn't exist
-- yet (the FK requires the person first). This blocked `createPerson()`'s
-- `identity.mode === "new"` branch (src/lib/people.ts) categorically — the
-- single most common case member management exists for, a volunteer admin
-- adding someone who has never been in the system before.
--
-- NOT fixed with a blanket `with check (true)`. Read the Isolation invariant
-- (CLAUDE.md) and docs/schema-design.md's F21 before assuming that is the
-- answer: `with check (true)` on the single combined ALL policy would ALSO
-- relax the write check for UPDATE (in practice a no-op today — a row's
-- linking column does not change on an ordinary UPDATE — so no real loss
-- there) but, more seriously, for INSERT on the four sibling tables it would
-- let ANY org attach an address/contact_method/person_identifier/
-- person_relationship row to ANY EXISTING person_id, including one it holds
-- no membership for at all. That is the exact vandalism/identity-pollution
-- shape F21's own guard exists to police for `memberships` — one hop over,
-- on a table F21 never had to consider because inserting a CHILD row onto an
-- unrelated person was never on its radar.
--
-- The fix instead splits the single FOR ALL policy into four command-scoped
-- policies per table:
--   SELECT / UPDATE / DELETE — UNCHANGED behavior. A row must already be
--     linked via an active membership at the acting org to be read, updated,
--     or deleted. (UPDATE's WITH CHECK is left to default-reuse USING, the
--     exact behavior a FOR ALL policy with no WITH CHECK already gave it —
--     no change.)
--   INSERT — permitted when EITHER (a) the referenced person_id currently
--     has NO membership ANYWHERE (a genuinely new, unclaimed person — F21's
--     own presby_guard_membership_insert case (a): "there is nothing to
--     disclose"), OR (b) the acting org ALREADY holds a membership for that
--     person (adding a second address, etc, to someone it already has a
--     relationship with). A row aimed at a real, already-claimed person the
--     acting org has NO relationship to is rejected, not silently allowed —
--     the read side stays exactly as narrow as it was before this migration.
--
-- F26, AGAIN, CAUGHT BY RUNNING IT — NOT A RAW SQL PREDICATE. A first draft
-- of this migration wrote case (a)/(b) as a literal `not exists (select 1
-- from memberships ...) or exists (...)` expression directly in the policy.
-- Live-tested (not just reviewed) as presby_app: Bramblewood was able to
-- attach an address to a person who holds real memberships at Alder Creek
-- and the presbytery — because `memberships` ITSELF carries the standard
-- `tenant_isolation` policy, so a plain SELECT against it, evaluated as
-- presby_app inside Bramblewood's own org context, is RLS-BLIND to any
-- membership at a DIFFERENT org. "Not exists ANYWHERE" silently evaluated as
-- "not exists AT THIS ORG", which is true for almost every real person from
-- every OTHER org's point of view — exactly the shape F26 already names
-- ("its own queries are filtered by the RLS it exists to complement, and it
-- silently reads zero rows for exactly the case it guards") and exactly the
-- shape the api-developer's own "third finding" hit from the application
-- side for the same reason on the same table. `presby_current_org()` and a
-- literal SQL predicate are not enough here; the check needs to see across
-- orgs, so it needs SECURITY DEFINER, same as `presby_guard_membership_
-- insert` and `presby_membership_is_active` (drizzle/0015_presby_membership_
-- probe.sql) before it. It returns one boolean and no row data, so it
-- discloses nothing beyond what the caller already named.
-- ---------------------------------------------------------------------------
create or replace function presby_person_unclaimed_or_own_org(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from memberships m where m.person_id = p_person_id)
    or exists (
      select 1 from memberships m
       where m.person_id = p_person_id
         and m.organization_id = presby_current_org()
    );
$$;

revoke all on function presby_person_unclaimed_or_own_org(uuid) from public;
grant execute on function presby_person_unclaimed_or_own_org(uuid) to presby_app;

do $$
declare
  t text;
  global_person_tables text[] := array[
    'people', 'addresses', 'contact_methods', 'person_relationships',
    'person_identifiers'
  ];
  col text;
begin
  foreach t in array global_person_tables loop
    col := case when t = 'people' then 'id' else 'person_id' end;

    -- Replaces the single FOR ALL policy (and any partial re-run's own
    -- split policies) with the four below.
    execute format('drop policy if exists visible_via_membership on %I', t);
    execute format('drop policy if exists visible_via_membership_read on %I', t);
    execute format('drop policy if exists visible_via_membership_update on %I', t);
    execute format('drop policy if exists visible_via_membership_delete on %I', t);
    execute format('drop policy if exists visible_via_membership_insert on %I', t);

    execute format(
      'create policy visible_via_membership_read on %I for select using (exists ('
      '  select 1 from memberships m'
      '   where m.person_id = %I.%I'
      '     and m.organization_id = presby_current_org()))', t, t, col);

    -- WITH CHECK deliberately omitted here — defaults to reusing the USING
    -- expression above, IDENTICAL to this table's UPDATE behavior before
    -- this migration (a FOR ALL policy with no WITH CHECK already reused
    -- USING for UPDATE the same way). No behavior change for UPDATE.
    execute format(
      'create policy visible_via_membership_update on %I for update using (exists ('
      '  select 1 from memberships m'
      '   where m.person_id = %I.%I'
      '     and m.organization_id = presby_current_org()))', t, t, col);

    execute format(
      'create policy visible_via_membership_delete on %I for delete using (exists ('
      '  select 1 from memberships m'
      '   where m.person_id = %I.%I'
      '     and m.organization_id = presby_current_org()))', t, t, col);

    execute format(
      'create policy visible_via_membership_insert on %I for insert with check ('
      '  presby_person_unclaimed_or_own_org(%I.%I))',
      t, t, col);

    execute format('grant select, insert, update on %I to presby_app', t);
  end loop;
end $$;

grant delete on addresses, contact_methods, person_relationships to presby_app;

-- ---------------------------------------------------------------------------
-- Finding 2 — `presby_freeze_approved_roll_action()`'s BEFORE DELETE path.
-- The function body unconditionally ended `return new;`. For UPDATE, `new`
-- is the incoming row (correct). For DELETE, `new` is ALWAYS NULL in
-- Postgres, and a BEFORE DELETE trigger returning NULL means "silently skip
-- deleting this row" — no exception, `DELETE` just reports 0 rows affected,
-- for a `pending` row exactly as much as an `approved` one. Verified live.
--
-- Does not affect application correctness today — src/lib/roll.ts only ever
-- UPDATEs a pending row's approval_status, matching invariant 4's own text
-- ("rows in pending are mutable working state") — but it is a real gap in
-- the append-only enforcement this trigger exists to provide: an approved,
-- constitutionally frozen roll_actions row could be silently DELETEd by any
-- future caller (or a hand-run psql session) with no error and no trace
-- beyond "the row is gone."
--
-- Fix: mirror the existing guard clause's own intent onto the DELETE path
-- instead of falling through to the UPDATE-only `return new`. The guard
-- (`if old.approval_status = 'approved' then raise ...`) already runs
-- correctly on DELETE too, since `old` is populated for both UPDATE and
-- DELETE — the bug was purely in what the function returned AFTER the
-- guard. An approved row's DELETE now raises the same 'approved actions are
-- immutable' exception UPDATE already gets. A PENDING row's DELETE returns
-- OLD (the standard "let this row's deletion proceed" signal for a BEFORE
-- DELETE trigger) — deleting a roll action proposed in error, before it is
-- ever approved, is legitimate working-state cleanup, the same latitude
-- invariant 4's own text already grants pending rows for UPDATE.
-- ---------------------------------------------------------------------------
create or replace function presby_freeze_approved_roll_action()
returns trigger language plpgsql as $$
begin
  if old.approval_status = 'approved' then
    raise exception
      'roll_actions %: approved actions are immutable; record a void action instead',
      old.id
      using errcode = 'check_violation';
  end if;
  -- TG_OP is always UPPERCASE ('INSERT'/'UPDATE'/'DELETE'/'TRUNCATE') —
  -- caught live: an earlier `tg_op = 'delete'` (lowercase) never matched,
  -- so a PENDING row's DELETE silently fell through to `return new` (NULL
  -- on DELETE) exactly like the original bug, while an APPROVED row's
  -- DELETE still correctly raised because that check runs first and never
  -- reaches this branch. Both paths are re-verified live below.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- The trigger itself (name, timing, BEFORE UPDATE OR DELETE, FOR EACH ROW)
-- is unchanged — CREATE OR REPLACE FUNCTION above is sufficient; no
-- DROP/CREATE TRIGGER needed.

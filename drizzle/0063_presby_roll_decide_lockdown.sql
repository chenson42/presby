-- drizzle/0063_presby_roll_decide_lockdown.sql
--
-- Roll decisions become function-mediated only (docs/work-log/
-- 2026-10-22-founding-admin-directory.md, Increment 2, Phase 2 R16 and R5,
-- Phase 3 "SQL: 0063"; DECISION-203; findings F180, F191; the roll_actions
-- part of F176).
--
-- Apply (owner, direct endpoint; DDL needs it):
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0063_presby_roll_decide_lockdown.sql
--
-- APPLY ONLY AFTER THE CODE IS DEPLOYED that no longer updates or deletes
-- roll_actions from presby_app (Increment 2 Batch B: approve, deny and
-- withdraw call presby_decide_roll_action / presby_withdraw_roll_action,
-- drizzle/0062). STRICT ORDER: 0061 < 0062 < code < 0063. Applied before the
-- code, the old deny and approve fail on the privilege.
--
-- THE SAFETY PROOF (Phase 3 Measurement 6, re-checked at Batch A): the only
-- application writers of roll_actions are src/lib/roll.ts (the decide UPDATE,
-- removed by Batch B, and the pending proposal INSERT, which stays) and
-- src/lib/people.ts (the pending proposal INSERT, which stays). The only
-- database functions that write roll_actions are 0061's two participant
-- definers and 0062's two decision definers, all owned by neondb_owner
-- (rolbypassrls), which no grant binds. A source-scan test pins that no
-- non-test file under src/ matches update(rollActions), delete(rollActions),
-- `update roll_actions` or `delete from roll_actions`.
--
-- ROLLBACK (a code rollback alone does NOT undo this file; the old code's
-- deny and approve would fail on the privilege):
--   grant update, delete on roll_actions to presby_app;
--   alter table roll_actions drop constraint if exists roll_actions_terminal_decision_stamps;
--   drop policy if exists roll_actions_insert_pending_only on roll_actions;
--   create policy roll_actions_insert_pending_only on roll_actions
--     as restrictive for insert to presby_app
--     with check (approval_status = 'pending');
-- (presby_platform's UPDATE and DELETE need not be restored: it cannot log
-- in, and no path uses them.) Rehearsed: Increment 2 Batch A applied this
-- file twice on the pipeline branch and reverted it with exactly these
-- statements (work-log, Increment 2 Phase 4 Batch A).
--
-- Production measurement (orchestrator, read-only, 2026-10-22): 0
-- roll_actions rows, so the stop-block and the new CHECK have nothing to
-- check. Re-measure before the production apply.
--
-- The whole file is idempotent: a stop-block, drop-then-add, revoke (a
-- no-op the second time), drop-then-create. Unreleased until shipped, so it
-- may be corrected in place until then.
--
--   1. stop-block              a denied or withdrawn row without its stamps
--   2. terminal stamps CHECK   R5's third CHECK (moved here from 0062)
--   3. privileges              presby_app (and presby_platform) lose UPDATE
--                              and DELETE on roll_actions
--   4. insert policy           pending AND one of the seven approvable kinds
--                              (F191)
--   5. comments
--
-- No delete anywhere; no audit row; no data change.

-- ---------------------------------------------------------------------------
-- 1. stop-block (counts only)
-- ---------------------------------------------------------------------------
-- A row denied by the pre-Increment-2 code (between 0062 and the code
-- deploy) carries neither decided_by nor decided_at. The migration never
-- invents an actor: a human backfills the pair from that row's
-- tenant.roll_action.denied audit row first. Owner-side, so the freeze
-- trigger must be disabled for that one correction (a minuted act, outside
-- this file).
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from roll_actions
   where approval_status in ('denied', 'withdrawn')
     and (decided_by is null or decided_at is null);
  if v_bad > 0 then
    raise exception
      '0063: % denied or withdrawn roll_actions row(s) lack decided_by or decided_at; backfill them from their tenant.roll_action.denied audit rows before this migration can apply',
      v_bad
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. terminal stamps CHECK (R5; Phase 3 refinement 2)
-- ---------------------------------------------------------------------------
-- Approved rows are exempt: every row approved before 0062 has neither stamp
-- and is frozen, and readers coalesce with approved_by / approved_on.
alter table roll_actions drop constraint if exists roll_actions_terminal_decision_stamps;
alter table roll_actions add constraint roll_actions_terminal_decision_stamps
  check (approval_status not in ('denied', 'withdrawn')
         or (decided_by is not null and decided_at is not null));

-- ---------------------------------------------------------------------------
-- 3. privileges (R16)
-- ---------------------------------------------------------------------------
-- After this, the only way any presby_app caller moves a row out of pending
-- is a definer that checked the key in the same transaction, and nothing on
-- the tenant connection can delete a roll row (all deletes are soft:
-- withdrawal replaces deletion; closes the roll_actions part of F176).
-- presby_app keeps SELECT and INSERT (the pending proposal path).
-- presby_platform cannot log in (rolcanlogin = false, measured) and no path
-- uses its UPDATE or DELETE; narrowed anyway, because a grant documents
-- intent and binds the day a real presby_platform login exists. The owner
-- (getPlatformDb(), neondb_owner) keeps every privilege by ownership; on that
-- connection the backstop is roll_actions_freeze (0062 section 5), which
-- fires on the owner path too (F44).
revoke update, delete on roll_actions from presby_app;
revoke update, delete on roll_actions from presby_platform;

-- ---------------------------------------------------------------------------
-- 4. insert policy (F191)
-- ---------------------------------------------------------------------------
-- Restrictive, so it ANDs with tenant_isolation. presby_app may insert only a
-- PENDING row of one of the seven approvable gain kinds. A pending void,
-- loss, opening_balance or other_participant_enrolled row can no longer be
-- inserted by the application: no definer would ever approve it, and with one
-- pending row per person (0062 section 4) it would block every proposal for
-- that person. The kind list is pinned to APPROVABLE_ROLL_ACTION_KINDS and to
-- presby_decide_roll_action's list by a source-scan test.
drop policy if exists roll_actions_insert_pending_only on roll_actions;
create policy roll_actions_insert_pending_only on roll_actions
  as restrictive
  for insert
  to presby_app
  with check (
    approval_status = 'pending'
    and kind in ('profession_of_faith', 'reaffirmation', 'restoration',
                 'certificate_received', 'other_gain',
                 'baptized_member_enrolled', 'affiliate_received'));

-- ---------------------------------------------------------------------------
-- 5. comments
-- ---------------------------------------------------------------------------
comment on constraint roll_actions_terminal_decision_stamps on roll_actions is
  'drizzle/0063 (R5): a denied or withdrawn row carries decided_by and decided_at. Approved rows are exempt (rows approved before drizzle/0062 have neither; readers coalesce with approved_by / approved_on).';

comment on policy roll_actions_insert_pending_only on roll_actions is
  'drizzle/0061 R5, narrowed by drizzle/0063 (F191): restrictive, so it ANDs with tenant_isolation. presby_app may insert only a pending row of one of the seven approvable gain kinds. Approved-at-insert rows come only from the participant definers (0061); decisions only from presby_decide_roll_action / presby_withdraw_roll_action (0062). presby_app holds no UPDATE or DELETE on roll_actions (0063).';

-- drizzle/0083_presby_help_contact.sql
--
-- User help Increment 2: the /help/contact drop box
-- (docs/work-log/2026-10-31-help-contact.md: Phase 2 CA1, CA3, CA6, CA10,
-- CA11; Phase 3 "Data Model"; DECISION-300, DECISION-301, DECISION-303;
-- findings F382-F391, F406-F413).
--
-- An anonymous visitor writes a short message to the PresbyPortal team. This
-- file creates the one table that holds those messages and the one function
-- that writes them. Five things, in dependency order. The whole file is
-- idempotent: every statement is `if not exists`, drop-then-add,
-- `create or replace`, or revoke-then-grant, so it replays cleanly, including
-- as an in-place correction while this migration is unreleased (CLAUDE.md ->
-- Project Layout -> drizzle/). Proven by applying the whole file twice
-- (work-log, Phase 4 Batch 1).
--
--   1. help_contact_messages   the table, its CHECKs
--   2. indexes                 inbox order, ceiling counts, coalescing claim
--   3. guards                  BEFORE DELETE (always refuses), BEFORE UPDATE
--                              (status changes and one irreversible clear;
--                              nothing rewrites a stranger's words). Both bind
--                              the OWNER too (F44: getPlatformDb() is
--                              neondb_owner, which no grant binds; only
--                              triggers do).
--   4. RLS + grants            FORCE with NO policy (deny-all, on purpose);
--                              no role but the owner holds any table privilege
--   5. the write path          presby_submit_help_contact (SECURITY DEFINER,
--                              EXECUTE to presby_app only), then comments
--
-- TRANSACTION HANDLING: this file carries NO begin/commit of its own (no
-- existing function is dropped and re-created). Apply it with `-1` so it lands
-- atomically:
--   psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0083_presby_help_contact.sql
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing snapshot
-- collision (docs/TODO.md), so every migration past 0012 is hand-authored.
-- Drizzle mirror: src/lib/db/domain/help-contact.ts.
--
-- WHAT THE TABLE NEVER HOLDS, ON PURPOSE (FC6, C2, C4): an IP address, a user
-- agent, an organization_id, a person id, or any user id for the SENDER. The
-- typed email authenticates nothing and is never matched against users,
-- contact_methods or people (DECISION-216). "Congregation" is free text and is
-- never resolved to an organization. The only user ids on a row are the
-- operator stamps (status_changed_by, cleared_by).
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * No BEFORE INSERT guard. The only presby_app path is the definer, which
--     writes the born-new shape itself; the CHECKs bind the owner path.
--     Named residual (DECISION-300, `paper`): an owner-path insert can be born
--     `handled`, or with a notified_at the definer did not set. The owner is
--     the operator's own connection.
--   * No retention sweep. Messages are kept until an operator clears them
--     (operator ruling Q4); the table comment says so, and the privacy policy
--     states no period.
--   * No audit row. src/lib/help-contact/inbox.ts writes the triage audit rows
--     in the SAME transaction as the UPDATE (CA10), carrying ids and statuses
--     only, never a personal field (AF-5 / F410).
--   * No change to any existing object.

-- ---------------------------------------------------------------------------
-- 1. help_contact_messages
-- ---------------------------------------------------------------------------
create table if not exists help_contact_messages (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  topic             text not null,
  name              text,
  email             text,
  congregation      text,
  message           text,
  status            text not null default 'new',
  status_changed_at timestamptz,
  status_changed_by uuid references users(id),
  notified_at       timestamptz,
  cleared_at        timestamptz,
  cleared_by        uuid references users(id)
);

-- The CHECKs repeat the server-side bounds (src/lib/help-contact/validate.ts,
-- CA12), so an owner-path insert or a validator drift cannot store what the
-- form would refuse. Drop-then-add so a re-apply picks up a changed body.

-- The four topic keys (Phase 1 Q11). A triage hint only; it decides nothing.
alter table help_contact_messages drop constraint if exists help_contact_topic_allowed;
alter table help_contact_messages add constraint help_contact_topic_allowed
  check (topic in ('starting_a_congregation', 'signing_in', 'help_page_wrong', 'something_else'));

alter table help_contact_messages drop constraint if exists help_contact_status_allowed;
alter table help_contact_messages add constraint help_contact_status_allowed
  check (status in ('new', 'handled', 'spam'));

-- Lengths in characters (char_length counts code points in a UTF8 database,
-- the same unit as charCount in src/lib/text-hygiene.ts). The message bound
-- is written slightly tighter than the design's `char_length(btrim(message))
-- between 10 and 2000`, and in both directions only tighter: the maximum is
-- on the RAW length (never longer than the trimmed one) and the minimum is
-- after trimming spaces, tabs, CR and LF (never shorter than btrim's
-- spaces-only result). The validator always stores a trimmed message, so no
-- value it accepts is refused here; a message of ten newlines from an owner
-- path is.
alter table help_contact_messages drop constraint if exists help_contact_bounds;
alter table help_contact_messages add constraint help_contact_bounds
  check (
    (name is null or char_length(name) <= 100)
    and (congregation is null or char_length(congregation) <= 150)
    and (email is null or char_length(email) <= 254)
    and (message is null or (char_length(message) <= 2000
                             and char_length(btrim(message, E' \t\r\n')) >= 10))
  );

-- Shape only, no deliverability (CA12): exactly one @, a non-empty local
-- part, a domain with at least one dot that has a character on each side, no
-- whitespace. Not lower-cased: the inbox shows the address as typed.
alter table help_contact_messages drop constraint if exists help_contact_email_shape;
alter table help_contact_messages add constraint help_contact_email_shape
  check (email is null or (email !~ '[[:space:]]' and email ~ '^[^@]+@[^@]+\.[^@]+$'));

-- No C0 control character other than tab (0x09), LF (0x0a) and CR (0x0d),
-- and no DEL (0x7f), in any of the four free-text fields (FC8 / F389). NUL
-- cannot be stored in Postgres text at all. Verified against the live regex
-- engine before writing (work-log, Phase 4 Batch 1) and pinned by the DB test.
alter table help_contact_messages drop constraint if exists help_contact_no_controls;
alter table help_contact_messages add constraint help_contact_no_controls
  check (
    coalesce(name, '')         !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and coalesce(email, '')        !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and coalesce(congregation, '') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and coalesce(message, '')      !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  );

-- Before a clear: the email and the message are present (the name and the
-- congregation are optional). After a clear: all four personal fields are
-- null. The clear stamp and its operator travel together.
alter table help_contact_messages drop constraint if exists help_contact_cleared_shape;
alter table help_contact_messages add constraint help_contact_cleared_shape
  check (
    (cleared_at is null) = (cleared_by is null)
    and (
      (cleared_at is null and email is not null and message is not null)
      or (cleared_at is not null and name is null and email is null
          and congregation is null and message is null)
    )
  );

alter table help_contact_messages drop constraint if exists help_contact_status_stamp_shape;
alter table help_contact_messages add constraint help_contact_status_stamp_shape
  check ((status_changed_at is null) = (status_changed_by is null));

-- ---------------------------------------------------------------------------
-- 2. indexes
-- ---------------------------------------------------------------------------
-- The inbox (newest first, filtered by status) and the dashboard card's
-- `status = 'new'` count.
create index if not exists help_contact_status_created_ix
  on help_contact_messages (status, created_at desc);
-- The definer's hourly and daily ceiling counts.
create index if not exists help_contact_created_ix
  on help_contact_messages (created_at);
-- The coalescing claim's `exists (... where notified_at > now() - window)`.
-- On notified_at, not created_at: the predicate reads notified_at (Phase 3
-- ruling on the architect's wording).
create index if not exists help_contact_notified_ix
  on help_contact_messages (notified_at desc) where notified_at is not null;

-- ---------------------------------------------------------------------------
-- 3. guards
-- ---------------------------------------------------------------------------
-- Both SECURITY INVOKER with a pinned search_path: they read no table, lend no
-- owner privilege, and fire on every connection including the owner's (F44).
-- Refusals raise insufficient_privilege, so a caller (and the tests) can tell
-- a guard refusal from a CHECK (23514).

-- 3a. BEFORE DELETE ----------------------------------------------------------
-- Messages are permanent (all deletes are soft). There is no teardown
-- exemption: no organization is involved, so no deletable_until fixture
-- applies, and the tests roll back instead.
create or replace function presby_help_contact_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception 'help_contact_messages: messages are permanent; mark a message handled or spam, or clear its details, instead of deleting it'
    using errcode = 'insufficient_privilege';
end
$function$;

-- 3b. BEFORE UPDATE ----------------------------------------------------------
-- The operator can triage and clear. Nothing can rewrite a stranger's words.
--
--   (1) id, created_at, topic and notified_at never change.
--   (2) name, email, congregation and message change only in a CLEAR, and a
--       clear sets all four to null. A clear is the update that moves the row
--       from uncleared to cleared, signalled by naming cleared_at or
--       cleared_by. Any other change to a personal field is refused.
--   (3) A clear needs cleared_by (the operator) and a status other than
--       `new` after the update. The trigger stamps cleared_at := now()
--       itself, whatever the caller wrote. Once cleared, cleared_at and
--       cleared_by never change (no un-clear, no re-stamp).
--   (4) A status change needs status_changed_by (the operator), and the
--       trigger stamps status_changed_at := now() itself. With the status
--       unchanged, neither stamp may move. A cleared row never returns to
--       `new`.
--
-- Residual (stated, not prevented): a status change that leaves
-- status_changed_by at its previous value records the previous operator.
-- The trigger cannot tell "the same operator again" from "nobody said";
-- src/lib/help-contact/inbox.ts always sets it, and the audit row written in
-- the same transaction names the real actor.
create or replace function presby_help_contact_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_clearing boolean;
begin
  -- (1) identity and provenance
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.topic is distinct from old.topic
     or new.notified_at is distinct from old.notified_at then
    raise exception 'help_contact_messages: id, created_at, topic and notified_at never change'
      using errcode = 'insufficient_privilege';
  end if;

  -- (3, second half) a cleared row stays cleared, with its stamps
  if old.cleared_at is not null
     and (new.cleared_at is distinct from old.cleared_at
          or new.cleared_by is distinct from old.cleared_by) then
    raise exception 'help_contact_messages: a cleared message stays cleared'
      using errcode = 'insufficient_privilege';
  end if;

  v_clearing := old.cleared_at is null
                and (new.cleared_at is not null or new.cleared_by is not null);

  if v_clearing then
    -- (3) who, and only after triage
    if new.cleared_by is null then
      raise exception 'help_contact_messages: clearing a message names the operator who cleared it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'new' then
      raise exception 'help_contact_messages: mark a message handled or spam before clearing its details'
        using errcode = 'insufficient_privilege';
    end if;
    -- (2) a clear blanks all four personal fields, never some of them
    if num_nonnulls(new.name, new.email, new.congregation, new.message) <> 0 then
      raise exception 'help_contact_messages: clearing a message sets name, email, congregation and message to null'
        using errcode = 'insufficient_privilege';
    end if;
    new.cleared_at := now();
  else
    -- (2) outside a clear, no personal field moves
    if new.name is distinct from old.name
       or new.email is distinct from old.email
       or new.congregation is distinct from old.congregation
       or new.message is distinct from old.message then
      raise exception 'help_contact_messages: a message''s name, email, congregation and message cannot be rewritten; they can only be cleared'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- (4) status changes carry their operator; the stamp is forced
  if new.status is distinct from old.status then
    if new.status = 'new' and old.cleared_at is not null then
      raise exception 'help_contact_messages: a cleared message cannot return to new'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status_changed_by is null then
      raise exception 'help_contact_messages: a status change names the operator who made it'
        using errcode = 'insufficient_privilege';
    end if;
    new.status_changed_at := now();
  elsif new.status_changed_at is distinct from old.status_changed_at
        or new.status_changed_by is distinct from old.status_changed_by then
    raise exception 'help_contact_messages: the status stamps move only with a status change'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$function$;

revoke all on function presby_help_contact_guard_delete() from public, presby_app, presby_platform;
revoke all on function presby_help_contact_guard_update() from public, presby_app, presby_platform;

drop trigger if exists help_contact_guard_delete on help_contact_messages;
create trigger help_contact_guard_delete
  before delete on help_contact_messages
  for each row execute function presby_help_contact_guard_delete();

drop trigger if exists help_contact_guard_update on help_contact_messages;
create trigger help_contact_guard_update
  before update on help_contact_messages
  for each row execute function presby_help_contact_guard_update();

-- ---------------------------------------------------------------------------
-- 4. RLS + grants
-- ---------------------------------------------------------------------------
-- DENY-ALL, ON PURPOSE. Row level security is enabled and FORCED with NO
-- policy: any role without BYPASSRLS reads and writes nothing, even if a
-- future migration grants a privilege here by mistake (F38). This is the
-- first FORCE-RLS table on the catalog with zero policies; do not "fix" it by
-- adding a tenant_isolation policy (there is no tenant). neondb_owner, the
-- getPlatformDb() role and this file's definer owner, is BYPASSRLS and owns
-- the table, so it is unaffected (and bound only by the triggers above).
alter table help_contact_messages enable row level security;
alter table help_contact_messages force row level security;

-- Revoke-then-grant-nothing (F38): a re-apply corrects a hand-added grant.
-- presby_app reaches this table ONLY through presby_submit_help_contact
-- (section 5). presby_platform cannot log in and nothing uses it
-- (src/lib/db/index.ts), so it holds nothing either. No DELETE for anyone,
-- and the delete guard binds the owner.
revoke all on help_contact_messages from public, presby_app, presby_platform;

-- ---------------------------------------------------------------------------
-- 5. the write path
-- ---------------------------------------------------------------------------
-- presby_submit_help_contact: the ONE way a message is stored (CA1, CA3;
-- DECISION-300, DECISION-301).
--
--   * SECURITY DEFINER, search_path pinned `public, pg_temp` (pg_temp LAST,
--     F60), owned by neondb_owner. EXECUTE to presby_app only.
--   * Returns a closed outcome token and NOTHING else - no id, no content:
--       'stored'         stored; another message already claimed this
--                        window's notification
--       'stored_notify'  stored, and this message claimed the window's
--                        notification (the caller queues the content-free
--                        email to the ADMIN_TICKETS holders)
--       'ceiling'        NOT stored: the database backstop ceiling is spent
--   * One transaction-scoped advisory lock covers the ceiling count and the
--     notification claim, so concurrent callers on different serverless
--     instances serialize, and exactly one per window sees an unclaimed slot.
--     The key, hashtextextended('help_contact_messages', 0), cannot collide
--     with the '<name>:' || ... keys 0057 and 0071 use. Exactness relies on
--     the caller's READ COMMITTED isolation (the default; each statement in
--     this VOLATILE function then takes a fresh snapshot after the lock is
--     granted). Under REPEATABLE READ a waiter would not see the holder's
--     row; nothing in the codebase calls it that way.
--   * The window and the ceilings are SQL constants, never parameters, so no
--     caller can widen them. The ceilings are 3x the limiter's (30 per hour,
--     100 per day; src/lib/help-contact/submit.ts) and bite only when the
--     limiter is misconfigured, disabled or in memory.
--   * The operator's immediate kill switch (DECISION-303, runbook):
--       revoke execute on function presby_submit_help_contact(text, text, text, text, text) from presby_app;
--     The action maps the resulting SQLSTATE 42501 to "unavailable". Restore
--     with the matching `grant execute ... to presby_app`.
--   * A CHECK violation (23514) here means the server validator and the
--     CHECKs disagree; the caller maps it to "not sent".
create or replace function presby_submit_help_contact(
  p_topic text,
  p_name text,
  p_email text,
  p_congregation text,
  p_message text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  c_window    constant interval := interval '60 minutes';  -- the notification window; the email copy says "an hour"
  c_ceil_hour constant integer  := 90;                     -- 3x the limiter's 30 per hour
  c_ceil_day  constant integer  := 300;                    -- 3x the limiter's 100 per day
  v_hour   integer;
  v_day    integer;
  v_notify boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('help_contact_messages', 0));

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into v_hour, v_day
    from help_contact_messages
   where created_at > now() - interval '24 hours';
  if v_hour >= c_ceil_hour or v_day >= c_ceil_day then
    return 'ceiling';
  end if;

  v_notify := not exists (
    select 1 from help_contact_messages where notified_at > now() - c_window
  );

  insert into help_contact_messages (topic, name, email, congregation, message, notified_at)
  values (p_topic, p_name, p_email, p_congregation, p_message,
          case when v_notify then now() end);

  return case when v_notify then 'stored_notify' else 'stored' end;
end
$function$;

revoke all on function presby_submit_help_contact(text, text, text, text, text) from public, presby_app, presby_platform;
grant execute on function presby_submit_help_contact(text, text, text, text, text) to presby_app;

-- ---------------------------------------------------------------------------
-- comments (read by the developer data-model page and by psql)
-- ---------------------------------------------------------------------------
comment on table help_contact_messages is
  'Messages sent to the PresbyPortal team through /help/contact (DECISION-300). Platform axis: no organization, no person, no sender user id, no IP address and no user agent. Written only by presby_submit_help_contact() (SECURITY DEFINER; presby_app holds EXECUTE and no table privilege). FORCE ROW LEVEL SECURITY with NO policy is a deliberate deny-all. Read and triaged only by src/lib/help-contact/inbox.ts through getPlatformDb(). Never deleted (guard on every connection). Retention: no automatic clearing and no period; an operator clears a message''s details when the sender asks or when the team has finished with it, which blanks name, email, congregation and message and keeps the row.';
comment on column help_contact_messages.topic is
  'One of four triage keys the sender chose (starting_a_congregation, signing_in, help_page_wrong, something_else). A hint only; it decides nothing.';
comment on column help_contact_messages.email is
  'The address the sender typed. NOT VERIFIED: anyone could have typed it. Authenticates nothing, is never matched against users, contact_methods or people, and no system path ever sends mail to it (an operator replies by hand). Null once cleared.';
comment on column help_contact_messages.status is
  'new, handled or spam. Changed only with status_changed_by; the guard stamps status_changed_at. A cleared message never returns to new.';
comment on column help_contact_messages.notified_at is
  'Set by presby_submit_help_contact() on the message that claimed its 60-minute window''s operator notification; null on every other message. Immutable.';
comment on column help_contact_messages.cleared_at is
  'When an operator cleared this message''s details (stamped by the guard). Clearing needs a status other than new, blanks name, email, congregation and message, and is irreversible.';
comment on function presby_submit_help_contact(text, text, text, text, text) is
  'The only write path to help_contact_messages (DECISION-300/301). Returns stored, stored_notify (this message claimed the 60-minute notification window) or ceiling (not stored; 90 per hour or 300 per day). Returns no id and no content. Revoking EXECUTE from presby_app is the operator''s immediate kill switch (DECISION-303).';

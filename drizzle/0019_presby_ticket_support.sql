-- Support tickets — database-admin's commit (1 of 3) of
-- docs/work-log/2026-08-20-support-tickets.md Phase 4.
--
-- DECISION-069: tickets/ticket_messages/ticket_actions are FORCE-RLS tenant
-- tables, not a platform-shell table with a plain organization_id — the same
-- "isolation is a database property" reasoning DECISION-067 already applied
-- to audit_events, now acted on because Flow 2 (a tenant role-holder reading
-- only their own org's tickets) needs a tenant-scoped reader today.
-- DECISION-070: congregation_feedback is its own new tenant-scoped table,
-- not a nullable organization_id bolted onto schema.ts's platform `feedback`
-- table — that table's own stated no-joins privacy invariant stays untouched.
-- DECISION-071/073: blob_assets' CHECK constraints widen to admit PDF
-- attachments up to 10MB; each caller (the org-brand logo action, the new
-- ticket-attachment action) keeps its own narrower magic-byte sniff as the
-- real per-feature gate — the shared constraint is only the outer bound.
--
-- Four new tables, their own FORCE-RLS/grant block (they postdate 0009's
-- original tenant_tables loop, mirroring how 0016_presby_brand_storage.sql
-- gave blob_assets/organization_brands/organization_brand_history their own
-- block rather than hand-editing 0009), and the tickets.file permission
-- catalog row (DECISION-063's migration-seeding precedent — permissions
-- carries no organization_id and needs no org to exist first).
--
-- tickets.file's ROLE BINDING is explicitly NOT part of this migration —
-- see Permissions & Flags in the work-log's Phase 3. That write belongs to
-- the sibling `2026-08-20-role-catalog` pipeline's own Phase 4, once its own
-- Phase 3 names the role. hasTicketsFile() (api-developer's commit) is fully
-- functional and testable with zero holders in the meantime — same split
-- DECISION-063 already established for directory.view.
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored and must be idempotent.

-- ---------------------------------------------------------------------------
-- 1. The permission catalog row
-- ---------------------------------------------------------------------------
insert into permissions (key, module, description, sensitivity_tier)
values ('tickets.file', 'support',
        'File and manage support tickets for this organization', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. tickets
-- ---------------------------------------------------------------------------
create table if not exists tickets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  -- Plain FK (D1/DECISION-069 — people is global). For fileTicket() this is
  -- always the caller, already membership-verified by withOrgContext()'s
  -- gate; for promoteFeedbackToTicket() it is the ORIGINAL feedback
  -- submitter, deliberately with no current-membership re-check (see the
  -- work-log's Edge Cases).
  submitter_person_id   uuid not null references people(id),
  subject               text not null,
  -- 'content' | 'config' | 'theme' | 'bug' | 'feature'. Kept as change_class,
  -- not renamed to category, for continuity with docs/schema-design.md §15's
  -- already-committed sketch; the UI label reads "Category".
  change_class          text not null,
  -- DECISION-076: controlled vocabulary, not free text, so an automated
  -- first triage pass can branch on it directly.
  area                  text not null,
  -- DECISION-076: submitter-set, operator-correctable, mirrors change_class.
  priority              text not null default 'normal',
  status                text not null default 'new',
  -- Phase 2 Note 2, resolved: the only assignee kind that exists post-Phase-1
  -- is "platform operator" — no assignee_kind discriminator column.
  assignee_user_id      uuid references users(id),
  created_at            timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_id_org_key'
  ) then
    alter table tickets add constraint tickets_id_org_key unique (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_change_class_allowed'
  ) then
    alter table tickets add constraint tickets_change_class_allowed
      check (change_class in ('content', 'config', 'theme', 'bug', 'feature'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_area_allowed'
  ) then
    alter table tickets add constraint tickets_area_allowed
      check (area in ('directory', 'roll', 'roles', 'giving', 'events',
                       'website', 'account', 'other'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_priority_allowed'
  ) then
    alter table tickets add constraint tickets_priority_allowed
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_status_allowed'
  ) then
    alter table tickets add constraint tickets_status_allowed
      check (status in ('new', 'triaged', 'in_progress', 'resolved', 'declined'));
  end if;
end $$;

-- Tenant list + filter, and the /admin/tickets cross-org queue. Priority
-- ordering (urgent > high > normal > low) and "most recently active" sort
-- are query-time expressions, not indexed columns — see the work-log's Data
-- Model for why a fifth index isn't warranted at this volume.
create index if not exists tickets_org_status_created_idx
  on tickets (organization_id, status, created_at);
create index if not exists tickets_status_created_idx
  on tickets (status, created_at);

comment on table tickets is
  'Role-gated (tickets.file) support tickets, FORCE RLS (DECISION-069). No description column — the filing body is ticket_messages row 1.';

-- ---------------------------------------------------------------------------
-- 3. ticket_messages
-- ---------------------------------------------------------------------------
create table if not exists ticket_messages (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  ticket_id             uuid not null,
  author_kind           text not null,
  -- Set iff author_kind = 'submitter'.
  author_person_id      uuid,
  -- Set iff author_kind = 'operator' — a platform operator has no people row.
  author_user_id        uuid,
  body                  text not null,
  attachment_asset_key  uuid,
  created_at            timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_ticket_fk'
  ) then
    alter table ticket_messages
      add constraint ticket_messages_ticket_fk
      foreign key (ticket_id, organization_id)
      references tickets (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_author_person_fk'
  ) then
    alter table ticket_messages
      add constraint ticket_messages_author_person_fk
      foreign key (author_person_id) references people (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_author_user_fk'
  ) then
    alter table ticket_messages
      add constraint ticket_messages_author_user_fk
      foreign key (author_user_id) references users (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_attachment_fk'
  ) then
    alter table ticket_messages
      add constraint ticket_messages_attachment_fk
      foreign key (attachment_asset_key, organization_id)
      references blob_assets (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_author_kind_allowed'
  ) then
    alter table ticket_messages add constraint ticket_messages_author_kind_allowed
      check (author_kind in ('submitter', 'operator'));
  end if;
end $$;

-- The compound CHECK (not just num_nonnulls) is deliberate — num_nonnulls
-- alone would accept author_kind = 'submitter' paired with a populated
-- author_user_id, a mislabeled row that's structurally valid but a lie.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_messages_author_identity_check'
  ) then
    alter table ticket_messages add constraint ticket_messages_author_identity_check
      check (
        num_nonnulls(author_person_id, author_user_id) = 1
        and (
          (author_kind = 'submitter' and author_person_id is not null and author_user_id is null)
          or
          (author_kind = 'operator'  and author_user_id  is not null and author_person_id is null)
        )
      );
  end if;
end $$;

create index if not exists ticket_messages_org_ticket_created_idx
  on ticket_messages (organization_id, ticket_id, created_at);

comment on table ticket_messages is
  'Ticket thread, FORCE RLS. author_kind discriminates submitter (people) vs operator (users) — same discriminated-identity shape as audit_events.actor_kind.';

-- ---------------------------------------------------------------------------
-- 4. ticket_actions
-- ---------------------------------------------------------------------------
create table if not exists ticket_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  ticket_id        uuid not null,
  action           text not null,
  -- Plain labels the calling action already has in hand (e.g. the
  -- assignee's email) — not a second set of nullable FK columns per action
  -- kind. This table is a generic timeline, not a referentially-precise
  -- ledger; precision belongs to ticket_messages/tickets themselves.
  from_value       text,
  to_value         text,
  -- Always a platform operator; null on the 'created'/'promoted_from_feedback'
  -- rows fileTicket()/promoteFeedbackToTicket() write (the actor there is a
  -- tenant person, already recorded elsewhere on the ticket/feedback row).
  actor_user_id    uuid references users(id),
  -- DECISION-075: ships always-null in this pipeline. recordAudit() returns
  -- Promise<void>, not the inserted row's id, so there is nothing to
  -- backfill this column with today. Schema headroom for a future
  -- recordAudit() signature change — out of scope here. The working
  -- correlation direction is audit_events.metadata.ticketId (audit→ticket),
  -- not this column (ticket→audit).
  audit_event_id   uuid references audit_events(id),
  applied_at       timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_actions_ticket_fk'
  ) then
    alter table ticket_actions
      add constraint ticket_actions_ticket_fk
      foreign key (ticket_id, organization_id)
      references tickets (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_actions_action_allowed'
  ) then
    alter table ticket_actions add constraint ticket_actions_action_allowed
      check (action in ('created', 'promoted_from_feedback', 'status_changed',
                         'reclassified', 'area_changed', 'priority_changed',
                         'assigned'));
  end if;
end $$;

create index if not exists ticket_actions_org_ticket_applied_idx
  on ticket_actions (organization_id, ticket_id, applied_at);

comment on table ticket_actions is
  'Ticket triage timeline, FORCE RLS. audit_event_id ships always-null (DECISION-075) — working correlation is audit_events.metadata.ticketId.';

-- ---------------------------------------------------------------------------
-- 5. congregation_feedback (DECISION-070's standalone table)
-- ---------------------------------------------------------------------------
create table if not exists congregation_feedback (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  -- Plain FK; always the caller, membership-verified by withOrgContext()'s
  -- own gate. No permission gate on submitFeedback() — any current member.
  person_id              uuid not null references people(id),
  body                   text not null,
  status                 text not null default 'new',
  promoted_to_ticket_id  uuid,
  created_at             timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'congregation_feedback_status_allowed'
  ) then
    alter table congregation_feedback add constraint congregation_feedback_status_allowed
      check (status in ('new', 'promoted', 'dismissed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'congregation_feedback_promoted_ticket_fk'
  ) then
    alter table congregation_feedback
      add constraint congregation_feedback_promoted_ticket_fk
      foreign key (promoted_to_ticket_id, organization_id)
      references tickets (id, organization_id);
  end if;
end $$;

create index if not exists congregation_feedback_org_status_created_idx
  on congregation_feedback (organization_id, status, created_at);

comment on table congregation_feedback is
  'Baseline-member congregation feedback (DECISION-070), FORCE RLS. Distinct from schema.ts''s platform feedback table — no organization_id was ever added there.';

-- ---------------------------------------------------------------------------
-- 6. Row-level security
-- ---------------------------------------------------------------------------
-- F1: FORCE, not just ENABLE — without it the table owner (and any role that
-- shares the owner's privileges) bypasses every policy, and RLS is silently
-- inert while every naive test still passes. These four tables postdate
-- 0009's original tenant_tables loop, so they get their own block, mirroring
-- 0016_presby_brand_storage.sql's brand_tables loop exactly.
do $$
declare
  t text;
  support_tables text[] := array[
    'tickets', 'ticket_messages', 'ticket_actions', 'congregation_feedback'
  ];
begin
  foreach t in array support_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (organization_id = presby_current_org())'
      ' with check (organization_id = presby_current_org())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- presby_platform: 0009's "all tables in schema public" grant only covered
-- tables that existed at 0009's execution time. /admin/tickets reads and
-- writes all four through getPlatformDb() (DECISION-069's platform triage
-- side), so it needs its own grant, same as every table added since 0009.
grant select, insert, update, delete
  on tickets, ticket_messages, ticket_actions, congregation_feedback
  to presby_platform;

-- presby_app: tenant side only ever INSERTS tickets/ticket_messages/
-- ticket_actions (fileTicket, replyToTicket, promoteFeedbackToTicket's own
-- 'promoted_from_feedback' action row) — never UPDATEs one. Status/assign/
-- reclassify/area/priority are getPlatformDb()-only mutations (Flow 3).
grant select, insert on tickets, ticket_messages, ticket_actions to presby_app;

-- congregation_feedback gets UPDATE too — promoteFeedbackToTicket() and
-- dismissFeedback() both flip congregation_feedback.status from the tenant
-- connection.
grant select, insert, update on congregation_feedback to presby_app;

-- ---------------------------------------------------------------------------
-- 8. blob_assets — widened CHECK constraints (DECISION-071/073)
-- ---------------------------------------------------------------------------
-- Widens the shared outer bound (PNG/JPEG/WEBP -> +PDF, 2MB -> 10MB). Each
-- caller keeps its own narrower magic-byte sniff and size cap as the real
-- per-feature gate: the org-brand logo action's sniffImageContentType() /
-- MAX_LOGO_BYTES (2MB, images only) run BEFORE store() and are untouched by
-- this widening, so the logo path accepts nothing new in practice.
-- Idempotent by construction: drop-if-exists then add is safe to re-run,
-- since widening a CHECK never invalidates existing rows.
alter table blob_assets drop constraint if exists blob_assets_content_type_allowed;
alter table blob_assets add constraint blob_assets_content_type_allowed
  check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf'));

alter table blob_assets drop constraint if exists blob_assets_byte_size_bounds;
alter table blob_assets add constraint blob_assets_byte_size_bounds
  check (byte_size > 0 and byte_size <= 10485760);  -- 10MB

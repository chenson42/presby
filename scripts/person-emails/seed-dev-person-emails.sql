-- ---------------------------------------------------------------------------
-- Person emails dev fixture (drizzle/0064_presby_person_emails.sql;
-- docs/work-log/2026-10-23-person-emails.md Phase 3 "Staged integration
-- files", Test plan Batch 1).
--
-- INTEGRATION (Rule 16): scripts/seed-dev.sql gains ONE include, after the
-- invitations include (this file needs Alder Creek's people, memberships and
-- staff position to exist):
--
--     \ir person-emails/seed-dev-person-emails.sql
--
-- (staged as scripts/person-emails/seed-dev.sql.integration.patch). Until
-- then, standalone, AS THE OWNER, after drizzle/0064:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/person-emails/seed-dev-person-emails.sql
--
-- scripts/person-emails/test-rls-64.sql NEEDS this fixture. It adds contact
-- rows ONLY, to existing Alder Creek people, so no membership, roster or
-- people count asserted elsewhere in scripts/test-rls.sql moves. Idempotent:
-- fixed ids and `on conflict do nothing` (which also skips a main address
-- for a person who already holds one on some other branch, rather than
-- failing the seed on contact_methods_one_primary_uq). Owner-supplied
-- created_at fixes the order the reader and "promote the oldest" use.
--
-- Synthetic data only (No Real Data): the seed's invented people and
-- example.invalid addresses.
--
-- What it adds (Alder Creek, 22222222-...):
--   Marisol Windham (c...0009), who holds the OPEN staff position "Church
--   Secretary" (a7000000-...0001, since 2022-09-01):
--     an ENDED old address, a Personal MAIN address, and a Work address
--     (the two-address person, the ended address, the staff Work line).
--   Tobias Renwick (c...0002) and Priya Balakrishnan (c...0003), one
--   household (d...0001): the SAME address, each as their main (the
--   same-organization shared pair, ER23b / 2b's address_shared).
--   Desmond Okonkwo (c...0004): a main address marked do_not_contact.
-- ---------------------------------------------------------------------------
begin;

insert into contact_methods (id, person_id, kind, subtype, value, is_primary, do_not_contact, created_at, ended_at)
values
  -- Ended first: an ended row is legal at any point; inserted before the main
  -- only so the order reads as the history did.
  ('a6400000-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-000000000009',
   'email', 'personal', 'marisol.windham.old@example.invalid', false, false,
   '2021-01-01T00:00:00Z', '2022-01-01T00:00:00Z'),
  ('a6400000-0000-4000-8000-000000000002', 'c0000000-0000-0000-0000-000000000009',
   'email', 'personal', 'marisol.windham@example.invalid', true, false,
   '2022-01-01T00:00:00Z', null),
  ('a6400000-0000-4000-8000-000000000003', 'c0000000-0000-0000-0000-000000000009',
   'email', 'work', 'secretary@aldercreek.example.invalid', false, false,
   '2022-09-01T00:00:00Z', null),
  ('a6400000-0000-4000-8000-000000000004', 'c0000000-0000-0000-0000-000000000002',
   'email', null, 'renwick.balakrishnan@example.invalid', true, false,
   '2023-03-01T00:00:00Z', null),
  ('a6400000-0000-4000-8000-000000000005', 'c0000000-0000-0000-0000-000000000003',
   'email', null, 'renwick.balakrishnan@example.invalid', true, false,
   '2023-03-01T00:00:00Z', null),
  ('a6400000-0000-4000-8000-000000000006', 'c0000000-0000-0000-0000-000000000004',
   'email', 'personal', 'desmond.okonkwo@example.invalid', true, true,
   '2023-05-01T00:00:00Z', null)
on conflict do nothing;

commit;

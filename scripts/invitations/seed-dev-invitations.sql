-- ---------------------------------------------------------------------------
-- Account invitations dev fixture (drizzle/0059_presby_account_invitations.sql;
-- docs/work-log/2026-10-21-invitations.md Phase 3 "Staged test assets", F159).
--
-- INTEGRATION (Rule 16): this block is appended to scripts/seed-dev.sql,
-- after every organization, person, membership and user it references exists
-- (i.e. at the end of the file). Until then, standalone, AS THE OWNER:
--
--     psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/invitations/seed-dev-invitations.sql
--
-- scripts/invitations/test-rls-59.sql NEEDS this fixture (it is the only way a
-- presby_app suite can see an invitation row: presby_app holds no table
-- privilege). Idempotent: every insert is `where not exists`, every update is
-- guarded on its own precondition, so a re-run changes nothing.
--
-- Synthetic data only (No Real Data): invented names, example.invalid
-- addresses, and tokens that are obviously fixtures. NEVER the e2e
-- organizations (e2e-*): Batch 4's specs build throwaway orgs and must not
-- meet a pending invitation on a permanent fixture.
--
-- What it adds:
--   1. F159: an on-file email (contact_methods) for three seeded people who
--      have a login but no email row, so the roster-resolved treasurer flow
--      (C6) has someone to find in dev. The value is their own login's
--      address, normalized (lower, trimmed) and written as the person's main
--      address: drizzle/0064's contact_methods_value_shape refuses anything
--      else, and "no email row" means no ACTIVE email row (ended_at is null).
--   2. Six invitations, each with a KNOWN raw token (dev only):
--        Quillhaven  founding_administrator  OPEN (live)        token qh-fa
--        Quillhaven  treasurer (Odalys)      OPEN (live)        token qh-tr
--        Marrowbone  founding_administrator  open but EXPIRED   token mb-fa-expired
--        Fernwood    founding_administrator  REVOKED            token fw-fa-revoked
--        Fernwood    founding_administrator  SUPERSEDED         token fw-fa-superseded
--        Fernwood    founding_administrator  its resend, OPEN   token fw-fa-resent
--      THE TWO QUILLHAVEN ROWS AND THE FERNWOOD RESEND ARE DATED IN 2099
--      (created_at 2099-01-01, expires_at 2099-01-30) so they never expire
--      on a long-lived development branch: expires_at is the only clock the
--      functions read, and its CHECK allows at most created_at + 30 days. A
--      future created_at is a fixture convenience with one visible effect: a
--      rolling-24 h durable-limit count that does not bound created_at above
--      now() counts these three rows (src/lib/onboarding/issue.ts, Batch 2b,
--      should bound it). Every other row is dated relative to now().
--
-- Tokens (raw; the table stores only sha256 hex of each):
--   seed-dev-invitation-qh-fa-00000000000000000
--   seed-dev-invitation-qh-tr-00000000000000000
--   seed-dev-invitation-mb-fa-expired-000000000
--   seed-dev-invitation-fw-fa-revoked-000000000
--   seed-dev-invitation-fw-fa-superseded-000000
--   seed-dev-invitation-fw-fa-resent-0000000000
-- ---------------------------------------------------------------------------

-- 1. F159: on-file emails for three seeded people with a login.
insert into contact_methods (person_id, kind, value, is_primary)
select p.id, 'email', lower(btrim(u.email)), true
  from people p
  join users u on u.id = p.user_id
 where p.id in ('c1000000-0000-0000-0000-000000000001',   -- Odalys Winterbourne, Quillhaven
                'c1000000-0000-0000-0000-000000000002',   -- Ptolemy Gaddis, Marrowbone
                'c1000000-0000-0000-0000-000000000006')   -- Susanna Peel, Fernwood
   and u.email like '%@example.invalid'
   and not exists (select 1 from contact_methods c where c.person_id = p.id and c.kind = 'email'
                      and c.ended_at is null);

-- 2. Invitations. created_by_user_id is the elder fixture (provenance only).

-- Quillhaven, founding administrator, OPEN (live until 2099).
insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
       invitee_last_name, token_hash, created_by_user_id, created_at, expires_at)
select '44444444-4444-4444-4444-444444444444', 'founding_administrator', 'invite.founding.quillhaven@example.invalid',
       'Wilhelmina', 'Thorncastle',
       encode(sha256(convert_to('seed-dev-invitation-qh-fa-00000000000000000', 'UTF8')), 'hex'),
       'e0000000-0000-0000-0000-0000000000f2', '2099-01-01T00:00:00Z', '2099-01-30T00:00:00Z'
 where not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-qh-fa-00000000000000000', 'UTF8')), 'hex'));

-- Quillhaven, treasurer, OPEN (live until 2099): Odalys Winterbourne, by her on-file address.
insert into account_invitations (organization_id, purpose, email_normalized, person_id, token_hash,
       created_by_user_id, created_at, expires_at)
select '44444444-4444-4444-4444-444444444444', 'treasurer', lower(c.value), c.person_id,
       encode(sha256(convert_to('seed-dev-invitation-qh-tr-00000000000000000', 'UTF8')), 'hex'),
       'e0000000-0000-0000-0000-0000000000f2', '2099-01-01T00:00:00Z', '2099-01-30T00:00:00Z'
  from contact_methods c
 where c.person_id = 'c1000000-0000-0000-0000-000000000001' and c.kind = 'email'
   and c.is_primary and c.ended_at is null
   and not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-qh-tr-00000000000000000', 'UTF8')), 'hex'))
 limit 1;

-- Marrowbone, founding administrator, open but EXPIRED.
insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
       invitee_last_name, token_hash, created_by_user_id, created_at, expires_at)
select '66666666-6666-6666-6666-666666666666', 'founding_administrator', 'invite.expired.marrowbone@example.invalid',
       'Barnaby', 'Quillfeather',
       encode(sha256(convert_to('seed-dev-invitation-mb-fa-expired-000000000', 'UTF8')), 'hex'),
       'e0000000-0000-0000-0000-0000000000f2', now() - interval '10 days', now() - interval '3 days'
 where not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-mb-fa-expired-000000000', 'UTF8')), 'hex'));

-- Fernwood, founding administrator, REVOKED (inserted open, then revoked on the owner path).
insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
       invitee_last_name, token_hash, created_by_user_id, created_at, expires_at)
select '55555555-5555-5555-5555-555555555555', 'founding_administrator', 'invite.revoked.fernwood@example.invalid',
       'Cordelia', 'Ashgrove',
       encode(sha256(convert_to('seed-dev-invitation-fw-fa-revoked-000000000', 'UTF8')), 'hex'),
       'e0000000-0000-0000-0000-0000000000f2', now() - interval '2 days', now() + interval '5 days'
 where not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-revoked-000000000', 'UTF8')), 'hex'));
update account_invitations
   set revoked_at = now(), revoked_by_user_id = 'e0000000-0000-0000-0000-0000000000f2'
 where token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-revoked-000000000', 'UTF8')), 'hex')
   and revoked_at is null;

-- Fernwood, founding administrator, SUPERSEDED by a resend (supersede first,
-- then insert the successor: the D-2 index forbids the reverse order).
insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
       invitee_last_name, token_hash, created_by_user_id, created_at, expires_at)
select '55555555-5555-5555-5555-555555555555', 'founding_administrator', 'invite.resent.fernwood@example.invalid',
       'Peregrine', 'Halloway',
       encode(sha256(convert_to('seed-dev-invitation-fw-fa-superseded-000000', 'UTF8')), 'hex'),
       'e0000000-0000-0000-0000-0000000000f2', now() - interval '1 day', now() + interval '6 days'
 where not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-superseded-000000', 'UTF8')), 'hex'));
update account_invitations
   set superseded_at = now()
 where token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-superseded-000000', 'UTF8')), 'hex')
   and superseded_at is null;
insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name,
       invitee_last_name, token_hash, created_by_user_id, created_at, expires_at, resent_from_id, resend_count)
select p.organization_id, p.purpose, p.email_normalized, p.invitee_first_name, p.invitee_last_name,
       encode(sha256(convert_to('seed-dev-invitation-fw-fa-resent-0000000000', 'UTF8')), 'hex'),
       p.created_by_user_id, '2099-01-01T00:00:00Z', '2099-01-30T00:00:00Z', p.id, p.resend_count + 1
  from account_invitations p
 where p.token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-superseded-000000', 'UTF8')), 'hex')
   and not exists (select 1 from account_invitations
                    where token_hash = encode(sha256(convert_to('seed-dev-invitation-fw-fa-resent-0000000000', 'UTF8')), 'hex'));

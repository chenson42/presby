-- Schema documentation, stored in Postgres.
--
-- COMMENT ON rather than a registry in application code, for the same reason
-- the developer page is generated: a hand-maintained description list rots, and
-- the sibling projects carry workflow rules whose only job is stopping that.
--
-- Comments live with the schema, survive a dump/restore, show up in psql's \d+
-- and in every GUI, and are readable by the AI support worker through
-- information_schema without a bespoke endpoint.
--
-- These say WHY a thing exists and what would go wrong without it. A comment
-- restating the column name earns nothing.

-- ── Organizations ───────────────────────────────────────────────────────────
comment on table organizations is
  'The ecclesiastical hierarchy: General Assembly, synod, presbytery, congregation. Deliberately NOT tenant-isolated - PC(USA) publishes congregation and presbytery lists, so the tree is public information. Anything sensitive lives in organization_settings.';
comment on column organizations.path is
  'Materialized ancestry, trigger-maintained. Makes "every congregation under this presbytery" an index scan rather than a recursive CTE on every request.';
comment on column organizations.platform_status is
  'managed | unmanaged | invited. Most congregations in a presbytery will never be tenants, so a presbytery''s launch-day job is holding records about churches that are not on the platform. An unmanaged org is stewarded by its parent council, and that stewardship must LAPSE when the church joins.';
comment on column organization_settings.pcusa_pin is
  'Office of the General Assembly church PIN, used when submitting the annual statistical report.';

comment on table organization_settings is
  'Per-org configuration split out of organizations so the org tree can stay publicly readable. Holds hasDeacons, sessionServesAsTrustees, and trackDisabilityPerPerson.';
comment on table org_units is
  'Optional subdivision inside a congregation: parish, campus, or deacon district. fpcw calls these parishes.';

-- ── People and membership ───────────────────────────────────────────────────
comment on table people is
  'GLOBAL. One row per human, holding their own data. Global because polity requires it: ministers of Word and Sacrament are members of the PRESBYTERY (G-2.0502) while ruling elders are members of the CONGREGATION, so one person''s roll and service routinely sit at different organizations. Visible when the current org holds a membership for them.';
comment on column people.merged_into_id is
  'Soft merge. A person row is never hard-deleted - PC(USA) records are permanent - so delete is revoked on this table.';
comment on column people.birth_year_only is
  'Imported records routinely carry a birth year and nothing else, and the statistical report''s age brackets still have to bucket them.';
comment on column people.photo_key is
  'Object-storage key, not image bytes. Storing photos in the database bloats every backup, which is a known smell in the sibling projects.';

comment on table memberships is
  'THE LINK: one person''s relationship with one organization, carrying their roll status there. A transfer does not move or copy a person - it ends the membership at the losing church and opens one at the receiving church against the same people row. An installed pastor holds two at once. Also the composite-FK target for every org record about a person.';
comment on column memberships.current_roll is
  'active | baptized | affiliate | other_participant. A CACHE maintained by trigger from approved roll_actions; it cannot answer historical questions, so reports replay through roll_as_of() instead.';
comment on column memberships.engagement_status is
  'visitor | regular | inactive | moved_away. The pastoral axis, never reported. Distinct from the constitutional roll: an active participant who never joined has an engagement status and no roll at all.';
comment on column memberships.ended_on is
  'Set on dismissal or departure. The row is retained - the register needs the history.';
comment on column memberships.external_ids is
  'Foreign keys from other systems: Church360 person id, giving envelope number, Mailchimp id.';

comment on table person_identifiers is
  'Deterministic identity. Email cannot be the key on people - couples share addresses, children and older members often have none, and emails change while identity must not. So identifiers are EVIDENCE, unique only where uniqueness is safe: the partial index covers verified, non-shared values. Everything else is a matching signal.';
comment on column person_identifiers.is_shared is
  'The household address two spouses share. Explicitly opts out of uniqueness rather than silently colliding and merging two people into one.';
comment on column person_identifiers.is_verified is
  'We proved this person controls it - clicked a link, signed in - not merely that a church typed it in.';

comment on table households is 'A church''s grouping of people at one address. Counted on the statistical report as "potential giving units".';
comment on table addresses is 'GLOBAL. An address belongs to the person, not to a congregation''s record of them, so an installed pastor''s address cannot diverge between presbytery and congregation.';
comment on column addresses.season_start is 'Snowbirds. The statistical report names them explicitly as a common affiliate-member case.';
comment on table contact_methods is 'GLOBAL, for the same reason as addresses.';
comment on table person_relationships is 'Relationships a household cannot express: guardian, emergency contact, caregiver. Load-bearing for children''s check-in.';

-- ── Rolls ───────────────────────────────────────────────────────────────────
comment on table roll_actions is
  'The membership roll as an event log. The statistical report asks for CHANGES over a year, not a snapshot, so a stored status field cannot produce it - which is why every clerk hand-tallies this in January. Approved rows are frozen by trigger; corrections are recorded as voiding actions.';
comment on column roll_actions.age_at_action is
  'Frozen at record time. Birthdates are often unknown or corrected later, and the profession-of-faith split at age 17/18 must not shift retroactively once a year is reported.';
comment on column roll_actions.approval_status is
  'pending | approved | denied. Pending rows are mutable working state and form the clerk''s session agenda; approval freezes the row.';
comment on column roll_actions.kind is
  'opening_balance establishes state without counting as a gain, for a congregation joining mid-life with an official prior-year balance but no history.';

comment on table transfer_certificates is
  'A two-sided transfer. Neither congregation can write into the other, so the losing church issues a certificate and the receiving church claims it by token - which is how certificates of transfer actually work. Off-platform churches simply never claim, and it expires.';

-- ── Officers ────────────────────────────────────────────────────────────────
comment on table ordinations is
  'Ordination is LIFELONG. A person off session is still an ordained ruling elder, which is why this is separate from officer_terms. Conflating the two breaks the register and irritates every clerk.';
comment on table officer_terms is
  'A term of ACTIVE service, which is a span rather than an event - a resignation sets ends_on. An exclusion constraint prevents two simultaneous terms in the same office while allowing gaps, so someone may serve, roll off, and return. This is the register of ruling elders and deacons required by G-3.0204(b).';
comment on column officer_terms.class_year is
  'Display label only. Boards are divided into three classes with one elected each year and nominating committees plan by class, but DATES ARE AUTHORITATIVE - every query reads starts_on/ends_on.';
comment on column officer_terms.ends_on is
  'Null means open-ended, for offices like clerk of session. A trigger propagates this into the derived group roster so access drops the day the term does.';

-- ── Groups ──────────────────────────────────────────────────────────────────
comment on table groups is
  'A group is a fact about people; a role is a grant of authority. Rock RMS collapses the two - we do not, because the SESSION IS NOT A GROUP OF PEOPLE, IT IS A COURT. Its membership is constitutionally determined, so if staff could add someone the court would be invalid and every action it minuted questionable.';
comment on column groups.membership_source is
  'managed | derived. Derived rosters (session, diaconate) are materialized from officer_terms by trigger and reject direct writes.';
comment on table group_memberships is
  'Materialized rather than exposed as a view, because the permission resolver reads this table - a view would be invisible to it and a role granted to the Session group would resolve to nobody.';
comment on column group_memberships.officer_term_id is
  'Derived rows map 1:1 to the term that produced them. Without it the trigger cannot tell two non-consecutive terms apart and silently rewrites the earlier one''s end date, destroying the record of who served when.';

-- ── Authorization ───────────────────────────────────────────────────────────
comment on table permissions is
  'The global, code-seeded catalog. Churches compose roles from these keys but can never invent one, because a church-invented permission is a string nothing checks.';
comment on column permissions.sensitivity_tier is
  '1 directory, 2 financial, 3 pastoral and demographic. Pastoral notes sit ABOVE financial data: they carry clergy confidentiality, and the AI support worker receives no grant on them under any elevation.';
comment on table app_roles is
  'Roles are per-church because the variance is real: a 40-member church has one person who is clerk, treasurer, and directory admin, while a large one has staff with actual separation of duties. Constitutional roles are seeded per organization type and protected from deletion.';
comment on table role_grants is
  'Granted to EITHER a person or a group. Group grants exist because otherwise adding someone to a committee is two admin tasks and removing them is also two - and the second never gets done, so orphaned permissions accumulate silently in a volunteer-run church.';
comment on table administrative_commissions is
  'The one case where a council reaches DOWN into a congregation, when a presbytery assumes original jurisdiction over a session. Time-boxed, minuted, and visible in the congregation''s own access log.';
comment on table org_delegations is
  'A congregation with nobody technical asking another council to administer its portal. Granted by session action, revocable, never inherited - the distinction that keeps "presbytery admin" from meaning authority over churches.';

-- ── Privacy ─────────────────────────────────────────────────────────────────
comment on table person_privacy is
  'Preferences: toggles the person changes freely. Distinct from consents, which are dated records.';
comment on table consents is
  'Records, not flags. A directory gets printed, PDF''d, and pushed to a kiosk, so "who agreed, when, and how" needs an answer - and for minors, which guardian granted it.';
comment on table person_demographics is
  'Tier 3. Categories are the exact statistical-report values; racial-ethnic is self-identified ("be guided by how an individual describes themselves").';
comment on table person_disabilities is
  'THE SHARPEST EDGE IN THE DATASET. The statistical report instructs clerks to record this from personal knowledge and explicitly not to survey - staff-observed, health-adjacent data held without consent. Gated behind a per-church opt-in; when off, the report lines are entered as aggregate counts and this table stays empty.';
comment on table person_notes is
  'Pastoral care. visibility=clergy_only is the strictest grant in the system.';
comment on table background_checks is
  'expires_on is the operationally important column: churches need "whose check lapses in 60 days", and a lapsed check on a nursery volunteer is a real liability. Stores a provider reference and status, never the underlying report.';
comment on table person_medical is 'Tier 3. Allergies and authorized pickup for children''s check-in.';

-- ── Reporting ───────────────────────────────────────────────────────────────
comment on table sasr_reports is
  'The Session Annual Statistical Report, filed by every congregation to its presbytery under G-3.0202f. This is the publish-upward contract: a congregation''s data stays congregation-scoped and defined aggregates are published, which is why a presbytery has no read access inside a member church.';
comment on column sasr_reports.official_beginning_balance is
  'From last year''s General Assembly Minutes. IMMUTABLE - "this figure cannot be changed". When our computed roll disagrees, the difference is pushed into Other Gains or Other Losses with a generated explanation, never silently corrected.';
comment on column sasr_reports.computed_beginning_balance is
  'What our roll actually says. NULL for an unmanaged congregation, which has no roll - and the projection must render that as "not derived" rather than 0, or a presbytery-entered report becomes a fabricated decline in the denomination''s statistics.';
comment on column sasr_reports.status is
  'draft | session_approved | submitted. Submission CLOSES the year: an action approved afterwards but effective within it counts in the open year''s Other Gains, so a filed report is never retroactively altered.';

-- ── Misc ────────────────────────────────────────────────────────────────────
comment on table tags is 'The only tenant-extensible attribute in the schema. Custom fields were designed and deliberately removed: a per-church field nobody designed has no validation, no reporting, and no enforced sensitivity tier. New needs go through a support ticket and, if real, become a feature for every church.';
comment on table follow_ups is 'The visitor-to-member funnel. Breeze calls these Follow Ups, Planning Center calls them Workflows.';
comment on table person_milestones is 'Sacraments and life events. This IS the register of baptisms required by G-3.0204(b).';
comment on table talent_types is 'Spiritual gifts, skills, and serving interests. Default private, carried over from fpcw.';

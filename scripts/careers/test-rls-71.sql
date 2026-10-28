-- ---------------------------------------------------------------------------
-- 71. Careers, Increment 1: job postings (drizzle/0071_presby_careers.sql;
--     DECISION-264/265/278, F292; docs/work-log/2026-10-25-careers-inc1.md
--     Phase 3 tests T1-T5).
--
--     INTEGRATION (Rule 16): scripts/test-rls.sql gains ONE line at its end,
--     after the last section's closing banner, and its template-role count
--     moves from six to seven (scripts/careers/test-rls.sql.integration.patch):
--
--         \ir careers/test-rls-71.sql
--
--     Standalone (MUST be presby_app - the owner bypasses everything here):
--
--         psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/careers/test-rls-71.sql
--
--     after scripts/install-test-helpers.sql (owner). Needs the stock
--     scripts/seed-dev.sql fixture AND scripts/careers/seed-dev-careers.sql,
--     for ONE thing only: Fernwood's and Marrowbone's `live` site rows
--     (presby_app holds no grant on organization_sites, DECISION-081, so it
--     cannot build a serving site itself). Every posting, toggle, category
--     and time-zone state asserted below is built inside its own block, and
--     every block ends in rollback, so the suite writes nothing durable and
--     does not depend on the seed's postings.
--
--     Sections:
--       (a) structure: FORCE RLS, the one policy, the composite key, the
--           three guards (enabled, invoker, search_path pinned)
--       (b) T1 catalog and bundle: both keys, the hiring_committee template,
--           the backfill, the SQL bundle's array
--       (c) T2 grants and isolation
--       (d) T3 guards, presby_app half
--       (e) T4 the public definer
--       (f) T5 the sweep's and the helper's ACLs; the helper's zones
--
--     What presby_app CANNOT reach is proven on the owner connection in
--     Vitest instead (src/lib/db/domain/careers.db.test.ts): the guards on
--     the OWNER path (born draft, forced stamps, immutables, illegal edges,
--     slug fixed after publish, owner-supplied posted_on at first publish
--     only, the delete guard), the teardown cascade, two concurrent publishes
--     racing for the 100th place, the public list's 100-row limit (needs the
--     cap trigger disabled), an inactive organization, and the sweep's
--     behaviour (owner-only).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\set ALDER     '\'22222222-2222-2222-2222-222222222222\''
\set FERN      '\'55555555-5555-5555-5555-555555555555\''
\set MARROW    '\'66666666-6666-6666-6666-666666666666\''

\echo '======================================================'
\echo ' Section 71 (careers, drizzle/0071) starting.'
\echo '======================================================'

select assert_eq(
  (select count(*) from pg_roles where rolname = current_user and not rolbypassrls and current_user = 'presby_app'),
  1, '71: this section runs as presby_app, which is NOBYPASSRLS (F1) - as the owner it would prove nothing');

-- ===========================================================================
-- (a) Structure
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'job_postings' and relkind = 'r'
        and relrowsecurity and relforcerowsecurity),
    1, '71a: job_postings has row level security ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'job_postings' and policyname = 'tenant_isolation'
        and cmd = 'ALL'
        and qual = '(organization_id = presby_current_org())'
        and with_check = '(organization_id = presby_current_org())'),
    1, '71a: tenant_isolation carries BOTH using and with check on presby_current_org()');
  select assert_eq(
    (select count(*) from pg_policies where tablename = 'job_postings'),
    1, '71a: and no other policy');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'job_postings'::regclass and c.contype = 'u'
        and c.conname = 'job_postings_id_org_key'
        and (select array_agg(a.attname::text order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
            = array['id', 'organization_id']),
    1, '71a: unique (id, organization_id) exists - the target of Increment 2''s composite FK (F2)');
  select assert_eq(
    (select count(*) from pg_constraint c
      where c.conrelid = 'job_postings'::regclass and c.contype = 'u'
        and c.conname = 'job_postings_org_slug_key'),
    1, '71a: the slug is unique per organization');
  select assert_eq(
    (select count(*) from pg_trigger t
      where t.tgrelid = 'job_postings'::regclass and not t.tgisinternal
        and t.tgenabled = 'O'
        and t.tgname in ('job_postings_guard_insert', 'job_postings_guard_update', 'job_postings_guard_delete')),
    3, '71a: the three BEFORE ROW guards exist and are ENABLED (origin) - they bind the owner too (F44)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_job_postings_guard_insert', 'presby_job_postings_guard_update',
                          'presby_job_postings_guard_delete')
        and not p.prosecdef
        and p.proconfig = array['search_path=public, pg_temp']),
    3, '71a: the guards are SECURITY INVOKER with search_path pinned (they lend no owner privilege)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.proname in ('presby_job_postings_guard_insert', 'presby_job_postings_guard_update',
                          'presby_job_postings_guard_delete')
        and p.proacl = array[(pg_get_userbyid(p.proowner) || '=X/' || pg_get_userbyid(p.proowner))::aclitem]),
    3, '71a: the guard functions are executable by their owner alone (revoked from PUBLIC, presby_app, presby_platform)');
rollback;

-- ===========================================================================
-- (b) T1 - catalog and bundle (F292, DECISION-265)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from permissions
      where (key, module, sensitivity_tier, requires_two_factor)
            in (('careers.manage', 'careers', 1, false), ('careers.applicants', 'careers', 3, false))),
    2, '71b: careers.manage is tier 1 and careers.applicants tier 3, module careers, neither requires 2FA (Q3)');
  select assert_eq(
    (select count(*) from app_roles where organization_id is null and key = 'hiring_committee'),
    1, '71b: exactly one hiring_committee template');
  select assert_eq(
    (select count(*) from app_roles
      where organization_id is null and key = 'hiring_committee'
        and organization_type_scope is null and role_kind = 'custom' and not is_protected
        and name = 'Hiring Committee' and deactivated_at is null),
    1, '71b: hiring_committee is universal (presbyteries and synods hire), custom (DECISION-078), unprotected');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key = 'hiring_committee'),
    2, '71b: hiring_committee carries exactly two keys');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key = 'hiring_committee'
        and rp.permission_key in ('careers.manage', 'careers.applicants')),
    2, '71b: and they are careers.manage and careers.applicants');
  select assert_eq(
    (select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id
      where r.organization_id is null and r.key <> 'hiring_committee'
        and rp.permission_key in ('careers.manage', 'careers.applicants')),
    0, '71b: no OTHER template carries a careers key (the stated-clerk offices included: hiring is no office''s duty)');
  -- The 0057-style backfill: every org-owned founding_administrator role, at
  -- every organization (the 47n pattern; development holds none, a
  -- designation made before deploy would).
  do $$
  declare v_roles integer; v_missing integer;
  begin
    select count(*) into v_roles from app_roles r
     where r.key = 'founding_administrator' and r.organization_id is not null;
    select count(*) into v_missing from app_roles r
     where r.key = 'founding_administrator' and r.organization_id is not null
       and (select count(*) from app_role_permissions rp
             where rp.role_id = r.id and rp.permission_key in ('careers.manage', 'careers.applicants')) <> 2;
    if v_missing <> 0 then
      raise exception 'FAIL 71b: % of % founding_administrator roles lack a careers key (F292 backfill)', v_missing, v_roles;
    end if;
    raise notice 'pass  71b: every founding_administrator role, at every organization (% found), holds both careers keys', v_roles;
  end $$;
  -- The SQL authority. presby_app cannot EXECUTE it (owner only, 0059), but
  -- pg_proc is world-readable: the body's array names both keys right after
  -- domains.manage, the order the TypeScript plan uses (invitations.db.test.ts
  -- compares the two arrays in order for every organization_type).
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_founding_administrator_permission_keys(text)'::regprocedure
        and p.prosrc like '%''domains.manage'', ''careers.manage'', ''careers.applicants''%'
        and p.prosecdef and p.provolatile = 'i'
        and p.proconfig = array['search_path=public, pg_temp']),
    1, '71b: presby_founding_administrator_permission_keys() carries careers.manage, careers.applicants after domains.manage, still immutable SECURITY DEFINER with search_path pinned');
  select assert_eq(
    (select count(*) where has_function_privilege('presby_app', 'presby_founding_administrator_permission_keys(text)', 'execute')),
    0, '71b: and presby_app still cannot execute it (the re-create re-applied the revoke)');
rollback;

-- ===========================================================================
-- (c) T2 - grants and isolation
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from information_schema.table_privileges
      where table_name = 'job_postings' and grantee = 'presby_app'),
    1, '71c: presby_app holds exactly one TABLE-level privilege on job_postings');
  select assert_eq(
    (select count(*) where has_table_privilege('presby_app', 'job_postings', 'select')),
    1, '71c: and it is SELECT');
  select assert_eq(
    (select count(*) where has_table_privilege('presby_app', 'job_postings', 'delete')
                        or has_table_privilege('presby_app', 'job_postings', 'truncate')),
    0, '71c: presby_app may neither DELETE nor TRUNCATE (postings are permanent, D12)');
  select assert_eq(
    (select count(*) from (
       select string_agg(column_name, ',' order by column_name) as cols
         from information_schema.column_privileges
        where table_name = 'job_postings' and grantee = 'presby_app' and privilege_type = 'INSERT') x
      where x.cols = 'closing_date,created_by,description_md,employment_type,location,organization_id,pay_max_cents,pay_min_cents,pay_unit,slug,summary,title,updated_by'),
    1, '71c: presby_app INSERTs exactly the 13 staff-authored columns (no status, sort_order, version or stamp)');
  select assert_eq(
    (select count(*) from (
       select string_agg(column_name, ',' order by column_name) as cols
         from information_schema.column_privileges
        where table_name = 'job_postings' and grantee = 'presby_app' and privilege_type = 'UPDATE') x
      where x.cols = 'closing_date,description_md,employment_type,location,pay_max_cents,pay_min_cents,pay_unit,slug,sort_order,status,summary,title,updated_by'),
    1, '71c: presby_app UPDATEs exactly the 13 editable columns (no id, organization_id, version, stamps, created_*, updated_at)');
  select assert_eq(
    (select count(*) from pg_class c, aclexplode(c.relacl) a
      where c.relname = 'job_postings'
        and (a.grantee = 0 or a.grantee = 'presby_platform'::regrole)),
    0, '71c: PUBLIC and presby_platform hold NOTHING on job_postings (Two Hierarchies)');
rollback;

begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into job_postings (organization_id, slug, title)
  values (:FERN, 't71-isolation', 'Isolation probe');
  select set_config('t71.a1', (select id::text from job_postings where slug = 't71-isolation'), true);
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.a1')::uuid),
    1, '71c: Fernwood reads its own posting');
  select assert_eq((select count(*) from job_postings where organization_id <> :FERN),
    0, '71c: and nothing from any other organization');

  select set_config('app.current_org_id', :MARROW, true);
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.a1')::uuid),
    0, '71c: Marrowbone cannot read Fernwood''s posting by its known id');
  do $$
  declare n integer;
  begin
    update job_postings set title = 'Hijacked' where id = current_setting('t71.a1')::uuid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 71c: Marrowbone updated % of Fernwood''s rows', n; end if;
    raise notice 'pass  71c: Marrowbone''s UPDATE of Fernwood''s posting touches zero rows';
  end $$;
  do $$
  begin
    insert into job_postings (organization_id, slug, title)
    values ('55555555-5555-5555-5555-555555555555', 't71-cross-org', 'Cross-org write');
    raise exception 'FAIL 71c: a cross-org insert succeeded under Marrowbone''s context';
  exception when insufficient_privilege then
    raise notice 'pass  71c: a posting written for Fernwood under Marrowbone''s context is refused by WITH CHECK (%)', sqlerrm;
  end $$;
  do $$
  begin
    delete from job_postings where id = current_setting('t71.a1')::uuid;
    raise exception 'FAIL 71c: presby_app deleted a posting';
  exception when insufficient_privilege then
    raise notice 'pass  71c: DELETE is permission denied for presby_app (%)', sqlerrm;
  end $$;
rollback;

-- ===========================================================================
-- (d) T3 - the guards, presby_app half
-- ===========================================================================
-- Trigger-owned columns are out of reach by GRANT (42501): an INSERT or an
-- UPDATE naming any of them is refused before the guard runs.
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into job_postings (organization_id, slug, title, summary, location, description_md)
  values (:FERN, 't71-guard', 'Guard probe', 'S', 'L', 'D');
  select set_config('t71.b1', (select id::text from job_postings where slug = 't71-guard'), true);
  do $$
  declare v_stmt text;
  begin
    foreach v_stmt in array array[
      $q$insert into job_postings (organization_id, slug, title, status) values ('55555555-5555-5555-5555-555555555555', 't71-born-published', 'x', 'published')$q$,
      $q$insert into job_postings (organization_id, slug, title, version) values ('55555555-5555-5555-5555-555555555555', 't71-born-v9', 'x', 9)$q$,
      $q$insert into job_postings (organization_id, slug, title, sort_order) values ('55555555-5555-5555-5555-555555555555', 't71-born-sorted', 'x', -5)$q$,
      $q$update job_postings set version = 99 where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set first_published_at = now() where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set posted_on = date '2020-01-01' where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set closed_at = now() where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set updated_at = now() where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set created_by = null where id = current_setting('t71.b1')::uuid$q$,
      $q$update job_postings set organization_id = '66666666-6666-6666-6666-666666666666' where id = current_setting('t71.b1')::uuid$q$
    ] loop
      begin
        execute v_stmt;
        raise exception 'FAIL 71d: presby_app ran: %', v_stmt;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
    raise notice 'pass  71d: 10 writes naming status/version/sort_order on insert, or version, stamps, created_by, organization_id on update, are permission denied';
  end $$;

  -- Born a draft, version 1, no stamps.
  select assert_eq(
    (select count(*) from job_postings
      where id = current_setting('t71.b1')::uuid and status = 'draft' and version = 1
        and first_published_at is null and posted_on is null and closed_at is null and sort_order = 0),
    1, '71d: a new posting is a draft, version 1, unstamped, sort_order 0');

  -- The slug may change while the posting has never been published.
  update job_postings set slug = 't71-guard-renamed' where id = current_setting('t71.b1')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b1')::uuid
                      and slug = 't71-guard-renamed' and version = 2),
    1, '71d: the slug changes before first publish, and the change bumps version (1 -> 2)');

  -- A same-status update is not an edge.
  update job_postings set status = 'draft' where id = current_setting('t71.b1')::uuid;
  select assert_eq((select version from job_postings where id = current_setting('t71.b1')::uuid)::bigint,
    2, '71d: draft -> draft is not an edge and bumps nothing');

  -- sort_order alone bumps neither version nor updated_at.
  update job_postings set sort_order = 42 where id = current_setting('t71.b1')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b1')::uuid
                      and sort_order = 42 and version = 2),
    1, '71d: a sort_order change alone does not bump version');

  -- draft -> published (publish).
  update job_postings set status = 'published' where id = current_setting('t71.b1')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b1')::uuid
                      and status = 'published' and version = 3 and first_published_at is not null
                      and posted_on = presby_careers_org_today(:FERN) and closed_at is null
                      and sort_order = (select coalesce(min(sort_order), 1) - 1 from job_postings
                                         where organization_id = :FERN and status = 'published'
                                           and id <> current_setting('t71.b1')::uuid)),
    1, '71d: publish stamps first_published_at and posted_on (org today), bumps version, and puts the posting at the top of the order');

  -- The slug is fixed once published.
  do $$
  begin
    update job_postings set slug = 't71-guard-too-late' where id = current_setting('t71.b1')::uuid;
    raise exception 'FAIL 71d: a published posting''s slug changed';
  exception when check_violation then
    if sqlerrm not like 'job_postings: the slug is fixed%' then raise; end if;
    raise notice 'pass  71d: the slug is refused after publish (%)', sqlerrm;
  end $$;

  -- published -> draft is refused.
  do $$
  begin
    update job_postings set status = 'draft' where id = current_setting('t71.b1')::uuid;
    raise exception 'FAIL 71d: published -> draft succeeded';
  exception when check_violation then
    if sqlerrm not like 'job_postings: published -> draft is not a legal status change%' then raise; end if;
    raise notice 'pass  71d: published -> draft is refused (%)', sqlerrm;
  end $$;

  -- published -> closed (close).
  update job_postings set status = 'closed' where id = current_setting('t71.b1')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b1')::uuid
                      and status = 'closed' and closed_at is not null and version = 4
                      and first_published_at is not null and posted_on is not null),
    1, '71d: close stamps closed_at and keeps first_published_at and posted_on');

  -- closed -> draft is refused.
  do $$
  begin
    update job_postings set status = 'draft' where id = current_setting('t71.b1')::uuid;
    raise exception 'FAIL 71d: closed -> draft succeeded';
  exception when check_violation then
    if sqlerrm not like 'job_postings: closed -> draft is not a legal status change%' then raise; end if;
    raise notice 'pass  71d: closed -> draft is refused (%)', sqlerrm;
  end $$;

  -- closed -> published (reopen), with a passed closing date: refused.
  update job_postings set closing_date = presby_careers_org_today(:FERN) - 1
   where id = current_setting('t71.b1')::uuid;
  do $$
  begin
    update job_postings set status = 'published' where id = current_setting('t71.b1')::uuid;
    raise exception 'FAIL 71d: a posting reopened with a passed closing date';
  exception when check_violation then
    if sqlerrm not like 'job_postings: the closing date % has passed%' then raise; end if;
    raise notice 'pass  71d: reopening with a passed closing date is refused (%)', sqlerrm;
  end $$;

  -- ...and with today's closing date (inclusive): allowed. closed_at cleared.
  update job_postings set closing_date = presby_careers_org_today(:FERN)
   where id = current_setting('t71.b1')::uuid;
  update job_postings set status = 'published' where id = current_setting('t71.b1')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b1')::uuid
                      and status = 'published' and closed_at is null and first_published_at is not null),
    1, '71d: reopen (closing date today, inclusive) clears closed_at and keeps first_published_at');

  -- The slug stays fixed after a reopen.
  do $$
  begin
    update job_postings set slug = 't71-after-reopen' where id = current_setting('t71.b1')::uuid;
    raise exception 'FAIL 71d: the slug changed after reopen';
  exception when check_violation then
    raise notice 'pass  71d: the slug is still fixed after a reopen (%)', sqlerrm;
  end $$;

  -- A published posting cannot lose its summary, location or description.
  do $$
  declare v_col text;
  begin
    foreach v_col in array array['summary', 'location', 'description_md'] loop
      begin
        execute format('update job_postings set %I = %L where id = %L', v_col, '  ',
                       current_setting('t71.b1')::uuid);
        raise exception 'FAIL 71d: a published posting''s % was blanked', v_col;
      exception when check_violation then
        null;
      end;
    end loop;
    raise notice 'pass  71d: a published posting''s summary, location and description cannot be blanked (job_postings_complete_when_live)';
  end $$;
rollback;

-- Discard: draft -> closed, including an INCOMPLETE draft (the deviation the
-- 0071 header records), never public afterwards.
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into job_postings (organization_id, slug, title)
  values (:FERN, 't71-discard', 'Discard probe');
  select set_config('t71.b2', (select id::text from job_postings where slug = 't71-discard'), true);
  do $$
  begin
    update job_postings set status = 'published' where id = current_setting('t71.b2')::uuid;
    raise exception 'FAIL 71d: an incomplete draft was published';
  exception when check_violation then
    raise notice 'pass  71d: publishing with an empty summary, location and description is refused (%)', sqlerrm;
  end $$;
  update job_postings set status = 'closed' where id = current_setting('t71.b2')::uuid;
  select assert_eq((select count(*) from job_postings where id = current_setting('t71.b2')::uuid
                      and status = 'closed' and closed_at is not null and first_published_at is null and posted_on is null),
    1, '71d: an incomplete draft can be discarded (draft -> closed) and is never stamped published');
rollback;

-- Publishing with a passed closing date: refused.
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into job_postings (organization_id, slug, title, summary, location, description_md, closing_date)
  values (:FERN, 't71-late', 'Late', 'S', 'L', 'D',
          presby_careers_org_today(:FERN) - 1);
  select set_config('t71.b3', (select id::text from job_postings where slug = 't71-late'), true);
  do $$
  begin
    update job_postings set status = 'published' where id = current_setting('t71.b3')::uuid;
    raise exception 'FAIL 71d: a posting published with a passed closing date';
  exception when check_violation then
    if sqlerrm not like 'job_postings: the closing date % has passed%' then raise; end if;
    raise notice 'pass  71d: publishing with a passed closing date is refused (%)', sqlerrm;
  end $$;
rollback;

-- The pay CHECKs.
begin;
  select set_config('app.current_org_id', :FERN, true);
  do $$
  declare v_case text[];
  begin
    foreach v_case slice 1 in array array[
      array['unit without amounts',  'null', 'null', '''hour'''],
      array['amounts without unit',  '1000', '2000', 'null'],
      array['min over max',          '3000', '2000', '''year'''],
      array['negative',              '-1',   'null', '''hour'''],
      array['over the cap',          'null', '100000001', '''year'''],
      array['unknown unit',          '1000', 'null', '''month''']
    ] loop
      begin
        execute format('insert into job_postings (organization_id, slug, title, pay_min_cents, pay_max_cents, pay_unit) '
                       'values (%L, %L, %L, %s, %s, %s)',
                       '55555555-5555-5555-5555-555555555555', 't71-pay', 'Pay', v_case[2], v_case[3], v_case[4]);
        raise exception 'FAIL 71d: pay % accepted', v_case[1];
      exception when check_violation then
        null;
      end;
    end loop;
    raise notice 'pass  71d: the six bad pay shapes are refused (unit without amounts, amounts without unit, min over max, negative, over the cap, unknown unit)';
  end $$;
  insert into job_postings (organization_id, slug, title, pay_min_cents, pay_max_cents, pay_unit)
  values (:FERN, 't71-pay-ok', 'Pay ok', 0, 100000000, 'year'),
         (:FERN, 't71-pay-from', 'Pay from', 1500, null, 'hour');
  select assert_eq((select count(*) from job_postings where slug in ('t71-pay-ok', 't71-pay-from')),
    2, '71d: a 0-to-cap range and a min-only amount with a unit are accepted');
rollback;

-- D13: the 101st published posting at an organization is refused. Set-based:
-- top the organization up to exactly 100 published in one statement, then
-- try one more. (Two concurrent publishes racing for the 100th place:
-- careers.db.test.ts, which has two connections.)
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into job_postings (organization_id, slug, title, summary, location, description_md)
  select :FERN, 't71-cap-' || g, 'Cap ' || g, 'S', 'L', 'D'
    from generate_series(1, 101) g;
  update job_postings set status = 'published'
   where organization_id = :FERN and slug like 't71-cap-%'
     and (case when slug like 't71-cap-%' then substring(slug from 9)::int end)
         <= 100 - (select count(*) from job_postings where organization_id = :FERN and status = 'published');
  select assert_eq((select count(*) from job_postings where organization_id = :FERN and status = 'published'),
    100, '71d: Fernwood now holds exactly 100 published postings');
  do $$
  declare v_slug text;
  begin
    select slug into v_slug from job_postings
     where organization_id = '55555555-5555-5555-5555-555555555555' and slug like 't71-cap-%' and status = 'draft'
     order by slug limit 1;
    update job_postings set status = 'published'
     where organization_id = '55555555-5555-5555-5555-555555555555' and slug = v_slug;
    raise exception 'FAIL 71d: a 101st posting was published';
  exception when check_violation then
    if sqlerrm not like 'job_postings: cap - at most 100 published postings per organization%' then raise; end if;
    raise notice 'pass  71d: the 101st published posting is refused (%)', sqlerrm;
  end $$;
rollback;

-- ===========================================================================
-- (e) T4 - the public definer, presby_app (the anonymous connection)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_public_careers(text,text)'::regprocedure
        and p.prosecdef and p.provolatile = 's'
        and p.proconfig = array['search_path=public, pg_temp']
        and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
               from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(r order by r) from unnest(array[pg_get_userbyid(p.proowner)::text, 'presby_app']) r)),
    1, '71e: presby_public_careers is SECURITY DEFINER, stable, search_path pinned, executable by exactly the owner and presby_app (no PUBLIC, no presby_platform)');
rollback;

-- Six reasons for unavailable, one byte-identical row. Each cause is built on
-- its own inside this block (the toggle and the category through presby_app's
-- own grants, the axis flag through its UPDATE on feature_flags), and the
-- whole row is captured as text.
begin;
  create temp table t71_unavailable (cause text, n integer, r text) on commit drop;
  -- A known-good baseline first: Fernwood is live (seed) with the toggle on.
  select set_config('app.current_org_id', :FERN, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.careers', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  select assert_eq((select count(*) from presby_public_careers('fernwood') where state = 'available'),
    1, '71e: baseline - Fernwood (live site, toggle on) is available');

  insert into t71_unavailable select 'unknown slug', count(*) over (), (x.*)::text from presby_public_careers('t71-no-such-org') x;
  insert into t71_unavailable select 'null slug', count(*) over (), (x.*)::text from presby_public_careers(null) x;
  select set_config('app.current_org_id', :ALDER, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:ALDER, 'org_portal.careers', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  insert into t71_unavailable select 'site not live (Alder Creek is provisioning)', count(*) over (), (x.*)::text from presby_public_careers('alder-creek') x;
  select set_config('app.current_org_id', :FERN, true);
  update organization_feature_toggles set enabled = false
   where organization_id = :FERN and feature_key = 'org_portal.careers';
  insert into t71_unavailable select 'toggle off', count(*) over (), (x.*)::text from presby_public_careers('fernwood') x;
  insert into t71_unavailable select 'toggle off, posting read', count(*) over (), (x.*)::text from presby_public_careers('fernwood', 'music-director') x;
  delete from organization_feature_toggles where organization_id = :FERN and feature_key = 'org_portal.careers';
  insert into t71_unavailable select 'toggle row missing', count(*) over (), (x.*)::text from presby_public_careers('fernwood') x;
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.careers', true);
  insert into organization_feature_categories (organization_id, category, enabled)
  values (:FERN, 'people', false)
  on conflict (organization_id, category) do update set enabled = false;
  -- Axis OFF: the category row is inert.
  select assert_eq((select count(*) from presby_public_careers('fernwood') where state = 'available'),
    1, '71e: with the category axis OFF, a people-off category row is inert (available)');
  update feature_flags set enabled = true where key = 'org_portal.feature_categories';
  insert into t71_unavailable select 'people category off, axis on', count(*) over (), (x.*)::text from presby_public_careers('fernwood') x;
  -- Axis ON, category row missing: on.
  delete from organization_feature_categories where organization_id = :FERN and category = 'people';
  select assert_eq((select count(*) from presby_public_careers('fernwood') where state = 'available'),
    1, '71e: with the axis ON and no people category row, the category is on (available)');

  select assert_eq((select count(*) from t71_unavailable), 7, '71e: seven unavailable causes captured');
  select assert_eq((select count(*) from t71_unavailable where n <> 1), 0, '71e: every cause returned exactly ONE row');
  select assert_eq((select count(distinct r) from t71_unavailable), 1, '71e: and the row is byte-identical for every cause');
  select assert_eq((select count(*) from t71_unavailable where r = '(unavailable,,,,,)'), 7,
    '71e: and it is (unavailable, null, null, null, null, null) - nothing about the organization');
rollback;

-- The list and the posting projections. Built at Fernwood with its zone
-- set to Pacific/Kiritimati (UTC+14), then again for Pacific/Pago_Pago
-- (UTC-11): "today" is the ORGANIZATION's date, computed here independently
-- of presby_careers_org_today().
begin;
  select set_config('app.current_org_id', :FERN, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:FERN, 'org_portal.careers', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  update feature_flags set enabled = false where key = 'org_portal.feature_categories';
  insert into organization_settings (organization_id, time_zone) values (:FERN, 'Pacific/Kiritimati')
  on conflict (organization_id) do update set time_zone = 'Pacific/Kiritimati';

  insert into job_postings (organization_id, slug, title, summary, location, description_md,
                            employment_type, pay_min_cents, pay_max_cents, pay_unit)
  values
    (:FERN, 't71-open',      'Open',      'S', 'L', 'D', 'full_time', 100, 200, 'hour'),
    (:FERN, 't71-today',     'Today',     'S', 'L', 'D', 'part_time', null, null, null),
    (:FERN, 't71-yesterday', 'Yesterday', 'S', 'L', 'D', 'intern', null, null, null),
    (:FERN, 't71-closed',    'Closed',    'S', 'L', 'Secret closed description', 'full_time', null, null, null),
    (:FERN, 't71-draft',     'Draft',     'S', 'L', 'D', 'full_time', null, null, null),
    (:FERN, 't71-discarded', 'Discarded', 'S', 'L', 'D', 'full_time', null, null, null);
  select set_config('t71.e6', (select id::text from job_postings where slug = 't71-discarded'), true);
  select set_config('t71.e5', (select id::text from job_postings where slug = 't71-draft'), true);
  select set_config('t71.e4', (select id::text from job_postings where slug = 't71-closed'), true);
  select set_config('t71.e3', (select id::text from job_postings where slug = 't71-yesterday'), true);
  select set_config('t71.e2', (select id::text from job_postings where slug = 't71-today'), true);
  select set_config('t71.e1', (select id::text from job_postings where slug = 't71-open'), true);
  -- t71-open first, on its own: each publish goes to the top of the order,
  -- so t71-today (published after it) must list above it.
  update job_postings set status = 'published' where id = current_setting('t71.e1')::uuid;
  update job_postings set status = 'published'
   where id in (current_setting('t71.e2')::uuid, current_setting('t71.e3')::uuid,
                current_setting('t71.e4')::uuid);
  update job_postings set closing_date = (now() at time zone 'Pacific/Kiritimati')::date
   where id = current_setting('t71.e2')::uuid;
  update job_postings set closing_date = (now() at time zone 'Pacific/Kiritimati')::date - 1
   where id = current_setting('t71.e3')::uuid;
  update job_postings set status = 'closed'
   where id in (current_setting('t71.e4')::uuid, current_setting('t71.e6')::uuid);
  -- A Marrowbone-only posting, for the cross-org direction.
  select set_config('app.current_org_id', :MARROW, true);
  insert into organization_feature_toggles (organization_id, feature_key, enabled)
  values (:MARROW, 'org_portal.careers', true)
  on conflict (organization_id, feature_key) do update set enabled = true;
  insert into job_postings (organization_id, slug, title, summary, location, description_md)
  values (:MARROW, 't71-marrowbone-only', 'Marrowbone only', 'Marrowbone summary', 'L', 'D');
  select set_config('t71.f1', (select id::text from job_postings where slug = 't71-marrowbone-only'), true);
  update job_postings set status = 'published' where id = current_setting('t71.f1')::uuid;
  -- The read runs with NO org context: the anonymous path sets no GUC.
  select set_config('app.current_org_id', '', true);

  create temp table t71_list on commit drop as
    select x.* from presby_public_careers('fernwood') x;
  select assert_eq((select count(*) from t71_list), 1, '71e: the list read returns exactly one row');
  select assert_eq((select count(*) from t71_list where state = 'available' and posting_json is null
                      and organization_name = 'Fernwood Presbyterian Church'
                      and org_today = to_char((now() at time zone 'Pacific/Kiritimati')::date, 'YYYY-MM-DD')),
    1, '71e: available, with the organization''s name and ITS today (Kiritimati) as YYYY-MM-DD, posting_json null');
  select assert_eq((select count(*) from t71_list, jsonb_array_elements(postings_json) e
                      where e->>'slug' in ('t71-open', 't71-today')),
    2, '71e: the open posting and the one closing TODAY (inclusive) are listed');
  select assert_eq((select count(*) from t71_list, jsonb_array_elements(postings_json) e
                      where e->>'slug' in ('t71-yesterday', 't71-closed', 't71-draft', 't71-discarded')),
    0, '71e: closing yesterday, closed, draft and discarded are not');
  select assert_eq((select count(*) from t71_list, jsonb_array_elements(postings_json) e
                      where e->>'slug' = 't71-marrowbone-only'),
    0, '71e: Marrowbone''s posting never appears under Fernwood''s slug');
  select assert_eq((select count(*) from t71_list, jsonb_array_elements(postings_json) e
                      where (select array_agg(k order by k) from jsonb_object_keys(e) k)
                         <> array['closing_date', 'employment_type', 'location', 'pay_max_cents', 'pay_min_cents',
                                  'pay_unit', 'posted_on', 'slug', 'summary', 'title']),
    0, '71e: every list entry carries EXACTLY the ten allow-listed keys (no id, organization, status, version, sort order, timestamps or description)');
  select assert_eq((select count(*) from t71_list, jsonb_array_elements(postings_json) e
                      where e->>'slug' = 't71-open' and e->>'pay_min_cents' = '100' and e->>'pay_unit' = 'hour'
                        and e->>'employment_type' = 'full_time' and e->>'closing_date' is null
                        and e->>'posted_on' = to_char((now() at time zone 'Pacific/Kiritimati')::date, 'YYYY-MM-DD')),
    1, '71e: values come through: pay, type, a null closing date, posted_on as YYYY-MM-DD (the org''s date)');
  select assert_eq((select count(*) from t71_list where postings_json::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-'), 0,
    '71e: no uuid-shaped string anywhere in the list');
  select assert_eq((select count(*) from t71_list
                     where (select array_agg(e->>'slug' order by ord) from jsonb_array_elements(postings_json) with ordinality j(e, ord)
                             where e->>'slug' in ('t71-open', 't71-today'))
                           = array['t71-today', 't71-open']),
    1, '71e: ordered by sort_order: the more recently published t71-today is above t71-open');

  -- One posting.
  select assert_eq((select count(*) from presby_public_careers('fernwood', 't71-open') x
                     where x.state = 'open' and x.postings_json is null
                       and (select array_agg(k order by k) from jsonb_object_keys(x.posting_json) k)
                           = array['closing_date', 'description_md', 'employment_type', 'location', 'pay_max_cents',
                                   'pay_min_cents', 'pay_unit', 'posted_on', 'slug', 'summary', 'title']),
    1, '71e: an open posting is state open with EXACTLY the eleven keys (the ten plus description_md)');
  select assert_eq((select count(*) from presby_public_careers('fernwood', 't71-today') where state = 'open'),
    1, '71e: a posting closing today is open');
  select assert_eq((select count(*) from presby_public_careers('fernwood', 't71-yesterday') x
                     where x.state = 'closed' and x.posting_json = '{"slug": "t71-yesterday", "title": "Yesterday"}'::jsonb),
    1, '71e: a published posting past its closing date is CLOSED to the public at read time (before any sweep), slug and title only');
  select assert_eq((select count(*) from presby_public_careers('fernwood', 't71-closed') x
                     where x.state = 'closed' and x.posting_json = '{"slug": "t71-closed", "title": "Closed"}'::jsonb
                       and x.posting_json::text not like '%Secret%'),
    1, '71e: a closed posting projects slug and title ONLY - never the description (D3)');
  do $$
  declare v_p text; n integer;
  begin
    foreach v_p in array array['t71-draft', 't71-discarded', 't71-no-such-posting', 't71-marrowbone-only',
                               'T71-OPEN', 't71 open', '../t71-open', 't71-open/', repeat('a', 81), '', '-t71', 't71--open'] loop
      select count(*) into n from presby_public_careers('fernwood', v_p) x
       where x.state = 'not_found' and x.organization_name is null and x.contact_phone is null
         and x.org_today is null and x.postings_json is null and x.posting_json is null;
      if n <> 1 then raise exception 'FAIL 71e: % under fernwood was not a bare not_found', v_p; end if;
    end loop;
    raise notice 'pass  71e: draft, discarded draft, unknown, another organization''s slug and 8 malformed slugs are all a bare not_found';
  end $$;
  select assert_eq((select count(*) from presby_public_careers('marrowbone', 't71-marrowbone-only') where state = 'open'),
    1, '71e: the Marrowbone posting is open under Marrowbone''s own slug (positive control for the cross-org case)');
  select assert_eq((select count(*) from presby_public_careers('marrowbone') x, jsonb_array_elements(x.postings_json) e
                     where e->>'slug' like 't71-%' and e->>'slug' <> 't71-marrowbone-only'),
    0, '71e: and none of Fernwood''s postings appear under Marrowbone''s slug');

  -- Pago Pago (UTC-11): the organization's date is now 25 hours behind
  -- Kiritimati's, so t71-today (closing on Kiritimati's today) is still open
  -- and t71-yesterday (Kiritimati's yesterday) is open again if that day is
  -- not before Pago Pago's today.
  select set_config('app.current_org_id', :FERN, true);
  update organization_settings set time_zone = 'Pacific/Pago_Pago' where organization_id = :FERN;
  select set_config('app.current_org_id', '', true);
  select assert_eq((select count(*) from presby_public_careers('fernwood') x
                     where x.org_today = to_char((now() at time zone 'Pacific/Pago_Pago')::date, 'YYYY-MM-DD')),
    1, '71e: after the zone change, org_today is Pago Pago''s date');
  select assert_eq((select count(*) from presby_public_careers('fernwood', 't71-yesterday') x
                     where x.state = case when (now() at time zone 'Pacific/Kiritimati')::date - 1
                                                 >= (now() at time zone 'Pacific/Pago_Pago')::date
                                          then 'open' else 'closed' end),
    1, '71e: open/closed for the same stored closing date follows the ORGANIZATION''s zone');
rollback;

-- ===========================================================================
-- (f) T5 - the sweep and the helper (presby_app half; the sweep's behaviour
--     is owner-only and lives in careers.db.test.ts)
-- ===========================================================================
begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_careers_sweep(integer)'::regprocedure
        and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
        and p.proacl = array[(pg_get_userbyid(p.proowner) || '=X/' || pg_get_userbyid(p.proowner))::aclitem]),
    1, '71f: presby_careers_sweep is SECURITY DEFINER, search_path pinned, executable by its OWNER ALONE (no PUBLIC, presby_app or presby_platform)');
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_careers_sweep(integer)'::regprocedure
        and pg_get_function_result(p.oid) = 'TABLE(kind text, organization_id uuid, posting_id uuid, application_id uuid)'),
    1, '71f: the sweep''s return type is the forward-compatible four columns (D6: Increment 2 re-creates it in place)');
  do $$
  begin
    perform * from presby_careers_sweep(1);
    raise exception 'FAIL 71f: presby_app ran the owner-only sweep';
  exception when insufficient_privilege then
    raise notice 'pass  71f: presby_app calling the sweep is permission denied (%)', sqlerrm;
  end $$;
rollback;

begin;
  select assert_eq(
    (select count(*) from pg_proc p
      where p.oid = 'presby_careers_org_today(uuid)'::regprocedure
        and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, pg_temp']
        and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
               from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
            = (select array_agg(r order by r) from unnest(array[pg_get_userbyid(p.proowner)::text, 'presby_app']) r)),
    1, '71f: presby_careers_org_today is SECURITY DEFINER, stable, search_path pinned, executable by exactly the owner and presby_app');
  select assert_eq(
    (select count(*) where presby_careers_org_today('00000000-0000-0000-0000-00000000ffff')
                         = (now() at time zone 'America/New_York')::date),
    1, '71f: an unknown organization gets the default zone''s date (America/New_York): not an existence oracle');
  select set_config('app.current_org_id', :FERN, true);
  insert into organization_settings (organization_id, time_zone) values (:FERN, 'Pacific/Kiritimati')
  on conflict (organization_id) do update set time_zone = 'Pacific/Kiritimati';
  select set_config('app.current_org_id', '', true);
  select assert_eq(
    (select count(*) where presby_careers_org_today(:FERN) = (now() at time zone 'Pacific/Kiritimati')::date),
    1, '71f: the helper reads the organization''s zone through its own definer rights (no org GUC set)');
  select set_config('app.current_org_id', :FERN, true);
  update organization_settings set time_zone = 'Pacific/Pago_Pago' where organization_id = :FERN;
  select assert_eq(
    (select count(*) where presby_careers_org_today(:FERN) = (now() at time zone 'Pacific/Pago_Pago')::date),
    1, '71f: and follows a zone change');
rollback;

\echo '======================================================'
\echo ' Section 71 (careers) complete.'
\echo '======================================================'

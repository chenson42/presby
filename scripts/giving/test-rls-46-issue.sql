-- scripts/giving/test-rls-46-issue.sql - the section 46 statement harness
-- (drizzle/0056_presby_giving_statements.sql; Batch 5a). Included by
-- test-rls-46.sql with `\ir test-rls-46-issue.sql` (relative to that file),
-- never run on its own. Runs as presby_app, inside the caller's transaction.
--
-- Issues ONE statement exactly the way the application path does - store the
-- PDF bytes in blob_assets (store()'s INSERT), then the header and its lines
-- in one statement - and then forces the DEFERRED consistency triggers with
-- SET CONSTRAINTS ... IMMEDIATE, because every section 46 block ends in
-- ROLLBACK and a deferred trigger never fires on a rollback.
--
-- Inputs: transaction-local GUCs (psql does not interpolate :variables inside
-- a DO body). Required: rls_test.s_org, rls_test.s_donor, rls_test.s_year,
-- rls_test.s_issuer, rls_test.s_label. Optional, each reset to '' by the
-- harness when it finishes so the next call starts clean:
--   rls_test.s_version      (default 1)
--   rls_test.s_supersedes   (a statement id)
--   rls_test.s_total_delta  (cents added to the header's cash_total_cents)
--   rls_test.s_gross_delta  (cents added to line 1's gross_cents)
--   rls_test.s_skip_last    ('true': leave the last counting gift off, header
--                            totals computed from the lines actually written)
--   rls_test.s_extra_gift   (one more gift id, as a line, counted into the header)
--   rls_test.s_no_lines     ('true': write the header, totals and all, but no lines)
--   rls_test.s_blob         ('pdf' | 'json' | 'badhash'; default 'pdf')
--   rls_test.s_expect       ('' = must succeed; otherwise a substring the
--                            refusal's message must contain)
-- Output: rls_test.s_statement = the new statement's id (on success).
--
-- The composition is the reference reading of 0056's counting rule (deviation
-- S4): remaining = gross - net reversed - (covered fee unless counted; this
-- harness always issues with covered_fee_counted = true, the shipped
-- policy); remaining <= 0 is excluded; stock is non_cash; every other method
-- is cash.
do $$
declare
  v_org uuid := current_setting('rls_test.s_org')::uuid;
  v_donor uuid := current_setting('rls_test.s_donor')::uuid;
  v_year integer := current_setting('rls_test.s_year')::integer;
  v_issuer uuid := current_setting('rls_test.s_issuer')::uuid;
  v_label text := current_setting('rls_test.s_label');
  v_version integer := coalesce(nullif(current_setting('rls_test.s_version', true), ''), '1')::integer;
  v_supersedes uuid := nullif(current_setting('rls_test.s_supersedes', true), '')::uuid;
  v_total_delta integer := coalesce(nullif(current_setting('rls_test.s_total_delta', true), ''), '0')::integer;
  v_gross_delta integer := coalesce(nullif(current_setting('rls_test.s_gross_delta', true), ''), '0')::integer;
  v_skip_last boolean := coalesce(nullif(current_setting('rls_test.s_skip_last', true), ''), 'false')::boolean;
  v_extra uuid := nullif(current_setting('rls_test.s_extra_gift', true), '')::uuid;
  v_no_lines boolean := coalesce(nullif(current_setting('rls_test.s_no_lines', true), ''), 'false')::boolean;
  v_blob_kind text := coalesce(nullif(current_setting('rls_test.s_blob', true), ''), 'pdf');
  v_expect text := coalesce(current_setting('rls_test.s_expect', true), '');
  v_bytes bytea;
  v_blob uuid;
  v_hash text;
  v_stmt uuid;
  v_ok boolean := false;
  v_err text;
begin
  -- The PDF, as store() writes it (presby_app holds INSERT on blob_assets).
  -- Unique bytes per call: blob_assets dedups on (organization_id, content_hash).
  v_bytes := convert_to('%PDF-1.7 rls46 ' || v_label || ' ' || gen_random_uuid()::text, 'UTF8');
  insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
  values (v_org, encode(sha256(v_bytes), 'hex'),
          case when v_blob_kind = 'json' then 'application/json' else 'application/pdf' end,
          octet_length(v_bytes), v_bytes)
  returning id, content_hash into v_blob, v_hash;
  if v_blob_kind = 'badhash' then
    v_hash := repeat('0', 64);
  end if;

  begin
    with base as (
      select g.id as gift_id, g.donor_id, g.occurred_on, g.amount_cents as gross,
             g.donor_covered_fee_cents as covered, g.livemode, g.status,
             case when g.method = 'stock' then 'non_cash' else 'cash' end as kind,
             coalesce(f.name, 'Fund') as fund_label,
             case when g.method = 'check' and g.check_number is not null then 'Check #' || g.check_number
                  when g.method = 'stock' then coalesce(g.stock_description, 'Securities')
                  else initcap(coalesce(g.method, 'gift')) end as description,
             coalesce((select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end)
                         from giving_gift_reversals r where r.gift_id = g.id), 0)::integer as reversed
        from giving_gifts g
        left join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
       where g.organization_id = v_org),
    counted as (
      select b.*, (b.gross - b.reversed)::integer as remaining
        from base b
       where b.donor_id in (select d.id from giving_donors d
                             where d.organization_id = v_org and (d.id = v_donor or d.merged_into_id = v_donor))
         and b.livemode and b.status = 'succeeded'
         and b.occurred_on between make_date(v_year, 1, 1) and make_date(v_year, 12, 31)
         and b.gross - b.reversed > 0),
    ordered as (
      select c.*, row_number() over (order by c.occurred_on, c.gift_id) as n, count(*) over () as total
        from counted c),
    kept as (
      select o.gift_id, o.occurred_on, o.gross, o.covered, o.kind, o.fund_label, o.description, o.reversed, o.remaining
        from ordered o
       where not v_skip_last or o.n < o.total
      union all
      select b.gift_id, b.occurred_on, b.gross, b.covered, b.kind, b.fund_label, b.description, b.reversed,
             (b.gross - b.reversed)::integer
        from base b where b.gift_id = v_extra),
    numbered as (
      select k.*, row_number() over (order by k.occurred_on, k.gift_id)::smallint as line_no from kept k),
    hdr as (
      insert into giving_statements (organization_id, donor_id, tax_year, version, supersedes_id,
             donee_legal_name, donee_address_line1, donee_address_line2, donee_city, donee_region,
             donee_postal_code, donee_ein, signatory_name, signatory_title, greeting_text, closing_text,
             wording_version, donor_name, delivery_line1, delivery_line2, delivery_city, delivery_region,
             delivery_postal_code, delivery_country, delivery_email, period_start, period_end,
             cash_total_cents, gift_count, non_cash_count, covered_fee_counted, blob_asset_id, pdf_sha256,
             issued_by, issued_at)
      select v_org, v_donor, v_year, v_version, v_supersedes,
             gs.donee_legal_name, gs.donee_address_line1, gs.donee_address_line2, gs.donee_city, gs.donee_region,
             gs.donee_postal_code, gs.donee_ein, gs.signatory_name, gs.signatory_title,
             coalesce(gs.greeting_text, 'Thank you for your gifts.'), coalesce(gs.closing_text, 'With gratitude.'),
             1, d.display_name, d.address_line1, d.address_line2, d.city, d.region, d.postal_code, d.country, d.email,
             make_date(v_year, 1, 1), make_date(v_year, 12, 31),
             (select coalesce(sum(n.remaining) filter (where n.kind = 'cash'), 0) from numbered n) + v_total_delta,
             (select count(*) from numbered), (select count(*) from numbered n where n.kind = 'non_cash'),
             true, v_blob, v_hash, v_issuer,
             timestamptz '2000-01-01 00:00:00+00'   -- overwritten: the insert guard stamps now() (0056 S2)
        from giving_settings gs
        join giving_donors d on d.id = v_donor and d.organization_id = v_org
       where gs.organization_id = v_org
      returning id)
    insert into giving_statement_lines (organization_id, statement_id, gift_id, line_no, occurred_on, fund_label,
           description, kind, amount_cents, gross_cents, reversed_cents, covered_fee_cents)
    select v_org, hdr.id, n.gift_id, n.line_no, n.occurred_on, n.fund_label, n.description, n.kind,
           case when n.kind = 'cash' then n.remaining end,
           n.gross + case when n.line_no = 1 then v_gross_delta else 0 end,
           n.reversed, n.covered
      from numbered n cross join hdr
     where not v_no_lines;

    select s.id into v_stmt from giving_statements s
     where s.organization_id = v_org and s.donor_id = v_donor and s.tax_year = v_year and s.version = v_version;
    set constraints giving_statements_consistency, giving_statement_lines_consistency immediate;
    v_ok := true;
  exception when others then
    v_err := sqlerrm;
  end;

  -- Reset the optional knobs so the next call starts clean.
  perform set_config('rls_test.' || k, '', true)
     from unnest(array['s_version', 's_supersedes', 's_total_delta', 's_gross_delta', 's_skip_last',
                       's_extra_gift', 's_no_lines', 's_blob', 's_expect']) k;

  if v_expect = '' then
    if not v_ok then
      raise exception 'FAIL %: the statement was refused: %', v_label, v_err;
    end if;
    perform set_config('rls_test.s_statement', v_stmt::text, true);
    raise notice 'pass  %', v_label;
  else
    if v_ok then
      raise exception 'FAIL %: expected a refusal containing "%", but the statement was issued', v_label, v_expect;
    end if;
    if position(v_expect in v_err) = 0 then
      raise exception 'FAIL %: expected a refusal containing "%", got: %', v_label, v_expect, v_err;
    end if;
    raise notice 'pass  % (refused: %)', v_label, v_err;
  end if;
end $$;

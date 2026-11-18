#!/usr/bin/env bash
# scripts/oversight/test-0089-migration.sh - D6, drizzle/0089 on a scratch
# database (docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "Test
# plan" D6; the scripts/person-photos/test-0078-migration.sh template).
#
#   scripts/oversight/test-0089-migration.sh <owner url> <presby_app url>
#
# Both URLs name the SAME empty scratch database: the owner (neondb_owner) one
# and a presby_app login one. The database name must begin `scratch_`, the
# server must agree that is where each URL lands, and it must be empty (no
# relation in schema public). Create one on YOUR PIPELINE BRANCH's compute,
# never development or production (with .env.local loaded):
#
#   psql "$MIGRATE_DATABASE_URL" -c 'create database scratch_0089'
#   swap() { python3 -I -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(u.urlunparse(p._replace(path="/scratch_0089")))' "$1"; }
#   scripts/oversight/test-0089-migration.sh "$(swap "$MIGRATE_DATABASE_URL")" "$(swap "$APP_DATABASE_URL")"
#   psql "$MIGRATE_DATABASE_URL" -c 'drop database scratch_0089'
#
# Hosts named in PRESBY_PROTECTED_HOSTS (space-separated substrings), the
# development endpoint and the production endpoint are refused outright.
#
# Steps (each fails the script on a miss):
#   1. every migration BEFORE 0072, from empty, through drizzle-kit migrate
#      (the from-empty path CI uses);
#   2. 0089 without 0072 is REFUSED by its first statement and rolls back
#      whole (no oversight_ table, no permission row);
#   3. every remaining migration through the last journal entry before 0089;
#      scripts/seed.ts, scripts/seed-dev.sql, scripts/install-test-helpers.sql
#      (CI's order); a fixture founding_administrator role at a presbytery;
#   4. 0089 with psql -1 (apply 1): exit 0, the backfill notice reports 1,
#      catalog fingerprint FP1;
#   5. oversight rows seeded (scripts/oversight/seed-dev-oversight.sql), then
#      0089 re-applied WHOLE (apply 2): exit 0, the notice reports 0, the
#      fingerprint == FP1, the rows byte-identical, the row counts unchanged;
#   6. scripts/oversight/test-rls-89.sql as presby_app, then the WHOLE
#      scripts/test-rls.sql as presby_app with the two integration patches
#      (test-rls.sql, seed-dev.sql) applied in a temporary copy of scripts/
#      unless the repository already carries them;
#   7. drizzle-kit migrate with a journal carrying the 0089 entry the
#      integration patch adds (idx 89): the runner applies 0089 inside its own
#      transaction over the already-migrated database and the catalog is still
#      FP1 (the runner path and the psql path agree).
set -euo pipefail

URL="${1:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
APP_URL="${2:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M89="$ROOT/drizzle/0089_presby_oversight_records.sql"

PARSED="$(python3 -I -c '
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
db = p.path.lstrip("/")
ok = p.scheme in ("postgres", "postgresql") and p.hostname and db and "/" not in db
print(f"{db} {p.hostname}" if ok else "")
' "$URL")"
if [[ -z "$PARSED" ]]; then
  echo "REFUSED: not a postgres URL with a host and a database name" >&2
  exit 2
fi
read -r DBNAME HOST <<< "$PARSED"
case "$DBNAME" in
  scratch_*) ;;
  *) echo "REFUSED: database \"$DBNAME\" does not begin scratch_" >&2; exit 2 ;;
esac
for protected in ep-lingering-meadow ep-flat-hat ${PRESBY_PROTECTED_HOSTS:-}; do
  if [[ "$HOST" == *"$protected"* ]]; then
    echo "REFUSED: host $HOST is protected ($protected)" >&2
    exit 2
  fi
done
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
ACTUAL="$("${PSQL[@]}" -At -c 'select current_database()')"
if [[ "$ACTUAL" != "$DBNAME" || "$ACTUAL" != scratch_* ]]; then
  echo "REFUSED: the URL reached database \"$ACTUAL\", not the scratch_ database \"$DBNAME\" it names" >&2
  exit 2
fi
APP_ACTUAL="$(psql "$APP_URL" -X -At -c 'select current_database() || '"'"' '"'"' || current_user')"
if [[ "$APP_ACTUAL" != "$DBNAME presby_app" ]]; then
  echo "REFUSED: the app URL reached \"$APP_ACTUAL\", not \"$DBNAME presby_app\"" >&2
  exit 2
fi
nrel="$("${PSQL[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")"
if [[ "$nrel" != "0" ]]; then
  echo "REFUSED: $DBNAME is not empty ($nrel relations in public)" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
step() { printf '\n=== %s\n' "$*"; }
pass() { echo "pass  $*"; }
fail() { echo "FAIL  $*" >&2; exit 1; }
expect_eq() { # <actual> <expected> <label>
  if [[ "$1" == "$2" ]]; then pass "$3 ($1)"; else fail "$3 (expected $2, got $1)"; fi
}
q() { "${PSQL[@]}" -At -c "$1"; }
notice_count() { # <log> -> the backfill notice's number
  sed -n 's/.*oversight 0089: \([0-9][0-9]*\) founding_administrator role(s).*/\1/p' "$1" | tail -1
}

# Everything 0089 owns or restates, as one hash: the three functions it
# creates or re-creates (body + ACL), every constraint, policy, trigger, index,
# table and column ACL and FORCE flag on the six tables, the permission row,
# and every comment it writes. Objects are named, never identified by OID, so
# the fingerprint is portable: the same value on any database 0089 has run on
# (compare a pipeline branch with this scratch run).
FINGERPRINT="
select md5(string_agg(x, E'\n' order by x)) from (
  select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '-')
    from pg_proc p
   where p.proname in ('presby_founding_administrator_permission_keys', 'presby_oversight_guard_write',
                       'presby_oversight_building_live_guard', 'presby_oversight_guard_provenance')
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) || ' ' || convalidated
    from pg_constraint where conrelid::regclass::text like 'oversight\\_%'
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || qual || ' ' || with_check
    from pg_policies where tablename like 'oversight\\_%'
  union all
  select 'rel ' || relname || ' ' || coalesce(relacl::text, '-') || ' ' || relrowsecurity || ' ' || relforcerowsecurity
    from pg_class where relname like 'oversight\\_%' and relkind = 'r'
  union all
  select 'col ' || attrelid::regclass::text || ' ' || attname || ' ' || attacl::text
    from pg_attribute where attrelid::regclass::text like 'oversight\\_%' and attacl is not null
  union all
  select 'trg ' || tgname || ' ' || tgenabled::text || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where tgrelid::regclass::text like 'oversight\\_%' and not tgisinternal
  union all
  select 'idx ' || indexname || ' ' || indexdef from pg_indexes where tablename like 'oversight\\_%'
  union all
  select 'perm ' || key || ' ' || module || ' ' || description || ' ' || sensitivity_tier || ' ' || requires_two_factor
    from permissions where key like 'congregation_oversight.%'
  union all
  select 'cmt ' || case when d.classoid = 'pg_class'::regclass then d.objoid::regclass::text
                        else d.objoid::regprocedure::text end
         || ' ' || d.objsubid || ' ' || md5(d.description)
    from pg_description d
   where (d.classoid = 'pg_class'::regclass
          and (d.objoid::regclass::text like 'oversight\\_%'
               or (d.objoid = 'congregation_oversight'::regclass)
               or (d.objoid = 'permissions'::regclass and d.objsubid > 0)))
      or (d.classoid = 'pg_proc'::regclass
          and d.objoid in ('presby_two_factor_required(uuid)'::regprocedure, 'presby_oversight_guard_write()'::regprocedure,
                           'presby_oversight_building_live_guard()'::regprocedure,
                           'presby_oversight_guard_provenance()'::regprocedure))
) t(x)"
ROWS="select md5(coalesce(string_agg(r, E'\n' order by r), '')) from (
        select x::text as r from oversight_profiles x union all select x::text from oversight_buildings x
        union all select x::text from oversight_building_photos x union all select x::text from oversight_building_appraisals x
        union all select x::text from oversight_insurance_years x union all select x::text from oversight_loans x
        union all select rp::text from app_role_permissions rp where permission_key = 'congregation_oversight.finance') z"
COUNTS="select (select count(*) from oversight_profiles) || '/' || (select count(*) from oversight_buildings) || '/' ||
               (select count(*) from oversight_building_appraisals) || '/' || (select count(*) from oversight_insurance_years) || '/' ||
               (select count(*) from oversight_loans) || '/' || (select count(*) from app_role_permissions) || '/' ||
               (select count(*) from permissions)"

migrate_with_journal() { # <max idx exclusive> <extra entries json>
  rm -rf "$TMP/drizzle"; mkdir -p "$TMP/drizzle/meta"
  python3 -I - "$ROOT/drizzle" "$TMP/drizzle" "$1" "$2" <<'PY'
import json, shutil, sys, pathlib
src, dst, below, extra = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), int(sys.argv[3]), json.loads(sys.argv[4])
j = json.loads((src / "meta/_journal.json").read_text())
j["entries"] = [e for e in j["entries"] if int(e["tag"][:4]) < below]
known = {e["idx"] for e in j["entries"]}
j["entries"] += [e for e in extra if e["idx"] not in known]
j["entries"].sort(key=lambda e: e["idx"])
for e in j["entries"]:
    shutil.copy(src / f'{e["tag"]}.sql', dst / f'{e["tag"]}.sql')
(dst / "meta/_journal.json").write_text(json.dumps(j, indent=2))
print(f'{len(j["entries"])} migrations, last {j["entries"][-1]["tag"]}')
PY
  cat > "$TMP/drizzle.config.ts" <<EOF
export default {
  dialect: "postgresql",
  out: "$TMP/drizzle",
  dbCredentials: { url: process.env.P89_SCRATCH_URL as string },
};
EOF
  (cd "$ROOT" && P89_SCRATCH_URL="$URL" npx --no-install drizzle-kit migrate --config "$TMP/drizzle.config.ts")
}

step "1. migrations before 0072, from empty (drizzle-kit migrate, filtered journal)"
migrate_with_journal 72 '[]'
expect_eq "$(q "select count(*) from pg_constraint where conname = 'blob_assets_id_org_audience_key'")" 0 \
  "the database is at the pre-0072 schema"

step "2. 0089 without 0072 is refused by its first statement, and rolls back whole"
if "${PSQL[@]}" -1 -f "$M89" > "$TMP/refused.log" 2>&1; then fail "0089 applied without 0072"; fi
grep -q "0089 requires 0072" "$TMP/refused.log" && pass "the refusal names its prerequisite" || { cat "$TMP/refused.log" >&2; fail "unexpected refusal"; }
expect_eq "$(q "select (select count(*) from pg_class where relname like 'oversight\\_%') + (select count(*) from permissions where key = 'congregation_oversight.finance')")" 0 \
  "nothing of 0089 remains"

step "3. the rest of the chain before 0089, then CI's seeds and the helpers"
migrate_with_journal 89 '[]'
(cd "$ROOT" && DATABASE_URL="$APP_URL" PLATFORM_DATABASE_URL="$URL" npx --no-install tsx scripts/seed.ts) > "$TMP/seed-ts.log" 2>&1 \
  || { cat "$TMP/seed-ts.log" >&2; fail "scripts/seed.ts"; }
pass "scripts/seed.ts"
"${PSQL[@]}" -f "$ROOT/scripts/seed-dev.sql" > "$TMP/seed.log" 2>&1 || { cat "$TMP/seed.log" >&2; fail "scripts/seed-dev.sql"; }
pass "scripts/seed-dev.sql"
"${PSQL[@]}" -f "$ROOT/scripts/install-test-helpers.sql" > /dev/null
expect_eq "$(q "select count(*) from pg_class where relname like 'oversight\\_%'")" 0 "no oversight_ table before 0089"
# A presbytery founding_administrator role designated before 0089 (fixture;
# rolled into the backfill's count). Synthetic: the Western Basin, which the
# stock seed gives no such role.
q "insert into app_roles (organization_id, key, name, role_kind) values ('f7000000-0000-0000-0000-000000000001', 'founding_administrator', 'Founding Administrator', 'custom')" > /dev/null
# It carries the whole PRE-0089 presbytery bundle (the live 0085 body), as a
# real designation would; other suites (47n) check every founding role.
q "insert into app_role_permissions (role_id, permission_key) select r.id, k from app_roles r, unnest(presby_founding_administrator_permission_keys('presbytery')) k where r.organization_id = 'f7000000-0000-0000-0000-000000000001' and r.key = 'founding_administrator'" > /dev/null
expect_eq "$(q "select count(*) from app_role_permissions rp join app_roles r on r.id = rp.role_id where r.organization_id = 'f7000000-0000-0000-0000-000000000001' and r.key = 'founding_administrator' and rp.permission_key = 'congregation_oversight.finance'")" 0 \
  "the fixture founding role predates the finance key"

step "4. 0089 (apply 1), psql -1"
"${PSQL[@]}" -1 -f "$M89" > "$TMP/apply1.log" 2>&1 || { cat "$TMP/apply1.log" >&2; fail "0089 apply 1"; }
expect_eq "$(notice_count "$TMP/apply1.log")" 1 "apply 1: the backfill topped up the one presbytery founding role"
FP1="$(q "$FINGERPRINT")"
pass "0089 applied; fingerprint $FP1"

step "5. oversight rows present, then 0089 re-applied WHOLE (apply 2)"
"${PSQL[@]}" -f "$ROOT/scripts/oversight/seed-dev-oversight.sql" > "$TMP/seed89.log" 2>&1 || { cat "$TMP/seed89.log" >&2; fail "seed-dev-oversight.sql"; }
R1="$(q "$ROWS")"
N1="$(q "$COUNTS")"
"${PSQL[@]}" -1 -f "$M89" > "$TMP/apply2.log" 2>&1 || { cat "$TMP/apply2.log" >&2; fail "0089 re-applied whole: non-zero exit"; }
pass "0089 re-applied whole: exit 0"
expect_eq "$(notice_count "$TMP/apply2.log")" 0 "apply 2: the backfill topped up nothing"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the catalog after apply 2 is byte-identical to apply 1"
expect_eq "$(q "$ROWS")" "$R1" "the seeded rows are untouched by the re-apply"
expect_eq "$(q "$COUNTS")" "$N1" "row counts (profiles/buildings/appraisals/insurance/loans/role permissions/permissions) unchanged"

# The synthetic founding role has done its job (the two notice counts);
# remove it so the full suite below sees the stock seed plus 0089 only.
q "delete from app_role_permissions where role_id in (select id from app_roles where organization_id = 'f7000000-0000-0000-0000-000000000001' and key = 'founding_administrator')" > /dev/null
q "delete from app_roles where organization_id = 'f7000000-0000-0000-0000-000000000001' and key = 'founding_administrator'" > /dev/null
R1="$(q "$ROWS")"

step "6. the RLS suites, as presby_app"
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/scripts/oversight/test-rls-89.sql" > "$TMP/rls89.log" 2>&1 || { cat "$TMP/rls89.log" >&2; fail "test-rls-89.sql"; }
pass "test-rls-89.sql: $(grep -c 'pass  ' "$TMP/rls89.log") passes"
RLS_ROOT="$ROOT"
if ! grep -q 'oversight/test-rls-89.sql' "$ROOT/scripts/test-rls.sql"; then
  mkdir -p "$TMP/root"
  cp -R "$ROOT/scripts" "$TMP/root/scripts"
  for p in test-rls.sql seed-dev.sql; do
    (cd "$TMP/root" && patch -s -p1 < "$ROOT/scripts/oversight/$p.integration.patch") || fail "integration patch $p does not apply"
  done
  RLS_ROOT="$TMP/root"
  pass "test-rls.sql and seed-dev.sql integration patches applied in a temporary copy"
fi
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$RLS_ROOT/scripts/test-rls.sql" > "$TMP/rls.log" 2>&1 || { tail -40 "$TMP/rls.log" >&2; fail "scripts/test-rls.sql (integrated)"; }
pass "scripts/test-rls.sql (integrated, section 89 included): exit 0, $(grep -c 'Section 89 (congregation records) complete' "$TMP/rls.log") x section 89 complete"

step "7. drizzle-kit migrate with the integration patch's 0089 journal entry (idx 89)"
migrate_with_journal 90 '[{"idx": 89, "version": "7", "when": 1793825100000, "tag": "0089_presby_oversight_records", "breakpoints": true}]'
expect_eq "$(q "select count(*) from drizzle.__drizzle_migrations")" "$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["entries"]))' "$TMP/drizzle/meta/_journal.json")" \
  "the runner's ledger has every journal entry, 0089 included"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the runner's apply (its own transaction) leaves FP1"
expect_eq "$(q "$ROWS")" "$R1" "and the rows untouched"

printf '\nD6 PASS: 0089 on %s\n' "$DBNAME"

#!/usr/bin/env bash
# scripts/person-photos/test-0078-migration.sh - D4, drizzle/0078 on a scratch
# database (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 "Test
# Plan" D4; F335).
#
#   scripts/person-photos/test-0078-migration.sh <owner url> <presby_app url>
#
# Both URLs name the SAME empty scratch database: the owner (neondb_owner) one
# and a presby_app login one. The database name must begin `scratch_`, the
# server must agree that is where each URL lands, and it must be empty (no
# relation in schema public). Create one on YOUR PIPELINE BRANCH's compute,
# never development or production (with .env.local loaded):
#
#   psql "$MIGRATE_DATABASE_URL" -c 'create database scratch_0078'
#   swap() { python3 -I -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(u.urlunparse(p._replace(path="/scratch_0078")))' "$1"; }
#   scripts/person-photos/test-0078-migration.sh "$(swap "$MIGRATE_DATABASE_URL")" "$(swap "$APP_DATABASE_URL")"
#   psql "$MIGRATE_DATABASE_URL" -c 'drop database scratch_0078'
#
# Hosts named in PRESBY_PROTECTED_HOSTS (space-separated substrings), the
# development endpoint and the production endpoint are refused outright.
#
# Steps (each fails the script on a miss):
#   1. every migration BEFORE 0072, from empty, through drizzle-kit migrate
#      (the from-empty path CI uses); then scripts/seed-dev.sql and
#      scripts/install-test-helpers.sql;
#   2. 0078 without 0072 is REFUSED by its first statement and rolls back
#      whole (no person_photos);
#   3. 0072 with psql -1; then 0078 with psql -1 (apply 1): catalog
#      fingerprint FP1;
#   4. photo rows seeded (owner), then 0078 re-applied WHOLE (apply 2): exit 0,
#      fingerprint == FP1, the seeded rows byte-identical;
#   5. scripts/person-photos/test-rls-78.sql and scripts/assets/test-rls-72.sql
#      as presby_app;
#   6. the retirement CHECK refuses a non-null people.photo_key (owner);
#   7. F335: 0072 re-applied puts the three people.photo_key bodies back
#      (hardening intact), and 0078 re-applied restores FP1 exactly;
#   8. drizzle-kit migrate with a journal carrying 0072 and the 0078 entry the
#      integration patch adds (idx 78): the runner applies both inside its own
#      transaction and the catalog is still FP1.
set -euo pipefail

URL="${1:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
APP_URL="${2:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M72="$ROOT/drizzle/0072_presby_blob_audience.sql"
M78="$ROOT/drizzle/0078_presby_person_photos.sql"

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

# Everything 0078 owns, plus the three bodies it replaces, as one hash.
FINGERPRINT="
select md5(string_agg(x, E'\n' order by x)) from (
  select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '-')
    from pg_proc p
   where p.proname in ('presby_person_photos_enabled', 'presby_photo_subject_is_minor', 'presby_person_public_photo',
                       'presby_person_public_photo_status', 'presby_person_directory_photo',
                       'presby_person_photos_guard_write', 'presby_person_photo_designations_guard_write',
                       'presby_public_staff_roster', 'presby_public_committee_roster', 'presby_public_site_asset')
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) || ' ' || convalidated
    from pg_constraint
   where conrelid in ('person_photos'::regclass, 'person_photo_designations'::regclass) or conname = 'people_photo_key_retired'
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || qual || ' ' || with_check
    from pg_policies where tablename in ('person_photos', 'person_photo_designations')
  union all
  select 'rel ' || relname || ' ' || coalesce(relacl::text, '-') || ' ' || relrowsecurity || ' ' || relforcerowsecurity
    from pg_class where relname in ('person_photos', 'person_photo_designations')
  union all
  select 'col ' || attrelid::regclass::text || ' ' || attname || ' ' || attacl::text
    from pg_attribute where attrelid in ('person_photos'::regclass, 'person_photo_designations'::regclass) and attacl is not null
  union all
  select 'trg ' || tgname || ' ' || tgenabled::text || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where tgrelid in ('person_photos'::regclass, 'person_photo_designations'::regclass) and not tgisinternal
  union all
  select 'idx ' || indexname || ' ' || indexdef from pg_indexes where tablename in ('person_photos', 'person_photo_designations')
) t(x)"
OLD_BODIES="select count(*) from pg_proc where proname in ('presby_public_staff_roster', 'presby_public_committee_roster', 'presby_public_site_asset') and prosrc ~ '\\m(p|pe)\\.photo_key\\M'"
ROSTER_HARDENED="
select count(*) from pg_proc p
 where p.proname in ('presby_public_staff_roster', 'presby_public_committee_roster', 'presby_public_site_asset')
   and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
   and (select array_agg(a.grantee order by a.grantee) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE')
       = (select array_agg(x order by x) from unnest(array[p.proowner, 'presby_app'::regrole::oid]) x)"
ROWS="select md5(coalesce(string_agg(r::text, E'\n' order by r::text), '')) from (
        select ph::text as r from person_photos ph union all select d::text from person_photo_designations d) z"

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
  dbCredentials: { url: process.env.P78_SCRATCH_URL as string },
};
EOF
  (cd "$ROOT" && P78_SCRATCH_URL="$URL" npx --no-install drizzle-kit migrate --config "$TMP/drizzle.config.ts")
}

step "1. migrations before 0072, from empty (drizzle-kit migrate, filtered journal)"
migrate_with_journal 72 '[]'
"${PSQL[@]}" -f "$ROOT/scripts/seed-dev.sql" > "$TMP/seed.log" 2>&1 || { cat "$TMP/seed.log" >&2; exit 1; }
"${PSQL[@]}" -f "$ROOT/scripts/install-test-helpers.sql"
# The one platform flag test-rls-78.sql flips (seeded off by scripts/seed.ts, which needs the app env).
q "insert into feature_flags (key, description, enabled) values ('org_portal.feature_categories', 'seeded by test-0078-migration.sh as scripts/seed.ts would', false) on conflict (key) do nothing" > /dev/null
expect_eq "$(q "select count(*) from information_schema.columns where table_name = 'blob_assets' and column_name = 'audience'")" 0 \
  "the database is at the pre-0072 schema"

step "2. 0078 without 0072 is refused by its first statement, and rolls back whole"
if "${PSQL[@]}" -1 -f "$M78" > "$TMP/refused.log" 2>&1; then fail "0078 applied without 0072"; fi
grep -q "0078 requires 0072" "$TMP/refused.log" && pass "the refusal names its prerequisite" || { cat "$TMP/refused.log" >&2; fail "unexpected refusal"; }
expect_eq "$(q "select count(*) from pg_class where relname in ('person_photos', 'person_photo_designations')")" 0 \
  "nothing of 0078 remains"

step "3. 0072, then 0078 (apply 1), both with psql -1"
"${PSQL[@]}" -1 -f "$M72" > "$TMP/apply72.log" 2>&1 || { cat "$TMP/apply72.log" >&2; exit 1; }
"${PSQL[@]}" -1 -f "$M78" > "$TMP/apply1.log" 2>&1 || { cat "$TMP/apply1.log" >&2; exit 1; }
FP1="$(q "$FINGERPRINT")"
pass "0078 applied; fingerprint $FP1"
expect_eq "$(q "$OLD_BODIES")" 0 "no roster or door body reads people.photo_key"
expect_eq "$(q "$ROSTER_HARDENED")" 3 "the rosters and the door keep search_path, SECURITY DEFINER and the owner+presby_app ACL"

step "4. photo rows present, then 0078 re-applied WHOLE (apply 2)"
"${PSQL[@]}" <<'SQL'
insert into organization_feature_toggles (organization_id, feature_key, enabled)
values ('22222222-2222-2222-2222-222222222222', 'org_portal.person_photos', true);
with i as (insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
           values ('22222222-2222-2222-2222-222222222222', repeat('7', 64), 'image/jpeg', 4, '\xffd8ffe0'::bytea) returning id),
     t as (insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
           values ('22222222-2222-2222-2222-222222222222', repeat('8', 64), 'image/webp', 4, '\x52494646'::bytea) returning id),
     p as (insert into person_photos (organization_id, person_id, image_asset_key, thumb_asset_key, width, height, created_by)
           select '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', i.id, t.id, 800, 1000,
                  'e0000000-0000-0000-0000-0000000000f3' from i, t returning id)
insert into person_photo_designations (organization_id, person_id, photo_id, purpose, public_attested_at, public_attested_by, designated_by)
select '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000001', p.id, v.purpose,
       now(), 'e0000000-0000-0000-0000-0000000000f3', 'e0000000-0000-0000-0000-0000000000f3'
  from p, (values ('directory'), ('website')) v(purpose);
SQL
R1="$(q "$ROWS")"
N1="$(q "select (select count(*) from person_photos) || '/' || (select count(*) from person_photo_designations) || '/' || (select count(*) from blob_assets) || '/' || (select count(*) from people)")"
"${PSQL[@]}" -1 -f "$M78" > "$TMP/apply2.log" 2>&1 || { cat "$TMP/apply2.log" >&2; fail "0078 re-applied whole: non-zero exit"; }
pass "0078 re-applied whole: exit 0"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the catalog after apply 2 is byte-identical to apply 1"
expect_eq "$(q "$ROWS")" "$R1" "the seeded photo rows are untouched by the re-apply"
expect_eq "$(q "select (select count(*) from person_photos) || '/' || (select count(*) from person_photo_designations) || '/' || (select count(*) from blob_assets) || '/' || (select count(*) from people)")" "$N1" \
  "row counts (photos/designations/blobs/people) unchanged"

step "5. the RLS suites, as presby_app"
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/scripts/person-photos/test-rls-78.sql" > "$TMP/rls78.log" 2>&1 || { cat "$TMP/rls78.log" >&2; fail "test-rls-78.sql"; }
pass "test-rls-78.sql: $(grep -c 'pass  ' "$TMP/rls78.log") passes"
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/scripts/assets/test-rls-72.sql" > "$TMP/rls72.log" 2>&1 || { cat "$TMP/rls72.log" >&2; fail "test-rls-72.sql"; }
pass "test-rls-72.sql: $(grep -c 'pass  ' "$TMP/rls72.log") passes"

step "6. the retirement CHECK refuses a non-null people.photo_key (owner)"
if q "update people set photo_key = 'x' where id = 'c0000000-0000-0000-0000-000000000001'" > "$TMP/retired.log" 2>&1; then
  fail "the owner wrote people.photo_key"
fi
grep -q 'people_photo_key_retired' "$TMP/retired.log" && pass "people_photo_key_retired refused the owner" || { cat "$TMP/retired.log" >&2; fail "unexpected error"; }

step "7. F335: 0072 re-applied after 0078 restores the old bodies; 0078 again restores FP1"
"${PSQL[@]}" -1 -f "$M72" > "$TMP/apply72b.log" 2>&1 || { cat "$TMP/apply72b.log" >&2; exit 1; }
expect_eq "$(q "$OLD_BODIES")" 3 "after 0072 again, all three bodies read people.photo_key (why the header warns)"
expect_eq "$(q "$ROSTER_HARDENED")" 3 "...with their hardening intact"
"${PSQL[@]}" -1 -f "$M78" > "$TMP/apply3.log" 2>&1 || { cat "$TMP/apply3.log" >&2; exit 1; }
expect_eq "$(q "$FINGERPRINT")" "$FP1" "0078 again: the catalog is FP1 exactly"
expect_eq "$(q "$ROWS")" "$R1" "and the photo rows are still untouched"

step "8. drizzle-kit migrate with 0072 and the integration patch's 0078 journal entry"
migrate_with_journal 79 '[{"idx": 78, "version": "7", "when": 1788655973186, "tag": "0078_presby_person_photos", "breakpoints": true}]'
expect_eq "$(q "select count(*) from drizzle.__drizzle_migrations")" "$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["entries"]))' "$TMP/drizzle/meta/_journal.json")" \
  "the runner's ledger has every journal entry, 0078 included"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the runner's apply (one transaction, 0072 then 0078) leaves FP1"
expect_eq "$(q "$ROWS")" "$R1" "and the photo rows untouched"

printf '\nD4 PASS: 0078 on %s\n' "$DBNAME"

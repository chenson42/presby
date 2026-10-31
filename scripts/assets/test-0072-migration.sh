#!/usr/bin/env bash
# scripts/assets/test-0072-migration.sh - D5, drizzle/0072 on a snapshot
# (docs/work-log/2026-10-25-public-asset-allowlist.md, Phase 3 "Test Plan" D5).
#
#   scripts/assets/test-0072-migration.sh <owner url> <presby_app url>
#
# Both URLs name the SAME empty scratch database: the owner (neondb_owner) one
# and a presby_app login one (the statement is issued as presby_app; the owner
# cannot `set role` to it). The database name must begin `scratch_`, the
# server must agree that is where each URL lands, and it must be empty (no
# relation in schema public). Create one on YOUR PIPELINE BRANCH's compute,
# never development or production (with .env.local loaded):
#
#   psql "$MIGRATE_DATABASE_URL" -c 'create database scratch_0072'
#   swap() { python3 -I -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(u.urlunparse(p._replace(path="/scratch_0072")))' "$1"; }
#   scripts/assets/test-0072-migration.sh "$(swap "$MIGRATE_DATABASE_URL")" "$(swap "$APP_DATABASE_URL")"
#   psql "$MIGRATE_DATABASE_URL" -c 'drop database scratch_0072'
#
# Hosts named in PRESBY_PROTECTED_HOSTS (space-separated substrings) and the
# development endpoint are refused outright.
#
# Steps (each fails the script on a miss):
#   1. every migration BEFORE 0072, from empty, through drizzle-kit migrate
#      (the from-empty path CI uses), against a journal filtered to < 0072;
#      then scripts/seed-dev.sql and scripts/install-test-helpers.sql;
#   2. 0072-preimage.sql: one blob of every class, and ONE issued statement;
#   5. 0072-crossref.sql: with a bundle image attached to a ticket, 0072 is
#      REFUSED and rolls back whole (run here, before 3, on the same database);
#   3. 0072 with `psql -1`: the flip NOTICE says 3, 0072-postimage.sql passes;
#   4. 0072 re-applied whole: exit 0, flips 0, postimage still passes; then a
#      private image is made the current mark (what old code can do in the
#      deploy window) and 0072 re-applied heals it: flips 1, postimage passes
#      with 4 public rows, the statement PDF untouched.
set -euo pipefail

URL="${1:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
APP_URL="${2:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION="$ROOT/drizzle/0072_presby_blob_audience.sql"

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
for protected in ep-lingering-meadow-axnarpsq ${PRESBY_PROTECTED_HOSTS:-}; do
  if [[ "$HOST" == *"$protected"* ]]; then
    echo "REFUSED: host $HOST is protected ($protected)" >&2
    exit 2
  fi
done
PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
# Ask the SERVER which database this URL really reached: the text check above
# is only as good as the parse, and libpq may read a malformed URL differently.
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
expect_in() { # <file> <pattern> <label>
  if grep -Eq "$2" "$1"; then echo "pass  $3"; else echo "FAIL  $3 (no match for /$2/ in $1)" >&2; cat "$1" >&2; exit 1; fi
}

step "1. migrations before 0072, from empty (drizzle-kit migrate, filtered journal)"
mkdir -p "$TMP/drizzle/meta"
python3 -I - "$ROOT/drizzle" "$TMP/drizzle" <<'PY'
import json, shutil, sys, pathlib
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
j = json.loads((src / "meta/_journal.json").read_text())
j["entries"] = [e for e in j["entries"] if int(e["tag"][:4]) < 72]
for e in j["entries"]:
    shutil.copy(src / f'{e["tag"]}.sql', dst / f'{e["tag"]}.sql')
(dst / "meta/_journal.json").write_text(json.dumps(j, indent=2))
print(f'{len(j["entries"])} migrations, last {j["entries"][-1]["tag"]}')
PY
cat > "$TMP/drizzle.config.ts" <<EOF
export default {
  dialect: "postgresql",
  out: "$TMP/drizzle",
  dbCredentials: { url: process.env.P72_SCRATCH_URL as string },
};
EOF
(cd "$ROOT" && P72_SCRATCH_URL="$URL" npx --no-install drizzle-kit migrate --config "$TMP/drizzle.config.ts")
"${PSQL[@]}" -f "$ROOT/scripts/seed-dev.sql" > "$TMP/seed.log" 2>&1 || { cat "$TMP/seed.log" >&2; exit 1; }
"${PSQL[@]}" -f "$ROOT/scripts/install-test-helpers.sql"
expect_in <("${PSQL[@]}" -At -c "select count(*) from information_schema.columns where table_name = 'blob_assets' and column_name = 'audience'") '^0$' \
  "the database is at the pre-0072 schema (no blob_assets.audience)"

step "2. pre-image (owner), then ONE issued statement (presby_app login), then record it (owner)"
"${PSQL[@]}" -f "$ROOT/scripts/assets/0072-preimage.sql"
APP_PSQL=(psql "$APP_URL" -X -q -v ON_ERROR_STOP=1)
"${APP_PSQL[@]}" -f "$ROOT/scripts/assets/0072-preimage-issue.sql"
"${PSQL[@]}" <<'SQL'
insert into p72_harness.fixture (kind, id)
select 'statement', s.id from giving_statements s
 where s.organization_id = '22222222-2222-2222-2222-222222222222'
   and s.donor_id = 'd9100000-0000-0000-0000-000000000040' and s.tax_year = 2025 and s.version = 1;
insert into p72_harness.fixture (kind, id, bytes_md5, content_hash)
select 'statement_pdf', b.id, md5(b.bytes), b.content_hash
  from p72_harness.fixture f
  join giving_statements s on s.id = f.id
  join blob_assets b on b.id = s.blob_asset_id and b.organization_id = s.organization_id
 where f.kind = 'statement';
SQL
expect_in <("${PSQL[@]}" -At -c "select count(*) from p72_harness.fixture where kind in ('statement', 'statement_pdf')") '^2$' \
  "the issued statement and its PDF are recorded"

step "5. cross-reference refusal (before 3, same database; one transaction)"
TM_BEFORE="$("${PSQL[@]}" -At -c "select count(*) from ticket_messages")"
if "${PSQL[@]}" -f "$ROOT/scripts/assets/0072-crossref.sql" > "$TMP/crossref.log" 2>&1; then
  echo "FAIL  0072 applied over a cross-referenced blob" >&2; cat "$TMP/crossref.log" >&2; exit 1
fi
expect_in "$TMP/crossref.log" '0072: 1 blob\(s\) are both published \(a mark or a bundle image\) and used by a private consumer' \
  "0072 refuses a bundle image that is also a ticket attachment, naming the count"
expect_in <("${PSQL[@]}" -At -c "select count(*) from information_schema.columns where table_name = 'blob_assets' and column_name = 'audience'") '^0$' \
  "the refusal rolled 0072 back whole (no audience column)"
expect_in <("${PSQL[@]}" -At -c "select count(*) from ticket_messages") "^${TM_BEFORE}\$" \
  "and the cross-referencing ticket message with it"

step "3. 0072 with psql -1"
"${PSQL[@]}" -1 -f "$MIGRATION" > "$TMP/apply1.log" 2>&1 || { cat "$TMP/apply1.log" >&2; exit 1; }
cat "$TMP/apply1.log"
expect_in "$TMP/apply1.log" '0072: flipped 3 blob\(s\) to public_site' "first apply flips exactly 3 (1 mark + 2 bundle images)"
expect_in "$TMP/apply1.log" 'the bundle of organization 33333333-3333-3333-3333-333333333333 is not parseable JSON' \
  "an unparseable bundle is a notice, never an abort"
"${PSQL[@]}" -f "$ROOT/scripts/assets/0072-postimage.sql"

step "4a. 0072 re-applied whole (idempotent)"
"${PSQL[@]}" -1 -f "$MIGRATION" > "$TMP/apply2.log" 2>&1 || { cat "$TMP/apply2.log" >&2; exit 1; }
expect_in "$TMP/apply2.log" '0072: flipped 0 blob\(s\) to public_site' "re-apply flips nothing"
"${PSQL[@]}" -f "$ROOT/scripts/assets/0072-postimage.sql"

step "4b. heal: a private current mark (old code in the window), then 0072 again"
"${PSQL[@]}" <<'SQL'
insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes)
select 'a7200000-0000-4000-8000-0000000000d1', '22222222-2222-2222-2222-222222222222',
       encode(sha256(b), 'hex'), 'image/png', octet_length(b), b
  from (select '\x89504e470d0a1a0a'::bytea || convert_to('p72 mark uploaded by old code', 'UTF8') as b) x;
update organization_brands set mark_asset_key = 'a7200000-0000-4000-8000-0000000000d1'
 where organization_id = '22222222-2222-2222-2222-222222222222';
SQL
expect_in <("${PSQL[@]}" -At -c "select audience from blob_assets where id = 'a7200000-0000-4000-8000-0000000000d1'") '^private$' \
  "the old-code mark landed private"
"${PSQL[@]}" -1 -f "$MIGRATION" > "$TMP/apply3.log" 2>&1 || { cat "$TMP/apply3.log" >&2; exit 1; }
expect_in "$TMP/apply3.log" '0072: flipped 1 blob\(s\) to public_site' "re-apply heals the private current mark"
"${PSQL[@]}" -v P72_EXPECT_PUBLIC=4 -f "$ROOT/scripts/assets/0072-postimage.sql"

printf '\nD5 PASS: 0072 snapshot run on %s\n' "$DBNAME"

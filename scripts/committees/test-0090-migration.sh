#!/usr/bin/env bash
# scripts/committees/test-0090-migration.sh - D6, drizzle/0090 on a scratch
# database (docs/work-log/2026-11-19-presbytery-committees.md, Phase 3 "Test
# plan" D6; the scripts/oversight/test-0089-migration.sh template).
#
#   scripts/committees/test-0090-migration.sh <owner url> <presby_app url>
#
# Both URLs name the SAME empty scratch database: the owner (neondb_owner) one
# and a presby_app login one. The database name must begin `scratch_`, the
# server must agree that is where each URL lands, and it must be empty (no
# relation in schema public). Create one on YOUR PIPELINE BRANCH's compute,
# never development or production (with .env.local loaded):
#
#   psql "$MIGRATE_DATABASE_URL" -c 'create database scratch_0090'
#   swap() { python3 -I -c 'import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(u.urlunparse(p._replace(path="/scratch_0090")))' "$1"; }
#   scripts/committees/test-0090-migration.sh "$(swap "$MIGRATE_DATABASE_URL")" "$(swap "$APP_DATABASE_URL")"
#   psql "$MIGRATE_DATABASE_URL" -c 'drop database scratch_0090'
#
# Hosts named in PRESBY_PROTECTED_HOSTS (space-separated substrings), the
# development endpoint and the production endpoint are refused outright.
#
# Steps (each fails the script on a miss):
#   1. every migration BEFORE 0078, from empty, through drizzle-kit migrate
#      (the from-empty path CI uses); 0090 is REFUSED by its first statement
#      (it names 0078) and rolls back whole;
#   2. every remaining migration through the last journal entry before 0090;
#      0090 with 0045's function dropped (inside a transaction that is rolled
#      back) is REFUSED naming 0045; scripts/seed.ts, scripts/seed-dev.sql
#      WITHOUT its committees include (that seed needs 0090's tables; it runs
#      in step 4), scripts/install-test-helpers.sql (CI's order); one seeded
#      group_memberships row with a role outside the seven makes 0090 refuse,
#      naming the value, and roll back whole; the row is then corrected;
#   3. 0090 with psql -1 (apply 1): exit 0, catalog fingerprint FP1; the
#      committee roster's body differs from 0078's only by the designed
#      additions (one predicate replaced, eight lines added);
#   4. committees rows seeded (scripts/committees/seed-dev-committees.sql),
#      then 0090 re-applied WHOLE (apply 2): exit 0, the fingerprint == FP1,
#      the rows byte-identical, the row counts unchanged;
#   5. scripts/committees/test-rls-90.sql as presby_app, then the WHOLE
#      scripts/test-rls.sql as presby_app with the two integration patches
#      (test-rls.sql, seed-dev.sql) applied in a temporary copy of scripts/
#      unless the repository already carries them;
#   6. drizzle-kit migrate with a journal carrying the 0090 entry the
#      integration patch adds (idx 90): the runner applies 0090 inside its own
#      transaction over the already-migrated database and the catalog is still
#      FP1 (the runner path and the psql path agree).
set -euo pipefail

URL="${1:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
APP_URL="${2:?usage: $0 <owner url> <presby_app url> (of one empty scratch_ database)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M90="$ROOT/drizzle/0090_presby_committees.sql"

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
SEED_PRE="$ROOT/scripts/.seed-dev-pre0090.$$.sql"
trap 'rm -rf "$TMP" "$SEED_PRE"' EXIT
step() { printf '\n=== %s\n' "$*"; }
pass() { echo "pass  $*"; }
fail() { echo "FAIL  $*" >&2; exit 1; }
expect_eq() { # <actual> <expected> <label>
  if [[ "$1" == "$2" ]]; then pass "$3 ($1)"; else fail "$3 (expected $2, got $1)"; fi
}
q() { "${PSQL[@]}" -At -c "$1"; }

# Everything 0090 owns or restates, as one hash: the four functions it
# creates or re-creates (definition + ACL), every constraint, policy,
# trigger, index, table and column ACL and FORCE flag on the three tables,
# the group_role CHECK, and every comment it writes. Objects are named, never
# identified by OID, so the fingerprint is portable (compare a pipeline
# branch with this scratch run).
FINGERPRINT="
select md5(string_agg(x, E'\n' order by x)) from (
  select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '-')
    from pg_proc p
   where p.proname in ('presby_committee_details_guard', 'presby_commission_guard_write',
                       'presby_commission_live_guard', 'presby_public_committee_roster')
  union all
  select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) || ' ' || convalidated
    from pg_constraint
   where conrelid::regclass::text in ('committee_details', 'commission_records', 'commission_record_members')
      or conname = 'group_memberships_group_role_check'
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || qual || ' ' || with_check
    from pg_policies where tablename in ('committee_details', 'commission_records', 'commission_record_members')
  union all
  select 'rel ' || relname || ' ' || coalesce(relacl::text, '-') || ' ' || relrowsecurity || ' ' || relforcerowsecurity
    from pg_class where relname in ('committee_details', 'commission_records', 'commission_record_members') and relkind = 'r'
  union all
  select 'col ' || attrelid::regclass::text || ' ' || attname || ' ' || attacl::text
    from pg_attribute where attrelid::regclass::text in ('committee_details', 'commission_records', 'commission_record_members')
     and attacl is not null
  union all
  select 'trg ' || tgname || ' ' || tgenabled::text || ' ' || pg_get_triggerdef(oid)
    from pg_trigger where tgrelid::regclass::text in ('committee_details', 'commission_records', 'commission_record_members')
     and not tgisinternal
  union all
  select 'idx ' || indexname || ' ' || indexdef from pg_indexes
   where tablename in ('committee_details', 'commission_records', 'commission_record_members')
  union all
  select 'cmt ' || case when d.classoid = 'pg_class'::regclass then d.objoid::regclass::text
                        else d.objoid::regprocedure::text end
         || ' ' || d.objsubid || ' ' || md5(d.description)
    from pg_description d
   where (d.classoid = 'pg_class'::regclass
          and (d.objoid::regclass::text in ('committee_details', 'commission_records', 'commission_record_members')
               or d.objoid = 'group_memberships'::regclass))
      or (d.classoid = 'pg_proc'::regclass
          and d.objoid in ('presby_committee_details_guard()'::regprocedure, 'presby_commission_guard_write()'::regprocedure,
                           'presby_commission_live_guard()'::regprocedure,
                           'presby_public_committee_roster(text,text,boolean)'::regprocedure))
) t(x)"
ROWS="select md5(coalesce(string_agg(r, E'\n' order by r), '')) from (
        select x::text as r from committee_details x union all select x::text from commission_records x
        union all select x::text from commission_record_members x
        union all select gm::text from group_memberships gm) z"
COUNTS="select (select count(*) from committee_details) || '/' || (select count(*) from commission_records) || '/' ||
               (select count(*) from commission_record_members) || '/' || (select count(*) from group_memberships) || '/' ||
               (select count(*) from groups) || '/' || (select count(*) from administrative_commissions) || '/' ||
               (select count(*) from people) || '/' || (select count(*) from memberships)"
NO90="select (select count(*) from pg_class where relname in ('committee_details', 'commission_records', 'commission_record_members'))
           + (select count(*) from pg_constraint where conname = 'group_memberships_group_role_check')"
ROSTER_SRC="select prosrc from pg_proc where proname = 'presby_public_committee_roster'"

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
  dbCredentials: { url: process.env.P90_SCRATCH_URL as string },
};
EOF
  (cd "$ROOT" && P90_SCRATCH_URL="$URL" npx --no-install drizzle-kit migrate --config "$TMP/drizzle.config.ts")
}

step "1. migrations before 0078, from empty (drizzle-kit migrate, filtered journal); 0090 refused"
migrate_with_journal 78 '[]'
expect_eq "$(q "select count(*) from pg_proc where proname = 'presby_person_public_photo'")" 0 \
  "the database is at the pre-0078 schema"
if "${PSQL[@]}" -1 -f "$M90" > "$TMP/refused78.log" 2>&1; then fail "0090 applied without 0078"; fi
grep -q "0090 requires 0078" "$TMP/refused78.log" && pass "the refusal names 0078" || { cat "$TMP/refused78.log" >&2; fail "unexpected refusal"; }
expect_eq "$(q "$NO90")" 0 "nothing of 0090 remains"

step "2. the rest of the chain before 0090; the 0045 and out-of-range-role refusals; CI's seeds and the helpers"
migrate_with_journal 90 '[]'
# 0045 dropped inside a transaction that never commits: psql stops at the
# first error (0090's guard) and the session ends, rolling everything back.
if "${PSQL[@]}" > "$TMP/refused45.log" 2>&1 <<SQL
begin;
drop function presby_check_about_org_affiliated() cascade;
\i $M90
commit;
SQL
then fail "0090 applied without 0045"; fi
grep -q "0090 requires 0045" "$TMP/refused45.log" && pass "the refusal names 0045" || { cat "$TMP/refused45.log" >&2; fail "unexpected refusal"; }
expect_eq "$(q "select count(*) from pg_proc where proname = 'presby_check_about_org_affiliated'")" 1 "0045's function is back (the drop rolled back)"
expect_eq "$(q "$NO90")" 0 "nothing of 0090 remains"

(cd "$ROOT" && DATABASE_URL="$APP_URL" PLATFORM_DATABASE_URL="$URL" npx --no-install tsx scripts/seed.ts) > "$TMP/seed-ts.log" 2>&1 \
  || { cat "$TMP/seed-ts.log" >&2; fail "scripts/seed.ts"; }
pass "scripts/seed.ts"
# seed-dev.sql ends (after integration) with `\ir committees/seed-dev-committees.sql`,
# which needs 0090's tables. Apply every OTHER include to the pre-0090 state
# from a temp copy beside the original (so each remaining `\ir` still resolves
# relative to scripts/); the committees seed runs after 0090 (step 4).
grep -v '^\\ir committees/seed-dev-committees\.sql' "$ROOT/scripts/seed-dev.sql" > "$SEED_PRE"
"${PSQL[@]}" -f "$SEED_PRE" > "$TMP/seed.log" 2>&1 || { cat "$TMP/seed.log" >&2; fail "scripts/seed-dev.sql (without the committees include)"; }
rm -f "$SEED_PRE"
pass "scripts/seed-dev.sql (its committees include deferred until after 0090)"
"${PSQL[@]}" -f "$ROOT/scripts/install-test-helpers.sql" > /dev/null
ROSTER_BEFORE="$(q "$ROSTER_SRC")"

# A seeded row outside the seven: the guard refuses, names the value, and the
# file rolls back whole. Then the row is corrected and 0090 proceeds.
q "update group_memberships set group_role = 'president' where id = (select id from group_memberships where source = 'managed' order by id limit 1)" > /dev/null
if "${PSQL[@]}" -1 -f "$M90" > "$TMP/refusedrole.log" 2>&1; then fail "0090 applied over a group_role outside the seven"; fi
grep -q "1 group_memberships row(s) hold a group_role outside the seven allowed values ('president')" "$TMP/refusedrole.log" \
  && pass "the refusal counts and names the offending value" || { cat "$TMP/refusedrole.log" >&2; fail "unexpected refusal"; }
expect_eq "$(q "$NO90")" 0 "nothing of 0090 remains"
q "update group_memberships set group_role = 'member' where group_role = 'president'" > /dev/null

step "3. 0090 (apply 1), psql -1"
"${PSQL[@]}" -1 -f "$M90" > "$TMP/apply1.log" 2>&1 || { cat "$TMP/apply1.log" >&2; fail "0090 apply 1"; }
FP1="$(q "$FINGERPRINT")"
pass "0090 applied; fingerprint $FP1"
ROSTER_AFTER="$(q "$ROSTER_SRC")"
python3 -I - "$ROSTER_BEFORE" "$ROSTER_AFTER" <<'PY' || fail "the committee roster body changed beyond the designed additions"
import sys, difflib
before = [l.strip() for l in sys.argv[1].splitlines() if l.strip()]
after = [l.strip() for l in sys.argv[2].splitlines() if l.strip()]
removed = [l[2:] for l in difflib.ndiff(before, after) if l.startswith("- ")]
added = [l[2:] for l in difflib.ndiff(before, after) if l.startswith("+ ")]
want_removed = ["and gm.ends_on is null"]
want_added = [
    "join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id",
    "and gm.starts_on <= current_date",
    "and (gm.ends_on is null or gm.ends_on > current_date)",
    "and m.ended_on is null",
    "and p.date_of_death is null",
    "and p.merged_into_id is null",
    "and not exists (select 1 from committee_details cd",
    "where cd.group_id = g.id and cd.organization_id = g.organization_id",
    "and cd.dissolved_on is not null and cd.dissolved_on <= current_date)",
]
assert removed == want_removed, f"removed {removed}"
assert added == want_added, f"added {added}"
print("pass  the committee roster body differs from 0078's only by the designed additions")
PY

step "4. committees rows present, then 0090 re-applied WHOLE (apply 2)"
"${PSQL[@]}" -f "$ROOT/scripts/committees/seed-dev-committees.sql" > "$TMP/seed90.log" 2>&1 || { cat "$TMP/seed90.log" >&2; fail "seed-dev-committees.sql"; }
"${PSQL[@]}" -f "$ROOT/scripts/committees/seed-dev-committees.sql" > "$TMP/seed90b.log" 2>&1 || { cat "$TMP/seed90b.log" >&2; fail "seed-dev-committees.sql (second run)"; }
pass "seed-dev-committees.sql applied twice"
R1="$(q "$ROWS")"
N1="$(q "$COUNTS")"
"${PSQL[@]}" -1 -f "$M90" > "$TMP/apply2.log" 2>&1 || { cat "$TMP/apply2.log" >&2; fail "0090 re-applied whole: non-zero exit"; }
pass "0090 re-applied whole: exit 0"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the catalog after apply 2 is byte-identical to apply 1"
expect_eq "$(q "$ROWS")" "$R1" "the seeded rows are untouched by the re-apply"
expect_eq "$(q "$COUNTS")" "$N1" "row counts (details/records/members/seats/groups/admin commissions/people/memberships) unchanged"

step "5. the RLS suites, as presby_app"
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/scripts/committees/test-rls-90.sql" > "$TMP/rls90.log" 2>&1 || { cat "$TMP/rls90.log" >&2; fail "test-rls-90.sql"; }
pass "test-rls-90.sql: $(grep -c 'pass  ' "$TMP/rls90.log") passes"
RLS_ROOT="$ROOT"
if ! grep -q 'committees/test-rls-90.sql' "$ROOT/scripts/test-rls.sql"; then
  mkdir -p "$TMP/root"
  cp -R "$ROOT/scripts" "$TMP/root/scripts"
  for p in test-rls.sql seed-dev.sql; do
    (cd "$TMP/root" && patch -s -p1 < "$ROOT/scripts/committees/$p.integration.patch") || fail "integration patch $p does not apply"
  done
  RLS_ROOT="$TMP/root"
  pass "test-rls.sql and seed-dev.sql integration patches applied in a temporary copy"
fi
psql "$APP_URL" -X -v ON_ERROR_STOP=1 -f "$RLS_ROOT/scripts/test-rls.sql" > "$TMP/rls.log" 2>&1 || { tail -40 "$TMP/rls.log" >&2; fail "scripts/test-rls.sql (integrated)"; }
pass "scripts/test-rls.sql (integrated, section 90 included): exit 0, $(grep -c 'Section 90 (presbytery committees) complete' "$TMP/rls.log") x section 90 complete"

step "6. drizzle-kit migrate with the integration patch's 0090 journal entry (idx 90)"
# The parser is written to a file first: a quoted heredoc inside $( ) is
# mis-parsed by the macOS system bash (3.2).
cat > "$TMP/entry.py" <<'PY'
import json, re, sys
t = open(sys.argv[1]).read()
added = [l[1:] for l in t.splitlines() if l.startswith("+") and not l.startswith("+++")]
# The added lines carry the entry's key/value pairs (its closing brace is a
# context line); rebuild the object from them.
pairs = dict(re.findall(r'^\s*"(\w+)": (.+?),?$', "\n".join(added), re.M))
entry = {k: json.loads(v) for k, v in pairs.items()}
assert entry.get("idx") == 90 and entry.get("tag") == "0090_presby_committees", entry
print(json.dumps([entry]))
PY
ENTRY="$(python3 -I "$TMP/entry.py" "$ROOT/scripts/committees/_journal.json.integration.patch")" || fail "the journal integration patch has no idx 90 entry"
pass "the integration patch's journal entry: $ENTRY"
migrate_with_journal 91 "$ENTRY"
expect_eq "$(q "select count(*) from drizzle.__drizzle_migrations")" "$(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["entries"]))' "$TMP/drizzle/meta/_journal.json")" \
  "the runner's ledger has every journal entry, 0090 included"
expect_eq "$(q "$FINGERPRINT")" "$FP1" "the runner's apply (its own transaction) leaves FP1"
expect_eq "$(q "$ROWS")" "$R1" "and the rows untouched"

printf '\nD6 PASS: 0090 on %s\n' "$DBNAME"

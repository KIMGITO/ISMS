#!/usr/bin/env bash
# KayKay's database backups: take, store, list, download and restore them.
# The same script runs in CI (backup-database.yml, restore-drill.yml) and on the developer's machine.
# The full plan is in docs/BACKUP_AND_RECOVERY.md.
#
#   scripts/db-backup.sh list [hourly|daily|weekly|monthly]   what backups exist (newest first)
#   scripts/db-backup.sh get [NAME|latest|FILE]               download, check and open one
#   scripts/db-backup.sh restore [NAME|latest|FILE]           load one into a private local Supabase
#                                                             (FILE: a .tar.gz.gpg on disk, e.g. the USB copy)
#   scripts/db-backup.sh check                                restored row counts = the backup's?
#   scripts/db-backup.sh psql                                 SQL prompt on the restored copy
#   scripts/db-backup.sh stop                                 stop and delete the restored copy
#   scripts/db-backup.sh now                                  take a backup right away (runs the workflow)
#
#   CI only:
#   scripts/db-backup.sh make OUT_DIR                         dump, check, encrypt (needs SUPABASE_DB_URL)
#   scripts/db-backup.sh upload FILE TIER...                  store in R2 under each tier
#   scripts/db-backup.sh prune                                delete copies older than each tier keeps
#
# Settings come from the environment, or from ~/.config/kaykays-backup/env on the developer's machine:
#   BACKUP_PASSPHRASE       opens the backups (asked for if not set)
#   R2_ACCESS_KEY_ID        Cloudflare R2 API token (Object Read & Write on the bucket)
#   R2_SECRET_ACCESS_KEY
#   CLOUDFLARE_ACCOUNT_ID
#   BACKUP_BUCKET           default kaykays-backups
# Without the R2 settings the backups are read from this repository's GitHub Actions artifacts (gh CLI).

set -euo pipefail

CONFIG_FILE="${KAYKAYS_BACKUP_CONFIG:-$HOME/.config/kaykays-backup/env}"
# shellcheck disable=SC1090
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

BACKUP_HOME="${KAYKAYS_BACKUP_HOME:-$HOME/kaykays-backups}"
BACKUP_BUCKET="${BACKUP_BUCKET:-kaykays-backups}"
RESTORE_PROJECT="$BACKUP_HOME/restore-project"
RESTORE_ID="kaykays-restore"
RESTORE_DB_PORT=55422
RESTORE_STUDIO_PORT=55423
RESTORE_CONTAINER="supabase_db_${RESTORE_ID}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_TABLES="businesses transactions transaction_items products customers employees"

# How long each tier is kept, in days.
declare -A KEEP_DAYS=([hourly]=3 [daily]=35 [weekly]=183 [monthly]=400)
TIERS="hourly daily weekly monthly"

die() { echo "error: $*" >&2; exit 1; }
say() { echo "==> $*" >&2; }

supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then supabase "$@"; else npx --yes supabase "$@"; fi
}

have_r2() { [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; }

# aws CLI against R2. Uses the Docker image when the CLI is not installed. Runs in the current directory.
r2() {
  local endpoint="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  local -a envs=(
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required AWS_PAGER=""
  )
  if command -v aws >/dev/null 2>&1; then
    env "${envs[@]}" aws --endpoint-url "$endpoint" "$@"
  else
    local -a dargs=()
    for e in "${envs[@]}"; do dargs+=(-e "$e"); done
    docker run --rm -i "${dargs[@]}" -v "$PWD:/aws" -w /aws -u "$(id -u):$(id -g)" \
      amazon/aws-cli:2.27.0 --endpoint-url "$endpoint" "$@"
  fi
}

# Backup names, newest first: "NAME<TAB>TIER" lines.
list_names() {
  local only="${1:-}"
  if have_r2; then
    local t
    for t in $TIERS; do
      [ -n "$only" ] && [ "$only" != "$t" ] && continue
      r2 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$t/" \
        --query 'Contents[].Key' --output text 2>/dev/null | tr '\t' '\n' \
        | grep '\.tar\.gz\.gpg$' | sed "s#^$t/##; s#\.tar\.gz\.gpg\$##; s#\$#\t$t#" || true
    done | sort -r
  else
    command -v gh >/dev/null || die "Set the R2 settings in $CONFIG_FILE, or install the gh CLI."
    (cd "$REPO_ROOT" && gh api 'repos/{owner}/{repo}/actions/artifacts?per_page=100' --paginate \
      --jq '.artifacts[] | select(.expired|not) | select(.name|startswith("kaykays-db-")) | .name') \
      | sort -ru | sed 's#$#\tartifact#'
  fi
}

resolve_name() {
  local want="${1:-latest}" line
  if [ "$want" = latest ]; then
    line="$(list_names | head -1)"
  else
    line="$(list_names | awk -F'\t' -v n="$want" '$1==n' | head -1)"
  fi
  [ -n "$line" ] || die "No backup called '$want'. See: scripts/db-backup.sh list"
  echo "$line"
}

open_with_passphrase() { # FILE DEST_DIR
  if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$1" 3<<<"$BACKUP_PASSPHRASE" | tar -xzf - -C "$2"
  else
    gpg --quiet -d "$1" | tar -xzf - -C "$2"
  fi
}

cmd_list() {
  local rows; rows="$(list_names "${1:-}")"
  [ -n "$rows" ] || { echo "No backups found."; return; }
  printf '%-26s %s\n' NAME WHERE
  echo "$rows" | awk -F'\t' '{printf "%-26s %s\n", $1, $2}'
}

# Prints the folder holding roles.sql, schema.sql, data.sql.
cmd_get() {
  local line name tier dir
  if [ -f "${1:-}" ]; then # a local file, e.g. from the offline USB copy
    name="$(basename "$1" .tar.gz.gpg)"; dir="$BACKUP_HOME/$name"
    [ -f "$dir/data.sql" ] && { say "Already opened: $dir"; echo "$dir"; return; }
    mkdir -p "$dir"
    local sum="${1%.tar.gz.gpg}.sha256"
    if [ -f "$sum" ]; then (cd "$(dirname "$1")" && sha256sum -c --quiet "$(basename "$sum")") || die "Checksum does not match."; fi
    say "Opening $name (needs BACKUP_PASSPHRASE)"
    open_with_passphrase "$1" "$dir"
    echo "$dir"; return
  fi
  line="$(resolve_name "${1:-latest}")"; name="${line%%$'\t'*}"; tier="${line##*$'\t'}"
  dir="$BACKUP_HOME/$name"
  if [ -f "$dir/data.sql" ]; then say "Already opened: $dir"; echo "$dir"; return; fi
  mkdir -p "$dir/download"
  say "Downloading $name ($tier)"
  if [ "$tier" = artifact ]; then
    (cd "$REPO_ROOT" && gh run download -n "$name" -D "$dir/download")
  else
    (cd "$dir/download" && r2 s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$tier/$name.tar.gz.gpg" . \
      && r2 s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$tier/$name.sha256" .)
  fi
  (cd "$dir/download" && sha256sum -c --quiet "$name.sha256") || die "Checksum does not match: the download is damaged."
  say "Opening (needs BACKUP_PASSPHRASE)"
  open_with_passphrase "$dir/download/$name.tar.gz.gpg" "$dir"
  rm -rf "$dir/download"
  say "Opened into $dir (taken $(cat "$dir/taken-at.txt" 2>/dev/null || echo '?'))"
  echo "$dir"
}

restored_psql() { docker exec -i "$RESTORE_CONTAINER" psql -U supabase_admin -d postgres "$@"; }

cmd_restore() {
  local dir; dir="$(cmd_get "${1:-latest}")"
  command -v docker >/dev/null || die "Docker is needed for the local copy."

  if docker ps -a --format '{{.Names}}' | grep -qx "$RESTORE_CONTAINER"; then
    say "Removing the previous local copy"
    (cd "$RESTORE_PROJECT" && supabase_cli stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$RESTORE_PROJECT"; mkdir -p "$RESTORE_PROJECT"
  (cd "$RESTORE_PROJECT" && supabase_cli init --force >/dev/null 2>&1 || supabase_cli init >/dev/null)
  local cfg="$RESTORE_PROJECT/supabase/config.toml"
  # Own name and ports, so it never clashes with the development stack. Same Postgres as live.
  sed -i -E \
    -e "s/^project_id = .*/project_id = \"$RESTORE_ID\"/" \
    -e "s/^major_version = .*/major_version = 17/" \
    "$cfg"
  python3 - "$cfg" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
ports = {"api": 55421, "db": 55422, "studio": 55423, "inbucket": 55424, "analytics": 55427}
for section, port in ports.items():
    s = re.sub(r"(\[%s\][^\[]*?\nport = )\d+" % section, r"\g<1>%d" % port, s, count=1, flags=re.S)
s = re.sub(r"(\[db\][^\[]*?\nshadow_port = )\d+", r"\g<1>55420", s, count=1, flags=re.S)
s = re.sub(r"(\[db.pooler\][^\[]*?\nport = )\d+", r"\g<1>55429", s, count=1, flags=re.S)
open(p, "w").write(s)
PY

  say "Starting a private local Supabase (database + Studio)"
  local skip="realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,gotrue"
  [ "${RESTORE_DB_ONLY:-0}" = 1 ] && skip="$skip,studio,kong,postgrest,postgres-meta"
  # The CLI's own health wait is short; a first start on a busy machine takes longer. Wait here instead.
  (cd "$RESTORE_PROJECT" && supabase_cli start -x "$skip" --ignore-health-check) >/dev/null 2>&1 || true
  docker ps --format '{{.Names}}' | grep -qx "$RESTORE_CONTAINER" || die "The local database did not start (see: cd $RESTORE_PROJECT && supabase start --debug)."
  local waited=0
  until docker exec "$RESTORE_CONTAINER" pg_isready -q -U postgres -h 127.0.0.1 2>/dev/null; do
    [ "$waited" -ge 600 ] && die "The local database was not ready after 10 minutes."
    sleep 5; waited=$((waited + 5))
  done
  say "Local database ready after ${waited}s"

  say "Loading the backup (roles, schema, data)"
  {
    cat "$dir/roles.sql" "$dir/schema.sql"
    echo "SET session_replication_role = replica;"
    cat "$dir/data.sql"
  } | restored_psql -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null

  # This copy must never act on the live world: no scheduled jobs, no stored keys to call live services.
  restored_psql -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cron: %', SQLERRM; END $$;
DO $$ BEGIN
  DELETE FROM vault.secrets;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'vault: %', SQLERRM; END $$;
SQL

  echo "$dir" > "$RESTORE_PROJECT/.restored-from"
  cmd_check
  cat <<EOF

Restored $(basename "$dir") (taken $(cat "$dir/taken-at.txt" 2>/dev/null || echo '?'), code $(cut -c1-7 "$dir/code-commit.txt" 2>/dev/null || echo '?')).
  Studio:    http://127.0.0.1:$RESTORE_STUDIO_PORT   (Table Editor and SQL Editor)
  Database:  postgresql://postgres:postgres@127.0.0.1:$RESTORE_DB_PORT/postgres   (DBeaver, TablePlus, psql)
  SQL here:  scripts/db-backup.sh psql
  Finished:  scripts/db-backup.sh stop
Scheduled jobs and Vault keys were removed from this copy, so it cannot call live services.
EOF
}

cmd_check() {
  [ -f "$RESTORE_PROJECT/.restored-from" ] || die "Nothing restored yet. Run: scripts/db-backup.sh restore"
  local dir; dir="$(cat "$RESTORE_PROJECT/.restored-from")"
  local counts="$dir/row-counts.tsv"
  [ -f "$counts" ] || { awk -f <(count_rows_awk) "$dir/data.sql" > "$counts"; }
  local sql; sql="$(awk -F'\t' '{printf "%sSELECT %s AS t, %s AS want, count(*) AS got FROM %s\n", (NR>1?"UNION ALL ":""), "$q$"$1"$q$", $2, $1}' "$counts")"
  [ -n "$sql" ] || die "The backup lists no tables."
  local bad
  bad="$(restored_psql -tA -F $'\t' -c "SELECT t, want, got FROM ($sql) x WHERE want <> got" 2>&1)" || die "Row check failed: $bad"
  if [ -n "$bad" ]; then
    echo "$bad" | awk -F'\t' '{printf "  %s: backup has %s rows, restored %s\n", $1, $2, $3}' >&2
    die "Restored copy does not match the backup."
  fi
  local t
  for t in $CORE_TABLES; do
    restored_psql -tAc "SELECT 1 FROM public.$t LIMIT 0" >/dev/null 2>&1 || die "public.$t is missing after restore."
  done
  say "Check passed: $(wc -l < "$counts") tables, $(awk -F'\t' '{s+=$2} END{print s+0}' "$counts") rows, all match the backup."
}

cmd_psql() { docker exec -it "$RESTORE_CONTAINER" psql -U postgres -d postgres "$@"; }

cmd_stop() {
  [ -d "$RESTORE_PROJECT/supabase" ] || { echo "No local copy running."; return; }
  (cd "$RESTORE_PROJECT" && supabase_cli stop --no-backup) || true
  rm -rf "$RESTORE_PROJECT"
  say "Local copy stopped and deleted. Opened backups stay in $BACKUP_HOME (delete them when done)."
}

cmd_now() {
  (cd "$REPO_ROOT" && gh workflow run backup-database.yml)
  say "Started. Follow it with: gh run watch \$(gh run list --workflow backup-database.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
}

# Rows per table in a --use-copy data dump: "table<TAB>rows".
count_rows_awk() {
  cat <<'AWK'
/^COPY / { t = $2; n = 0; inblock = 1; next }
inblock && /^\\\.$/ { print t "\t" n; inblock = 0; next }
inblock { n++ }
AWK
}

cmd_make() {
  local out="${1:?make OUT_DIR}"
  [ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set."
  [ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE is not set."
  [ "${#BACKUP_PASSPHRASE}" -ge 20 ] || die "BACKUP_PASSPHRASE is shorter than 20 characters."
  mkdir -p "$out"
  local work; work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN

  supabase_cli db dump --db-url "$SUPABASE_DB_URL" -f "$work/roles.sql" --role-only
  supabase_cli db dump --db-url "$SUPABASE_DB_URL" -f "$work/schema.sql"
  supabase_cli db dump --db-url "$SUPABASE_DB_URL" -f "$work/data.sql" --use-copy --data-only
  git -C "$REPO_ROOT" rev-parse HEAD > "$work/code-commit.txt"
  ls "$REPO_ROOT/supabase/migrations" | tail -1 > "$work/latest-migration-in-repo.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$work/taken-at.txt"
  awk -f <(count_rows_awk) "$work/data.sql" > "$work/row-counts.tsv"

  # A dump that "succeeds" but is empty or missing core tables is worse than a failure.
  local t
  for t in $CORE_TABLES; do
    grep -q "^COPY \"public\".\"$t\" \|^COPY public.$t " "$work/data.sql" \
      || die "The data dump has no rows section for public.$t."
  done
  grep -q "CREATE TABLE" "$work/schema.sql" || die "The schema dump has no tables."
  local size; size=$(stat -c %s "$work/data.sql")
  [ "$size" -gt 5000 ] || die "The data dump is only $size bytes."

  local name; name="kaykays-db-$(date -u +%Y%m%d-%H%M)"
  tar -czf - -C "$work" . \
    | gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback \
          --passphrase-fd 3 -o "$out/$name.tar.gz.gpg" 3<<<"$BACKUP_PASSPHRASE"
  (cd "$out" && sha256sum "$name.tar.gz.gpg" > "$name.sha256")
  # Prove it opens before calling it a backup.
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$out/$name.tar.gz.gpg" 3<<<"$BACKUP_PASSPHRASE" \
    | tar -tzf - >/dev/null
  say "Made $name: data $(numfmt --to=iec "$size"), $(wc -l < "$work/row-counts.tsv") tables"
  echo "$name"
}

cmd_upload() {
  local file="${1:?upload FILE TIER...}"; shift
  have_r2 || die "R2 settings are not set."
  local name dir t; name="$(basename "$file" .tar.gz.gpg)"; dir="$(dirname "$file")"
  for t in "$@"; do
    (cd "$dir" && r2 s3 cp --only-show-errors "$name.tar.gz.gpg" "s3://$BACKUP_BUCKET/$t/$name.tar.gz.gpg" \
      && r2 s3 cp --only-show-errors "$name.sha256" "s3://$BACKUP_BUCKET/$t/$name.sha256")
    say "Stored in $t/"
  done
}

cmd_prune() {
  have_r2 || die "R2 settings are not set."
  local t cutoff keys k
  for t in $TIERS; do
    cutoff="$(date -u -d "-${KEEP_DAYS[$t]} days" +%Y-%m-%dT%H:%M:%S)"
    keys="$(r2 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$t/" \
      --query "Contents[?LastModified<'$cutoff'].Key" --output text 2>/dev/null | tr '\t' '\n' | grep -v '^None$' || true)"
    [ -n "$keys" ] || continue
    # Never empty a tier: keep its newest copy whatever its age.
    local newest; newest="$(list_names "$t" | head -1 | cut -f1)"
    for k in $keys; do
      [[ "$k" == "$t/$newest."* ]] && continue
      r2 s3 rm --only-show-errors "s3://$BACKUP_BUCKET/$k"
    done
    say "Pruned $t/ older than ${KEEP_DAYS[$t]} days"
  done
}

case "${1:-}" in
  list) shift; cmd_list "$@" ;;
  get) shift; cmd_get "$@" >/dev/null ;;
  restore) shift; cmd_restore "$@" ;;
  check) cmd_check ;;
  psql) shift; cmd_psql "$@" ;;
  stop) cmd_stop ;;
  now) cmd_now ;;
  make) shift; cmd_make "$@" ;;
  upload) shift; cmd_upload "$@" ;;
  prune) cmd_prune ;;
  *) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

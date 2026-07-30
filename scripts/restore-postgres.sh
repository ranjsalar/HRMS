#!/usr/bin/env bash
# Restores a Postgres backup produced by backup-postgres.sh — either the
# MOST RECENT one from S3-compatible storage, or a specific local file.
# Deliberately requires an explicit --yes flag: this is a destructive
# operation (the dump was produced with --clean --if-exists, so restoring
# DROPS existing objects before recreating them) and must never run by
# accident. See DECISIONS.md, "Infrastructure pass, item 5" — this
# script's own real restore, proving a backup can actually come back, is
# exactly what "backups exist" alone doesn't prove.
#
# ON A GENUINELY FRESH POSTGRES INSTANCE (disaster recovery, not "restore
# onto the same database it came from"): run migrations + role bootstrap
# FIRST, THEN restore — NOT the other way around.
#
#   pnpm --filter @hrms/api exec prisma migrate deploy
#   pnpm --filter @hrms/api db:bootstrap-roles
#   scripts/restore-postgres.sh --yes
#
# Why this order matters, found by actually testing a restore onto a
# truly fresh Postgres cluster (not just re-restoring into the same
# database): `pg_dump` dumps ONE DATABASE's contents — Postgres ROLES
# (hrms_app/hrms_superadmin/hrms_auth) are CLUSTER-level objects, never
# captured by the dump at all. Restoring onto a fresh cluster without
# those roles already existing does NOT fail loudly — `psql` keeps
# processing past individual statement errors by default — it silently
# drops every GRANT and role-scoped RLS POLICY that references a
# missing role (confirmed: the core `tenant_isolation` policy survived,
# but `auth_lockout_update`/`auth_lookup_select` — hrms_auth-specific —
# did not, until the roles existed first). Running migrations again
# after the roles exist is a safe no-op for the schema itself
# (`_prisma_migrations` in the dump already marks everything applied)
# but the role-CREATING migrations' actual DDL only take effect the
# first time they run against a cluster that doesn't have those roles
# yet — which migrate deploy alone (before any restore) provides.
#
# Usage:
#   scripts/restore-postgres.sh --yes                    # restores the latest remote backup
#   scripts/restore-postgres.sh --yes --file ./dump.sql.gz  # restores a specific local file
#
# Required env (same as backup-postgres.sh) when restoring from remote:
#   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_PREFIX="${BACKUP_PREFIX:-postgres-backups}"
MC_ALIAS="${MC_ALIAS:-hrms-backup-target}"

CONFIRMED=false
LOCAL_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) CONFIRMED=true; shift ;;
    --file) LOCAL_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$CONFIRMED" != true ]; then
  echo "Refusing to run without --yes — this DROPS and recreates database objects." >&2
  exit 1
fi

DUMP_FILE="$LOCAL_FILE"

if [ -z "$DUMP_FILE" ]; then
  : "${S3_ENDPOINT:?Set S3_ENDPOINT}"
  : "${S3_ACCESS_KEY_ID:?Set S3_ACCESS_KEY_ID}"
  : "${S3_SECRET_ACCESS_KEY:?Set S3_SECRET_ACCESS_KEY}"
  : "${S3_BUCKET:?Set S3_BUCKET}"

  if ! command -v mc >/dev/null 2>&1; then
    curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
    chmod +x /usr/local/bin/mc
  fi
  mc alias set "$MC_ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null

  echo "Finding the most recent backup in ${S3_BUCKET}/${BACKUP_PREFIX}/..."
  LATEST=$(mc ls "${MC_ALIAS}/${S3_BUCKET}/${BACKUP_PREFIX}/" | sort | tail -n 1 | awk '{print $NF}')
  if [ -z "$LATEST" ]; then
    echo "No backups found." >&2
    exit 1
  fi
  DUMP_FILE="/tmp/${LATEST}"
  echo "Downloading ${LATEST}..."
  mc cp "${MC_ALIAS}/${S3_BUCKET}/${BACKUP_PREFIX}/${LATEST}" "$DUMP_FILE"
fi

echo "Restoring from $DUMP_FILE into the ${POSTGRES_SERVICE} service..."
gunzip -c "$DUMP_FILE" | docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  psql -U "${POSTGRES_USER:-hrms}" "${POSTGRES_DB:-hrms}"

echo "Restore complete."

#!/usr/bin/env bash
# Scheduled Postgres backup — pg_dump against the running production
# Postgres container, uploaded to S3-compatible off-VPS storage via the
# MinIO client (mc — works against real AWS S3, DigitalOcean Spaces, or
# MinIO itself, since all speak the same S3 API; verified against real
# local MinIO before this was considered done, see DECISIONS.md,
# "Infrastructure pass, item 5: automated backups").
#
# A plain shell script, not a Node/ts-node one like this project's other
# admin scripts — deliberately: this runs unattended from cron on the
# VPS host, and needs to work without a pnpm install / node_modules /
# TypeScript toolchain being present or current. `pg_dump` (from the
# `postgres` container, via `docker compose exec`) and `mc` (downloaded
# once, cached) are the only two tools this actually needs.
#
# Usage: scripts/backup-postgres.sh
# Required env (export before running, or source a file that does):
#   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET
#   DATABASE_MIGRATE_URL — read from apps/api/.env.production if not set
#
# Crontab example (daily at 03:00 VPS time):
#   0 3 * * * cd /path/to/hrms && ./scripts/backup-postgres.sh >> /var/log/hrms-backup.log 2>&1

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_PREFIX="${BACKUP_PREFIX:-postgres-backups}"
MC_ALIAS="${MC_ALIAS:-hrms-backup-target}"

: "${S3_ENDPOINT:?Set S3_ENDPOINT (e.g. https://nyc3.digitaloceanspaces.com, or http://localhost:19000 for local MinIO testing)}"
: "${S3_ACCESS_KEY_ID:?Set S3_ACCESS_KEY_ID}"
: "${S3_SECRET_ACCESS_KEY:?Set S3_SECRET_ACCESS_KEY}"
: "${S3_BUCKET:?Set S3_BUCKET}"

if ! command -v mc >/dev/null 2>&1; then
  echo "Installing mc (MinIO client) — one-time, cached for future runs..."
  curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi

mc alias set "$MC_ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="/tmp/hrms-backup-${TIMESTAMP}.sql.gz"

echo "Dumping database from the ${POSTGRES_SERVICE} service..."
# -T: no pseudo-TTY — required for cron/non-interactive invocation.
# --clean --if-exists: the resulting dump is directly restorable onto a
# fresh OR existing database without manual cleanup first.
docker compose -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "${POSTGRES_USER:-hrms}" --clean --if-exists --no-owner "${POSTGRES_DB:-hrms}" \
  | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "Dump complete: $DUMP_FILE ($DUMP_SIZE)"

REMOTE_PATH="${MC_ALIAS}/${S3_BUCKET}/${BACKUP_PREFIX}/hrms-backup-${TIMESTAMP}.sql.gz"
echo "Uploading to $REMOTE_PATH..."
mc cp "$DUMP_FILE" "$REMOTE_PATH"

rm -f "$DUMP_FILE"

echo "Applying retention (deleting backups older than ${RETENTION_DAYS} days)..."
mc rm --recursive --force --older-than "${RETENTION_DAYS}d" "${MC_ALIAS}/${S3_BUCKET}/${BACKUP_PREFIX}/" || true

echo "Backup complete."

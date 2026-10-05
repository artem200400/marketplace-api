#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    pwd
)"

cd "$ROOT"

CONNECTION_URL="$DATABASE_URL"

BACKUP_DIR="$ROOT/backups"

LATEST_BACKUP="$(
    find "$BACKUP_DIR" \
        -maxdepth 1 \
        -type f \
        -name '*.dump' \
        -printf '%T@ %p\n' \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
)"

if [ -z "${LATEST_BACKUP:-}" ]; then
    echo "No backup dump found in $BACKUP_DIR"
    exit 1
fi

if [ ! -f "$LATEST_BACKUP" ]; then
    echo "Backup file not found: $LATEST_BACKUP"
    exit 1
fi

SOURCE_HOST="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(u.hostname);
    "
)"

SOURCE_PORT="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(u.port || '5432');
    "
)"

SOURCE_USER="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(decodeURIComponent(u.username));
    "
)"

SOURCE_PASSWORD="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(decodeURIComponent(u.password));
    "
)"

SOURCE_DB="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(
            decodeURIComponent(
                u.pathname.replace(/^\\//, '')
            )
        );
    "
)"

QUERY_HOST="$SOURCE_HOST"

if [ "$SOURCE_HOST" = "127.0.0.1" ] ||
   [ "$SOURCE_HOST" = "localhost" ]; then
    QUERY_HOST="pgbouncer"
fi

DRILL_CONTAINER="marketplace-restore-drill"
DRILL_VOLUME="marketplace_restore_drill_data"

RESTORE_DB="marketplace_restore"
RESTORE_USER="postgres"
RESTORE_PASSWORD="restore_admin_password"

cleanup() {
    docker rm -f "$DRILL_CONTAINER" \
        >/dev/null 2>&1 || true

    docker volume rm "$DRILL_VOLUME" \
        >/dev/null 2>&1 || true
}

trap cleanup EXIT

cleanup

echo "=== RESTORE DRILL ==="
echo "Backup: $LATEST_BACKUP"
echo ""

SOURCE_CONTROL="$(
    docker compose exec \
        -T \
        -e PGPASSWORD="$SOURCE_PASSWORD" \
        postgres \
        psql \
            -h "$QUERY_HOST" \
            -p "$SOURCE_PORT" \
            -U "$SOURCE_USER" \
            -d "$SOURCE_DB" \
            -Atc "
                SELECT
                    COUNT(*)::text
                    || '|'
                    || COALESCE(
                        SUM(total_amount_cents),
                        0
                    )::text
                FROM orders;
            "
)"

echo "Source control: $SOURCE_CONTROL"

docker volume create "$DRILL_VOLUME" \
    >/dev/null

START_TIME="$(date +%s)"

docker run \
    -d \
    --name "$DRILL_CONTAINER" \
    -e POSTGRES_USER="$RESTORE_USER" \
    -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
    -e POSTGRES_DB="$RESTORE_DB" \
    -v "$DRILL_VOLUME:/var/lib/postgresql/data" \
    postgres:17-alpine \
    >/dev/null

echo "Waiting for restore database..."

READY=0

for _ in $(seq 1 60); do
    if docker exec \
        -e PGPASSWORD="$RESTORE_PASSWORD" \
        "$DRILL_CONTAINER" \
        pg_isready \
            -U "$RESTORE_USER" \
            -d "$RESTORE_DB" \
            >/dev/null 2>&1
    then
        READY=1
        break
    fi

    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo "Restore PostgreSQL did not become ready."
    docker logs "$DRILL_CONTAINER" || true
    exit 1
fi

echo "Restore database is ready."
echo "Restoring backup..."

docker exec \
    -i \
    -e PGPASSWORD="$RESTORE_PASSWORD" \
    "$DRILL_CONTAINER" \
    pg_restore \
        --no-owner \
        --no-privileges \
        -U "$RESTORE_USER" \
        -d "$RESTORE_DB" \
    < "$LATEST_BACKUP"

END_TIME="$(date +%s)"
RTO_SECONDS="$((END_TIME - START_TIME))"

RESTORED_CONTROL="$(
    docker exec \
        -e PGPASSWORD="$RESTORE_PASSWORD" \
        "$DRILL_CONTAINER" \
        psql \
            -U "$RESTORE_USER" \
            -d "$RESTORE_DB" \
            -Atc "
                SELECT
                    COUNT(*)::text
                    || '|'
                    || COALESCE(
                        SUM(total_amount_cents),
                        0
                    )::text
                FROM orders;
            "
)"

echo ""
echo "Restored control: $RESTORED_CONTROL"
echo "RTO: ${RTO_SECONDS} seconds"
echo ""

if [ "$SOURCE_CONTROL" != "$RESTORED_CONTROL" ]; then
    echo "MISMATCH"
    exit 1
fi

echo "MATCH"

#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    pwd
)"

cd "$ROOT"

# Intentionally read DATABASE_URL directly.
# With `set -u`, running this script without
# DATABASE_URL fails with:
# DATABASE_URL: unbound variable
CONNECTION_URL="$DATABASE_URL"

BACKUP_DIR="$ROOT/backups"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(
    date '+%Y-%m-%d_%H-%M-%S'
)"

BACKUP_FILE="$BACKUP_DIR/marketplace_${TIMESTAMP}.dump"

DB_HOST="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(u.hostname);
    "
)"

DB_PORT="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(u.port || '5432');
    "
)"

DB_USER="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(decodeURIComponent(u.username));
    "
)"

DB_PASSWORD="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(decodeURIComponent(u.password));
    "
)"

DB_NAME="$(
    node -e "
        const u = new URL(process.env.DATABASE_URL);
        console.log(
            decodeURIComponent(
                u.pathname.replace(/^\\//, '')
            )
        );
    "
)"

if [ -z "$DB_NAME" ]; then
    echo "DATABASE_URL does not contain database name."
    exit 1
fi

#
# DATABASE_URL uses 127.0.0.1:6432 because
# applications and the grader connect from
# the host.
#
# pg_dump is executed inside the postgres
# container, so localhost must be translated
# to the Docker Compose service name.
#
DUMP_HOST="$DB_HOST"

if [ "$DB_HOST" = "127.0.0.1" ] ||
   [ "$DB_HOST" = "localhost" ]; then
    DUMP_HOST="pgbouncer"
fi

echo "Creating PostgreSQL backup..."
echo "Database: $DB_NAME"
echo "Backup through: $DUMP_HOST:$DB_PORT"

docker compose exec \
    -T \
    -e PGPASSWORD="$DB_PASSWORD" \
    postgres \
    pg_dump \
        -h "$DUMP_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -Fc \
        > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
    echo "Backup failed: output file is empty."
    rm -f "$BACKUP_FILE"
    exit 1
fi

#
# Validate that this really is a readable
# PostgreSQL custom-format archive.
#
if ! docker compose exec \
    -T \
    postgres \
    pg_restore \
        --list \
        < "$BACKUP_FILE" \
        > /dev/null
then
    echo "Backup validation failed."
    rm -f "$BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE="$(
    wc -c < "$BACKUP_FILE" |
    tr -d ' '
)"

echo ""
echo "Backup completed."
echo "Backup path: $BACKUP_FILE"
echo "Backup size: ${BACKUP_SIZE} bytes"
#!/bin/sh
set -e
DB_DIR="${DB_DIR:-/data}"
DB_FILE="$DB_DIR/clinica-tanah.db"
mkdir -p "$DB_DIR"

# First boot on an empty DigitalOcean volume: copy the seeded template DB.
if [ ! -f "$DB_FILE" ] && [ -f /app/seed-data/clinica-tanah.db ]; then
  echo "🌱 Initializing SQLite from seed template…"
  cp /app/seed-data/clinica-tanah.db "$DB_FILE"
  # copy WAL/SHM if present
  [ -f /app/seed-data/clinica-tanah.db-wal ] && cp /app/seed-data/clinica-tanah.db-wal "$DB_DIR/" || true
  [ -f /app/seed-data/clinica-tanah.db-shm ] && cp /app/seed-data/clinica-tanah.db-shm "$DB_DIR/" || true
fi

exec "$@"

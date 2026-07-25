#!/bin/sh
set -e

# Wait for Postgres to accept connections.
if [ -n "$POSTGRES_HOST" ]; then
  echo "Waiting for Postgres at $POSTGRES_HOST:${POSTGRES_PORT:-5432}..."
  until python -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('$POSTGRES_HOST', int('${POSTGRES_PORT:-5432}'))); s.close()" 2>/dev/null; do
    sleep 1
  done
  echo "Postgres is up."
fi

# The primary (api) container collects static and generates the seed JSON files.
# Migrations and seed loading are run MANUALLY (see README) so you control them.
if [ "$PRIMARY" = "1" ]; then
  echo "Collecting static files (admin CSS/JS served via WhiteNoise)..."
  python manage.py collectstatic --no-input

  echo "Generating seed dataset into /seed_data (orgs=${SEED_ORGS:-8}, projects/org=${SEED_PPO:-1500}, scale=${SEED_SCALE:-normal})..."
  SCALE_FLAG=""
  if [ "${SEED_SCALE}" = "big" ]; then SCALE_FLAG="--scale big"; fi
  python /harness/seed.py --orgs "${SEED_ORGS:-8}" --projects-per-org "${SEED_PPO:-1500}" $SCALE_FLAG --out /seed_data
fi

exec "$@"

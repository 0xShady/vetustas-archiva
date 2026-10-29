#!/bin/sh
# Runs on the server from the "Deploy data" workflow after validation: pulls the datasets, re-seeds
# the game database through the game's tools image (dry run first), then restarts the archive API,
# which reads the CSVs at start. --no-deps: a data deploy never recreates the database container.
set -eu

git -C ~/apps/vetustas/archiva pull --ff-only origin main

cd ~/apps/vetustas
docker compose run --rm --no-deps tools npm run seed:datasets -- --dry-run
docker compose run --rm --no-deps tools npm run seed:datasets

docker restart vetustas-api
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3410/health > /dev/null; then
    echo "archive API healthy"
    exit 0
  fi
  sleep 2
done
docker logs --tail 50 vetustas-api
exit 1

#!/bin/bash

set -e

COMPOSE_FILES="-f docker-compose.yml -f contrib/pg-upgrade/docker-compose.yml"

cleanup() {
    echo "Cleaning up Docker containers..."
    docker compose ${COMPOSE_FILES} down --remove-orphans
    docker compose ${COMPOSE_FILES} rm --force db-check-upgrade || true
}
trap cleanup EXIT

# Pull upgrade container
docker compose ${COMPOSE_FILES} pull db-upgrade-version

# Get exit code from db version check
docker compose ${COMPOSE_FILES} up db-check-upgrade \
    --exit-code-from db-check-upgrade \
    --timeout 120
exit_code=$?
echo "db-check-upgrade exited with code $exit_code"

# Exit script if upgrade complete
if [ "$exit_code" -eq 1 ]; then
    echo "Database is already upgraded. Skipping."
    exit 0
fi

# Stop any existing locks on db
docker compose ${COMPOSE_FILES} down
# Do the db upgrade
docker compose ${COMPOSE_FILES} up -d db-upgrade
# View any logs
docker compose ${COMPOSE_FILES} logs db-upgrade-version
# Shut down db prior to restart
docker compose ${COMPOSE_FILES} down

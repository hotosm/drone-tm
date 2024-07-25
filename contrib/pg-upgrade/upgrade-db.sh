#!/bin/bash

# Pull upgrade container
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    pull db-upgrade-version

# Get exit code from db version check
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    up db-check-upgrade --exit-code-from db-check-upgrade
exit_code=$?

# Exit script if upgrade complete
if [ "$exit_code" -eq 1 ]; then
    echo "Database is already upgraded. Skipping."

    docker compose \
        -f docker-compose.yml \
        -f contrib/pg-upgrade/docker-compose.yml \
        rm --force db-check-upgrade

    exit 0
fi

# Stop any existing locks on db
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    down

# Do the db upgrade
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    up -d db-upgrade

# View any logs
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    logs db-upgrade-version

# Shut down db to prior to restart
docker compose \
    -f docker-compose.yml \
    -f contrib/pg-upgrade/docker-compose.yml \
    down

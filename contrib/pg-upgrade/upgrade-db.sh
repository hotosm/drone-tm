#!/bin/bash

set -e

COMPOSE_FILES="-f docker-compose.yml -f contrib/pg-upgrade/docker-compose.yml"

CHECKING_DOCKER_VOLUME=true
cleanup() {
    if [ "$CHECKING_DOCKER_VOLUME" != "true" ]; then
        echo "Cleaning up Docker containers..."
        docker compose ${COMPOSE_FILES} down --remove-orphans
        docker compose ${COMPOSE_FILES} rm --force db-check-upgrade || true
    else
        echo
        echo "Please create docker volume 'drone-tm-pg-16-data' first."
        echo
        echo -e "\e[0;33mdocker volume create drone-tm-pg-16-data\e[0m"
        echo
        echo "Skipping cleanup."
        exit 0
    fi
}
trap cleanup EXIT

# Check if required docker volume exists
echo "Checking if docker volume 'drone-tm-pg-16-data' exists..."
docker volume inspect drone-tm-pg-16-data
CHECKING_DOCKER_VOLUME=false

# Pull upgrade container
echo "Pulling upgrade container..."
docker compose ${COMPOSE_FILES} pull db-upgrade-version

# Get exit code from db version check
echo "Checking DB version..."
docker compose ${COMPOSE_FILES} up db-check-upgrade \
    --exit-code-from db-check-upgrade \
    --timeout 120 || true
exit_code=$?
echo "db-check-upgrade exited with code $exit_code"

# Exit script if upgrade complete
if [ "$exit_code" -eq 1 ]; then
    echo "Database is already upgraded. Skipping."
    exit 0
fi

# Stop any existing locks on db
echo "Stopping existing locks on DB..."
docker compose ${COMPOSE_FILES} down

# Do the db upgrade
echo "Upgrading the database..."
docker compose ${COMPOSE_FILES} up -d db-upgrade

# View any logs
echo "Viewing logs..."
docker compose ${COMPOSE_FILES} logs db-upgrade-version

# Shut down db prior to restart
echo "Shutting down DB..."
docker compose ${COMPOSE_FILES} down

echo "Database upgrade completed successfully."

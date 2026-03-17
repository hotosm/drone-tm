#!/bin/bash

set -eo pipefail

wait_for_db() {
    max_retries=30
    retry_interval=5
    db_host="${POSTGRES_HOST:-db}"
    db_port="${POSTGRES_PORT:-5432}"
    db_user="${POSTGRES_USER:-dtm}"
    db_name="${POSTGRES_DB:-dtm_db}"

    for ((i = 0; i < max_retries; i++)); do
        if pg_isready \
            --host "${db_host}" \
            --port "${db_port}" \
            --username "${db_user}" \
            --dbname "${db_name}" >/dev/null 2>&1; then
            echo "Database is available."
            return 0
        fi
        echo "Database is not yet available at ${db_host}:${db_port}. Retrying in ${retry_interval} seconds..."
        sleep ${retry_interval}
    done

    echo "Timed out waiting for the database to become available at ${db_host}:${db_port}."
    exit 1
}

wait_for_db

exec "$@"

#!/bin/bash

set -eo pipefail

wait_for_db() {
    max_retries=30
    retry_interval=5

    for ((i = 0; i < max_retries; i++)); do
        if </dev/tcp/"${POSTGRES_HOST:-db}"/5432; then
            echo "Database is available."
            return 0  # Database is available, exit successfully
        fi
        echo "Database is not yet available. Retrying in ${retry_interval} seconds..."
        sleep ${retry_interval}
    done

    echo "Timed out waiting for the database to become available."
    exit 1  # Exit with an error code
}

wait_for_minio() {
    max_retries=30
    retry_interval=5

    for ((i = 0; i < max_retries; i++)); do
        if curl --silent -I "${S3_ENDPOINT:-http://minio:9000}" >/dev/null; then
            echo "MINIO is available."
            return 0  # Minio is available, exit successfully
        fi
        echo "Minio is not yet available. Retrying in ${retry_interval} seconds..."
        sleep ${retry_interval}
    done

    echo "Timed out waiting for Minio to become available."
    exit 1  # Exit with an error code
}

get_frontend_index_html() {
    echo "Downloading index.html from object storage.."
    curl --fail --create-dirs ${S3_ENDPOINT}/${FRONTEND_BUCKET_NAME}/index.html --output /project/src/backend/templates/index.html || echo "Failed to download index.html... Please retry manually for now...."
    chmod -R 777 /project/src/backend/templates
}

# Start wait in background with tmp log files
wait_for_db &
wait_for_minio &
get_frontend_index_html &
wait

exec "$@"

exit 0

#!/bin/sh
set -e

if [[ -z "${S3_ACCESS_KEY}" ]]; then
  echo "Missing environment variable S3_ACCESS_KEY"
  exit 0
fi

if [[ -z "${S3_SECRET_KEY}" ]]; then
  echo "Missing environment variable S3_SECRET_KEY"
  exit 0
fi

MINIO_HOST_URL=${MINIO_HOST_URL:-http://localhost:9000}
FRONTEND_BUCKET_NAME=${FRONTEND_BUCKET_NAME:-frontendstatic}

if [[ "${MINIO_HOST_URL}" == 'http://localhost:9000' ]]; then
  CONFIG_MINIO=http://minio:9000
fi

mc config host add minio ${CONFIG_MINIO:-MINIO_HOST_URL} $S3_ACCESS_KEY $S3_SECRET_KEY

mc mb minio/${FRONTEND_BUCKET_NAME} || echo "Failed to create bucket in MinIO"
mc anonymous set download minio/${FRONTEND_BUCKET_NAME} || echo "Failed setting staticfiles dir as public in MinIO"

mc cp --recursive /tmp/dist/* minio/${FRONTEND_BUCKET_NAME}

echo ========== Copying index.html to volume ==========
cp -v /tmp/dist/index.html /tmp/frontend_html/index.html

echo "======================================================"
echo "           Index File Copied Successfully!            "
echo "                      Exitting!                       "
echo "======================================================"

exit 0

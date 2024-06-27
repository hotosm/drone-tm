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
FRONTEND_BUCKET_NAME=${FRONTEND_BUCKET_NAME:-frontend-static}

mcli config host add minio http://minio:9000 $S3_ACCESS_KEY $S3_SECRET_KEY

mcli mb minio/${FRONTEND_BUCKET_NAME} || echo "Failed to create bucket in MinIO"
mcli anonymous set download minio/${FRONTEND_BUCKET_NAME}/staticfiles || echo "Failed setting staticfiles dir as public in MinIO"

mcli cp --recursive /tmp/dist/* minio/${FRONTEND_BUCKET_NAME}/staticfiles

export MAIN_CSS=$(basename $(ls /tmp/dist/assets/index-*.css))
export MAIN_JS=$(basename $(ls /tmp/dist/assets/index-*.js))

cat <<EOF | envsubst >/tmp/index.html
{% with s3_link="${MINIO_HOST_URL}/${FRONTEND_BUCKET_NAME}/staticfiles" %}
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="{{ s3_link }}/favicon.ico" />
    <!-- <meta name="viewport" content="width=device-width, initial-scale=1.0" /> -->
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"
    />
    <link
      href="https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined|Material+Symbols+Outlined"
      rel="stylesheet"
    />
    <link
      href="https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined|Material+Symbols+Outlined"
      rel="stylesheet"
    />
    <title>Drone Tasking Manager</title>
    <script type="module" crossorigin src="{{ s3_link }}/assets/$MAIN_JS"></script>
    <link rel="stylesheet" href="{{ s3_link }}/assets/$MAIN_CSS">
  </head>

  <body>
    <div id="backdrop-root"></div>
    <div id="overlay-root"></div>
    <div id="root"></div>
    
  </body>
</html>
{% endwith %}
EOF

# Copy index.html to all backend containers
for container in $(docker ps -a -q --filter "label=com.docker.compose.service=backend"); do
  docker cp /tmp/index.html $container:/project/src/backend/templates/index.html
done

echo "======================================================"
echo "           Index File Copied Successfully!            "
echo "                      Exitting!                       "
echo "======================================================"

exit 0

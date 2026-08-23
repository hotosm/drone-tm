#!/bin/sh

set -eu

# Copy frontend to attached volume
echo "Syncing files from /app --> /frontend_html"
rclone sync /app /frontend_html

# Generate runtime config.js from environment variables.
# This enables changing API/COG endpoints without rebuilding the frontend image.
echo "Generating /frontend_html/config.js from environment..."
{
  echo "// Generated at container start by docker-entrypoint.sh. Do not edit."
  echo "window.__RUNTIME_CONFIG__ = {"
  for name in $(env | grep -E '^VITE_' | cut -d= -f1 | sort); do
    value=$(printenv "$name")
    # Escape values for JavaScript strings.
    escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '  "%s": "%s",\n' "$name" "$escaped"
  done
  echo "};"
} > /frontend_html/config.js

echo "Updating directory permissions 101:101 (nginx)."
chown -R 101:101 /frontend_html
echo "Sync done."

# Successful exit (stop container)
exit 0

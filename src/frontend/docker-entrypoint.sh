#!/bin/sh

set -e

# Copy frontend to attached volume
echo "Syncing files from /app --> /frontend_html"
rclone sync /app /frontend_html

# Generate runtime config.js from environment variables.
# This enables changing API/COG endpoints without rebuilding the frontend image.
cat > /frontend_html/config.js <<EOF
window.__RUNTIME_CONFIG__ = {
  VITE_API_URL: "${VITE_API_URL:-/api}",
};
EOF

echo "Updating directory permissions 101:101 (nginx)."
chown -R 101:101 /frontend_html
echo "Sync done."

# Successful exit (stop container)
exit 0

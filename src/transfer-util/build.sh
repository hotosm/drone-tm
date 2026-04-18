#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="gmeligio/flutter-android:3.41.6"
OUTPUT_APK="$SCRIPT_DIR/dronetm-transfer.apk"

echo "Building DroneTM Transfer APK using $IMAGE..."

docker run --rm \
  -v "$SCRIPT_DIR":/app \
  -w /app \
  "$IMAGE" \
  bash -c "flutter pub get && flutter build apk --release"

# Copy the release APK to the project root
cp "$SCRIPT_DIR/build/app/outputs/flutter-apk/app-release.apk" "$OUTPUT_APK"

echo "Build complete: $OUTPUT_APK"

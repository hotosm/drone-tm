#!/bin/sh
set -e

echo ========== Copying index.html to volume ==========
cp -v /tmp/dist/index.html /tmp/frontend_html/index.html

echo "======================================================"
echo "           Index File Copied Successfully!            "
echo "                      Exiting!                       "
echo "======================================================"

exit 0

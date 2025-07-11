#!/bin/bash

# From a fresh machine, install a WebODM instance to get going

# Install docker rootless
curl --proto '=https' --tlsv1.2 -LO https://raw.githubusercontent.com/hotosm/field-tm/refs/heads/dev/scripts/0-container-engine/docker.sh
chmod +x docker.sh
bash docker.sh
rm docker.sh

source ~/.bashrc

# Env var for docker compose, pass the domain name
curl --proto '=https' --tlsv1.2 -LO https://raw.githubusercontent.com/hotosm/drone-tm/refs/heads/develop/contrib/webodm/.env
echo "WO_HOST=${WO_HOST}" >> .env
echo "WO_SECRET_KEY=${WO_SECRET_KEY}" >> .env

curl --proto '=https' --tlsv1.2 -LO https://raw.githubusercontent.com/hotosm/drone-tm/refs/heads/develop/contrib/webodm/compose.yaml
docker compose up -d

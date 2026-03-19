#!/bin/bash
# setup-test-server.sh - Setup inicial para servidor de testing HOTOSM
# Ejecutar via SSH: ssh ubuntu@107.21.77.122 'bash -s' < scripts/setup-test-server.sh
set -e

echo "=== HOTOSM Test Server Setup ==="

# 1. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker installed. Please logout and login again, then re-run this script."
    exit 0
fi

# 2. Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose plugin..."
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
fi

# 3. Create Traefik directory
echo "Setting up Traefik..."
sudo mkdir -p /opt/traefik
sudo chown $USER:$USER /opt/traefik
cd /opt/traefik

# 4. Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
services:
  traefik:
    image: traefik:v3.2
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/etc/traefik/traefik.yml:ro
      - ./acme.json:/acme.json
    networks:
      - hotosm-test

networks:
  hotosm-test:
    name: hotosm-test
    driver: bridge
EOF

# 5. Create traefik.yml
cat > traefik.yml << 'EOF'
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: hotosm-test

certificatesResolvers:
  letsencrypt:
    acme:
      email: sysadmin@hotosm.org
      storage: /acme.json
      httpChallenge:
        entryPoint: web
EOF

# 6. Create acme.json with correct permissions
touch acme.json
chmod 600 acme.json

# 7. Start Traefik
docker compose up -d

echo ""
echo "=== Setup Complete ==="
echo "Traefik is running and will auto-discover containers with traefik labels"
echo "Apps should connect to network: hotosm-test"

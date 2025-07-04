# Postgres Version Upgrades

- Based on images from https://github.com/pgautoupgrade/docker-pgautoupgrade
- Adds the PostGIS dependency and builds an image for our repo.
- The image is used for upgrading between containerised Postgres versions.

```bash
# From the repo root
docker compose --file contrib/pg-upgrade/compose.yaml \
    up --abort-on-container-failure
```

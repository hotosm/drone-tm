# Postgres Version Upgrades

- Based on images from https://github.com/tianon/docker-postgres-upgrade
- Adds the PostGIS dependency and builds an image for our repo.
- The image is used for upgrading between containerised Postgres versions.

```bash
# From the repo root
bash contrib/pg-upgrade/upgrade-db.sh
```

This will start the upgrade, wait for completion, then mount
the data and start the new Postgres 16 container.

> Note it is important to shut down the postgres container first, or
> a postmaster error will be encountered.

FROM tianon/postgres-upgrade:14-to-16

RUN set -ex \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install \
    -y --no-install-recommends \
        "postgresql-14-postgis-3" \
        "postgresql-16-postgis-3" \
    && rm -rf /var/lib/apt/lists/*

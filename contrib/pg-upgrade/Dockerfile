FROM docker.io/postgis/postgis:14-3.4-alpine as pg14
FROM docker.io/postgis/postgis:15-3.4-alpine as pg15
FROM docker.io/postgis/postgis:16-3.4-alpine as pg16
FROM docker.io/pgautoupgrade/pgautoupgrade:16-alpine as pgautoupgrade

# Original entrypoint copied overwritten in /usr/local/bin, so copy elsewhere
RUN cp /usr/local/bin/docker-entrypoint.sh /docker-entrypoint.sh

# Remove libs for Postgres < v14
RUN rm -rf \
    /usr/local-pg9.5 \
    /usr/local-pg9.6 \
    /usr/local-pg10 \
    /usr/local-pg11 \
    /usr/local-pg12 \
    /usr/local-pg13

# Copy in PostGIS libs / bins
COPY --from=pg16 /_pgis*.* /
COPY --from=pg16 /usr/lib /usr/lib

# Copy extensions for postgresql 16
COPY --from=pg16 /usr/local /usr/local
# Copy all extensions for postgresql 15
COPY --from=pg15 /usr/local/lib/postgresql /usr/local-pg15/lib/postgresql
# Copy all extensions for postgresql 14
COPY --from=pg14 /usr/local/lib/postgresql /usr/local-pg14/lib/postgresql

# Squash image to reduce size
FROM scratch
COPY --from=pgautoupgrade / /
ENV \
    PGTARGET=16 \
    PGDATA=/var/lib/postgresql/data
WORKDIR /var/lib/postgresql
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["postgres"]

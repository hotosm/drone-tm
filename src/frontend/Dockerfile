# ARG for the base image
ARG NODE_BASE=18.16.0-bullseye-slim
ARG MINIO_TAG=RELEASE.2024-08-03T04-33-23Z
ARG BASE64_ARGS_TO_ENV=ENV_VARS_BASE64_ENCODED_FOR_LIVE

# Base image with frontend code
FROM node:${NODE_BASE} AS base
RUN mkdir -p /app
WORKDIR /app

# Run development environment
FROM base AS development
ENTRYPOINT ["/bin/sh", "-c", "yarn; yarn start --host 0.0.0.0;"]

# Generate frontend build files
FROM base AS build
ARG BASE64_ARGS_TO_ENV

COPY ./package.json .
RUN yarn
COPY . /app
RUN ( echo ${BASE64_ARGS_TO_ENV} | base64 -di ) > .env
RUN yarn build

# Copy static files to minio and generated index.html to volume
FROM docker.io/minio/minio:${MINIO_TAG} AS live
COPY --from=build /app/dist /tmp/dist
COPY --from=build /app/.env /.env
VOLUME /tmp/frontend_html
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT [ "/docker-entrypoint.sh" ]

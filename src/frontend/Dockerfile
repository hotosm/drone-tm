# ARG for the base image
ARG NODE_BASE=22-slim
ARG MINIO_TAG=RELEASE.2024-08-03T04-33-23Z
ARG BASE64_ARGS_TO_ENV=ENV_VARS_BASE64_ENCODED_FOR_LIVE

# Base image with frontend code
FROM node:${NODE_BASE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p /app
WORKDIR /app


# Run development environment
FROM base AS development
COPY ./package.json pnpm-lock.yaml .
RUN corepack prepare pnpm@9.15.5 --activate && corepack enable && corepack install
RUN pnpm install
ENTRYPOINT ["/bin/sh", "-c", "pnpm run start --host 0.0.0.0;"]



# Generate frontend build files
FROM base AS build
ARG BASE64_ARGS_TO_ENV
COPY ./package.json pnpm-lock.yaml .
RUN corepack prepare pnpm@9.15.5 --activate && corepack enable && corepack install
RUN pnpm install
COPY . /app
RUN ( echo ${BASE64_ARGS_TO_ENV} | base64 -di ) > .env
RUN pnpm run build



# Copy static files to minio and generated index.html to volume
FROM docker.io/minio/minio:${MINIO_TAG} AS live
COPY --from=build /app/dist /tmp/dist
COPY --from=build /app/.env /.env
VOLUME /tmp/frontend_html
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT [ "/docker-entrypoint.sh" ]

# Base image with frontend code
FROM node:22-slim AS base
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
ARG BASE_URL
ARG COG_URL
ARG SITE_NAME
ENV \
    BASE_URL=${BASE_URL} \
    COG_URL=${COG_URL} \
    SITE_NAME=${SITE_NAME}
COPY ./package.json pnpm-lock.yaml .
RUN corepack prepare pnpm@9.15.5 --activate && corepack enable && corepack install
RUN pnpm install
COPY . /app
RUN pnpm run build



# Copy generate static files docker volume at start
FROM docker.io/debian:trixie-slim AS live
COPY --from=build /app/dist /tmp/dist
VOLUME /tmp/frontend_html
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT [ "/docker-entrypoint.sh" ]

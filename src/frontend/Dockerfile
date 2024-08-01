# ARG for the base image
ARG NODE_BASE=18.16.0-bullseye-slim

# Base image with frontend code
FROM node:${NODE_BASE} AS base

RUN mkdir -p /app
WORKDIR /app
COPY ./src/frontend /app

# Run development environment
FROM base AS development
ENTRYPOINT ["/bin/sh", "-c", "env | tee .env ; yarn; yarn start --host 0.0.0.0;"]

# Generate frontend build files
FROM base AS build
COPY ../.env .env
RUN yarn
RUN yarn build

# Copy static files to minio and generated index.html to backend services
FROM docker:27.0-dind-rootless AS live
USER 0
RUN apk update && apk add minio-client envsubst
COPY --from=build /app/dist /tmp/dist
COPY ./src/frontend/docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT [ "/docker-entrypoint.sh" ]

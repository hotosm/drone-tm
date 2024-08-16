# ARG for the base image
ARG NODE_BASE=18.16.0-bullseye-slim
ARG MINIO_TAG=RELEASE.2023-10-25T06-33-25Z

# Base image with frontend code
FROM node:${NODE_BASE} AS base

RUN mkdir -p /app
WORKDIR /app
COPY ./package.json .
COPY ./yarn.lock .
RUN ["/bin/sh", "-c", "env | tee .env"]
RUN yarn

# Run development environment
FROM base AS development
COPY . /app
ENTRYPOINT ["/bin/sh", "-c", "yarn start --host 0.0.0.0;"]

# Generate frontend build files
FROM base AS build
COPY . /app
RUN yarn build

# Copy static files to minio and generated index.html to volume
FROM docker.io/minio/minio:${MINIO_TAG} AS live
COPY --from=build /app/dist /tmp/dist
VOLUME /tmp/frontend_html
ENTRYPOINT [ "/app/docker-entrypoint.sh" ]

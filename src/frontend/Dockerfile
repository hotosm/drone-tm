# ARG for the base image
ARG NODE_BASE=18.16.0-bullseye-slim
ARG STATIC_BASE_URL http://localhost:9000/frontendstatic/

# Base image with frontend code
FROM node:${NODE_BASE} as base

RUN mkdir -p /app
WORKDIR /app
COPY ./src/frontend /app

# Run development environment
FROM base as development
RUN env | tee .env
ENTRYPOINT ["/bin/sh", "-c" , "yarn && yarn start --host 0.0.0.0"]

# Generate frontend build files
FROM base as build
ARG STATIC_BASE_URL
ENV STATIC_BASE_URL ${STATIC_BASE_URL}
RUN yarn
RUN yarn build

# Copy static files to minio and generated index.html to backend services
FROM docker:27.0-dind-rootless as live
USER 0
RUN apk update && apk add minio-client envsubst
COPY --from=build /app/dist /tmp/dist
COPY ./src/frontend/docker-entrypoint.sh /docker-entrypoint.sh
ENTRYPOINT [ "/docker-entrypoint.sh" ]

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
ENTRYPOINT ["/bin/sh", "-c", "pnpm run start"]



# Generate frontend build files
FROM base AS build
ARG VITE_AUTH_PROVIDER
ARG VITE_HANKO_URL
ARG VITE_FRONTEND_URL
ARG VITE_API_URL
ENV \
    VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER} \
    VITE_HANKO_URL=${VITE_HANKO_URL} \
    VITE_FRONTEND_URL=${VITE_FRONTEND_URL} \
    VITE_API_URL=${VITE_API_URL}
COPY ./package.json pnpm-lock.yaml .
RUN corepack prepare pnpm@9.15.5 --activate && corepack enable && corepack install
RUN pnpm install
COPY . /app
RUN pnpm run build



# Copy generate static files docker volume at start
FROM docker.io/rclone/rclone:1 AS prod
VOLUME /frontend_html
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
WORKDIR /app
COPY --from=build /app/dist /app

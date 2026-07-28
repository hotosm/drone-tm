# Base image with frontend code
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack prepare pnpm@9.15.5 --activate && corepack enable
RUN mkdir -p /app
WORKDIR /app


# Build the bundled drone-mesh 3D viewer. Standalone project with its own
# lockfile (not in the pnpm workspace), so build isolated. Its own layer, so it
# only rebuilds when drone-mesh/ changes. Served at /mesh: prod copies dist into
# the frontend build (build stage); dev serves /app/mesh-dist via a vite
# middleware (see vite.config.ts).
FROM base AS mesh-build
COPY ./drone-mesh /app/drone-mesh
WORKDIR /app/drone-mesh
RUN pnpm install && pnpm run build


# Run development environment
FROM base AS development
COPY ./pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ./frontend/package.json ./frontend/package.json
COPY ./gcp-editor/package.json ./gcp-editor/package.json
RUN pnpm install
COPY --from=mesh-build /app/drone-mesh/dist /app/mesh-dist
WORKDIR /app/frontend
ENTRYPOINT ["/bin/sh", "-c", "pnpm run start"]


# Generate frontend build files
FROM base AS build
COPY ./pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ./frontend/package.json ./frontend/package.json
COPY ./gcp-editor/package.json ./gcp-editor/package.json
RUN pnpm install
COPY ./gcp-editor /app/gcp-editor
COPY ./frontend /app/frontend
WORKDIR /app/gcp-editor
RUN pnpm run build
WORKDIR /app/frontend
RUN pnpm run build
# Bundle the drone-mesh viewer at /mesh (served same-origin)
COPY --from=mesh-build /app/drone-mesh/dist /app/frontend/dist/mesh


# Copy generated static files to docker volume at start
FROM docker.io/rclone/rclone:1 AS prod
VOLUME /frontend_html
COPY ./frontend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
WORKDIR /app
COPY --from=build /app/frontend/dist /app

# Setting Up DroneTM For Development

!!! info

    This guide is for **local development**. For production / self-hosted
    deployments, see the [Installation Guide](../INSTALL.md).

## Prerequisites

!!! important

    You must have Docker and Docker Compose installed first:

    - [Docker install guide](https://docs.docker.com/engine/install)
    - [Docker Compose install guide](https://docs.docker.com/compose/install)

Just is required too:

- [Just](https://github.com/casey/just#installation)

## (Optional) Configure Google OAuth

- Create a new client ID and secret in your Google account for OAuth2.
- Set the redirect URL to your local frontend URL, e.g. `http://localhost:3040/auth`.

!!! note

      This step is only required to use the frontend.

## Configure Your Dotenv

- There is an example `.env.example` file that `.env` can be generated from using this command:
  `just config generate-dotenv`
  - The generator runs the repo’s `./envsubst` twice so defaults that reference other vars
    (e.g. `$BACKEND_WEB_APP_PORT`) resolve correctly.
- If you only plan on using the backend then everything should be
  configured for you.
- The current setup expects:
  - `DOMAIN` for public URLs (backend derives its public base URL automatically)
  - `VITE_API_URL` for the frontend to reach the backend API (must include `/api`)
- S3 endpoints:
  - `S3_ENDPOINT_UPLOAD`: used by browser presigned uploads (often `http://localhost:9000` in dev)
  - `S3_ENDPOINT_DOWNLOAD`: used by browser downloads/display
    - In dev, defaults to `http://localhost:9000` (downloads via a path-rewriting proxy will break presigned signatures).
- If you set up Google OAuth credentials, set the variables here:

  ```dotenv
  GOOGLE_CLIENT_ID="YOUR_CLIENT_ID"
  GOOGLE_CLIENT_SECRET="YOUR_CLIENT_SECRET"
  # Redirect URI must match your Google OAuth app config
  GOOGLE_LOGIN_REDIRECT_URI="http://localhost:3040/auth"
  ```

#### Monitoring

- At present, only Sentry is configured as the backend for logging with OpenTelemetry. By default
  logging in non-production environments is disabled.
- To set it up and work with it, you will need these two ENV variables set correctly:

  ```
  MONITORING="sentry"
  SENTRY_DSN="<sentry dsn url here>"
  ```

  Then make sure to rebuild your backend Docker image: `docker compose build backend` so that Docker
  now knows to install the extra set of dependencies.
  You should see a success message if it worked correctly.

- `LOG_LEVEL` is set to `info` by default. Setting it to `debug` makes the logs very verbose, so it
  is recommended to leave the setting as is.

### Build and Run The Containers

- The `Justfile` in the project root contains all the logic needed to build and run the application.
- `compose.sub.yaml` is used for production deploys (`just start prod`) - `compose.yaml`, meanwhile, is used for development.
- To start the application, run:
  `just start all`
- This command will pull the required Docker images and start all services correctly.

### Access The Services

DroneTM Backend: [http://localhost:8000](http://localhost:8000)

DroneTM Frontend: [http://localhost:3040](http://localhost:3040)

> Note the ports may be different if you changed them in the dotenv file.

## End-to-end imagery processing (ScaleODM)

DroneTM submits processing jobs to **ScaleODM**, which reads imagery directly
from S3 and writes outputs back to S3. The compose stack ships a small NodeODM
container as a placeholder so the backend boots cleanly, **but NodeODM cannot
complete an end-to-end run**: it has no S3 writer, so the finalize step (which
expects the orthophoto to already be in S3) will fail. To exercise the full
pipeline locally you need ScaleODM running.

1. Start ScaleODM on your host (kind/k3d, see the [ScaleODM
   quickstart](https://github.com/hotosm/scaleodm)). It exposes its API on
   `localhost:31100` by default.
2. Point the backend at it from inside the compose network. Set in `.env`:

   ```dotenv
   # Backend container reaches the host via host.docker.internal
   ODM_ENDPOINT=http://host.docker.internal:31100
   # Only set this if your S3 hostname differs from what ScaleODM workflow
   # pods can resolve (self-hosted MinIO/RustFS):
   # SCALEODM_S3_ENDPOINT=http://host.docker.internal:9000
   ```

3. Restart the backend: `just start backend`.

When `just start all` runs it will probe `localhost:31100/info` and warn if
ScaleODM isn't reachable. The warning is informational - the rest of DroneTM
(uploads, ingest, classification, UI) works without ScaleODM; only the
processing path needs it.

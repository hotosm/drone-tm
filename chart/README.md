# Drone Task Manager Helm Chart

This Helm chart deploys the Drone Task Manager application and its dependencies.

## Values Files

### `values.yaml`

Default values for the chart. Contains all configurable parameters with sensible defaults.

### `values-local.yaml`

Development environment configuration:

- **Purpose**: Local development and testing
- **Usage**: `helm install drone-tm ./chart -f values-local.yaml`
- **Features**:
  - Minimal resource allocation
  - Ingress disabled (uses port-forward)
  - Optional in-cluster Postgres for local testing

## Usage Examples

### Local Development

```bash
# Install with development values
helm install drone-tm ./chart -f values-local.yaml

# Upgrade with development values
helm upgrade drone-tm ./chart -f values-local.yaml
```

## Dependencies

This chart includes the following subcharts:

- **Redis**: Caching and task queue
- **PostgreSQL**: Database with PostGIS extension (optional)

## Configuration

Key configuration areas:

- **Global**: Storage class (used by some dependency charts for PVCs)
- **Ingress**: Single ingress that routes both `/` (UI) and `/api` (API) to the backend service
- **Backend**: API server configuration
- **FrontendAssets**: Init container that syncs built frontend assets into `frontend_html` for the backend to serve
- **Worker**: Background task processing
- **PostgreSQL**: Database configuration
- **Redis**: Cache and queue configuration

## Environment Variables

- Can be set via the `env` or `extraEnvFrom` keys.
- They will be included in the backend, migration, and arq worker containers.

### Overriding The Frontend API_URL

- The VITE_API_URL baked into builds / images has been removed.
- Now instead we have a dynamic config.json that is injected into the frontend at runtime.
- By default the frontend will load from an API at `${DOMAIN}/api`.
- To override this, simply update the `frontend.runtimeEnv` section in `values.yaml`.

## Secrets

Secrets are managed through Kubernetes Secrets (recommended via SealedSecrets / ExternalSecrets in GitOps setups):

- This chart **does not create secrets**.
- Provide a pre-created Secret and set `existingSecret.name` (or leave it empty to default to `<release>-drone-tm-secrets`).

Your Secret should include (at minimum):

- Database: `POSTGRES_PASSWORD`
- S3: `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
- Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JAXA_AUTH_TOKEN`, `SECRET_KEY`.
- Redis: (provided automatically by the chart; no `REDIS_DSN` needed)

### Creating a Kubernetes Secret

Create a Secret in the same namespace as your Helm release:

```bash
kubectl -n <namespace> create secret generic drone-tm-prod-secrets \
  --from-literal=POSTGRES_PASSWORD='<postgres password>' \
  --from-literal=S3_ACCESS_KEY='<aws access key id>' \
  --from-literal=S3_SECRET_KEY='<aws secret access key>' \
  --from-literal=SECRET_KEY='<fastapi secret key>' \
  --from-literal=GOOGLE_CLIENT_ID='<google oauth client id>' \
  --from-literal=GOOGLE_CLIENT_SECRET='<google oauth client secret>' \
  --from-literal=GOOGLE_LOGIN_REDIRECT_URI='https://<your-domain>/auth' \
  --from-literal=SMTP_PASSWORD='<smtp password>' \
  --from-literal=JAXA_AUTH_TOKEN='<smtp password>' \
  --from-literal=SENTRY_DSN='<sentry dsn>'
```

Then reference it from Helm values:

```bash
helm upgrade --install drone-tm ./chart \
  -n <namespace> \
  --set existingSecret.name=drone-tm-prod-secrets
```

### Creating Sealed Secrets

```bash
# Create secret above with:
  --dry-run=client -o yaml > secret.yaml

kubeseal -n <namespace> -o yaml < secret.yaml > sealed-secret.yaml
```

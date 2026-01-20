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

### Setting The Frontend API_URL

- Typically baked into images.
- We have opted for a config to allow dynamic injection of env vars into the frontend build.
- Simply update the frontend section in `values.yaml` with your required variables.

## Secrets

Secrets are managed through Kubernetes Secrets (recommended via SealedSecrets / ExternalSecrets in GitOps setups):

- This chart **does not create secrets**.
- Provide a pre-created Secret and set `existingSecret.name` (or leave it empty to default to `<release>-drone-tm-secrets`).

Your Secret should include (at minimum):

- Database: `POSTGRES_PASSWORD`
- S3: `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
- Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SECRET_KEY`.
- Redis: (provided automatically by the chart; no `REDIS_DSN` needed)

### Creating Sealed Secrets

```bash
kubectl create secret ... from all specified secret vars above (generic)

kubeseal secret.yaml > sealed-secret.yaml
```

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

## Environment-Specific Configuration

Environment-specific configurations (staging, production) are managed in the k8s-infra repository through ArgoCD applications. This approach:

- **Eliminates duplication** between chart repo and k8s-infra repo
- **Centralizes environment config** in the infrastructure repository
- **Maintains separation of concerns** between application and infrastructure
- **Enables GitOps** workflow for environment management

## Usage Examples

### Local Development

```bash
# Install with development values
helm install drone-tm ./chart -f values-local.yaml

# Upgrade with development values
helm upgrade drone-tm ./chart -f values-local.yaml
```

### Staging/Production Deployment

Staging and production deployments are managed through ArgoCD applications in the k8s-infra repository. The environment-specific configurations are embedded directly in the ArgoCD Application manifests, eliminating the need for separate values files.

To modify environment-specific settings:

1. Edit the ArgoCD Application manifest in k8s-infra repository
2. Update the `values` section in the `helm` configuration
3. ArgoCD will automatically sync the changes to the cluster

## Dependencies

This chart includes the following subcharts:

- **PostgreSQL**: Database with PostGIS extension
- **Redis**: Caching and task queue

## Configuration

Key configuration areas:

- **Global**: Storage class (used by some dependency charts for PVCs)
- **Ingress**: Single ingress that routes both `/` (UI) and `/api` (API) to the backend service
- **Backend**: API server configuration
- **FrontendAssets**: Init container that syncs built frontend assets into `frontend_html` for the backend to serve
- **Worker**: Background task processing
- **PostgreSQL**: Database configuration
- **Redis**: Cache and queue configuration

## Secrets

Secrets are managed through Kubernetes Secrets (recommended via SealedSecrets / ExternalSecrets in GitOps setups):

- This chart **does not create secrets**.
- Provide a pre-created Secret and set `existingSecret.name` (or leave it empty to default to `<release>-drone-tm-secrets`).

Your Secret should include (at minimum):

- `DOMAIN` (e.g. `drone-tm.example.com`)
- `DEBUG` (`False` in production)
- Database: `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Redis: `REDIS_DSN`
- S3: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`
- Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SECRET_KEY`

> Note: `API_URL` is a **frontend build-time** variable baked into the frontend image; Helm does not inject it at runtime.

## Monitoring

Health checks are configured for all services:

- **Liveness Probe**: Ensures containers are running
- **Readiness Probe**: Ensures containers are ready to serve traffic

## Resources

Resource limits and requests are configured per environment:

- **Development**: Minimal resources for local testing
- **Staging**: Moderate resources for testing
- **Production**: High resources with autoscaling

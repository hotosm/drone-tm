# Drone Task Manager Helm Chart

This Helm chart deploys the Drone Task Manager application and its dependencies.

## Values Files

### `values.yaml`

Default values for the chart. Contains all configurable parameters with sensible defaults.

### `values-local.yaml`

Development environment configuration:

- **Purpose**: Local development and testing
- **Usage**: `helm install drone-tm ./charts/drone-tm -f values-local.yaml`
- **Features**:
  - Minimal resource allocation
  - Ingress disabled (uses port-forward)
  - ODM processing enabled for testing
  - Local storage classes

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
helm install drone-tm ./charts/drone-tm -f values-local.yaml

# Upgrade with development values
helm upgrade drone-tm ./charts/drone-tm -f values-local.yaml
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
- **MinIO**: S3-compatible object storage
- **Redis**: Caching and task queue

## Configuration

Key configuration areas:

- **Global**: Domain, storage class, ingress class
- **Backend**: API server configuration
- **Frontend**: Web application configuration
- **Worker**: Background task processing
- **ODM**: Optional OpenDroneMap processing
- **PostgreSQL**: Database configuration
- **MinIO**: Object storage configuration
- **Redis**: Cache and queue configuration

## Secrets

Secrets are managed through Kubernetes secrets and should be created separately:

- `drone-tm-secrets`: Contains database, S3, Redis, and application secrets

## Monitoring

Health checks are configured for all services:

- **Liveness Probe**: Ensures containers are running
- **Readiness Probe**: Ensures containers are ready to serve traffic

## Resources

Resource limits and requests are configured per environment:

- **Development**: Minimal resources for local testing
- **Staging**: Moderate resources for testing
- **Production**: High resources with autoscaling

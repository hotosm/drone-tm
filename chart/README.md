# Drone Task Manager Helm Chart

Deploys the Drone Task Manager application and its dependencies.

## Quick Start

```bash
# Local development
helm install drone-tm ./chart -f values-local.yaml

# Production
helm upgrade --install drone-tm ./chart -f values-prod.yaml --namespace drone
```

## Dependencies

- **DragonflyDB**: Caching and task queue
- **PostgreSQL**: Database with PostGIS extension (optional, for local dev)

## Frontend Deployment

Controlled by `frontend.mode`:

### `bundleWithBackend` (default)

Frontend served by the backend pod via an init container. No extra config needed.

### `cloudfront`

Frontend deployed to S3 + CloudFront CDN. A Helm Job (ArgoCD sync wave 15) handles:

1. Sync built frontend to a versioned S3 path (`<appVersion>/`)
2. Find or create a CloudFront distribution (idempotent)
3. Update the distribution origin path to the new version
4. Invalidate the CloudFront cache

#### DNS Architecture

Frontend and backend are served from separate domains to avoid DNS conflicts
between external-dns (K8s ingress) and CloudFront (Route53 alias):

```
drone.hotosm.org       → CloudFront → S3 (frontend)
api.drone.hotosm.org   → K8s Ingress → backend
```

Set `API_PREFIX: ""` so the backend serves routes at root instead of `/api`,
and configure CORS so the frontend can call the API cross-origin.

#### Frontend Configuration Reference

| Parameter | Description | Default |
|---|---|---|
| `frontend.image.repository` | Frontend Docker image | `ghcr.io/hotosm/drone-tm/frontend` |
| `frontend.image.tag` | Image tag (defaults to `appVersion`) | `""` |
| `frontend.runtimeEnv` | Runtime env vars injected into `config.js` | `{}` |
| `frontend.mode` | `"bundleWithBackend"` or `"cloudfront"` | `"bundleWithBackend"` |
| `frontend.cloudfront.existingSecret` | K8s Secret with `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | `""` |
| `frontend.cloudfront.region` | AWS region | `"us-east-1"` |
| `frontend.cloudfront.s3Bucket` | S3 bucket name (**required**) | `""` |
| `frontend.cloudfront.version` | S3 path prefix (defaults to `appVersion`; set to older version to rollback) | `""` |
| `frontend.cloudfront.aliases` | Custom domain aliases for the distribution | `[]` |
| `frontend.cloudfront.acmCertificateArn` | ACM certificate ARN (required when `aliases` is set) | `""` |
| `frontend.cloudfront.priceClass` | CloudFront price class | `"PriceClass_All"` |

#### Versioned Deployments & Rollback

Each deploy uploads to a versioned S3 prefix. Old versions stay in S3:

```
s3://bucket/2026.1.0/   ← previous
s3://bucket/2026.2.0/   ← current (CloudFront origin path points here)
```

To rollback, set `frontend.cloudfront.version` to the old version and re-sync.

#### AWS IAM Policy

Minimum permissions for the deploy Job:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "S3",
            "Effect": "Allow",
            "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket", "s3:PutBucketPolicy"],
            "Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/*"]
        },
        {
            "Sid": "CloudFront",
            "Effect": "Allow",
            "Action": [
                "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig",
                "cloudfront:UpdateDistribution", "cloudfront:CreateInvalidation",
                "cloudfront:ListDistributions", "cloudfront:CreateDistribution",
                "cloudfront:CreateOriginAccessControl", "cloudfront:ListOriginAccessControls"
            ],
            "Resource": "*"
        }
    ]
}
```

#### Setup Steps

1. **Create S3 bucket**: `aws s3api create-bucket --bucket YOUR_BUCKET --region us-east-1`

2. **Create ACM certificate** (must be in `us-east-1` for CloudFront):
   ```bash
   aws acm request-certificate --domain-name drone.hotosm.org --validation-method DNS --region us-east-1
   ```
   Validate via DNS, then note the ARN for `acmCertificateArn`.

3. **Create IAM user** with the policy above and generate access keys.

4. **Create K8s secret** in the deploy namespace:
   ```bash
   kubectl -n drone create secret generic drone-tm-cloudfront-creds \
     --from-literal=AWS_ACCESS_KEY_ID='<key>' \
     --from-literal=AWS_SECRET_ACCESS_KEY='<secret>'
   ```

5. **Deploy** with CloudFront values. On first run the Job creates the distribution.

6. **DNS cutover**: Point `drone.hotosm.org` to the CloudFront distribution (Route53 ALIAS record).
   The `api.drone.hotosm.org` record is created automatically by external-dns.

#### Example Production Values

```yaml
env:
  API_PREFIX: ""
  DOMAIN: "api.drone.hotosm.org"
  EXTRA_CORS_ORIGINS: '["https://drone.hotosm.org"]'

ingress:
  hosts:
    - host: api.drone.hotosm.org
      paths:
        - path: /
          pathType: Prefix

frontend:
  mode: "cloudfront"
  runtimeEnv:
    VITE_API_URL: "https://api.drone.hotosm.org"
  cloudfront:
    existingSecret: "drone-tm-cloudfront-creds"
    region: "us-east-1"
    s3Bucket: "drone-tm-frontend"
    aliases:
      - "drone.hotosm.org"
    acmCertificateArn: "arn:aws:acm:us-east-1:123456789:certificate/abc-def"
```

### Overriding The Frontend API URL

A dynamic `config.js` is injected at runtime (no rebuild needed):

- **bundleWithBackend**: defaults to `/api` (same-origin), works out of the box.
- **cloudfront**: set `frontend.runtimeEnv.VITE_API_URL` to the backend URL (e.g. `https://api.drone.hotosm.org`).

## Environment Variables

Set via `env` or `extraEnvFrom`. Applied to the backend, migration, and worker containers.

## Argo CD

Sync wave ordering: ServiceAccount (`-10`) → migrations (`5`) → Deployments (`10`) → CloudFront deploy (`15`).

If using SealedSecrets, keep them at default wave `0` so they resolve before migrations run at wave `5`.

## Secrets

This chart **does not create secrets**. Set `existingSecret.name` to reference a pre-created Secret
(defaults to `<release>-drone-tm-secrets`).

Required keys: `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SECRET_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Optional: `SMTP_PASSWORD`, `SENTRY_DSN`.

```bash
kubectl -n drone create secret generic drone-tm-prod-secrets \
  --from-literal=POSTGRES_PASSWORD='...' \
  --from-literal=S3_ACCESS_KEY='...' \
  --from-literal=S3_SECRET_KEY='...' \
  --from-literal=SECRET_KEY='...' \
  --from-literal=GOOGLE_CLIENT_ID='...' \
  --from-literal=GOOGLE_CLIENT_SECRET='...'
```

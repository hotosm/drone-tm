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

## QGIS Worker

The chart can deploy a dedicated QGIS packaging service alongside the app. When
`qgis.enabled=true`, the worker Deployment gets `QGIS_URL` automatically set to
the in-cluster qgis Service unless you explicitly provide `env.QGIS_URL`.

`qgis.replicaCount` defaults to `1`.

You must set `qgis.image.repository` to a published qgis wrapper image before
installing or upgrading if you want to override the default. By default the
chart uses `ghcr.io/hotosm/qfield-project-packager:26.3` and leaves `qgis.enabled=true`.

The image is currently built and published from the `field-tm` git repository.

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
| `frontend.cloudfront.roleArn` | IAM role ARN for IRSA (**required**, see setup steps) | `""` |
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

#### Setup Steps

Every step below uses the AWS CLI -- no console access required. Run these once
before the first deploy.

```bash
# ── Variables (set these for your environment) ──────────────────────────
BUCKET="dronetm-prod-frontend"
DOMAIN="drone.hotosm.org"
CLUSTER="your-eks-cluster"
REGION="us-east-1"
NAMESPACE="drone"
RELEASE="drone-tm"           # Helm release name
ROLE_NAME="drone-tm-cloudfront-deploy"
```

**1. Create S3 bucket**

```bash
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
```

**2. Create & validate ACM certificate**

CloudFront requires the certificate in `us-east-1`.

```bash
CERT_ARN=$(aws acm request-certificate \
  --domain-name "$DOMAIN" \
  --validation-method DNS \
  --region "$REGION" \
  --query CertificateArn --output text)
echo "Certificate ARN: $CERT_ARN"

# Get the CNAME record AWS needs you to create for validation
aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --region "$REGION" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

This returns a `Name` and `Value`. Create that CNAME in Route53:

```bash
# Get the hosted zone ID for your domain
ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "$DOMAIN" \
  --query "HostedZones[0].Id" --output text | sed 's|/hostedzone/||')

# Read the validation record details
VALIDATION=$(aws acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --region "$REGION" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord')
CNAME_NAME=$(echo "$VALIDATION" | python3 -c "import sys,json; print(json.load(sys.stdin)['Name'])")
CNAME_VALUE=$(echo "$VALIDATION" | python3 -c "import sys,json; print(json.load(sys.stdin)['Value'])")

aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch '{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "'"$CNAME_NAME"'",
      "Type": "CNAME",
      "TTL": 300,
      "ResourceRecords": [{"Value": "'"$CNAME_VALUE"'"}]
    }
  }]
}'

# Wait for validation (usually 1-3 minutes)
aws acm wait certificate-validated --certificate-arn "$CERT_ARN" --region "$REGION"
echo "Certificate issued."
```

Keep the CNAME record in place -- ACM uses it to auto-renew the certificate.

**3. Create IAM role (IRSA)**

The deploy Job assumes an IAM role via the EKS service account -- no static
credentials to manage or rotate.

```bash
# Get OIDC provider details
OIDC_URL=$(aws eks describe-cluster --name "$CLUSTER" \
  --query "cluster.identity.oidc.issuer" --output text)
OIDC_ID=$(echo "$OIDC_URL" | awk -F/ '{print $NF}')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
OIDC_PROVIDER="oidc.eks.${REGION}.amazonaws.com/id/${OIDC_ID}"

# Register the OIDC provider with IAM (idempotent)
eksctl utils associate-iam-oidc-provider --cluster "$CLUSTER" --approve
```

Create the trust policy (restricts the role to this chart's service account).

> **Service account name:** The chart uses Helm's standard `fullname` helper.
> If your release name already contains the chart name (`drone-tm`), the SA
> name equals the release name (e.g. release `drone-tm-prod` → SA `drone-tm-prod`).
> Otherwise it is `<release>-drone-tm`. Run
> `kubectl get sa -n $NAMESPACE` to verify before creating the trust policy.

```bash
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "${OIDC_PROVIDER}:sub": "system:serviceaccount:${NAMESPACE}:${RELEASE}",
        "${OIDC_PROVIDER}:aud": "sts.amazonaws.com"
      }
    }
  }]
}
EOF
```

Create the permissions policy (minimum required for the deploy Job):

```bash
cat > policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket", "s3:PutBucketPolicy"],
      "Resource": ["arn:aws:s3:::${BUCKET}", "arn:aws:s3:::${BUCKET}/*"]
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
EOF
```

Create the role and attach the policy:

```bash
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file://trust-policy.json

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name dronetm-prod-cloudfront-deploy \
  --policy-document file://policy.json

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "Role ARN: $ROLE_ARN"
```

Use `$ROLE_ARN` for `frontend.cloudfront.roleArn` in your Helm values.

**4. Deploy** with CloudFront values. On first run the Job creates the distribution.

**5. DNS cutover**

After the first deploy, get the CloudFront distribution domain:

```bash
DIST_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[0].DomainName=='${BUCKET}.s3.amazonaws.com'].DomainName | [0]" \
  --output text)
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[0].DomainName=='${BUCKET}.s3.amazonaws.com'].Id | [0]" \
  --output text)
echo "CloudFront: $DIST_DOMAIN ($DIST_ID)"
```

Point `drone.hotosm.org` to the CloudFront distribution (Route53 ALIAS):

```bash
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch '{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "'"$DOMAIN"'",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "Z2FDTNDATAQYW2",
        "DNSName": "'"$DIST_DOMAIN"'",
        "EvaluateTargetHealth": false
      }
    }
  }]
}'
```

> `Z2FDTNDATAQYW2` is the fixed hosted zone ID for all CloudFront distributions.

The `api.drone.hotosm.org` record is created automatically by external-dns.

To minimize downtime, deploy the backend changes first (so the API is live on both
the old and new domains during transition), then cut DNS for the frontend.

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
    roleArn: "arn:aws:iam::123456789012:role/drone-tm-cloudfront-deploy"
    region: "us-east-1"
    s3Bucket: "dronetm-prod-frontend"
    aliases:
      - "drone.hotosm.org"
    acmCertificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/abc-def"
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

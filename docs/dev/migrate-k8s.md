# Migrating to Kubernetes

## 1. Create a new db in the cluster

- In the `k8s-infra` repo add the database and credentials under `/databases`.
- The new database name, username and password need not match the previous.

## 2. Backup the old db

- Backup the old docker compose based database:

```bash
export DB_NAME=old_db_name
export DB_USER=old_user
export DB_PASS=old_password
export BACKUP_FILE=backup.dump.gz

docker exec -i \
  -e PGPASSWORD="${DB_PASS}" \
  drone-tm-db-1 \
  pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-owner \
    --no-privileges \
    --format=c \
    --encoding=UTF8 \
    --verbose \
| gzip -9 > "${BACKUP_FILE}"
```

## 3. Copy to the new db

Pick the primary CNPG pod:

```bash
kubectl get pods -l cnpg.io/cluster=dronetm-db-prod
```

```bash
export DB_NAME=new_db_name
export DB_USER=new_db_user
export DB_PASS=new_password
export POD_NAME=drone-tm-db-1

gunzip -c "${BACKUP_FILE}" | \
kubectl exec -i "${POD_NAME}" -- \
  env PGPASSWORD="${DB_PASS}" \
  pg_restore \
    -h localhost \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-owner \
    --no-privileges \
    --verbose
```

> [!NOTE]
> You may see a few errors restoring in PostGIS tables like
> `tiger` and `spatial_ref_sys`.
>
> These are managed by PostGIS and are harmless (ignore failure).

Check the restore worked:

```bash
# Interactive shell
kubectl exec -it "$POD_NAME" -- \
    env PGPASSWORD="$DB_PASS" \
    psql \
    -h localhost \
    -U "$DB_USER" \
    -d "$DB_NAME"

# Or run a query like this
kubectl exec -it "$POD_NAME" -- \
    env PGPASSWORD="$DB_PASS" \
    psql -h localhost -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT COUNT(*) FROM projects;" \
    -c "SELECT COUNT(*) FROM tasks;" \
    -c "SELECT COUNT(*) FROM users;"
```

## 4. Create a new S3 bucket

- Clone the hotosm/k8s-infra repo, or just copy out `scripts/create-s3-bucket.sh` from:
  `https://raw.githubusercontent.com/hotosm/k8s-infra/main/scripts/create-s3-bucket.sh`
- Login to AWS SSO `aws sso login --profile admin --use-device-code`.
- Create a bucket: `bash create-s3-bucket.sh dronetm-prod`
- Save the creds printed to terminal.

Ensure there is also a correct CORS policy for the domain:

```bash
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE",
            "HEAD"
        ],
        "AllowedOrigins": [
            "https://drone.hotosm.org"
        ],
        "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
		"MaxAgeSeconds": 3000
    }
]
```

### Enable S3 Transfer Acceleration (recommended for uploads)

After bucket creation, enable Transfer Acceleration on the bucket to improve upload UX
(especially for large imagery uploads). This is not currently scripted.

Then set:

- `S3_ENDPOINT_UPLOAD=https://<your-bucket>.s3-accelerate.amazonaws.com`

### Add CloudFront in front of S3 (recommended for downloads)

`https://raw.githubusercontent.com/hotosm/k8s-infra/main/scripts/add-s3-cloudfront.sh`

Create a CloudFront distribution with the S3 bucket as origin (see your infra repo workflow).
Then set:

- `S3_ENDPOINT_DOWNLOAD=https://<your-cloudfront-domain>/`

For DroneTM production, these public paths are used for static resources:

- `https://d2ymfcf63vwwpt.cloudfront.net/tutorials/`
- `https://d2ymfcf63vwwpt.cloudfront.net/publicuploads/`

The same security credentials generated should work for both
the new cloudfront and accelerate endpoints.

### Enable intelligent tiering storage

`https://raw.githubusercontent.com/hotosm/k8s-infra/main/scripts/add-s3-intelligent-tiering.sh`

This will massively reduce storage cost for infrequently accessed data.

## 5. Transfer the S3 content

- First, ensure you have an rclone.conf file with the required credentials configured.
  (alternatively, they can be created one-time, using `rclone config`)

```bash
docker run --rm -it --entrypoint=sh -v "/home/YOURUSER/rclone.conf:/config/rclone/rclone.conf" rclone/rclone:latest
rclone sync --checksum --verbose dronetm-naxa:dronetm/dtm-data dronetm-prod:dronetm-prod

# Or alternative (to run in background)
docker run -d -v "/home/ubuntu/rclone.conf:/config/rclone/rclone.conf" rclone/rclone:latest sync --checksum --verbose dronetm-naxa:dronetm/dtm-data dronetm-prod:dron
etm-prod
```

## 6. Update env vars, hardcoded vars, etc

Make sure everything points in the right place, particularly the moved S3 & database!

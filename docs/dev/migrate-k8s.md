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

- Clone the hotosm/k8s-infra repo, or just copy out `scripts/create-s3-bucket.sh`.
- Login to AWS SSO `aws sso login --profile admin --use-device-code`.
- Create a bucket: `bash create-s3-bucket.sh dronetm-prod`
- Save the creds printed to terminal.

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

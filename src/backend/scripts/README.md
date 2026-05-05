# Scripts

These scripts are bundled into the backend container, so can be
executed by `exec` into the backend pod and running directly.

For testing, it's possible to pipe them to the pod directly
(avoiding read-only filesystem issues), to run them in production:

```bash
kubectl exec -i drone-tm-prod-backend-5d58d8cdc7-wqg7d -- \
  sh -c "cd /project/src/backend && python - --dry-run \
    --project-id 78988dda-6a7d-43c7-bccb-ca4c28a637f6 \
    --ortho-url 'https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/69ed845c45781de300a01b24/0/69ed845c45781de300a01b25.tif'" \
< mark_project_complete.py
```

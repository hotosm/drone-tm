# Production Debugging

## Toggle DEBUG logging

Default is `INFO`. Send `SIGUSR1` to the app process to flip between `INFO`
and `DEBUG` at runtime. A `WARNING` log confirms each flip. Resets to the
`LOG_LEVEL` env var on pod restart.

**Kubernetes** (PID 1 is the worker, `--workers 1`, no `--reload`):

```bash
# All backend replicas
kubectl get pods -l app.kubernetes.io/component=backend -o name \
  | xargs -I{} kubectl exec {} -- kill -USR1 1
```

**Local dev** (uvicorn `--reload` runs the worker in a `multiprocessing` child):

```bash
docker exec drone-tm-backend-1 pkill -USR1 -f multiprocessing-fork
```

## Persist across restarts

Set `env.LOG_LEVEL: "DEBUG"` in your prod values file and sync (ArgoCD /
`helm upgrade`). The chart renders it on both the backend and worker
Deployments, which triggers a rolling restart.

# Production Debugging

## Turning on DEBUG logging

The backend runs at `INFO` in production. To flip a running pod to `DEBUG`
(and back) without a redeploy, send `SIGUSR1` to PID 1 in the container.
The handler is registered in `app/main.py` and toggles the loguru sink level.

A `warning` log line is emitted on each flip so you can confirm it took effect.

### One pod (docker compose)

```bash
docker exec drone-tm-backend-1 kill -USR1 1
```

### All backend pods (kubernetes)

```bash
kubectl get pods -l app.kubernetes.io/component=backend -o name \
  | xargs -I{} kubectl exec {} -- kill -USR1 1
```

Send the same command again to flip back to `INFO`.

## Notes

- Only affects the loguru sink filter. Stdlib loggers stay at `DEBUG` under
  the hood, so nothing is lost - the sink just stops dropping records.
- Access logs are disabled at the uvicorn level (`--no-access-log` in the
  backend `Dockerfile` CMD), so per-request lines will _not_ appear even at
  `DEBUG`. Use OpenTelemetry / Sentry traces for request-level visibility.
- Pod restarts reset the level to the configured `LOG_LEVEL` env var.

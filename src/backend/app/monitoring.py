from fastapi import FastAPI


def set_sentry_otel_tracer(dsn: str):
    """Add OpenTelemetry tracing only if environment variables configured."""
    from sentry_sdk import init
    from sentry_sdk.integrations.otlp import OTLPIntegration

    init(dsn=dsn, send_default_pii=True, integrations=[OTLPIntegration()])


def instrument_app_otel(app: FastAPI):
    """Add OpenTelemetry FastAPI instrumentation.

    Only used if environment variables configured.
    """
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.requests import RequestsInstrumentor

    FastAPIInstrumentor.instrument_app(app)

    # FIXME psycopg enable once linked issue addressed:
    # https://github.com/open-telemetry/opentelemetry-python-contrib/issues/3793
    # see: https://github.com/hotosm/field-tm/blob/4f29ed3fb462a65dbbcf2fa5c7db0a2b8ac5dc60/src/backend/app/monitoring.py#L185
    # for more details
    RequestsInstrumentor().instrument()

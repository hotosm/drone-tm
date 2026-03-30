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
    from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
    from opentelemetry.instrumentation.requests import RequestsInstrumentor

    FastAPIInstrumentor.instrument_app(app)
    PsycopgInstrumentor().instrument(enable_commenter=True, commenter_options={})
    RequestsInstrumentor().instrument()

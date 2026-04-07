import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from loguru import logger as log
from psycopg import Connection
from psycopg_pool import AsyncConnectionPool

from app.__version__ import __version__
from app.config import settings, MonitoringTypes
from app.db.database import get_db
from app.drones import drone_routes
from app.gcp import gcp_routes
from app.models.enums import HTTPStatus
from app.public_routes import router as public_router
from app.projects import classification_routes, project_routes
from app.tasks import task_routes
from app.users import user_routes
from app.waypoints import waypoint_routes

# Import auth initialization for Hanko SSO
from hotosm_auth import AuthConfig
from hotosm_auth_fastapi import (
    init_auth,
    create_admin_mappings_router_psycopg,
    osm_router,
)

root = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(root, "..", "frontend_html"))
frontend_html = Jinja2Templates(directory=FRONTEND_DIR)


class InterceptHandler(logging.Handler):
    """Intercept python standard lib logging."""

    def emit(self, record):
        """Retrieve context where the logging call occurred.

        This happens to be in the 6th frame upward.
        """
        logger_opt = log.opt(depth=6, exception=record.exc_info)
        logger_opt.log(logging.getLevelName(record.levelno), record.getMessage())


def healthcheck_log_filter(record):
    """Logging on every healthcheck ping is too verbose. Omit."""
    msg = record["message"]
    if "/__heartbeat__" in msg or "/__lbheartbeat__" in msg:
        return False  # Skip this log
    return True


def get_logger():
    """Override FastAPI logger with custom loguru."""

    SILENCED_LOGGERS = {"psycopg.pool", "psycopg_pool"}
    SKIPPED_LOGGERS = {"sqlalchemy", "urllib3"}
    FRAMEWORK_LOGGERS = {"uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"}

    # Silence psycopg pool loggers - otherwise very noisy INFO logs
    for logger_name in SILENCED_LOGGERS:
        silenced = logging.getLogger(logger_name)
        silenced.handlers = []
        silenced.setLevel(logging.WARNING)
        silenced.propagate = False  # Prevent bubbling up to root

    # Hook all other known loggers into loguru via InterceptHandler
    for logger_name in set(logging.root.manager.loggerDict):
        if logger_name in SILENCED_LOGGERS or logger_name in SKIPPED_LOGGERS:
            continue

        stdlib_log = logging.getLogger(logger_name)
        stdlib_log.handlers = []
        stdlib_log.setLevel(logging.DEBUG)

        is_top_level = "." not in logger_name
        is_framework = logger_name in FRAMEWORK_LOGGERS

        if is_top_level or is_framework:
            stdlib_log.addHandler(InterceptHandler())

    # Catch-all: intercept any logger not yet instantiated
    logging.getLogger().handlers = [InterceptHandler()]
    logging.getLogger().setLevel(logging.DEBUG)

    log.remove()
    log.add(
        sys.stderr,
        level=settings.LOG_LEVEL,
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} "
            "| {name}:{function}:{line} | {message}"
        ),
        enqueue=True,  # Run async / non-blocking
        colorize=True,
        backtrace=True,  # More detailed tracebacks
        catch=True,  # Prevent app crashes
        filter=healthcheck_log_filter,
    )


def get_application() -> FastAPI:
    """Get the FastAPI app instance, with settings."""
    api_prefix = settings.API_PREFIX
    _app = FastAPI(
        title=settings.APP_NAME,
        description="HOTOSM Drone Tasking Manager",
        version=__version__,
        license_info={
            "name": "AGPL-3.0-only",
            "url": "https://raw.githubusercontent.com/hotosm/drone-tm/main/LICENSE.md",
        },
        debug=settings.DEBUG,
        docs_url=f"{api_prefix}/docs",
        openapi_url=f"{api_prefix}/openapi.json",
        redoc_url=f"{api_prefix}/redoc",
        lifespan=lifespan,
        # NOTE REST APIs should not have trailing slashes
        redirect_slashes=False,
    )

    # Set custom logger
    _app.logger = get_logger()

    _app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.EXTRA_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    # All API routes live under the configured prefix (default `/api`).
    _app.include_router(drone_routes.router, prefix=api_prefix)
    _app.include_router(project_routes.router, prefix=api_prefix)
    _app.include_router(classification_routes.router, prefix=api_prefix)
    _app.include_router(waypoint_routes.router, prefix=api_prefix)
    _app.include_router(user_routes.router, prefix=api_prefix)
    _app.include_router(task_routes.router, prefix=api_prefix)
    _app.include_router(gcp_routes.router, prefix=api_prefix)
    _app.include_router(public_router, prefix=api_prefix)

    # Serve built frontend static assets when present (mountable within k8s).
    # This ensures `/assets/*` resolves even though ingress points `/` at the backend service.
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isdir(assets_dir):
        _app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Serve backend static assets (e.g. stable email logos) at a predictable URL.
    static_dir = os.path.join(root, "static")
    if os.path.isdir(static_dir):
        _app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # Hanko-specific routers: only mount when Hanko auth is active
    if settings.AUTH_PROVIDER == "hanko":
        admin_router = create_admin_mappings_router_psycopg(
            get_db,
            app_name="drone-tm",
            user_table="users",
            user_id_column="id",
            user_name_column="name",
            user_email_column="email_address",
        )
        _app.include_router(admin_router, prefix="/api")

        # OSM OAuth router for account linking
        _app.include_router(osm_router, prefix="/api")

    return _app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI startup/shutdown event."""
    log.debug("Starting up FastAPI server.")

    # Initialize authentication for Hanko SSO
    if settings.AUTH_PROVIDER == "hanko":
        log.info("Initializing Hanko SSO authentication")
        auth_config = AuthConfig.from_env()
        log.debug(
            f"AuthConfig loaded: hanko_api_url={auth_config.hanko_api_url}, jwt_issuer={auth_config.jwt_issuer}"
        )
        init_auth(auth_config)

    # Initialize Sentry monitoring if enabled
    if (
        settings.MONITORING == MonitoringTypes.SENTRY
        and settings.monitoring_config.SENTRY_DSN
    ):
        try:
            from app.monitoring import set_sentry_otel_tracer, instrument_app_otel

            log.info("Adding Sentry OpenTelemetry monitoring config")
            set_sentry_otel_tracer(settings.monitoring_config.SENTRY_DSN)
            instrument_app_otel(app)
        except ImportError:
            log.warning(
                """
                Sentry monitoring is enabled, but dependencies are not installed.
                Ensure that the MONITORING env variable is populated and try restarting the build process for the backend Docker image.
                """
            )

    async with AsyncConnectionPool(
        conninfo=settings.DTM_DB_URL.unicode_string()
    ) as db_pool:
        # The pool is now used within the context manager
        app.state.db_pool = db_pool
        yield  # FastAPI will run the application here

    # Pool will be closed automatically when the context manager exits
    log.debug("Shutting down FastAPI server.")


api = get_application()


@api.get("/")
async def home(request: Request):
    try:
        """Return Frontend HTML"""
        return frontend_html.TemplateResponse(
            name="index.html", context={"request": request}
        )
    except Exception:
        """Fall back if tempalate missing. Redirect home to docs."""
        return RedirectResponse(f"{settings.API_PREFIX}/docs")


@api.get("/config.js")
async def runtime_config_js():
    """Return runtime-injected frontend config (written by frontend initContainer)."""
    config_path = os.path.join(FRONTEND_DIR, "config.js")
    if os.path.isfile(config_path):
        return FileResponse(config_path, media_type="application/javascript")
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@api.get("/favicon.ico")
async def favicon():
    """Serve favicon if present in the built frontend."""
    favicon_path = os.path.join(FRONTEND_DIR, "favicon.ico")
    if os.path.isfile(favicon_path):
        return FileResponse(favicon_path)
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@api.get("/__lbheartbeat__")
async def simple_heartbeat():
    """Simple ping/pong API response."""
    return Response(status_code=HTTPStatus.OK)


@api.get("/__heartbeat__")
async def heartbeat_plus_db(db: Annotated[Connection, Depends(get_db)]):
    """Heartbeat that checks that API and DB are both up and running."""
    try:
        async with db.cursor() as cur:
            await cur.execute("SELECT 1")
        return Response(status_code=HTTPStatus.OK)
    except Exception as e:
        log.warning(e)
        log.warning("Server failed __heartbeat__ database connection check")
        return JSONResponse(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR, content={"error": str(e)}
        )


known_browsers = ["Mozilla", "Chrome", "Safari", "Opera", "Edge", "Firefox"]


@api.exception_handler(404)
async def custom_404_handler(request: Request, _):
    """Return Frontend HTML or throw 404 Response on 404 requests."""
    try:
        query_params = dict(request.query_params)
        user_agent = request.headers.get("User-Agent", "")
        format = query_params.get("format")
        is_browser = any(browser in user_agent for browser in known_browsers)
        if format == "json" or not is_browser:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        return frontend_html.TemplateResponse(
            name="index.html", context={"request": request}
        )

    except Exception:
        """Fall back if tempalate missing. Redirect home to docs."""
        return JSONResponse(status_code=404, content={"detail": "Not found"})

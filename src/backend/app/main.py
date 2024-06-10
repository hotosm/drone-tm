import logging
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.projects import project_routes
from app.waypoints import waypoint_routes

from app.users import user_routes
from loguru import logger as log


class InterceptHandler(logging.Handler):
    """Intercept python standard lib logging."""

    def emit(self, record):
        """Retrieve context where the logging call occurred.

        This happens to be in the 6th frame upward.
        """
        logger_opt = log.opt(depth=6, exception=record.exc_info)
        logger_opt.log(record.levelno, record.getMessage())


def get_logger():
    """Override FastAPI logger with custom loguru."""
    # Hook all other loggers into ours
    logger_name_list = [name for name in logging.root.manager.loggerDict]
    for logger_name in logger_name_list:
        logging.getLogger(logger_name).setLevel(10)
        logging.getLogger(logger_name).handlers = []
        if logger_name == "sqlalchemy":
            # Don't hook sqlalchemy, very verbose
            continue
        if logger_name == "urllib3":
            # Don't hook urllib3, called on each OTEL trace
            continue
        if "." not in logger_name:
            logging.getLogger(logger_name).addHandler(InterceptHandler())

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
    )


def get_application() -> FastAPI:
    """Get the FastAPI app instance, with settings."""
    _app = FastAPI(
        title=settings.APP_NAME,
        description="HOTOSM Drone Tasking Manager",
        license_info={
            "name": "GPL-3.0-only",
            "url": "https://raw.githubusercontent.com/hotosm/fmtm/main/LICENSE.md",
        },
        debug=settings.DEBUG,
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

    _app.include_router(project_routes.router)
    _app.include_router(waypoint_routes.router)
    _app.include_router(user_routes.router)

    return _app


api = get_application()


@api.get("/")
def read_root():
    return {"Hello": "World"}

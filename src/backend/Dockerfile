# ARG for the base image
ARG PYTHON_IMG_TAG=3.11

# Base build stage with dependencies required to build Python wheels
FROM python:$PYTHON_IMG_TAG-slim-trixie AS build

# Install build dependencies
RUN set -ex \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install \
    -y --no-install-recommends \
    "build-essential" \
    "gcc" \
    "g++" \
    "libpcre2-dev" \
    "libpq-dev" \
    "libspatialindex-dev" \
    "libproj-dev" \
    "libgeos-dev" \
    "libgdal-dev" \
    "git" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /project

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5.2 /uv /bin/uv

ARG PYTHON_IMG_TAG=3.11
# - Ensure executables are at the front of the path
# - Silence uv complaining about not being able to use hard links,
# - tell uv to byte-compile packages for faster application startups,
# - prevent uv from accidentally downloading isolated Python builds,
# - use a temp dir instead of cache during install,
# - select system python version,
# - declare `/opt/python` as the target for `uv sync` (i.e. instead of .venv).
ENV PATH="/bin:$PATH" \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1 \
    UV_PYTHON="python$PYTHON_IMG_TAG" \
    UV_PROJECT_ENVIRONMENT=/opt/python
STOPSIGNAL SIGINT

# Copy files needed for building the project
COPY ./pyproject.toml ./alembic.ini ./uv.lock /project/
COPY packages /project/packages

ARG MONITORING

ARG INSTALL_TEST=false

# Install dependencies using uv (caching to improve speed for repeated builds)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    sh -c ' \
        if [ "${MONITORING}" = "sentry" ] && [ "${INSTALL_TEST}" = "true" ]; then \
            uv sync --locked --no-editable --no-dev --group monitoring --group test; \
        elif [ "${MONITORING}" = "sentry" ]; then \
            uv sync --locked --no-editable --no-dev --group monitoring; \
        elif [ "${INSTALL_TEST}" = "true" ]; then \
            uv sync --locked --no-editable --no-dev --group test; \
        else \
            uv sync --locked --no-editable --no-dev; \
        fi \
    '

# Run stage (final stage)
FROM python:$PYTHON_IMG_TAG-slim-trixie AS service

ARG PYTHON_IMG_TAG
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PATH="/opt/python/bin:$PATH" \
    PYTHON_LIB="/opt/python/lib/python$PYTHON_IMG_TAG/site-packages" \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

RUN set -ex \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install \
    -y --no-install-recommends \
    "nano" \
    "curl" \
    "gettext-base" \
    "libpcre2-16-0" \
    "libpq5" \
    "media-types" \
    "postgresql-client" \
    "libglib2.0-0t64" \
    "libspatialindex-c8" \
    "libproj25" \
    "libgeos-c1t64" \
    "libgdal36" \
    && rm -rf /var/lib/apt/lists/*

# Retrieve global Python packages and dependencies from the build stage
COPY --from=build /opt/python /opt/python

# Set working directory
WORKDIR /project/src/backend

# Install uv in runtime stage
COPY --from=ghcr.io/astral-sh/uv:0.5.2 /uv /bin/uv

# Copy the source files to the final image
COPY . /project/src/backend

VOLUME /project/src/backend/frontend_html

# Set the entrypoint for the container
ENTRYPOINT [ "/project/src/backend/docker-entrypoint.sh" ]

CMD ["uvicorn", "app.main:api", "--host", "0.0.0.0", "--port", "8000", \
    "--log-level", "info", "--reload"]

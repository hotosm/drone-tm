# ARG for the base image
ARG PYTHON_BASE=3.11-slim-bookworm

# Base build stage with dependencies required to build Python wheels
FROM python:$PYTHON_BASE AS build

# Install build dependencies
RUN set -ex \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install \
    -y --no-install-recommends \
        "build-essential" \
        "gcc" \
        "g++" \
        "libpcre3-dev" \
        "libpq-dev" \
        "libspatialindex-dev" \
        "libproj-dev" \
        "libgeos-dev" \
        "git" \
        "gdal-bin" \
        "libgdal-dev" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /project

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5.2 /uv /bin/uv

# Ensure executables are at the front of the path
ENV PATH="/bin:$PATH"

# - Silence uv complaining about not being able to use hard links,
# - tell uv to byte-compile packages for faster application startups,
# - prevent uv from accidentally downloading isolated Python builds,
# - use a temp dir instead of cache during install,
# - select system python version,
# - declare `/opt/python` as the target for `uv sync` (i.e. instead of .venv).
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_NO_CACHE=1 \
    UV_PYTHON="python$PYTHON_BASE" \
    UV_PROJECT_ENVIRONMENT=/opt/python
STOPSIGNAL SIGINT

# Copy files needed for building the project
COPY ./pyproject.toml ./alembic.ini ./uv.lock /project/

# Install dependencies using uv (caching to improve speed for repeated builds)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --frozen --no-install-project

# Sync the project again using uv, ensuring all project dependencies are installed
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync

# Install the test dependencies using uv
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --group test

# Run stage (final stage)
FROM python:$PYTHON_BASE AS service

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODES=1

RUN set -ex \
&& apt-get update \
&& DEBIAN_FRONTEND=noninteractive apt-get install \
-y --no-install-recommends \
    "nano" \
    "curl" \
    "gettext-base" \
    "libpcre3" \
    "libpq5" \
    "mime-support" \
    "postgresql-client" \
    "libglib2.0-0" \
    "libspatialindex-c6" \
    "libproj25" \
    "libgeos-c1v5" \
    "gdal-bin" \
    "libgdal-dev" \
&& rm -rf /var/lib/apt/lists/*

# Retrieve global Python packages and dependencies from the build stage
COPY --from=build /opt/python /opt/python

# Set working directory
WORKDIR /project/src/backend

# Set environment PATH
ENV PATH="/opt/python/bin:$PATH"

# Install uv in runtime stage
COPY --from=ghcr.io/astral-sh/uv:0.5.2 /uv /bin/uv

# Copy the source files to the final image
COPY . /project/src/backend

VOLUME /project/src/backend/frontend_html

# Set the entrypoint for the container
ENTRYPOINT [ "/project/src/backend/docker-entrypoint.sh" ]

CMD ["uvicorn", "app.main:api", "--host", "0.0.0.0", "--port", "8000", \
    "--log-level", "info", "--reload"]

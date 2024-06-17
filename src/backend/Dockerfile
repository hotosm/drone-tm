# ARG for the base image
ARG PYTHON_BASE=3.10-slim-bookworm

# Base build stage with dependencies required to build Python wheels
FROM python:$PYTHON_BASE AS build

# Install build dependencies
RUN set -ex \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install \
    -y --no-install-recommends \
        "build-essential" \
        "gcc" \
        "libpcre3-dev" \
        "libpq-dev" \
        "libspatialindex-dev" \
        "libproj-dev" \
        "libgeos-dev" \
        "git" \
    && rm -rf /var/lib/apt/lists/*

# Install PDM
RUN pip install -U pdm
# Disable update check
ENV PDM_CHECK_UPDATE=false

# Copy files needed for building the project
COPY ./src/backend/pyproject.toml ./src/backend/pdm.lock README.md /project/
COPY src/backend /project/src

# Install dependencies and project into the local packages directory
WORKDIR /project
RUN pdm install --check --prod --no-editable

# Run stage (final stage)
FROM python:$PYTHON_BASE

ENV PYTHONUNBUFFERED 1
ENV PYTHONDONTWRITEBYTECODES 1

RUN set -ex \
&& apt-get update \
&& DEBIAN_FRONTEND=noninteractive apt-get install \
-y --no-install-recommends \
    "nano" \
    "gettext-base" \
    "libpcre3" \
    "libpq5" \
    "mime-support" \
    "postgresql-client" \
    "libglib2.0-0" \
    "libspatialindex-c6" \
    "libproj25" \
    "libgeos-c1v5" \
&& rm -rf /var/lib/apt/lists/*

# Retrieve packages from build stage
COPY --from=build /project/.venv/ /project/.venv

# Set working directory
WORKDIR /project/src/backend/

# Set environment PATH
ENV PATH="/project/.venv/bin:$PATH"

# Install PDM in runtime stage
RUN pip install -U pdm

# Copy the source files to the final image
COPY src /project/src

# Set the entrypoint for the container
ENTRYPOINT ["uvicorn", "app.main:api", "--host", "0.0.0.0", "--port", "8000", \
    "--workers", "4", "--log-level", "info", "--reload"]

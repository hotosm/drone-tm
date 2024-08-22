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

# Install PDM
RUN pip install -U pdm
# Disable update check
ENV PDM_CHECK_UPDATE=false

WORKDIR /project

# Copy files needed for building the project
COPY ./pyproject.toml /project/
COPY ./pdm.lock /project/

# Install dependencies and project into the local packages directory
RUN pdm install --check --prod --no-editable

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

# Retrieve packages from build stage
COPY --from=build /project/.venv/ /project/.venv

# Set working directory
WORKDIR /project/src/backend

# Set environment PATH
ENV PATH="/project/.venv/bin:$PATH"

# Install PDM in runtime stage
RUN pip install -U pdm

# Copy the source files to the final image
COPY . /project/src/backend

VOLUME /project/src/backend/frontend_html

# Set the entrypoint for the container
ENTRYPOINT [ "/project/src/backend/docker-entrypoint.sh" ]

CMD ["uvicorn", "app.main:api", "--host", "0.0.0.0", "--port", "8000", \
    "--log-level", "info", "--reload"]

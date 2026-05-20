# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# ─────────────────────────────────────────────────────────────────────
# Atlas Schema Extractor — Release Image
# ─────────────────────────────────────────────────────────────────────
# Self-service schema extraction for Atlas Data Fabric.
#
# Wraps SchemaCrawler 17.11.0 with:
#   - A FastAPI REST API (POST /crawl, GET /health)
#   - A GraalVM JavaScript catalog walker (emit-atlas.js v1.3) that
#     produces Atlas-canonical full-fidelity JSON in a single pass
#   - JDBC drivers for PostgreSQL, MariaDB/MySQL, and MS SQL Server
#     (all permissively licensed, redistributable)
#
# This image is licensed under Apache-2.0. Bundled third-party
# components retain their original licenses — see /licenses/ inside
# the running container or THIRD_PARTY_LICENSES.md alongside the
# source.
#
# Build:
#   docker compose build                          # via compose
#   docker buildx build -t ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0 .
#   docker buildx build --platform linux/amd64,linux/arm64 -t ... .   # multi-arch
#
# Run:
#   docker compose up        # or:
#   docker run --rm -p 127.0.0.1:8081:8081 \
#     ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
# ─────────────────────────────────────────────────────────────────────

FROM python:3.12-slim-bookworm

# ── OCI image metadata ────────────────────────────────────────────────
LABEL org.opencontainers.image.title="Atlas Schema Extractor"
LABEL org.opencontainers.image.description="Self-service schema extraction for Atlas Data Fabric. Wraps SchemaCrawler with a REST API and a full-fidelity JSON catalog walker."
LABEL org.opencontainers.image.authors="Itera ASA <atlas@itera.com>"
LABEL org.opencontainers.image.url="https://github.com/carheart/schemacrawler-atlas-data-fabric"
LABEL org.opencontainers.image.documentation="https://github.com/carheart/schemacrawler-atlas-data-fabric"
LABEL org.opencontainers.image.source="https://github.com/carheart/schemacrawler-atlas-data-fabric"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.vendor="Itera ASA"
LABEL org.opencontainers.image.version="1.3.0"

# ── System dependencies ───────────────────────────────────────────────
# default-jre-headless: runs SchemaCrawler (OpenJDK, GPLv2 + Classpath Exception)
# curl: fetches the SC distribution + JDBC drivers; used by HEALTHCHECK
# unzip: extracts the SC distribution
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-jre-headless \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# ── SchemaCrawler distribution ────────────────────────────────────────
ARG SC_VERSION=17.11.0
ENV SC_HOME=/opt/schemacrawler

RUN curl -fL \
        "https://github.com/schemacrawler/SchemaCrawler/releases/download/v${SC_VERSION}/schemacrawler-${SC_VERSION}-bin.zip" \
        -o /tmp/sc.zip \
    && unzip -q /tmp/sc.zip -d /opt \
    && mv "/opt/schemacrawler-${SC_VERSION}-bin" "$SC_HOME" \
    && rm /tmp/sc.zip \
    && chmod +x "$SC_HOME/bin/schemacrawler.sh"

# ── JDBC drivers (all permissively licensed, redistributable) ────────
# PostgreSQL 42.7.3       — BSD 2-Clause
# MariaDB Connector/J 2.7.12 — LGPL 2.1
#   Handles both `jdbc:mysql://` and `jdbc:mariadb://` URLs. Wire-
#   compatible with MySQL 5.5+ / MySQL 8.x (including caching_sha2_password)
#   and MariaDB 10.x. Replaces Oracle's MySQL Connector/J 8.x (GPLv2 with
#   FOSS exception) — the LGPL line is unambiguously redistributable.
# MS SQL Server JDBC 12.6.1 — MIT
#
# DB2 (IBM proprietary) and Oracle (Oracle proprietary) drivers are
# NOT bundled. Mount them at runtime if needed:
#   -v ./db2jcc4.jar:/opt/schemacrawler/lib/db2jcc4.jar:ro
#   -v ./ojdbc.jar:/opt/schemacrawler/lib/ojdbc.jar:ro
ARG JDBC_DIR=/opt/schemacrawler/lib

RUN curl -fL "https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar" \
        -o "$JDBC_DIR/postgresql.jar" \
    && curl -fL "https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/2.7.12/mariadb-java-client-2.7.12.jar" \
        -o "$JDBC_DIR/mariadb-java-client.jar" \
    && curl -fL "https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc/12.6.1.jre11/mssql-jdbc-12.6.1.jre11.jar" \
        -o "$JDBC_DIR/mssql-jdbc.jar"

# ── Optional: Databricks JDBC driver (Apache 2.0; opt-in, ~40 MB) ─────
# Build with: docker buildx build --build-arg BUILD_DATABRICKS=true ...
# Driver class for use with db_type=jdbc requests:
#   com.databricks.client.jdbc.Driver
ARG BUILD_DATABRICKS=false
ARG DATABRICKS_JDBC_VERSION=3.3.2
RUN if [ "$BUILD_DATABRICKS" = "true" ]; then \
        echo "Installing Databricks JDBC driver v${DATABRICKS_JDBC_VERSION}..." && \
        curl -fL "https://repo1.maven.org/maven2/com/databricks/databricks-jdbc/${DATABRICKS_JDBC_VERSION}/databricks-jdbc-${DATABRICKS_JDBC_VERSION}.jar" \
            -o "$JDBC_DIR/databricks-jdbc.jar"; \
    else \
        echo "Skipping Databricks JDBC driver (set BUILD_DATABRICKS=true to enable)"; \
    fi

# ── License files baked into the image at /licenses/ ─────────────────
# Customers running this image can inspect:
#   docker run --rm --entrypoint cat <image> /licenses/LICENSE
#   docker run --rm --entrypoint cat <image> /licenses/NOTICE
#   docker run --rm --entrypoint cat <image> /licenses/THIRD_PARTY_LICENSES.md
RUN mkdir -p /licenses
COPY LICENSE /licenses/LICENSE
COPY NOTICE /licenses/NOTICE
COPY THIRD_PARTY_LICENSES.md /licenses/THIRD_PARTY_LICENSES.md

# ── Application code ──────────────────────────────────────────────────
RUN mkdir -p /opt/schemacrawler/scripts
COPY emit-atlas.js /opt/schemacrawler/scripts/emit-atlas.js

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY server.py /app/server.py

# ── Non-root user for runtime ─────────────────────────────────────────
# Schema introspection doesn't need root. The atlas user owns /app and
# /opt/schemacrawler so SC can write to its logs/cache directories.
RUN useradd --create-home --shell /bin/bash --uid 1000 atlas \
    && chown -R atlas:atlas /app /opt/schemacrawler
USER atlas

ENV SC_HOME=/opt/schemacrawler
ENV PYTHONUNBUFFERED=1

EXPOSE 8081

# ── Healthcheck (matches /health endpoint behaviour) ──────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8081/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8081", "--log-level", "info"]

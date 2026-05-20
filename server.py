"""
SchemaCrawler REST Sidecar
Thin FastAPI wrapper around the SchemaCrawler CLI.

POST /crawl  — runs a schema crawl and returns the JSON catalog
GET  /health — liveness check
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from enum import Enum
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

SC_HOME = os.environ.get("SC_HOME", "/opt/schemacrawler")
SC_SCRIPT = Path(SC_HOME) / "bin" / "schemacrawler.sh"
# emit-atlas.js is the GraalVM JS walker that produces the
# atlas-schema-fidelity-v1.x JSON. The /health endpoint reports
# `degraded` if it is missing (FR-25).
EMIT_ATLAS_SCRIPT = Path(SC_HOME) / "scripts" / "emit-atlas.js"
LOG_LEVEL = os.environ.get("SC_LOG_LEVEL", "INFO")

logging.basicConfig(level=LOG_LEVEL)
log = logging.getLogger("sc-sidecar")

app = FastAPI(
    title="SchemaCrawler REST Sidecar",
    description="Wraps SchemaCrawler CLI to crawl heterogeneous databases and return JSON catalogs.",
    version="1.0.0",
)


class DbType(str, Enum):
    postgresql = "postgresql"
    mysql = "mysql"
    sqlserver = "sqlserver"
    db2 = "db2"
    sqlite = "sqlite"
    # generic JDBC — caller must supply driver class + url
    jdbc = "jdbc"


# SchemaCrawler server names map to SC --server parameter
_SC_SERVER = {
    DbType.postgresql: "postgresql",
    DbType.mysql: "mysql",
    DbType.sqlserver: "sqlserver",
    DbType.db2: "db2",
    DbType.sqlite: "sqlite",
}

# Default ports per DB type
_DEFAULT_PORT = {
    DbType.postgresql: 5432,
    DbType.mysql: 3306,
    DbType.sqlserver: 1433,
    DbType.db2: 50000,
    DbType.sqlite: None,
    DbType.jdbc: None,
}


class CrawlRequest(BaseModel):
    db_type: DbType = Field(..., description="Database engine type")
    host: str | None = Field(None, description="Hostname (not needed for sqlite/jdbc)")
    port: int | None = Field(None, description="Port (defaults to engine default)")
    database: str = Field(..., description="Database name or file path for SQLite")
    user: str | None = Field(None, description="Username")
    password: str | None = Field(None, description="Password")
    # For db_type=jdbc: provide full JDBC URL + driver class
    jdbc_url: str | None = Field(None, description="Full JDBC URL (db_type=jdbc)")
    jdbc_driver: str | None = Field(None, description="JDBC driver class (db_type=jdbc)")
    # Schema / table filters (optional)
    schemas: str | None = Field(None, description="Schema include regex, e.g. 'public'")
    tables: str | None = Field(None, description="Table include regex, e.g. '.*'")
    # Info level: minimum | standard | detailed | maximum
    info_level: str = Field("maximum", description="SchemaCrawler info-level")
    # Output format. Atlas v1.x rollout collapsed this to "atlas" only
    # (FR-23). Legacy values (json / compact_json / yaml / ser) now
    # return 422 — the Atlas backend has no parser for them.
    output_format: str = Field("atlas", description="Output format: only 'atlas' is supported")


class CrawlResponse(BaseModel):
    db_type: str
    database: str
    catalog: dict[str, Any]
    tables_count: int
    columns_count: int


@app.get("/health")
def health() -> dict[str, str]:
    sc_ok = SC_SCRIPT.exists()
    emit_ok = EMIT_ATLAS_SCRIPT.is_file()
    return {
        "status": "ok" if (sc_ok and emit_ok) else "degraded",
        "schemacrawler": str(SC_SCRIPT),
        "sc_available": str(sc_ok),
        "emit_atlas_script": str(EMIT_ATLAS_SCRIPT),
        "emit_atlas_available": str(emit_ok),
    }


@app.post("/crawl", response_model=CrawlResponse)
def crawl(req: CrawlRequest) -> CrawlResponse:
    """
    Run a SchemaCrawler schema crawl and return the v1.x JSON catalog.

    Always invokes ``--command=script --script=emit-atlas.js`` —
    legacy formats (``json`` / ``compact_json`` / ``yaml`` / ``ser``)
    are rejected with HTTP 422 (FR-23). The Atlas backend has no
    parser for those shapes after the v1.x rollout.
    """
    log.info("Crawl request: db_type=%s database=%s", req.db_type, req.database)

    # FR-23: empty / "atlas" -> default. Anything else -> 422.
    fmt = (req.output_format or "atlas").strip()
    if fmt != "atlas":
        raise HTTPException(
            status_code=422,
            detail=f"output_format={fmt!r} no longer supported; only 'atlas' is emitted",
        )
    req.output_format = "atlas"

    with tempfile.TemporaryDirectory() as tmp:
        output_file = Path(tmp) / "catalog.json"
        cmd = _build_command(req, output_file)
        log.debug("SC command: %s", " ".join(cmd))

        try:
            # ATLAS_DATABASE_NAME is read by emit-atlas.js to override SC's
            # placeholder catalog name on engines (PostgreSQL) where
            # Catalog.getName() returns the literal string "catalog" instead
            # of the real database name. This is the same value the user
            # supplied in the request body (req.database) — not synthesised,
            # just routed past an SC API gap.
            #
            # Timeout: bumped from 120s to 600s on 2026-05-05. SC's per-table
            # introspection over JDBC can take 0.4-0.8s/table on MySQL/MariaDB
            # for medium-sized schemas; a Prestashop 280-table install lives
            # comfortably under 200s but the original 120s cap was too tight
            # for any realistic e-commerce or ERP schema. Override per-request
            # is not exposed; if a corpus needs >600s, the bottleneck is
            # almost certainly an installer still running concurrently.
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
                env={
                    **os.environ,
                    "JAVA_OPTS": "-Xmx512m",
                    "ATLAS_DATABASE_NAME": req.database or "",
                },
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="SchemaCrawler timed out") from exc

        if result.returncode != 0:
            # Surface full stderr (and stdout, since SC sometimes writes errors there
            # too) so callers can debug command/format-mismatch errors. The stack
            # used to truncate to 500 chars which hid the actual cause.
            full_err = (result.stderr or "") + "\n--- stdout ---\n" + (result.stdout or "")
            log.error("SC failed (exit %d): %s", result.returncode, full_err)
            raise HTTPException(
                status_code=500,
                detail=f"SchemaCrawler failed (exit {result.returncode}):\n{full_err}",
            )

        if not output_file.exists():
            raise HTTPException(status_code=500, detail="SchemaCrawler produced no output")

        catalog = json.loads(output_file.read_text())

    tables = _count_tables(catalog)
    columns = _count_columns(catalog)
    log.info("Crawl complete: %d tables, %d columns", tables, columns)

    return CrawlResponse(
        db_type=req.db_type,
        database=req.database,
        catalog=catalog,
        tables_count=tables,
        columns_count=columns,
    )


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _build_command(req: CrawlRequest, output_file: Path) -> list[str]:
    cmd = [str(SC_SCRIPT)]

    if req.db_type == DbType.jdbc:
        # Generic JDBC mode
        if not req.jdbc_url or not req.jdbc_driver:
            raise HTTPException(
                status_code=422,
                detail="jdbc_url and jdbc_driver are required for db_type=jdbc",
            )
        cmd += ["--url", req.jdbc_url, "--driver", req.jdbc_driver]
    elif req.db_type == DbType.sqlite:
        cmd += ["--server", "sqlite", "--database", req.database]
    else:
        server = _SC_SERVER[req.db_type]
        port = req.port or _DEFAULT_PORT[req.db_type]
        cmd += [
            "--server", server,
            "--host", req.host or "localhost",
            "--port", str(port),
            "--database", req.database,
        ]

    if req.user:
        cmd += ["--user", req.user]
    if req.password:
        cmd += ["--password", req.password]
    if req.schemas:
        cmd += ["--schemas", req.schemas]
    if req.tables:
        cmd += ["--tables", req.tables]

    # output_format dispatch (FR-23): only "atlas" is supported.
    # Empty / "atlas" routes to --command=script. Anything else
    # raised 422 above. The legacy --command=serialize branch was
    # removed because the Atlas backend no longer has a parser for it.
    cmd += [
        "--info-level", req.info_level,
        "--command", "script",
        "--script-language", "js",
        "--script", str(EMIT_ATLAS_SCRIPT),
        "--output-file", str(output_file),
        "--no-info",
    ]

    return cmd


def _count_tables(catalog: dict) -> int:
    count = 0
    for schema in catalog.get("schemas", []):
        count += len(schema.get("tables", []))
    return count


def _count_columns(catalog: dict) -> int:
    count = 0
    for schema in catalog.get("schemas", []):
        for table in schema.get("tables", []):
            count += len(table.get("columns", []))
    return count

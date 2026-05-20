# Atlas Schema Extractor

**Self-service schema extraction for Atlas Data Fabric.**

A standalone Docker container that connects to your database, walks its full
schema — tables, columns, foreign keys, indexes, triggers, constraints,
sequences — and emits a single Atlas-canonical JSON file you can drop into
the Atlas Data Fabric desktop app for instant migration analysis.

The container runs **entirely on your network**. It makes outbound JDBC
connections only to the database host you specify in each request. There is
no telemetry, no usage reporting, no auto-update, and no outbound call to
Itera or any other third party.

---

## Quickstart

### Linux / macOS / WSL (bash)

```bash
# 1. Pull the image
docker pull ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0

# 2. Run it (binds to localhost only by default)
docker run --rm -d --name atlas-extractor \
  -p 127.0.0.1:8081:8081 \
  ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0

# If port 8081 is already taken on your host, pick another port:
#   docker run --rm -d --name atlas-extractor \
#     -p 127.0.0.1:8091:8081 \
#     ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
# Then use http://127.0.0.1:8091 in step 4 below.

# 3. Wait a couple of seconds for it to start
until curl -sf http://127.0.0.1:8081/health > /dev/null; do sleep 1; done

# 4. Crawl your database
curl -X POST http://127.0.0.1:8081/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "db_type":  "postgresql",
    "host":     "your-db.example.com",
    "port":     5432,
    "database": "your_database",
    "user":     "readonly_user",
    "password": "your-password",
    "schemas":  "public"
  }' \
  | jq '.catalog' > catalog.json

# 5. Sanity-check
jq '.counts' catalog.json
# {
#   "schemas": 1,
#   "tables": 142,
#   "columns": 1287,
#   "foreign_key_relationships": 230,
#   "indexes": 188,
#   ...
# }

# 6. Stop the extractor
docker stop atlas-extractor
```

### Windows (PowerShell)

```powershell
# 1. Pull the image
docker pull ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0

# 2. Run it (binds to localhost only by default)
docker run --rm -d --name atlas-extractor `
  -p 127.0.0.1:8081:8081 `
  ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0

# If port 8081 is already taken on your host, pick another port:
#   docker run --rm -d --name atlas-extractor `
#     -p 127.0.0.1:8091:8081 `
#     ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
# Then use http://127.0.0.1:8091 below.

# 3. Wait a couple of seconds for it to start
do { Start-Sleep -Seconds 1 } until (
  try { Invoke-RestMethod http://127.0.0.1:8081/health -ErrorAction Stop; $true }
  catch { $false }
)

# 4. Crawl your database
$body = @{
  db_type  = "postgresql"
  host     = "your-db.example.com"
  port     = 5432
  database = "your_database"
  user     = "readonly_user"
  password = "your-password"
  schemas  = "public"
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8081/crawl `
  -ContentType "application/json" `
  -Body $body

# 5. Sanity-check
$response | Select-Object db_type, database, tables_count, columns_count
# db_type      : postgresql
# database     : your_database
# tables_count : 142
# columns_count: 1287

# Save the catalog to disk (just the .catalog field — Atlas-importable)
$response.catalog | ConvertTo-Json -Depth 100 | Set-Content catalog.json

# 6. Stop the extractor
docker stop atlas-extractor
```

Drop `catalog.json` into the Atlas desktop app via **Settings → Source
Systems → Import Schema**. See [Importing into Atlas](#importing-into-atlas)
below for details.

---

## Supported databases

| Engine | `db_type` | Driver | Notes |
|---|---|---|---|
| PostgreSQL | `postgresql` | PostgreSQL JDBC 42.7.3 (BSD-2-Clause) | Set `schemas` to your target schema (e.g., `public`) to avoid system schemas |
| MySQL 5.5+ / 8.x | `mysql` | MariaDB Connector/J 2.7.12 (LGPL-2.1) | Same connector handles both MySQL and MariaDB; set `schemas` to your database name |
| MariaDB 10.x | `mysql` | MariaDB Connector/J 2.7.12 (LGPL-2.1) | Use `db_type=mysql` (wire-compatible) |
| Microsoft SQL Server | `sqlserver` | MS SQL Server JDBC 12.6.1 (MIT) | Default schema is `dbo` |
| SQLite | `sqlite` | (built-in) | `database` is the file path inside the container — mount the .db file as a volume |
| IBM DB2 | `db2` | **Not bundled** (IBM proprietary) | Mount `db2jcc4.jar` at `/opt/schemacrawler/lib/db2jcc4.jar` |
| Oracle | `jdbc` | **Not bundled** (Oracle proprietary) | Mount `ojdbc.jar` and pass `jdbc_url` + `jdbc_driver` |
| Databricks Unity Catalog | `jdbc` | Databricks JDBC 3.3.2 (Apache-2.0) | **Opt-in** — build the image with `BUILD_DATABRICKS=true` to bundle it |
| Generic JDBC | `jdbc` | (bring your own) | Pass `jdbc_url` and `jdbc_driver` explicitly; mount the driver JAR if needed |

See `examples/` for working scripts per engine — both `.sh` (bash) and
`.ps1` (PowerShell) variants are provided.

### Using databases whose JDBC driver isn't redistributable (DB2 / Oracle)

SchemaCrawler itself supports both DB2 and Oracle natively — the plugins are
built into the SC distribution baked into this image. What's missing is the
JDBC driver: IBM's `db2jcc4.jar` and Oracle's `ojdbc*.jar` carry vendor
licences that don't permit redistribution in a third-party container. You
have to supply the JAR yourself and mount it at runtime.

**IBM DB2** — three places you can get `db2jcc4.jar`:

1. **From a running DB2 container**, if you already have one (this is the
   simplest path for evaluation):
   ```bash
   docker exec <your-db2-container> find /opt/ibm/db2 -name "db2jcc*.jar"
   docker cp <your-db2-container>:/opt/ibm/db2/V11.5/java/db2jcc4.jar ./db2jcc4.jar
   ```
   The path varies by DB2 version (`V11.5`, `V12.1`, etc.) — let `find` tell
   you. The official `icr.io/db2_community/db2` image ships it.

2. **From an existing DB2 client install** on your laptop or a server, under
   the `java/` subdirectory of the install root.

3. **From IBM Fix Central** at
   <https://www.ibm.com/support/pages/db2-jdbc-driver-versions-and-downloads>
   (free, but requires an IBM ID).

Then start (or restart) the extractor with the driver mounted into SC's `lib/`:

```bash
docker run --rm -d --name atlas-schema-extractor \
  -p 127.0.0.1:8091:8081 \
  -v "$(pwd)/db2jcc4.jar:/opt/schemacrawler/lib/db2jcc4.jar:ro" \
  ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
```

PowerShell on Windows (note the absolute path):

```powershell
docker run --rm -d --name atlas-schema-extractor `
  -p 127.0.0.1:8091:8081 `
  -v C:\path\to\db2jcc4.jar:/opt/schemacrawler/lib/db2jcc4.jar:ro `
  ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
```

Then crawl with `db_type: "db2"`:

```bash
curl -X POST http://127.0.0.1:8091/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "db_type":  "db2",
    "host":     "db2.example.com",
    "port":     50000,
    "database": "MYDB",
    "user":     "db2inst1",
    "password": "..."
  }' | jq '.catalog' > db2-catalog.json
```

If the JAR is wrong or missing, SchemaCrawler will fail with `Could not find
a registered driver` — the sidecar surfaces the full SC error in the HTTP
500 response body, so you'll see it in the response.

**Oracle** — the workflow is identical:

1. Obtain `ojdbc8.jar` (or `ojdbc11.jar` for JDK 11+) from your Oracle
   client install, an existing Oracle Database container, or
   <https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html>.
2. Mount it at `/opt/schemacrawler/lib/ojdbc.jar` the same way.
3. Crawl with `db_type: "jdbc"` and supply the full JDBC URL + driver class
   in the request body:

   ```json
   {
     "db_type":     "jdbc",
     "database":    "ORCLPDB1",
     "user":        "system",
     "password":    "...",
     "jdbc_url":    "jdbc:oracle:thin:@oracle.example.com:1521/ORCLPDB1",
     "jdbc_driver": "oracle.jdbc.OracleDriver"
   }
   ```

In both cases the JAR sits inside the running container only — it never
persists to the image and is gone the moment the container stops. If you
need it permanently baked in (e.g., for an internal corporate registry of
the image), build a small downstream image:

```dockerfile
FROM ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
COPY db2jcc4.jar /opt/schemacrawler/lib/db2jcc4.jar
```

That downstream image is yours; redistribution of it is subject to the
JDBC driver's own licence.

---

## API reference

### `POST /crawl`

Run a schema crawl. Returns the full Atlas-canonical catalog (`atlas-schema-fidelity-v1.3`).

**Request body:**

```json
{
  "db_type":      "postgresql | mysql | sqlserver | sqlite | db2 | jdbc",
  "host":         "db.example.com",
  "port":         5432,
  "database":     "your_database",
  "user":         "readonly_user",
  "password":     "...",
  "schemas":      "public",          // optional schema include-regex
  "tables":       ".*",              // optional table include-regex
  "info_level":   "maximum",         // minimum | standard | detailed | maximum
  "jdbc_url":     "jdbc:databricks://...",   // only for db_type=jdbc
  "jdbc_driver":  "com.databricks.client.jdbc.Driver"   // only for db_type=jdbc
}
```

**Response (200 OK):**

```json
{
  "db_type": "postgresql",
  "database": "your_database",
  "tables_count": 142,
  "columns_count": 1287,
  "catalog": {
    "schema_version": "atlas-schema-fidelity-v1.3",
    "generated_at": "2026-05-20T14:30:00.000Z",
    "database": {
      "product": "PostgreSQL 15.17",
      "schemacrawler_version": "SchemaCrawler 17.11.0"
    },
    "counts": { ... },
    "schemas": [ { ... full-fidelity table/column/FK/index/trigger nodes ... } ]
  }
}
```

The `catalog` field is what Atlas Data Fabric ingests. Extract it with `jq '.catalog'`.

**Error responses:**

| Status | Meaning |
|---|---|
| `422 Unprocessable Entity` | Invalid request body (missing required fields, unsupported `output_format`) |
| `500 Internal Server Error` | SchemaCrawler failed — full SC stderr is in the `detail` field |
| `504 Gateway Timeout` | SC exceeded 600s — usually means the database is overloaded or the schema is pathologically large (>5000 tables) |

### `GET /health`

Liveness check. Returns `{"status": "ok"}` if SchemaCrawler and `emit-atlas.js`
are both available; `{"status": "degraded"}` otherwise.

---

## Importing into Atlas

You have two options:

**Option A — drag-and-drop (recommended for evaluation):**

1. Open the Atlas Data Fabric desktop app.
2. Navigate to **Settings → Source Systems → Import Schema**.
3. Drag your `catalog.json` file into the import dialog.
4. Atlas parses it and creates `PhysicalSchema`, `PhysicalTable`, `PhysicalColumn`,
   `PhysicalIndex` nodes with `REFERENCES` and `TABLE_FK` edges, all linked into
   the knowledge graph.

**Option B — streaming via REST API (advanced):**

If you have both Atlas and the extractor running on the same machine, you can
configure Atlas's bundled backend to talk to the extractor directly:

```bash
# Set this environment variable before starting Atlas:
ATLAS_SCHEMACRAWLER_URL=http://127.0.0.1:8081
```

Atlas's **"Crawl Database"** button will then POST to the extractor on your
behalf — single click, no file handoff.

Use Option A for first contact. Option B is for users who run Atlas and the
extractor side-by-side regularly.

---

## Security and networking

This is a database introspection tool. It accepts database credentials in
request bodies. Read these notes before exposing it to anything beyond your
own machine.

- **Default port binding is `127.0.0.1:8081`** — only reachable from localhost.
  To expose on your LAN, change the `ports` line in `docker-compose.yml` to
  `8081:8081`, but be aware that `/crawl` has no authentication. Don't expose
  it on a public interface.
- **Credentials never persist.** They are passed via the request body, used
  to make a single JDBC connection, and discarded when the response is sent.
  Nothing is logged at INFO level (only `db_type` and `database` are
  logged; user/password are not).
- **No telemetry, no outbound calls to Itera.** The container makes JDBC
  connections only to the host you specify in each request.
- **The container runs as a non-root user** (`atlas`, UID 1000) and writes
  only to `/tmp` for per-crawl scratch files. The image filesystem is
  otherwise unmodified at runtime.
- **The database account you connect with should be read-only.** Schema
  introspection requires `SELECT` on `INFORMATION_SCHEMA` (and equivalents);
  no writes are performed.
- **For databases behind a corporate VPN**, run the container on a host that
  is already inside the network (your laptop on VPN, or a bastion host).
  The extractor opens outbound JDBC; the network path must permit that.

---

## Building from source

The image is published on every release, so most users won't need to build it.
If you want to build it yourself (offline / air-gapped / customizing), this
directory is **self-contained**: clone or download it and `docker build` works
without any reference to the rest of the upstream monorepo.

```bash
# From this directory:
docker compose build

# Or with the Databricks JDBC driver bundled:
docker compose build --build-arg BUILD_DATABRICKS=true

# Run it locally:
docker compose up

# Run on a different host port (when 8081 is already taken):
EXTRACTOR_PORT=8091 docker compose up           # bash / zsh
$env:EXTRACTOR_PORT="8091"; docker compose up   # PowerShell

# Tear down:
docker compose down
```

Without Compose, use `docker buildx` directly:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t atlas-schema-extractor:1.3.0 \
  .
```

---

## Licensing

This image is licensed under **Apache-2.0**. See [LICENSE](./LICENSE).

Bundled third-party components retain their original licenses. See
[NOTICE](./NOTICE) for the canonical attribution and
[THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) for the full list,
including source URLs for LGPL-licensed components.

Inside the running container these files are at:

```
/licenses/LICENSE
/licenses/NOTICE
/licenses/THIRD_PARTY_LICENSES.md
```

---

## Trademark notice

**SchemaCrawler** is a trademark of Sualeh Fatehi. This product bundles and
invokes the SchemaCrawler binary distribution per its Apache-2.0 license. It
is not affiliated with or endorsed by the SchemaCrawler project.

**Atlas Data Fabric** and **Itera** are trademarks of Itera ASA. Database
engine names (PostgreSQL, MySQL, MariaDB, Microsoft SQL Server, IBM DB2,
Oracle, Databricks) are trademarks of their respective owners and used here
for identification only.

---

## About Atlas Data Fabric

Atlas Data Fabric is Itera's data migration governance platform. Once you
have a `catalog.json` from this extractor, Atlas will:

- Auto-map source columns to your target schema with confidence-scored proposals
- Trace lineage across multi-source migrations (1:1, N:1, N:M)
- Surface conflicts, missing concepts, and below-threshold mappings in a
  review workflow
- Export a sign-off pack for governance review

To start an evaluation of the Atlas Data Fabric desktop app, contact
Itera at <https://www.itera.com/en/contact>. It is available as a
free Commercial Preview for ninety days. Production deployment,
support, and customisation are available under a separate commercial
agreement.

---

## Support and feedback

- General questions: <atlas@itera.com>
- Bug reports and feature requests: same address
- Commercial / consulting enquiries: <https://www.itera.com/en/contact>

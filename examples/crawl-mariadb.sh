#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# Example: crawl a MariaDB or MySQL database and save the catalog to disk.
# (Same script for both — MariaDB Connector/J handles both wire protocols.)
#
# Prereq:
#   docker run --rm -d --name atlas-extractor \
#     -p 127.0.0.1:8081:8081 \
#     ghcr.io/itera/atlas-schema-extractor:1.2.0
#
# Usage:
#   ./crawl-mariadb.sh <host> <port> <database> <user> <password>
#
# Example:
#   ./crawl-mariadb.sh db.example.com 3306 myapp readonly s3cret
#
# Note: pass your database name in BOTH `database` and `schemas`. MySQL/MariaDB
# JDBC reports all schemas in the catalog (information_schema, mysql, etc.)
# unless filtered. Setting `schemas=<your-db>` filters to only your database.

set -euo pipefail

HOST="${1:?host required (e.g. db.example.com)}"
PORT="${2:-3306}"
DATABASE="${3:?database name required}"
USER="${4:?user required}"
PASSWORD="${5:?password required}"

EXTRACTOR_URL="${EXTRACTOR_URL:-http://127.0.0.1:8081}"
OUTPUT_FILE="${OUTPUT_FILE:-catalog-${DATABASE}.json}"

echo "Crawling mysql://${USER}@${HOST}:${PORT}/${DATABASE}..."

curl -fsS -X POST "${EXTRACTOR_URL}/crawl" \
    -H 'Content-Type: application/json' \
    -d @- <<EOF | jq '.catalog' > "${OUTPUT_FILE}"
{
  "db_type":  "mysql",
  "host":     "${HOST}",
  "port":     ${PORT},
  "database": "${DATABASE}",
  "user":     "${USER}",
  "password": "${PASSWORD}",
  "schemas":  "${DATABASE}"
}
EOF

echo "Wrote ${OUTPUT_FILE}"
echo "Summary:"
jq '.counts' "${OUTPUT_FILE}"
echo ""
echo "Next: drop ${OUTPUT_FILE} into Atlas Data Fabric → Settings → Source Systems → Import Schema."

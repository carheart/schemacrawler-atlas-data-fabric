#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# Example: crawl a Microsoft SQL Server database and save the catalog to disk.
#
# Prereq:
#   docker run --rm -d --name atlas-extractor \
#     -p 127.0.0.1:8081:8081 \
#     ghcr.io/itera/atlas-schema-extractor:1.2.0
#
# Usage:
#   ./crawl-mssql.sh <host> <port> <database> <user> <password> [schemas]
#
# Example:
#   ./crawl-mssql.sh sql.example.com 1433 MyDB sa MyP@ssw0rd! dbo

set -euo pipefail

HOST="${1:?host required (e.g. sql.example.com)}"
PORT="${2:-1433}"
DATABASE="${3:?database name required}"
USER="${4:?user required}"
PASSWORD="${5:?password required}"
SCHEMAS="${6:-dbo}"

EXTRACTOR_URL="${EXTRACTOR_URL:-http://127.0.0.1:8081}"
OUTPUT_FILE="${OUTPUT_FILE:-catalog-${DATABASE}.json}"

echo "Crawling sqlserver://${USER}@${HOST}:${PORT}/${DATABASE} (schemas=${SCHEMAS})..."

curl -fsS -X POST "${EXTRACTOR_URL}/crawl" \
    -H 'Content-Type: application/json' \
    -d @- <<EOF | jq '.catalog' > "${OUTPUT_FILE}"
{
  "db_type":  "sqlserver",
  "host":     "${HOST}",
  "port":     ${PORT},
  "database": "${DATABASE}",
  "user":     "${USER}",
  "password": "${PASSWORD}",
  "schemas":  "${SCHEMAS}"
}
EOF

echo "Wrote ${OUTPUT_FILE}"
echo "Summary:"
jq '.counts' "${OUTPUT_FILE}"
echo ""
echo "Next: drop ${OUTPUT_FILE} into Atlas Data Fabric → Settings → Source Systems → Import Schema."

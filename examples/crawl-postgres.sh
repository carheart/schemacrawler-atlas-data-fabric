#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# Example: crawl a PostgreSQL database and save the catalog to disk.
#
# Prereq:
#   docker run --rm -d --name atlas-extractor \
#     -p 127.0.0.1:8081:8081 \
#     ghcr.io/itera/atlas-schema-extractor:1.2.0
#
# Usage:
#   ./crawl-postgres.sh <host> <port> <database> <user> <password> [schemas]
#
# Example:
#   ./crawl-postgres.sh db.example.com 5432 myapp readonly s3cret public

set -euo pipefail

HOST="${1:?host required (e.g. db.example.com)}"
PORT="${2:-5432}"
DATABASE="${3:?database name required}"
USER="${4:?user required}"
PASSWORD="${5:?password required}"
SCHEMAS="${6:-public}"

EXTRACTOR_URL="${EXTRACTOR_URL:-http://127.0.0.1:8081}"
OUTPUT_FILE="${OUTPUT_FILE:-catalog-${DATABASE}.json}"

echo "Crawling postgresql://${USER}@${HOST}:${PORT}/${DATABASE} (schemas=${SCHEMAS})..."

curl -fsS -X POST "${EXTRACTOR_URL}/crawl" \
    -H 'Content-Type: application/json' \
    -d @- <<EOF | jq '.catalog' > "${OUTPUT_FILE}"
{
  "db_type":  "postgresql",
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

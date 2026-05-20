# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# Example: crawl a MariaDB or MySQL database and save the catalog to disk.
# (Same script for both — MariaDB Connector/J handles both wire protocols.)
#
# Prereq:
#   docker run --rm -d --name atlas-extractor `
#     -p 127.0.0.1:8081:8081 `
#     ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
#
# Usage:
#   .\crawl-mariadb.ps1 -DbHost <host> -Port <port> -Database <db> -User <user> -Password <pwd>
#
# Example:
#   .\crawl-mariadb.ps1 -DbHost db.example.com -Database myapp -User readonly -Password s3cret
#
# Note: schemas is set to the database name to filter MySQL/MariaDB's system
# schemas (information_schema, mysql, etc.) out of the result.

param(
    [Parameter(Mandatory=$true)] [string] $DbHost,
    [int]    $Port     = 3306,
    [Parameter(Mandatory=$true)] [string] $Database,
    [Parameter(Mandatory=$true)] [string] $User,
    [Parameter(Mandatory=$true)] [string] $Password,
    [string] $ExtractorUrl = "http://127.0.0.1:8081",
    [string] $OutputFile   = "catalog-$Database.json"
)

$ErrorActionPreference = "Stop"

Write-Host "Crawling mysql://$User@${DbHost}:${Port}/${Database}..."

$body = @{
    db_type  = "mysql"
    host     = $DbHost
    port     = $Port
    database = $Database
    user     = $User
    password = $Password
    schemas  = $Database
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post `
    -Uri "$ExtractorUrl/crawl" `
    -ContentType "application/json" `
    -Body $body

$response.catalog | ConvertTo-Json -Depth 100 | Set-Content $OutputFile

Write-Host "Wrote $OutputFile"
Write-Host "Summary:"
$response.catalog.counts | Format-List
Write-Host ""
Write-Host "Next: drop $OutputFile into Atlas Data Fabric -> Settings -> Source Systems -> Import Schema."

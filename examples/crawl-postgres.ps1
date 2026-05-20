# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Itera ASA
#
# Example: crawl a PostgreSQL database and save the catalog to disk.
#
# Prereq:
#   docker run --rm -d --name atlas-extractor `
#     -p 127.0.0.1:8081:8081 `
#     ghcr.io/carheart/schemacrawler-atlas-data-fabric:1.3.0
#
# Usage:
#   .\crawl-postgres.ps1 -DbHost <host> -Port <port> -Database <db> -User <user> -Password <pwd> [-Schemas <s>]
#
# Example:
#   .\crawl-postgres.ps1 -DbHost db.example.com -Database myapp -User readonly -Password s3cret

param(
    [Parameter(Mandatory=$true)] [string] $DbHost,
    [int]    $Port     = 5432,
    [Parameter(Mandatory=$true)] [string] $Database,
    [Parameter(Mandatory=$true)] [string] $User,
    [Parameter(Mandatory=$true)] [string] $Password,
    [string] $Schemas  = "public",
    [string] $ExtractorUrl = "http://127.0.0.1:8081",
    [string] $OutputFile   = "catalog-$Database.json"
)

$ErrorActionPreference = "Stop"

Write-Host "Crawling postgresql://$User@${DbHost}:${Port}/${Database} (schemas=$Schemas)..."

$body = @{
    db_type  = "postgresql"
    host     = $DbHost
    port     = $Port
    database = $Database
    user     = $User
    password = $Password
    schemas  = $Schemas
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

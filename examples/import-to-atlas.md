# Importing a catalog into Atlas Data Fabric

This guide assumes you've already produced a `catalog.json` using one of the
`crawl-*.sh` example scripts in this directory.

## Option A — drag-and-drop (recommended for first contact)

1. Open the Atlas Data Fabric desktop app.
2. Navigate to **Settings → Source Systems → Import Schema**.
3. Drag `catalog.json` into the file-drop area.
4. Click **Import**. Atlas parses the JSON and creates graph nodes for every
   schema, table, column, index, and foreign key in your catalog.

That's it. The schema now appears in the **Graph** view, in **Coverage**
metrics, and is available for auto-mapping against your target system.

## Option B — POST to the Atlas REST API

If you have Atlas's bundled `atlas-server` running and want to script the
import, POST the JSON directly:

```bash
curl -X POST http://127.0.0.1:8080/api/schemas/import \
  -H 'Content-Type: application/json' \
  --data-binary @catalog.json
```

The endpoint returns a JSON envelope including:

- `nodes_created` — count of `PhysicalSchema` / `PhysicalTable` / `PhysicalColumn`
  / `PhysicalIndex` nodes added
- `edges_created` — count of `HAS_TABLE` / `HAS_COLUMN` / `REFERENCES` / `TABLE_FK`
  / `HAS_INDEX` / `INDEX_COLUMN` edges added
- `deferred_fks_resolved` / `deferred_fks_unresolved` — cross-schema foreign
  keys promoted from prior imports

## What Atlas does with the catalog

Each field in the Atlas-canonical shape maps to a specific node or edge:

| Source field | Becomes |
|---|---|
| `schemas[].name` + `catalog_name` | `PhysicalSchema` node |
| `schemas[].tables[]` | `PhysicalTable` node + `HAS_TABLE` edge |
| `schemas[].tables[].columns[]` | `PhysicalColumn` node + `HAS_COLUMN` edge |
| `tables[].primary_key` | `is_part_of_pk` flags on the affected columns |
| `tables[].foreign_keys[].column_references[]` | `REFERENCES` (column→column) and `TABLE_FK` (table→table) edges |
| `tables[].indexes[]` | `PhysicalIndex` node + `HAS_INDEX` + `INDEX_COLUMN` edges |
| `tables[].triggers[]` | Metadata on `PhysicalTable` |
| `tables[].table_constraints[]` | Metadata on `PhysicalTable` (CHECK / UNIQUE definitions) |
| `schemas[].sequences[]` | Sequence metadata on the parent schema |

Foreign keys that reference tables in another schema (cross-schema FKs)
become `UnresolvedFK` placeholder nodes if the target schema hasn't been
imported yet. They are automatically promoted to real `REFERENCES` edges
the next time you import the target schema.

## Re-importing the same schema

Re-importing the same `schemas[].catalog_name + schemas[].name` triggers a
**safe-reimport** flow:

1. Atlas takes an internal snapshot of the current graph state for that schema.
2. It computes an impact diff against the new catalog (new/changed/dropped
   columns, FK changes, etc.).
3. It deletes the prior schema and re-creates it from the new catalog.
4. Any existing `DataMapping` / `Hyperedge` references are re-linked to the
   recreated columns where possible.
5. On any failure, the snapshot is restored.

This means you can re-crawl after a schema change and Atlas will keep your
mappings intact as long as the column names haven't changed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Import returns `unsupported_schema_version` | You imported the response wrapper instead of the catalog | Extract `.catalog` from the response: `jq '.catalog' response.json > catalog.json` |
| Import succeeds but `counts.tables` is 0 | The DB wasn't ready when you crawled (installer still running) | Wait for your app's healthcheck to be green, then re-crawl |
| Import succeeds but no foreign keys are present | The source DB really has no FKs (e.g., PrestaShop 8 defines FK relationships in PHP, not DB) | This is faithful to source — not a bug |
| Import fails with `403` or `503` | Atlas backend isn't running, or maintenance mode is active | Start Atlas, or wait for the import lock |

// =====================================================================
// emit-atlas.js — full-fidelity SchemaCrawler -> Atlas-canonical JSON
// =====================================================================
//
// Invoked via:
//   schemacrawler.sh ... --command=script --script-language=js \
//     --script=/opt/schemacrawler/scripts/emit-atlas.js \
//     --output-file=catalog.json
//
// Emits a single JSON document with full structural fidelity:
//   - Every schema, table, view (with definition for views)
//   - Every column with type / nullable / default / auto-incr / generated /
//     hidden / size / precision / remarks / membership flags (PK/FK/index)
//   - Primary keys (named, with column list)
//   - Foreign keys (with from->to column refs, ON UPDATE/DELETE rules,
//     cardinality, deferrability)
//   - Indexes (with columns, uniqueness, type)
//   - Triggers (with event, timing, action, orientation)
//   - Table constraints (CHECK / UNIQUE with definitions)
//   - Sequences (with start/increment/min/max/cycle)
//   - Synonyms, routines (where the engine supports them)
//
// Designed to be the ONE script that works across every engine SC
// supports: PostgreSQL, MySQL/MariaDB, SQL Server, DB2, Oracle, SQLite.
// All engine-specific accessors are wrapped in try/catch — if an engine
// doesn't support a feature, that section is omitted gracefully.
//
// Schema version: atlas-schema-fidelity-v1.3
//
// Changelog v1.3 (2026-05-16):
//   - default_value now preserves empty-string defaults — MySQL columns
//     declared `DEFAULT ''` (and `DEFAULT ' '`) no longer round-trip as
//     null. Discovered during the 2026-05-16 EspoCRM/SuiteCRM fidelity
//     audit (3 columns total across the two corpora silently lost their
//     defaults). Fix is a new safeStrPreserveEmpty helper used only for
//     the default_value field; other fields (names, remarks, etc.)
//     continue using safeStr which still collapses empty-to-null.
//   - schema_version bumped from v1.2 to v1.3 to mark the behavior
//     change; the downstream parser is v1.x-tolerant per DD-01.
//
// Changelog v1.2 (2026-05-05):
//   - schemas[].catalog_name now reads ATLAS_DATABASE_NAME env var first
//     (set by the sidecar to req.database) — this is the actual JDBC
//     catalog the connection was made to. SchemaCrawler's MutableCatalog
//     defaults to the literal string "catalog" on PostgreSQL when no name
//     is set; we route around that. Falls back to catalog.getName() if the
//     env var isn't set (e.g., script invoked directly outside the sidecar).
//   - schemas[].full_name correctly emits "<db>.<schema>" everywhere now:
//     "odoo.public" on PG (was "catalog.public" in v1.1, "public" in v1.0).
//
// Changelog v1.1 (2026-05-05):
//   - schemas[].catalog_name now falls back to catalog.getName() when the
//     per-schema accessor returns null (Postgres-style).
//   - schemas[].full_name now constructs "catalog.schema" when both names
//     are available; was emitting just "schema" previously.
//   - generated_at switched to ISO-8601 (`new Date().toISOString()`) — was
//     space-separated naive datetime from crawl_info.timestamp().
//   - indexes[].kind added as a derived value (UNIQUE | NON_UNIQUE) — useful
//     downstream because indexes[].type is "OTHER" for most indexes on
//     PostgreSQL (JDBC quirk; the unique flag carries the real distinction).
// =====================================================================

(function () {
  // ---------------------------------------------------------------------
  // helpers — Java collection -> plain JS array (GraalVM polyglot)
  // ---------------------------------------------------------------------
  function toArr(javaCollection) {
    try {
      if (javaCollection === null || javaCollection === undefined) return [];
      if (typeof javaCollection.toArray === 'function') {
        var a = javaCollection.toArray();
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(a[i]);
        return out;
      }
      // already array-like
      var out = [];
      for (var i = 0; i < javaCollection.length; i++) out.push(javaCollection[i]);
      return out;
    } catch (e) {
      return [];
    }
  }

  function safeStr(v) {
    if (v === null || v === undefined) return null;
    var s = String(v);
    return s.length === 0 ? null : s;
  }

  // Like safeStr, but preserves empty strings (returns "" instead of null).
  // Use ONLY for fields where empty-string is a legitimate value distinct
  // from absent — currently just `default_value` (e.g., MySQL columns
  // declared `DEFAULT ''` or `DEFAULT ' '`). Other fields (names, remarks)
  // continue to use safeStr which collapses empty to null, because for
  // those an empty string is functionally the same as "not set".
  function safeStrPreserveEmpty(v) {
    if (v === null || v === undefined) return null;
    return String(v);
  }

  function safeBool(v) {
    if (v === null || v === undefined) return null;
    return Boolean(v);
  }

  function safeNum(v) {
    if (v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function tryCall(fn, fallback) {
    try {
      var r = fn();
      return (r === undefined) ? fallback : r;
    } catch (e) {
      return fallback;
    }
  }

  // ---------------------------------------------------------------------
  // column extraction
  // ---------------------------------------------------------------------
  function emitColumn(col) {
    var dt = tryCall(function () { return col.getColumnDataType(); }, null);
    return {
      name: tryCall(function () { return col.getName(); }, null),
      ordinal: tryCall(function () { return safeNum(col.getOrdinalPosition()); }, null),
      data_type: tryCall(function () { return dt && dt.getName(); }, null),
      native_type: tryCall(function () { return dt && dt.getDatabaseSpecificTypeName(); }, null),
      java_sql_type: tryCall(function () {
        var jst = dt && dt.getJavaSqlType();
        return jst && jst.getName();
      }, null),
      size: tryCall(function () { return safeNum(col.getSize()); }, null),
      decimal_digits: tryCall(function () { return safeNum(col.getDecimalDigits()); }, null),
      nullable: tryCall(function () { return safeBool(col.isNullable()); }, null),
      default_value: tryCall(function () {
        // Preserve empty-string defaults: MySQL `DEFAULT ''` and
        // `DEFAULT ' '` must round-trip as the literal string, not null.
        // hasDefaultValue() correctly returns true for them; safeStr's
        // collapse-empty-to-null would erase the fact. v1.3 fix.
        return col.hasDefaultValue() ? safeStrPreserveEmpty(col.getDefaultValue()) : null;
      }, null),
      auto_incremented: tryCall(function () { return safeBool(col.isAutoIncremented()); }, false),
      generated: tryCall(function () { return safeBool(col.isGenerated()); }, false),
      hidden: tryCall(function () { return safeBool(col.isHidden()); }, false),
      remarks: tryCall(function () {
        return col.hasRemarks() ? safeStr(col.getRemarks()) : null;
      }, null),
      // Membership flags
      is_part_of_pk: tryCall(function () { return safeBool(col.isPartOfPrimaryKey()); }, false),
      is_part_of_fk: tryCall(function () { return safeBool(col.isPartOfForeignKey()); }, false),
      is_part_of_index: tryCall(function () { return safeBool(col.isPartOfIndex()); }, false),
      is_part_of_unique_index: tryCall(function () { return safeBool(col.isPartOfUniqueIndex()); }, false)
    };
  }

  // ---------------------------------------------------------------------
  // foreign key extraction (one FK -> N column references)
  // ---------------------------------------------------------------------
  function emitForeignKey(fk) {
    var refs = [];
    var refList = tryCall(function () { return toArr(fk.getColumnReferences()); }, []);
    for (var i = 0; i < refList.length; i++) {
      var cr = refList[i];
      refs.push({
        from_column: tryCall(function () { return cr.getForeignKeyColumn().getName(); }, null),
        from_table: tryCall(function () { return cr.getForeignKeyColumn().getParent().getName(); }, null),
        from_schema: tryCall(function () {
          var s = cr.getForeignKeyColumn().getParent().getSchema();
          return s && s.getName();
        }, null),
        to_column: tryCall(function () { return cr.getPrimaryKeyColumn().getName(); }, null),
        to_table: tryCall(function () { return cr.getPrimaryKeyColumn().getParent().getName(); }, null),
        to_schema: tryCall(function () {
          var s = cr.getPrimaryKeyColumn().getParent().getSchema();
          return s && s.getName();
        }, null)
      });
    }
    return {
      name: tryCall(function () { return safeStr(fk.getName()); }, null),
      column_references: refs,
      update_rule: tryCall(function () {
        var r = fk.getUpdateRule();
        return r && (r.toString ? r.toString() : String(r));
      }, null),
      delete_rule: tryCall(function () {
        var r = fk.getDeleteRule();
        return r && (r.toString ? r.toString() : String(r));
      }, null),
      deferrability: tryCall(function () {
        var d = fk.getDeferrability();
        return d && (d.toString ? d.toString() : String(d));
      }, null)
    };
  }

  // ---------------------------------------------------------------------
  // index extraction
  // ---------------------------------------------------------------------
  function emitIndex(idx) {
    var cols = tryCall(function () { return toArr(idx.getColumns()); }, []);
    var colNames = [];
    for (var i = 0; i < cols.length; i++) {
      colNames.push(tryCall(function () { return cols[i].getName(); }, null));
    }
    var isUnique = tryCall(function () { return safeBool(idx.isUnique()); }, false);
    return {
      name: tryCall(function () { return safeStr(idx.getName()); }, null),
      unique: isUnique,
      // `type` comes straight from JDBC and is "OTHER" for most indexes on
      // Postgres / SQL Server (the driver doesn't expose BTREE/GIN/etc).
      // `kind` is the derived useful summary downstream consumers should rely on.
      type: tryCall(function () {
        var t = idx.getIndexType();
        return t && (t.toString ? t.toString() : String(t));
      }, null),
      kind: isUnique ? "UNIQUE" : "NON_UNIQUE",
      columns: colNames
    };
  }

  // ---------------------------------------------------------------------
  // primary key extraction
  // PrimaryKey is an Index in SC; its columns can be derived either via
  // getColumns() (works in some versions) OR via column flag walk on
  // the table (always works). We use the column flag approach as primary
  // because it's the most reliable across SC 16.x and 17.x.
  // ---------------------------------------------------------------------
  function emitPrimaryKey(table, pk) {
    if (!pk) return null;
    var cols = [];
    // Walk table columns and pick the ones flagged as part of PK.
    // This survives MutablePrimaryKey getColumns API differences across
    // SC versions.
    var tableCols = tryCall(function () { return toArr(table.getColumns()); }, []);
    for (var i = 0; i < tableCols.length; i++) {
      var c = tableCols[i];
      if (tryCall(function () { return c.isPartOfPrimaryKey(); }, false)) {
        cols.push(tryCall(function () { return c.getName(); }, null));
      }
    }
    return {
      name: tryCall(function () { return safeStr(pk.getName()); }, null),
      columns: cols
    };
  }

  // ---------------------------------------------------------------------
  // trigger extraction
  // ---------------------------------------------------------------------
  function emitTrigger(tr) {
    return {
      name: tryCall(function () { return safeStr(tr.getName()); }, null),
      event: tryCall(function () {
        var e = tr.getEventManipulationType();
        return e && (e.toString ? e.toString() : String(e));
      }, null),
      timing: tryCall(function () {
        var t = tr.getConditionTiming();
        return t && (t.toString ? t.toString() : String(t));
      }, null),
      orientation: tryCall(function () {
        var o = tr.getActionOrientation();
        return o && (o.toString ? o.toString() : String(o));
      }, null),
      action: tryCall(function () { return safeStr(tr.getActionStatement()); }, null)
    };
  }

  // ---------------------------------------------------------------------
  // table constraint extraction (CHECK / UNIQUE / etc)
  // ---------------------------------------------------------------------
  function emitTableConstraint(tc) {
    var cols = [];
    try {
      var ccs = toArr(tc.getConstrainedColumns ? tc.getConstrainedColumns() : []);
      for (var i = 0; i < ccs.length; i++) {
        cols.push(tryCall(function () { return ccs[i].getName(); }, null));
      }
    } catch (e) {}
    return {
      name: tryCall(function () { return safeStr(tc.getName()); }, null),
      type: tryCall(function () {
        var t = tc.getType ? tc.getType() :
                (tc.getConstraintType ? tc.getConstraintType() : null);
        return t && (t.toString ? t.toString() : String(t));
      }, null),
      definition: tryCall(function () {
        return tc.hasDefinition && tc.hasDefinition() ? safeStr(tc.getDefinition()) : null;
      }, null),
      columns: cols
    };
  }

  // ---------------------------------------------------------------------
  // table extraction
  // ---------------------------------------------------------------------
  function emitTable(table) {
    var columns = [];
    var cols = tryCall(function () { return toArr(table.getColumns()); }, []);
    for (var i = 0; i < cols.length; i++) columns.push(emitColumn(cols[i]));

    var fks = [];
    // Use exported FKs (this table is the parent / referenced side) AND
    // imported FKs (this table has the FK column). We emit imported only
    // to avoid double-counting; exported relationships are recoverable
    // from the imported side at the target table.
    var fkList = tryCall(function () { return toArr(table.getImportedForeignKeys()); }, []);
    for (var k = 0; k < fkList.length; k++) fks.push(emitForeignKey(fkList[k]));

    var indexes = [];
    var idxList = tryCall(function () { return toArr(table.getIndexes()); }, []);
    for (var ii = 0; ii < idxList.length; ii++) indexes.push(emitIndex(idxList[ii]));

    var triggers = [];
    var trList = tryCall(function () { return toArr(table.getTriggers()); }, []);
    for (var t = 0; t < trList.length; t++) triggers.push(emitTrigger(trList[t]));

    var constraints = [];
    var tcList = tryCall(function () { return toArr(table.getTableConstraints()); }, []);
    for (var c = 0; c < tcList.length; c++) constraints.push(emitTableConstraint(tcList[c]));

    var pk = tryCall(function () {
      return table.hasPrimaryKey() ? table.getPrimaryKey() : null;
    }, null);

    return {
      name: tryCall(function () { return table.getName(); }, null),
      full_name: tryCall(function () { return table.getFullName(); }, null),
      type: tryCall(function () {
        var tt = table.getTableType();
        return tt && (tt.toString ? tt.toString() : String(tt));
      }, null),
      remarks: tryCall(function () {
        return table.hasRemarks() ? safeStr(table.getRemarks()) : null;
      }, null),
      definition: tryCall(function () {
        // Only meaningful for VIEW / MATERIALIZED VIEW
        return table.hasDefinition && table.hasDefinition() ? safeStr(table.getDefinition()) : null;
      }, null),
      column_count: columns.length,
      columns: columns,
      primary_key: emitPrimaryKey(table, pk),
      foreign_keys: fks,
      indexes: indexes,
      triggers: triggers,
      table_constraints: constraints
    };
  }

  // ---------------------------------------------------------------------
  // sequence extraction (only some engines have explicit sequences)
  // ---------------------------------------------------------------------
  function emitSequence(seq) {
    return {
      name: tryCall(function () { return seq.getName(); }, null),
      schema: tryCall(function () { return seq.getSchema().getName(); }, null),
      start_value: tryCall(function () { return safeNum(seq.getStartValue()); }, null),
      minimum_value: tryCall(function () { return safeNum(seq.getMinimumValue()); }, null),
      maximum_value: tryCall(function () { return safeNum(seq.getMaximumValue()); }, null),
      increment: tryCall(function () { return safeNum(seq.getIncrement()); }, null),
      cycle: tryCall(function () { return safeBool(seq.isCycle()); }, false)
    };
  }

  // ---------------------------------------------------------------------
  // routine extraction (procedures / functions)
  // ---------------------------------------------------------------------
  function emitRoutine(r) {
    return {
      name: tryCall(function () { return r.getName(); }, null),
      schema: tryCall(function () { return r.getSchema().getName(); }, null),
      type: tryCall(function () {
        var t = r.getRoutineType();
        return t && (t.toString ? t.toString() : String(t));
      }, null),
      return_type: tryCall(function () {
        var rt = r.getReturnType();
        return rt && (rt.toString ? rt.toString() : String(rt));
      }, null),
      definition: tryCall(function () {
        return r.hasDefinition && r.hasDefinition() ? safeStr(r.getDefinition()) : null;
      }, null)
    };
  }

  // ---------------------------------------------------------------------
  // schema extraction
  // ---------------------------------------------------------------------
  function emitSchema(schema) {
    var tables = [];
    var tableList = tryCall(function () { return toArr(catalog.getTables(schema)); }, []);
    for (var i = 0; i < tableList.length; i++) {
      tables.push(emitTable(tableList[i]));
    }

    var sequences = [];
    var seqList = tryCall(function () { return toArr(catalog.getSequences(schema)); }, []);
    for (var s = 0; s < seqList.length; s++) sequences.push(emitSequence(seqList[s]));

    var synonyms = [];
    try {
      var synList = toArr(catalog.getSynonyms(schema));
      for (var sy = 0; sy < synList.length; sy++) {
        var syn = synList[sy];
        synonyms.push({
          name: tryCall(function () { return syn.getName(); }, null),
          target: tryCall(function () {
            var ref = syn.getReferencedObject();
            return ref && ref.getFullName ? ref.getFullName() : null;
          }, null)
        });
      }
    } catch (e) {}

    var routines = [];
    var rtList = tryCall(function () { return toArr(catalog.getRoutines(schema)); }, []);
    for (var rr = 0; rr < rtList.length; rr++) routines.push(emitRoutine(rtList[rr]));

    // Catalog-name resolution: prefer the schema's own getCatalogName(),
    // fall back to the catalog-wide getName() (Postgres returns null at the
    // schema level but the catalog itself knows its database name).
    var schemaName = tryCall(function () { return schema.getName(); }, null);
    var catalogName = tryCall(function () { return schema.getCatalogName(); }, null);
    if (catalogName === null || catalogName === undefined) {
      catalogName = catalogWideName; // captured at script start; see top-level emit
    }
    var fullName;
    if (catalogName && schemaName) {
      fullName = catalogName + "." + schemaName;
    } else {
      fullName = tryCall(function () { return schema.getFullName(); }, schemaName);
    }
    return {
      name: schemaName,
      catalog_name: catalogName,
      full_name: fullName,
      table_count: tables.length,
      tables: tables,
      sequences: sequences,
      synonyms: synonyms,
      routines: routines
    };
  }

  // ---------------------------------------------------------------------
  // top-level emit
  // ---------------------------------------------------------------------
  // Capture the catalog-wide name. Resolution order:
  //   1. ATLAS_DATABASE_NAME env var (set by Atlas sidecar to req.database) —
  //      this is the actual JDBC catalog the connection was made to. Most
  //      reliable signal across every engine.
  //   2. catalog.getName() — works on MariaDB/MySQL; on PostgreSQL returns
  //      the SC placeholder "catalog" which we treat as null.
  //   3. null — script falls back to schema name only for full_name.
  // emitSchema() uses this as the override when schema.getCatalogName() is null.
  var catalogWideName = null;
  try {
    var sysClass = Java.type("java.lang.System");
    var envName = sysClass.getenv("ATLAS_DATABASE_NAME");
    if (envName && String(envName).length > 0) {
      catalogWideName = String(envName);
    }
  } catch (e) { /* env access denied or Java.type unavailable — fall through */ }
  if (!catalogWideName) {
    catalogWideName = tryCall(function () { return catalog.getName(); }, null);
    // SC's MutableCatalog default placeholder — treat as not-a-real-name.
    if (catalogWideName === "catalog") catalogWideName = null;
  }

  var schemas = [];
  var schemaList = tryCall(function () { return toArr(catalog.getSchemas()); }, []);
  for (var i = 0; i < schemaList.length; i++) {
    schemas.push(emitSchema(schemaList[i]));
  }

  // Aggregate counts (cheap to compute, useful for downstream sanity checks)
  var totalTables = 0, totalColumns = 0, totalFKs = 0, totalIndexes = 0,
      totalTriggers = 0, totalSequences = 0, totalRoutines = 0;
  for (var s = 0; s < schemas.length; s++) {
    var sc = schemas[s];
    totalTables += sc.tables.length;
    totalSequences += sc.sequences.length;
    totalRoutines += sc.routines.length;
    for (var t = 0; t < sc.tables.length; t++) {
      var tab = sc.tables[t];
      totalColumns += tab.columns.length;
      totalFKs += tab.foreign_keys.length;
      totalIndexes += tab.indexes.length;
      totalTriggers += tab.triggers.length;
    }
  }

  var output = {
    schema_version: "atlas-schema-fidelity-v1.3",
    // ISO-8601 with Z. crawl_info.timestamp().toString() returned a
    // space-separated naive datetime ("2026-05-05 17:33:18") on v17;
    // JS `new Date().toISOString()` is deterministic and correct.
    generated_at: tryCall(function () { return new Date().toISOString(); }, null),
    database: {
      product: tryCall(function () { return crawl_info.databaseVersion().toString(); }, null),
      schemacrawler_version: tryCall(function () { return crawl_info.schemacrawlerVersion().toString(); }, null)
    },
    counts: {
      schemas: schemas.length,
      tables: totalTables,
      columns: totalColumns,
      foreign_key_relationships: totalFKs,
      indexes: totalIndexes,
      triggers: totalTriggers,
      sequences: totalSequences,
      routines: totalRoutines
    },
    schemas: schemas
  };

  print(JSON.stringify(output));
})();

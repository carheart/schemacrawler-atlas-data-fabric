# Third-Party Components and Licenses

This document enumerates every third-party software component bundled into
the **Atlas Schema Extractor** Docker image, along with its version,
license, and source URL. All bundled components retain their original
licenses; this document does not modify any of them.

The Atlas Schema Extractor itself (the `Dockerfile`, `server.py`,
`emit-atlas.js`, and supporting configuration) is licensed under
Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

---

## Schema crawling

| Component | Version | License | Source |
|---|---|---|---|
| **SchemaCrawler** | 17.11.0 | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | https://github.com/schemacrawler/SchemaCrawler |
| **GraalVM JavaScript** | (bundled with SchemaCrawler) | [Universal Permissive License (UPL) 1.0](https://opensource.org/licenses/UPL) / [GraalVM Free Terms and Conditions](https://www.oracle.com/downloads/licenses/graal-free-license.html) | https://www.graalvm.org/ |

The GraalVM JavaScript engine ships inside the SchemaCrawler binary
distribution as the runtime for `--command=script --script-language=js`.
GFTC (introduced for GraalVM 21+) permits free production use, including
commercial use, with no royalty.

## JDBC drivers (bundled by default)

| Driver | Version | License | Source |
|---|---|---|---|
| **PostgreSQL JDBC Driver** | 42.7.3 | [BSD-2-Clause](https://opensource.org/licenses/BSD-2-Clause) | https://jdbc.postgresql.org/ |
| **MariaDB Connector/J** | 2.7.12 | [LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html) | https://mariadb.com/kb/en/about-mariadb-connector-j/ |
| **Microsoft JDBC Driver for SQL Server** | 12.6.1.jre11 | [MIT](https://opensource.org/licenses/MIT) | https://github.com/microsoft/mssql-jdbc |

**Why MariaDB Connector/J for both MySQL and MariaDB?** MariaDB Connector/J 2.7.x
registers itself for both `jdbc:mysql://` and `jdbc:mariadb://` URL schemes and
is wire-compatible with MySQL 5.5+ (including MySQL 8.x's `caching_sha2_password`
authentication). Its LGPL-2.1 license is unambiguous about redistribution in a
third-party container. We chose it over Oracle's MySQL Connector/J 8.x (GPLv2
with FOSS exception) because the LGPL line has clearer redistribution semantics
for enterprise procurement teams. Both drivers produce functionally equivalent
schema introspection results.

### Source code availability — LGPL-2.1 obligations

LGPL-2.1 requires that recipients of binary distributions can obtain the
corresponding source code. The MariaDB Connector/J source for version 2.7.12
is available at:

  https://github.com/mariadb-corporation/mariadb-connector-j/tree/2.7.12

You may also replace the bundled `mariadb-java-client.jar` in the running
container with a modified version of your own by mounting a replacement JAR:

```
docker run --rm \
  -v ./my-custom-mariadb-jdbc.jar:/opt/schemacrawler/lib/mariadb-java-client.jar:ro \
  -p 127.0.0.1:8081:8081 \
  ghcr.io/itera/atlas-schema-extractor:1.2.0
```

## JDBC drivers (opt-in)

| Driver | Version | License | Source | Build flag |
|---|---|---|---|---|
| **Databricks JDBC Driver** | 3.3.2 | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | https://github.com/databricks/databricks-jdbc | `BUILD_DATABRICKS=true` |

## JDBC drivers (not bundled — bring your own)

| Driver | License | Why not bundled |
|---|---|---|
| **IBM DB2 JDBC Driver** (`db2jcc4.jar`) | IBM proprietary | License does not permit redistribution. Mount at `/opt/schemacrawler/lib/db2jcc4.jar`. |
| **Oracle JDBC Driver** (`ojdbc.jar`) | Oracle proprietary | Same. Mount at `/opt/schemacrawler/lib/ojdbc.jar`. |

## Java runtime

| Component | Version | License | Source |
|---|---|---|---|
| **OpenJDK Java Runtime Environment** | 17 (from `default-jre-headless` on Debian 12) | [GPLv2 with Classpath Exception](https://openjdk.org/legal/gplv2+ce.html) | https://openjdk.org/ |

The Classpath Exception decouples linking from license-infection: applications
running on the JRE are not subject to GPL. Redistribution of the JRE itself is
permitted under GPLv2 and the corresponding source is available through
Debian's standard source channels (`apt source openjdk-17-jre-headless`).

## Python runtime and dependencies

| Component | Version | License | Source |
|---|---|---|---|
| **Python** | 3.12 (from `python:3.12-slim-bookworm` base image) | [PSF License Agreement](https://docs.python.org/3/license.html) | https://www.python.org/ |
| **FastAPI** | 0.136.1 | [MIT](https://opensource.org/licenses/MIT) | https://github.com/tiangolo/fastapi |
| **uvicorn[standard]** | 0.46.0 | [BSD-3-Clause](https://opensource.org/licenses/BSD-3-Clause) | https://github.com/encode/uvicorn |
| **pydantic** | 2.13.4 | [MIT](https://opensource.org/licenses/MIT) | https://github.com/pydantic/pydantic |
| **pydantic_core** | 2.46.4 | MIT | https://github.com/pydantic/pydantic-core |
| **starlette** | 1.0.0 | BSD-3-Clause | https://github.com/encode/starlette |
| **anyio** | 4.13.0 | MIT | https://github.com/agronholm/anyio |
| **annotated-doc** | 0.0.4 | MIT | https://pypi.org/project/annotated-doc/ |
| **annotated-types** | 0.7.0 | MIT | https://github.com/annotated-types/annotated-types |
| **click** | 8.3.3 | BSD-3-Clause | https://github.com/pallets/click |
| **h11** | 0.16.0 | MIT | https://github.com/python-hyper/h11 |
| **httptools** | 0.7.1 | MIT | https://github.com/MagicStack/httptools |
| **idna** | 3.15 | BSD-3-Clause | https://github.com/kjd/idna |
| **python-dotenv** | 1.2.2 | BSD-3-Clause | https://github.com/theskumar/python-dotenv |
| **PyYAML** | 6.0.3 | MIT | https://github.com/yaml/pyyaml |
| **typing-inspection** | 0.4.2 | MIT | https://github.com/pydantic/typing-inspection |
| **typing_extensions** | 4.15.0 | PSF | https://github.com/python/typing_extensions |
| **uvloop** | 0.22.1 | MIT / Apache-2.0 | https://github.com/MagicStack/uvloop |
| **watchfiles** | 1.1.1 | MIT | https://github.com/samuelcolvin/watchfiles |
| **websockets** | 16.0 | BSD-3-Clause | https://github.com/python-websockets/websockets |

## Base OS layer

| Component | Source |
|---|---|
| **Debian 12 (bookworm) packages** (via `python:3.12-slim-bookworm`) | https://www.debian.org/distrib/packages |

Debian packages are individually licensed; the union is overwhelmingly
permissive (MIT, BSD, Apache-2.0) with some GPL/LGPL components for system
utilities. Debian provides source for every package; run `apt source <package>`
inside the container to retrieve any one of them.

---

## Trademarks

- **SchemaCrawler** is a trademark of Sualeh Fatehi. The Atlas Schema Extractor
  bundles and invokes the SchemaCrawler binary distribution per its Apache-2.0
  license; this product is not affiliated with or endorsed by the SchemaCrawler
  project.
- **Atlas Data Fabric** and **Itera** are trademarks of Itera ASA.
- **PostgreSQL**, **MySQL**, **MariaDB**, **Microsoft SQL Server**, **IBM DB2**,
  **Oracle**, and **Databricks** are trademarks of their respective owners.
  Mention of these names in this document is for identification purposes only
  and does not imply any endorsement.

## Reporting a license concern

If you believe a component is incorrectly listed, or that an attribution is
missing or inaccurate, please contact us at <atlas@itera.com> or via
https://www.itera.com/en/contact.

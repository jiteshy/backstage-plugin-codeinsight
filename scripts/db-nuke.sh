#!/usr/bin/env bash
# Truncates all CodeInsight data tables in the Backstage plugin database.
# Does NOT drop tables or migrations — schema is preserved.
#
# Usage:
#   ./scripts/db-nuke.sh              # uses defaults
#   DB_HOST=... DB_PORT=... ./scripts/db-nuke.sh

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-codeinsight}"
DB_PASSWORD="${DB_PASSWORD:-codeinsight}"
DB_NAME="${DB_NAME:-backstage_plugin_codeinsight}"

echo "Nuking all CodeInsight tables in ${DB_NAME} on ${DB_HOST}:${DB_PORT}..."

PGPASSWORD="$DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  <<'SQL'
TRUNCATE TABLE
  ci_artifact_dependencies,
  ci_artifact_inputs,
  ci_artifacts,
  ci_cig_edges,
  ci_cig_nodes,
  ci_repo_files,
  ci_ingestion_jobs,
  ci_llm_cache,
  ci_embedding_cache,
  ci_repositories
CASCADE;
SQL

echo "Done. All CodeInsight data cleared."

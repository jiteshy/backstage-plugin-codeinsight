import type { Knex } from 'knex';

/**
 * Migration 009 — Add index on ci_artifact_dependencies(repo_id, dependency_id)
 *
 * The primary key on ci_artifact_dependencies is (repo_id, dependent_id, dependency_id).
 * Queries that look up dependents by dependency_id (used by StalenessService.sweep
 * cascade logic via getArtifactDependents) cannot use the PK because dependency_id
 * is not a leading column. This index enables efficient cascade hops.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'CREATE INDEX idx_artifact_deps_dependency ON ci_artifact_dependencies(repo_id, dependency_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_artifact_deps_dependency');
}

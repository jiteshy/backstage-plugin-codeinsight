import type { Knex } from 'knex';

/**
 * Add generation_sig to ci_artifacts.
 *
 * Stores a generation signature of the form "{modelName}:{promptVersion}" so
 * that changing the LLM model (or a future prompt version bump) causes
 * DocGenerationService and DiagramGenerationService to regenerate artifacts
 * on the next sync, even when the source files haven't changed.
 *
 * Existing rows receive NULL — treated as "legacy, no signature tracked".
 * The first sync after this migration regenerates only the artifacts whose
 * source has changed (normal delta behaviour); the sig is written for all
 * newly generated artifacts from that point on.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_artifacts', table => {
    table.text('generation_sig').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_artifacts', table => {
    table.dropColumn('generation_sig');
  });
}

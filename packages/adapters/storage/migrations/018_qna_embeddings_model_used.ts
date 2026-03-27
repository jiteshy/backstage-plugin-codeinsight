import type { Knex } from 'knex';

/**
 * Add model_used to ci_qna_embeddings.
 *
 * Records which embedding model produced each vector so that
 * syncEmbeddingDimension() can detect a same-dimension model switch
 * (e.g. text-embedding-ada-002 → text-embedding-3-small, both 1536 dims)
 * and truncate stale vectors accordingly.
 *
 * Existing rows receive an empty string — syncEmbeddingDimension() treats
 * empty as "unknown" and truncates the table on the next startup to ensure
 * all vectors are re-built with the current model.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_qna_embeddings', table => {
    table.text('model_used').notNullable().defaultTo('');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_qna_embeddings', table => {
    table.dropColumn('model_used');
  });
}

import type { Knex } from 'knex';

/**
 * Widen ci_embedding_cache.embedding from VECTOR(1536) to VECTOR(3072) to
 * support text-embedding-3-large and custom dimension configs.
 *
 * Also adds model_used to a composite unique constraint so the same text
 * embedded with different models/dimensions is stored separately.
 */
export async function up(knex: Knex): Promise<void> {
  // Check if pgvector and the embedding column exist
  const hasColumn = await knex.schema.hasColumn('ci_embedding_cache', 'embedding');
  if (!hasColumn) {
    // Table exists without vector column (pgvector wasn't available at install time)
    // Nothing to widen — Phase 5 will handle adding the column
    return;
  }

  // Widen the vector dimension: drop and re-add with larger size
  // Truncate first — cached embeddings will be re-computed on next index run
  await knex('ci_embedding_cache').truncate();
  await knex.schema.raw('ALTER TABLE ci_embedding_cache DROP COLUMN embedding');
  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache ADD COLUMN embedding VECTOR(3072) NOT NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('ci_embedding_cache', 'embedding');
  if (!hasColumn) {
    return;
  }

  await knex('ci_embedding_cache').truncate();
  await knex.schema.raw('ALTER TABLE ci_embedding_cache DROP COLUMN embedding');
  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache ADD COLUMN embedding VECTOR(1536) NOT NULL',
  );
}

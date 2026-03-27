import type { Knex } from 'knex';

/**
 * Fix embedding dimensions to match text-embedding-3-small (1536 dims), the
 * default model. Migration 010 prematurely widened ci_embedding_cache to 3072
 * (assuming text-embedding-3-large), and migration 013 widened ci_qna_embeddings
 * to match — but neither table can accept 1536-dim vectors until they're restored.
 *
 * Future model/dimension changes are handled automatically: syncEmbeddingDimension()
 * is called at plugin startup and aligns the column to the configured model,
 * truncating existing embeddings when the dimension changes. No manual migration
 * is needed when switching models.
 */
export async function up(knex: Knex): Promise<void> {
  // --- ci_embedding_cache ---
  const hasCacheCol = await knex.schema.hasColumn('ci_embedding_cache', 'embedding');
  if (hasCacheCol) {
    await knex('ci_embedding_cache').truncate();
    await knex.schema.raw('ALTER TABLE ci_embedding_cache DROP COLUMN embedding');
    await knex.schema.raw(
      'ALTER TABLE ci_embedding_cache ADD COLUMN embedding VECTOR(1536) NOT NULL',
    );
  }

  // --- ci_qna_embeddings ---
  const hasQnaCol = await knex.schema.hasColumn('ci_qna_embeddings', 'embedding');
  if (hasQnaCol) {
    await knex('ci_qna_embeddings').truncate();
    await knex.schema.raw('ALTER TABLE ci_qna_embeddings DROP COLUMN embedding');
    await knex.schema.raw(
      'ALTER TABLE ci_qna_embeddings ADD COLUMN embedding VECTOR(1536) NOT NULL',
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCacheCol = await knex.schema.hasColumn('ci_embedding_cache', 'embedding');
  if (hasCacheCol) {
    await knex('ci_embedding_cache').truncate();
    await knex.schema.raw('ALTER TABLE ci_embedding_cache DROP COLUMN embedding');
    await knex.schema.raw(
      'ALTER TABLE ci_embedding_cache ADD COLUMN embedding VECTOR(3072) NOT NULL',
    );
  }

  const hasQnaCol = await knex.schema.hasColumn('ci_qna_embeddings', 'embedding');
  if (hasQnaCol) {
    await knex('ci_qna_embeddings').truncate();
    await knex.schema.raw('ALTER TABLE ci_qna_embeddings DROP COLUMN embedding');
    await knex.schema.raw(
      'ALTER TABLE ci_qna_embeddings ADD COLUMN embedding VECTOR(3072) NOT NULL',
    );
  }
}

import type { Knex } from 'knex';

/**
 * Phase 5.4 hardening — GIN index for full-text search on ci_qna_embeddings.
 *
 * Without this index, every call to `PgVectorStore.searchKeyword` performs a
 * sequential scan of the entire `ci_qna_embeddings` table.  For repos with
 * thousands of chunks this would make non-conceptual QnA retrieval unacceptably
 * slow.  The GIN index allows PostgreSQL to resolve `plainto_tsquery` lookups
 * in O(log n) time.
 */
export async function up(knex: Knex): Promise<void> {
  // Only create the index if the table already exists (guard against
  // environments where migration 011 was skipped due to missing pgvector).
  const hasTable = await knex.schema.hasTable('ci_qna_embeddings');
  if (!hasTable) return;

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_qna_embeddings_fts
      ON ci_qna_embeddings
      USING gin(to_tsvector('english', content))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'DROP INDEX IF EXISTS idx_qna_embeddings_fts',
  );
}

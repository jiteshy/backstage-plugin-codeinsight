import type { Knex } from 'knex';

/**
 * Widen ci_qna_embeddings.embedding from VECTOR(1536) to VECTOR(3072) to
 * match ci_embedding_cache and support text-embedding-3-large.
 *
 * ci_embedding_cache was widened in migration 010; this migration brings
 * ci_qna_embeddings in sync so both tables accept the same dimension.
 *
 * Any existing indexed chunks are dropped — the next ingestion run will
 * re-index from scratch.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('ci_qna_embeddings', 'embedding');
  if (!hasColumn) {
    return;
  }

  // Drop the IVFFlat index first (requires matching dimension)
  await knex.schema.raw(
    'DROP INDEX IF EXISTS idx_qna_embeddings_ivfflat',
  );

  // Truncate and recreate with wider dimension
  await knex('ci_qna_embeddings').truncate();
  await knex.schema.raw('ALTER TABLE ci_qna_embeddings DROP COLUMN embedding');
  await knex.schema.raw(
    'ALTER TABLE ci_qna_embeddings ADD COLUMN embedding VECTOR(3072) NOT NULL',
  );

  // Both IVFFlat and HNSW cap at 2000 dimensions in this pgvector version.
  // Sequential scan is used for cosine similarity — acceptable for dev-scale repos.
  // TODO: switch to halfvec type (pgvector 0.7+) when an ANN index is needed.
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('ci_qna_embeddings', 'embedding');
  if (!hasColumn) {
    return;
  }

  await knex.schema.raw('DROP INDEX IF EXISTS idx_qna_embeddings_hnsw');
  await knex('ci_qna_embeddings').truncate();
  await knex.schema.raw('ALTER TABLE ci_qna_embeddings DROP COLUMN embedding');
  await knex.schema.raw(
    'ALTER TABLE ci_qna_embeddings ADD COLUMN embedding VECTOR(1536) NOT NULL',
  );
  await knex.schema.raw(
    'CREATE INDEX idx_qna_embeddings_ivfflat ON ci_qna_embeddings USING ivfflat (embedding vector_cosine_ops)',
  );
}

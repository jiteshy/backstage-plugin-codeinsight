import type { Logger } from '@codeinsight/types';
import type { Knex } from 'knex';

const EMBEDDING_TABLES = ['ci_embedding_cache', 'ci_qna_embeddings'] as const;

/**
 * Ensure the `embedding` column dimension in both vector tables matches
 * the dimension derived from the configured embedding model.
 *
 * Called at plugin startup after migrations run. If the dimension has
 * changed (e.g. operator switched from text-embedding-3-small to
 * text-embedding-3-large), both tables are truncated and the column is
 * re-created with the correct dimension. Re-indexing all repos via
 * "Sync Changes" is required after a dimension change.
 *
 * This is a no-op when the column already has the correct dimension.
 */
export async function syncEmbeddingDimension(
  knex: Knex,
  expectedDimension: number,
  logger: Logger,
): Promise<void> {
  for (const table of EMBEDDING_TABLES) {
    const hasCol = await knex.schema.hasColumn(table, 'embedding');
    if (!hasCol) {
      // pgvector not available or table not yet migrated — skip silently.
      continue;
    }

    // Read the current column type (e.g. "vector(1536)") via pg_attribute.
    const result = await knex.raw<{ rows: Array<{ col_type: string }> }>(
      `SELECT format_type(atttypid, atttypmod) AS col_type
       FROM pg_attribute
       WHERE attrelid = ?::regclass
         AND attname = 'embedding'
         AND attnum > 0`,
      [table],
    );

    const colType = result.rows[0]?.col_type ?? '';
    const match = colType.match(/vector\((\d+)\)/);
    const currentDimension = match ? parseInt(match[1], 10) : null;

    if (currentDimension === expectedDimension) {
      logger.debug(`syncEmbeddingDimension: ${table} already at ${expectedDimension} dims — no change`);
      continue;
    }

    logger.warn(
      `syncEmbeddingDimension: ${table}.embedding is ${currentDimension ?? 'unknown'} dims, ` +
      `expected ${expectedDimension}. Truncating table and updating column — ` +
      `all existing embeddings will be re-indexed on next sync.`,
    );

    await knex(table).truncate();
    await knex.schema.raw(`ALTER TABLE ${table} DROP COLUMN embedding`);
    await knex.schema.raw(
      `ALTER TABLE ${table} ADD COLUMN embedding VECTOR(${expectedDimension}) NOT NULL`,
    );

    logger.info(`syncEmbeddingDimension: ${table}.embedding updated to ${expectedDimension} dims`);
  }
}

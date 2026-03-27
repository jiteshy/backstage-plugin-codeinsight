import type { Logger } from '@codeinsight/types';
import type { Knex } from 'knex';

const EMBEDDING_TABLES = ['ci_embedding_cache', 'ci_qna_embeddings'] as const;

/**
 * Ensure the `embedding` column dimension in both vector tables matches
 * the dimension derived from the configured embedding model, and that
 * `ci_qna_embeddings` does not contain vectors from a different model.
 *
 * Called at plugin startup after migrations run. Two checks are performed:
 *
 * 1. **Dimension check** (both tables): if the stored `VECTOR(n)` dimension
 *    differs from `expectedDimension`, the table is truncated and the column
 *    is re-created with the correct dimension.
 *
 * 2. **Model-name check** (`ci_qna_embeddings` only): if the table has rows
 *    produced by a different model (e.g. ada-002 vs text-embedding-3-small,
 *    both 1536 dims), the table is truncated so vectors are rebuilt on the
 *    next "Sync Changes". `ci_embedding_cache` is skipped here because its
 *    composite PK already segregates entries per model.
 *
 * This is a no-op when dimension and model both already match.
 */
export async function syncEmbeddingDimension(
  knex: Knex,
  expectedDimension: number,
  expectedModel: string,
  logger: Logger,
): Promise<void> {
  for (const table of EMBEDDING_TABLES) {
    const hasCol = await knex.schema.hasColumn(table, 'embedding');
    if (!hasCol) {
      // pgvector not available or table not yet migrated — skip silently.
      continue;
    }

    // --- Check 1: dimension ---

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

    if (currentDimension !== expectedDimension) {
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
      // Dimension fix already truncated — skip the model check for this table.
      continue;
    }

    logger.debug(`syncEmbeddingDimension: ${table} already at ${expectedDimension} dims — no change`);

    // --- Check 2: model name (ci_qna_embeddings only) ---
    // ci_embedding_cache already segregates by model via its composite PK (content_sha, model_used).

    if (table !== 'ci_qna_embeddings') continue;

    const hasModelCol = await knex.schema.hasColumn(table, 'model_used');
    if (!hasModelCol) {
      // Migration 018 not yet applied — skip silently.
      continue;
    }

    // Find any row with a non-empty model_used to compare against expected.
    const existingModelRow = await knex(table)
      .select('model_used')
      .whereNot('model_used', '')
      .first<{ model_used: string } | undefined>();

    if (!existingModelRow) {
      // Table is empty or all rows have empty model_used (pre-migration-018 rows).
      // Truncate so they're rebuilt with model_used populated on next sync.
      const countResult = await knex(table).count('* as cnt').first<{ cnt: string | number }>();
      const count = typeof countResult?.cnt === 'string'
        ? parseInt(countResult.cnt, 10)
        : (countResult?.cnt ?? 0);
      if (count > 0) {
        logger.warn(
          `syncEmbeddingDimension: ${table} has ${count} rows with unknown model_used. ` +
          `Truncating so vectors are rebuilt with model="${expectedModel}" on next sync.`,
        );
        await knex(table).truncate();
      }
      continue;
    }

    if (existingModelRow.model_used !== expectedModel) {
      logger.warn(
        `syncEmbeddingDimension: ${table}.model_used is "${existingModelRow.model_used}", ` +
        `expected "${expectedModel}". Truncating table — ` +
        `all existing embeddings will be re-indexed on next sync.`,
      );
      await knex(table).truncate();
      logger.info(`syncEmbeddingDimension: ${table} truncated for model switch to "${expectedModel}"`);
    } else {
      logger.debug(`syncEmbeddingDimension: ${table} model already "${expectedModel}" — no change`);
    }
  }
}

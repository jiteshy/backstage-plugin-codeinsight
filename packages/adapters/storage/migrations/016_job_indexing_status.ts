import type { Knex } from 'knex';

/**
 * Add indexing_status / indexing_error columns to ci_ingestion_jobs.
 *
 * These track the outcome of the non-fatal QnA indexing step separately
 * from the main ingestion status, so a failed embed pass doesn't pollute
 * error_message (which is reserved for fatal pipeline failures).
 *
 * Values for indexing_status: 'completed' | 'failed' | 'skipped'
 *   - 'skipped'  — no IndexingService configured (no embedding config)
 *   - 'completed' — all chunks embedded successfully
 *   - 'failed'   — embedding API error; indexing_error holds the message
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_ingestion_jobs', table => {
    table.text('indexing_status').nullable();
    table.text('indexing_error').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ci_ingestion_jobs', table => {
    table.dropColumn('indexing_status');
    table.dropColumn('indexing_error');
  });
}

import type { Knex } from 'knex';

/**
 * Stores thumbs up/down ratings for generated artifacts (docs, diagrams, Q&A answers).
 *
 * artifact_id — matches ci_artifacts.artifact_id (or a Q&A message_id for Q&A ratings)
 * artifact_type — 'doc' | 'diagram' | 'qna'
 * rating — 1 (thumbs up) | -1 (thumbs down)
 *
 * No FK to ci_artifacts because Q&A ratings reference message IDs from ci_qna_messages,
 * not the artifact table. Referential integrity enforced at the application layer.
 *
 * No user tracking for MVP — one rating per (repo_id, artifact_id) pair (last-write-wins).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_artifact_feedback', table => {
    table.text('repo_id').notNullable();
    table.text('artifact_id').notNullable();
    table.text('artifact_type').notNullable(); // 'doc' | 'diagram' | 'qna'
    table.integer('rating').notNullable();     // 1 | -1
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['repo_id', 'artifact_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('ci_artifact_feedback');
}

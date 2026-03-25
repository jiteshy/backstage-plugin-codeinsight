import type { Knex } from 'knex';

/**
 * Phase 5 — QnA tables:
 *   ci_qna_embeddings  — per-chunk vector embeddings (pgvector)
 *   ci_qna_sessions    — conversation sessions
 *   ci_qna_messages    — per-turn messages within a session
 */
export async function up(knex: Knex): Promise<void> {
  // Ensure pgvector is available (required for ci_qna_embeddings)
  try {
    await knex.schema.raw('CREATE EXTENSION IF NOT EXISTS vector');
  } catch {
    // pgvector not installed — ci_qna_embeddings will be created without the VECTOR column
    // and will need to be manually migrated once pgvector is available.
  }

  const hasPgvector = await knex.schema
    .raw("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
    .then((res: { rows?: unknown[] }) => (res.rows?.length ?? 0) > 0)
    .catch(() => false);

  // ci_qna_embeddings
  await knex.schema.createTable('ci_qna_embeddings', table => {
    table.text('repo_id').notNullable();
    table.text('chunk_id').notNullable();
    table.text('content').notNullable();
    table.text('content_sha').notNullable();
    table.text('layer').notNullable(); // code | doc | diagram
    table.jsonb('metadata');
    table.primary(['repo_id', 'chunk_id']);
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  if (hasPgvector) {
    // VECTOR column added separately (Knex has no native pgvector type)
    await knex.schema.raw(
      'ALTER TABLE ci_qna_embeddings ADD COLUMN embedding VECTOR(3072) NOT NULL',
    );
    await knex.schema.raw(
      'CREATE INDEX idx_qna_embeddings_ivfflat ON ci_qna_embeddings USING ivfflat (embedding vector_cosine_ops)',
    );
  }

  // ci_qna_sessions
  await knex.schema.createTable('ci_qna_sessions', table => {
    table.uuid('session_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('repo_id').notNullable();
    table.text('user_ref');
    table.jsonb('active_context');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_active', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  // ci_qna_messages
  await knex.schema.createTable('ci_qna_messages', table => {
    table.uuid('message_id').notNullable().defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('session_id').notNullable();
    table.text('role').notNullable(); // user | assistant
    table.text('content').notNullable();
    table.jsonb('sources');
    table.integer('tokens_used').defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table
      .foreign('session_id')
      .references('session_id')
      .inTable('ci_qna_sessions')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_qna_messages');
  await knex.schema.dropTableIfExists('ci_qna_sessions');
  await knex.schema.dropTableIfExists('ci_qna_embeddings');
}

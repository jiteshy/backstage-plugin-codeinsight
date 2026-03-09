import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_llm_cache', table => {
    table.text('cache_key').notNullable().primary(); // SHA256(prompt_version + input_sha + model_name)
    table.text('response').notNullable();
    table.integer('tokens_used').notNullable();
    table.text('model_used').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Attempt to enable pgvector — optional until Phase 4.
  // If the extension is not installed, ci_embedding_cache is created without the VECTOR column.
  // Phase 4 migration note: use ALTER TABLE ci_embedding_cache ADD COLUMN IF NOT EXISTS embedding VECTOR(1536) NOT NULL
  // to handle both code paths (column may already exist if pgvector was available at Phase 1.3 install time).
  let pgvectorAvailable = false;
  try {
    await knex.schema.raw('CREATE EXTENSION IF NOT EXISTS vector');
    pgvectorAvailable = true;
  } catch {
    // pgvector not installed — skip embedding cache VECTOR column
  }

  if (pgvectorAvailable) {
    await knex.schema.createTable('ci_embedding_cache', table => {
      table.text('content_sha').notNullable().primary(); // SHA256(chunk_text)
      table.text('model_used').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    // Add VECTOR column separately (Knex doesn't natively support pgvector type)
    await knex.schema.raw(
      'ALTER TABLE ci_embedding_cache ADD COLUMN embedding VECTOR(1536) NOT NULL',
    );
  } else {
    // Create a minimal placeholder table without the VECTOR column.
    // Phase 4 will ALTER TABLE to add the embedding column once pgvector is available.
    await knex.schema.createTable('ci_embedding_cache', table => {
      table.text('content_sha').notNullable().primary();
      table.text('model_used').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_embedding_cache');
  await knex.schema.dropTableIfExists('ci_llm_cache');
}

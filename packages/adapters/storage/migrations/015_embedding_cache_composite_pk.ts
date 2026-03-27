import type { Knex } from 'knex';

/**
 * Fix ci_embedding_cache primary key to composite (content_sha, model_used).
 *
 * The previous PK was (content_sha) only. This caused silent cache write
 * failures when switching models: a new model's embedding for text already
 * cached by a different model would be silently ignored by
 * ON CONFLICT (content_sha) DO NOTHING, making the cache permanently miss
 * for the new model.
 *
 * With a composite PK each (text, model) pair is stored independently.
 */
export async function up(knex: Knex): Promise<void> {
  // Truncate first — dimension may have changed alongside the model switch.
  await knex('ci_embedding_cache').truncate();

  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache DROP CONSTRAINT ci_embedding_cache_pkey',
  );
  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache ADD PRIMARY KEY (content_sha, model_used)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex('ci_embedding_cache').truncate();
  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache DROP CONSTRAINT ci_embedding_cache_pkey',
  );
  await knex.schema.raw(
    'ALTER TABLE ci_embedding_cache ADD PRIMARY KEY (content_sha)',
  );
}

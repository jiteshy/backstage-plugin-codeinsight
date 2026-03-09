import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_artifacts', table => {
    table.text('repo_id').notNullable();
    table.text('artifact_id').notNullable(); // "core/overview" | "er-diagram" | "qna/chunk:loginUser"
    table.text('artifact_type').notNullable(); // doc | diagram | qna_chunk
    table.jsonb('content').nullable(); // structure differs per type
    table.text('input_sha').notNullable(); // composite SHA of all input files
    table.text('prompt_version').nullable(); // null for pure AST artifacts
    table.boolean('is_stale').notNullable().defaultTo(false);
    table.text('stale_reason').nullable(); // file_changed | prompt_updated | dependency_stale
    table.integer('tokens_used').defaultTo(0);
    table.boolean('llm_used').notNullable().defaultTo(false);
    table.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['repo_id', 'artifact_id']);
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  // Partial index for stale artifacts (fast sweep queries)
  await knex.schema.raw(
    'CREATE INDEX idx_artifacts_stale ON ci_artifacts(repo_id, is_stale) WHERE is_stale = true',
  );

  await knex.schema.createTable('ci_artifact_inputs', table => {
    table.text('repo_id').notNullable();
    table.text('artifact_id').notNullable();
    table.text('file_path').notNullable();
    table.text('file_sha').notNullable(); // SHA of this file when artifact was generated

    table.primary(['repo_id', 'artifact_id', 'file_path']);
    table
      .foreign(['repo_id', 'artifact_id'])
      .references(['repo_id', 'artifact_id'])
      .inTable('ci_artifacts')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_artifact_inputs_file ON ci_artifact_inputs(repo_id, file_path)',
  );

  await knex.schema.createTable('ci_artifact_dependencies', table => {
    table.text('repo_id').notNullable();
    table.text('dependent_id').notNullable(); // artifact_id that depends on another
    table.text('dependency_id').notNullable(); // artifact_id being depended on
    table.text('dep_type').notNullable().defaultTo('content'); // content | structural

    table.primary(['repo_id', 'dependent_id', 'dependency_id']);
    table
      .foreign(['repo_id', 'dependent_id'])
      .references(['repo_id', 'artifact_id'])
      .inTable('ci_artifacts')
      .onDelete('CASCADE');
    table
      .foreign(['repo_id', 'dependency_id'])
      .references(['repo_id', 'artifact_id'])
      .inTable('ci_artifacts')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_artifact_dependencies');
  await knex.schema.dropTableIfExists('ci_artifact_inputs');
  await knex.schema.dropTableIfExists('ci_artifacts');
}

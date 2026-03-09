import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_repo_files', table => {
    table.text('repo_id').notNullable();
    table.text('file_path').notNullable();
    table.text('current_sha').notNullable();
    table.text('last_processed_sha').nullable();
    table.text('file_type').notNullable(); // source | config | schema | infra | ci | test
    table.text('language').nullable();
    table.text('parse_status').notNullable().defaultTo('pending'); // pending | parsed | skipped | error

    table.primary(['repo_id', 'file_path']);
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_repo_files_repo ON ci_repo_files(repo_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_repo_files');
}

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_repositories', table => {
    table.text('repo_id').notNullable().primary();
    table.text('name').notNullable();
    table.text('url').notNullable();
    table.text('provider').notNullable(); // github | gitlab | bitbucket
    table.text('status').notNullable().defaultTo('idle'); // idle | processing | ready | error
    table.text('last_commit_sha').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_repositories');
}

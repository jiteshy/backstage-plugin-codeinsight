import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_ingestion_jobs', table => {
    table
      .uuid('job_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'))
      .primary();
    table.text('repo_id').notNullable();
    table.text('trigger').notNullable(); // manual | webhook | schedule
    table.text('status').notNullable().defaultTo('queued'); // queued | running | completed | failed | partial
    table.text('from_commit').nullable();
    table.text('to_commit').nullable();
    table.specificType('changed_files', 'TEXT[]').nullable();
    table.specificType('artifacts_stale', 'TEXT[]').nullable();
    table.integer('files_processed').defaultTo(0);
    table.integer('files_skipped').defaultTo(0);
    table.integer('tokens_consumed').defaultTo(0);
    table.text('error_message').nullable();
    table.timestamp('started_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_jobs_repo_status ON ci_ingestion_jobs(repo_id, status)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_ingestion_jobs');
}

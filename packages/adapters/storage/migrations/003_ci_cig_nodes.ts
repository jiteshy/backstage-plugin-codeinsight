import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_cig_nodes', table => {
    table
      .uuid('node_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'))
      .primary();
    table.text('repo_id').notNullable();
    table.text('file_path').notNullable();
    table.text('symbol_name').notNullable();
    table.text('symbol_type').notNullable(); // function | class | interface | variable | type | enum | route | schema
    table.integer('start_line').notNullable();
    table.integer('end_line').notNullable();
    table.boolean('exported').notNullable().defaultTo(false);
    table.text('extracted_sha').notNullable(); // file SHA at extraction time
    table.jsonb('metadata').nullable();

    table.unique(['repo_id', 'file_path', 'symbol_name', 'symbol_type']);
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_cig_nodes_file ON ci_cig_nodes(repo_id, file_path)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_cig_nodes');
}

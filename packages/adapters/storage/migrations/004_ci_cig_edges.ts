import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_cig_edges', table => {
    table
      .uuid('edge_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'))
      .primary();
    table.text('repo_id').notNullable();
    table.uuid('from_node_id').notNullable();
    table.uuid('to_node_id').notNullable();
    table.text('edge_type').notNullable(); // calls | imports | extends | implements

    table
      .foreign('from_node_id')
      .references('node_id')
      .inTable('ci_cig_nodes')
      .onDelete('CASCADE');
    table
      .foreign('to_node_id')
      .references('node_id')
      .inTable('ci_cig_nodes')
      .onDelete('CASCADE');
    table
      .foreign('repo_id')
      .references('repo_id')
      .inTable('ci_repositories')
      .onDelete('CASCADE');
  });

  await knex.schema.raw(
    'CREATE INDEX idx_cig_edges_from ON ci_cig_edges(from_node_id)',
  );
  await knex.schema.raw(
    'CREATE INDEX idx_cig_edges_to ON ci_cig_edges(to_node_id)',
  );
  await knex.schema.raw(
    'CREATE INDEX idx_cig_edges_repo ON ci_cig_edges(repo_id)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ci_cig_edges');
}

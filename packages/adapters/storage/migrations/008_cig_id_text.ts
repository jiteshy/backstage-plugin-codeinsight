import type { Knex } from 'knex';

/**
 * Migration 008: Change ci_cig_nodes.node_id and ci_cig_edges.edge_id /
 * from_node_id / to_node_id from UUID to TEXT.
 *
 * The CIG builder generates deterministic composite IDs of the form
 * `{repoId}:{filePath}:{symbolName}:{symbolType}` — these are natural unique
 * keys, not random UUIDs, so the column type must be TEXT.
 */

export async function up(knex: Knex): Promise<void> {
  // Drop FK constraints on edges before altering referenced column
  await knex.schema.alterTable('ci_cig_edges', table => {
    table.dropForeign(['from_node_id']);
    table.dropForeign(['to_node_id']);
  });

  // Alter ci_cig_nodes.node_id UUID → text
  await knex.raw('ALTER TABLE ci_cig_nodes ALTER COLUMN node_id TYPE text USING node_id::text');

  // Alter ci_cig_edges.edge_id and FK columns UUID → text
  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN edge_id TYPE text USING edge_id::text');
  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN from_node_id TYPE text USING from_node_id::text');
  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN to_node_id TYPE text USING to_node_id::text');

  // Re-add FK constraints now that types match
  await knex.schema.alterTable('ci_cig_edges', table => {
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
  });
}

export async function down(knex: Knex): Promise<void> {
  // Reverting: this is a destructive migration in reverse (UUID is stricter).
  // Drop FKs, cast back to uuid, re-add FKs.
  await knex.schema.alterTable('ci_cig_edges', table => {
    table.dropForeign(['from_node_id']);
    table.dropForeign(['to_node_id']);
  });

  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN from_node_id TYPE uuid USING from_node_id::uuid');
  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN to_node_id TYPE uuid USING to_node_id::uuid');
  await knex.raw('ALTER TABLE ci_cig_edges ALTER COLUMN edge_id TYPE uuid USING edge_id::uuid');
  await knex.raw('ALTER TABLE ci_cig_nodes ALTER COLUMN node_id TYPE uuid USING node_id::uuid');

  await knex.schema.alterTable('ci_cig_edges', table => {
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
  });
}

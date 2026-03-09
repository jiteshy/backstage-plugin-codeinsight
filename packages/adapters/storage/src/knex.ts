import type { DatabaseConfig } from '@codeinsight/types';
import Knex from 'knex';

export function createKnex(config: DatabaseConfig): Knex.Knex {
  return Knex({
    client: config.client,
    connection: config.connection,
    pool: {
      min: 2,
      max: 10,
    },
  });
}

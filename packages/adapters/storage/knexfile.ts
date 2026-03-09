import type { Knex } from 'knex';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5433,
      database: process.env.PGDATABASE || 'codeinsight',
      user: process.env.PGUSER || 'codeinsight',
      password: process.env.PGPASSWORD || 'codeinsight',
    },
    migrations: {
      directory: './migrations',
      extension: 'ts',
      tableName: 'ci_knex_migrations',
    },
  },

  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5433,
      database: process.env.PGDATABASE || 'codeinsight_test',
      user: process.env.PGUSER || 'codeinsight',
      password: process.env.PGPASSWORD || 'codeinsight',
    },
    migrations: {
      directory: './migrations',
      extension: 'ts',
      tableName: 'ci_knex_migrations',
    },
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './migrations',
      extension: 'ts',
      tableName: 'ci_knex_migrations',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};

export default config;

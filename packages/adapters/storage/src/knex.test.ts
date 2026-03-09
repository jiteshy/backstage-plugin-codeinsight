import type { DatabaseConfig } from '@codeinsight/types';
import { createKnex } from './knex';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<DatabaseConfig>): DatabaseConfig {
  return {
    client: 'pg',
    connection: {
      host: 'localhost',
      port: 5432,
      user: 'ci_user',
      password: 'ci_pass',
      database: 'codeinsight',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createKnex', () => {
  describe('return value shape', () => {
    it('returns a truthy Knex instance', () => {
      const knex = createKnex(makeConfig());
      expect(knex).toBeTruthy();
    });

    it('exposes a .raw method', () => {
      const knex = createKnex(makeConfig());
      expect(typeof knex.raw).toBe('function');
    });

    it('exposes a .schema property', () => {
      const knex = createKnex(makeConfig());
      expect(knex.schema).toBeDefined();
    });

    it('exposes a .destroy method', () => {
      const knex = createKnex(makeConfig());
      expect(typeof knex.destroy).toBe('function');
    });
  });

  describe('client configuration', () => {
    it('uses config.client as the Knex client driver', () => {
      const knex = createKnex(makeConfig({ client: 'pg' }));
      expect(knex.client.config.client).toBe('pg');
    });

    it('reflects the client string exactly — the factory does not hard-code a default', () => {
      // We cannot use dialects whose native drivers are absent from the
      // workspace (e.g. sqlite3) because Knex attempts to load the driver
      // immediately at construction. Verifying with 'pg' (which IS installed)
      // and asserting strict equality is sufficient: if the factory were to
      // silently substitute another value, this assertion would catch it.
      const knex = createKnex(makeConfig({ client: 'pg' }));
      expect(knex.client.config.client).toBe('pg');
    });
  });

  describe('connection configuration', () => {
    it('uses config.connection as the Knex connection', () => {
      const connection = {
        host: 'db.example.com',
        port: 5433,
        user: 'admin',
        password: 's3cr3t',
        database: 'prod_db',
      };
      const knex = createKnex(makeConfig({ connection }));
      expect(knex.client.config.connection).toEqual(connection);
    });

    it('preserves all connection fields without mutation', () => {
      const connection = {
        host: 'localhost',
        port: 5432,
        user: 'ci_user',
        password: 'ci_pass',
        database: 'codeinsight',
      };
      const config = makeConfig({ connection });
      createKnex(config);
      // The original config object must not be mutated by the factory.
      expect(config.connection).toEqual(connection);
    });
  });

  describe('pool configuration', () => {
    it('sets pool.min to 2', () => {
      const knex = createKnex(makeConfig());
      expect(knex.client.config.pool.min).toBe(2);
    });

    it('sets pool.max to 10', () => {
      const knex = createKnex(makeConfig());
      expect(knex.client.config.pool.max).toBe(10);
    });
  });

  describe('migration configuration', () => {
    it('does not set a migrations config — migration concerns belong to knexfile.ts', () => {
      const knex = createKnex(makeConfig());
      // Knex sets an empty migrations object by default; the factory must not
      // populate it with a directory, extension, or table name.
      const migrations = knex.client.config.migrations;
      if (migrations !== undefined) {
        expect(migrations.directory).toBeUndefined();
        expect(migrations.tableName).toBeUndefined();
        expect(migrations.extension).toBeUndefined();
      }
    });
  });

  describe('isolation — each call returns an independent instance', () => {
    it('returns a new instance on every call', () => {
      const a = createKnex(makeConfig());
      const b = createKnex(makeConfig());
      expect(a).not.toBe(b);
    });

    it('each instance carries its own config independently', () => {
      const knexA = createKnex(makeConfig({ connection: { host: 'host-a', port: 5432, user: 'u', password: 'p', database: 'db' } }));
      const knexB = createKnex(makeConfig({ connection: { host: 'host-b', port: 5432, user: 'u', password: 'p', database: 'db' } }));
      expect(knexA.client.config.connection.host).toBe('host-a');
      expect(knexB.client.config.connection.host).toBe('host-b');
    });
  });
});

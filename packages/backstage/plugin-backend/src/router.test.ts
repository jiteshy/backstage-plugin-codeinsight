import http from 'http';

import express from 'express';

import { createRouter, RouterOptions } from './router';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock that satisfies LoggerService from @backstage/backend-plugin-api */
function mockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

/** Minimal mock that satisfies RootConfigService */
function mockConfig() {
  return {
    getOptionalString: jest.fn(),
    getString: jest.fn(),
    getOptionalNumber: jest.fn(),
    getNumber: jest.fn(),
    getOptionalBoolean: jest.fn(),
    getBoolean: jest.fn(),
    getOptionalConfig: jest.fn(),
    getConfig: jest.fn(),
    getOptionalConfigArray: jest.fn(),
    getConfigArray: jest.fn(),
    getOptionalStringArray: jest.fn(),
    getStringArray: jest.fn(),
    has: jest.fn(),
    keys: jest.fn(),
  };
}

/** Minimal mock that satisfies DatabaseService */
function mockDatabase() {
  return {
    getClient: jest.fn(),
  };
}

/** Make an HTTP request against a running express app and return status + body */
function request(
  server: http.Server,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server not listening on a port'));
    }

    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRouter', () => {
  let server: http.Server;
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(async () => {
    logger = mockLogger();

    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: logger as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
    };

    const router = await createRouter(options);
    const app = express();
    app.use(router);
    server = app.listen(0); // random available port
  });

  afterEach(done => {
    server.close(done);
  });

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await request(server, 'GET', '/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('calls logger.debug with health check message', async () => {
      await request(server, 'GET', '/health');

      expect(logger.debug).toHaveBeenCalledWith('Health check');
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for an undefined route', async () => {
      const res = await request(server, 'GET', '/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  it('returns an express Router (function)', async () => {
    const options: RouterOptions = {
      config: mockConfig() as unknown as RouterOptions['config'],
      logger: mockLogger() as unknown as RouterOptions['logger'],
      database: mockDatabase() as unknown as RouterOptions['database'],
    };

    const router = await createRouter(options);
    // Express routers are functions with handle/use/route properties
    expect(typeof router).toBe('function');
  });
});

import {
  DatabaseService,
  LoggerService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';

export interface RouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  database: DatabaseService;
}

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger } = options;
  const router = Router();

  router.get('/health', (_req, res) => {
    logger.debug('Health check');
    res.json({ status: 'ok' });
  });

  // Ingestion, job status, and repo status routes will be added in Phase 1.9

  return router;
}

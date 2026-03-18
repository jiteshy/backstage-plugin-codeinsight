import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { IngestionService } from '@codeinsight/ingestion';
import { GitRepoConnector } from '@codeinsight/repo';
import { KnexStorageAdapter } from '@codeinsight/storage';
import type { IngestionConfig, Logger, RepoCloneConfig } from '@codeinsight/types';

import { createRouter } from './router';

export const codeinsightPlugin = createBackendPlugin({
  pluginId: 'codeinsight',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
      },
      async init({ config, logger, database, httpRouter }) {
        logger.info('Initializing CodeInsight backend plugin');

        // ------------------------------------------------------------------
        // 1.9.1 — Composition root: wire adapters and core services
        // ------------------------------------------------------------------

        // Storage adapter — backed by Backstage's managed database
        const knex = await database.getClient();
        const storageAdapter = new KnexStorageAdapter(knex);

        // Adapt Backstage's LoggerService to our framework-agnostic Logger interface.
        // Backstage uses JsonObject for meta; we use Record<string, unknown> — structurally
        // compatible at runtime, so the cast is safe in this composition root.
        const coreLogger: Logger = {
          debug: (msg, meta) => logger.debug(msg, meta as never),
          info: (msg, meta) => logger.info(msg, meta as never),
          warn: (msg, meta) => logger.warn(msg, meta as never),
          error: (msg, meta) => logger.error(msg, meta as never),
        };

        // Repo connector config — sourced from Backstage app-config.yaml
        const tempDir =
          config.getOptionalString('codeinsight.cloneTempDir') ?? '/tmp/codeinsight';

        const repoCloneConfig: RepoCloneConfig = {
          tempDir,
          cloneTtlHours: config.getOptionalNumber('codeinsight.cloneTtlHours') ?? 24,
          defaultDepth: 1,
          deltaDepth: 50,
          authToken: config.getOptionalString('codeinsight.githubToken') ?? undefined,
        };

        const repoConnector = new GitRepoConnector(repoCloneConfig, coreLogger);

        // Ingestion service config
        const ingestionConfig: IngestionConfig = {
          tempDir,
          deltaThreshold:
            config.getOptionalNumber('codeinsight.ingestion.deltaThreshold') ?? 0.4,
          maxConcurrentJobs:
            config.getOptionalNumber('codeinsight.ingestion.maxConcurrentJobs') ?? 2,
          jobTimeoutMinutes:
            config.getOptionalNumber('codeinsight.ingestion.jobTimeoutMinutes') ?? 30,
          cloneDepth:
            config.getOptionalNumber('codeinsight.ingestion.cloneDepth') ?? 1,
          deltaCloneDepth:
            config.getOptionalNumber('codeinsight.ingestion.deltaCloneDepth') ?? 50,
          cleanupAfterIngestion:
            config.getOptionalBoolean('codeinsight.ingestion.cleanupAfterIngestion') ?? true,
        };

        const ingestionService = new IngestionService(
          repoConnector,
          storageAdapter,
          coreLogger,
          ingestionConfig,
        );

        // ------------------------------------------------------------------
        // Mount router
        // ------------------------------------------------------------------

        const router = await createRouter({
          config,
          logger,
          database,
          ingestionService,
          storageAdapter,
        });
        httpRouter.use(router);

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        logger.info('CodeInsight backend plugin initialized');
      },
    });
  },
});

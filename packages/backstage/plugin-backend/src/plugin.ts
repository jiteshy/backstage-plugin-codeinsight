import path from 'path';

import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { DiagramGenerationService } from '@codeinsight/diagram-gen';
import type { DiagramGenConfig } from '@codeinsight/diagram-gen';
import { DocGenerationService } from '@codeinsight/doc-generator';
import type { DocGenConfig } from '@codeinsight/doc-generator';
import { createEmbeddingClient, deriveEmbeddingDimension } from '@codeinsight/embeddings';
import { IndexingService } from '@codeinsight/indexing';
import type { IndexingConfig } from '@codeinsight/indexing';
import { InProcessJobQueue, IngestionService } from '@codeinsight/ingestion';
import { createLLMClient } from '@codeinsight/llm';
import { QnAService } from '@codeinsight/qna';
import { GitRepoConnector } from '@codeinsight/repo';
import { KnexStorageAdapter } from '@codeinsight/storage';
import type { EmbeddingConfig, IngestionConfig, LLMConfig, Logger, QnAConfig, RepoCloneConfig } from '@codeinsight/types';
import { PgVectorStore, syncEmbeddingDimension } from '@codeinsight/vector-store';

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

        // Run migrations automatically so the plugin is self-contained.
        // The migrations directory is resolved relative to this file's location.
        const migrationsDir = path.resolve(
          __dirname,
          '../../../adapters/storage/migrations',
        );
        await knex.migrate.latest({
          directory: migrationsDir,
          loadExtensions: ['.js', '.ts'],
          tableName: 'ci_knex_migrations',
        });

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

        // LLM client — optional; only instantiated when llm config is present
        const llmProvider = config.getOptionalString('codeinsight.llm.provider');
        const llmApiKey = config.getOptionalString('codeinsight.llm.apiKey');
        const llmModel = config.getOptionalString('codeinsight.llm.model');

        const llmConfig: LLMConfig | undefined =
          llmProvider && llmApiKey && llmModel
            ? {
                provider: llmProvider as LLMConfig['provider'],
                apiKey: llmApiKey,
                model: llmModel,
              }
            : undefined;

        // llmClient will be undefined if no LLM config is set; Phase 2 services
        // that require it will check and surface a clear error at call time.
        const llmClient = llmConfig
          ? createLLMClient(llmConfig, coreLogger, knex)
          : undefined;

        if (llmConfig && llmClient) {
          coreLogger.info('LLM client initialized', {
            provider: llmConfig.provider,
            model: llmConfig.model,
          });
        } else {
          coreLogger.info(
            'No LLM config found — doc/diagram generation will be unavailable',
          );
        }

        // Embedding client — optional; only instantiated when embedding config is present
        const embeddingProvider = config.getOptionalString('codeinsight.embeddings.provider');
        const embeddingApiKey = config.getOptionalString('codeinsight.embeddings.apiKey');

        const embeddingConfig: EmbeddingConfig | undefined =
          embeddingProvider && embeddingApiKey
            ? {
                provider: embeddingProvider as EmbeddingConfig['provider'],
                apiKey: embeddingApiKey,
                model: config.getOptionalString('codeinsight.embeddings.model') ?? undefined,
                dimensions: config.getOptionalNumber('codeinsight.embeddings.dimensions') ?? undefined,
              }
            : undefined;

        // Sync vector column dimensions to match the configured model.
        // Runs after migrations so the tables exist. If the model changed
        // since last startup, both embedding tables are truncated and the
        // column is re-created with the correct dimension — re-indexing
        // all repos via "Sync Changes" will be required.
        if (embeddingConfig) {
          const expectedDimension = deriveEmbeddingDimension(embeddingConfig);
          const expectedModel = embeddingConfig.model ?? 'text-embedding-3-small';
          await syncEmbeddingDimension(knex, expectedDimension, expectedModel, coreLogger);
          coreLogger.info('Embedding dimension verified', { dimension: expectedDimension, model: expectedModel });
        }

        const embeddingClient = embeddingConfig
          ? createEmbeddingClient(embeddingConfig, coreLogger, knex)
          : undefined;

        if (embeddingConfig && embeddingClient) {
          coreLogger.info('Embedding client initialized', {
            provider: embeddingConfig.provider,
            model: embeddingConfig.model ?? 'text-embedding-3-small',
          });
        } else {
          coreLogger.info(
            'No embedding config found — QnA features will be unavailable',
          );
        }

        // Doc generation service — optional; only instantiated when llmClient is present
        const docGenConfig: DocGenConfig = {
          maxConcurrency:
            config.getOptionalNumber('codeinsight.docGen.maxConcurrency') ?? 20,
          maxOutputTokens:
            config.getOptionalNumber('codeinsight.docGen.maxOutputTokens') ?? 2000,
          temperature:
            config.getOptionalNumber('codeinsight.docGen.temperature') ?? 0.2,
          // Pass model name so that changing the LLM forces artifact regeneration on next sync.
          modelName: llmModel ?? undefined,
        };

        const docGenerationService = llmClient
          ? new DocGenerationService(storageAdapter, llmClient, coreLogger, docGenConfig)
          : undefined;

        // Diagram generation service — optional; works without LLM (pure AST diagrams)
        const diagramGenConfig: DiagramGenConfig = {
          maxConcurrency:
            config.getOptionalNumber('codeinsight.diagramGen.maxConcurrency') ?? 10,
          maxOutputTokens:
            config.getOptionalNumber('codeinsight.diagramGen.maxOutputTokens') ?? 2000,
          temperature:
            config.getOptionalNumber('codeinsight.diagramGen.temperature') ?? 0.2,
          modelName: llmModel ?? undefined,
        };

        const diagramGenerationService = new DiagramGenerationService(
          storageAdapter,
          coreLogger,
          llmClient,
          diagramGenConfig,
        );

        // Vector store — needed by both IndexingService and QnAService
        // Pass embedding model name so upserted rows carry model_used and
        // syncEmbeddingDimension can detect same-dimension model switches.
        const embeddingModelName = embeddingConfig?.model ?? 'text-embedding-3-small';
        const vectorStore = new PgVectorStore(knex, coreLogger, embeddingModelName);

        // Indexing service — optional; only instantiated when embeddingClient is present
        const indexingConfig: IndexingConfig = {
          // Derive the effective dimension to compute the per-model token limit.
          // All current OpenAI embedding models cap at 8192 tokens; charsPerToken=3
          // gives ~24 576 chars as the safety cap before truncation.
          modelTokenLimit: 8_192,
          charsPerToken: 3,
        };
        const indexingService = embeddingClient
          ? new IndexingService(embeddingClient, vectorStore, storageAdapter, coreLogger, indexingConfig)
          : undefined;

        if (indexingService) {
          coreLogger.info('Indexing service initialized');
        } else {
          coreLogger.info(
            'Indexing service unavailable — requires embedding config',
          );
        }

        const ingestionService = new IngestionService(
          repoConnector,
          storageAdapter,
          coreLogger,
          ingestionConfig,
          undefined, // cigBuilder — use default
          undefined, // stalenessService — use default
          docGenerationService,
          diagramGenerationService,
          indexingService,
        );

        const jobQueue = new InProcessJobQueue(
          ingestionService,
          storageAdapter,
          ingestionConfig.maxConcurrentJobs,
        );

        // QnA service — requires both LLM and embedding clients

        const qnaConfig: QnAConfig = {
          maxHistoryTurns:
            config.getOptionalNumber('codeinsight.qna.maxHistoryTurns') ?? 6,
          compressAfterTurns:
            config.getOptionalNumber('codeinsight.qna.compressAfterTurns') ?? 10,
          maxContextTokens:
            config.getOptionalNumber('codeinsight.qna.maxContextTokens') ?? 8000,
          maxAnswerTokens:
            config.getOptionalNumber('codeinsight.qna.maxAnswerTokens') ?? 2000,
          temperature:
            config.getOptionalNumber('codeinsight.qna.temperature') ?? 0.3,
        };

        const qnaService =
          llmClient && embeddingClient
            ? new QnAService(
                llmClient,
                embeddingClient,
                storageAdapter,
                vectorStore,
                qnaConfig,
                coreLogger,
              )
            : undefined;

        if (qnaService) {
          coreLogger.info('QnA service initialized');
        } else {
          coreLogger.info(
            'QnA service unavailable — requires both LLM and embedding config',
          );
        }

        // ------------------------------------------------------------------
        // Mount router
        // ------------------------------------------------------------------

        const router = await createRouter({
          config,
          logger,
          database,
          storageAdapter,
          jobQueue,
          qnaService,
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

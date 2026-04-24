import path from 'path';

import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import {
  createIngestionStack,
  ensureEmbeddingDimension,
} from '@codeinsight/composition';
import type { CompositionConfig } from '@codeinsight/composition';
import type {
  EmbeddingConfig,
  LLMConfig,
  Logger,
} from '@codeinsight/types';

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
        // 1) Run migrations — resolved relative to this file's location.
        // ------------------------------------------------------------------
        const knex = await database.getClient();
        const migrationsDir = path.resolve(
          __dirname,
          '../../../adapters/storage/migrations',
        );
        await knex.migrate.latest({
          directory: migrationsDir,
          loadExtensions: ['.js', '.ts'],
          tableName: 'ci_knex_migrations',
        });

        // ------------------------------------------------------------------
        // 2) Adapt Backstage's LoggerService to our framework-agnostic Logger.
        //    Backstage uses JsonObject for meta; we use Record<string, unknown>
        //    — structurally compatible at runtime, so the cast is safe here.
        // ------------------------------------------------------------------
        const coreLogger: Logger = {
          debug: (msg, meta) => logger.debug(msg, meta as never),
          info: (msg, meta) => logger.info(msg, meta as never),
          warn: (msg, meta) => logger.warn(msg, meta as never),
          error: (msg, meta) => logger.error(msg, meta as never),
        };

        // ------------------------------------------------------------------
        // 3) Read Backstage config → CompositionConfig (plain TS object).
        // ------------------------------------------------------------------
        const tempDir =
          config.getOptionalString('codeinsight.cloneTempDir') ?? '/tmp/codeinsight';

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

        const compositionConfig: CompositionConfig = {
          repoClone: {
            tempDir,
            cloneTtlHours: config.getOptionalNumber('codeinsight.cloneTtlHours') ?? 24,
            defaultDepth: 1,
            deltaDepth: 50,
            authToken: config.getOptionalString('codeinsight.githubToken') ?? undefined,
          },
          ingestion: {
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
          },
          llm: llmConfig,
          embedding: embeddingConfig,
          docGen: {
            maxConcurrency:
              config.getOptionalNumber('codeinsight.docGen.maxConcurrency') ?? 20,
            maxOutputTokens:
              config.getOptionalNumber('codeinsight.docGen.maxOutputTokens') ?? 2000,
            temperature:
              config.getOptionalNumber('codeinsight.docGen.temperature') ?? 0.2,
          },
          diagramGen: {
            maxConcurrency:
              config.getOptionalNumber('codeinsight.diagramGen.maxConcurrency') ?? 10,
            maxOutputTokens:
              config.getOptionalNumber('codeinsight.diagramGen.maxOutputTokens') ?? 2000,
            temperature:
              config.getOptionalNumber('codeinsight.diagramGen.temperature') ?? 0.2,
          },
          indexing: {
            // All current OpenAI embedding models cap at 8192 tokens; charsPerToken=3
            // gives ~24 576 chars as the safety cap before truncation.
            modelTokenLimit: 8_192,
            charsPerToken: 3,
          },
          qna: {
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
          },
        };

        // ------------------------------------------------------------------
        // 4) Sync pgvector column dimension to match the configured model.
        //    Runs after migrations so the tables exist. If the model changed
        //    since last startup, both embedding tables are truncated and the
        //    column is re-created with the correct dimension — re-indexing
        //    all repos via "Sync Changes" will be required.
        // ------------------------------------------------------------------
        if (embeddingConfig) {
          await ensureEmbeddingDimension(knex, coreLogger, embeddingConfig);
          coreLogger.info('Embedding dimension verified', {
            model: embeddingConfig.model ?? 'text-embedding-3-small',
          });
        }

        // ------------------------------------------------------------------
        // 5) Wire core services through the shared composition factory.
        // ------------------------------------------------------------------
        const stack = createIngestionStack({
          knex,
          logger: coreLogger,
          config: compositionConfig,
        });

        if (llmConfig && stack.llmClient) {
          coreLogger.info('LLM client initialized', {
            provider: llmConfig.provider,
            model: llmConfig.model,
          });
        } else {
          coreLogger.info(
            'No LLM config found — doc/diagram generation will be unavailable',
          );
        }
        if (embeddingConfig && stack.embeddingClient) {
          coreLogger.info('Embedding client initialized', {
            provider: embeddingConfig.provider,
            model: embeddingConfig.model ?? 'text-embedding-3-small',
          });
        } else {
          coreLogger.info(
            'No embedding config found — QnA features will be unavailable',
          );
        }
        if (stack.indexingService) {
          coreLogger.info('Indexing service initialized');
        } else {
          coreLogger.info(
            'Indexing service unavailable — requires embedding config',
          );
        }
        if (stack.qnaService) {
          coreLogger.info('QnA service initialized');
        } else {
          coreLogger.info(
            'QnA service unavailable — requires both LLM and embedding config',
          );
        }

        // ------------------------------------------------------------------
        // 6) Usage dashboard — cost-per-million-tokens map from config.
        // ------------------------------------------------------------------
        const usageCostConfig = config.getOptionalConfig('codeinsight.usage.costPerMillionTokens');
        const costMap: Record<string, number> = { default: 3.0 };
        if (usageCostConfig) {
          for (const key of usageCostConfig.keys()) {
            costMap[key] = usageCostConfig.getNumber(key);
          }
        }

        // ------------------------------------------------------------------
        // 7) Mount router.
        // ------------------------------------------------------------------
        const router = await createRouter({
          config,
          logger,
          database,
          storageAdapter: stack.storageAdapter,
          jobQueue: stack.jobQueue,
          qnaService: stack.qnaService,
          costMap,
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

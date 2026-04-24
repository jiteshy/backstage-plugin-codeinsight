import { DiagramGenerationService } from '@codeinsight/diagram-gen';
import { DocGenerationService } from '@codeinsight/doc-generator';
import { createEmbeddingClient, deriveEmbeddingDimension } from '@codeinsight/embeddings';
import { IndexingService } from '@codeinsight/indexing';
import { InProcessJobQueue, IngestionService } from '@codeinsight/ingestion';
import { createLLMClient } from '@codeinsight/llm';
import { QnAService } from '@codeinsight/qna';
import { GitRepoConnector } from '@codeinsight/repo';
import { KnexStorageAdapter } from '@codeinsight/storage';
import type { EmbeddingConfig, Logger } from '@codeinsight/types';
import { PgVectorStore, syncEmbeddingDimension } from '@codeinsight/vector-store';
import type { Knex } from 'knex';

import type { CreateIngestionStackOpts, IngestionStack } from './types';

export function createIngestionStack(opts: CreateIngestionStackOpts): IngestionStack {
  const { knex, logger, config, wrapLlm, wrapEmbedding } = opts;

  const storageAdapter = new KnexStorageAdapter(knex);
  const repoConnector = new GitRepoConnector(config.repoClone, logger);

  const rawLlm = config.llm ? createLLMClient(config.llm, logger, knex) : undefined;
  const llmClient = rawLlm && wrapLlm ? wrapLlm(rawLlm) : rawLlm;

  const rawEmbedding = config.embedding
    ? createEmbeddingClient(config.embedding, logger, knex)
    : undefined;
  const embeddingClient = rawEmbedding && wrapEmbedding ? wrapEmbedding(rawEmbedding) : rawEmbedding;

  const embeddingModelName = config.embedding?.model ?? 'text-embedding-3-small';
  const vectorStore = new PgVectorStore(knex, logger, embeddingModelName);

  const docGenerationService = llmClient
    ? new DocGenerationService(storageAdapter, llmClient, logger, {
        ...config.docGen,
        modelName: config.llm?.model,
      })
    : undefined;

  const diagramGenerationService = new DiagramGenerationService(
    storageAdapter,
    logger,
    llmClient,
    { ...config.diagramGen, modelName: config.llm?.model },
  );

  const indexingService = embeddingClient
    ? new IndexingService(
        embeddingClient,
        vectorStore,
        storageAdapter,
        logger,
        config.indexing,
        llmClient,
      )
    : undefined;

  const ingestionService = new IngestionService(
    repoConnector,
    storageAdapter,
    logger,
    config.ingestion,
    undefined,
    undefined,
    docGenerationService,
    diagramGenerationService,
    indexingService,
  );

  const jobQueue = new InProcessJobQueue(
    ingestionService,
    storageAdapter,
    config.ingestion.maxConcurrentJobs,
  );

  const qnaService =
    llmClient && embeddingClient
      ? new QnAService(llmClient, embeddingClient, storageAdapter, vectorStore, config.qna, logger)
      : undefined;

  return {
    storageAdapter,
    jobQueue,
    ingestionService,
    qnaService,
    llmClient,
    embeddingClient,
    vectorStore,
    docGenerationService,
    diagramGenerationService,
    indexingService,
    logger,
  };
}

export async function ensureEmbeddingDimension(
  knex: Knex,
  logger: Logger,
  embedding: EmbeddingConfig,
): Promise<void> {
  const expectedDimension = deriveEmbeddingDimension(embedding);
  const expectedModel = embedding.model ?? 'text-embedding-3-small';
  await syncEmbeddingDimension(knex, expectedDimension, expectedModel, logger);
}

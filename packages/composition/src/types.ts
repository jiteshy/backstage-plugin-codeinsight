import type { Knex } from 'knex';
import type {
  EmbeddingClient,
  EmbeddingConfig,
  IngestionConfig,
  LLMClient,
  LLMConfig,
  Logger,
  QnAConfig,
  RepoCloneConfig,
  StorageAdapter,
  VectorStore,
} from '@codeinsight/types';
import type { DiagramGenConfig, DiagramGenerationService } from '@codeinsight/diagram-gen';
import type { DocGenConfig, DocGenerationService } from '@codeinsight/doc-generator';
import type { IndexingConfig, IndexingService } from '@codeinsight/indexing';
import type { IngestionService, InProcessJobQueue } from '@codeinsight/ingestion';
import type { QnAService } from '@codeinsight/qna';

/** Plain-TS configuration for the composition factory. No framework-specific types. */
export interface CompositionConfig {
  repoClone: RepoCloneConfig;
  ingestion: IngestionConfig;
  llm?: LLMConfig;
  embedding?: EmbeddingConfig;
  docGen: DocGenConfig;
  diagramGen: DiagramGenConfig;
  indexing: IndexingConfig;
  qna: QnAConfig;
}

/** Everything the caller needs to either mount a router or drive ingestion directly. */
export interface IngestionStack {
  storageAdapter: StorageAdapter;
  jobQueue: InProcessJobQueue;
  ingestionService: IngestionService;
  qnaService: QnAService | undefined;
  llmClient: LLMClient | undefined;
  embeddingClient: EmbeddingClient | undefined;
  vectorStore: VectorStore;
  docGenerationService: DocGenerationService | undefined;
  diagramGenerationService: DiagramGenerationService;
  indexingService: IndexingService | undefined;
  logger: Logger;
}

export interface CreateIngestionStackOpts {
  knex: Knex;
  logger: Logger;
  config: CompositionConfig;
  /** Allow callers to wrap LLM/embedding clients (e.g. cost tracking in eval). */
  wrapLlm?: (c: LLMClient) => LLMClient;
  wrapEmbedding?: (c: EmbeddingClient) => EmbeddingClient;
}

export interface DatabaseConfig {
  client: string;
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

export interface RepoCloneConfig {
  tempDir: string;
  cloneTtlHours: number;
  defaultDepth: number;
  deltaDepth: number;
  authToken?: string; // default token used when no per-clone token is provided
}

export interface LLMConfig {
  // `(string & {})` preserves IDE autocomplete for known values while accepting any provider string.
  // eslint-disable-next-line @typescript-eslint/ban-types
  provider: 'anthropic' | 'openai' | (string & {});
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface EmbeddingConfig {
  // `(string & {})` preserves 'openai' IDE autocomplete while accepting any provider string.
  // eslint-disable-next-line @typescript-eslint/ban-types
  provider: 'openai' | (string & {});
  apiKey: string;
  model?: string;
  dimensions?: number;
}

export interface IngestionConfig {
  tempDir: string; // base directory for repo clones
  deltaThreshold: number; // fraction (0-1) of changed files that triggers a full run
  maxConcurrentJobs: number; // reserved for future scheduler — unused in v1
  jobTimeoutMinutes: number; // reserved for future health-check sweep — unused in v1
  cloneDepth?: number; // git shallow clone depth for full runs (default: 1)
  deltaCloneDepth?: number; // git shallow clone depth for delta runs — must span fromSha..toSha (default: 50)
  cleanupAfterIngestion?: boolean; // delete clone dir after pipeline finishes (default: true)
  fileFilter?: {
    excludeDirs?: string[];
    excludeExtensions?: string[];
    excludePatterns?: string[];
  };
}

export interface QnAConfig {
  /** Max conversation turns to include in prompt (default: 6). */
  maxHistoryTurns?: number;
  /** Compress older turns after this many messages (default: 10). */
  compressAfterTurns?: number;
  /** Max tokens for assembled retrieval context (default: 8000). */
  maxContextTokens?: number;
  /** Max tokens for LLM answer generation (default: 2000). */
  maxAnswerTokens?: number;
  /** LLM temperature for answer generation (default: 0.3). */
  temperature?: number;
}

export interface UsageConfig {
  costPerMillionTokens: Record<string, number>;
}

export interface CodeInsightConfig {
  database: DatabaseConfig;
  repo: RepoCloneConfig;
  llm?: LLMConfig;
  embedding?: EmbeddingConfig;
  ingestion: IngestionConfig;
  qna?: QnAConfig;
  usage?: UsageConfig;
  features: {
    docs: boolean;
    diagrams: boolean;
    qna: boolean;
  };
}

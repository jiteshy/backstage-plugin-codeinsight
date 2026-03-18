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
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface EmbeddingConfig {
  provider: 'openai';
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

export interface CodeInsightConfig {
  database: DatabaseConfig;
  repo: RepoCloneConfig;
  llm?: LLMConfig;
  embedding?: EmbeddingConfig;
  ingestion: IngestionConfig;
  features: {
    docs: boolean;
    diagrams: boolean;
    qna: boolean;
  };
}

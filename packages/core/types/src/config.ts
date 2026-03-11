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
  maxConcurrentJobs: number;
  jobTimeoutMinutes: number;
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

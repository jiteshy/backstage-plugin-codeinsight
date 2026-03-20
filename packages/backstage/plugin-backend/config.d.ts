export interface Config {
  codeinsight?: {
    /**
     * Temporary directory for cloning repositories.
     * @visibility backend
     */
    cloneTempDir?: string;

    /**
     * Hours to keep cloned repos before cleanup. Default: 24.
     * @visibility backend
     */
    cloneTtlHours?: number;

    /**
     * Feature flags — enable/disable individual features.
     * @visibility frontend
     */
    features?: {
      /** Enable documentation generation. Default: true. */
      docs?: boolean;
      /** Enable diagram generation. Default: true. */
      diagrams?: boolean;
      /** Enable QnA chat. Default: true. */
      qna?: boolean;
    };

    /**
     * LLM provider configuration.
     * @deepVisibility secret
     */
    llm?: {
      /** Provider: 'anthropic' | 'openai' */
      provider?: string;
      /** API key for the LLM provider */
      apiKey?: string;
      /** Model identifier */
      model?: string;
    };

    /**
     * Embedding provider configuration.
     * @deepVisibility secret
     */
    embeddings?: {
      /** Provider: 'openai' */
      provider?: string;
      /** API key for the embedding provider */
      apiKey?: string;
      /** Model identifier */
      model?: string;
    };

    /**
     * GitHub personal access token for cloning private repos.
     * @visibility secret
     */
    githubToken?: string;

    /**
     * Ingestion pipeline settings.
     * @visibility backend
     */
    ingestion?: {
      /** Fraction of changed files (0-1) that triggers a full run. Default: 0.4. */
      deltaThreshold?: number;
      /** Max concurrent ingestion jobs. Default: 2. */
      maxConcurrentJobs?: number;
      /** Job timeout in minutes. Default: 30. */
      jobTimeoutMinutes?: number;
      /** Git shallow clone depth for first-run (full) clones. Default: 1. */
      cloneDepth?: number;
      /** Git shallow clone depth for delta-eligible runs — must span fromSha..toSha. Default: 50. */
      deltaCloneDepth?: number;
      /** Delete the cloned repo directory after each pipeline run. Default: true. */
      cleanupAfterIngestion?: boolean;
    };

    /**
     * Documentation generation settings.
     * @visibility backend
     */
    docGen?: {
      /** Max concurrent LLM calls during Phase 1 parallel module generation. Default: 20. */
      maxConcurrency?: number;
      /** Max output tokens for LLM completion responses. Default: 2000. */
      maxOutputTokens?: number;
      /** Temperature for LLM calls. Default: 0.2. */
      temperature?: number;
    };

    /**
     * Diagram generation settings.
     * @visibility backend
     */
    diagramGen?: {
      /** Max concurrent LLM diagram calls. Default: 10. */
      maxConcurrency?: number;
      /** Max output tokens for LLM completion responses. Default: 2000. */
      maxOutputTokens?: number;
      /** Temperature for LLM calls. Default: 0.2. */
      temperature?: number;
    };
  };
}

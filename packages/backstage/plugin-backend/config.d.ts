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
      /** Model identifier. Default: 'text-embedding-3-small'. */
      model?: string;
      /** Embedding vector dimensions. Default: 1536. */
      dimensions?: number;
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

    /**
     * QnA chat settings.
     * @visibility backend
     */
    qna?: {
      /** Max conversation turns to include in the prompt window. Default: 6. */
      maxHistoryTurns?: number;
      /** Compress older turns after this many messages. Default: 10. */
      compressAfterTurns?: number;
      /** Max tokens for assembled retrieval context. Default: 8000. */
      maxContextTokens?: number;
      /** Max tokens for LLM answer generation. Default: 2000. */
      maxAnswerTokens?: number;
      /** LLM temperature for answer generation. Default: 0.3. */
      temperature?: number;
    };

    /**
     * Token usage dashboard settings.
     * @visibility backend
     */
    usage?: {
      /**
       * Cost per million tokens (USD), keyed by model name.
       *
       * Recognized keys:
       *  - Any LLM model id extracted from `Artifact.generation_sig` (e.g. `claude-sonnet-4-20250514`, `gpt-4o`).
       *  - `llm` — synthetic label for QnA tokens, which are not tracked per-model. Set this to your
       *    QnA model's rate so QnA cost is reflected in the dashboard.
       *  - `default` — fallback rate for any model not listed above.
       *
       * Example:
       *   costPerMillionTokens:
       *     claude-sonnet-4-20250514: 3.0
       *     gpt-4o: 2.5
       *     llm: 3.0
       *     default: 3.0
       */
      costPerMillionTokens?: {
        [modelName: string]: number;
      };
    };
  };
}

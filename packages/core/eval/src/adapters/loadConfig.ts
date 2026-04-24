import { readFileSync } from 'fs';

import type { CompositionConfig } from '@codeinsight/composition';
import type { EmbeddingConfig, LLMConfig } from '@codeinsight/types';
import yaml from 'js-yaml';

export interface EvalDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface EvalConfig {
  composition: CompositionConfig;
  db: EvalDbConfig;
}

interface RawEval {
  db?: Partial<EvalDbConfig>;
  cloneTempDir?: string;
  cloneTtlHours?: number;
  githubToken?: string;
  llm?: { provider?: string; apiKey?: string; model?: string };
  embeddings?: {
    provider?: string;
    apiKey?: string;
    model?: string;
    dimensions?: number;
  };
  ingestion?: Partial<CompositionConfig['ingestion']>;
  docGen?: Partial<CompositionConfig['docGen']>;
  diagramGen?: Partial<CompositionConfig['diagramGen']>;
  qna?: Partial<CompositionConfig['qna']>;
}

export function loadEvalConfig(yamlPath: string): EvalConfig {
  const raw = yaml.load(readFileSync(yamlPath, 'utf8')) as RawEval | null;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Empty or invalid eval config file: ${yamlPath}`);
  }
  if (!raw.db || !raw.db.host || !raw.db.database) {
    throw new Error(
      `Missing "db" block (host + database required) in ${yamlPath}`,
    );
  }

  const db: EvalDbConfig = {
    host: raw.db.host,
    port: raw.db.port ?? 5432,
    user: raw.db.user ?? 'postgres',
    password: raw.db.password ?? '',
    database: raw.db.database,
  };

  const tempDir = raw.cloneTempDir ?? '/tmp/codeinsight-eval';
  const composition: CompositionConfig = {
    repoClone: {
      tempDir,
      cloneTtlHours: raw.cloneTtlHours ?? 24,
      defaultDepth: 1,
      deltaDepth: 50,
      authToken: raw.githubToken,
    },
    ingestion: {
      tempDir,
      deltaThreshold: raw.ingestion?.deltaThreshold ?? 0.4,
      maxConcurrentJobs: raw.ingestion?.maxConcurrentJobs ?? 2,
      jobTimeoutMinutes: raw.ingestion?.jobTimeoutMinutes ?? 30,
      cloneDepth: raw.ingestion?.cloneDepth ?? 1,
      deltaCloneDepth: raw.ingestion?.deltaCloneDepth ?? 50,
      cleanupAfterIngestion: raw.ingestion?.cleanupAfterIngestion ?? true,
    },
    llm:
      raw.llm?.provider && raw.llm.apiKey && raw.llm.model
        ? {
            provider: raw.llm.provider as LLMConfig['provider'],
            apiKey: raw.llm.apiKey,
            model: raw.llm.model,
          }
        : undefined,
    embedding:
      raw.embeddings?.provider && raw.embeddings.apiKey
        ? {
            provider: raw.embeddings.provider as EmbeddingConfig['provider'],
            apiKey: raw.embeddings.apiKey,
            model: raw.embeddings.model,
            dimensions: raw.embeddings.dimensions,
          }
        : undefined,
    docGen: {
      maxConcurrency: 20,
      maxOutputTokens: 2000,
      temperature: 0.2,
      ...raw.docGen,
    },
    diagramGen: {
      maxConcurrency: 10,
      maxOutputTokens: 2000,
      temperature: 0.2,
      ...raw.diagramGen,
    },
    indexing: {
      modelTokenLimit: 8192,
      charsPerToken: 3,
    },
    qna: {
      maxHistoryTurns: 6,
      compressAfterTurns: 10,
      maxContextTokens: 8000,
      maxAnswerTokens: 2000,
      temperature: 0.3,
      ...raw.qna,
    },
  };

  return { composition, db };
}

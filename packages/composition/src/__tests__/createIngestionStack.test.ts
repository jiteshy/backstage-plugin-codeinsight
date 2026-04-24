import type { Logger } from '@codeinsight/types';

import { createIngestionStack } from '../createIngestionStack';
import type { CompositionConfig } from '../types';

function mockKnex(): unknown {
  return { raw: jest.fn(), migrate: { latest: jest.fn() } };
}

const logger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const baseConfig: CompositionConfig = {
  repoClone: { tempDir: '/tmp/x', cloneTtlHours: 24, defaultDepth: 1, deltaDepth: 50 },
  ingestion: {
    tempDir: '/tmp/x',
    deltaThreshold: 0.4,
    maxConcurrentJobs: 2,
    jobTimeoutMinutes: 30,
    cloneDepth: 1,
    deltaCloneDepth: 50,
    cleanupAfterIngestion: true,
  },
  docGen: { maxConcurrency: 20, maxOutputTokens: 2000, temperature: 0.2 },
  diagramGen: { maxConcurrency: 10, maxOutputTokens: 2000, temperature: 0.2 },
  indexing: { modelTokenLimit: 8192, charsPerToken: 3 },
  qna: {
    maxHistoryTurns: 6,
    compressAfterTurns: 10,
    maxContextTokens: 8000,
    maxAnswerTokens: 2000,
    temperature: 0.3,
  },
};

describe('createIngestionStack', () => {
  it('returns a full stack when LLM and embedding configs are present', () => {
    const stack = createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: {
        ...baseConfig,
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-4-7' },
        embedding: { provider: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' },
      },
    });
    expect(stack.llmClient).toBeDefined();
    expect(stack.embeddingClient).toBeDefined();
    expect(stack.qnaService).toBeDefined();
    expect(stack.indexingService).toBeDefined();
    expect(stack.docGenerationService).toBeDefined();
    expect(stack.diagramGenerationService).toBeDefined();
    expect(stack.ingestionService).toBeDefined();
    expect(stack.jobQueue).toBeDefined();
    expect(stack.storageAdapter).toBeDefined();
    expect(stack.vectorStore).toBeDefined();
  });

  it('returns a partial stack (no llm, no qna, no indexing, no docGen) when LLM config is omitted', () => {
    const stack = createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: baseConfig,
    });
    expect(stack.llmClient).toBeUndefined();
    expect(stack.qnaService).toBeUndefined();
    expect(stack.docGenerationService).toBeUndefined();
    expect(stack.indexingService).toBeUndefined();
    // Diagram gen works without LLM — pure-AST modules still run.
    expect(stack.diagramGenerationService).toBeDefined();
    expect(stack.ingestionService).toBeDefined();
  });

  it('applies wrapLlm and wrapEmbedding when provided', () => {
    const wrapLlm = jest.fn(c => c);
    const wrapEmbedding = jest.fn(c => c);
    createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: {
        ...baseConfig,
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-4-7' },
        embedding: { provider: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' },
      },
      wrapLlm,
      wrapEmbedding,
    });
    expect(wrapLlm).toHaveBeenCalledTimes(1);
    expect(wrapEmbedding).toHaveBeenCalledTimes(1);
  });

  it('does not call wrapLlm when LLM config is absent', () => {
    const wrapLlm = jest.fn(c => c);
    const wrapEmbedding = jest.fn(c => c);
    createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: baseConfig,
      wrapLlm,
      wrapEmbedding,
    });
    expect(wrapLlm).not.toHaveBeenCalled();
    expect(wrapEmbedding).not.toHaveBeenCalled();
  });
});

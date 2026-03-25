/**
 * Unit tests for createEmbeddingClient factory.
 */

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: jest.fn() },
  })),
}));

import type { EmbeddingConfig, Logger } from '@codeinsight/types';

import { CachingEmbeddingClient } from '../CachingEmbeddingClient';
import { createEmbeddingClient } from '../createEmbeddingClient';
import { OpenAIEmbeddingClient } from '../OpenAIEmbeddingClient';

const BASE_CONFIG: EmbeddingConfig = {
  provider: 'openai',
  apiKey: 'test-key',
};

function buildLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('createEmbeddingClient', () => {
  it('returns a CachingEmbeddingClient when knex is provided', () => {
    const knex = jest.fn() as any;
    const client = createEmbeddingClient(BASE_CONFIG, buildLogger(), knex);

    expect(client).toBeInstanceOf(CachingEmbeddingClient);
  });

  it('returns an OpenAIEmbeddingClient when knex is not provided', () => {
    const client = createEmbeddingClient(BASE_CONFIG);

    expect(client).toBeInstanceOf(OpenAIEmbeddingClient);
  });

  it('returns an OpenAIEmbeddingClient when knex is undefined', () => {
    const client = createEmbeddingClient(BASE_CONFIG, buildLogger(), undefined);

    expect(client).toBeInstanceOf(OpenAIEmbeddingClient);
  });
});

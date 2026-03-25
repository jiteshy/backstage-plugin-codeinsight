/**
 * Unit tests for OpenAIEmbeddingClient.
 *
 * The OpenAI SDK is mocked — no real API calls are made.
 */

jest.mock('openai', () => {
  const createMock = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: { create: createMock },
    })),
    _createMock: createMock,
  };
});

import type { EmbeddingConfig } from '@codeinsight/types';

import { OpenAIEmbeddingClient } from '../OpenAIEmbeddingClient';

// Access the mock through the module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _createMock: createMock } = require('openai');

const BASE_CONFIG: EmbeddingConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'text-embedding-3-small',
};

describe('OpenAIEmbeddingClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns embeddings in the same order as input texts', async () => {
    createMock.mockResolvedValue({
      data: [
        { embedding: [0.1, 0.2, 0.3] },
        { embedding: [0.4, 0.5, 0.6] },
      ],
    });

    const client = new OpenAIEmbeddingClient(BASE_CONFIG);
    const result = await client.embed(['text1', 'text2']);

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it('returns an empty array for empty input', async () => {
    const client = new OpenAIEmbeddingClient(BASE_CONFIG);
    const result = await client.embed([]);

    expect(result).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('passes model and input to OpenAI SDK', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: [0.1] }] });

    const client = new OpenAIEmbeddingClient(BASE_CONFIG);
    await client.embed(['hello']);

    expect(createMock).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello'],
    });
  });

  it('uses default model when not specified', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: [0.1] }] });

    const config: EmbeddingConfig = { provider: 'openai', apiKey: 'key' };
    const client = new OpenAIEmbeddingClient(config);
    await client.embed(['hello']);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-small' }),
    );
  });

  it('passes dimensions when configured', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: [0.1] }] });

    const config: EmbeddingConfig = {
      provider: 'openai',
      apiKey: 'key',
      model: 'text-embedding-3-small',
      dimensions: 512,
    };
    const client = new OpenAIEmbeddingClient(config);
    await client.embed(['hello']);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: 512 }),
    );
  });

  it('propagates OpenAI SDK errors', async () => {
    createMock.mockRejectedValue(new Error('API rate limit exceeded'));

    const client = new OpenAIEmbeddingClient(BASE_CONFIG);
    await expect(client.embed(['hello'])).rejects.toThrow('API rate limit exceeded');
  });
});

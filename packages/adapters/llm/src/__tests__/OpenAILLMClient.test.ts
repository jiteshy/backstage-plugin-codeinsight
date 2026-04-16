/**
 * Unit tests for OpenAILLMClient.
 *
 * The `openai` module is mocked entirely — no real HTTP calls are made.
 * The mock OpenAI constructor returns an object with `chat.completions.create`,
 * which handles both the non-streaming (complete) and streaming (stream) paths.
 */
/* eslint-disable import/order */
import type { LLMConfig } from '@codeinsight/types';
// ---------------------------------------------------------------------------
// Module-level mock for openai
// ---------------------------------------------------------------------------

const mockCompletionsCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCompletionsCreate,
        },
      },
    })),
  };
});

import OpenAI from 'openai';

import { OpenAILLMClient } from '../OpenAILLMClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConfig(overrides: Partial<LLMConfig & { baseURL?: string }> = {}): LLMConfig & { baseURL?: string } {
  return {
    provider: 'openai',
    apiKey: 'test-api-key',
    model: 'gpt-4-turbo',
    ...overrides,
  };
}

function buildChatResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

async function* makeStreamChunks(
  deltas: Array<string | null | undefined>,
) {
  for (const delta of deltas) {
    yield {
      choices: [{ delta: { content: delta } }],
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAILLMClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('passes apiKey to the OpenAI constructor', () => {
      new OpenAILLMClient(buildConfig({ apiKey: 'sk-secret' }));

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-secret' }),
      );
    });

    it('passes baseURL to the OpenAI constructor when provided', () => {
      new OpenAILLMClient(buildConfig({ baseURL: 'https://my-azure-endpoint.openai.azure.com' }));

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://my-azure-endpoint.openai.azure.com' }),
      );
    });

    it('does not include baseURL in the OpenAI constructor when not provided', () => {
      new OpenAILLMClient(buildConfig({ baseURL: undefined }));

      const callArg = (OpenAI as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('baseURL');
    });
  });

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------

  describe('complete()', () => {
    it('calls chat.completions.create with the correct parameters and returns content', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('Hello from GPT-4!'));

      const client = new OpenAILLMClient(buildConfig());
      const result = await client.complete('You are helpful.', 'Say hi.');

      expect(mockCompletionsCreate).toHaveBeenCalledTimes(1);
      expect(mockCompletionsCreate).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        max_completion_tokens: 4096,
        temperature: 0,
        stop: undefined,
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Say hi.' },
        ],
      });
      expect(result).toBe('Hello from GPT-4!');
    });

    it('uses default maxTokens of 4096 when not provided in config', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ maxTokens: undefined }));
      await client.complete('sys', 'user');

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_completion_tokens: 4096 }),
      );
    });

    it('uses default temperature of 0 when not provided in config', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ temperature: undefined }));
      await client.complete('sys', 'user');

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
      );
    });

    it('respects maxTokens from config', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ maxTokens: 512 }));
      await client.complete('sys', 'user');

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_completion_tokens: 512 }),
      );
    });

    it('respects temperature from config', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ temperature: 0.8 }));
      await client.complete('sys', 'user');

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.8 }),
      );
    });

    it('opts.maxTokens overrides config default', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ maxTokens: 2048 }));
      await client.complete('sys', 'user', { maxTokens: 128 });

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_completion_tokens: 128 }),
      );
    });

    it('opts.temperature overrides config default', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig({ temperature: 0.5 }));
      await client.complete('sys', 'user', { temperature: 1.0 });

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 1.0 }),
      );
    });

    it('passes stop sequences from opts', async () => {
      mockCompletionsCreate.mockResolvedValue(buildChatResponse('ok'));

      const client = new OpenAILLMClient(buildConfig());
      await client.complete('sys', 'user', { stopSequences: ['###', '---'] });

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stop: ['###', '---'] }),
      );
    });

    it('throws when choices array is empty', async () => {
      mockCompletionsCreate.mockResolvedValue({ choices: [] });

      const client = new OpenAILLMClient(buildConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow(
        'OpenAI response contained no content',
      );
    });

    it('throws when message content is null', async () => {
      mockCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const client = new OpenAILLMClient(buildConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow(
        'OpenAI response contained no content',
      );
    });

    it('throws when message content is an empty string', async () => {
      mockCompletionsCreate.mockResolvedValue({
        choices: [{ message: { content: '' } }],
      });

      const client = new OpenAILLMClient(buildConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow(
        'OpenAI response contained no content',
      );
    });
  });

  // -------------------------------------------------------------------------
  // stream()
  // -------------------------------------------------------------------------

  describe('stream()', () => {
    it('calls chat.completions.create with stream: true and correct params', async () => {
      mockCompletionsCreate.mockResolvedValue(makeStreamChunks([]));

      const client = new OpenAILLMClient(buildConfig());
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.stream('You are helpful.', 'Say hi.')) {
        // no-op
      }

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4-turbo',
          max_completion_tokens: 4096,
          temperature: 0,
          stop: undefined,
          stream: true,
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Say hi.' },
          ],
        },
        { signal: undefined },
      );
    });

    it('yields delta content from each streaming chunk', async () => {
      mockCompletionsCreate.mockResolvedValue(makeStreamChunks(['Hello', ',', ' world']));

      const client = new OpenAILLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ',', ' world']);
    });

    it('skips chunks with null delta content', async () => {
      mockCompletionsCreate.mockResolvedValue(
        makeStreamChunks(['first', null, 'third']),
      );

      const client = new OpenAILLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['first', 'third']);
    });

    it('skips chunks with undefined delta content', async () => {
      mockCompletionsCreate.mockResolvedValue(
        makeStreamChunks(['first', undefined, 'last']),
      );

      const client = new OpenAILLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['first', 'last']);
    });

    it('yields nothing when all chunks have no delta content', async () => {
      mockCompletionsCreate.mockResolvedValue(makeStreamChunks([null, undefined, null]));

      const client = new OpenAILLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('passes opts to chat.completions.create in stream mode', async () => {
      mockCompletionsCreate.mockResolvedValue(makeStreamChunks([]));

      const client = new OpenAILLMClient(buildConfig());
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.stream('sys', 'user', {
        maxTokens: 256,
        temperature: 0.2,
        stopSequences: ['STOP'],
      })) {
        // no-op
      }

      expect(mockCompletionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 256,
          temperature: 0.2,
          stop: ['STOP'],
          stream: true,
        }),
        expect.objectContaining({ signal: undefined }),
      );
    });
  });
});

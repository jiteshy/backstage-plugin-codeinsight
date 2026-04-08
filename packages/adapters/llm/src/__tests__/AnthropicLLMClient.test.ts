/**
 * Unit tests for AnthropicLLMClient.
 *
 * @anthropic-ai/sdk is mocked entirely — no real HTTP calls are made.
 * The mock Anthropic constructor returns an object with:
 *   - messages.create (Promise-based, for complete())
 *   - messages.stream (async iterable, for stream())
 */

import type { LLMConfig } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Module-level mock for @anthropic-ai/sdk
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
        stream: mockStream,
      },
    })),
  };
});

import { AnthropicLLMClient } from '../AnthropicLLMClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'anthropic',
    apiKey: 'test-api-key',
    model: 'claude-3-opus-20240229',
    ...overrides,
  };
}

function buildTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

async function* makeStreamEvents(
  events: Array<{ type: string; delta?: { type: string; text?: string } }>,
) {
  for (const event of events) {
    yield event;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicLLMClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------

  describe('complete()', () => {
    it('calls messages.create with the correct parameters and returns text', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('Hello, world!'));

      const client = new AnthropicLLMClient(buildConfig());
      const result = await client.complete('You are helpful.', 'Say hi.');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-opus-20240229',
        max_tokens: 4096,
        temperature: 0,
        stop_sequences: undefined,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Say hi.' }],
      });
      expect(result).toBe('Hello, world!');
    });

    it('uses default maxTokens of 4096 when not provided in config', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ maxTokens: undefined }));
      await client.complete('sys', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 }),
      );
    });

    it('uses default temperature of 0 when not provided in config', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ temperature: undefined }));
      await client.complete('sys', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
      );
    });

    it('respects maxTokens from config when provided', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ maxTokens: 1024 }));
      await client.complete('sys', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1024 }),
      );
    });

    it('respects temperature from config when provided', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ temperature: 0.7 }));
      await client.complete('sys', 'user');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 }),
      );
    });

    it('opts.maxTokens overrides config default', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ maxTokens: 2048 }));
      await client.complete('sys', 'user', { maxTokens: 512 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 512 }),
      );
    });

    it('opts.temperature overrides config default', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig({ temperature: 0.5 }));
      await client.complete('sys', 'user', { temperature: 1.0 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 1.0 }),
      );
    });

    it('passes stop_sequences from opts', async () => {
      mockCreate.mockResolvedValue(buildTextResponse('ok'));

      const client = new AnthropicLLMClient(buildConfig());
      await client.complete('sys', 'user', { stopSequences: ['STOP', 'END'] });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stop_sequences: ['STOP', 'END'] }),
      );
    });

    it('throws when response content array is empty', async () => {
      mockCreate.mockResolvedValue({ content: [] });

      const client = new AnthropicLLMClient(buildConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow(
        'Anthropic response contained no text content',
      );
    });

    it('throws when the first content block is not a text block', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'abc', name: 'search', input: {} }],
      });

      const client = new AnthropicLLMClient(buildConfig());

      await expect(client.complete('sys', 'user')).rejects.toThrow(
        'Anthropic response contained no text content',
      );
    });
  });

  // -------------------------------------------------------------------------
  // stream()
  // -------------------------------------------------------------------------

  describe('stream()', () => {
    it('calls messages.stream with the correct parameters', async () => {
      mockStream.mockReturnValue(makeStreamEvents([]));

      const client = new AnthropicLLMClient(buildConfig());
      // Consume the iterable
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.stream('You are helpful.', 'Say hi.')) {
        // no-op
      }

      expect(mockStream).toHaveBeenCalledWith(
        {
          model: 'claude-3-opus-20240229',
          max_tokens: 4096,
          temperature: 0,
          stop_sequences: undefined,
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Say hi.' }],
        },
        { signal: undefined },
      );
    });

    it('yields text from content_block_delta text_delta events', async () => {
      const events = [
        { type: 'message_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ', world' } },
        { type: 'message_stop' },
      ];
      mockStream.mockReturnValue(makeStreamEvents(events));

      const client = new AnthropicLLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ', world']);
    });

    it('skips non-text_delta events', async () => {
      const events = [
        { type: 'message_start' },
        { type: 'content_block_start', content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'keep' } },
        { type: 'message_delta' },
        { type: 'message_stop' },
      ];
      mockStream.mockReturnValue(makeStreamEvents(events));

      const client = new AnthropicLLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['keep']);
    });

    it('yields nothing when all events are non-text_delta', async () => {
      const events = [
        { type: 'message_start' },
        { type: 'ping' },
        { type: 'message_stop' },
      ];
      mockStream.mockReturnValue(makeStreamEvents(events));

      const client = new AnthropicLLMClient(buildConfig());
      const chunks: string[] = [];
      for await (const chunk of client.stream('sys', 'user')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('passes opts to messages.stream', async () => {
      mockStream.mockReturnValue(makeStreamEvents([]));

      const client = new AnthropicLLMClient(buildConfig());
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.stream('sys', 'user', {
        maxTokens: 256,
        temperature: 0.3,
        stopSequences: ['DONE'],
      })) {
        // no-op
      }

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 256,
          temperature: 0.3,
          stop_sequences: ['DONE'],
        }),
        expect.objectContaining({ signal: undefined }),
      );
    });
  });
});

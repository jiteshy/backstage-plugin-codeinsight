/**
 * Unit tests for createLLMClient factory.
 *
 * AnthropicLLMClient, OpenAILLMClient, and CachingLLMClient constructors are
 * mocked via jest.mock() so no SDK calls are made and we can assert which
 * constructor was invoked with which arguments.
 */

import type { LLMConfig } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Module-level mocks — must be before imports of the module under test
// ---------------------------------------------------------------------------

jest.mock('../AnthropicLLMClient');
jest.mock('../OpenAILLMClient');
jest.mock('../CachingLLMClient');

import { AnthropicLLMClient } from '../AnthropicLLMClient';
import { CachingLLMClient } from '../CachingLLMClient';
import { createLLMClient } from '../createLLMClient';
import { OpenAILLMClient } from '../OpenAILLMClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAnthropicConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'anthropic',
    apiKey: 'test-anthropic-key',
    model: 'claude-3-opus-20240229',
    ...overrides,
  };
}

function buildOpenAIConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'openai',
    apiKey: 'test-openai-key',
    model: 'gpt-4-turbo',
    ...overrides,
  };
}

function buildKnexStub() {
  // Minimal stub — createLLMClient only passes it through to CachingLLMClient
  return jest.fn() as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLLMClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Provider selection
  // -------------------------------------------------------------------------

  describe('provider selection', () => {
    it('creates an AnthropicLLMClient for provider: anthropic', () => {
      const config = buildAnthropicConfig();
      createLLMClient(config);

      expect(AnthropicLLMClient).toHaveBeenCalledTimes(1);
      expect(AnthropicLLMClient).toHaveBeenCalledWith(config);
      expect(OpenAILLMClient).not.toHaveBeenCalled();
    });

    it('creates an OpenAILLMClient for provider: openai', () => {
      const config = buildOpenAIConfig();
      createLLMClient(config);

      expect(OpenAILLMClient).toHaveBeenCalledTimes(1);
      expect(OpenAILLMClient).toHaveBeenCalledWith(config);
      expect(AnthropicLLMClient).not.toHaveBeenCalled();
    });

    it('throws for an unknown provider', () => {
      const config = { provider: 'cohere', apiKey: 'key', model: 'model' } as unknown as LLMConfig;

      expect(() => createLLMClient(config)).toThrow('Unknown LLM provider: cohere');
    });
  });

  // -------------------------------------------------------------------------
  // Caching wrapper
  // -------------------------------------------------------------------------

  describe('caching wrapper', () => {
    it('wraps the inner client in CachingLLMClient when knex is provided', () => {
      const config = buildAnthropicConfig();
      const knex = buildKnexStub();

      const result = createLLMClient(config, undefined, knex);

      expect(CachingLLMClient).toHaveBeenCalledTimes(1);
      // First arg is the AnthropicLLMClient instance, second is knex, third is model name
      const [innerArg, knexArg, modelArg] = (CachingLLMClient as jest.Mock).mock.calls[0] as [unknown, unknown, string, unknown];
      expect(innerArg).toBeInstanceOf(AnthropicLLMClient);
      expect(knexArg).toBe(knex);
      expect(modelArg).toBe(config.model);
      // The returned value should be the CachingLLMClient instance
      expect(result).toBeInstanceOf(CachingLLMClient);
    });

    it('passes the logger to CachingLLMClient when both logger and knex are provided', () => {
      const config = buildOpenAIConfig();
      const knex = buildKnexStub();
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

      createLLMClient(config, logger, knex);

      expect(CachingLLMClient).toHaveBeenCalledTimes(1);
      const callArgs = (CachingLLMClient as jest.Mock).mock.calls[0] as unknown[];
      // 4th argument is logger
      expect(callArgs[3]).toBe(logger);
    });

    it('does NOT wrap in CachingLLMClient when knex is not provided', () => {
      const config = buildAnthropicConfig();

      const result = createLLMClient(config);

      expect(CachingLLMClient).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(AnthropicLLMClient);
    });

    it('does NOT wrap in CachingLLMClient when knex is undefined', () => {
      const config = buildOpenAIConfig();

      const result = createLLMClient(config, undefined, undefined);

      expect(CachingLLMClient).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(OpenAILLMClient);
    });

    it('uses config.model as the modelName argument to CachingLLMClient', () => {
      const config = buildAnthropicConfig({ model: 'claude-3-haiku-20240307' });
      const knex = buildKnexStub();

      createLLMClient(config, undefined, knex);

      const modelArg = (CachingLLMClient as jest.Mock).mock.calls[0][2] as string;
      expect(modelArg).toBe('claude-3-haiku-20240307');
    });
  });

  // -------------------------------------------------------------------------
  // Return types
  // -------------------------------------------------------------------------

  describe('return value', () => {
    it('returns an AnthropicLLMClient instance (no caching) for anthropic without knex', () => {
      const result = createLLMClient(buildAnthropicConfig());
      expect(result).toBeInstanceOf(AnthropicLLMClient);
    });

    it('returns an OpenAILLMClient instance (no caching) for openai without knex', () => {
      const result = createLLMClient(buildOpenAIConfig());
      expect(result).toBeInstanceOf(OpenAILLMClient);
    });

    it('returns a CachingLLMClient instance when knex is provided', () => {
      const result = createLLMClient(buildOpenAIConfig(), undefined, buildKnexStub());
      expect(result).toBeInstanceOf(CachingLLMClient);
    });
  });
});

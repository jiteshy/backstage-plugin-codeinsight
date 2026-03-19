import type { Knex } from 'knex';

import type { LLMClient, LLMConfig, Logger } from '@codeinsight/types';

import { AnthropicLLMClient } from './AnthropicLLMClient';
import { CachingLLMClient } from './CachingLLMClient';
import { OpenAILLMClient } from './OpenAILLMClient';

/**
 * Build a provider-specific LLMClient from config, wrapped in a CachingLLMClient
 * if a Knex instance is supplied.
 *
 * Usage in composition root:
 * ```ts
 * const llmClient = createLLMClient(llmConfig, coreLogger, knex);
 * ```
 */
export function createLLMClient(
  config: LLMConfig,
  logger?: Logger,
  knex?: Knex,
): LLMClient {
  let inner: LLMClient;

  if (config.provider === 'anthropic') {
    inner = new AnthropicLLMClient(config);
  } else if (config.provider === 'openai') {
    inner = new OpenAILLMClient(config);
  } else {
    throw new Error(`Unknown LLM provider: ${(config as LLMConfig).provider}`);
  }

  if (knex) {
    return new CachingLLMClient(inner, knex, config.model, logger);
  }

  return inner;
}

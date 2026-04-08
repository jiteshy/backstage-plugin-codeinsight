import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMConfig, LLMOptions } from '@codeinsight/types';

/**
 * LLMClient backed by the Anthropic (Claude) API.
 *
 * Config is injected — never reads process.env directly.
 */
export class AnthropicLLMClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultTemperature = config.temperature ?? 0;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts?.maxTokens ?? this.defaultMaxTokens,
      temperature: opts?.temperature ?? this.defaultTemperature,
      stop_sequences: opts?.stopSequences,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Anthropic response contained no text content');
    }
    return block.text;
  }

  async *stream(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? this.defaultMaxTokens,
        temperature: opts?.temperature ?? this.defaultTemperature,
        stop_sequences: opts?.stopSequences,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: opts?.signal },
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}

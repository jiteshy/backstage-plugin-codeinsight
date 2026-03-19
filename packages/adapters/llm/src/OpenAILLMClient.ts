import OpenAI from 'openai';
import type { LLMClient, LLMConfig, LLMOptions } from '@codeinsight/types';

export interface OpenAILLMConfig extends LLMConfig {
  /** Override the base URL — useful for Azure OpenAI or local OpenAI-compatible endpoints. */
  baseURL?: string;
}

/**
 * LLMClient backed by the OpenAI Chat Completions API.
 *
 * Compatible with any OpenAI-format endpoint (Azure OpenAI, Ollama, vLLM, etc.)
 * via the optional `baseURL` config field.
 *
 * Config is injected — never reads process.env directly.
 */
export class OpenAILLMClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: OpenAILLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultTemperature = config.temperature ?? 0;
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts?.maxTokens ?? this.defaultMaxTokens,
      temperature: opts?.temperature ?? this.defaultTemperature,
      stop: opts?.stopSequences,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('OpenAI response contained no content');
    }
    return choice.message.content;
  }

  async *stream(
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMOptions,
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts?.maxTokens ?? this.defaultMaxTokens,
      temperature: opts?.temperature ?? this.defaultTemperature,
      stop: opts?.stopSequences,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}

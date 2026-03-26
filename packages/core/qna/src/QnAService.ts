import { randomUUID } from 'crypto';

import type {
  ActiveContext,
  EmbeddingClient,
  LLMClient,
  Logger,
  QnAAnswer,
  QnAMessage,
  QnASession,
  QnASource,
  StorageAdapter,
  VectorStore,
} from '@codeinsight/types';

import {
  ContextAssemblyService,
  type AssembledContext,
  type ContextAssemblyConfig,
} from './ContextAssemblyService';
import { RetrievalService } from './RetrievalService';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface QnAConfig {
  /** Max conversation turns to include in prompt (default: 6). */
  maxHistoryTurns?: number;
  /** Compress older turns after this many messages (default: 10). */
  compressAfterTurns?: number;
  /** Max tokens for assembled context (default: 8000). */
  maxContextTokens?: number;
  /** Max tokens for LLM answer (default: 2000). */
  maxAnswerTokens?: number;
  /** LLM temperature (default: 0.3). */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_HISTORY_TURNS = 6;
const DEFAULT_COMPRESS_AFTER_TURNS = 10;
const DEFAULT_MAX_ANSWER_TOKENS = 2000;
const DEFAULT_TEMPERATURE = 0.3;
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are CodeInsight, an AI assistant that answers questions about a codebase.

## Rules
1. Answer ONLY based on the provided context. If the context does not contain enough information, say so clearly.
2. Cite your sources using [source:N] notation where N is the 1-based index of the context block.
3. When referencing code, include the file path and line range.
4. Format responses in Markdown. Use code blocks with language identifiers for code snippets.
5. Be concise but thorough. Prefer concrete examples from the code over abstract explanations.
6. If the question is about relationships between code elements, trace the call chain or import chain from the context.
7. Never fabricate file paths, function names, or line numbers that are not in the context.

## Source Citation Format
When citing a source, use: [source:N] where N matches the context block number.
At the end of your answer, list all referenced sources in a "Sources" section.`;

// ---------------------------------------------------------------------------
// QnAService
// ---------------------------------------------------------------------------

export class QnAService {
  private readonly retrieval: RetrievalService;
  private readonly contextAssembly: ContextAssemblyService;
  private readonly maxHistoryTurns: number;
  private readonly compressAfterTurns: number;
  private readonly maxAnswerTokens: number;
  private readonly temperature: number;

  constructor(
    private readonly llmClient: LLMClient,
    private readonly embeddingClient: EmbeddingClient,
    private readonly storage: StorageAdapter,
    vectorStore: VectorStore,
    config: QnAConfig = {},
    private readonly logger?: Logger,
  ) {
    this.retrieval = new RetrievalService(vectorStore, storage, logger);
    const contextConfig: ContextAssemblyConfig = {
      maxContextTokens: config.maxContextTokens,
    };
    this.contextAssembly = new ContextAssemblyService(
      storage,
      vectorStore,
      contextConfig,
      logger,
    );
    this.maxHistoryTurns = config.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS;
    this.compressAfterTurns =
      config.compressAfterTurns ?? DEFAULT_COMPRESS_AFTER_TURNS;
    this.maxAnswerTokens = config.maxAnswerTokens ?? DEFAULT_MAX_ANSWER_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  async createSession(
    repoId: string,
    userRef?: string,
  ): Promise<QnASession> {
    const now = new Date();
    const session: QnASession = {
      sessionId: randomUUID(),
      repoId,
      userRef: userRef ?? null,
      activeContext: { mentionedFiles: [], mentionedSymbols: [] },
      createdAt: now,
      lastActive: now,
    };
    await this.storage.createSession(session);
    return session;
  }

  // -----------------------------------------------------------------------
  // Non-streaming ask
  // -----------------------------------------------------------------------

  async ask(sessionId: string, question: string): Promise<QnAAnswer> {
    const session = await this.loadSession(sessionId);

    // 1. Store user message
    await this.storeUserMessage(sessionId, question);

    // 2. Build prompt
    const { userPrompt, assembledContext } = await this.buildPrompt(
      session,
      question,
    );

    // 3. Call LLM
    const rawAnswer = await this.llmClient.complete(SYSTEM_PROMPT, userPrompt, {
      maxTokens: this.maxAnswerTokens,
      temperature: this.temperature,
    });

    // 4. Parse sources from answer
    const sources = this.extractSources(rawAnswer, assembledContext);

    // 5. Store assistant message
    const tokensUsed = Math.ceil(rawAnswer.length / CHARS_PER_TOKEN);
    const assistantMsg = await this.storeAssistantMessage(
      sessionId,
      rawAnswer,
      sources,
      tokensUsed,
    );

    // 6. Update active context
    await this.updateActiveContext(session, assembledContext);

    // 7. Compress history if needed
    await this.maybeCompressHistory(session);

    return {
      answer: rawAnswer,
      sources,
      tokensUsed,
      messageId: assistantMsg.messageId,
      sessionId,
    };
  }

  // -----------------------------------------------------------------------
  // Streaming ask — returns AsyncIterable<string> for SSE
  // -----------------------------------------------------------------------

  async *askStream(
    sessionId: string,
    question: string,
  ): AsyncGenerator<string> {
    const session = await this.loadSession(sessionId);

    // 1. Store user message
    await this.storeUserMessage(sessionId, question);

    // 2. Build prompt
    const { userPrompt, assembledContext } = await this.buildPrompt(
      session,
      question,
    );

    // 3. Stream LLM response, accumulating full text
    const chunks: string[] = [];
    const stream = this.llmClient.stream(SYSTEM_PROMPT, userPrompt, {
      maxTokens: this.maxAnswerTokens,
      temperature: this.temperature,
    });

    for await (const token of stream) {
      chunks.push(token);
      yield token;
    }

    const fullAnswer = chunks.join('');

    // 4. Post-stream: persist and update
    const sources = this.extractSources(fullAnswer, assembledContext);
    const tokensUsed = Math.ceil(fullAnswer.length / CHARS_PER_TOKEN);

    await this.storeAssistantMessage(sessionId, fullAnswer, sources, tokensUsed);
    await this.updateActiveContext(session, assembledContext);
    await this.maybeCompressHistory(session);
  }

  // -----------------------------------------------------------------------
  // Private: session loading
  // -----------------------------------------------------------------------

  private async loadSession(sessionId: string): Promise<QnASession> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  // -----------------------------------------------------------------------
  // Private: prompt building
  // -----------------------------------------------------------------------

  private async buildPrompt(
    session: QnASession,
    question: string,
  ): Promise<{ userPrompt: string; assembledContext: AssembledContext }> {
    const repoId = session.repoId;

    // Embed the question
    const [embedding] = await this.embeddingClient.embed([question]);

    // Retrieve relevant chunks
    const chunks = await this.retrieval.retrieve(repoId, question, embedding);

    // Assemble context with CIG expansions
    const assembledContext = await this.contextAssembly.assemble(repoId, chunks);

    // Load conversation history
    const history = await this.loadHistory(session.sessionId);

    // Build the user prompt
    const parts: string[] = [];

    // Context blocks
    parts.push('## Context');
    assembledContext.blocks.forEach((block, i) => {
      const meta = block.chunk.metadata;
      const filePath = (meta?.filePath as string) ?? 'unknown';
      const symbol = (meta?.symbol as string) ?? '';
      const header = symbol
        ? `[${i + 1}] ${filePath} — ${symbol} (${block.chunk.layer})`
        : `[${i + 1}] ${filePath} (${block.chunk.layer})`;
      parts.push(`### ${header}`);
      parts.push(block.chunk.content);

      for (const exp of block.expansions) {
        parts.push(`> ${exp.type}: ${exp.content}`);
      }
      parts.push('');
    });

    // Active context (accumulated topic knowledge)
    if (session.activeContext.topicSummary) {
      parts.push('## Previous Conversation Summary');
      parts.push(session.activeContext.topicSummary);
      parts.push('');
    }

    // Conversation history
    if (history.length > 0) {
      parts.push('## Conversation History');
      for (const msg of history) {
        const prefix = msg.role === 'user' ? 'User' : 'Assistant';
        parts.push(`**${prefix}:** ${msg.content}`);
      }
      parts.push('');
    }

    // Current question
    parts.push('## Question');
    parts.push(question);

    return {
      userPrompt: parts.join('\n'),
      assembledContext,
    };
  }

  // -----------------------------------------------------------------------
  // Private: history management
  // -----------------------------------------------------------------------

  private async loadHistory(sessionId: string): Promise<QnAMessage[]> {
    const messages = await this.storage.getSessionMessages(sessionId);
    // Exclude the just-stored user message (last item) — it's in "## Question"
    const withoutCurrent = messages.slice(0, -1);
    return withoutCurrent.slice(-this.maxHistoryTurns);
  }

  private async maybeCompressHistory(session: QnASession): Promise<void> {
    const count = await this.storage.getSessionMessageCount(session.sessionId);
    if (count <= this.compressAfterTurns) return;

    const allMessages = await this.storage.getSessionMessages(
      session.sessionId,
    );

    // Messages to compress: everything except the last maxHistoryTurns
    const toCompress = allMessages.slice(
      0,
      allMessages.length - this.maxHistoryTurns,
    );
    if (toCompress.length === 0) return;

    const existingSummary = session.activeContext.topicSummary ?? '';

    const conversationText = toCompress
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const compressionPrompt = existingSummary
      ? `Previous summary:\n${existingSummary}\n\nNew conversation turns to incorporate:\n${conversationText}\n\nProduce an updated concise summary of the conversation topics, key files, and symbols discussed. Max 500 words.`
      : `Summarize this conversation about a codebase. Include key files, symbols, and topics discussed. Max 500 words.\n\n${conversationText}`;

    try {
      const summary = await this.llmClient.complete(
        'You are a conversation summarizer. Produce concise summaries.',
        compressionPrompt,
        { maxTokens: 600, temperature: 0 },
      );

      const updatedContext: ActiveContext = {
        ...session.activeContext,
        topicSummary: summary,
      };
      await this.storage.updateSessionActiveContext(
        session.sessionId,
        updatedContext,
      );
    } catch (err) {
      this.logger?.warn('QnAService: history compression failed', {
        error: String(err),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private: source extraction
  // -----------------------------------------------------------------------

  extractSources(
    answer: string,
    assembledContext: AssembledContext,
  ): QnASource[] {
    const sourceRefs = new Set<number>();
    const sourcePattern = /\[source:(\d+)\]/gi;
    let match: RegExpExecArray | null;
    while ((match = sourcePattern.exec(answer)) !== null) {
      sourceRefs.add(parseInt(match[1], 10));
    }

    const sources: QnASource[] = [];
    for (const idx of sourceRefs) {
      const blockIdx = idx - 1; // 1-based to 0-based
      if (blockIdx < 0 || blockIdx >= assembledContext.blocks.length) continue;

      const block = assembledContext.blocks[blockIdx];
      const meta = block.chunk.metadata;
      sources.push({
        filePath: (meta?.filePath as string) ?? 'unknown',
        symbol: (meta?.symbol as string) ?? undefined,
        startLine: (meta?.startLine as number) ?? undefined,
        endLine: (meta?.endLine as number) ?? undefined,
        layer: block.chunk.layer,
        snippet: block.chunk.content.slice(0, 200),
      });
    }

    return sources;
  }

  // -----------------------------------------------------------------------
  // Private: active context tracking
  // -----------------------------------------------------------------------

  private async updateActiveContext(
    session: QnASession,
    assembledContext: AssembledContext,
  ): Promise<void> {
    const existingFiles = new Set(session.activeContext.mentionedFiles);
    const existingSymbols = new Set(session.activeContext.mentionedSymbols);

    for (const block of assembledContext.blocks) {
      const meta = block.chunk.metadata;
      const filePath = meta?.filePath as string | undefined;
      const symbol = meta?.symbol as string | undefined;
      if (filePath) existingFiles.add(filePath);
      if (symbol) existingSymbols.add(symbol);
    }

    const updatedContext: ActiveContext = {
      ...session.activeContext,
      mentionedFiles: [...existingFiles],
      mentionedSymbols: [...existingSymbols],
    };

    await this.storage.updateSessionActiveContext(
      session.sessionId,
      updatedContext,
    );
    await this.storage.touchSession(session.sessionId);
  }

  // -----------------------------------------------------------------------
  // Private: message persistence
  // -----------------------------------------------------------------------

  private async storeUserMessage(
    sessionId: string,
    content: string,
  ): Promise<QnAMessage> {
    const msg: QnAMessage = {
      messageId: randomUUID(),
      sessionId,
      role: 'user',
      content,
      sources: null,
      tokensUsed: 0,
      createdAt: new Date(),
    };
    await this.storage.addMessage(msg);
    return msg;
  }

  private async storeAssistantMessage(
    sessionId: string,
    content: string,
    sources: QnASource[],
    tokensUsed: number,
  ): Promise<QnAMessage> {
    const msg: QnAMessage = {
      messageId: randomUUID(),
      sessionId,
      role: 'assistant',
      content,
      sources,
      tokensUsed,
      createdAt: new Date(),
    };
    await this.storage.addMessage(msg);
    return msg;
  }
}

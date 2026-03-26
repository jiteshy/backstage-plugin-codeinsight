import type {
  ActiveContext,
  EmbeddingClient,
  LLMClient,
  QnAMessage,
  QnASession,
  StorageAdapter,
  VectorChunk,
  VectorStore,
} from '@codeinsight/types';

import { QnAService, type QnAConfig } from './QnAService';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeStorage(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    getRepo: jest.fn(),
    upsertRepo: jest.fn(),
    updateRepoStatus: jest.fn(),
    upsertRepoFiles: jest.fn(),
    getRepoFiles: jest.fn(),
    getChangedRepoFiles: jest.fn(),
    deleteRepoFilesNotIn: jest.fn(),
    upsertCIGNodes: jest.fn(),
    upsertCIGEdges: jest.fn(),
    deleteCIGForFiles: jest.fn(),
    getCIGNodes: jest.fn().mockResolvedValue([]),
    getCIGEdges: jest.fn().mockResolvedValue([]),
    upsertArtifact: jest.fn(),
    getArtifact: jest.fn(),
    getArtifactsByType: jest.fn(),
    getStaleArtifacts: jest.fn(),
    markArtifactsStale: jest.fn(),
    upsertArtifactInputs: jest.fn(),
    getArtifactInputs: jest.fn(),
    getArtifactIdsByFilePaths: jest.fn(),
    getArtifactDependents: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getJob: jest.fn(),
    getActiveJobForRepo: jest.fn(),
    // QnA methods
    createSession: jest.fn().mockImplementation((s: QnASession) => Promise.resolve(s.sessionId)),
    getSession: jest.fn().mockResolvedValue(null),
    updateSessionActiveContext: jest.fn().mockResolvedValue(undefined),
    touchSession: jest.fn().mockResolvedValue(undefined),
    addMessage: jest.fn().mockImplementation((m: QnAMessage) => Promise.resolve(m.messageId)),
    getSessionMessages: jest.fn().mockResolvedValue([]),
    getSessionMessageCount: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as StorageAdapter;
}

function makeVectorStore(overrides: Partial<VectorStore> = {}): VectorStore {
  return {
    upsert: jest.fn(),
    search: jest.fn().mockResolvedValue([]),
    searchKeyword: jest.fn().mockResolvedValue([]),
    listChunks: jest.fn().mockResolvedValue([]),
    deleteChunks: jest.fn(),
    ...overrides,
  };
}

function makeLLMClient(overrides: Partial<LLMClient> = {}): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue('This is the answer. [source:1]'),
    stream: jest.fn().mockImplementation(async function* () {
      yield 'This is ';
      yield 'the answer.';
    }),
    ...overrides,
  };
}

function makeEmbeddingClient(): EmbeddingClient {
  return {
    embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };
}

function makeSession(overrides: Partial<QnASession> = {}): QnASession {
  return {
    sessionId: 'sess-1',
    repoId: 'repo-1',
    userRef: null,
    activeContext: { mentionedFiles: [], mentionedSymbols: [] },
    createdAt: new Date('2026-01-01'),
    lastActive: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeChunk(id: string, opts: Partial<VectorChunk> = {}): VectorChunk {
  return {
    chunkId: id,
    repoId: 'repo-1',
    content: `content of ${id}`,
    contentSha: `sha-${id}`,
    layer: 'code',
    metadata: {
      filePath: 'src/auth/login.ts',
      symbol: 'loginUser',
      startLine: 10,
      endLine: 30,
    },
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QnAService', () => {
  describe('createSession', () => {
    it('creates a session with valid UUID and correct repoId', async () => {
      const storage = makeStorage();
      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
      );

      const session = await svc.createSession('repo-1', 'user-42');

      expect(session.repoId).toBe('repo-1');
      expect(session.userRef).toBe('user-42');
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(session.activeContext).toEqual({
        mentionedFiles: [],
        mentionedSymbols: [],
      });
      expect(storage.createSession).toHaveBeenCalledWith(session);
    });

    it('defaults userRef to null when not provided', async () => {
      const storage = makeStorage();
      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
      );

      const session = await svc.createSession('repo-1');
      expect(session.userRef).toBeNull();
    });
  });

  describe('ask', () => {
    it('orchestrates the full pipeline and returns QnAAnswer', async () => {
      const session = makeSession();
      const chunk = makeChunk('chunk-1');
      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue([]),
        getSessionMessageCount: jest.fn().mockResolvedValue(2),
      });
      const vectorStore = makeVectorStore({
        search: jest.fn().mockResolvedValue([chunk]),
      });
      const llmClient = makeLLMClient({
        complete: jest.fn().mockResolvedValue(
          'The loginUser function handles auth. [source:1]',
        ),
      });
      const embeddingClient = makeEmbeddingClient();

      const svc = new QnAService(
        llmClient,
        embeddingClient,
        storage,
        vectorStore,
      );

      const answer = await svc.ask('sess-1', 'How does login work?');

      // Verify embedding was computed
      expect(embeddingClient.embed).toHaveBeenCalledWith(['How does login work?']);

      // Verify user message was stored
      expect(storage.addMessage).toHaveBeenCalledTimes(2); // user + assistant
      const userMsgCall = (storage.addMessage as jest.Mock).mock.calls[0][0];
      expect(userMsgCall.role).toBe('user');
      expect(userMsgCall.content).toBe('How does login work?');

      // Verify LLM was called
      expect(llmClient.complete).toHaveBeenCalledTimes(1);

      // Verify answer structure
      expect(answer.answer).toContain('loginUser');
      expect(answer.sessionId).toBe('sess-1');
      expect(answer.sources).toHaveLength(1);
      expect(answer.sources[0].filePath).toBe('src/auth/login.ts');
      expect(answer.sources[0].symbol).toBe('loginUser');

      // Verify active context was updated
      expect(storage.updateSessionActiveContext).toHaveBeenCalled();
      expect(storage.touchSession).toHaveBeenCalledWith('sess-1');
    });

    it('throws when session not found', async () => {
      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        makeStorage({ getSession: jest.fn().mockResolvedValue(null) }),
        makeVectorStore(),
      );

      await expect(svc.ask('nonexistent', 'hello')).rejects.toThrow(
        'Session not found: nonexistent',
      );
    });

    it('includes conversation history in prompt', async () => {
      const session = makeSession();
      const existingMessages: QnAMessage[] = [
        {
          messageId: 'msg-1',
          sessionId: 'sess-1',
          role: 'user',
          content: 'What is auth?',
          sources: null,
          tokensUsed: 0,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          messageId: 'msg-2',
          sessionId: 'sess-1',
          role: 'assistant',
          content: 'Auth handles login.',
          sources: [],
          tokensUsed: 10,
          createdAt: new Date('2026-01-01T00:01:00Z'),
        },
        // The third message is the just-stored user message for current question
        {
          messageId: 'msg-3',
          sessionId: 'sess-1',
          role: 'user',
          content: 'Tell me more',
          sources: null,
          tokensUsed: 0,
          createdAt: new Date('2026-01-01T00:02:00Z'),
        },
      ];

      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue(existingMessages),
        getSessionMessageCount: jest.fn().mockResolvedValue(3),
      });

      const llmClient = makeLLMClient();
      const svc = new QnAService(
        llmClient,
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
      );

      await svc.ask('sess-1', 'Tell me more');

      // Verify the prompt includes history
      const userPrompt = (llmClient.complete as jest.Mock).mock.calls[0][1] as string;
      expect(userPrompt).toContain('Conversation History');
      expect(userPrompt).toContain('What is auth?');
      expect(userPrompt).toContain('Auth handles login.');
    });
  });

  describe('askStream', () => {
    it('yields tokens and persists after stream ends', async () => {
      const session = makeSession();
      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue([]),
        getSessionMessageCount: jest.fn().mockResolvedValue(2),
      });

      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
      );

      const tokens: string[] = [];
      for await (const token of svc.askStream('sess-1', 'What is this?')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['This is ', 'the answer.']);
      // Verify persistence happened (user + assistant messages)
      expect(storage.addMessage).toHaveBeenCalledTimes(2);
      const assistantCall = (storage.addMessage as jest.Mock).mock.calls[1][0];
      expect(assistantCall.role).toBe('assistant');
      expect(assistantCall.content).toBe('This is the answer.');
    });
  });

  describe('extractSources', () => {
    it('parses [source:N] references and maps to context blocks', () => {
      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        makeStorage(),
        makeVectorStore(),
      );

      const assembledContext = {
        blocks: [
          {
            chunk: makeChunk('c1', {
              metadata: { filePath: 'src/a.ts', symbol: 'foo', startLine: 1, endLine: 10 },
            }),
            chunkTokens: 50,
            expansions: [],
            expansionTokens: 0,
            totalTokens: 50,
          },
          {
            chunk: makeChunk('c2', {
              metadata: { filePath: 'src/b.ts', symbol: 'bar', startLine: 5, endLine: 20 },
            }),
            chunkTokens: 40,
            expansions: [],
            expansionTokens: 0,
            totalTokens: 40,
          },
        ],
        totalTokens: 90,
        truncated: false,
        droppedChunks: 0,
      };

      const sources = svc.extractSources(
        'See [source:1] and also [source:2] for details.',
        assembledContext,
      );

      expect(sources).toHaveLength(2);
      expect(sources[0].filePath).toBe('src/a.ts');
      expect(sources[0].symbol).toBe('foo');
      expect(sources[1].filePath).toBe('src/b.ts');
      expect(sources[1].symbol).toBe('bar');
    });

    it('ignores out-of-range source references', () => {
      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        makeStorage(),
        makeVectorStore(),
      );

      const assembledContext = {
        blocks: [
          {
            chunk: makeChunk('c1'),
            chunkTokens: 50,
            expansions: [],
            expansionTokens: 0,
            totalTokens: 50,
          },
        ],
        totalTokens: 50,
        truncated: false,
        droppedChunks: 0,
      };

      const sources = svc.extractSources(
        'See [source:1] and [source:99].',
        assembledContext,
      );

      expect(sources).toHaveLength(1);
    });
  });

  describe('history compression', () => {
    it('compresses history when message count exceeds threshold', async () => {
      const session = makeSession();

      // Generate enough messages to trigger compression
      const messages: QnAMessage[] = [];
      for (let i = 0; i < 12; i++) {
        messages.push({
          messageId: `msg-${i}`,
          sessionId: 'sess-1',
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          sources: null,
          tokensUsed: 10,
          createdAt: new Date(`2026-01-01T00:${String(i).padStart(2, '0')}:00Z`),
        });
      }

      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue(messages),
        getSessionMessageCount: jest.fn().mockResolvedValue(12),
      });

      const llmClient = makeLLMClient({
        complete: jest.fn()
          .mockResolvedValueOnce('Answer [source:1]') // main answer
          .mockResolvedValueOnce('Summary of conversation'), // compression
      });

      const config: QnAConfig = { compressAfterTurns: 10, maxHistoryTurns: 6 };
      const svc = new QnAService(
        llmClient,
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
        config,
      );

      await svc.ask('sess-1', 'Next question');

      // LLM called twice: once for answer, once for compression
      expect(llmClient.complete).toHaveBeenCalledTimes(2);

      // Verify the compression prompt includes older messages
      const compressionPrompt = (llmClient.complete as jest.Mock).mock.calls[1][1] as string;
      expect(compressionPrompt).toContain('Message 0');

      // Verify active context was updated with summary
      expect(storage.updateSessionActiveContext).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ topicSummary: 'Summary of conversation' }),
      );
    });

    it('does not compress when under threshold', async () => {
      const session = makeSession();
      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue([]),
        getSessionMessageCount: jest.fn().mockResolvedValue(4),
      });
      const llmClient = makeLLMClient();

      const svc = new QnAService(
        llmClient,
        makeEmbeddingClient(),
        storage,
        makeVectorStore(),
      );

      await svc.ask('sess-1', 'Hello');

      // LLM called only once (for answer, not compression)
      expect(llmClient.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('active context accumulation', () => {
    it('accumulates files and symbols from context blocks', async () => {
      const session = makeSession({
        activeContext: {
          mentionedFiles: ['src/existing.ts'],
          mentionedSymbols: ['existingFn'],
        },
      });

      const chunk = makeChunk('c1', {
        metadata: { filePath: 'src/new.ts', symbol: 'newFn', startLine: 1, endLine: 5 },
      });

      const storage = makeStorage({
        getSession: jest.fn().mockResolvedValue(session),
        getSessionMessages: jest.fn().mockResolvedValue([]),
        getSessionMessageCount: jest.fn().mockResolvedValue(2),
      });
      const vectorStore = makeVectorStore({
        search: jest.fn().mockResolvedValue([chunk]),
      });

      const svc = new QnAService(
        makeLLMClient(),
        makeEmbeddingClient(),
        storage,
        vectorStore,
      );

      await svc.ask('sess-1', 'What is newFn?');

      const updateCall = (storage.updateSessionActiveContext as jest.Mock).mock.calls[0];
      const updatedContext: ActiveContext = updateCall[1];

      expect(updatedContext.mentionedFiles).toContain('src/existing.ts');
      expect(updatedContext.mentionedFiles).toContain('src/new.ts');
      expect(updatedContext.mentionedSymbols).toContain('existingFn');
      expect(updatedContext.mentionedSymbols).toContain('newFn');
    });
  });
});

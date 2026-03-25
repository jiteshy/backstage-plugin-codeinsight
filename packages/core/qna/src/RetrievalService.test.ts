import type { CIGNode, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

import {
  RetrievalService,
  classifyQuery,
  extractIdentifiers,
} from './RetrievalService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(
  chunkId: string,
  layer = 'code',
  content = 'some content',
): VectorChunk {
  return {
    chunkId,
    repoId: 'repo-1',
    content,
    contentSha: 'sha-' + chunkId,
    layer,
  };
}

function makeNode(symbolName: string, filePath = 'src/foo.ts'): CIGNode {
  return {
    nodeId: 'node-' + symbolName,
    repoId: 'repo-1',
    filePath,
    symbolName,
    symbolType: 'function',
    startLine: 1,
    endLine: 20,
    exported: true,
    extractedSha: 'sha-node',
  };
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

function makeStorage(nodes: CIGNode[] = []): StorageAdapter {
  return {
    getCIGNodes: jest.fn().mockResolvedValue(nodes),
    getCIGEdges: jest.fn().mockResolvedValue([]),
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
  } as unknown as StorageAdapter;
}

const EMBEDDING = Array(1536).fill(0.1);

// ---------------------------------------------------------------------------
// classifyQuery
// ---------------------------------------------------------------------------

describe('classifyQuery', () => {
  it('classifies conceptual queries', () => {
    expect(classifyQuery('How does authentication work?')).toBe('conceptual');
    expect(classifyQuery('Explain the overview of the system')).toBe('conceptual');
    expect(classifyQuery('What is the architecture?')).toBe('conceptual');
  });

  it('classifies specific queries', () => {
    expect(classifyQuery('What does loginUser() do?')).toBe('specific');
    expect(classifyQuery('How does handleRequest work?')).toBe('specific');
  });

  it('classifies relational queries', () => {
    expect(classifyQuery('What calls loginUser?')).toBe('relational');
    expect(classifyQuery('Who calls validateToken?')).toBe('relational');
    expect(classifyQuery('What depends on AuthService?')).toBe('relational');
    expect(classifyQuery('Callers of fetchUser')).toBe('relational');
  });

  it('classifies navigational queries', () => {
    expect(classifyQuery('Where is the database config?')).toBe('navigational');
    expect(classifyQuery('Which file defines the router?')).toBe('navigational');
    expect(classifyQuery('Find the AuthService class')).toBe('navigational');
  });

  it('classifies camelCase identifier queries as specific', () => {
    expect(classifyQuery('Tell me about handleAuthToken')).toBe('specific');
    expect(classifyQuery('userRepository details')).toBe('specific');
  });

  it('classifies generic queries as general', () => {
    expect(classifyQuery('what happens during startup')).toBe('general');
    expect(classifyQuery('list all endpoints')).toBe('general');
  });
});

// ---------------------------------------------------------------------------
// extractIdentifiers
// ---------------------------------------------------------------------------

describe('extractIdentifiers', () => {
  it('extracts camelCase identifiers', () => {
    const ids = extractIdentifiers('What does loginUser do in AuthService?');
    expect(ids).toContain('loginUser');
    expect(ids).toContain('AuthService');
  });

  it('filters common English stop-words', () => {
    const ids = extractIdentifiers('What does the function call');
    // "What", "does", "the", "function", "call" — all stop-words or short
    expect(ids).not.toContain('What');
    expect(ids).not.toContain('does');
    expect(ids).not.toContain('the');
  });

  it('returns empty array for queries with no identifiers', () => {
    expect(extractIdentifiers('how does it go')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RetrievalService.retrieve
// ---------------------------------------------------------------------------

describe('RetrievalService', () => {
  it('returns vector results for conceptual queries', async () => {
    const chunk1 = makeChunk('c1', 'doc_section');
    const chunk2 = makeChunk('c2', 'file_summary');
    const vs = makeVectorStore({
      search: jest.fn().mockResolvedValue([chunk1, chunk2]),
    });
    const storage = makeStorage();
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve('repo-1', 'How does auth work?', EMBEDDING);

    expect(results).toHaveLength(2);
    expect(results[0].chunkId).toBe('c1');
    // Keyword search skipped for conceptual
    expect(vs.searchKeyword).not.toHaveBeenCalled();
    // CIG lookup skipped for conceptual
    expect(storage.getCIGNodes).not.toHaveBeenCalled();
  });

  it('returns keyword + CIG results for specific queries', async () => {
    const kwChunk = makeChunk('kw1', 'code', 'function loginUser');
    const vs = makeVectorStore({
      search: jest.fn().mockResolvedValue([makeChunk('v1', 'code')]),
      searchKeyword: jest.fn().mockResolvedValue([kwChunk]),
    });
    const storage = makeStorage([makeNode('loginUser')]);
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve(
      'repo-1',
      'What does loginUser do?',
      EMBEDDING,
    );

    // vector + keyword + CIG — all three paths active for 'specific'
    expect(vs.search).toHaveBeenCalled();
    expect(vs.searchKeyword).toHaveBeenCalled();
    expect(storage.getCIGNodes).toHaveBeenCalledWith('repo-1');
    // CIG chunk for loginUser included
    const chunkIds = results.map(r => r.chunkId);
    expect(chunkIds).toContain('repo-1:src/foo.ts:loginUser');
  });

  it('skips vector search for relational queries', async () => {
    const vs = makeVectorStore();
    const storage = makeStorage([makeNode('loginUser')]);
    const svc = new RetrievalService(vs, storage);

    await svc.retrieve('repo-1', 'What calls loginUser?', EMBEDDING);

    expect(vs.search).not.toHaveBeenCalled();
    expect(vs.searchKeyword).toHaveBeenCalled();
    expect(storage.getCIGNodes).toHaveBeenCalled();
  });

  it('deduplicates chunks appearing in multiple paths', async () => {
    const shared = makeChunk('shared-1', 'code');
    const vs = makeVectorStore({
      search: jest.fn().mockResolvedValue([shared]),
      searchKeyword: jest.fn().mockResolvedValue([shared, makeChunk('kw-only')]),
    });
    const storage = makeStorage();
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve(
      'repo-1',
      'find something',
      EMBEDDING,
      { queryType: 'general' },
    );

    const ids = results.map(r => r.chunkId);
    // shared-1 must appear only once
    expect(ids.filter(id => id === 'shared-1')).toHaveLength(1);
    expect(ids).toContain('kw-only');
  });

  it('respects topK option', async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => makeChunk(`c${i}`));
    const vs = makeVectorStore({
      search: jest.fn().mockResolvedValue(chunks),
    });
    const svc = new RetrievalService(vs, makeStorage());

    const results = await svc.retrieve(
      'repo-1',
      'how does auth work',
      EMBEDDING,
      { topK: 3 },
    );

    expect(results).toHaveLength(3);
  });

  it('accepts an explicit queryType override', async () => {
    const vs = makeVectorStore();
    const storage = makeStorage([makeNode('AuthService')]);
    const svc = new RetrievalService(vs, storage);

    await svc.retrieve('repo-1', 'tell me about auth', EMBEDDING, {
      queryType: 'relational',
    });

    // Relational: no vector search
    expect(vs.search).not.toHaveBeenCalled();
    expect(storage.getCIGNodes).toHaveBeenCalled();
  });

  it('handles vector store failures gracefully', async () => {
    const vs = makeVectorStore({
      search: jest.fn().mockRejectedValue(new Error('pgvector down')),
      searchKeyword: jest.fn().mockResolvedValue([makeChunk('kw1')]),
    });
    const svc = new RetrievalService(vs, makeStorage());

    // Use a general query so keyword search is active; vector failure should
    // not prevent keyword results from being returned.
    const results = await svc.retrieve('repo-1', 'list all endpoints', EMBEDDING);
    expect(results.length).toBeGreaterThan(0);
  });

  it('handles storage failures gracefully', async () => {
    const vs = makeVectorStore({
      search: jest.fn().mockResolvedValue([makeChunk('v1')]),
    });
    const storage = makeStorage();
    (storage.getCIGNodes as jest.Mock).mockRejectedValue(new Error('DB down'));
    const svc = new RetrievalService(vs, storage);

    // Should not throw; vector results still returned
    const results = await svc.retrieve(
      'repo-1',
      'What does loginUser do?',
      EMBEDDING,
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array when all paths fail', async () => {
    const vs = makeVectorStore({
      search: jest.fn().mockRejectedValue(new Error('fail')),
      searchKeyword: jest.fn().mockRejectedValue(new Error('fail')),
    });
    const storage = makeStorage();
    (storage.getCIGNodes as jest.Mock).mockRejectedValue(new Error('fail'));
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve('repo-1', 'What does loginUser do?', EMBEDDING);
    expect(results).toHaveLength(0);
  });

  it('prioritises exact CIG matches over fuzzy matches', async () => {
    const nodes = [
      makeNode('loginUserFuzzy'),          // fuzzy match on 'login'
      makeNode('login'),                   // exact match
    ];
    const vs = makeVectorStore();
    const storage = makeStorage(nodes);
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve(
      'repo-1',
      'What calls login?',
      EMBEDDING,
    );

    const cigChunks = results.filter(r => r.layer === 'cig_metadata');
    // exact match must appear first
    expect(cigChunks[0].metadata?.symbol).toBe('login');
  });

  it('generates correct CIG synthetic chunk content', async () => {
    const storage = makeStorage([makeNode('fetchUser', 'src/users/repo.ts')]);
    const vs = makeVectorStore();
    const svc = new RetrievalService(vs, storage);

    const results = await svc.retrieve(
      'repo-1',
      'Where is fetchUser?',
      EMBEDDING,
    );

    const cigChunk = results.find(r => r.layer === 'cig_metadata');
    expect(cigChunk).toBeDefined();
    expect(cigChunk!.content).toMatch(/fetchUser/);
    expect(cigChunk!.content).toMatch(/src\/users\/repo\.ts/);
    expect(cigChunk!.metadata?.filePath).toBe('src/users/repo.ts');
    expect(cigChunk!.metadata?.startLine).toBe(1);
    expect(cigChunk!.metadata?.endLine).toBe(20);
  });
});

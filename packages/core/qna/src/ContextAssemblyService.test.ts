import type { CIGEdge, CIGNode, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

import { ContextAssemblyService } from './ContextAssemblyService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(
  chunkId: string,
  opts: {
    layer?: string;
    content?: string;
    filePath?: string;
    symbol?: string;
  } = {},
): VectorChunk {
  return {
    chunkId,
    repoId: 'repo-1',
    content: opts.content ?? `content of ${chunkId}`,
    contentSha: `sha-${chunkId}`,
    layer: opts.layer ?? 'code',
    metadata: {
      filePath: opts.filePath ?? 'src/auth/login.ts',
      symbol: opts.symbol ?? 'loginUser',
    },
  };
}

function makeNode(
  nodeId: string,
  symbolName: string,
  filePath = 'src/auth/login.ts',
  symbolType = 'function',
): CIGNode {
  return {
    nodeId,
    repoId: 'repo-1',
    filePath,
    symbolName,
    symbolType: symbolType as CIGNode['symbolType'],
    startLine: 10,
    endLine: 30,
    exported: true,
    extractedSha: 'sha-node',
  };
}

function makeEdge(
  edgeId: string,
  fromNodeId: string,
  toNodeId: string,
  edgeType: CIGEdge['edgeType'] = 'calls',
): CIGEdge {
  return { edgeId, repoId: 'repo-1', fromNodeId, toNodeId, edgeType };
}

function makeStorage(
  nodes: CIGNode[] = [],
  edges: CIGEdge[] = [],
): StorageAdapter {
  return {
    getCIGNodes: jest.fn().mockResolvedValue(nodes),
    getCIGEdges: jest.fn().mockResolvedValue(edges),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextAssemblyService', () => {
  it('returns empty context for empty chunk list', async () => {
    const svc = new ContextAssemblyService(makeStorage(), makeVectorStore());
    const result = await svc.assemble('repo-1', []);

    expect(result.blocks).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.droppedChunks).toBe(0);
  });

  it('builds callee_ref expansion for a code chunk with calls edges', async () => {
    const node = makeNode('node-login', 'loginUser');
    const callee = makeNode('node-validate', 'validateToken', 'src/auth/helpers.ts');
    const edge = makeEdge('e1', 'node-login', 'node-validate', 'calls');

    const storage = makeStorage([node, callee], [edge]);
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    const chunk = makeChunk('c1', { layer: 'code', filePath: 'src/auth/login.ts', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    expect(result.blocks).toHaveLength(1);
    const calleeExpansions = result.blocks[0].expansions.filter(e => e.type === 'callee_ref');
    expect(calleeExpansions).toHaveLength(1);
    expect(calleeExpansions[0].content).toContain('validateToken');
    expect(calleeExpansions[0].content).toContain('src/auth/helpers.ts');
    expect(calleeExpansions[0].filePath).toBe('src/auth/helpers.ts');
    expect(calleeExpansions[0].symbol).toBe('validateToken');
  });

  it('builds import_list expansion for a code chunk with imports edges', async () => {
    const node = makeNode('node-login', 'loginUser');
    const importedNode = makeNode('node-helper', 'hashPassword', 'src/utils/crypto.ts');
    const importEdge = makeEdge('e1', 'node-login', 'node-helper', 'imports');

    const storage = makeStorage([node, importedNode], [importEdge]);
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    const chunk = makeChunk('c1', { layer: 'code', filePath: 'src/auth/login.ts', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    const importExpansions = result.blocks[0].expansions.filter(e => e.type === 'import_list');
    expect(importExpansions).toHaveLength(1);
    expect(importExpansions[0].content).toContain('src/utils/crypto.ts');
    expect(importExpansions[0].filePath).toBe('src/auth/login.ts');
  });

  it('builds doc_link expansion when vector store returns a doc_section chunk', async () => {
    const docChunk = makeChunk('doc-chunk-1', {
      layer: 'doc_section',
      content: 'Authentication module handles login and session management.',
    });

    const vs = makeVectorStore({
      searchKeyword: jest.fn().mockResolvedValue([docChunk]),
    });
    const svc = new ContextAssemblyService(makeStorage(), vs);

    const chunk = makeChunk('c1', { layer: 'code', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    const docExpansions = result.blocks[0].expansions.filter(e => e.type === 'doc_link');
    expect(docExpansions).toHaveLength(1);
    expect(docExpansions[0].content).toContain('Authentication module');
    // Must use the real layer name 'doc_section' (not 'doc')
    expect(vs.searchKeyword).toHaveBeenCalledWith('repo-1', 'loginUser', 2, ['doc_section']);
  });

  it('skips callee and import expansions for non-code layers', async () => {
    const node = makeNode('node-login', 'loginUser');
    const callee = makeNode('node-validate', 'validateToken', 'src/auth/helpers.ts');
    const edge = makeEdge('e1', 'node-login', 'node-validate', 'calls');

    const storage = makeStorage([node, callee], [edge]);
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    // doc layer chunk — no callee/import expansions
    const chunk: VectorChunk = {
      chunkId: 'doc-1',
      repoId: 'repo-1',
      content: 'Some doc content',
      contentSha: 'sha-doc',
      layer: 'doc',
      metadata: { filePath: 'src/auth/login.ts', symbol: 'loginUser' },
    };
    const result = await svc.assemble('repo-1', [chunk]);

    const calleeExp = result.blocks[0].expansions.filter(e => e.type === 'callee_ref');
    const importExp = result.blocks[0].expansions.filter(e => e.type === 'import_list');
    expect(calleeExp).toHaveLength(0);
    expect(importExp).toHaveLength(0);
  });

  it('skips doc_link search for doc_section and diagram_desc layer chunks', async () => {
    const vs = makeVectorStore({
      searchKeyword: jest.fn().mockResolvedValue([]),
    });
    const svc = new ContextAssemblyService(makeStorage(), vs);

    const docChunk: VectorChunk = {
      chunkId: 'doc-1',
      repoId: 'repo-1',
      content: 'doc content',
      contentSha: 'sha',
      layer: 'doc_section',
      metadata: { symbol: 'overview' },
    };
    const diagramChunk: VectorChunk = {
      chunkId: 'diagram-1',
      repoId: 'repo-1',
      content: 'diagram content',
      contentSha: 'sha',
      layer: 'diagram_desc',
      metadata: {},
    };

    await svc.assemble('repo-1', [docChunk, diagramChunk]);

    expect(vs.searchKeyword).not.toHaveBeenCalled();
  });

  it('enforces token budget by dropping least-relevant blocks from the tail', async () => {
    // No doc_link expansions: use file_summary layer (not in DOC_SEARCH_LAYERS)
    // and no CIG data so callee/import expansions are also absent.
    // Each chunk: 200 chars = exactly 50 tokens. Budget = 50 → only 1 block fits.
    const svc = new ContextAssemblyService(makeStorage(), makeVectorStore(), {
      maxContextTokens: 50,
    });

    const chunks = [
      makeChunk('c1', { content: 'A'.repeat(200), layer: 'file_summary' }),
      makeChunk('c2', { content: 'B'.repeat(200), layer: 'file_summary' }),
      makeChunk('c3', { content: 'C'.repeat(200), layer: 'file_summary' }),
    ];

    const result = await svc.assemble('repo-1', chunks);

    expect(result.truncated).toBe(true);
    expect(result.blocks).toHaveLength(1);       // exactly 1 block retained
    expect(result.droppedChunks).toBe(2);        // 2 tail blocks dropped
    expect(result.totalTokens).toBe(50);         // exactly 200 chars / 4 = 50 tokens
    expect(result.blocks[0].chunk.chunkId).toBe('c1'); // most relevant block kept
  });

  it('does not set truncated when total is within budget', async () => {
    const svc = new ContextAssemblyService(makeStorage(), makeVectorStore(), {
      maxContextTokens: 10000,
    });

    const chunks = [makeChunk('c1', { content: 'short content' })];
    const result = await svc.assemble('repo-1', chunks);

    expect(result.truncated).toBe(false);
    expect(result.droppedChunks).toBe(0);
  });

  it('handles storage failure gracefully — returns chunks without CIG expansions', async () => {
    const storage = makeStorage();
    (storage.getCIGNodes as jest.Mock).mockRejectedValue(new Error('DB down'));
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    const chunk = makeChunk('c1', { layer: 'code', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    expect(result.blocks).toHaveLength(1);
    // No CIG-based expansions (callee/import), but doc_link search may still run
    const calleeExp = result.blocks[0].expansions.filter(e => e.type === 'callee_ref');
    const importExp = result.blocks[0].expansions.filter(e => e.type === 'import_list');
    expect(calleeExp).toHaveLength(0);
    expect(importExp).toHaveLength(0);
  });

  it('handles vector store failure gracefully — no doc_link, still returns chunk', async () => {
    const vs = makeVectorStore({
      searchKeyword: jest.fn().mockRejectedValue(new Error('vector store down')),
    });
    const svc = new ContextAssemblyService(makeStorage(), vs);

    const chunk = makeChunk('c1', { layer: 'code', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    expect(result.blocks).toHaveLength(1);
    const docExp = result.blocks[0].expansions.filter(e => e.type === 'doc_link');
    expect(docExp).toHaveLength(0);
  });

  it('deduplicates import paths from multiple nodes in the same file', async () => {
    // Two nodes in the same file both import the same target
    const node1 = makeNode('n1', 'loginUser', 'src/auth/login.ts');
    const node2 = makeNode('n2', 'logoutUser', 'src/auth/login.ts');
    const targetNode = makeNode('n3', 'hashPassword', 'src/utils/crypto.ts');

    const edges: CIGEdge[] = [
      makeEdge('e1', 'n1', 'n3', 'imports'),
      makeEdge('e2', 'n2', 'n3', 'imports'), // duplicate target
    ];

    const storage = makeStorage([node1, node2, targetNode], edges);
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    const chunk = makeChunk('c1', { layer: 'code', filePath: 'src/auth/login.ts', symbol: 'loginUser' });
    const result = await svc.assemble('repo-1', [chunk]);

    const importExp = result.blocks[0].expansions.filter(e => e.type === 'import_list');
    expect(importExp).toHaveLength(1);
    // 'src/utils/crypto.ts' should appear only once
    const occurrences = importExp[0].content.split('src/utils/crypto.ts').length - 1;
    expect(occurrences).toBe(1);
  });

  it('limits callee expansions to max 3 per code chunk', async () => {
    const node = makeNode('node-main', 'mainFunction');
    const callees = Array.from({ length: 5 }, (_, i) =>
      makeNode(`node-callee-${i}`, `helper${i}`, `src/utils/h${i}.ts`),
    );
    const edges = callees.map((c, i) =>
      makeEdge(`e${i}`, 'node-main', c.nodeId, 'calls'),
    );

    const storage = makeStorage([node, ...callees], edges);
    const svc = new ContextAssemblyService(storage, makeVectorStore());

    const chunk = makeChunk('c1', { layer: 'code', filePath: 'src/auth/login.ts', symbol: 'mainFunction' });
    const result = await svc.assemble('repo-1', [chunk]);

    const calleeExp = result.blocks[0].expansions.filter(e => e.type === 'callee_ref');
    expect(calleeExp.length).toBeLessThanOrEqual(3);
  });

  it('truncates callee snippet content to maxCalleeTokens', async () => {
    const node = makeNode('node-a', 'longSymbol');
    // Callee with a very long symbol name / path
    const calleeNode: CIGNode = {
      nodeId: 'node-b',
      repoId: 'repo-1',
      filePath: 'src/' + 'very/deep/'.repeat(20) + 'file.ts',
      symbolName: 'aVeryLongSymbolNameThatExceedsLimit',
      symbolType: 'function',
      startLine: 1,
      endLine: 100,
      exported: true,
      extractedSha: 'sha',
    };
    const edge = makeEdge('e1', 'node-a', 'node-b', 'calls');
    const storage = makeStorage([node, calleeNode], [edge]);

    const svc = new ContextAssemblyService(storage, makeVectorStore(), {
      maxCalleeTokens: 10, // very small limit
    });

    const chunk = makeChunk('c1', { layer: 'code', filePath: 'src/auth/login.ts', symbol: 'longSymbol' });
    const result = await svc.assemble('repo-1', [chunk]);

    const calleeExp = result.blocks[0].expansions.filter(e => e.type === 'callee_ref');
    if (calleeExp.length > 0) {
      // 10 tokens * 4 chars/token = 40 chars max
      expect(calleeExp[0].content.length).toBeLessThanOrEqual(40);
    }
  });

  it('does not include doc_link that is the same as the current chunk', async () => {
    const chunk = makeChunk('same-chunk-id', { layer: 'code', symbol: 'loginUser' });

    const vs = makeVectorStore({
      searchKeyword: jest.fn().mockResolvedValue([
        // Returns the same chunk — should be skipped
        { ...chunk },
      ]),
    });
    const svc = new ContextAssemblyService(makeStorage(), vs);

    const result = await svc.assemble('repo-1', [chunk]);

    const docExp = result.blocks[0].expansions.filter(e => e.type === 'doc_link');
    expect(docExp).toHaveLength(0);
  });

  it('computes totalTokens as sum of all block tokens', async () => {
    const svc = new ContextAssemblyService(makeStorage(), makeVectorStore());

    const chunks = [
      makeChunk('c1', { content: 'A'.repeat(40), layer: 'code' }), // 10 tokens
      makeChunk('c2', { content: 'B'.repeat(40), layer: 'code' }), // 10 tokens
    ];
    const result = await svc.assemble('repo-1', chunks);

    expect(result.totalTokens).toBe(
      result.blocks.reduce((sum, b) => sum + b.totalTokens, 0),
    );
  });
});

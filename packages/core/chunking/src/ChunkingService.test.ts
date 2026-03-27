import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  Artifact,
  ArtifactInput,
  ArtifactType,
  CIGEdge,
  CIGNode,
  DiagramContent,
  DocContent,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

import {
  ChunkingService,
  buildChunkId,
  buildDiagramChunkText,
  computeCompositeSha,
  estimateTokens,
} from './ChunkingService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CIGNode> = {}): CIGNode {
  return {
    nodeId: 'node-1',
    repoId: 'repo-1',
    filePath: 'src/auth.ts',
    symbolName: 'login',
    symbolType: 'function',
    startLine: 1,
    endLine: 5,
    exported: true,
    extractedSha: 'sha-abc',
    metadata: null,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<CIGEdge> = {}): CIGEdge {
  return {
    edgeId: 'edge-1',
    repoId: 'repo-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    edgeType: 'calls',
    ...overrides,
  };
}

function makeRepoFile(overrides: Partial<RepoFile> = {}): RepoFile {
  return {
    repoId: 'repo-1',
    filePath: 'src/auth.ts',
    currentSha: 'sha-current',
    lastProcessedSha: 'sha-current',
    fileType: 'source',
    language: 'typescript',
    parseStatus: 'parsed',
    ...overrides,
  };
}

function makeDocArtifact(
  module: string,
  markdown: string,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    repoId: 'repo-1',
    artifactId: `doc:${module}`,
    artifactType: 'doc',
    content: { kind: 'doc', module, markdown } as DocContent,
    inputSha: 'sha-input',
    promptVersion: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 100,
    llmUsed: true,
    generatedAt: new Date(),
    ...overrides,
  };
}

function makeDiagramArtifact(
  diagramType: string,
  mermaid: string,
  title?: string,
  description?: string,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    repoId: 'repo-1',
    artifactId: `diagram:${diagramType}`,
    artifactType: 'diagram',
    content: {
      kind: 'diagram',
      diagramType,
      mermaid,
      title,
      description,
    } as DiagramContent,
    inputSha: 'sha-input',
    promptVersion: null,
    isStale: false,
    staleReason: null,
    tokensUsed: 0,
    llmUsed: false,
    generatedAt: new Date(),
    ...overrides,
  };
}

/** Create a minimal mock StorageAdapter. */
function createMockStorage(opts: {
  nodes?: CIGNode[];
  edges?: CIGEdge[];
  repoFiles?: RepoFile[];
  docArtifacts?: Artifact[];
  diagramArtifacts?: Artifact[];
  artifactInputs?: Map<string, ArtifactInput[]>;
}): StorageAdapter {
  const artifactInputs = opts.artifactInputs ?? new Map();

  return {
    getCIGNodes: jest.fn().mockResolvedValue(opts.nodes ?? []),
    getCIGEdges: jest.fn().mockResolvedValue(opts.edges ?? []),
    getRepoFiles: jest.fn().mockResolvedValue(opts.repoFiles ?? []),
    getArtifactsByType: jest.fn().mockImplementation(
      (_repoId: string, type: ArtifactType) => {
        if (type === 'doc') return Promise.resolve(opts.docArtifacts ?? []);
        if (type === 'diagram') return Promise.resolve(opts.diagramArtifacts ?? []);
        return Promise.resolve([]);
      },
    ),
    getArtifactInputs: jest.fn().mockImplementation(
      (_repoId: string, artifactId: string) => {
        return Promise.resolve(artifactInputs.get(artifactId) ?? []);
      },
    ),
    // Unused methods — stub them
    getRepo: jest.fn(),
    upsertRepo: jest.fn(),
    updateRepoStatus: jest.fn(),
    upsertRepoFiles: jest.fn(),
    getChangedRepoFiles: jest.fn(),
    upsertCIGNodes: jest.fn(),
    upsertCIGEdges: jest.fn(),
    deleteCIGForFiles: jest.fn(),
    deleteRepoFilesNotIn: jest.fn(),
    upsertArtifact: jest.fn(),
    getArtifact: jest.fn(),
    getStaleArtifacts: jest.fn(),
    markArtifactsStale: jest.fn(),
    upsertArtifactInputs: jest.fn(),
    getArtifactIdsByFilePaths: jest.fn(),
    getArtifactDependents: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    getJob: jest.fn(),
    getActiveJobForRepo: jest.fn(),
  } as unknown as StorageAdapter;
}

/** Create a temp directory with source files for testing. */
async function createTempRepo(
  files: Record<string, string>,
): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunking-test-'));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
  return tmpDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChunkingService', () => {
  let cloneDir: string;

  afterEach(async () => {
    if (cloneDir) {
      await fs.rm(cloneDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Unit tests for pure functions
  // -----------------------------------------------------------------------

  describe('estimateTokens', () => {
    it('estimates ~3 chars per token by default', () => {
      expect(estimateTokens('abc')).toBe(1);
      expect(estimateTokens('abcdef')).toBe(2);
      expect(estimateTokens('a')).toBe(1); // ceil
      expect(estimateTokens('')).toBe(0);
    });

    it('respects a custom charsPerToken override', () => {
      expect(estimateTokens('abcd', 4)).toBe(1);
      expect(estimateTokens('abcdefgh', 4)).toBe(2);
      expect(estimateTokens('ab', 4)).toBe(1); // ceil
    });
  });

  describe('buildChunkId', () => {
    it('builds stable chunk ID', () => {
      const id = buildChunkId('repo-1', 'src/auth.ts', 'login', 'code');
      expect(id).toBe('repo-1:src/auth.ts:login:code');
    });

    it('is deterministic across calls', () => {
      const a = buildChunkId('r', 'f', 's', 'l');
      const b = buildChunkId('r', 'f', 's', 'l');
      expect(a).toBe(b);
    });
  });

  describe('buildDiagramChunkText', () => {
    it('combines title, description, and mermaid', () => {
      const text = buildDiagramChunkText({
        kind: 'diagram',
        diagramType: 'flowchart',
        mermaid: 'graph TD\n  A-->B',
        title: 'Auth Flow',
        description: 'Shows authentication flow',
      });
      expect(text).toContain('# Auth Flow');
      expect(text).toContain('Shows authentication flow');
      expect(text).toContain('```mermaid');
    });

    it('returns null for empty diagram', () => {
      const text = buildDiagramChunkText({
        kind: 'diagram',
        diagramType: 'flowchart',
        mermaid: '',
      });
      expect(text).toBeNull();
    });

    it('works with only mermaid source', () => {
      const text = buildDiagramChunkText({
        kind: 'diagram',
        diagramType: 'flowchart',
        mermaid: 'graph TD\n  A-->B',
      });
      expect(text).toContain('```mermaid');
      expect(text).not.toContain('# ');
    });
  });

  describe('computeCompositeSha', () => {
    it('produces deterministic output', () => {
      const inputs = [
        { filePath: 'a.ts', fileSha: 'sha1' },
        { filePath: 'b.ts', fileSha: 'sha2' },
      ];
      const a = computeCompositeSha(inputs);
      const b = computeCompositeSha(inputs);
      expect(a).toBe(b);
    });

    it('is order-independent (sorts by filePath internally)', () => {
      const a = computeCompositeSha([
        { filePath: 'a.ts', fileSha: 'sha1' },
        { filePath: 'b.ts', fileSha: 'sha2' },
      ]);
      const b = computeCompositeSha([
        { filePath: 'b.ts', fileSha: 'sha2' },
        { filePath: 'a.ts', fileSha: 'sha1' },
      ]);
      expect(a).toBe(b);
    });

    it('produces different output for different inputs', () => {
      const a = computeCompositeSha([{ filePath: 'a.ts', fileSha: 'sha1' }]);
      const b = computeCompositeSha([{ filePath: 'a.ts', fileSha: 'sha2' }]);
      expect(a).not.toBe(b);
    });

    it('returns "empty" for empty array', () => {
      expect(computeCompositeSha([])).toBe('empty');
    });

    it('includes filePath in hash (different paths with same SHA differ)', () => {
      const a = computeCompositeSha([{ filePath: 'a.ts', fileSha: 'sha1' }]);
      const b = computeCompositeSha([{ filePath: 'b.ts', fileSha: 'sha1' }]);
      expect(a).not.toBe(b);
    });
  });

  // -----------------------------------------------------------------------
  // Integration tests — chunkRepo
  // -----------------------------------------------------------------------

  describe('chunkRepo', () => {
    it('creates code chunks from CIG nodes', async () => {
      cloneDir = await createTempRepo({
        'src/auth.ts': 'function login(user: string) {\n  return true;\n}\n\nexport default login;',
      });

      const storage = createMockStorage({
        nodes: [
          makeNode({
            nodeId: 'n1',
            filePath: 'src/auth.ts',
            symbolName: 'login',
            startLine: 1,
            endLine: 3,
          }),
        ],
        repoFiles: [makeRepoFile({ filePath: 'src/auth.ts', currentSha: 'sha-1' })],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBe(1);
      expect(result.chunks[0].chunkId).toBe('repo-1:src/auth.ts:login:code');
      expect(result.chunks[0].content).toContain('function login');
      expect(result.chunks[0].layer).toBe('code');
      expect(result.chunks[0].fileSha).toBe('sha-1');
      expect(result.chunks[0].metadata.symbol).toBe('login');
      expect(result.chunks[0].metadata.symbolType).toBe('function');
      expect(result.chunks[0].metadata.exported).toBe(true);
      expect(result.chunks[0].metadata.language).toBe('typescript');
    });

    it('populates calls and calledBy metadata from edges', async () => {
      cloneDir = await createTempRepo({
        'src/auth.ts': 'function login() { return validate(); }',
        'src/validate.ts': 'function validate() { return true; }',
      });

      const nodes = [
        makeNode({ nodeId: 'n1', filePath: 'src/auth.ts', symbolName: 'login', startLine: 1, endLine: 1 }),
        makeNode({ nodeId: 'n2', filePath: 'src/validate.ts', symbolName: 'validate', startLine: 1, endLine: 1 }),
      ];

      const edges = [
        makeEdge({ edgeId: 'e1', fromNodeId: 'n1', toNodeId: 'n2', edgeType: 'calls' }),
      ];

      const storage = createMockStorage({
        nodes,
        edges,
        repoFiles: [
          makeRepoFile({ filePath: 'src/auth.ts' }),
          makeRepoFile({ filePath: 'src/validate.ts' }),
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      const loginChunk = result.chunks.find(c => c.metadata.symbol === 'login');
      const validateChunk = result.chunks.find(c => c.metadata.symbol === 'validate');

      expect(loginChunk?.metadata.calls).toEqual(['src/validate.ts:validate']);
      expect(loginChunk?.metadata.calledBy).toBeUndefined();
      expect(validateChunk?.metadata.calledBy).toEqual(['src/auth.ts:login']);
      expect(validateChunk?.metadata.calls).toBeUndefined();
    });

    it('creates doc chunks from doc artifacts', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [
          makeDocArtifact('overview', '# Overview\n\nThis is the overview.'),
        ],
        artifactInputs: new Map([
          ['doc:overview', [{ repoId: 'repo-1', artifactId: 'doc:overview', filePath: 'src/index.ts', fileSha: 'sha-f1' }]],
        ]),
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.docChunks).toBe(1);
      const chunk = result.chunks.find(c => c.layer === 'doc_section');
      expect(chunk).toBeDefined();
      expect(chunk!.chunkId).toBe('repo-1:doc:overview:overview:doc');
      expect(chunk!.content).toContain('# Overview');
      expect(chunk!.metadata.module).toBe('overview');
    });

    it('creates diagram chunks from diagram artifacts', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        diagramArtifacts: [
          makeDiagramArtifact(
            'dependency-graph',
            'graph TD\n  A-->B',
            'Dependencies',
            'Shows module dependencies',
          ),
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.diagramChunks).toBe(1);
      const chunk = result.chunks.find(c => c.layer === 'diagram_desc');
      expect(chunk).toBeDefined();
      expect(chunk!.content).toContain('Dependencies');
      expect(chunk!.content).toContain('Shows module dependencies');
      expect(chunk!.metadata.diagramType).toBe('dependency-graph');
    });

    it('skips diagrams without description or mermaid', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        diagramArtifacts: [
          makeDiagramArtifact('empty', '', undefined, undefined),
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.diagramChunks).toBe(0);
    });

    it('skips nodes whose source file cannot be read', async () => {
      cloneDir = await createTempRepo({}); // no files

      const storage = createMockStorage({
        nodes: [makeNode({ filePath: 'nonexistent.ts' })],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBe(0);
    });

    it('skips doc artifacts with empty markdown', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [makeDocArtifact('empty', '  ')],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.docChunks).toBe(0);
    });

    it('uses extractedSha as fallback when repoFile not found', async () => {
      cloneDir = await createTempRepo({
        'src/orphan.ts': 'const x = 1;',
      });

      const storage = createMockStorage({
        nodes: [
          makeNode({
            nodeId: 'n1',
            filePath: 'src/orphan.ts',
            symbolName: 'x',
            symbolType: 'variable',
            startLine: 1,
            endLine: 1,
            extractedSha: 'extracted-sha',
          }),
        ],
        repoFiles: [], // no repo files
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.chunks[0].fileSha).toBe('extracted-sha');
    });

    it('handles multiple nodes across multiple files', async () => {
      cloneDir = await createTempRepo({
        'src/a.ts': 'function alpha() {}\nfunction beta() {}',
        'src/b.ts': 'class Gamma {}',
      });

      const storage = createMockStorage({
        nodes: [
          makeNode({ nodeId: 'n1', filePath: 'src/a.ts', symbolName: 'alpha', startLine: 1, endLine: 1 }),
          makeNode({ nodeId: 'n2', filePath: 'src/a.ts', symbolName: 'beta', startLine: 2, endLine: 2 }),
          makeNode({ nodeId: 'n3', filePath: 'src/b.ts', symbolName: 'Gamma', symbolType: 'class', startLine: 1, endLine: 1 }),
        ],
        repoFiles: [
          makeRepoFile({ filePath: 'src/a.ts' }),
          makeRepoFile({ filePath: 'src/b.ts' }),
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBe(3);
      expect(result.stats.totalChunks).toBe(3);
    });

    it('combines code, doc, and diagram chunks in result', async () => {
      cloneDir = await createTempRepo({
        'src/main.ts': 'function main() { console.log("hello"); }',
      });

      const storage = createMockStorage({
        nodes: [makeNode({ filePath: 'src/main.ts', symbolName: 'main', startLine: 1, endLine: 1 })],
        repoFiles: [makeRepoFile({ filePath: 'src/main.ts' })],
        docArtifacts: [makeDocArtifact('overview', 'Some docs')],
        diagramArtifacts: [makeDiagramArtifact('dep', 'graph TD\nA-->B', 'Deps', 'Dep diagram')],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBe(1);
      expect(result.stats.docChunks).toBe(1);
      expect(result.stats.diagramChunks).toBe(1);
      expect(result.stats.totalChunks).toBe(3);
      expect(result.chunks.map(c => c.layer).sort()).toEqual(['code', 'diagram_desc', 'doc_section']);
    });
  });

  // -----------------------------------------------------------------------
  // Oversized chunk splitting
  // -----------------------------------------------------------------------

  describe('oversized chunk splitting', () => {
    it('splits oversized code chunks at blank line boundaries', async () => {
      // Create a file with ~200 lines (well over 1000 tokens at ~4 chars/token)
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`  const var${i} = "value_${i}_padding_to_make_this_longer_than_usual";`);
        if (i % 20 === 19) lines.push(''); // blank lines every 20 lines
      }
      const sourceCode = lines.join('\n');

      cloneDir = await createTempRepo({ 'src/big.ts': sourceCode });

      const storage = createMockStorage({
        nodes: [
          makeNode({
            filePath: 'src/big.ts',
            symbolName: 'bigFunction',
            startLine: 1,
            endLine: lines.length,
          }),
        ],
        repoFiles: [makeRepoFile({ filePath: 'src/big.ts' })],
      });

      // Use a low token limit to force splitting
      const svc = new ChunkingService(storage, undefined, { maxChunkTokens: 200 });
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBeGreaterThan(1);
      expect(result.stats.oversizedSplit).toBeGreaterThan(0);

      // All sub-chunks should have sub-chunk metadata
      for (const chunk of result.chunks) {
        expect(chunk.metadata.subChunkIndex).toBeDefined();
        expect(chunk.metadata.totalSubChunks).toBeDefined();
        expect(chunk.chunkId).toMatch(/:\d+$/);
      }
    });

    it('splits oversized doc chunks at paragraph boundaries', async () => {
      const paragraphs = Array.from(
        { length: 20 },
        (_, i) => `This is paragraph ${i} with enough text to make it substantial for token counting purposes. ` +
          'Adding more text here to ensure we cross the token threshold when combined.',
      );
      const markdown = paragraphs.join('\n\n');

      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [makeDocArtifact('big-doc', markdown)],
      });

      const svc = new ChunkingService(storage, undefined, { maxChunkTokens: 100 });
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.docChunks).toBeGreaterThan(1);
      expect(result.stats.oversizedSplit).toBeGreaterThan(0);
    });

    it('force-splits code without blank lines', async () => {
      // Dense code with no blank lines
      const lines = Array.from(
        { length: 100 },
        (_, i) => `  statements_line_${i}_with_padding_to_ensure_token_count_is_high_enough_for_splitting;`,
      );
      const sourceCode = lines.join('\n');

      cloneDir = await createTempRepo({ 'src/dense.ts': sourceCode });

      const storage = createMockStorage({
        nodes: [
          makeNode({
            filePath: 'src/dense.ts',
            symbolName: 'denseFunc',
            startLine: 1,
            endLine: 100,
          }),
        ],
        repoFiles: [makeRepoFile({ filePath: 'src/dense.ts' })],
      });

      const svc = new ChunkingService(storage, undefined, { maxChunkTokens: 200 });
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBeGreaterThan(1);
      // Every sub-chunk should have content
      for (const chunk of result.chunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it('does not split chunks under the token limit', async () => {
      cloneDir = await createTempRepo({
        'src/small.ts': 'const x = 1;',
      });

      const storage = createMockStorage({
        nodes: [
          makeNode({
            filePath: 'src/small.ts',
            symbolName: 'x',
            symbolType: 'variable',
            startLine: 1,
            endLine: 1,
          }),
        ],
        repoFiles: [makeRepoFile({ filePath: 'src/small.ts' })],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.codeChunks).toBe(1);
      expect(result.stats.oversizedSplit).toBe(0);
      expect(result.chunks[0].metadata.subChunkIndex).toBeUndefined();
    });

    it('does not split diagram chunks (emits single chunk regardless of size)', async () => {
      cloneDir = await createTempRepo({});

      const largeMermaid = Array.from(
        { length: 200 },
        (_, i) => `  node${i}["Module ${i} with a long label to increase token count"] --> node${i + 1}`,
      ).join('\n');

      const storage = createMockStorage({
        diagramArtifacts: [
          makeDiagramArtifact(
            'huge-diagram',
            `graph TD\n${largeMermaid}`,
            'Huge Diagram',
            'A very large diagram for testing oversized behavior.',
          ),
        ],
      });

      const svc = new ChunkingService(storage, undefined, { maxChunkTokens: 100 });
      const result = await svc.chunkRepo('repo-1', cloneDir);

      // Diagrams are not split — single chunk emitted
      expect(result.stats.diagramChunks).toBe(1);
      expect(result.chunks[0].metadata.subChunkIndex).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Chunk ID stability
  // -----------------------------------------------------------------------

  describe('chunk ID stability', () => {
    it('produces identical chunk IDs across multiple runs', async () => {
      cloneDir = await createTempRepo({
        'src/stable.ts': 'function stable() { return 42; }',
      });

      const storage = createMockStorage({
        nodes: [
          makeNode({ filePath: 'src/stable.ts', symbolName: 'stable', startLine: 1, endLine: 1 }),
        ],
        repoFiles: [makeRepoFile({ filePath: 'src/stable.ts' })],
      });

      const svc = new ChunkingService(storage);
      const result1 = await svc.chunkRepo('repo-1', cloneDir);
      const result2 = await svc.chunkRepo('repo-1', cloneDir);

      expect(result1.chunks.map(c => c.chunkId)).toEqual(
        result2.chunks.map(c => c.chunkId),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('uses lexicographically first filePath for multi-input artifacts', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [makeDocArtifact('overview', 'Some overview text')],
        artifactInputs: new Map([
          ['doc:overview', [
            { repoId: 'repo-1', artifactId: 'doc:overview', filePath: 'src/z.ts', fileSha: 'sha-z' },
            { repoId: 'repo-1', artifactId: 'doc:overview', filePath: 'src/a.ts', fileSha: 'sha-a' },
            { repoId: 'repo-1', artifactId: 'doc:overview', filePath: 'src/m.ts', fileSha: 'sha-m' },
          ]],
        ]),
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.chunks[0].filePath).toBe('src/a.ts');
    });

    it('handles empty repo (no nodes, no artifacts)', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({});
      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.totalChunks).toBe(0);
      expect(result.chunks).toEqual([]);
    });

    it('handles artifacts with null content', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [
          {
            ...makeDocArtifact('broken', 'text'),
            content: null,
          },
        ],
        diagramArtifacts: [
          {
            ...makeDiagramArtifact('broken', 'mermaid'),
            content: null,
          },
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.totalChunks).toBe(0);
    });

    it('uses inputSha as fallback when no artifact inputs exist', async () => {
      cloneDir = await createTempRepo({});

      const storage = createMockStorage({
        docArtifacts: [makeDocArtifact('orphan', 'Some orphan doc')],
        // No artifact inputs mapped
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      expect(result.stats.docChunks).toBe(1);
      expect(result.chunks[0].fileSha).toBe('sha-input');
    });

    it('only counts "calls" edge type for calls/calledBy', async () => {
      cloneDir = await createTempRepo({
        'src/a.ts': 'import { B } from "./b";\nclass A extends B {}',
        'src/b.ts': 'class B {}',
      });

      const nodes = [
        makeNode({ nodeId: 'n1', filePath: 'src/a.ts', symbolName: 'A', symbolType: 'class', startLine: 1, endLine: 2 }),
        makeNode({ nodeId: 'n2', filePath: 'src/b.ts', symbolName: 'B', symbolType: 'class', startLine: 1, endLine: 1 }),
      ];

      const edges = [
        makeEdge({ edgeId: 'e1', fromNodeId: 'n1', toNodeId: 'n2', edgeType: 'imports' }),
        makeEdge({ edgeId: 'e2', fromNodeId: 'n1', toNodeId: 'n2', edgeType: 'extends' }),
      ];

      const storage = createMockStorage({
        nodes,
        edges,
        repoFiles: [
          makeRepoFile({ filePath: 'src/a.ts' }),
          makeRepoFile({ filePath: 'src/b.ts' }),
        ],
      });

      const svc = new ChunkingService(storage);
      const result = await svc.chunkRepo('repo-1', cloneDir);

      // Neither chunk should have calls/calledBy since edges are imports/extends
      for (const chunk of result.chunks) {
        expect(chunk.metadata.calls).toBeUndefined();
        expect(chunk.metadata.calledBy).toBeUndefined();
      }
    });
  });
});

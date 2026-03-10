import type { RepoFile } from '@codeinsight/types';

import { CIGBuilder } from './CIGBuilder';
import type { LanguageExtractor } from './types';

// ---------------------------------------------------------------------------
// 2. CIGBuilder dispatcher
// ---------------------------------------------------------------------------

describe('CIGBuilder', () => {
  const makeFile = (filePath: string, language: string): RepoFile => ({
    repoId: 'repo-1',
    filePath,
    currentSha: 'abc123',
    fileType: 'source',
    language,
    parseStatus: 'pending',
  });

  // Minimal stub extractor for testing dispatch
  const stubExtractor: LanguageExtractor = {
    languages: ['typescript', 'javascript'],
    extractSymbols: (_tree, file, repoId) => [
      {
        nodeId: `${repoId}:${file.filePath}:stub`,
        repoId,
        filePath: file.filePath,
        symbolName: 'stub',
        symbolType: 'function',
        startLine: 1,
        endLine: 3,
        exported: true,
        extractedSha: file.currentSha,
      },
    ],
    extractEdges: () => [],
  };

  it('dispatches to a registered extractor', () => {
    const builder = new CIGBuilder();
    builder.registerExtractor(stubExtractor);

    const result = builder.build('repo-1', [
      { file: makeFile('src/index.ts', 'typescript'), content: 'export const x = 1;' },
    ]);

    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
    // stub symbol + <module> node = 2
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.find(n => n.symbolName === 'stub')).toBeDefined();
    expect(result.nodes.find(n => n.symbolName === '<module>')).toBeDefined();
  });

  it('skips files with no registered extractor', () => {
    const builder = new CIGBuilder();
    builder.registerExtractor(stubExtractor);

    const result = builder.build('repo-1', [
      { file: makeFile('main.py', 'python'), content: 'print("hello")' },
    ]);

    expect(result.filesProcessed).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(result.nodes).toHaveLength(0);
  });

  it('skips files exceeding max size', () => {
    const builder = new CIGBuilder({ maxFileSizeBytes: 10 });
    builder.registerExtractor(stubExtractor);

    const result = builder.build('repo-1', [
      { file: makeFile('src/big.ts', 'typescript'), content: 'x'.repeat(100) },
    ]);

    expect(result.filesProcessed).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('max size');
  });

  it('skips files with null language', () => {
    const builder = new CIGBuilder();
    builder.registerExtractor(stubExtractor);

    const file = makeFile('README.md', 'markdown');
    file.language = null;

    const result = builder.build('repo-1', [
      { file, content: '# Hello' },
    ]);

    expect(result.filesSkipped).toBe(1);
    expect(result.filesProcessed).toBe(0);
  });

  it('extracts edges in pass 2 using cached trees', () => {
    const edgeExtractor: LanguageExtractor = {
      languages: ['typescript'],
      extractSymbols: (_tree, file, repoId) => [
        {
          nodeId: `${repoId}:${file.filePath}:fn`,
          repoId,
          filePath: file.filePath,
          symbolName: 'myFn',
          symbolType: 'function',
          startLine: 1,
          endLine: 3,
          exported: true,
          extractedSha: file.currentSha,
        },
      ],
      extractEdges: (_tree, file, repoId, nodesByFile) => {
        const edges = [];
        // Simulate cross-file edge: a.ts imports from b.ts
        if (file.filePath === 'src/a.ts') {
          const bNodes = nodesByFile.get('src/b.ts');
          if (bNodes && bNodes.length > 0) {
            edges.push({
              edgeId: `${repoId}:edge-1`,
              repoId,
              fromNodeId: `${repoId}:src/a.ts:fn`,
              toNodeId: bNodes[0].nodeId,
              edgeType: 'imports' as const,
            });
          }
        }
        return edges;
      },
    };

    const builder = new CIGBuilder();
    builder.registerExtractor(edgeExtractor);

    const result = builder.build('repo-1', [
      { file: makeFile('src/a.ts', 'typescript'), content: 'import { x } from "./b";' },
      { file: makeFile('src/b.ts', 'typescript'), content: 'export const x = 1;' },
    ]);

    // 2 myFn symbols + 2 module nodes = 4
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].edgeType).toBe('imports');
    expect(result.edges[0].fromNodeId).toBe('repo-1:src/a.ts:fn');
    expect(result.edges[0].toNodeId).toBe('repo-1:src/b.ts:fn');
  });
});

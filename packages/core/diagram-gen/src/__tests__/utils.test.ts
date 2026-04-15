import type { CIGSnapshot } from '../types';
import { buildFileSummaryBlock, extractMermaid } from '../utils';

describe('extractMermaid()', () => {
  // -------------------------------------------------------------------------
  // Happy path — plain Mermaid (no fences)
  // -------------------------------------------------------------------------

  it('returns plain graph TD content as-is', () => {
    const input = 'graph TD\n  A --> B';
    expect(extractMermaid(input)).toBe(input);
  });

  it('returns plain erDiagram content as-is', () => {
    const input = 'erDiagram\n  User ||--o{ Post : "has"';
    expect(extractMermaid(input)).toBe(input);
  });

  it('returns plain sequenceDiagram content as-is', () => {
    const input = 'sequenceDiagram\n  Alice->>Bob: Hello';
    expect(extractMermaid(input)).toBe(input);
  });

  it('handles all valid Mermaid starters', () => {
    const starters = [
      'graph TD\n  A --> B',
      'flowchart LR\n  X --> Y',
      'sequenceDiagram\n  A->>B: msg',
      'erDiagram\n  T { string id }',
      'stateDiagram\n  [*] --> s1',
      'classDiagram\n  class Foo',
      'gantt\n  title Project',
      'pie\n  title Slices',
      'gitGraph\n  commit',
      'mindmap\n  root',
      'timeline\n  section A',
    ];
    for (const input of starters) {
      expect(extractMermaid(input)).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Fenced code blocks
  // -------------------------------------------------------------------------

  it('strips ```mermaid fenced block and returns inner content', () => {
    const inner = 'graph TD\n  A --> B';
    const fenced = '```mermaid\n' + inner + '\n```';
    expect(extractMermaid(fenced)).toBe(inner);
  });

  it('strips plain ``` fenced block (no language label) and returns inner content', () => {
    const inner = 'graph TD\n  X --> Y';
    const fenced = '```\n' + inner + '\n```';
    expect(extractMermaid(fenced)).toBe(inner);
  });

  it('trims surrounding whitespace before processing fences', () => {
    const inner = 'erDiagram\n  User { string id }';
    const input = '  \n```mermaid\n' + inner + '\n```\n  ';
    expect(extractMermaid(input)).toBe(inner);
  });

  // -------------------------------------------------------------------------
  // Invalid / null cases
  // -------------------------------------------------------------------------

  it('returns null for an empty string', () => {
    expect(extractMermaid('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(extractMermaid('   \n\t  ')).toBeNull();
  });

  it('returns null when content does not start with a known Mermaid keyword', () => {
    expect(extractMermaid('This is plain text, not a diagram.')).toBeNull();
  });

  it('returns null for a fenced block whose inner content has an invalid start', () => {
    const fenced = '```mermaid\nHello world\n```';
    expect(extractMermaid(fenced)).toBeNull();
  });

  it('returns null for JSON-looking content', () => {
    expect(extractMermaid('{ "type": "diagram" }')).toBeNull();
  });

  it('returns null for markdown-looking text without a valid diagram keyword', () => {
    expect(extractMermaid('## Overview\n\nSome text here')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFileSummaryBlock()
// ---------------------------------------------------------------------------

/** Minimal factory for a CIGSnapshot used across buildFileSummaryBlock tests. */
function makeCIG(
  overrides: Partial<CIGSnapshot> = {},
): CIGSnapshot {
  return {
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe('buildFileSummaryBlock()', () => {
  // -------------------------------------------------------------------------
  // Null / empty cases
  // -------------------------------------------------------------------------

  it('returns null when fileSummaries is undefined', () => {
    const cig = makeCIG(); // fileSummaries not set
    expect(buildFileSummaryBlock(cig)).toBeNull();
  });

  it('returns null when fileSummaries is an empty Map', () => {
    const cig = makeCIG({ fileSummaries: new Map() });
    expect(buildFileSummaryBlock(cig)).toBeNull();
  });

  it('returns null when fileSummaries has entries but no file has any import edges', () => {
    // Without import edges there is no in-degree ranking, so ranked = []
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/a.ts:n:variable', repoId: 'r', filePath: 'src/a.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-a',
        },
      ],
      edges: [],
      fileSummaries: new Map([['src/a.ts', 'Module A summary.']]),
    });
    expect(buildFileSummaryBlock(cig)).toBeNull();
  });

  it('returns null when ranked files have summaries but none appear in fileSummaries', () => {
    // Edge points to a file not present in fileSummaries
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/a.ts:n:variable', repoId: 'r', filePath: 'src/a.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-a',
        },
        {
          nodeId: 'r:src/b.ts:n:variable', repoId: 'r', filePath: 'src/b.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-b',
        },
      ],
      edges: [
        {
          edgeId: 'e1', repoId: 'r',
          fromNodeId: 'r:src/a.ts:n:variable',
          toNodeId: 'r:src/b.ts:n:variable',
          edgeType: 'imports',
        },
      ],
      // src/b.ts has in-degree 1 but is NOT in fileSummaries
      fileSummaries: new Map([['src/unrelated.ts', 'Some other file.']]),
    });
    expect(buildFileSummaryBlock(cig)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns a formatted block with entries ranked by import in-degree', () => {
    // src/db.ts  — in-degree 2 (imported by server and auth)
    // src/auth.ts — in-degree 1 (imported by server only)
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/server.ts:n:variable', repoId: 'r', filePath: 'src/server.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 10,
          exported: false, extractedSha: 'sha-s',
        },
        {
          nodeId: 'r:src/auth.ts:n:variable', repoId: 'r', filePath: 'src/auth.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 10,
          exported: false, extractedSha: 'sha-a',
        },
        {
          nodeId: 'r:src/db.ts:n:variable', repoId: 'r', filePath: 'src/db.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 10,
          exported: false, extractedSha: 'sha-d',
        },
      ],
      edges: [
        {
          edgeId: 'e1', repoId: 'r',
          fromNodeId: 'r:src/server.ts:n:variable',
          toNodeId: 'r:src/auth.ts:n:variable',
          edgeType: 'imports',
        },
        {
          edgeId: 'e2', repoId: 'r',
          fromNodeId: 'r:src/server.ts:n:variable',
          toNodeId: 'r:src/db.ts:n:variable',
          edgeType: 'imports',
        },
        {
          edgeId: 'e3', repoId: 'r',
          fromNodeId: 'r:src/auth.ts:n:variable',
          toNodeId: 'r:src/db.ts:n:variable',
          edgeType: 'imports',
        },
      ],
      fileSummaries: new Map([
        ['src/db.ts', 'DB connection pool and query helpers.'],
        ['src/auth.ts', 'JWT authentication middleware.'],
      ]),
    });

    const result = buildFileSummaryBlock(cig);
    expect(result).not.toBeNull();

    // Both summaries appear in the output
    expect(result).toContain('src/db.ts: DB connection pool');
    expect(result).toContain('src/auth.ts: JWT authentication middleware');

    // Higher in-degree file (db.ts) appears before lower in-degree file (auth.ts)
    expect(result!.indexOf('src/db.ts')).toBeLessThan(result!.indexOf('src/auth.ts'));
  });

  it('formats each line as "<filePath>: <summary>"', () => {
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/a.ts:n:variable', repoId: 'r', filePath: 'src/a.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-a',
        },
        {
          nodeId: 'r:src/b.ts:n:variable', repoId: 'r', filePath: 'src/b.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-b',
        },
      ],
      edges: [
        {
          edgeId: 'e1', repoId: 'r',
          fromNodeId: 'r:src/a.ts:n:variable',
          toNodeId: 'r:src/b.ts:n:variable',
          edgeType: 'imports',
        },
      ],
      fileSummaries: new Map([['src/b.ts', 'Module B does X.']]),
    });

    const result = buildFileSummaryBlock(cig);
    expect(result).toBe('src/b.ts: Module B does X.');
  });

  // -------------------------------------------------------------------------
  // maxFiles limit
  // -------------------------------------------------------------------------

  it('respects the maxFiles limit', () => {
    // Create 5 files all imported once; fileSummaries covers all 5
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      nodeId: `r:src/file${i}.ts:n:variable`,
      repoId: 'r',
      filePath: `src/file${i}.ts`,
      symbolName: 'n',
      symbolType: 'variable' as const,
      startLine: 1,
      endLine: 5,
      exported: false,
      extractedSha: `sha-${i}`,
    }));

    // file0 imports file1..file5, giving file1..file5 each in-degree 1
    const edges = nodes.slice(1).map((n, i) => ({
      edgeId: `e${i}`,
      repoId: 'r',
      fromNodeId: nodes[0].nodeId,
      toNodeId: n.nodeId,
      edgeType: 'imports' as const,
    }));

    const fileSummaries = new Map(
      nodes.slice(1).map(n => [n.filePath, `Summary of ${n.filePath}`]),
    );

    const cig = makeCIG({ nodes, edges, fileSummaries });

    // maxFiles = 3 → only 3 entries in the output
    const result = buildFileSummaryBlock(cig, 3);
    expect(result).not.toBeNull();
    const lineCount = result!.split('\n').length;
    expect(lineCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // maxChars limit
  // -------------------------------------------------------------------------

  it('truncates output at maxChars boundary', () => {
    // One file with a very long summary; set maxChars so the line is cut off mid-way
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/a.ts:n:variable', repoId: 'r', filePath: 'src/a.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-a',
        },
        {
          nodeId: 'r:src/b.ts:n:variable', repoId: 'r', filePath: 'src/b.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-b',
        },
        {
          nodeId: 'r:src/c.ts:n:variable', repoId: 'r', filePath: 'src/c.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-c',
        },
      ],
      edges: [
        {
          edgeId: 'e1', repoId: 'r',
          fromNodeId: 'r:src/a.ts:n:variable',
          toNodeId: 'r:src/b.ts:n:variable',
          edgeType: 'imports',
        },
        {
          edgeId: 'e2', repoId: 'r',
          fromNodeId: 'r:src/a.ts:n:variable',
          toNodeId: 'r:src/c.ts:n:variable',
          edgeType: 'imports',
        },
      ],
      fileSummaries: new Map([
        ['src/b.ts', 'First file summary.'],
        ['src/c.ts', 'Second file summary.'],
      ]),
    });

    // "src/b.ts: First file summary." is 30 chars.
    // maxChars = 30 → exactly fits the first line, second line is excluded.
    const firstLine = 'src/b.ts: First file summary.';
    const result = buildFileSummaryBlock(cig, 20, firstLine.length);
    expect(result).not.toBeNull();
    expect(result).toBe(firstLine);
    expect(result).not.toContain('src/c.ts');
  });

  it('ignores non-import edges when computing in-degree', () => {
    // Only a 'calls' edge exists — not 'imports' — so in-degree stays 0 for all files
    const cig = makeCIG({
      nodes: [
        {
          nodeId: 'r:src/a.ts:n:variable', repoId: 'r', filePath: 'src/a.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-a',
        },
        {
          nodeId: 'r:src/b.ts:n:variable', repoId: 'r', filePath: 'src/b.ts',
          symbolName: 'n', symbolType: 'variable', startLine: 1, endLine: 5,
          exported: false, extractedSha: 'sha-b',
        },
      ],
      edges: [
        {
          edgeId: 'e1', repoId: 'r',
          fromNodeId: 'r:src/a.ts:n:variable',
          toNodeId: 'r:src/b.ts:n:variable',
          edgeType: 'calls',  // not 'imports' → should not count toward in-degree
        },
      ],
      fileSummaries: new Map([['src/b.ts', 'Module B.']]),
    });

    // No import edges → ranked is empty → null
    expect(buildFileSummaryBlock(cig)).toBeNull();
  });
});

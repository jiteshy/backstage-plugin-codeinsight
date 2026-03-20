import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { CircularDependencyModule } from '../diagrams/universal/CircularDependencyModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(nodeId: string, filePath: string): CIGNode {
  return {
    nodeId,
    repoId: 'repo',
    filePath,
    symbolName: nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 5,
    exported: false,
    extractedSha: 'sha',
  };
}

function importEdge(edgeId: string, from: string, to: string): CIGEdge {
  return { edgeId, repoId: 'repo', fromNodeId: from, toNodeId: to, edgeType: 'imports' };
}

function snap(nodes: CIGNode[], edges: CIGEdge[]): CIGSnapshot {
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CircularDependencyModule', () => {
  let mod: CircularDependencyModule;

  beforeEach(() => {
    mod = new CircularDependencyModule();
  });

  it('is always-on (empty triggersOn)', () => {
    expect(mod.triggersOn).toHaveLength(0);
    expect(mod.llmNeeded).toBe(false);
  });

  it('returns null for empty CIG', async () => {
    expect(await mod.generate(snap([], []))).toBeNull();
  });

  it('returns null when no import edges exist', async () => {
    const nodes = [makeNode('a', 'a.ts'), makeNode('b', 'b.ts')];
    const edges: CIGEdge[] = [
      { edgeId: 'e1', repoId: 'repo', fromNodeId: 'a', toNodeId: 'b', edgeType: 'calls' },
    ];
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('returns null for a linear (acyclic) dependency chain', async () => {
    // a → b → c (no cycle)
    const nodes = [makeNode('a', 'a.ts'), makeNode('b', 'b.ts'), makeNode('c', 'c.ts')];
    const edges = [importEdge('e1', 'a', 'b'), importEdge('e2', 'b', 'c')];
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('detects a direct 2-node cycle (a ↔ b)', async () => {
    const nodes = [makeNode('a', 'src/a.ts'), makeNode('b', 'src/b.ts')];
    const edges = [importEdge('e1', 'a', 'b'), importEdge('e2', 'b', 'a')];
    const result = await mod.generate(snap(nodes, edges));

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Circular Dependencies');
    expect(result!.llmUsed).toBe(false);
    expect(result!.mermaid).toContain('graph TD');
    expect(result!.mermaid).toContain('cycle');
    expect(result!.description).toContain('1 circular import cycle');
  });

  it('detects a 3-node cycle (a → b → c → a)', async () => {
    const nodes = [makeNode('a', 'a.ts'), makeNode('b', 'b.ts'), makeNode('c', 'c.ts')];
    const edges = [
      importEdge('e1', 'a', 'b'),
      importEdge('e2', 'b', 'c'),
      importEdge('e3', 'c', 'a'),
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('cycle');
  });

  it('ignores self-referential (same-file) edges', async () => {
    // Two nodes in same file with a self-import (shouldn't happen but guard it)
    const nodes = [makeNode('a1', 'src/a.ts'), makeNode('a2', 'src/a.ts')];
    const edges = [importEdge('e1', 'a1', 'a2'), importEdge('e2', 'a2', 'a1')];
    // Same file → no cross-file edge → no cycle detected
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('handles a graph with both cyclic and acyclic parts', async () => {
    // a → b → a (cycle), c → d (no cycle)
    const nodes = [
      makeNode('a', 'a.ts'), makeNode('b', 'b.ts'),
      makeNode('c', 'c.ts'), makeNode('d', 'd.ts'),
    ];
    const edges = [
      importEdge('e1', 'a', 'b'),
      importEdge('e2', 'b', 'a'),
      importEdge('e3', 'c', 'd'),
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    // Only the cyclic nodes should appear
    expect(result!.mermaid).toContain('a_ts');
    expect(result!.mermaid).toContain('b_ts');
  });

  it('uses plural description for multiple cycles', async () => {
    // Two independent cycles: a↔b and c↔d
    const nodes = [
      makeNode('a', 'a.ts'), makeNode('b', 'b.ts'),
      makeNode('c', 'c.ts'), makeNode('d', 'd.ts'),
    ];
    const edges = [
      importEdge('e1', 'a', 'b'), importEdge('e2', 'b', 'a'),
      importEdge('e3', 'c', 'd'), importEdge('e4', 'd', 'c'),
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    expect(result!.description).toContain('cycles');
  });
});

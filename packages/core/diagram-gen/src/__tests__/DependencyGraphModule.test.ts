import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { DependencyGraphModule } from '../diagrams/universal/DependencyGraphModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeNode(
  nodeId: string,
  filePath: string,
  overrides: Partial<CIGNode> = {},
): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath,
    symbolName: nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-abc',
    ...overrides,
  };
}

function makeImportEdge(edgeId: string, fromNodeId: string, toNodeId: string): CIGEdge {
  return {
    edgeId,
    repoId: REPO_ID,
    fromNodeId,
    toNodeId,
    edgeType: 'imports',
  };
}

function makeCIG(nodes: CIGNode[], edges: CIGEdge[]): CIGSnapshot {
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DependencyGraphModule', () => {
  let module: DependencyGraphModule;

  beforeEach(() => {
    module = new DependencyGraphModule();
  });

  it('has the expected static properties', () => {
    expect(module.id).toBe('universal/dependency-graph');
    expect(module.llmNeeded).toBe(false);
    expect(module.triggersOn).toHaveLength(0); // always-on
  });

  describe('generate()', () => {
    it('returns null when there are no edges at all', async () => {
      const cig = makeCIG([], []);
      expect(await module.generate(cig)).toBeNull();
    });

    it('returns null when edges exist but none are of type imports', async () => {
      const nodeA = makeNode('n:a', 'src/a.ts');
      const nodeB = makeNode('n:b', 'src/b.ts');
      const edge: CIGEdge = {
        edgeId: 'e1',
        repoId: REPO_ID,
        fromNodeId: 'n:a',
        toNodeId: 'n:b',
        edgeType: 'references',
      };
      const cig = makeCIG([nodeA, nodeB], [edge]);
      expect(await module.generate(cig)).toBeNull();
    });

    it('returns null when all import edges are within the same file', async () => {
      const nodeA = makeNode('n:a1', 'src/a.ts');
      const nodeA2 = makeNode('n:a2', 'src/a.ts');
      const edge = makeImportEdge('e1', 'n:a1', 'n:a2');
      const cig = makeCIG([nodeA, nodeA2], [edge]);
      expect(await module.generate(cig)).toBeNull();
    });

    it('produces a graph TD diagram for simple import edges', async () => {
      const nodeA = makeNode('n:a', 'src/index.ts');
      const nodeB = makeNode('n:b', 'src/server.ts');
      const edge = makeImportEdge('e1', 'n:a', 'n:b');
      const cig = makeCIG([nodeA, nodeB], [edge]);

      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      expect(result!.diagramType).toBe('graph');
      expect(result!.mermaid).toMatch(/^graph TD/);
      expect(result!.mermaid).toContain('index.ts');
      expect(result!.mermaid).toContain('server.ts');
      expect(result!.llmUsed).toBe(false);
      expect(result!.title).toBe('Dependency Graph');
    });

    it('deduplicates parallel edges between the same pair of files', async () => {
      // Two symbol-level imports between the same two files — should collapse to one edge
      const nodeA1 = makeNode('n:a1', 'src/a.ts');
      const nodeA2 = makeNode('n:a2', 'src/a.ts');
      const nodeB1 = makeNode('n:b1', 'src/b.ts');
      const nodeB2 = makeNode('n:b2', 'src/b.ts');
      const edge1 = makeImportEdge('e1', 'n:a1', 'n:b1');
      const edge2 = makeImportEdge('e2', 'n:a2', 'n:b2');
      const cig = makeCIG([nodeA1, nodeA2, nodeB1, nodeB2], [edge1, edge2]);

      const result = await module.generate(cig);
      expect(result).not.toBeNull();
      // Only one line per file-level edge
      const edgeLines = result!.mermaid
        .split('\n')
        .filter(l => l.includes('-->'));
      expect(edgeLines).toHaveLength(1);
    });

    it('collapses to directory level when number of unique files exceeds MAX_NODES (60)', async () => {
      // Build 61 unique files, each with a distinct import to trigger collapse
      const nodes: CIGNode[] = [];
      const edges: CIGEdge[] = [];

      // Create files spread across different directories
      for (let i = 0; i < 62; i++) {
        const dir = `src/dir${i}`;
        const n = makeNode(`n:${i}`, `${dir}/file${i}.ts`);
        nodes.push(n);
      }
      // Create import edges: node[i] imports node[i+1], different dirs
      for (let i = 0; i < 61; i++) {
        edges.push(makeImportEdge(`e${i}`, `n:${i}`, `n:${i + 1}`));
      }

      const cig = makeCIG(nodes, edges);
      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      // Directory-level collapse — description changes
      expect(result!.description).toContain('Directory-level');
      expect(result!.description).toContain('collapsed');
    });

    it('skips edges referencing unknown node IDs', async () => {
      const nodeA = makeNode('n:a', 'src/a.ts');
      const edgeToMissing = makeImportEdge('e1', 'n:a', 'n:unknown');
      const cig = makeCIG([nodeA], [edgeToMissing]);
      // No valid cross-file edge — should return null
      expect(await module.generate(cig)).toBeNull();
    });
  });
});

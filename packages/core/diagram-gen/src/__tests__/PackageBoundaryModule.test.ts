import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { PackageBoundaryModule } from '../diagrams/universal/PackageBoundaryModule';
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

describe('PackageBoundaryModule', () => {
  let mod: PackageBoundaryModule;

  beforeEach(() => {
    mod = new PackageBoundaryModule();
  });

  it('is always-on (empty triggersOn)', () => {
    expect(mod.triggersOn).toHaveLength(0);
    expect(mod.llmNeeded).toBe(false);
  });

  it('returns null for empty CIG', async () => {
    expect(await mod.generate(snap([], []))).toBeNull();
  });

  it('returns null when all files are in the same package', async () => {
    // All under packages/core/types/src — single package
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/types/src/interfaces.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'b')];
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('returns null when multiple packages exist but no cross-boundary imports', async () => {
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/ingestion/src/IngestionService.ts'),
    ];
    // No edges
    expect(await mod.generate(snap(nodes, []))).toBeNull();
  });

  it('detects cross-package imports in a monorepo layout', async () => {
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/ingestion/src/IngestionService.ts'),
    ];
    const edges = [importEdge('e1', 'b', 'a')]; // ingestion imports types
    const result = await mod.generate(snap(nodes, edges));

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Package Boundaries');
    expect(result!.diagramType).toBe('graph');
    expect(result!.llmUsed).toBe(false);
    expect(result!.mermaid).toContain('graph LR');
    // Should reference both packages (as Mermaid node IDs)
    expect(result!.mermaid).toContain('packages_core_ingestion');
    expect(result!.mermaid).toContain('packages_core_types');
  });

  it('deduplicates cross-boundary edges', async () => {
    // Multiple files in ingestion importing from types → only one pkg→pkg edge
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/ingestion/src/A.ts'),
      makeNode('c', 'packages/core/ingestion/src/B.ts'),
    ];
    const edges = [
      importEdge('e1', 'b', 'a'),
      importEdge('e2', 'c', 'a'),
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    // Both edges collapse to the same package-level edge — should appear once
    const pkgEdgeCount = (result!.mermaid.match(/-->/g) ?? []).length;
    expect(pkgEdgeCount).toBe(1);
  });

  it('falls back to first path segment for files without /src/ parent', async () => {
    // Single-package layout: src/a.ts and src/b.ts both → 'src' package
    const nodes = [
      makeNode('a', 'src/routes/user.ts'),
      makeNode('b', 'src/services/userService.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'b')];
    // Both under 'src' → single package → null
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('shows cross-boundary from two top-level dirs', async () => {
    const nodes = [
      makeNode('a', 'lib/utils.ts'),
      makeNode('b', 'src/app.ts'),
    ];
    const edges = [importEdge('e1', 'b', 'a')]; // src imports lib
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('src');
    expect(result!.mermaid).toContain('lib');
  });

  it('includes a description with package and edge counts', async () => {
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/ingestion/src/IngestionService.ts'),
    ];
    const edges = [importEdge('e1', 'b', 'a')];
    const result = await mod.generate(snap(nodes, edges));
    expect(result!.description).toContain('2 packages');
    expect(result!.description).toContain('1 cross-boundary import');
  });
});

import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { ComponentHierarchyModule } from '../diagrams/frontend/ComponentHierarchyModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeNode(nodeId: string, filePath: string): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath,
    symbolName: nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 20,
    exported: true,
    extractedSha: 'sha-abc',
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

describe('ComponentHierarchyModule', () => {
  let module: ComponentHierarchyModule;

  beforeEach(() => {
    module = new ComponentHierarchyModule();
  });

  it('has the expected static properties', () => {
    expect(module.id).toBe('frontend/component-hierarchy');
    expect(module.llmNeeded).toBe(false);
    // Always-on — runs for every repo, self-terminates when no component files found
    expect(module.triggersOn).toHaveLength(0);
  });

  describe('generate()', () => {
    it('returns null when there are no .tsx files in the CIG', async () => {
      const tsNode = makeNode('n:a', 'src/utils.ts');
      const jsNode = makeNode('n:b', 'src/server.js');
      const cig = makeCIG([tsNode, jsNode], []);
      expect(await module.generate(cig)).toBeNull();
    });

    it('returns null when the CIG is completely empty', async () => {
      expect(await module.generate({ nodes: [], edges: [] })).toBeNull();
    });

    it('returns null when .tsx files exist but have no import edges between them', async () => {
      const app = makeNode('n:App', 'src/App.tsx');
      const header = makeNode('n:Header', 'src/Header.tsx');
      // No edges at all
      const cig = makeCIG([app, header], []);
      expect(await module.generate(cig)).toBeNull();
    });

    it('returns null when component files exist but edges are non-import type', async () => {
      const app = makeNode('n:App', 'src/App.tsx');
      const header = makeNode('n:Header', 'src/Header.tsx');
      const refEdge: CIGEdge = {
        edgeId: 'e1',
        repoId: REPO_ID,
        fromNodeId: 'n:App',
        toNodeId: 'n:Header',
        edgeType: 'references',
      };
      const cig = makeCIG([app, header], [refEdge]);
      expect(await module.generate(cig)).toBeNull();
    });

    it('produces a graph TD diagram for .tsx import edges', async () => {
      const app = makeNode('n:App', 'src/App.tsx');
      const header = makeNode('n:Header', 'src/components/Header.tsx');
      const edge = makeImportEdge('e1', 'n:App', 'n:Header');
      const cig = makeCIG([app, header], [edge]);

      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      expect(result!.diagramType).toBe('graph');
      expect(result!.mermaid).toMatch(/^graph TD/);
      expect(result!.mermaid).toContain('App');
      expect(result!.mermaid).toContain('Header');
      expect(result!.llmUsed).toBe(false);
      expect(result!.title).toBe('Component Hierarchy');
    });

    it('ignores import edges where one endpoint is a non-component file', async () => {
      const app = makeNode('n:App', 'src/App.tsx');
      const util = makeNode('n:util', 'src/utils.ts'); // not a component file
      const edge = makeImportEdge('e1', 'n:App', 'n:util');
      const cig = makeCIG([app, util], [edge]);
      // App.tsx is a component, but utils.ts is not — edge should be excluded
      expect(await module.generate(cig)).toBeNull();
    });

    it('collapses multiple symbol-level imports between same files to one edge', async () => {
      // Two nodes in App.tsx, two nodes in Header.tsx
      const app1 = makeNode('n:App1', 'src/App.tsx');
      const app2 = makeNode('n:App2', 'src/App.tsx');
      const hdr1 = makeNode('n:Hdr1', 'src/Header.tsx');
      const hdr2 = makeNode('n:Hdr2', 'src/Header.tsx');
      const e1 = makeImportEdge('e1', 'n:App1', 'n:Hdr1');
      const e2 = makeImportEdge('e2', 'n:App2', 'n:Hdr2');
      const cig = makeCIG([app1, app2, hdr1, hdr2], [e1, e2]);

      const result = await module.generate(cig);
      expect(result).not.toBeNull();
      const edgeLines = result!.mermaid
        .split('\n')
        .filter(l => l.includes('-->'));
      expect(edgeLines).toHaveLength(1);
    });

    it('treats files in /components/ directory with .ts extension as component files', async () => {
      // The heuristic includes /components/*.ts
      const compA = makeNode('n:A', 'src/components/ButtonA.ts');
      const compB = makeNode('n:B', 'src/components/ButtonB.ts');
      const edge = makeImportEdge('e1', 'n:A', 'n:B');
      const cig = makeCIG([compA, compB], [edge]);
      const result = await module.generate(cig);
      expect(result).not.toBeNull();
    });
  });
});

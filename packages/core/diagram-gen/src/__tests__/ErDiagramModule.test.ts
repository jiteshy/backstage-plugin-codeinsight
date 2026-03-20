import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { ErDiagramModule } from '../diagrams/universal/ErDiagramModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeSchemaNode(
  nodeId: string,
  symbolName: string,
  fields: Array<{ name: string; type: string; required: boolean }> = [],
): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath: 'prisma/schema.prisma',
    symbolName,
    symbolType: 'schema',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-abc',
    metadata: { fields },
  };
}

function makeReferencesEdge(
  edgeId: string,
  fromNodeId: string,
  toNodeId: string,
): CIGEdge {
  return {
    edgeId,
    repoId: REPO_ID,
    fromNodeId,
    toNodeId,
    edgeType: 'references',
  };
}

function makeCIG(nodes: CIGNode[], edges: CIGEdge[]): CIGSnapshot {
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErDiagramModule', () => {
  let module: ErDiagramModule;

  beforeEach(() => {
    module = new ErDiagramModule();
  });

  it('has the expected static properties', () => {
    expect(module.id).toBe('universal/er-diagram');
    expect(module.llmNeeded).toBe(false);
    expect(module.triggersOn).toContain('orm:prisma');
  });

  describe('generate()', () => {
    it('returns null when there are no schema nodes', async () => {
      const nonSchemaNode: CIGNode = {
        nodeId: 'n:func',
        repoId: REPO_ID,
        filePath: 'src/index.ts',
        symbolName: 'myFunc',
        symbolType: 'function',
        startLine: 1,
        endLine: 5,
        exported: true,
        extractedSha: 'sha-abc',
      };
      const cig = makeCIG([nonSchemaNode], []);
      expect(await module.generate(cig)).toBeNull();
    });

    it('returns null when CIG is empty', async () => {
      expect(await module.generate({ nodes: [], edges: [] })).toBeNull();
    });

    it('produces an erDiagram for a single schema node without fields', async () => {
      const userNode = makeSchemaNode('n:User', 'User');
      const cig = makeCIG([userNode], []);
      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      expect(result!.diagramType).toBe('erDiagram');
      expect(result!.mermaid).toMatch(/^erDiagram/);
      expect(result!.mermaid).toContain('User {');
      expect(result!.llmUsed).toBe(false);
      expect(result!.title).toBe('Entity Relationship Diagram');
    });

    it('emits fields with correct types and optional markers', async () => {
      const userNode = makeSchemaNode('n:User', 'User', [
        { name: 'id', type: 'Int', required: true },
        { name: 'email', type: 'String', required: true },
        { name: 'bio', type: 'String', required: false },
      ]);
      const cig = makeCIG([userNode], []);
      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      expect(result!.mermaid).toContain('int id');
      expect(result!.mermaid).toContain('string email');
      expect(result!.mermaid).toContain('string bio?'); // optional
    });

    it('emits a relationship line for a references edge between schema nodes', async () => {
      const userNode = makeSchemaNode('n:User', 'User', [
        { name: 'id', type: 'Int', required: true },
      ]);
      const postNode = makeSchemaNode('n:Post', 'Post', [
        { name: 'authorId', type: 'Int', required: true },
      ]);
      const edge = makeReferencesEdge('e1', 'n:User', 'n:Post');
      const cig = makeCIG([userNode, postNode], [edge]);
      const result = await module.generate(cig);

      expect(result).not.toBeNull();
      expect(result!.mermaid).toContain('User');
      expect(result!.mermaid).toContain('Post');
      // Relationship syntax
      expect(result!.mermaid).toMatch(/User\s*\}?\|--\|\|\s*Post/);
    });

    it('deduplicates relationship lines for the same node pair', async () => {
      const userNode = makeSchemaNode('n:User', 'User');
      const postNode = makeSchemaNode('n:Post', 'Post');
      // Two edges between the same schema pair
      const edge1 = makeReferencesEdge('e1', 'n:User', 'n:Post');
      const edge2 = makeReferencesEdge('e2', 'n:User', 'n:Post');
      const cig = makeCIG([userNode, postNode], [edge1, edge2]);
      const result = await module.generate(cig);

      const relLines = result!.mermaid
        .split('\n')
        .filter(l => l.includes('|--||'));
      expect(relLines).toHaveLength(1);
    });

    it('ignores references edges where one endpoint is not a schema node', async () => {
      const schemaNode = makeSchemaNode('n:User', 'User');
      const nonSchemaNode: CIGNode = {
        nodeId: 'n:func',
        repoId: REPO_ID,
        filePath: 'src/index.ts',
        symbolName: 'myFunc',
        symbolType: 'function',
        startLine: 1,
        endLine: 5,
        exported: true,
        extractedSha: 'sha-abc',
      };
      const edge = makeReferencesEdge('e1', 'n:User', 'n:func');
      const cig = makeCIG([schemaNode, nonSchemaNode], [edge]);
      const result = await module.generate(cig);

      // Diagram is generated but no relationship line
      expect(result).not.toBeNull();
      expect(result!.mermaid).not.toContain('|--||');
    });

    it('handles schema nodes with null metadata gracefully (no fields emitted)', async () => {
      const node: CIGNode = {
        nodeId: 'n:Empty',
        repoId: REPO_ID,
        filePath: 'prisma/schema.prisma',
        symbolName: 'Empty',
        symbolType: 'schema',
        startLine: 1,
        endLine: 5,
        exported: false,
        extractedSha: 'sha-abc',
        metadata: null,
      };
      const cig = makeCIG([node], []);
      const result = await module.generate(cig);
      expect(result).not.toBeNull();
      expect(result!.mermaid).toContain('Empty {');
    });
  });
});

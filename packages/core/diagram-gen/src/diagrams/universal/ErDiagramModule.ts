import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * ErDiagramModule — Pure AST, no LLM.
 *
 * v1 scope: Prisma only. Triggered when `orm:prisma` signal is present.
 * Reads `ci_cig_nodes` of symbolType 'schema' and their 'references' edges
 * to produce a Mermaid `erDiagram`.
 *
 * PrismaExtractor stores each Prisma model as a CIGNode with:
 *   - symbolType: 'schema'
 *   - metadata.fields: Array<{ name: string; type: string; required: boolean }>
 * Relations are stored as CIGEdge with edgeType: 'references'.
 */
export class ErDiagramModule implements DiagramModule {
  readonly id = 'universal/er-diagram';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = ['orm:prisma'] as const;
  readonly llmNeeded = false;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    const schemaNodes = cig.nodes.filter(n => n.symbolType === 'schema');

    if (schemaNodes.length === 0) {
      return null;
    }

    const lines: string[] = ['erDiagram'];

    // Emit entity blocks with their fields
    for (const node of schemaNodes) {
      const fields = this.extractFields(node.metadata);
      if (fields.length === 0) {
        lines.push(`  ${this.safeName(node.symbolName)} {`);
        lines.push(`  }`);
      } else {
        lines.push(`  ${this.safeName(node.symbolName)} {`);
        for (const field of fields) {
          const typeStr = this.mermaidType(field.type);
          const requiredMark = field.required ? '' : '?';
          lines.push(`    ${typeStr} ${field.name}${requiredMark}`);
        }
        lines.push(`  }`);
      }
    }

    // Emit relationships from 'references' edges between schema nodes
    const schemaNodeIds = new Set(schemaNodes.map(n => n.nodeId));
    const refEdges = cig.edges.filter(
      e =>
        e.edgeType === 'references' &&
        schemaNodeIds.has(e.fromNodeId) &&
        schemaNodeIds.has(e.toNodeId),
    );

    const nodeById = new Map(schemaNodes.map(n => [n.nodeId, n]));
    const emittedRels = new Set<string>();

    for (const edge of refEdges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) continue;

      const relKey = `${from.symbolName}||${to.symbolName}`;
      if (emittedRels.has(relKey)) continue;
      emittedRels.add(relKey);

      lines.push(
        `  ${this.safeName(from.symbolName)} }|--|| ${this.safeName(to.symbolName)} : ""`
      );
    }

    return {
      diagramType: 'erDiagram',
      mermaid: lines.join('\n'),
      title: 'Entity Relationship Diagram',
      description: 'Database schema derived from Prisma models',
      llmUsed: false,
    };
  }

  private extractFields(
    metadata: Record<string, unknown> | null | undefined,
  ): Array<{ name: string; type: string; required: boolean }> {
    if (!metadata) return [];
    const fields = metadata['fields'];
    if (!Array.isArray(fields)) return [];
    return fields
      .filter(
        (f): f is { name: string; type: string; required: boolean } =>
          typeof f === 'object' &&
          f !== null &&
          typeof (f as Record<string, unknown>)['name'] === 'string' &&
          typeof (f as Record<string, unknown>)['type'] === 'string',
      )
      .map(f => ({ name: f.name, type: f.type, required: f.required ?? true }));
  }

  /** Map Prisma/TS type names to simple Mermaid-compatible type identifiers. */
  private mermaidType(prismaType: string): string {
    const lower = prismaType.toLowerCase().replace('?', '');
    const map: Record<string, string> = {
      string: 'string',
      int: 'int',
      integer: 'int',
      float: 'float',
      boolean: 'boolean',
      datetime: 'datetime',
      json: 'json',
      bigint: 'bigint',
      bytes: 'bytes',
    };
    return map[lower] ?? lower;
  }

  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}

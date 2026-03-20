import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * ComponentHierarchyModule — Pure AST, no LLM.
 *
 * Filters `ci_cig_edges` to import edges between component files
 * (heuristic: files named *.tsx or files under a `components/` directory).
 * Serializes to `graph TD` Mermaid syntax showing the component tree.
 */
export class ComponentHierarchyModule implements DiagramModule {
  readonly id = 'frontend/component-hierarchy';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = ['framework:react', 'framework:angular'] as const;
  readonly llmNeeded = false;

  private static readonly MAX_EDGES = 80;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    // Collect component file paths using heuristics
    const componentFiles = new Set<string>(
      cig.nodes
        .map(n => n.filePath)
        .filter(fp => this.isComponentFile(fp)),
    );

    if (componentFiles.size === 0) {
      return null;
    }

    // Build node map once for O(1) lookups
    const nodeMap = new Map(cig.nodes.map(n => [n.nodeId, n]));

    // Collapse to file-level edges, keeping only component→component imports
    const fileEdges = new Set<string>();
    for (const edge of cig.edges) {
      if (edge.edgeType !== 'imports') continue;
      const fromNode = nodeMap.get(edge.fromNodeId);
      const toNode = nodeMap.get(edge.toNodeId);
      if (!fromNode || !toNode) continue;
      if (!componentFiles.has(fromNode.filePath)) continue;
      if (!componentFiles.has(toNode.filePath)) continue;
      if (fromNode.filePath === toNode.filePath) continue;
      fileEdges.add(`${fromNode.filePath}|||${toNode.filePath}`);
    }

    if (fileEdges.size === 0) {
      return null;
    }

    const lines: string[] = ['graph TD'];
    let count = 0;
    for (const key of fileEdges) {
      if (count >= ComponentHierarchyModule.MAX_EDGES) break;
      const [from, to] = key.split('|||');
      lines.push(
        `  ${this.nodeId(from)}["${this.componentName(from)}"] --> ${this.nodeId(to)}["${this.componentName(to)}"]`,
      );
      count++;
    }

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'Component Hierarchy',
      description: 'Import relationships between UI components',
      llmUsed: false,
    };
  }

  private isComponentFile(filePath: string): boolean {
    if (filePath.endsWith('.tsx')) return true;
    if (filePath.includes('/components/') && filePath.endsWith('.ts')) return true;
    if (filePath.includes('/pages/') && filePath.endsWith('.tsx')) return true;
    if (filePath.includes('/views/') && filePath.endsWith('.tsx')) return true;
    return false;
  }

  private componentName(filePath: string): string {
    const parts = filePath.split('/');
    const file = parts[parts.length - 1];
    return file.replace(/\.(tsx?|vue|svelte)$/, '');
  }

  private nodeId(filePath: string): string {
    return filePath.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

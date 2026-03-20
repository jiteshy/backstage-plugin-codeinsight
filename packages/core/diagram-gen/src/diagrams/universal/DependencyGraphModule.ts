import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * DependencyGraphModule — Pure AST, no LLM.
 *
 * Reads `ci_cig_edges` of type 'imports' and serializes them as a
 * `graph TD` Mermaid diagram. For large repos, collapses edges that
 * are purely internal to the same directory.
 */
export class DependencyGraphModule implements DiagramModule {
  readonly id = 'universal/dependency-graph';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn: readonly string[] = [];
  readonly llmNeeded = false;

  private static readonly MAX_NODES = 60;
  private static readonly MAX_EDGES = 120;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    const importEdges = cig.edges.filter(e => e.edgeType === 'imports');

    if (importEdges.length === 0) {
      return null;
    }

    // Build a file-level graph: collapse symbol-level edges to file-level
    const fileEdges = new Set<string>();
    for (const edge of importEdges) {
      const fromNode = cig.nodes.find(n => n.nodeId === edge.fromNodeId);
      const toNode = cig.nodes.find(n => n.nodeId === edge.toNodeId);
      if (!fromNode || !toNode) continue;
      if (fromNode.filePath === toNode.filePath) continue;
      fileEdges.add(`${fromNode.filePath}|||${toNode.filePath}`);
    }

    // Collect all referenced file paths
    const allFiles = new Set<string>();
    for (const key of fileEdges) {
      const [from, to] = key.split('|||');
      allFiles.add(from);
      allFiles.add(to);
    }

    // If the graph is too large, collapse to directory level
    const useDirectoryCollapse = allFiles.size > DependencyGraphModule.MAX_NODES;
    const lines: string[] = ['graph TD'];

    if (useDirectoryCollapse) {
      const dirEdges = new Set<string>();
      for (const key of fileEdges) {
        const [from, to] = key.split('|||');
        const fromDir = this.dirOf(from);
        const toDir = this.dirOf(to);
        if (fromDir !== toDir) {
          dirEdges.add(`${fromDir}|||${toDir}`);
        }
      }

      let edgeCount = 0;
      for (const key of dirEdges) {
        if (edgeCount >= DependencyGraphModule.MAX_EDGES) break;
        const [from, to] = key.split('|||');
        lines.push(`  ${this.nodeId(from)}["${from}"] --> ${this.nodeId(to)}["${to}"]`);
        edgeCount++;
      }
    } else {
      let edgeCount = 0;
      for (const key of fileEdges) {
        if (edgeCount >= DependencyGraphModule.MAX_EDGES) break;
        const [from, to] = key.split('|||');
        const fromLabel = this.shortName(from);
        const toLabel = this.shortName(to);
        lines.push(`  ${this.nodeId(from)}["${fromLabel}"] --> ${this.nodeId(to)}["${toLabel}"]`);
        edgeCount++;
      }
    }

    if (lines.length === 1) {
      return null;
    }

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'Dependency Graph',
      description: useDirectoryCollapse
        ? 'Directory-level import dependencies (collapsed for large repo)'
        : 'File-level import dependencies',
      llmUsed: false,
    };
  }

  private dirOf(filePath: string): string {
    const parts = filePath.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
  }

  private shortName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }

  /** Convert a file path to a valid Mermaid node ID (alphanumeric + underscore). */
  private nodeId(filePath: string): string {
    return filePath.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

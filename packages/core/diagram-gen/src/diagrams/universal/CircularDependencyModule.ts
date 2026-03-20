import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * CircularDependencyModule — Pure AST, always-on.
 *
 * Detects circular import dependencies using iterative DFS on the file-level
 * import graph. Shows the cycle edges as a directed graph so engineers can
 * identify problematic coupling and plan refactoring work.
 *
 * Returns null if no cycles are found (clean repo → no noise in the UI).
 */
export class CircularDependencyModule implements DiagramModule {
  readonly id = 'universal/circular-dependencies';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn: readonly string[] = [];
  readonly llmNeeded = false;

  private static readonly MAX_CYCLES = 8;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    const importEdges = cig.edges.filter(e => e.edgeType === 'imports');
    if (importEdges.length === 0) return null;

    // Build file-level adjacency map from node IDs → file paths
    const nodeMap = new Map(cig.nodes.map(n => [n.nodeId, n]));
    const adj = new Map<string, Set<string>>();

    for (const edge of importEdges) {
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (!from || !to || from.filePath === to.filePath) continue;
      if (!adj.has(from.filePath)) adj.set(from.filePath, new Set());
      adj.get(from.filePath)!.add(to.filePath);
    }

    const cycles = this.findCycles(adj);
    if (cycles.length === 0) return null;

    // Collect all edges that are part of any cycle
    const cycleEdges = new Set<string>();
    for (const cycle of cycles) {
      for (let i = 0; i < cycle.length - 1; i++) {
        cycleEdges.add(`${cycle[i]}|||${cycle[i + 1]}`);
      }
    }

    const lines: string[] = ['graph TD'];
    for (const key of cycleEdges) {
      const [from, to] = key.split('|||');
      lines.push(
        `  ${this.nodeId(from)}["${this.shortName(from)}"] -->|cycle| ${this.nodeId(to)}["${this.shortName(to)}"]`,
      );
    }

    const cycleCount = cycles.length;
    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'Circular Dependencies',
      description:
        `${cycleCount} circular import ${cycleCount === 1 ? 'cycle' : 'cycles'} detected — ` +
        'these files create import loops that complicate refactoring and testing',
      llmUsed: false,
    };
  }

  /**
   * Find cycles in a directed graph using iterative DFS.
   * Returns at most MAX_CYCLES cycles, each expressed as a list of nodes
   * starting and ending at the cycle entry point.
   */
  private findCycles(adj: Map<string, Set<string>>): string[][] {
    // 0 = unvisited, 1 = in current DFS stack, 2 = fully processed
    const color = new Map<string, number>();
    const cycles: string[][] = [];

    for (const startNode of adj.keys()) {
      if (color.has(startNode) || cycles.length >= CircularDependencyModule.MAX_CYCLES) {
        continue;
      }
      this.dfs(startNode, adj, color, cycles);
    }

    return cycles;
  }

  private dfs(
    start: string,
    adj: Map<string, Set<string>>,
    color: Map<string, number>,
    cycles: string[][],
  ): void {
    // Iterative DFS to avoid stack overflow on large graphs
    const stack: Array<{ node: string; iter: IterableIterator<string> }> = [];
    const path: string[] = [];

    color.set(start, 1);
    path.push(start);
    stack.push({ node: start, iter: (adj.get(start) ?? new Set<string>()).values() });

    while (stack.length > 0 && cycles.length < CircularDependencyModule.MAX_CYCLES) {
      const top = stack[stack.length - 1];
      const next = top.iter.next();

      if (next.done) {
        color.set(top.node, 2);
        stack.pop();
        path.pop();
        continue;
      }

      const neighbor = next.value;
      const neighborColor = color.get(neighbor);

      if (neighborColor === undefined) {
        // Unvisited — continue DFS
        color.set(neighbor, 1);
        path.push(neighbor);
        stack.push({ node: neighbor, iter: (adj.get(neighbor) ?? new Set<string>()).values() });
      } else if (neighborColor === 1) {
        // Back edge → cycle found; extract it from the current path
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1 && cycles.length < CircularDependencyModule.MAX_CYCLES) {
          // Append neighbor again so the edge list closes the loop
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }
      // neighborColor === 2: already fully processed, no cycle contribution
    }

    // If we exited early (MAX_CYCLES reached), any nodes still on the stack are still
    // colored gray (1). Mark them as fully processed so subsequent dfs() calls from
    // findCycles() don't misread them as "in current stack" and emit false-positive cycles.
    for (const frame of stack) {
      if (color.get(frame.node) === 1) {
        color.set(frame.node, 2);
      }
    }
  }

  private shortName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }

  private nodeId(filePath: string): string {
    return filePath.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

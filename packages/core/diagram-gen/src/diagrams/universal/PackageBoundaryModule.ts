import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * PackageBoundaryModule — Pure AST, always-on.
 *
 * Groups source files by their "package root" (the directory containing src/)
 * and shows which packages import from which others. For monorepos this is a
 * high-value diagram that reveals the inter-package dependency graph.
 *
 * Package root detection: everything before the first `/src/` segment in a
 * file path (e.g. `packages/core/types` from `packages/core/types/src/data.ts`).
 * For files without `/src/` in their path, falls back to the first directory.
 *
 * Returns null if all files belong to a single package (no cross-boundary deps).
 */
export class PackageBoundaryModule implements DiagramModule {
  readonly id = 'universal/package-boundaries';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn: readonly string[] = [];
  readonly llmNeeded = false;

  private static readonly MAX_EDGES = 60;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    const nodeMap = new Map(cig.nodes.map(n => [n.nodeId, n]));

    // Map each file path to its package root
    const filePackage = new Map<string, string>();
    for (const node of cig.nodes) {
      filePackage.set(node.filePath, this.packageOf(node.filePath));
    }

    const packages = new Set(filePackage.values());
    // Need at least 2 packages for the diagram to be interesting
    if (packages.size <= 1) return null;

    // Collect unique cross-boundary import edges (package → package)
    const crossEdges = new Set<string>();
    for (const edge of cig.edges) {
      if (edge.edgeType !== 'imports') continue;
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (!from || !to) continue;

      const fromPkg = filePackage.get(from.filePath);
      const toPkg = filePackage.get(to.filePath);
      if (!fromPkg || !toPkg || fromPkg === toPkg) continue;

      crossEdges.add(`${fromPkg}|||${toPkg}`);
    }

    if (crossEdges.size === 0) return null;

    const lines: string[] = ['graph LR'];
    let count = 0;
    for (const key of crossEdges) {
      if (count >= PackageBoundaryModule.MAX_EDGES) break;
      const [from, to] = key.split('|||');
      const fromLabel = this.shortLabel(from);
      const toLabel = this.shortLabel(to);
      lines.push(
        `  ${this.nodeId(from)}["${fromLabel}"] --> ${this.nodeId(to)}["${toLabel}"]`,
      );
      count++;
    }

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'Package Boundaries',
      description:
        `${packages.size} packages with ${crossEdges.size} cross-boundary ` +
        `import${crossEdges.size === 1 ? '' : 's'} — shows inter-package dependency structure`,
      llmUsed: false,
    };
  }

  /**
   * Derive the "package root" from a file path.
   *
   * Strategy: if the path contains `/src/` with a non-empty prefix, use that
   * prefix (e.g. `packages/core/types/src/data.ts` → `packages/core/types`).
   * Otherwise fall back to the first path segment.
   */
  private packageOf(filePath: string): string {
    const srcIdx = filePath.indexOf('/src/');
    if (srcIdx > 0) {
      return filePath.slice(0, srcIdx);
    }
    // Fallback: first path component (or 'root' for files at the top level)
    const slash = filePath.indexOf('/');
    return slash > 0 ? filePath.slice(0, slash) : 'root';
  }

  /** Show only the last two path segments to keep labels readable. */
  private shortLabel(pkgPath: string): string {
    const parts = pkgPath.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : pkgPath;
  }

  private nodeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

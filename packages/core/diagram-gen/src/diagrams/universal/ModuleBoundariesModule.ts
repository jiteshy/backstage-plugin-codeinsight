import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';

/**
 * ModuleBoundariesModule — Pure AST, always-on.
 *
 * Groups source files by their "domain directory" under `src/` (e.g. auth/,
 * billing/, users/, hooks/, components/) and shows cross-domain import edges.
 *
 * Domain detection: the first path segment after `src/` (or `lib/`, `app/`).
 * Self-terminates if fewer than 3 domain groups are found — single-domain
 * repos don't benefit from this diagram.
 *
 * `graph LR` layout: left-to-right reads as a natural layered architecture.
 */
export class ModuleBoundariesModule implements DiagramModule {
  readonly id = 'universal/module-boundaries';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn: readonly string[] = [];
  readonly llmNeeded = false;

  private static readonly MAX_EDGES = 80;

  async generate(cig: CIGSnapshot): Promise<MermaidDiagram | null> {
    const nodeById = new Map(cig.nodes.map(n => [n.nodeId, n]));

    // Map each file path to its domain group
    const fileDomain = new Map<string, string>();
    for (const node of cig.nodes) {
      const domain = this.domainOf(node.filePath);
      if (domain) {
        fileDomain.set(node.filePath, domain);
      }
    }

    const domains = new Set(fileDomain.values());
    // Need at least 3 domain groups for a meaningful diagram
    if (domains.size < 3) return null;

    // Collect unique cross-domain import edges
    const crossEdges = new Set<string>();
    for (const edge of cig.edges) {
      if (edge.edgeType !== 'imports') continue;
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) continue;

      const fromDomain = fileDomain.get(from.filePath);
      const toDomain = fileDomain.get(to.filePath);
      if (!fromDomain || !toDomain || fromDomain === toDomain) continue;

      crossEdges.add(`${fromDomain}|||${toDomain}`);
    }

    if (crossEdges.size === 0) return null;

    // Build nodeMap: domain label → one representative file path from that domain
    const domainRepFile = new Map<string, string>();
    for (const [filePath, domain] of fileDomain) {
      if (!domainRepFile.has(domain)) {
        domainRepFile.set(domain, filePath);
      }
    }

    const nodeMap: Record<string, string> = {};
    for (const [domain, filePath] of domainRepFile) {
      nodeMap[this.nodeId(domain)] = filePath;
    }

    const lines: string[] = ['graph LR'];
    let count = 0;
    for (const key of crossEdges) {
      if (count >= ModuleBoundariesModule.MAX_EDGES) break;
      const [from, to] = key.split('|||');
      lines.push(`  ${this.nodeId(from)}["${from}"] --> ${this.nodeId(to)}["${to}"]`);
      count++;
    }

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'Module Boundaries',
      description:
        `${domains.size} domain modules with ${crossEdges.size} cross-domain ` +
        `import${crossEdges.size === 1 ? '' : 's'} — shows architectural layer dependencies`,
      llmUsed: false,
      nodeMap,
    };
  }

  /**
   * Extract the domain group from a file path.
   *
   * Looks for the first path segment after a `src/`, `lib/`, or `app/` root.
   * Returns null for files that don't fall under a recognizable source root.
   *
   * Examples:
   *   src/auth/controller.ts       → 'auth'
   *   src/billing/service.ts       → 'billing'
   *   lib/utils/format.ts          → 'utils'
   *   packages/core/src/data.ts    → 'data' (first segment after src/)
   */
  private domainOf(filePath: string): string | null {
    // Find the first occurrence of /src/, /lib/, or /app/ and take the next segment
    const match = filePath.match(/(?:\/|^)(?:src|lib|app)\/([^/]+)\//);
    if (match && match[1]) {
      const segment = match[1];
      // Exclude file-like segments (index, utils, types, shared, common, helpers)
      if (!/^(index|utils|types|shared|common|helpers|__tests__|test|tests)$/.test(segment)) {
        return segment;
      }
    }
    return null;
  }

  private nodeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

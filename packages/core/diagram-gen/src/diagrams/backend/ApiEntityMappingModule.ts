import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { buildFileSummaryBlock, extractMermaid } from '../../utils';

/**
 * ApiEntityMappingModule — Hybrid (AST + optional LLM).
 *
 * Replaces ApiFlowModule with a more valuable diagram that maps API surface
 * to data entities. Shows Routes → Services → Entities in a `graph LR`.
 *
 * AST phase:
 *   - Collects route nodes (symbolType='route') with HTTP method + path metadata
 *   - Collects schema/entity nodes (symbolType='schema') from Prisma models
 *   - Traces call edges: route → handler → service → model
 *
 * LLM phase (optional):
 *   - If an LLM is available, synthesizes a clean `graph LR` with meaningful
 *     groupings and labels
 *   - Falls back to AST-only diagram if LLM is unavailable
 *
 * Triggered by backend framework signals (same as ApiFlowModule).
 */
export class ApiEntityMappingModule implements DiagramModule {
  readonly id = 'backend/api-entity-mapping';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'framework:express',
    'framework:fastify',
    'framework:koa',
    'framework:nestjs',
    'framework:hapi',
  ] as const;
  readonly llmNeeded = false; // Can run without LLM (AST-only mode)

  private static readonly MAX_ROUTES = 25;
  private static readonly MAX_ENTITIES = 20;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    const routeNodes = cig.nodes.filter(n => n.symbolType === 'route');
    if (routeNodes.length === 0) return null;

    const schemaNodes = cig.nodes.filter(n => n.symbolType === 'schema');
    const nodeById = new Map(cig.nodes.map(n => [n.nodeId, n]));
    const callEdges = cig.edges.filter(e => e.edgeType === 'calls');

    // Build route → called services/entities mapping
    type RouteInfo = {
      method: string;
      path: string;
      handlerName: string;
      filePath: string;
      calledEntities: string[];
    };

    const routeInfos: RouteInfo[] = [];
    for (const route of routeNodes.slice(0, ApiEntityMappingModule.MAX_ROUTES)) {
      const meta = route.metadata as Record<string, unknown> | null;
      const method = typeof meta?.['method'] === 'string' ? meta['method'] : 'GET';
      const path = typeof meta?.['path'] === 'string' ? meta['path'] : route.symbolName;

      // Trace call chain from route outward (1 hop)
      const calledIds = callEdges
        .filter(e => e.fromNodeId === route.nodeId)
        .map(e => e.toNodeId);

      // From called nodes, look for schema connections
      const calledEntities: string[] = [];
      for (const calledId of calledIds) {
        const calledNode = nodeById.get(calledId);
        if (!calledNode) continue;

        // Direct schema node
        if (calledNode.symbolType === 'schema') {
          calledEntities.push(calledNode.symbolName);
          continue;
        }

        // Second-hop: calls from service to schema
        const secondHop = callEdges
          .filter(e => e.fromNodeId === calledId)
          .map(e => nodeById.get(e.toNodeId))
          .filter((n): n is NonNullable<typeof n> => n?.symbolType === 'schema');

        for (const schemaNode of secondHop) {
          if (!calledEntities.includes(schemaNode.symbolName)) {
            calledEntities.push(schemaNode.symbolName);
          }
        }
      }

      routeInfos.push({ method, path, handlerName: route.symbolName, filePath: route.filePath, calledEntities });
    }

    if (llmClient && (routeInfos.length > 0 || schemaNodes.length > 0)) {
      return this.generateWithLLM(routeInfos, schemaNodes, nodeById, llmClient, buildFileSummaryBlock(cig));
    }

    return this.generateAST(routeInfos, schemaNodes);
  }

  private generateAST(
    routeInfos: Array<{ method: string; path: string; handlerName: string; filePath: string; calledEntities: string[] }>,
    schemaNodes: Array<{ nodeId: string; symbolName: string; filePath: string }>,
  ): MermaidDiagram | null {
    const lines: string[] = ['graph LR'];
    const nodeMap: Record<string, string> = {};

    // Group routes by resource prefix (first path segment after /)
    const resourceGroups = new Map<string, typeof routeInfos>();
    for (const route of routeInfos) {
      const resource = this.resourceOf(route.path);
      const group = resourceGroups.get(resource) ?? [];
      group.push(route);
      resourceGroups.set(resource, group);
    }

    // Emit route group nodes
    for (const [resource, routes] of resourceGroups) {
      const nid = `ROUTE_${this.nodeId(resource)}`;
      const label = `/${resource} (${routes.length})`;
      lines.push(`  ${nid}["${label}"]`);

      // Link to entities
      const entities = new Set(routes.flatMap(r => r.calledEntities));
      for (const entity of entities) {
        const entityNid = `ENTITY_${this.nodeId(entity)}`;
        lines.push(`  ${nid} --> ${entityNid}["${entity}"]`);
        // nodeMap for entity: find schema node file path
        const schemaNode = schemaNodes.find(n => n.symbolName === entity);
        if (schemaNode) nodeMap[entityNid] = schemaNode.filePath;
      }

      // Use first route file path as representative for the route node
      if (routes[0]) nodeMap[nid] = routes[0].filePath;
    }

    // Emit any schema nodes not yet linked
    for (const schema of schemaNodes.slice(0, ApiEntityMappingModule.MAX_ENTITIES)) {
      const nid = `ENTITY_${this.nodeId(schema.symbolName)}`;
      if (!lines.some(l => l.includes(nid))) {
        lines.push(`  ${nid}["${schema.symbolName}"]`);
        nodeMap[nid] = schema.filePath;
      }
    }

    if (lines.length <= 1) return null;

    return {
      diagramType: 'graph',
      mermaid: lines.join('\n'),
      title: 'API → Entity Mapping',
      description: `${routeInfos.length} route(s) mapped to ${schemaNodes.length} data entity/entities`,
      llmUsed: false,
      nodeMap,
    };
  }

  private async generateWithLLM(
    routeInfos: Array<{ method: string; path: string; handlerName: string; filePath: string; calledEntities: string[] }>,
    schemaNodes: Array<{ nodeId: string; symbolName: string; filePath: string }>,
    _nodeById: Map<string, unknown>,
    llmClient: LLMClient,
    summaryBlock?: string | null,
  ): Promise<MermaidDiagram | null> {
    const routeList = routeInfos
      .slice(0, 20)
      .map(r => {
        const entities = r.calledEntities.length > 0
          ? ` → entities: ${r.calledEntities.join(', ')}`
          : '';
        return `  ${r.method} ${r.path}${entities}`;
      })
      .join('\n');

    const entityList = schemaNodes
      .slice(0, ApiEntityMappingModule.MAX_ENTITIES)
      .map(n => `  ${n.symbolName}`)
      .join('\n');

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid graph LR syntax. No explanation, no fences, no markdown.
Use short node IDs. Keep labels ≤ 25 chars. Emit at most 25 nodes total.
Group routes by resource (e.g. /users routes → Users subgroup).`;

    const userPrompt = `Generate a Mermaid graph LR showing Routes → Services → Entities.
${summaryBlock ? `\n## Key File Summaries\n${summaryBlock}\n` : ''}
API routes detected:
${routeList || '  (no route metadata)'}

Data entities detected:
${entityList || '  (no schema nodes)'}

Guidelines:
- Left: Route groups (e.g. "User Routes", "Order Routes")
- Middle: Services/Handlers (if discernible)
- Right: Data Entities
- Use --> for data flow
- Group related routes using subgraph blocks

Output only the Mermaid graph LR block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 1000,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) {
      return this.generateAST(routeInfos, schemaNodes);
    }

    // Build nodeMap from route/schema nodes (best-effort — uses same ROUTE_/ENTITY_ prefix
    // scheme as generateAST so partial matches are possible when LLM reuses resource names).
    const nodeMap: Record<string, string> = {};
    for (const route of routeInfos) {
      const resource = this.resourceOf(route.path);
      nodeMap[`ROUTE_${this.nodeId(resource)}`] = route.filePath;
    }
    for (const schema of schemaNodes) {
      nodeMap[`ENTITY_${this.nodeId(schema.symbolName)}`] = schema.filePath;
    }

    return {
      diagramType: 'graph',
      mermaid,
      title: 'API → Entity Mapping',
      description: `${routeInfos.length} route(s) mapped to ${schemaNodes.length} data entity/entities`,
      llmUsed: true,
      nodeMap,
    };
  }

  /** Extract resource name from a route path (first non-param segment). */
  private resourceOf(routePath: string): string {
    const segments = routePath.split('/').filter(s => s && !s.startsWith(':'));
    return segments[0] ?? 'root';
  }

  private nodeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

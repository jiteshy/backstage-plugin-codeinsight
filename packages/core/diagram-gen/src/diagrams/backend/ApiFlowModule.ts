import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { extractMermaid } from '../../utils';

/**
 * ApiFlowModule — LLM-assisted.
 *
 * Input: route nodes from CIG + their call-graph edges.
 * Output: `sequenceDiagram` showing request → handler → service → DB.
 * Triggered when 'framework:express', 'framework:fastify', 'framework:koa',
 * or 'framework:nestjs' is detected.
 */
export class ApiFlowModule implements DiagramModule {
  readonly id = 'backend/api-flow';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'framework:express',
    'framework:fastify',
    'framework:koa',
    'framework:nestjs',
    'framework:hapi',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    const routeNodes = cig.nodes.filter(n => n.symbolType === 'route');
    if (routeNodes.length === 0) return null;

    // Build context: list routes + their outgoing calls (max 30 routes, top 5 calls each)
    const routeSummaries: string[] = [];
    const callEdges = cig.edges.filter(e => e.edgeType === 'calls');

    for (const route of routeNodes.slice(0, 30)) {
      const calledIds = callEdges
        .filter(e => e.fromNodeId === route.nodeId)
        .map(e => e.toNodeId)
        .slice(0, 5);

      const calledNames = calledIds
        .map(id => cig.nodes.find(n => n.nodeId === id)?.symbolName)
        .filter(Boolean)
        .join(', ');

      const meta = route.metadata as Record<string, unknown> | null;
      const method = typeof meta?.['method'] === 'string' ? meta['method'] : 'GET';
      const path = typeof meta?.['path'] === 'string' ? meta['path'] : route.symbolName;

      routeSummaries.push(
        `${method} ${path} → handler: ${route.symbolName}` +
          (calledNames ? ` → calls: ${calledNames}` : ''),
      );
    }

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid sequenceDiagram syntax. No explanation, no fences, no markdown.
Keep participant names short (≤ 20 chars). Show at most 3 representative flows.`;

    const userPrompt = `Generate a Mermaid sequenceDiagram for this API backend.
Show the request lifecycle: Client → Router → Handler → Service → Database.
Use these routes as your basis (show the most representative flows):

${routeSummaries.join('\n')}

Output only the Mermaid sequenceDiagram block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 1200,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    return {
      diagramType: 'sequenceDiagram',
      mermaid,
      title: 'API Request Flow',
      description: 'Sequence diagram showing how requests flow through handlers and services',
      llmUsed: true,
    };
  }
}

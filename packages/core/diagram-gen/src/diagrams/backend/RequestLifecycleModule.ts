import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { extractMermaid } from '../../utils';

/**
 * RequestLifecycleModule — LLM-assisted.
 *
 * Input: middleware and route handler nodes from CIG.
 * Output: `flowchart TD` showing the middleware chain.
 */
export class RequestLifecycleModule implements DiagramModule {
  readonly id = 'backend/request-lifecycle';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'framework:express',
    'framework:fastify',
    'framework:koa',
    'framework:nestjs',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    // Gather function nodes that look like middleware (name contains common middleware terms)
    const middlewareKeywords = ['middleware', 'auth', 'cors', 'logger', 'validate', 'parse', 'error', 'guard', 'interceptor'];
    const middlewareNodes = cig.nodes.filter(
      n =>
        n.symbolType === 'function' &&
        middlewareKeywords.some(kw =>
          n.symbolName.toLowerCase().includes(kw),
        ),
    );

    const routeNodes = cig.nodes.filter(n => n.symbolType === 'route');

    if (middlewareNodes.length === 0 && routeNodes.length === 0) return null;

    const middlewareList = middlewareNodes
      .slice(0, 15)
      .map(n => `- ${n.symbolName} (${n.filePath})`)
      .join('\n');

    const routeList = routeNodes
      .slice(0, 10)
      .map(n => {
        const meta = n.metadata as Record<string, unknown> | null;
        const method = typeof meta?.['method'] === 'string' ? meta['method'] : '';
        const path = typeof meta?.['path'] === 'string' ? meta['path'] : n.symbolName;
        return `- ${method} ${path}`.trim();
      })
      .join('\n');

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid flowchart TD syntax. No explanation, no fences, no markdown.
Keep node labels short (≤ 25 chars).`;

    const userPrompt = `Generate a Mermaid flowchart TD showing the HTTP request lifecycle for this backend.
Show how a request flows through middleware layers to reach route handlers.

Middleware functions detected:
${middlewareList || '(none detected)'}

Routes:
${routeList || '(none detected)'}

Show the path: Incoming Request → [middleware chain in order] → Route Handler → Response.
Output only the Mermaid flowchart TD block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 1000,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    return {
      diagramType: 'flowchart',
      mermaid,
      title: 'Request Lifecycle',
      description: 'How HTTP requests flow through the middleware chain',
      llmUsed: true,
    };
  }
}

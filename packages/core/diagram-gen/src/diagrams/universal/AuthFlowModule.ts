import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { buildFileSummaryBlock, extractMermaid } from '../../utils';

/**
 * AuthFlowModule — LLM-assisted.
 *
 * Generates a flowchart showing how authentication and authorization work
 * in the codebase: request entry → auth middleware → token validation →
 * permission/role check → protected resource access.
 *
 * Triggered when auth-related patterns are detected:
 *   auth:jwt, auth:oauth, auth:session, auth:middleware
 *
 * Collects:
 *   - Auth middleware / guard files
 *   - Token utility files (JWT sign/verify, OAuth handlers)
 *   - Session management files
 *   - Protected route nodes vs. public routes
 *
 * The LLM synthesizes a `flowchart TD` showing the complete auth lifecycle.
 */
export class AuthFlowModule implements DiagramModule {
  readonly id = 'universal/auth-flow';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'auth:jwt',
    'auth:oauth',
    'auth:session',
    'auth:middleware',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    const filePaths = [...new Set(cig.nodes.map(n => n.filePath))];
    const symbolNames = cig.nodes.map(n => n.symbolName.toLowerCase());

    // Classify auth-relevant files
    const middlewareFiles = filePaths.filter(fp =>
      /auth\.middleware|middleware\/auth|guards\/|auth\.guard/i.test(fp),
    );
    const jwtFiles = filePaths.filter(fp =>
      /jwt|jsonwebtoken/i.test(fp),
    );
    const oauthFiles = filePaths.filter(fp =>
      /oauth|passport/i.test(fp),
    );
    const sessionFiles = filePaths.filter(fp =>
      /session|cookie-session/i.test(fp),
    );
    const rbacFiles = filePaths.filter(fp =>
      /rbac|permission|role|policy/i.test(fp),
    );

    const coreAuthFiles = middlewareFiles.length + jwtFiles.length +
      oauthFiles.length + sessionFiles.length;

    if (coreAuthFiles === 0) return null;

    // Detect auth approach
    const hasJwt = jwtFiles.length > 0 ||
      symbolNames.some(s => /jwtstrategy|verifytoken|signjwt/.test(s));
    const hasOAuth = oauthFiles.length > 0;
    const hasSession = sessionFiles.length > 0;
    const hasRbac = rbacFiles.length > 0 ||
      symbolNames.some(s => /canactivate|isauthorized|checkpermission/.test(s));

    // Collect relevant symbols for context
    const authSymbols = cig.nodes
      .filter(n => {
        const fp = n.filePath.toLowerCase();
        const sym = n.symbolName.toLowerCase();
        return (
          /auth|jwt|guard|middleware|session|oauth|passport|permission|role/.test(fp) ||
          /auth|jwt|guard|verify|token|session|oauth|permission|role/.test(sym)
        );
      })
      .slice(0, 20)
      .map(n => `  - ${n.symbolName} (${n.filePath.split('/').slice(-2).join('/')})`);

    // Collect protected vs. public route count
    const routeNodes = cig.nodes.filter(n => n.symbolType === 'route');

    const sections: string[] = [];

    if (hasJwt) {
      sections.push(`Token strategy: JWT${hasOAuth ? ' + OAuth/Passport' : ''}`);
    } else if (hasOAuth) {
      sections.push('Token strategy: OAuth/Passport');
    }
    if (hasSession) {
      sections.push('Session/cookie-based sessions detected');
    }
    if (hasRbac) {
      sections.push('Role-based access control (RBAC) / permissions detected');
    }
    if (middlewareFiles.length > 0) {
      sections.push(`Auth middleware/guards: ${middlewareFiles.map(f => f.split('/').pop()).join(', ')}`);
    }
    if (routeNodes.length > 0) {
      sections.push(`${routeNodes.length} route endpoint(s) in codebase`);
    }
    if (authSymbols.length > 0) {
      sections.push(`Key auth symbols:\n${authSymbols.join('\n')}`);
    }

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid flowchart TD syntax. No explanation, no fences, no markdown.
Keep node labels ≤ 30 chars. Use short IDs (REQ, AUTH, TOKEN, etc.).
Emit at most 18 nodes. Use subgraph blocks for logical stages.`;

    const summaryBlock = buildFileSummaryBlock(cig);

    const userPrompt = `Generate a Mermaid flowchart TD showing the authentication and authorization flow.
${summaryBlock ? `\n## Key File Summaries (auth-related files)\n${summaryBlock}\n` : ''}
Show the complete auth lifecycle from request to protected resource:
  Incoming Request → Auth Middleware → Token/Session Validation →
  Permission/Role Check → Protected Resource (or 401/403 rejection)

Auth patterns detected in this repo:
${sections.join('\n')}

Guidelines:
- Use subgraph blocks to group: Request Entry, Authentication Layer, Authorization Layer, Resource Access
- Show both the happy path (authenticated) and rejection paths (401 Unauthorized, 403 Forbidden)
- If RBAC detected, show permission/role check as a separate gate after token validation
- If OAuth detected, show token exchange step
- If session detected, show session store lookup
- Keep it high-level — no individual file names, just conceptual flow stages

Output only the Mermaid flowchart TD block (starting with "flowchart TD").`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 900,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    const authTypes: string[] = [];
    if (hasJwt) authTypes.push('JWT');
    if (hasOAuth) authTypes.push('OAuth');
    if (hasSession) authTypes.push('Session');
    if (hasRbac) authTypes.push('RBAC');

    const description = authTypes.length > 0
      ? `${authTypes.join(' + ')} authentication flow — request validation through protected resource access`
      : 'Authentication and authorization flow — request validation through protected resource access';

    return {
      diagramType: 'flowchart',
      mermaid,
      title: 'Authentication & Authorization Flow',
      description,
      llmUsed: true,
    };
  }
}

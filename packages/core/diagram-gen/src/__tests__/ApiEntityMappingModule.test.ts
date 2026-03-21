import type { CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

import { ApiEntityMappingModule } from '../diagrams/backend/ApiEntityMappingModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeNode(
  nodeId: string,
  filePath: string,
  symbolName?: string,
  symbolType: CIGNode['symbolType'] = 'function',
  metadata?: Record<string, unknown>,
): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath,
    symbolName: symbolName ?? nodeId,
    symbolType,
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-abc',
    metadata: metadata ?? null,
  };
}

function routeNode(
  nodeId: string,
  filePath: string,
  method: string,
  path: string,
): CIGNode {
  return makeNode(nodeId, filePath, `${method} ${path}`, 'route', { method, path });
}

function schemaNode(nodeId: string, filePath: string, symbolName: string): CIGNode {
  return makeNode(nodeId, filePath, symbolName, 'schema');
}

function callEdge(edgeId: string, from: string, to: string): CIGEdge {
  return { edgeId, repoId: REPO_ID, fromNodeId: from, toNodeId: to, edgeType: 'calls' };
}

function importEdge(edgeId: string, from: string, to: string): CIGEdge {
  return { edgeId, repoId: REPO_ID, fromNodeId: from, toNodeId: to, edgeType: 'imports' };
}

function snap(nodes: CIGNode[], edges: CIGEdge[] = []): CIGSnapshot {
  return { nodes, edges };
}

const VALID_MERMAID = 'graph LR\n  ROUTE_users --> ENTITY_User';

function makeMockLLM(returnValue: string = VALID_MERMAID): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn().mockResolvedValue(returnValue),
    stream: jest.fn(),
  } as unknown as jest.Mocked<LLMClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiEntityMappingModule', () => {
  let mod: ApiEntityMappingModule;

  beforeEach(() => {
    mod = new ApiEntityMappingModule();
  });

  // ── Static properties ─────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('backend/api-entity-mapping');
    expect(mod.llmNeeded).toBe(false); // can run AST-only
    expect(mod.triggersOn).toContain('framework:express');
    expect(mod.triggersOn).toContain('framework:fastify');
    expect(mod.triggersOn).toContain('framework:koa');
    expect(mod.triggersOn).toContain('framework:nestjs');
    expect(mod.triggersOn).toContain('framework:hapi');
    expect(mod.triggersOn).toHaveLength(5);
  });

  // ── Null-return conditions ────────────────────────────────────────────────

  it('returns null for empty CIG', async () => {
    expect(await mod.generate(snap([]))).toBeNull();
  });

  it('returns null when no route nodes are present', async () => {
    const nodes = [
      makeNode('n1', 'src/services/UserService.ts', 'UserService'),
      schemaNode('s1', 'src/models/User.ts', 'User'),
    ];
    expect(await mod.generate(snap(nodes))).toBeNull();
  });

  it('returns null when no route nodes exist even with LLM provided', async () => {
    const llm = makeMockLLM();
    const nodes = [schemaNode('s1', 'src/models/User.ts', 'User')];
    expect(await mod.generate(snap(nodes), llm)).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  // ── AST path: basic route grouping ───────────────────────────────────────

  it('AST path: generates graph LR from route nodes', async () => {
    const nodes = [routeNode('r1', 'src/routes/users.ts', 'GET', '/users')];
    const result = await mod.generate(snap(nodes));

    expect(result).not.toBeNull();
    expect(result!.diagramType).toBe('graph');
    expect(result!.mermaid).toMatch(/^graph LR/);
    expect(result!.llmUsed).toBe(false);
    expect(result!.title).toBe('API → Entity Mapping');
  });

  it('AST path: groups routes by resource prefix', async () => {
    const nodes = [
      routeNode('r1', 'src/routes/users.ts', 'GET', '/users'),
      routeNode('r2', 'src/routes/users.ts', 'POST', '/users'),
      routeNode('r3', 'src/routes/orders.ts', 'GET', '/orders'),
    ];
    const result = await mod.generate(snap(nodes));

    expect(result).not.toBeNull();
    // users group and orders group
    expect(result!.mermaid).toContain('ROUTE_users');
    expect(result!.mermaid).toContain('ROUTE_orders');
    // /users has 2 routes
    expect(result!.mermaid).toContain('/users (2)');
  });

  it('AST path: links route group to schema entity when directly called', async () => {
    const route = routeNode('r1', 'src/routes/users.ts', 'GET', '/users');
    const schema = schemaNode('s1', 'src/models/User.ts', 'User');
    // Direct call: route → schema
    const edge = callEdge('e1', 'r1', 's1');

    const result = await mod.generate(snap([route, schema], [edge]));

    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('ROUTE_users');
    expect(result!.mermaid).toContain('ENTITY_User');
    expect(result!.mermaid).toContain('-->');
  });

  it('AST path: traces 2-hop call edges (route → service → entity)', async () => {
    const route = routeNode('r1', 'src/routes/orders.ts', 'POST', '/orders');
    const service = makeNode('svc1', 'src/services/OrderService.ts', 'OrderService');
    const schema = schemaNode('e1', 'src/models/Order.ts', 'Order');

    const edges = [
      callEdge('c1', 'r1', 'svc1'),   // route → service
      callEdge('c2', 'svc1', 'e1'),   // service → schema
    ];

    const result = await mod.generate(snap([route, service, schema], edges));

    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('ENTITY_Order');
  });

  it('AST path: emits unlinked schema nodes as standalone entity nodes', async () => {
    const route = routeNode('r1', 'src/routes/users.ts', 'GET', '/users');
    const schema = schemaNode('s1', 'src/models/User.ts', 'User');
    // No edges — schema node should still appear

    const result = await mod.generate(snap([route, schema]));

    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('ENTITY_User');
  });

  it('AST path: nodeMap uses ROUTE_ prefix for route groups', async () => {
    const route = routeNode('r1', 'src/routes/users.ts', 'GET', '/users');
    const result = await mod.generate(snap([route]));

    expect(result!.nodeMap).toBeDefined();
    expect(result!.nodeMap!['ROUTE_users']).toBe('src/routes/users.ts');
  });

  it('AST path: nodeMap uses ENTITY_ prefix for schema nodes', async () => {
    const route = routeNode('r1', 'src/routes/users.ts', 'GET', '/users');
    const schema = schemaNode('s1', 'src/models/User.ts', 'User');
    const edge = callEdge('e1', 'r1', 's1');

    const result = await mod.generate(snap([route, schema], [edge]));

    expect(result!.nodeMap!['ENTITY_User']).toBe('src/models/User.ts');
  });

  it('AST path: description includes route and entity counts', async () => {
    const nodes = [
      routeNode('r1', 'src/routes/users.ts', 'GET', '/users'),
      schemaNode('s1', 'src/models/User.ts', 'User'),
    ];
    const result = await mod.generate(snap(nodes));
    expect(result!.description).toContain('1 route');
    expect(result!.description).toContain('1 data entity');
  });

  it('AST path: ignores non-call edges when tracing route→entity', async () => {
    const route = routeNode('r1', 'src/routes/users.ts', 'GET', '/users');
    const schema = schemaNode('s1', 'src/models/User.ts', 'User');
    // import edge (not a call edge) — should NOT create route→entity link
    const edge = importEdge('e1', 'r1', 's1');

    const result = await mod.generate(snap([route, schema], [edge]));

    expect(result).not.toBeNull();
    // Route and schema exist but are not linked
    expect(result!.mermaid).not.toMatch(/ROUTE_users.*-->.*ENTITY_User/);
  });

  // ── LLM path ─────────────────────────────────────────────────────────────

  it('LLM path: calls llmClient.complete() when route nodes exist', async () => {
    const llm = makeMockLLM();
    const nodes = [routeNode('r1', 'src/routes/users.ts', 'GET', '/users')];

    const result = await mod.generate(snap(nodes), llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.llmUsed).toBe(true);
    expect(result!.mermaid).toBe(VALID_MERMAID);
  });

  it('LLM path: passes route and entity context in user prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [
      routeNode('r1', 'src/routes/users.ts', 'GET', '/users'),
      schemaNode('s1', 'src/models/User.ts', 'User'),
    ];

    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('GET /users');
    expect(userPrompt).toContain('User');
  });

  it('LLM path: falls back to AST if extractMermaid returns null', async () => {
    const llm = makeMockLLM('This is not valid mermaid content.');
    const nodes = [routeNode('r1', 'src/routes/users.ts', 'GET', '/users')];

    const result = await mod.generate(snap(nodes), llm);

    // Falls back to AST diagram
    expect(result).not.toBeNull();
    expect(result!.llmUsed).toBe(false);
    expect(result!.mermaid).toMatch(/^graph LR/);
  });

  it('LLM path: nodeMap includes ROUTE_ and ENTITY_ prefixes from route/schema nodes', async () => {
    const llm = makeMockLLM();
    const nodes = [
      routeNode('r1', 'src/routes/users.ts', 'GET', '/users'),
      schemaNode('s1', 'src/models/User.ts', 'User'),
    ];

    const result = await mod.generate(snap(nodes), llm);

    expect(result!.nodeMap).toBeDefined();
    expect(result!.nodeMap!['ROUTE_users']).toBe('src/routes/users.ts');
    expect(result!.nodeMap!['ENTITY_User']).toBe('src/models/User.ts');
  });

  it('LLM path: strips mermaid fences from LLM output', async () => {
    const llm = makeMockLLM('```mermaid\ngraph LR\n  A --> B\n```');
    const nodes = [routeNode('r1', 'src/routes/users.ts', 'GET', '/users')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.mermaid).not.toContain('```');
    expect(result!.mermaid).toContain('graph LR');
    expect(result!.llmUsed).toBe(true);
  });

  it('LLM path: passes maxTokens and temperature in LLM options', async () => {
    const llm = makeMockLLM();
    const nodes = [routeNode('r1', 'src/routes/users.ts', 'GET', '/users')];

    await mod.generate(snap(nodes), llm);

    const [, , opts] = (llm.complete as jest.Mock).mock.calls[0];
    expect(opts).toMatchObject({ maxTokens: 1000, temperature: 0.1 });
  });
});

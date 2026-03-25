import type { CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

import { AuthFlowModule } from '../diagrams/universal/AuthFlowModule';
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
  };
}

function snap(nodes: CIGNode[], edges: CIGEdge[] = []): CIGSnapshot {
  return { nodes, edges };
}

const VALID_MERMAID = 'flowchart TD\n  REQ --> AUTH --> RESOURCE';

function makeMockLLM(returnValue: string = VALID_MERMAID): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn().mockResolvedValue(returnValue),
    stream: jest.fn(),
  } as unknown as jest.Mocked<LLMClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthFlowModule', () => {
  let mod: AuthFlowModule;

  beforeEach(() => {
    mod = new AuthFlowModule();
  });

  // ── Static properties ──────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('universal/auth-flow');
    expect(mod.llmNeeded).toBe(true);
    expect(mod.triggersOn).toContain('auth:jwt');
    expect(mod.triggersOn).toContain('auth:oauth');
    expect(mod.triggersOn).toContain('auth:session');
    expect(mod.triggersOn).toContain('auth:middleware');
  });

  // ── Early exits ────────────────────────────────────────────────────────────

  it('returns null when no llmClient is provided', async () => {
    const nodes = [makeNode('n1', 'src/middleware/auth.ts')];
    const result = await mod.generate(snap(nodes), undefined);
    expect(result).toBeNull();
  });

  it('returns null when no auth-related files exist', async () => {
    const nodes = [
      makeNode('n1', 'src/index.ts'),
      makeNode('n2', 'src/utils/helpers.ts'),
    ];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when ONLY rbac/permission/role files are present (no jwt/oauth/session/middleware)', async () => {
    // RBAC-only does not count as core auth files — early exit must still fire
    const nodes = [
      makeNode('n1', 'src/rbac/permissions.ts', 'checkPermission'),
      makeNode('n2', 'src/rbac/roles.ts', 'isAuthorized'),
      makeNode('n3', 'src/policies/resource-policy.ts', 'ResourcePolicy'),
    ];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when LLM returns invalid mermaid', async () => {
    const nodes = [makeNode('n1', 'src/middleware/auth.ts')];
    const llm = makeMockLLM('This is not valid mermaid at all');
    const result = await mod.generate(snap(nodes), llm);
    expect(result).toBeNull();
  });

  // ── JWT detection ──────────────────────────────────────────────────────────

  it('generates diagram for JWT auth files', async () => {
    const nodes = [makeNode('n1', 'src/utils/jwt.ts', 'verifyToken')];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).not.toBeNull();
    expect(llm.complete).toHaveBeenCalled();
    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('JWT');
  });

  // ── OAuth detection ────────────────────────────────────────────────────────

  it('generates diagram for OAuth/Passport files', async () => {
    const nodes = [makeNode('n1', 'src/auth/passport/strategy.ts')];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).not.toBeNull();
    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('OAuth');
  });

  // ── Middleware detection ───────────────────────────────────────────────────

  it('generates diagram for auth middleware files', async () => {
    const nodes = [makeNode('n1', 'src/middleware/auth.ts', 'authMiddleware')];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).not.toBeNull();
  });

  it('generates diagram for auth guard files', async () => {
    const nodes = [makeNode('n1', 'src/guards/auth.guard.ts', 'AuthGuard')];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).not.toBeNull();
  });

  // ── Output shape ───────────────────────────────────────────────────────────

  it('returns correct MermaidDiagram shape', async () => {
    const nodes = [makeNode('n1', 'src/utils/jwt.ts')];
    const llm = makeMockLLM();
    const result = await mod.generate(snap(nodes), llm);
    expect(result).toMatchObject({
      diagramType: 'flowchart',
      title: 'Authentication & Authorization Flow',
      llmUsed: true,
    });
    expect(result!.mermaid).toContain('flowchart TD');
    expect(result!.description).toContain('JWT');
  });

  // ── RBAC mention ───────────────────────────────────────────────────────────

  it('mentions RBAC in prompt when permission files detected', async () => {
    const nodes = [
      makeNode('n1', 'src/utils/jwt.ts'),
      makeNode('n2', 'src/rbac/permissions.ts'),
    ];
    const llm = makeMockLLM();
    await mod.generate(snap(nodes), llm);
    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('Role-based');
  });

  // ── Route count ────────────────────────────────────────────────────────────

  it('includes route count in prompt when routes are present', async () => {
    const nodes = [
      makeNode('n1', 'src/utils/jwt.ts'),
      makeNode('r1', 'src/routes/api.ts', 'GET /users', 'route'),
      makeNode('r2', 'src/routes/api.ts', 'POST /users', 'route'),
    ];
    const llm = makeMockLLM();
    await mod.generate(snap(nodes), llm);
    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('route endpoint');
  });

  // ── LLM prompt quality ─────────────────────────────────────────────────────

  it('passes system and user prompts correctly to llmClient.complete', async () => {
    const nodes = [makeNode('n1', 'src/middleware/auth.ts')];
    const llm = makeMockLLM();
    await mod.generate(snap(nodes), llm);
    expect(llm.complete).toHaveBeenCalledWith(
      expect.stringContaining('flowchart TD'),
      expect.stringContaining('authentication and authorization'),
      expect.objectContaining({ maxTokens: 900, temperature: 0.1 }),
    );
  });
});

import type { CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

import { HighLevelArchitectureModule } from '../diagrams/universal/HighLevelArchitectureModule';
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

/** Build a snapshot with `count` unique source files, each in distinct paths. */
function makeFileSnap(count: number): CIGSnapshot {
  const nodes = Array.from({ length: count }, (_, i) =>
    makeNode(`n${i}`, `src/module${i}/file${i}.ts`),
  );
  return snap(nodes);
}

/** Valid mermaid string returned from the LLM mock. */
const VALID_MERMAID = 'flowchart TD\n  A --> B';

function makeMockLLM(returnValue: string = VALID_MERMAID): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn().mockResolvedValue(returnValue),
    stream: jest.fn(),
  } as unknown as jest.Mocked<LLMClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HighLevelArchitectureModule', () => {
  let mod: HighLevelArchitectureModule;

  beforeEach(() => {
    mod = new HighLevelArchitectureModule();
  });

  // ── Static properties ─────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('universal/high-level-architecture');
    expect(mod.llmNeeded).toBe(true);
    expect(mod.triggersOn).toHaveLength(0); // always-on
  });

  // ── Null-return conditions ────────────────────────────────────────────────

  it('returns null when llmClient is undefined', async () => {
    const cig = makeFileSnap(15);
    expect(await mod.generate(cig, undefined)).toBeNull();
  });

  it('returns null when fewer than 10 source files (0 files)', async () => {
    const llm = makeMockLLM();
    expect(await mod.generate(snap([]), llm)).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when fewer than 10 source files (9 files)', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(9);
    expect(await mod.generate(cig, llm)).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when extractMermaid returns null (LLM outputs invalid content)', async () => {
    const llm = makeMockLLM('This is not valid mermaid at all.');
    const cig = makeFileSnap(12);
    expect(await mod.generate(cig, llm)).toBeNull();
  });

  it('returns null when LLM returns an empty string', async () => {
    const llm = makeMockLLM('');
    const cig = makeFileSnap(12);
    expect(await mod.generate(cig, llm)).toBeNull();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('produces a flowchart diagram with exactly 10 source files', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(10);
    const result = await mod.generate(cig, llm);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('High-Level Architecture');
    expect(result!.diagramType).toBe('flowchart');
    expect(result!.llmUsed).toBe(true);
    expect(result!.mermaid).toBe(VALID_MERMAID);
  });

  it('produces a diagram for a large repo (50 files)', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(50);
    const result = await mod.generate(cig, llm);

    expect(result).not.toBeNull();
    expect(result!.llmUsed).toBe(true);
  });

  // ── LLM call arguments ────────────────────────────────────────────────────

  it('calls llmClient.complete() once', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(12);
    await mod.generate(cig, llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('passes source file count and layer context in the user prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => makeNode(`r${i}`, `src/routes/route${i}.ts`)),
      ...Array.from({ length: 4 }, (_, i) => makeNode(`s${i}`, `src/services/service${i}.ts`)),
    ];
    const cig = snap(nodes);
    await mod.generate(cig, llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('12'); // total source files
    expect(userPrompt).toContain('flowchart TD');
  });

  it('passes maxTokens and temperature options', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(12);
    await mod.generate(cig, llm);

    const [, , opts] = (llm.complete as jest.Mock).mock.calls[0];
    expect(opts).toMatchObject({ maxTokens: 1000, temperature: 0.15 });
  });

  // ── External dependency detection ─────────────────────────────────────────

  it('detects Prisma from symbol names and includes it in LLM prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => makeNode(`n${i}`, `src/module${i}/file${i}.ts`)),
      makeNode('prismaClient', 'src/db/prismaClient.ts', 'prisma'),
      makeNode('userModel', 'src/models/user.ts', 'userModel'),
      makeNode('orderModel', 'src/models/order.ts', 'orderModel'),
    ];
    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('Prisma ORM');
  });

  it('detects Redis from symbol names', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`, `src/module${i}/f.ts`)),
      makeNode('redisClient', 'src/cache/redis.ts', 'ioredis'),
    ];
    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('Redis');
  });

  it('detects HTTP client (axios) from symbol names', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 10 }, (_, i) => makeNode(`n${i}`, `src/module${i}/f.ts`)),
      makeNode('httpClient', 'src/http/client.ts', 'axios'),
    ];
    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('HTTP Client');
  });

  it('reports no external deps when none are found', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(10);
    await mod.generate(cig, llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('No well-known external dependencies detected');
  });

  // ── Layer detection ───────────────────────────────────────────────────────

  it('includes routes layer in prompt when /routes/ files exist', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => makeNode(`r${i}`, `src/routes/route${i}.ts`)),
      ...Array.from({ length: 5 }, (_, i) => makeNode(`s${i}`, `src/services/svc${i}.ts`)),
      ...Array.from({ length: 5 }, (_, i) => makeNode(`m${i}`, `src/models/model${i}.ts`)),
    ];
    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('API / Routes');
  });

  it('counts route nodes and includes in prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => makeNode(`n${i}`, `src/module${i}/f.ts`)),
      makeNode('r1', 'src/routes/user.ts', 'GET /users', 'route'),
      makeNode('r2', 'src/routes/order.ts', 'POST /orders', 'route'),
    ];
    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('2 route handler');
  });

  // ── Output shape ──────────────────────────────────────────────────────────

  it('does not include nodeMap (LLM conceptual labels cannot map to file paths)', async () => {
    const llm = makeMockLLM();
    const cig = makeFileSnap(12);
    const result = await mod.generate(cig, llm);

    // nodeMap is intentionally omitted for this module
    expect(result!.nodeMap).toBeUndefined();
  });

  it('strips mermaid code fences from LLM output', async () => {
    const llm = makeMockLLM('```mermaid\nflowchart TD\n  A --> B\n```');
    const cig = makeFileSnap(10);
    const result = await mod.generate(cig, llm);

    expect(result).not.toBeNull();
    expect(result!.mermaid).not.toContain('```');
    expect(result!.mermaid).toContain('flowchart TD');
  });
});

import type { CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

import { StateManagementModule } from '../diagrams/frontend/StateManagementModule';
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

function importEdge(edgeId: string, from: string, to: string): CIGEdge {
  return { edgeId, repoId: REPO_ID, fromNodeId: from, toNodeId: to, edgeType: 'imports' };
}

function snap(nodes: CIGNode[], edges: CIGEdge[] = []): CIGSnapshot {
  return { nodes, edges };
}

const VALID_MERMAID = 'graph TD\n  STORE1 --> COMP1';

function makeMockLLM(returnValue: string = VALID_MERMAID): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn().mockResolvedValue(returnValue),
    stream: jest.fn(),
  } as unknown as jest.Mocked<LLMClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StateManagementModule', () => {
  let mod: StateManagementModule;

  beforeEach(() => {
    mod = new StateManagementModule();
  });

  // ── Static properties ─────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('frontend/state-management');
    expect(mod.llmNeeded).toBe(false); // can run AST-only
    expect(mod.triggersOn).toContain('state-management:redux');
    expect(mod.triggersOn).toContain('state-management:zustand');
    expect(mod.triggersOn).toContain('state-management:context');
    expect(mod.triggersOn).toContain('state-management:mobx');
    expect(mod.triggersOn).toHaveLength(4);
  });

  // ── Null-return conditions ────────────────────────────────────────────────

  it('returns null for empty CIG', async () => {
    expect(await mod.generate(snap([]))).toBeNull();
  });

  it('returns null when no state nodes are detected', async () => {
    const nodes = [
      makeNode('n1', 'src/components/Button.tsx', 'Button'),
      makeNode('n2', 'src/pages/Home.tsx', 'Home'),
    ];
    expect(await mod.generate(snap(nodes))).toBeNull();
  });

  // ── State node detection ──────────────────────────────────────────────────

  it('detects Redux nodes by symbol name (createSlice)', async () => {
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('Redux');
  });

  it('detects Redux nodes by symbol name (configureStore)', async () => {
    const nodes = [makeNode('n1', 'src/store/store.ts', 'configureStore')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
  });

  it('detects Redux nodes by file path pattern (slices/ directory)', async () => {
    const nodes = [makeNode('n1', 'src/slices/counterSlice.ts', 'counterReducer')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('Redux');
  });

  it('detects Zustand nodes by symbol name', async () => {
    const nodes = [makeNode('n1', 'src/store/useAppStore.ts', 'useStore')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('Zustand');
  });

  it('detects Context nodes by symbol name (createContext)', async () => {
    const nodes = [makeNode('n1', 'src/context/AuthContext.tsx', 'createContext')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('Context');
  });

  it('detects Context nodes by file path (contexts/ directory)', async () => {
    const nodes = [makeNode('n1', 'src/contexts/ThemeContext.tsx', 'ThemeContext')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('Context');
  });

  it('detects MobX nodes by symbol name (makeObservable)', async () => {
    const nodes = [makeNode('n1', 'src/stores/UserStore.ts', 'makeObservable')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('MobX');
  });

  it('detects state nodes by store.ts file name pattern', async () => {
    const nodes = [makeNode('n1', 'src/app/store.ts', 'AppStore')];
    const result = await mod.generate(snap(nodes));
    expect(result).not.toBeNull();
  });

  // ── AST-only path ─────────────────────────────────────────────────────────

  it('AST path: generates graph TD without llmClient', async () => {
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];
    const result = await mod.generate(snap(nodes), undefined);

    expect(result).not.toBeNull();
    expect(result!.diagramType).toBe('graph');
    expect(result!.mermaid).toMatch(/^graph TD/);
    expect(result!.llmUsed).toBe(false);
    expect(result!.title).toBe('State Management');
  });

  it('AST path: populates nodeMap with state file paths', async () => {
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];
    const result = await mod.generate(snap(nodes), undefined);

    expect(result!.nodeMap).toBeDefined();
    const values = Object.values(result!.nodeMap!);
    expect(values).toContain('src/store/userSlice.ts');
  });

  it('AST path: includes component→state edge when import exists', async () => {
    const stateNode = makeNode('state1', 'src/store/userSlice.ts', 'createSlice');
    const compNode = makeNode('comp1', 'src/components/UserProfile.tsx', 'UserProfile');
    const edge = importEdge('e1', 'comp1', 'state1');

    const result = await mod.generate(snap([stateNode, compNode], [edge]), undefined);

    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('-->');
    // Component file path should be in nodeMap
    const values = Object.values(result!.nodeMap!);
    expect(values).toContain('src/components/UserProfile.tsx');
  });

  it('AST path: description includes state node count', async () => {
    const nodes = [
      makeNode('n1', 'src/store/userSlice.ts', 'createSlice'),
      makeNode('n2', 'src/store/cartSlice.ts', 'cartReducer'),
    ];
    const result = await mod.generate(snap(nodes), undefined);
    expect(result!.description).toContain('2 state node');
  });

  // ── LLM path ─────────────────────────────────────────────────────────────

  it('LLM path: calls llmClient.complete() when llmClient is provided', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];

    const result = await mod.generate(snap(nodes), llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.llmUsed).toBe(true);
    expect(result!.mermaid).toBe(VALID_MERMAID);
  });

  it('LLM path: falls back to AST if extractMermaid returns null (bad LLM output)', async () => {
    const llm = makeMockLLM('This is not valid mermaid content.');
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];

    const result = await mod.generate(snap(nodes), llm);

    // Falls back to AST
    expect(result).not.toBeNull();
    expect(result!.llmUsed).toBe(false);
    expect(result!.mermaid).toMatch(/^graph TD/);
  });

  it('LLM path: populates nodeMap from state nodes regardless of LLM output', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result!.nodeMap).toBeDefined();
    const values = Object.values(result!.nodeMap!);
    expect(values).toContain('src/store/userSlice.ts');
  });

  it('LLM path: passes state node list in user prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];

    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('createSlice');
  });

  it('LLM path: strips mermaid fences from LLM output', async () => {
    const llm = makeMockLLM('```mermaid\ngraph TD\n  STORE1 --> COMP1\n```');
    const nodes = [makeNode('n1', 'src/store/userSlice.ts', 'createSlice')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.mermaid).not.toContain('```');
    expect(result!.mermaid).toContain('graph TD');
    expect(result!.llmUsed).toBe(true);
  });
});

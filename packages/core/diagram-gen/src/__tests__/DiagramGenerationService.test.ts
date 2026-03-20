import { createHash } from 'crypto';

import type {
  Artifact,
  ArtifactInput,
  CIGEdge,
  CIGNode,
  LLMClient,
  Logger,
  StorageAdapter,
} from '@codeinsight/types';

import { DiagramGenerationService } from '../DiagramGenerationService';
import { DiagramRegistry } from '../DiagramRegistry';
import type { DiagramModule, MermaidDiagram } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeNode(nodeId: string, filePath: string): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath,
    symbolName: nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-abc',
  };
}

function makeImportEdge(edgeId: string, fromNodeId: string, toNodeId: string): CIGEdge {
  return {
    edgeId,
    repoId: REPO_ID,
    fromNodeId,
    toNodeId,
    edgeType: 'imports',
  };
}

const CIG_NODES: CIGNode[] = [
  makeNode('n:a', 'src/a.ts'),
  makeNode('n:b', 'src/b.ts'),
];

const CIG_EDGES: CIGEdge[] = [makeImportEdge('e1', 'n:a', 'n:b')];

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeLLMClient(): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue('graph TD\n  A --> B'),
    stream: jest.fn(),
  };
}

function makeStorageAdapter(overrides?: {
  existingArtifact?: Artifact | null;
  nodes?: CIGNode[];
  edges?: CIGEdge[];
}): StorageAdapter {
  return {
    getCIGNodes: jest.fn().mockResolvedValue(overrides?.nodes ?? CIG_NODES),
    getCIGEdges: jest.fn().mockResolvedValue(overrides?.edges ?? CIG_EDGES),
    getArtifact: jest.fn().mockResolvedValue(overrides?.existingArtifact ?? null),
    upsertArtifact: jest.fn().mockResolvedValue(undefined),
    upsertArtifactInputs: jest.fn().mockResolvedValue(undefined),
    // Unused stubs
    getRepo: jest.fn().mockResolvedValue(null),
    upsertRepo: jest.fn().mockResolvedValue(undefined),
    updateRepoStatus: jest.fn().mockResolvedValue(undefined),
    upsertRepoFiles: jest.fn().mockResolvedValue(undefined),
    getRepoFiles: jest.fn().mockResolvedValue([]),
    getChangedRepoFiles: jest.fn().mockResolvedValue([]),
    upsertCIGNodes: jest.fn().mockResolvedValue(undefined),
    upsertCIGEdges: jest.fn().mockResolvedValue(undefined),
    deleteCIGForFiles: jest.fn().mockResolvedValue(undefined),
    deleteRepoFilesNotIn: jest.fn().mockResolvedValue(undefined),
    getArtifactsByType: jest.fn().mockResolvedValue([]),
    getStaleArtifacts: jest.fn().mockResolvedValue([]),
    markArtifactsStale: jest.fn().mockResolvedValue(undefined),
    getArtifactInputs: jest.fn().mockResolvedValue([]),
    createJob: jest.fn().mockResolvedValue('job-id'),
    updateJob: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
    getActiveJobForRepo: jest.fn().mockResolvedValue(null),
  } as unknown as StorageAdapter;
}

/** Build a DiagramModule mock. */
function makeAstModule(
  id: string,
  diagram: MermaidDiagram | null = {
    diagramType: 'graph',
    mermaid: 'graph TD\n  A --> B',
    title: 'Test Diagram',
    llmUsed: false,
  },
): DiagramModule {
  return {
    id,
    requires: ['nodes', 'edges'],
    triggersOn: [],
    llmNeeded: false,
    generate: jest.fn().mockResolvedValue(diagram),
  };
}

function makeLlmModule(
  id: string,
  diagram: MermaidDiagram | null = {
    diagramType: 'graph',
    mermaid: 'graph TD\n  X --> Y',
    title: 'LLM Diagram',
    llmUsed: true,
  },
): DiagramModule {
  return {
    id,
    requires: ['nodes', 'edges'],
    triggersOn: [],
    llmNeeded: true,
    generate: jest.fn().mockResolvedValue(diagram),
  };
}

/** Create a registry containing only the supplied modules. */
function makeRegistry(...modules: DiagramModule[]): DiagramRegistry {
  const registry = new DiagramRegistry();
  for (const mod of modules) registry.register(mod);
  return registry;
}

/** Build a fresh artifact that looks up-to-date. */
function makeFreshArtifact(moduleId: string, inputSha: string): Artifact {
  return {
    repoId: REPO_ID,
    artifactId: moduleId,
    artifactType: 'diagram',
    content: {
      kind: 'diagram',
      diagramType: 'graph',
      mermaid: 'graph TD\n  A --> B',
      title: 'Cached',
    },
    inputSha,
    isStale: false,
    tokensUsed: 0,
    llmUsed: false,
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the same 16-char SHA that DiagramGenerationService uses, so tests
 * can match the exact inputSha value.
 */
function computeInputSha(nodes: CIGNode[], edges: CIGEdge[]): string {
  const nodeIds = nodes.map(n => n.nodeId).sort();
  const edgeIds = edges.map(e => e.edgeId).sort();
  const payload = [...nodeIds, '---', ...edgeIds].join('\n');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagramGenerationService', () => {
  describe('generateDiagrams()', () => {
    it('generates a diagram for a simple AST module', async () => {
      const mod = makeAstModule('universal/dep-graph');
      const storage = makeStorageAdapter();
      const logger = makeLogger();
      const service = new DiagramGenerationService(
        storage,
        logger,
        undefined,
        {},
        makeRegistry(mod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsGenerated).toBe(1);
      expect(result.diagramsSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].artifactId).toBe('universal/dep-graph');
      expect(storage.upsertArtifact).toHaveBeenCalledTimes(1);
    });

    it('skips a module when existing artifact is fresh and inputSha matches', async () => {
      const sha = computeInputSha(CIG_NODES, CIG_EDGES);
      const freshArtifact = makeFreshArtifact('universal/dep-graph', sha);
      const storage = makeStorageAdapter({ existingArtifact: freshArtifact });
      const mod = makeAstModule('universal/dep-graph');
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(mod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsSkipped).toBe(1);
      expect(result.diagramsGenerated).toBe(0);
      expect(storage.upsertArtifact).not.toHaveBeenCalled();
    });

    it('regenerates when existing artifact is stale (even if inputSha matches)', async () => {
      const sha = computeInputSha(CIG_NODES, CIG_EDGES);
      const staleArtifact: Artifact = {
        ...makeFreshArtifact('universal/dep-graph', sha),
        isStale: true,
        staleReason: 'file_changed',
      };
      const storage = makeStorageAdapter({ existingArtifact: staleArtifact });
      const mod = makeAstModule('universal/dep-graph');
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(mod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsGenerated).toBe(1);
      expect(result.diagramsSkipped).toBe(0);
      expect(storage.upsertArtifact).toHaveBeenCalledTimes(1);
    });

    it('regenerates when inputSha differs (CIG changed)', async () => {
      // Artifact stored with an old SHA
      const freshWithOldSha = makeFreshArtifact('universal/dep-graph', 'old-sha-1234567');
      const storage = makeStorageAdapter({ existingArtifact: freshWithOldSha });
      const mod = makeAstModule('universal/dep-graph');
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(mod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsGenerated).toBe(1);
    });

    it('skips LLM modules and counts them when no LLM client is configured', async () => {
      const llmMod = makeLlmModule('backend/api-flow');
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined, // no LLM client
        {},
        makeRegistry(llmMod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsSkipped).toBe(1);
      expect(result.diagramsGenerated).toBe(0);
      expect(llmMod.generate).not.toHaveBeenCalled();
    });

    it('runs LLM modules when an LLM client is provided', async () => {
      const llmMod = makeLlmModule('backend/api-flow');
      const storage = makeStorageAdapter();
      const llmClient = makeLLMClient();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        llmClient,
        {},
        makeRegistry(llmMod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsGenerated).toBe(1);
      expect(llmMod.generate).toHaveBeenCalledWith(
        expect.objectContaining({ nodes: CIG_NODES, edges: CIG_EDGES }),
        llmClient,
      );
    });

    it('counts tokens for LLM module diagrams (not for AST modules)', async () => {
      const mermaidContent = 'graph TD\n  A --> B --> C';
      const llmMod = makeLlmModule('backend/api-flow', {
        diagramType: 'graph',
        mermaid: mermaidContent,
        title: 'LLM Diagram',
        llmUsed: true,
      });
      const astMod = makeAstModule('universal/dep-graph');
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        makeLLMClient(),
        {},
        makeRegistry(astMod, llmMod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      // AST module contributes 0 tokens, LLM module contributes > 0
      expect(result.totalTokensUsed).toBeGreaterThan(0);
      const llmArtifact = result.artifacts.find(a => a.artifactId === 'backend/api-flow');
      const astArtifact = result.artifacts.find(a => a.artifactId === 'universal/dep-graph');
      expect(llmArtifact?.tokensUsed).toBeGreaterThan(0);
      expect(astArtifact?.tokensUsed).toBe(0);
    });

    it('accumulates totalTokensUsed across multiple LLM modules', async () => {
      const mermaid = 'graph TD\n  A --> B';
      const mod1 = makeLlmModule('m1', { diagramType: 'graph', mermaid, title: 'D1', llmUsed: true });
      const mod2 = makeLlmModule('m2', { diagramType: 'graph', mermaid, title: 'D2', llmUsed: true });
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        makeLLMClient(),
        {},
        makeRegistry(mod1, mod2),
      );

      const result = await service.generateDiagrams(REPO_ID);

      // Both modules produced the same mermaid string, so tokens should be twice the single estimate
      const singleTokens = Math.ceil(mermaid.length / 4);
      expect(result.totalTokensUsed).toBe(singleTokens * 2);
    });

    it('records error and continues when a module throws', async () => {
      const failingMod: DiagramModule = {
        id: 'failing/module',
        requires: ['nodes'],
        triggersOn: [],
        llmNeeded: false,
        generate: jest.fn().mockRejectedValue(new Error('Parser crashed')),
      };
      const okMod = makeAstModule('ok/module');
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(failingMod, okMod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].moduleId).toBe('failing/module');
      expect(result.errors[0].error).toContain('Parser crashed');
      expect(result.diagramsGenerated).toBe(1); // ok/module still ran
    });

    it('skips (not errors) when a module returns null', async () => {
      const nullMod = makeAstModule('empty/module', null);
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(nullMod),
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsSkipped).toBe(1);
      expect(result.diagramsGenerated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(storage.upsertArtifact).not.toHaveBeenCalled();
    });

    it('stores artifact with correct structure', async () => {
      const mod = makeAstModule('universal/dep-graph');
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(mod),
      );

      await service.generateDiagrams(REPO_ID);

      const artifact: Artifact = (storage.upsertArtifact as jest.Mock).mock.calls[0][0];
      expect(artifact.repoId).toBe(REPO_ID);
      expect(artifact.artifactId).toBe('universal/dep-graph');
      expect(artifact.artifactType).toBe('diagram');
      expect(artifact.isStale).toBe(false);
      expect(artifact.llmUsed).toBe(false);
      expect(artifact.content).toMatchObject({ kind: 'diagram', diagramType: 'graph' });
    });

    it('calls upsertArtifactInputs with one entry per unique file in the CIG', async () => {
      const mod = makeAstModule('universal/dep-graph');
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(mod),
      );

      await service.generateDiagrams(REPO_ID);

      expect(storage.upsertArtifactInputs).toHaveBeenCalledTimes(1);
      const inputs: ArtifactInput[] = (storage.upsertArtifactInputs as jest.Mock).mock.calls[0][0];
      // CIG_NODES has two distinct file paths
      expect(inputs).toHaveLength(2);
      expect(inputs[0].repoId).toBe(REPO_ID);
      expect(inputs[0].artifactId).toBe('universal/dep-graph');
    });

    it('returns an empty result when the registry has no modules', async () => {
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        makeRegistry(), // empty registry
      );

      const result = await service.generateDiagrams(REPO_ID);

      expect(result.diagramsGenerated).toBe(0);
      expect(result.diagramsSkipped).toBe(0);
      expect(result.artifacts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('passes detectedSignals to registry.selectModules', async () => {
      // Module gated on orm:prisma only — should be selected when signal present
      const ormMod: DiagramModule = {
        id: 'universal/er-diagram',
        requires: ['nodes', 'edges'],
        triggersOn: ['orm:prisma'],
        llmNeeded: false,
        generate: jest.fn().mockResolvedValue({
          diagramType: 'erDiagram',
          mermaid: 'erDiagram\n  User { int id }',
          title: 'ER',
          llmUsed: false,
        }),
      };
      const registry = new DiagramRegistry();
      registry.register(ormMod);
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(
        storage,
        makeLogger(),
        undefined,
        {},
        registry,
      );

      // With signal — module should run
      const withSignal = await service.generateDiagrams(REPO_ID, { orm: 'prisma' });
      expect(withSignal.diagramsGenerated).toBe(1);

      // Reset
      (storage.upsertArtifact as jest.Mock).mockClear();
      (storage.getArtifact as jest.Mock).mockResolvedValue(null);

      // Without signal — module skipped by registry
      const withoutSignal = await service.generateDiagrams(REPO_ID, {});
      expect(withoutSignal.diagramsGenerated).toBe(0);
      expect(withoutSignal.diagramsSkipped).toBe(0); // not even selected
    });

    it('uses config defaults when no config is supplied', async () => {
      // Verifies the service instantiates without throwing
      const storage = makeStorageAdapter();
      const service = new DiagramGenerationService(storage, makeLogger());
      const result = await service.generateDiagrams(REPO_ID);
      // Default registry selects built-in modules — no errors expected
      expect(result.errors).toHaveLength(0);
    });
  });
});

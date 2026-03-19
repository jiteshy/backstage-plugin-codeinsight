import type {
  Artifact,
  ArtifactInput,
  CIGEdge,
  CIGNode,
  LLMClient,
  Logger,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

import { DocGenerationService } from '../DocGenerationService';
import type { ClassifierResult, DocGenConfig } from '../types';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeLLMClient(responses?: Map<string, string>): LLMClient {
  return {
    complete: jest.fn().mockImplementation(
      (_sys: string, user: string) => {
        // Use the first line of user prompt as key for response lookup
        if (responses) {
          for (const [key, val] of responses) {
            if (user.includes(key)) return Promise.resolve(val);
          }
        }
        return Promise.resolve('## Generated Section\n\nDefault generated content.');
      },
    ),
    stream: jest.fn(),
  };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

const REPO_FILES: RepoFile[] = [
  { repoId: REPO_ID, filePath: 'package.json', currentSha: 'sha-pkg', fileType: 'config', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'README.md', currentSha: 'sha-readme', fileType: 'source', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/index.ts', currentSha: 'sha-index', fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/server.ts', currentSha: 'sha-server', fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/routes/users.ts', currentSha: 'sha-users', fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'Dockerfile', currentSha: 'sha-docker', fileType: 'infra', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: '.env.example', currentSha: 'sha-env', fileType: 'config', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'jest.config.ts', currentSha: 'sha-jest', fileType: 'config', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/__tests__/server.test.ts', currentSha: 'sha-test', fileType: 'test', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'prisma/schema.prisma', currentSha: 'sha-schema', fileType: 'schema', language: null, parseStatus: 'parsed' },
];

const CIG_NODES: CIGNode[] = [
  {
    nodeId: `${REPO_ID}:src/index.ts:<module>:variable`,
    repoId: REPO_ID,
    filePath: 'src/index.ts',
    symbolName: '<module>',
    symbolType: 'variable',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-index',
    metadata: { isEntryPoint: true, entryPointScore: 5 },
  },
  {
    nodeId: `${REPO_ID}:src/routes/users.ts:GET /users:route`,
    repoId: REPO_ID,
    filePath: 'src/routes/users.ts',
    symbolName: 'getUsers',
    symbolType: 'route',
    startLine: 5,
    endLine: 15,
    exported: true,
    extractedSha: 'sha-users',
    metadata: { method: 'GET', path: '/users' },
  },
  {
    nodeId: `${REPO_ID}:prisma/schema.prisma:User:schema`,
    repoId: REPO_ID,
    filePath: 'prisma/schema.prisma',
    symbolName: 'User',
    symbolType: 'schema',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-schema',
  },
];

const CIG_EDGES: CIGEdge[] = [
  {
    edgeId: 'edge-1',
    repoId: REPO_ID,
    fromNodeId: CIG_NODES[0].nodeId,
    toNodeId: CIG_NODES[1].nodeId,
    edgeType: 'imports',
  },
];

const CLASSIFIER_RESULT: ClassifierResult = {
  repoType: ['backend'],
  language: 'typescript',
  frameworks: ['express'],
  detectedSignals: { database: 'prisma', test_framework: 'jest' },
  promptModules: [
    'core/overview',
    'core/project-structure',
    'core/getting-started',
    'core/dependencies',
    'core/testing',
    'core/deployment',
    'backend/api-reference',
    'backend/database',
  ],
};

// ---------------------------------------------------------------------------
// Mock StorageAdapter
// ---------------------------------------------------------------------------

function makeStorageAdapter(overrides?: {
  existingArtifacts?: Map<string, Artifact>;
}): StorageAdapter {
  const existingArtifacts = overrides?.existingArtifacts ?? new Map();
  const upsertedArtifacts: Artifact[] = [];
  const upsertedInputs: ArtifactInput[] = [];

  return {
    getCIGNodes: jest.fn().mockResolvedValue(CIG_NODES),
    getCIGEdges: jest.fn().mockResolvedValue(CIG_EDGES),
    getRepoFiles: jest.fn().mockResolvedValue(REPO_FILES),
    getArtifact: jest.fn().mockImplementation(
      (artifactId: string, _repoId: string) =>
        Promise.resolve(existingArtifacts.get(artifactId) ?? null),
    ),
    upsertArtifact: jest.fn().mockImplementation((artifact: Artifact) => {
      upsertedArtifacts.push(artifact);
      return Promise.resolve();
    }),
    upsertArtifactInputs: jest.fn().mockImplementation((inputs: ArtifactInput[]) => {
      upsertedInputs.push(...inputs);
      return Promise.resolve();
    }),
    // Stubs for other StorageAdapter methods (not used in doc generation)
    getRepo: jest.fn().mockResolvedValue(null),
    upsertRepo: jest.fn().mockResolvedValue(undefined),
    updateRepoStatus: jest.fn().mockResolvedValue(undefined),
    upsertRepoFiles: jest.fn().mockResolvedValue(undefined),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocGenerationService', () => {
  describe('generateDocsWithClassification', () => {
    it('generates artifacts for all supported modules', async () => {
      const storage = makeStorageAdapter();
      const llm = makeLLMClient();
      const logger = makeLogger();
      const service = new DocGenerationService(storage, llm, logger);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        CLASSIFIER_RESULT,
      );

      expect(result.modulesGenerated).toBe(CLASSIFIER_RESULT.promptModules.length);
      expect(result.modulesSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.artifacts).toHaveLength(CLASSIFIER_RESULT.promptModules.length);

      // Verify all module IDs are present in artifacts
      const artifactIds = result.artifacts.map(a => a.artifactId);
      for (const moduleId of CLASSIFIER_RESULT.promptModules) {
        expect(artifactIds).toContain(moduleId);
      }
    });

    it('skips modules with fresh, non-stale artifacts with matching inputSha', async () => {
      // Create a fresh artifact for core/project-structure (no input files = empty SHA)
      const freshArtifact: Artifact = {
        repoId: REPO_ID,
        artifactId: 'core/project-structure',
        artifactType: 'doc',
        content: { kind: 'doc', module: 'core/project-structure', markdown: '## Existing' },
        inputSha: 'empty', // project-structure has no inputFiles, so its SHA = 'empty'
        isStale: false,
        tokensUsed: 100,
        llmUsed: true,
        generatedAt: new Date(),
      };

      const existingArtifacts = new Map<string, Artifact>();
      existingArtifacts.set('core/project-structure', freshArtifact);

      const storage = makeStorageAdapter({ existingArtifacts });
      const llm = makeLLMClient();
      const logger = makeLogger();
      const service = new DocGenerationService(storage, llm, logger);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        CLASSIFIER_RESULT,
      );

      // One module skipped
      expect(result.modulesSkipped).toBe(1);
      expect(result.modulesGenerated).toBe(CLASSIFIER_RESULT.promptModules.length - 1);
    });

    it('regenerates stale artifacts even with matching inputSha', async () => {
      const staleArtifact: Artifact = {
        repoId: REPO_ID,
        artifactId: 'core/project-structure',
        artifactType: 'doc',
        content: { kind: 'doc', module: 'core/project-structure', markdown: '## Old' },
        inputSha: 'empty',
        isStale: true,
        staleReason: 'file_changed',
        tokensUsed: 100,
        llmUsed: true,
        generatedAt: new Date(),
      };

      const existingArtifacts = new Map<string, Artifact>();
      existingArtifacts.set('core/project-structure', staleArtifact);

      const storage = makeStorageAdapter({ existingArtifacts });
      const llm = makeLLMClient();
      const service = new DocGenerationService(storage, llm);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        CLASSIFIER_RESULT,
      );

      // No skips — stale artifact is regenerated
      expect(result.modulesSkipped).toBe(0);
      expect(result.modulesGenerated).toBe(CLASSIFIER_RESULT.promptModules.length);
    });

    it('stores artifact with correct doc content structure', async () => {
      const storage = makeStorageAdapter();
      const llm = makeLLMClient();
      const service = new DocGenerationService(storage, llm);

      // Only run core/project-structure (no file reads needed)
      await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        { ...CLASSIFIER_RESULT, promptModules: ['core/project-structure'] },
      );

      expect(storage.upsertArtifact).toHaveBeenCalledTimes(1);
      const artifact = (storage.upsertArtifact as jest.Mock).mock.calls[0][0] as Artifact;

      expect(artifact.repoId).toBe(REPO_ID);
      expect(artifact.artifactId).toBe('core/project-structure');
      expect(artifact.artifactType).toBe('doc');
      expect(artifact.isStale).toBe(false);
      expect(artifact.llmUsed).toBe(true);
      expect(artifact.content).toMatchObject({
        kind: 'doc',
        module: 'core/project-structure',
      });
      expect((artifact.content as { markdown: string }).markdown).toBeTruthy();
    });

    it('handles LLM failures for individual modules gracefully', async () => {
      let callCount = 0;
      const llm: LLMClient = {
        complete: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 2) return Promise.reject(new Error('Rate limited'));
          return Promise.resolve('## Generated\n\nContent.');
        }),
        stream: jest.fn(),
      };

      const storage = makeStorageAdapter();
      const service = new DocGenerationService(storage, llm);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        { ...CLASSIFIER_RESULT, promptModules: ['core/overview', 'core/project-structure', 'core/dependencies'] },
      );

      // 1 error, 2 successes
      expect(result.errors).toHaveLength(1);
      expect(result.modulesGenerated).toBe(2);
    });

    it('respects concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const llm: LLMClient = {
        complete: jest.fn().mockImplementation(async () => {
          currentConcurrent++;
          if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
          await new Promise(r => setTimeout(r, 10));
          currentConcurrent--;
          return '## Generated\n\nContent.';
        }),
        stream: jest.fn(),
      };

      const storage = makeStorageAdapter();
      const config: DocGenConfig = { maxConcurrency: 2 };
      const service = new DocGenerationService(storage, llm, undefined, config);

      await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        { ...CLASSIFIER_RESULT, promptModules: ['core/overview', 'core/project-structure', 'core/dependencies', 'core/testing'] },
      );

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('tracks tokens used per artifact', async () => {
      const storage = makeStorageAdapter();
      const llm = makeLLMClient();
      const service = new DocGenerationService(storage, llm);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        { ...CLASSIFIER_RESULT, promptModules: ['core/project-structure'] },
      );

      expect(result.totalTokensUsed).toBeGreaterThan(0);
      expect(result.artifacts[0].tokensUsed).toBeGreaterThan(0);
    });

    it('filters unsupported modules from classifier output', async () => {
      const storage = makeStorageAdapter();
      const llm = makeLLMClient();
      const service = new DocGenerationService(storage, llm);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        {
          ...CLASSIFIER_RESULT,
          promptModules: ['core/overview', 'nonexistent/module', 'core/project-structure'],
        },
      );

      // nonexistent/module is filtered out, only 2 modules run
      expect(result.modulesGenerated).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('returns empty result for empty module list', async () => {
      const storage = makeStorageAdapter();
      const llm = makeLLMClient();
      const service = new DocGenerationService(storage, llm);

      const result = await service.generateDocsWithClassification(
        REPO_ID,
        '/tmp/fake-clone',
        { ...CLASSIFIER_RESULT, promptModules: [] },
      );

      expect(result.modulesGenerated).toBe(0);
      expect(result.modulesSkipped).toBe(0);
      expect(result.artifacts).toHaveLength(0);
    });
  });
});

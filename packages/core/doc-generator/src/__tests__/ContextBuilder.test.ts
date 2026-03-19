import type { CIGEdge, CIGNode, RepoFile } from '@codeinsight/types';

import { ContextBuilder, computeInputSha } from '../ContextBuilder';
import type { ClassifierResult } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

const REPO_FILES: RepoFile[] = [
  { repoId: REPO_ID, filePath: 'package.json', currentSha: 'sha-pkg', fileType: 'config', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'README.md', currentSha: 'sha-readme', fileType: 'source', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/index.ts', currentSha: 'sha-index', fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/routes/users.ts', currentSha: 'sha-users', fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: '.env.example', currentSha: 'sha-env', fileType: 'config', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'Dockerfile', currentSha: 'sha-docker', fileType: 'infra', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'jest.config.ts', currentSha: 'sha-jest', fileType: 'config', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'src/__tests__/server.test.ts', currentSha: 'sha-test1', fileType: 'test', language: 'typescript', parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: 'prisma/schema.prisma', currentSha: 'sha-prisma', fileType: 'schema', language: null, parseStatus: 'parsed' },
  { repoId: REPO_ID, filePath: '.github/workflows/ci.yml', currentSha: 'sha-ci', fileType: 'ci', language: null, parseStatus: 'parsed' },
];

const CIG_NODES: CIGNode[] = [
  {
    nodeId: `${REPO_ID}:src/index.ts:<module>:variable`,
    repoId: REPO_ID,
    filePath: 'src/index.ts',
    symbolName: '<module>',
    symbolType: 'variable',
    startLine: 1,
    endLine: 20,
    exported: false,
    extractedSha: 'sha-index',
    metadata: { isEntryPoint: true, entryPointScore: 5 },
  },
  {
    nodeId: `${REPO_ID}:src/routes/users.ts:getUsers:route`,
    repoId: REPO_ID,
    filePath: 'src/routes/users.ts',
    symbolName: 'getUsers',
    symbolType: 'route',
    startLine: 5,
    endLine: 15,
    exported: true,
    extractedSha: 'sha-users',
    metadata: { method: 'GET', path: '/api/users' },
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
    extractedSha: 'sha-prisma',
  },
];

const CIG_EDGES: CIGEdge[] = [];

const CLASSIFIER_RESULT: ClassifierResult = {
  repoType: ['backend'],
  language: 'typescript',
  frameworks: ['express'],
  detectedSignals: { database: 'prisma', test_framework: 'jest' },
  promptModules: ['core/overview', 'core/project-structure', 'backend/api-reference'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextBuilder', () => {
  // Use a nonexistent cloneDir — file reads will fail gracefully for most modules
  const cloneDir = '/tmp/nonexistent-clone-dir';

  const builder = new ContextBuilder(
    CIG_NODES,
    CIG_EDGES,
    REPO_FILES,
    CLASSIFIER_RESULT,
    cloneDir,
  );

  describe('buildContext', () => {
    it('returns null for unknown modules', async () => {
      const result = await builder.buildContext('nonexistent/module');
      expect(result).toBeNull();
    });

    it('builds context for core/project-structure (no file reads)', async () => {
      const ctx = await builder.buildContext('core/project-structure');

      expect(ctx).not.toBeNull();
      expect(ctx!.systemPrompt).toContain('Project Structure');
      expect(ctx!.userPrompt).toContain('package.json');
      expect(ctx!.userPrompt).toContain('src/index.ts');
      // project-structure has no input files (pure path listing)
      expect(ctx!.inputFiles).toHaveLength(0);
    });

    it('builds context for frontend/component-hierarchy (no file reads)', async () => {
      const ctx = await builder.buildContext('frontend/component-hierarchy');

      expect(ctx).not.toBeNull();
      expect(ctx!.systemPrompt).toContain('Component Hierarchy');
      expect(ctx!.inputFiles).toHaveLength(0);
    });

    it('builds context for backend/api-reference with route data from CIG', async () => {
      const ctx = await builder.buildContext('backend/api-reference');

      expect(ctx).not.toBeNull();
      // Route list should be in user prompt
      expect(ctx!.userPrompt).toContain('GET /api/users');
      expect(ctx!.userPrompt).toContain('getUsers');
      expect(ctx!.userPrompt).toContain('express');
    });

    it('builds context for backend/database with schema data from CIG', async () => {
      const ctx = await builder.buildContext('backend/database');

      expect(ctx).not.toBeNull();
      expect(ctx!.userPrompt).toContain('prisma');
      expect(ctx!.userPrompt).toContain('PostgreSQL');
    });

    it('includes entry points in overview context', async () => {
      const ctx = await builder.buildContext('core/overview');

      // File reads will fail since cloneDir doesn't exist, but
      // the method should handle gracefully and still return context
      expect(ctx).not.toBeNull();
      expect(ctx!.systemPrompt).toContain('Overview');
    });
  });
});

describe('computeInputSha', () => {
  it('returns "empty" for no input files', () => {
    expect(computeInputSha([])).toBe('empty');
  });

  it('returns consistent SHA for same inputs', () => {
    const inputs = [
      { filePath: 'src/a.ts', sha: 'sha-a' },
      { filePath: 'src/b.ts', sha: 'sha-b' },
    ];

    const sha1 = computeInputSha(inputs);
    const sha2 = computeInputSha(inputs);
    expect(sha1).toBe(sha2);
  });

  it('returns same SHA regardless of input order', () => {
    const inputs1 = [
      { filePath: 'src/b.ts', sha: 'sha-b' },
      { filePath: 'src/a.ts', sha: 'sha-a' },
    ];
    const inputs2 = [
      { filePath: 'src/a.ts', sha: 'sha-a' },
      { filePath: 'src/b.ts', sha: 'sha-b' },
    ];

    expect(computeInputSha(inputs1)).toBe(computeInputSha(inputs2));
  });

  it('returns different SHA for different inputs', () => {
    const sha1 = computeInputSha([{ filePath: 'a.ts', sha: 'sha-1' }]);
    const sha2 = computeInputSha([{ filePath: 'a.ts', sha: 'sha-2' }]);
    expect(sha1).not.toBe(sha2);
  });

  it('returns a hex string of expected length', () => {
    const sha = computeInputSha([{ filePath: 'a.ts', sha: 'sha-1' }]);
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
  });
});

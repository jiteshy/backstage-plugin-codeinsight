# P2 — Documentation and Diagram Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `FileSummaryService` before doc/diagram generation so LLM-generated file summaries power two new doc modules (`core/architecture`, `core/features`), an enriched `core/overview`, and all LLM-assisted diagram prompts.

**Architecture:** `IndexingService` gains `precomputeSummaries()` which loads existing summaries from VectorStore, generates new ones via `FileSummaryService`, caches the chunks (so `indexRepo()` skips re-running), and returns a `Map<filePath, summary>`. `IngestionService` calls this before doc/diagram generation and passes the map through. `ContextBuilder` uses the map for two new context builders; LLM diagram modules read summaries from `cig.fileSummaries` injected by `DiagramGenerationService`.

**Tech Stack:** TypeScript, Jest, Knex/PostgreSQL (JSONB metadata), existing `@codeinsight/*` packages.

---

## File Map

| File | Change |
|---|---|
| `packages/core/types/src/interfaces.ts` | Add `getFileSummaries()` to `VectorStore` interface |
| `packages/adapters/vector-store/src/PgVectorStore.ts` | Implement `getFileSummaries()` |
| `packages/adapters/vector-store/src/__tests__/PgVectorStore.test.ts` | Test `getFileSummaries()` |
| `packages/core/indexing/src/IndexingService.ts` | Add `precomputeSummaries()`, cache field, update `indexRepo()` |
| `packages/core/indexing/src/__tests__/IndexingService.test.ts` | Tests for `precomputeSummaries()` + cache behavior; add `getFileSummaries` to mock |
| `packages/core/ingestion/src/IngestionService.ts` | Update `Indexer`/`DocGenerator`/`DiagramGenerator` interfaces; add pre-compute step |
| `packages/core/doc-generator/src/ContextBuilder.ts` | Add `fileSummaries` param, `getFilesByInDegree()`, enrich `buildOverviewVars()`, add `buildArchitectureVars()` + `buildFeaturesVars()` |
| `packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts` | Tests for new builders and `getFilesByInDegree()` |
| `packages/core/doc-generator/src/PromptRegistry.ts` | Add `core/architecture` + `core/features` system prompts and user prompt builders |
| `packages/core/doc-generator/src/ClassifierService.ts` | Add new modules to `CORE_MODULES` + `VALID_MODULES` |
| `packages/core/doc-generator/src/DocGenerationService.ts` | Thread `fileSummaries` through `generateDocs()` to `ContextBuilder` |
| `packages/core/diagram-gen/src/types.ts` | Add `fileSummaries?: Map<string, string>` to `CIGSnapshot` |
| `packages/core/diagram-gen/src/utils.ts` | Add `buildFileSummaryBlock()` shared util |
| `packages/core/diagram-gen/src/DiagramGenerationService.ts` | Update `generateDiagrams()` signature; inject `fileSummaries` into CIG snapshot |
| `packages/core/diagram-gen/src/diagrams/universal/HighLevelArchitectureModule.ts` | Prepend summaries block to LLM prompt |
| `packages/core/diagram-gen/src/diagrams/backend/ApiEntityMappingModule.ts` | Prepend summaries block to LLM prompt |
| `packages/core/diagram-gen/src/diagrams/universal/AuthFlowModule.ts` | Prepend summaries block to LLM prompt |
| `packages/core/diagram-gen/src/diagrams/universal/DeploymentInfraModule.ts` | Prepend summaries block to LLM prompt |

---

## Task 1: Add `getFileSummaries()` to VectorStore interface and PgVectorStore

**Files:**
- Modify: `packages/core/types/src/interfaces.ts`
- Modify: `packages/adapters/vector-store/src/PgVectorStore.ts`
- Modify: `packages/adapters/vector-store/src/__tests__/PgVectorStore.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/adapters/vector-store/src/__tests__/PgVectorStore.test.ts`. Find the describe block that tests `listChunks` (or the main describe block) and add:

```typescript
describe('getFileSummaries', () => {
  it('returns empty map when no file_summary chunks exist', async () => {
    const store = new PgVectorStore(db, { dimension: 3 });
    const result = await store.getFileSummaries('repo-summaries-empty');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns base file_summary chunks keyed by filePath', async () => {
    const store = new PgVectorStore(db, { dimension: 3 });
    await store.upsert([
      {
        chunkId: 'repo1:src/server.ts:file_summary',
        repoId: 'repo1',
        content: 'Express HTTP server entry point.',
        contentSha: 'sha-a',
        embedding: [0.1, 0.2, 0.3],
        layer: 'file_summary',
        metadata: { filePath: 'src/server.ts' },
      },
      {
        chunkId: 'repo1:src/auth.ts:file_summary',
        repoId: 'repo1',
        content: 'JWT authentication middleware.',
        contentSha: 'sha-b',
        embedding: [0.4, 0.5, 0.6],
        layer: 'file_summary',
        metadata: { filePath: 'src/auth.ts' },
      },
    ]);

    const result = await store.getFileSummaries('repo1');
    expect(result.get('src/server.ts')).toBe('Express HTTP server entry point.');
    expect(result.get('src/auth.ts')).toBe('JWT authentication middleware.');
    expect(result.size).toBe(2);
  });

  it('excludes sliding-window sub-chunks (subChunkIndex present)', async () => {
    const store = new PgVectorStore(db, { dimension: 3 });
    await store.upsert([
      {
        chunkId: 'repo2:src/big.css:file_summary:0',
        repoId: 'repo2',
        content: 'CSS chunk 0',
        contentSha: 'sha-c',
        embedding: [0.1, 0.2, 0.3],
        layer: 'file_summary',
        metadata: { filePath: 'src/big.css', subChunkIndex: 0 },
      },
      {
        chunkId: 'repo2:src/big.css:file_summary:1',
        repoId: 'repo2',
        content: 'CSS chunk 1',
        contentSha: 'sha-d',
        embedding: [0.4, 0.5, 0.6],
        layer: 'file_summary',
        metadata: { filePath: 'src/big.css', subChunkIndex: 1 },
      },
    ]);

    const result = await store.getFileSummaries('repo2');
    expect(result.size).toBe(0);
  });

  it('only returns summaries for the requested repoId', async () => {
    const store = new PgVectorStore(db, { dimension: 3 });
    await store.upsert([
      {
        chunkId: 'repo-a:src/app.ts:file_summary',
        repoId: 'repo-a',
        content: 'Summary for repo-a',
        contentSha: 'sha-e',
        embedding: [0.1, 0.2, 0.3],
        layer: 'file_summary',
        metadata: { filePath: 'src/app.ts' },
      },
    ]);

    const result = await store.getFileSummaries('repo-b');
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @codeinsight/vector-store test -- --testPathPattern=PgVectorStore 2>&1 | tail -20
```

Expected: FAIL — `getFileSummaries is not a function`

- [ ] **Step 3: Add `getFileSummaries` to VectorStore interface**

In `packages/core/types/src/interfaces.ts`, find the `VectorStore` interface and add after `deleteChunks`:

```typescript
/**
 * Return LLM-generated file summaries keyed by filePath.
 * Only base-level summaries (Tier 1/2/3a) are returned.
 * Sliding-window sub-chunks (subChunkIndex present in metadata) are excluded.
 */
getFileSummaries(repoId: string): Promise<Map<string, string>>;
```

- [ ] **Step 4: Implement `getFileSummaries` in PgVectorStore**

In `packages/adapters/vector-store/src/PgVectorStore.ts`, add the method to the class (place it after `deleteChunks`):

```typescript
async getFileSummaries(repoId: string): Promise<Map<string, string>> {
  const rows = await this.db('ci_vector_chunks')
    .where('repo_id', repoId)
    .where('layer', 'file_summary')
    .whereRaw("(metadata->>'subChunkIndex') IS NULL")
    .select('content', 'metadata');

  const result = new Map<string, string>();
  for (const row of rows) {
    const meta = typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : row.metadata;
    const filePath = meta?.filePath as string | undefined;
    if (filePath && row.content) {
      result.set(filePath, row.content as string);
    }
  }
  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @codeinsight/vector-store test -- --testPathPattern=PgVectorStore 2>&1 | tail -20
```

Expected: PASS for the four new tests plus all existing tests.

- [ ] **Step 6: Build types to propagate the interface change**

```bash
pnpm --filter @codeinsight/types build 2>&1
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/core/types/src/interfaces.ts \
        packages/adapters/vector-store/src/PgVectorStore.ts \
        packages/adapters/vector-store/src/__tests__/PgVectorStore.test.ts
git commit -m "feat(vector-store): add getFileSummaries() for pre-computed summary retrieval"
```

---

## Task 2: Add `precomputeSummaries()` to IndexingService

**Files:**
- Modify: `packages/core/indexing/src/IndexingService.ts`
- Modify: `packages/core/indexing/src/__tests__/IndexingService.test.ts`

- [ ] **Step 1: Update the VectorStore mock in the test file to include `getFileSummaries`**

In `packages/core/indexing/src/__tests__/IndexingService.test.ts`, find `makeVectorStore` and add `getFileSummaries` to the returned object:

```typescript
function makeVectorStore(
  existingChunks: Array<{ chunkId: string; contentSha: string }> = [],
  existingSummaries: Map<string, string> = new Map(),
): VectorStore & { upsertCalls: VectorChunk[][]; deleteCalls: string[][] } {
  const upsertCalls: VectorChunk[][] = [];
  const deleteCalls: string[][] = [];
  return {
    upsertCalls,
    deleteCalls,
    listChunks: jest.fn().mockResolvedValue(existingChunks),
    getFileSummaries: jest.fn().mockResolvedValue(existingSummaries),
    upsert: jest.fn().mockImplementation(async (chunks: VectorChunk[]) => {
      upsertCalls.push(chunks);
    }),
    deleteChunks: jest.fn().mockImplementation(async (_repoId: string, ids: string[]) => {
      deleteCalls.push(ids);
    }),
    search: jest.fn().mockResolvedValue([]),
    searchKeyword: jest.fn().mockResolvedValue([]),
  };
}
```

- [ ] **Step 2: Write failing tests for `precomputeSummaries`**

Add a new describe block at the bottom of `packages/core/indexing/src/__tests__/IndexingService.test.ts`:

```typescript
describe('IndexingService.precomputeSummaries', () => {
  it('returns empty map when no llmClient is configured', async () => {
    const storage = makeStorage();
    const embedder = makeEmbeddingClient();
    const vectorStore = makeVectorStore();
    const service = new IndexingService(embedder, vectorStore, storage);
    // no llmClient passed

    const result = await service.precomputeSummaries('repo1', '/tmp/repo1');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('merges existing summaries from VectorStore with new chunks on delta run', async () => {
    const existingSummaries = new Map([
      ['src/old.ts', 'Old file summary'],
      ['src/unchanged.ts', 'Unchanged file summary'],
    ]);
    const vectorStore = makeVectorStore([], existingSummaries);

    // Mock FileSummaryService to return one new chunk
    const storage = makeStorage({
      getRepoFiles: jest.fn().mockResolvedValue([
        { repoId: 'repo1', filePath: 'src/new.ts', currentSha: 'sha-new',
          fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
      ]),
      getCIGNodes: jest.fn().mockResolvedValue([]),
    });
    const embedder = makeEmbeddingClient();
    const llm: LLMClient = {
      complete: jest.fn().mockResolvedValue('Summary of new.ts'),
      stream: jest.fn(),
    };

    // We need to mock fs.readFile so FileSummaryService can "read" the file
    jest.spyOn(require('fs').promises, 'readFile')
      .mockResolvedValue('x'.repeat(600 * 3)); // medium file (tier 2)

    const service = new IndexingService(embedder, vectorStore, storage, undefined, undefined, llm);
    const result = await service.precomputeSummaries('repo1', '/tmp/repo1');

    // Should contain existing + new
    expect(result.get('src/old.ts')).toBe('Old file summary');
    expect(result.get('src/unchanged.ts')).toBe('Unchanged file summary');
    expect(result.get('src/new.ts')).toBe('Summary of new.ts');
    expect(result.size).toBe(3);

    jest.restoreAllMocks();
  });

  it('caches chunks so indexRepo skips FileSummaryService re-run', async () => {
    const vectorStore = makeVectorStore();
    const storage = makeStorage({
      getRepoFiles: jest.fn().mockResolvedValue([]),
      getCIGNodes: jest.fn().mockResolvedValue([]),
    });
    const embedder = makeEmbeddingClient();
    const llm: LLMClient = {
      complete: jest.fn().mockResolvedValue(null),
      stream: jest.fn(),
    };

    const service = new IndexingService(embedder, vectorStore, storage, undefined, undefined, llm);
    await service.precomputeSummaries('repo1', '/tmp/repo1');

    // indexRepo should use cached chunks (getRepoFiles called once total, not twice)
    await service.indexRepo('repo1', '/tmp/repo1');

    // getRepoFiles called once for precomputeSummaries; if called again for FileSummaryService
    // inside indexRepo it would be 2+ calls. With caching it stays at 1.
    const getRepoFilesMock = storage.getRepoFiles as jest.Mock;
    expect(getRepoFilesMock).toHaveBeenCalledTimes(1);
  });
});
```

Import `LLMClient` at the top of the test file:
```typescript
import type { EmbeddingClient, LLMClient, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @codeinsight/indexing test 2>&1 | tail -20
```

Expected: FAIL — `precomputeSummaries is not a function`

- [ ] **Step 4: Implement `precomputeSummaries` in IndexingService**

In `packages/core/indexing/src/IndexingService.ts`:

Add a cache field to the class:
```typescript
private _precomputedSummaryChunks: import('@codeinsight/chunking').Chunk[] | undefined;
```

Add the method after `indexRepo`:
```typescript
/**
 * Pre-compute file summaries before doc/diagram generation.
 *
 * Loads existing summaries from VectorStore (for delta runs), runs
 * FileSummaryService only for changed files, caches the resulting chunks
 * so indexRepo() can reuse them without re-running any LLM calls.
 *
 * Returns a Map<filePath, summaryText> combining existing + new summaries.
 */
async precomputeSummaries(
  repoId: string,
  cloneDir: string,
): Promise<Map<string, string>> {
  // Load existing summaries from the store (delta run: already indexed files)
  let existingSummaries: Map<string, string>;
  try {
    existingSummaries = await this.vectorStore.getFileSummaries(repoId);
  } catch {
    existingSummaries = new Map();
  }

  // If no LLM client, we can't generate new summaries — return existing
  if (!this.fileSummaryService) {
    this._precomputedSummaryChunks = [];
    return existingSummaries;
  }

  // Load existingShas for delta skip logic in FileSummaryService
  const existing = await this.vectorStore.listChunks(repoId);
  const existingMap = new Map(existing.map(c => [c.chunkId, c.contentSha]));

  // Generate new summaries for changed/new files only
  const { chunks: newChunks } = await this.fileSummaryService.summarize(
    repoId,
    cloneDir,
    existingMap,
  );

  // Cache for reuse in indexRepo()
  this._precomputedSummaryChunks = newChunks;

  // Build merged map: existing first, then overlay new results
  const merged = new Map(existingSummaries);
  for (const chunk of newChunks) {
    const filePath = chunk.metadata?.['filePath'] as string | undefined;
    if (filePath && chunk.content) {
      merged.set(filePath, chunk.content);
    }
  }
  return merged;
}
```

- [ ] **Step 5: Update `indexRepo` to use cached chunks when available**

In `indexRepo`, find the section that calls `fileSummaryService.summarize` (inside `Promise.all`):

```typescript
// Before (find this block):
const [{ chunks: regularChunks }, summaryResult] = await Promise.all([
  this.chunkingService.chunkRepo(repoId, cloneDir),
  this.fileSummaryService
    ? this.fileSummaryService.summarize(repoId, cloneDir, existingMap)
    : Promise.resolve({ chunks: [], stats: null }),
]);
```

Replace with:
```typescript
// Use pre-computed summary chunks if precomputeSummaries() was called first.
// This avoids running FileSummaryService (and its LLM calls) a second time.
const precomputed = this._precomputedSummaryChunks;
this._precomputedSummaryChunks = undefined; // clear cache after use

const [{ chunks: regularChunks }, summaryResult] = await Promise.all([
  this.chunkingService.chunkRepo(repoId, cloneDir),
  precomputed !== undefined
    ? Promise.resolve({ chunks: precomputed, stats: null })
    : this.fileSummaryService
      ? this.fileSummaryService.summarize(repoId, cloneDir, existingMap)
      : Promise.resolve({ chunks: [], stats: null }),
]);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @codeinsight/indexing test 2>&1 | tail -30
```

Expected: all tests pass including the three new ones.

- [ ] **Step 7: Build indexing**

```bash
pnpm --filter @codeinsight/indexing build 2>&1
```

Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add packages/core/indexing/src/IndexingService.ts \
        packages/core/indexing/src/__tests__/IndexingService.test.ts
git commit -m "feat(indexing): add precomputeSummaries() with VectorStore merge and chunk caching"
```

---

## Task 3: Wire pre-compute step into IngestionService

**Files:**
- Modify: `packages/core/ingestion/src/IngestionService.ts`

No new tests needed — `IngestionService` has integration-level tests; the new step is guarded and non-fatal.

- [ ] **Step 1: Update the `Indexer` interface in IngestionService**

In `packages/core/ingestion/src/IngestionService.ts`, find the `Indexer` interface:

```typescript
// BEFORE:
interface Indexer {
  indexRepo(
    repoId: string,
    cloneDir: string,
  ): Promise<{ chunksIndexed: number; chunksSkipped: number; chunksDeleted: number }>;
}
```

Replace with:
```typescript
interface Indexer {
  precomputeSummaries(repoId: string, cloneDir: string): Promise<Map<string, string>>;
  indexRepo(
    repoId: string,
    cloneDir: string,
  ): Promise<{ chunksIndexed: number; chunksSkipped: number; chunksDeleted: number }>;
}
```

- [ ] **Step 2: Update the `DocGenerator` interface**

Find:
```typescript
interface DocGenerator {
  generateDocs(
    repoId: string,
    cloneDir: string,
  ): Promise<{ totalTokensUsed: number; detectedSignals: Record<string, string> }>;
}
```

Replace with:
```typescript
interface DocGenerator {
  generateDocs(
    repoId: string,
    cloneDir: string,
    fileSummaries?: Map<string, string>,
  ): Promise<{ totalTokensUsed: number; detectedSignals: Record<string, string> }>;
}
```

- [ ] **Step 3: Update the `DiagramGenerator` interface**

Find:
```typescript
interface DiagramGenerator {
  generateDiagrams(
    repoId: string,
    detectedSignals?: Record<string, string>,
  ): Promise<{ totalTokensUsed: number }>;
}
```

Replace with:
```typescript
interface DiagramGenerator {
  generateDiagrams(
    repoId: string,
    detectedSignals?: Record<string, string>,
    fileSummaries?: Map<string, string>,
  ): Promise<{ totalTokensUsed: number }>;
}
```

- [ ] **Step 4: Add the pre-compute step and thread `fileSummaries` through the pipeline**

In `runPipeline`, find this comment and the line after it:
```typescript
// Run doc generation (if an LLM client is configured).
// Must run before the finally block that deletes cloneDir.
let tokensConsumed = 0;
```

Insert before it:
```typescript
// Pre-compute file summaries so doc and diagram generators can use them.
// Non-fatal — if this fails generators receive an empty map and degrade gracefully.
let fileSummaries: Map<string, string> = new Map();
if (this.indexer) {
  try {
    this.logger.info('Pre-computing file summaries', { repoId, jobId });
    fileSummaries = await this.indexer.precomputeSummaries(repoId, cloneDir);
    this.logger.info('File summaries ready', { repoId, jobId, count: fileSummaries.size });
  } catch (err) {
    this.logger.warn('File summary pre-computation failed (non-fatal)', {
      repoId,
      jobId,
      error: String(err),
    });
  }
}
```

- [ ] **Step 5: Pass `fileSummaries` to the doc generator call**

Find:
```typescript
const docResult = await this.docGenerator.generateDocs(repoId, cloneDir);
```

Replace with:
```typescript
const docResult = await this.docGenerator.generateDocs(repoId, cloneDir, fileSummaries);
```

- [ ] **Step 6: Pass `fileSummaries` to the diagram generator call**

Find:
```typescript
const diagramResult = await this.diagramGenerator.generateDiagrams(repoId, detectedSignals);
```

Replace with:
```typescript
const diagramResult = await this.diagramGenerator.generateDiagrams(repoId, detectedSignals, fileSummaries);
```

- [ ] **Step 7: Build ingestion to confirm no type errors**

```bash
pnpm --filter @codeinsight/ingestion build 2>&1
```

Expected: clean build (type errors will surface from downstream packages not yet updated, but IngestionService itself compiles via duck-typing).

- [ ] **Step 8: Commit**

```bash
git add packages/core/ingestion/src/IngestionService.ts
git commit -m "feat(ingestion): add file summaries pre-compute step before doc/diagram generation"
```

---

## Task 4: Enrich ContextBuilder — fileSummaries + getFilesByInDegree + overview

**Files:**
- Modify: `packages/core/doc-generator/src/ContextBuilder.ts`
- Modify: `packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts`

- [ ] **Step 1: Write failing tests for `getFilesByInDegree` and overview enrichment**

In `packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts`, find the existing imports and fixture data. Add a new describe block:

```typescript
describe('ContextBuilder with fileSummaries', () => {
  const NODES: CIGNode[] = [
    { nodeId: 'r:src/server.ts:<module>:variable', repoId: 'r', filePath: 'src/server.ts',
      symbolName: '<module>', symbolType: 'variable', startLine: 1, endLine: 50,
      exported: false, extractedSha: 'sha1', metadata: null },
    { nodeId: 'r:src/auth.ts:<module>:variable', repoId: 'r', filePath: 'src/auth.ts',
      symbolName: '<module>', symbolType: 'variable', startLine: 1, endLine: 30,
      exported: false, extractedSha: 'sha2', metadata: null },
    { nodeId: 'r:src/db.ts:<module>:variable', repoId: 'r', filePath: 'src/db.ts',
      symbolName: '<module>', symbolType: 'variable', startLine: 1, endLine: 20,
      exported: false, extractedSha: 'sha3', metadata: null },
  ];

  // src/auth.ts imported by 2 files, src/db.ts imported by 2 files, src/server.ts by 0
  const EDGES: CIGEdge[] = [
    { edgeId: 'e1', repoId: 'r', fromNodeId: 'r:src/server.ts:<module>:variable',
      toNodeId: 'r:src/auth.ts:<module>:variable', edgeType: 'imports' },
    { edgeId: 'e2', repoId: 'r', fromNodeId: 'r:src/server.ts:<module>:variable',
      toNodeId: 'r:src/db.ts:<module>:variable', edgeType: 'imports' },
    { edgeId: 'e3', repoId: 'r', fromNodeId: 'r:src/auth.ts:<module>:variable',
      toNodeId: 'r:src/db.ts:<module>:variable', edgeType: 'imports' },
  ];

  const REPO_FILES: RepoFile[] = [
    { repoId: 'r', filePath: 'src/server.ts', currentSha: 'sha1',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
    { repoId: 'r', filePath: 'src/auth.ts', currentSha: 'sha2',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
    { repoId: 'r', filePath: 'src/db.ts', currentSha: 'sha3',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  ];

  const CLASSIFIER: ClassifierResult = {
    repoType: ['backend'],
    language: 'typescript',
    frameworks: ['express'],
    detectedSignals: {},
    promptModules: ['core/overview'],
  };

  const FILE_SUMMARIES = new Map([
    ['src/server.ts', 'Express HTTP server entry point.'],
    ['src/auth.ts', 'JWT authentication middleware.'],
    ['src/db.ts', 'PostgreSQL connection pool and query helpers.'],
  ]);

  it('buildOverviewVars includes keySummaries when fileSummaries provided', async () => {
    const builder = new ContextBuilder(
      NODES, EDGES, REPO_FILES, CLASSIFIER, '/tmp/clone', FILE_SUMMARIES,
    );
    const ctx = await builder.buildContext('core/overview');
    // keySummaries variable should appear in the user prompt
    expect(ctx?.userPrompt).toContain('src/auth.ts');
    expect(ctx?.userPrompt).toContain('JWT authentication middleware');
  });

  it('buildOverviewVars omits keySummaries section when map is empty', async () => {
    const builder = new ContextBuilder(
      NODES, EDGES, REPO_FILES, CLASSIFIER, '/tmp/clone', new Map(),
    );
    const ctx = await builder.buildContext('core/overview');
    // Should not crash and should still return a context
    expect(ctx).not.toBeNull();
  });
});
```

Make sure `CIGEdge`, `CIGNode`, `RepoFile` are all imported at the top of the test file. Check existing imports and add any missing ones.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @codeinsight/doc-generator test -- --testPathPattern=ContextBuilder 2>&1 | tail -20
```

Expected: FAIL — ContextBuilder constructor does not accept 6th argument yet.

- [ ] **Step 3: Add `fileSummaries` parameter and `getFilesByInDegree` helper to ContextBuilder**

In `packages/core/doc-generator/src/ContextBuilder.ts`:

Update the constructor signature:
```typescript
constructor(
  private readonly nodes: CIGNode[],
  private readonly edges: CIGEdge[],
  private readonly repoFiles: RepoFile[],
  private readonly classifierResult: ClassifierResult,
  private readonly cloneDir: string,
  private readonly fileSummaries: Map<string, string> = new Map(),
) {}
```

Add the private helper method (place it just before `findFile`):
```typescript
/**
 * Rank source files by how many distinct other files import them (in-degree).
 * Returns file paths sorted descending by in-degree, capped at topN.
 * Config/test/schema files are excluded.
 */
private getFilesByInDegree(topN: number): string[] {
  const sourceFilePaths = new Set(
    this.repoFiles
      .filter(f => f.fileType === 'source')
      .map(f => f.filePath),
  );

  // Build nodeId → filePath map
  const nodeToFile = new Map<string, string>();
  for (const n of this.nodes) {
    nodeToFile.set(n.nodeId, n.filePath);
  }

  // Count distinct importer files per destination file
  const inDegree = new Map<string, Set<string>>();
  for (const edge of this.edges) {
    if (edge.edgeType !== 'imports') continue;
    const toFile = nodeToFile.get(edge.toNodeId);
    const fromFile = nodeToFile.get(edge.fromNodeId);
    if (!toFile || !fromFile || toFile === fromFile) continue;
    if (!sourceFilePaths.has(toFile)) continue;
    const importers = inDegree.get(toFile) ?? new Set<string>();
    importers.add(fromFile);
    inDegree.set(toFile, importers);
  }

  return [...inDegree.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, topN)
    .map(([fp]) => fp);
}
```

- [ ] **Step 4: Enrich `buildOverviewVars` with key file summaries**

In `buildOverviewVars`, after the `entryPointFiles` block (just before `return { variables, inputFiles }`), add:

```typescript
// Enrich with summaries of the most-imported files to give the LLM
// real semantic context about what the codebase actually does.
if (this.fileSummaries.size > 0) {
  const topFiles = this.getFilesByInDegree(5);
  const summaryParts: string[] = [];
  for (const fp of topFiles) {
    const summary = this.fileSummaries.get(fp);
    if (summary) {
      summaryParts.push(`### ${fp}\n${summary}`);
    }
  }
  if (summaryParts.length > 0) {
    variables['keySummaries'] = summaryParts.join('\n\n');
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @codeinsight/doc-generator test -- --testPathPattern=ContextBuilder 2>&1 | tail -20
```

Expected: new tests pass; all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/doc-generator/src/ContextBuilder.ts \
        packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts
git commit -m "feat(doc-generator): add fileSummaries to ContextBuilder, getFilesByInDegree, enrich overview"
```

---

## Task 5: Add `buildArchitectureVars` and `buildFeaturesVars` to ContextBuilder

**Files:**
- Modify: `packages/core/doc-generator/src/ContextBuilder.ts`
- Modify: `packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `ContextBuilder with fileSummaries` describe block in the test file:

```typescript
it('buildArchitectureVars returns null when fileSummaries is empty', async () => {
  const builder = new ContextBuilder(
    NODES, EDGES, REPO_FILES, CLASSIFIER, '/tmp/clone', new Map(),
  );
  const ctx = await builder.buildContext('core/architecture');
  expect(ctx).toBeNull();
});

it('buildArchitectureVars includes file summaries and import graph', async () => {
  const builder = new ContextBuilder(
    NODES, EDGES, REPO_FILES, CLASSIFIER, '/tmp/clone', FILE_SUMMARIES,
  );
  const ctx = await builder.buildContext('core/architecture');
  expect(ctx).not.toBeNull();
  expect(ctx?.userPrompt).toContain('JWT authentication middleware');
  expect(ctx?.userPrompt).toContain('PostgreSQL connection pool');
  // Import graph should show inter-file imports
  expect(ctx?.userPrompt).toContain('→');
});

it('buildFeaturesVars returns null when no service/handler files exist', async () => {
  const plainFiles: RepoFile[] = [
    { repoId: 'r', filePath: 'src/index.ts', currentSha: 'sha1',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  ];
  const builder = new ContextBuilder(
    [], [], plainFiles, CLASSIFIER, '/tmp/clone', FILE_SUMMARIES,
  );
  const ctx = await builder.buildContext('core/features');
  expect(ctx).toBeNull();
});

it('buildFeaturesVars includes summaries of service/handler files', async () => {
  const serviceFiles: RepoFile[] = [
    { repoId: 'r', filePath: 'src/services/auth.service.ts', currentSha: 'sha1',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
    { repoId: 'r', filePath: 'src/handlers/user.handler.ts', currentSha: 'sha2',
      fileType: 'source', language: 'typescript', parseStatus: 'parsed' },
  ];
  const summaries = new Map([
    ['src/services/auth.service.ts', 'Handles user authentication and JWT issuance.'],
    ['src/handlers/user.handler.ts', 'HTTP handlers for user CRUD endpoints.'],
  ]);
  const builder = new ContextBuilder(
    [], [], serviceFiles, CLASSIFIER, '/tmp/clone', summaries,
  );
  const ctx = await builder.buildContext('core/features');
  expect(ctx).not.toBeNull();
  expect(ctx?.userPrompt).toContain('Handles user authentication');
  expect(ctx?.userPrompt).toContain('HTTP handlers for user CRUD');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @codeinsight/doc-generator test -- --testPathPattern=ContextBuilder 2>&1 | tail -20
```

Expected: FAIL — `buildVars` switch has no case for `core/architecture` or `core/features`.

- [ ] **Step 3: Add `buildArchitectureVars` to ContextBuilder**

Add after `buildDeploymentVars`:

```typescript
// ----- core/architecture -----
private async buildArchitectureVars() {
  // Requires file summaries — skip if none available
  if (this.fileSummaries.size === 0) return null;

  const variables: Record<string, string> = {};

  // Top 20 most-imported source files
  const topFiles = this.getFilesByInDegree(20);
  if (topFiles.length === 0) return null;

  // Build summaries block
  const summaryParts: string[] = [];
  for (const fp of topFiles) {
    const summary = this.fileSummaries.get(fp);
    if (summary) {
      summaryParts.push(`### ${fp}\n${summary}`);
    }
  }
  if (summaryParts.length === 0) return null;
  variables['fileSummariesBlock'] = summaryParts.join('\n\n');

  // Build inter-file import graph for the top files
  const topFileSet = new Set(topFiles);
  const nodeToFile = new Map<string, string>();
  for (const n of this.nodes) {
    nodeToFile.set(n.nodeId, n.filePath);
  }

  const graphLines = new Set<string>();
  for (const edge of this.edges) {
    if (edge.edgeType !== 'imports') continue;
    const fromFile = nodeToFile.get(edge.fromNodeId);
    const toFile = nodeToFile.get(edge.toNodeId);
    if (fromFile && toFile && fromFile !== toFile &&
        topFileSet.has(fromFile) && topFileSet.has(toFile)) {
      graphLines.add(`${fromFile} → ${toFile}`);
      if (graphLines.size >= 100) break;
    }
  }
  if (graphLines.size > 0) {
    variables['importGraphBlock'] = [...graphLines].join('\n');
  }

  return { variables, inputFiles: [] };
}
```

- [ ] **Step 4: Add `buildFeaturesVars` to ContextBuilder**

Add after `buildArchitectureVars`:

```typescript
// ----- core/features -----
private async buildFeaturesVars() {
  const FEATURE_PATTERNS = [
    'service', 'handler', 'controller', 'provider',
    'manager', 'repository', 'use-case', 'usecase',
  ];

  const inputFiles: Array<{ filePath: string; sha: string }> = [];

  // Find matching source files, ranked by in-degree
  const inDegreeRanked = this.getFilesByInDegree(200); // wide net, filter by pattern
  const byPattern = this.repoFiles
    .filter(f =>
      f.fileType === 'source' &&
      FEATURE_PATTERNS.some(p => f.filePath.toLowerCase().includes(p)),
    );

  // Sort by in-degree (most-imported first), fall back to alpha
  const inDegreeIndex = new Map(inDegreeRanked.map((fp, i) => [fp, i]));
  byPattern.sort((a, b) => {
    const ai = inDegreeIndex.get(a.filePath) ?? 9999;
    const bi = inDegreeIndex.get(b.filePath) ?? 9999;
    return ai - bi;
  });

  const topFeatureFiles = byPattern.slice(0, 25);
  if (topFeatureFiles.length === 0) return null;

  const summaryParts: string[] = [];
  for (const rf of topFeatureFiles) {
    const summary = this.fileSummaries.get(rf.filePath);
    if (summary) {
      summaryParts.push(`### ${rf.filePath}\n${summary}`);
      inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
    } else {
      // Fallback: read a truncated excerpt from disk
      const content = await this.readFileSafe(rf.filePath);
      if (content) {
        summaryParts.push(`### ${rf.filePath}\n${content.slice(0, 500)}`);
        inputFiles.push({ filePath: rf.filePath, sha: rf.currentSha });
      }
    }
  }

  if (summaryParts.length === 0) return null;

  return {
    variables: { featureSummariesBlock: summaryParts.join('\n\n') },
    inputFiles,
  };
}
```

- [ ] **Step 5: Add the two new cases to the `buildVars` switch**

In the `buildVars` method, add before the `default` case:

```typescript
case 'core/architecture':
  return this.buildArchitectureVars();
case 'core/features':
  return this.buildFeaturesVars();
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm --filter @codeinsight/doc-generator test -- --testPathPattern=ContextBuilder 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/doc-generator/src/ContextBuilder.ts \
        packages/core/doc-generator/src/__tests__/ContextBuilder.test.ts
git commit -m "feat(doc-generator): add buildArchitectureVars and buildFeaturesVars to ContextBuilder"
```

---

## Task 6: Add new modules to PromptRegistry and ClassifierService

**Files:**
- Modify: `packages/core/doc-generator/src/PromptRegistry.ts`
- Modify: `packages/core/doc-generator/src/ClassifierService.ts`

- [ ] **Step 1: Add `core/architecture` and `core/features` system prompts to PromptRegistry**

In `packages/core/doc-generator/src/PromptRegistry.ts`, add to the `SYSTEM_PROMPTS` object after `'core/deployment'`:

```typescript
'core/architecture': `You are a technical documentation writer. Generate an "Architecture" section for a software project based on LLM-generated summaries of its most-imported files and their import relationships.

Output ONLY a markdown section starting with "## Architecture". Do not include any other headers or preamble.

The section should cover:
1. Major layers or subsystems and what each is responsible for (use actual file/module names as evidence)
2. How data or control flows between the major layers
3. Key abstractions — the most-imported files and why other code depends on them
4. Any notable architectural patterns (e.g. layered, event-driven, hexagonal, MVC) if clearly evidenced

Rules:
- Be specific — name the actual files and what they do, not generic layer descriptions
- Only describe what is evidenced in the provided summaries and import graph
- Do not speculate about files not shown
- Keep it under 600 words
- Use sub-headings for each major subsystem if there are 3 or more`,

'core/features': `You are a technical documentation writer. Generate a "Features" section for a software project based on LLM-generated summaries of its service, handler, controller, and repository files.

Output ONLY a markdown section starting with "## Features". Do not include any other headers or preamble.

The section should cover:
1. What the system does from a user or consumer perspective (1-2 sentence lead)
2. The major features or capabilities, each described in 2-4 sentences
3. For each feature: what it does, how it is implemented (which services/handlers), and what domain concept it represents
4. How features compose — if features depend on each other, note the dependencies

Rules:
- Derive features from what the service/handler files actually do — use their summaries as evidence
- Group related services/handlers into logical features (not one bullet per file)
- Be specific — use the actual service names, not placeholder descriptions like "handles user data"
- Keep it under 500 words
- If the repo clearly has one primary feature (single-purpose tool), describe it in depth rather than forcing multiple sections`,
```

- [ ] **Step 2: Update `core/overview` system prompt to use `keySummaries`**

Find the `'core/overview'` entry in `SYSTEM_PROMPTS` and replace the rules section to add:

```typescript
'core/overview': `You are a technical documentation writer. Generate a clear, concise "Overview" section for a software project based on its README, package manifest, entry point files, and (when available) LLM-generated summaries of key source files.

Output ONLY a markdown section starting with "## Overview". Do not include any other headers or preamble.

The section should cover:
1. What the project does (1-2 sentences, lead with the value)
2. Who it is for / primary use case
3. Key features (bullet list, 3-6 items)
4. Tech stack summary (1 sentence naming key technologies)

Rules:
- Be specific — use names from the actual code, not generic descriptions
- If Key File Summaries are provided, use them to describe what the project actually does at a code level, not just what the README says
- Do not mention things not evidenced in the provided files
- Keep it under 400 words
- Use active voice
- Do not repeat the project name in every sentence`,
```

- [ ] **Step 3: Add user prompt builders for the two new modules**

Add these functions before the `USER_PROMPT_BUILDERS` registry object:

```typescript
function buildArchitecturePrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['fileSummariesBlock']) {
    parts.push(`## Key File Summaries (most-imported source files)\n${vars['fileSummariesBlock']}`);
  }

  if (vars['importGraphBlock']) {
    parts.push(`## Import Graph (between key files)\n\`\`\`\n${vars['importGraphBlock']}\n\`\`\``);
  }

  parts.push('Generate the Architecture section for this repository.');
  return parts.join('\n\n');
}

function buildFeaturesPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['featureSummariesBlock']) {
    parts.push(`## Service and Handler Summaries\n${vars['featureSummariesBlock']}`);
  }

  parts.push('Generate the Features section for this repository.');
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Update the `buildOverviewPrompt` function to include `keySummaries`**

In `buildOverviewPrompt`, add before the final `parts.push('Generate the Overview section...')`:

```typescript
if (vars['keySummaries']) {
  parts.push(`## Key File Summaries\n${vars['keySummaries']}`);
}
```

- [ ] **Step 5: Register the new builders in `USER_PROMPT_BUILDERS`**

In the `USER_PROMPT_BUILDERS` object, add:
```typescript
'core/architecture': buildArchitecturePrompt,
'core/features': buildFeaturesPrompt,
```

- [ ] **Step 6: Add new modules to ClassifierService**

In `packages/core/doc-generator/src/ClassifierService.ts`, update `CORE_MODULES`:

```typescript
const CORE_MODULES: string[] = [
  'core/overview',
  'core/architecture',
  'core/features',
  'core/project-structure',
  'core/getting-started',
  'core/configuration',
  'core/dependencies',
  'core/testing',
  'core/deployment',
];
```

And add to `VALID_MODULES` (they're already in CORE_MODULES which is spread in, so no separate addition needed — verify the spread covers it).

- [ ] **Step 7: Run all doc-generator tests**

```bash
pnpm --filter @codeinsight/doc-generator test 2>&1 | tail -30
```

Expected: all existing tests pass. (The new modules appear in `CORE_MODULES` so `ClassifierService` tests that check `core/overview` is present will still pass; tests checking exact `promptModules` length may need updating if they hardcode the count — fix any that fail.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/doc-generator/src/PromptRegistry.ts \
        packages/core/doc-generator/src/ClassifierService.ts
git commit -m "feat(doc-generator): add core/architecture and core/features modules"
```

---

## Task 7: Thread `fileSummaries` through DocGenerationService

**Files:**
- Modify: `packages/core/doc-generator/src/DocGenerationService.ts`

- [ ] **Step 1: Update `generateDocs` signature and ContextBuilder construction**

In `packages/core/doc-generator/src/DocGenerationService.ts`:

Find `generateDocs`:
```typescript
async generateDocs(
  repoId: string,
  cloneDir: string,
): Promise<DocGenerationResult> {
```

Replace with:
```typescript
async generateDocs(
  repoId: string,
  cloneDir: string,
  fileSummaries?: Map<string, string>,
): Promise<DocGenerationResult> {
```

Find the `ContextBuilder` instantiation:
```typescript
const contextBuilder = new ContextBuilder(
  nodes,
  edges,
  repoFiles,
  classifierResult,
  cloneDir,
);
```

Replace with:
```typescript
const contextBuilder = new ContextBuilder(
  nodes,
  edges,
  repoFiles,
  classifierResult,
  cloneDir,
  fileSummaries ?? new Map(),
);
```

Also update `generateDocsWithClassification` (find it around line 333) the same way — its signature and ContextBuilder call:
```typescript
async generateDocsWithClassification(
  repoId: string,
  cloneDir: string,
  classifierResult: ClassifierResult,
  fileSummaries?: Map<string, string>,
): Promise<DocGenerationResult> {
```

And its ContextBuilder call:
```typescript
const contextBuilder = new ContextBuilder(
  nodes, edges, repoFiles, classifierResult, cloneDir, fileSummaries ?? new Map(),
);
```

- [ ] **Step 2: Build and test**

```bash
pnpm --filter @codeinsight/doc-generator build 2>&1 && pnpm --filter @codeinsight/doc-generator test 2>&1 | tail -20
```

Expected: clean build, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/doc-generator/src/DocGenerationService.ts
git commit -m "feat(doc-generator): thread fileSummaries through generateDocs to ContextBuilder"
```

---

## Task 8: Add `fileSummaries` to CIGSnapshot and DiagramGenerationService

**Files:**
- Modify: `packages/core/diagram-gen/src/types.ts`
- Modify: `packages/core/diagram-gen/src/utils.ts`
- Modify: `packages/core/diagram-gen/src/DiagramGenerationService.ts`

- [ ] **Step 1: Add `fileSummaries` to `CIGSnapshot`**

In `packages/core/diagram-gen/src/types.ts`, update `CIGSnapshot`:

```typescript
export interface CIGSnapshot {
  nodes: CIGNode[];
  edges: CIGEdge[];
  /** LLM-generated summaries keyed by filePath. Present when IndexingService ran precomputeSummaries first. */
  fileSummaries?: Map<string, string>;
}
```

- [ ] **Step 2: Add `buildFileSummaryBlock` to utils**

In `packages/core/diagram-gen/src/utils.ts`, add after `extractMermaid`:

```typescript
/**
 * Build a compact "Key File Summaries" text block for LLM diagram prompts.
 *
 * Selects the top N source files by import in-degree from the CIG and looks
 * up their summaries. Returns null if no summaries are available.
 *
 * @param cig        CIG snapshot (must have fileSummaries populated)
 * @param maxFiles   Max number of file summaries to include (default: 20)
 * @param maxChars   Hard cap on total block length in chars (default: 4000)
 */
export function buildFileSummaryBlock(
  cig: CIGSnapshot,
  maxFiles = 20,
  maxChars = 4000,
): string | null {
  if (!cig.fileSummaries || cig.fileSummaries.size === 0) return null;

  // Build file-level in-degree from import edges
  const nodeToFile = new Map<string, string>();
  for (const n of cig.nodes) {
    nodeToFile.set(n.nodeId, n.filePath);
  }

  const inDegree = new Map<string, number>();
  for (const edge of cig.edges) {
    if (edge.edgeType !== 'imports') continue;
    const toFile = nodeToFile.get(edge.toNodeId);
    if (!toFile) continue;
    inDegree.set(toFile, (inDegree.get(toFile) ?? 0) + 1);
  }

  // Sort by in-degree, take top N that have summaries
  const ranked = [...inDegree.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fp]) => fp)
    .filter(fp => cig.fileSummaries!.has(fp))
    .slice(0, maxFiles);

  if (ranked.length === 0) return null;

  const lines: string[] = [];
  let totalChars = 0;
  for (const fp of ranked) {
    const summary = cig.fileSummaries!.get(fp)!;
    const line = `${fp}: ${summary}`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length + 1;
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
```

Also update the `CIGSnapshot` import at the top of utils.ts:
```typescript
import type { CIGSnapshot } from './types';
```

- [ ] **Step 3: Update `DiagramGenerationService.generateDiagrams` signature**

In `packages/core/diagram-gen/src/DiagramGenerationService.ts`:

Update the exported `DiagramGenerator` interface:
```typescript
export interface DiagramGenerator {
  generateDiagrams(
    repoId: string,
    detectedSignals?: Record<string, string>,
    fileSummaries?: Map<string, string>,
  ): Promise<{ totalTokensUsed: number }>;
}
```

Update the method signature:
```typescript
async generateDiagrams(
  repoId: string,
  externalSignals: Record<string, string> = {},
  fileSummaries?: Map<string, string>,
): Promise<DiagramGenerationResult> {
  const cig = await this.loadCIG(repoId);
```

After `const cig = await this.loadCIG(repoId);`, add:
```typescript
// Inject fileSummaries into the CIG snapshot so LLM modules can access them
if (fileSummaries && fileSummaries.size > 0) {
  cig.fileSummaries = fileSummaries;
}
```

- [ ] **Step 4: Build diagram-gen and run tests**

```bash
pnpm --filter @codeinsight/diagram-gen build 2>&1 && pnpm --filter @codeinsight/diagram-gen test 2>&1 | tail -20
```

Expected: clean build, all existing tests pass. (`fileSummaries` is optional so existing tests that don't pass it continue to work.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/diagram-gen/src/types.ts \
        packages/core/diagram-gen/src/utils.ts \
        packages/core/diagram-gen/src/DiagramGenerationService.ts
git commit -m "feat(diagram-gen): add fileSummaries to CIGSnapshot, buildFileSummaryBlock util, thread through DiagramGenerationService"
```

---

## Task 9: Inject summaries into LLM diagram module prompts

**Files:**
- Modify: `packages/core/diagram-gen/src/diagrams/universal/HighLevelArchitectureModule.ts`
- Modify: `packages/core/diagram-gen/src/diagrams/backend/ApiEntityMappingModule.ts`
- Modify: `packages/core/diagram-gen/src/diagrams/universal/AuthFlowModule.ts`
- Modify: `packages/core/diagram-gen/src/diagrams/universal/DeploymentInfraModule.ts`

All four modules follow the same pattern: call `buildFileSummaryBlock(cig)` and prepend the result to the user prompt.

- [ ] **Step 1: Update HighLevelArchitectureModule**

In `packages/core/diagram-gen/src/diagrams/universal/HighLevelArchitectureModule.ts`:

Add import at top:
```typescript
import { buildFileSummaryBlock, extractMermaid } from '../../utils';
```

(Replace the existing `import { extractMermaid } from '../../utils';` line.)

In the `generate` method, find the `userPrompt` construction and prepend the summaries block:

```typescript
// Build summaries block from pre-computed file summaries if available
const summaryBlock = buildFileSummaryBlock(cig);

const userPrompt = `Generate a Mermaid flowchart TD showing the high-level architecture of this codebase.
${summaryBlock ? `\n## Key File Summaries (most-imported source files)\n${summaryBlock}\n\nUse these summaries to understand what each layer does and how they interact.\n` : ''}
Use subgraphs for each detected architectural layer. Show data flow from client/API through layers to data stores.
Show external integrations as leaf nodes.

Detected architectural layers:
${layerLines.length > 0 ? layerLines.join('\n') : '  (no standard layers detected — use file structure)'}

${depLines}
${routeLine}

Total source files: ${sourceFiles.size}

Guidelines:
- Create a subgraph for each layer with 1-3 representative nodes
- Show arrows for the primary data flow direction
- Add external dependencies as terminal nodes
- Do NOT include file paths — use conceptual labels

Output only the Mermaid flowchart TD block (starting with "flowchart TD").`;
```

- [ ] **Step 2: Update ApiEntityMappingModule**

In `packages/core/diagram-gen/src/diagrams/backend/ApiEntityMappingModule.ts`:

Add to import:
```typescript
import { buildFileSummaryBlock, extractMermaid } from '../../utils';
```

In `generate`, find where `userPrompt` is built. Read the current prompt and prepend the summaries block immediately after the opening line. The pattern is: find `const userPrompt = \`` and add after the first line of the prompt:

```typescript
const summaryBlock = buildFileSummaryBlock(cig);
```

Then in the prompt string, after the opening instruction line, add:
```
${summaryBlock ? `\n## Key File Summaries\n${summaryBlock}\n` : ''}
```

Read `ApiEntityMappingModule.ts` first to see the exact prompt structure, then apply the same prepend pattern as HighLevelArchitectureModule.

- [ ] **Step 3: Read ApiEntityMappingModule to apply the change correctly**

```bash
cat packages/core/diagram-gen/src/diagrams/backend/ApiEntityMappingModule.ts
```

Then apply the same `buildFileSummaryBlock` + prepend pattern to its user prompt.

- [ ] **Step 4: Update AuthFlowModule**

In `packages/core/diagram-gen/src/diagrams/universal/AuthFlowModule.ts`:

Add to import:
```typescript
import { buildFileSummaryBlock, extractMermaid } from '../../utils';
```

Add before the `userPrompt`:
```typescript
const summaryBlock = buildFileSummaryBlock(cig);
```

Prepend the summaries section to the user prompt string:
```typescript
${summaryBlock ? `\n## Key File Summaries (auth-related files)\n${summaryBlock}\n` : ''}
```

(Place immediately after the opening "Generate a Mermaid..." instruction line.)

- [ ] **Step 5: Update DeploymentInfraModule**

In `packages/core/diagram-gen/src/diagrams/universal/DeploymentInfraModule.ts`:

Same pattern: add `buildFileSummaryBlock` import, compute `summaryBlock`, prepend to user prompt.

- [ ] **Step 6: Build and run all diagram tests**

```bash
pnpm --filter @codeinsight/diagram-gen build 2>&1 && pnpm --filter @codeinsight/diagram-gen test 2>&1 | tail -30
```

Expected: clean build, all tests pass. (Tests use empty/no CIG snapshots without fileSummaries so `buildFileSummaryBlock` returns null — prompts unchanged from the test perspective.)

- [ ] **Step 7: Full workspace build check**

```bash
pnpm --filter @codeinsight/ingestion build 2>&1 && pnpm --filter @codeinsight/backstage-plugin-backend build 2>&1 | tail -20
```

Expected: clean builds end-to-end.

- [ ] **Step 8: Commit**

```bash
git add packages/core/diagram-gen/src/diagrams/universal/HighLevelArchitectureModule.ts \
        packages/core/diagram-gen/src/diagrams/backend/ApiEntityMappingModule.ts \
        packages/core/diagram-gen/src/diagrams/universal/AuthFlowModule.ts \
        packages/core/diagram-gen/src/diagrams/universal/DeploymentInfraModule.ts
git commit -m "feat(diagram-gen): inject file summaries block into LLM-assisted diagram prompts"
```

---

## Self-Review Notes

**Spec coverage check:**
- VectorStore `getFileSummaries` → Task 1 ✓
- IndexingService `precomputeSummaries` + cache → Task 2 ✓
- Indexer/DocGenerator/DiagramGenerator interface updates → Task 3 ✓
- IngestionService pre-compute step + pass-through → Task 3 ✓
- ContextBuilder `fileSummaries` + `getFilesByInDegree` → Task 4 ✓
- `buildOverviewVars` enrichment → Task 4 ✓
- `buildArchitectureVars` + `buildFeaturesVars` → Task 5 ✓
- PromptRegistry new modules + overview update → Task 6 ✓
- ClassifierService CORE_MODULES update → Task 6 ✓
- DocGenerationService signature thread-through → Task 7 ✓
- CIGSnapshot `fileSummaries` field → Task 8 ✓
- `buildFileSummaryBlock` utility → Task 8 ✓
- DiagramGenerationService signature + inject → Task 8 ✓
- LLM diagram module prompt enrichment (4 modules) → Task 9 ✓

**Graceful degradation verified:** Every new code path is guarded with `if (this.fileSummaries.size === 0) return null` or equivalent — old behavior is preserved when no summaries are present.

**Type consistency:** `Map<string, string>` used consistently for fileSummaries across all tasks. `getFilesByInDegree` defined in Task 4 and referenced only in Tasks 4 and 5 (both within ContextBuilder). `buildFileSummaryBlock(cig)` defined in Task 8 utils and called in Task 9 modules.

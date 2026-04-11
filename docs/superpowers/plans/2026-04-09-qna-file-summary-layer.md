# QnA File Summary Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `file_summary` vector store layer during ingestion so that conceptual QnA queries ("how does X work?") can find answers across all repository files, not just individual CIG symbols.

**Architecture:** A new `FileSummaryService` in `@codeinsight/chunking` reads each repository file directly from the cloned repo and applies a tiered strategy: small files stored raw (no LLM cost), medium/large source files summarized by LLM using actual source code as input, large non-source files chunked via sliding window. `IndexingService` orchestrates `FileSummaryService` alongside the existing `ChunkingService` and uses `fileSha` (not summary text SHA) as `contentSha` for file_summary chunks, preventing unnecessary LLM re-runs when files haven't changed.

**Tech Stack:** TypeScript, Jest, `@codeinsight/types` (LLMClient, StorageAdapter, CIGNode, RepoFile), `fs/promises`, existing `estimateTokens` and `buildChunkId` utilities from `ChunkingService`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/core/chunking/src/types.ts` | Modify | Add `'file_summary'` to `ChunkLayer` union |
| `packages/core/chunking/src/FileSummaryService.ts` | Create | Tiered file-to-chunk logic: raw, LLM summary, sliding window |
| `packages/core/chunking/src/FileSummaryService.test.ts` | Create | Unit tests for all tiers + delta skip + error handling |
| `packages/core/chunking/src/index.ts` | Modify | Export `FileSummaryService`, `FileSummaryConfig`, `FileSummaryStats`, `buildFileSummaryChunkId` |
| `packages/core/indexing/src/IndexingService.ts` | Modify | Accept optional `LLMClient`, load existing shas before chunking, merge summary chunks, use `fileSha` as contentSha for file_summary layer |
| `packages/core/indexing/src/__tests__/IndexingService.test.ts` | Modify | Add tests: with LLM client present → file_summary chunks appear; without → they don't |
| `packages/backstage/plugin-backend/src/plugin.ts` | Modify | Pass `llmClient` to `IndexingService` constructor |

---

## Task 1: Add `file_summary` to `ChunkLayer` and scaffold `FileSummaryService`

**Files:**
- Modify: `packages/core/chunking/src/types.ts:7`
- Create: `packages/core/chunking/src/FileSummaryService.ts`
- Create: `packages/core/chunking/src/FileSummaryService.test.ts`

- [ ] **Step 1: Update `ChunkLayer` type**

In `packages/core/chunking/src/types.ts`, change line 7:

```typescript
export type ChunkLayer = 'code' | 'doc_section' | 'diagram_desc' | 'file_summary';
```

- [ ] **Step 2: Write failing test for raw tier (small file)**

Create `packages/core/chunking/src/FileSummaryService.test.ts`:

```typescript
import { promises as fs } from 'fs';

import type { CIGNode, LLMClient, RepoFile, StorageAdapter } from '@codeinsight/types';

import { FileSummaryService, buildFileSummaryChunkId } from './FileSummaryService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(
  repoFiles: RepoFile[] = [],
  cigNodes: CIGNode[] = [],
): StorageAdapter {
  return {
    getRepoFiles: jest.fn().mockResolvedValue(repoFiles),
    getCIGNodes: jest.fn().mockResolvedValue(cigNodes),
    getCIGEdges: jest.fn().mockResolvedValue([]),
  } as unknown as StorageAdapter;
}

function makeLLMClient(response = 'LLM summary'): LLMClient & { complete: jest.Mock } {
  return { complete: jest.fn().mockResolvedValue(response), stream: jest.fn() };
}

function makeRepoFile(filePath: string, currentSha = 'sha-abc', fileType: RepoFile['fileType'] = 'source', language = 'typescript'): RepoFile {
  return { repoId: 'repo-1', filePath, currentSha, fileType, language, parseStatus: 'parsed' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

const mockReadFile = fs.readFile as jest.Mock;

const REPO_ID = 'repo-1';
const CLONE_DIR = '/tmp/clone';
const EXISTING_SHAS = new Map<string, string>();

describe('FileSummaryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('raw tier (< 500 tokens)', () => {
    it('stores file content as-is without calling LLM', async () => {
      // ~10 tokens — well below raw threshold
      const smallContent = 'export const VERSION = "1.0.0";';
      mockReadFile.mockResolvedValue(smallContent);

      const file = makeRepoFile('src/version.ts');
      const storage = makeStorage([file]);
      const llm = makeLLMClient();
      const service = new FileSummaryService(storage, llm);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkId).toBe(buildFileSummaryChunkId(REPO_ID, 'src/version.ts'));
      expect(chunks[0].layer).toBe('file_summary');
      expect(chunks[0].content).toBe(smallContent.trim());
      expect(chunks[0].fileSha).toBe('sha-abc');
      expect(llm.complete).not.toHaveBeenCalled();
      expect(stats.rawChunks).toBe(1);
      expect(stats.llmSummaries).toBe(0);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @codeinsight/chunking test -- --testPathPattern=FileSummaryService
```

Expected: FAIL with "Cannot find module './FileSummaryService'"

- [ ] **Step 4: Create `FileSummaryService.ts` with raw tier**

Create `packages/core/chunking/src/FileSummaryService.ts`:

```typescript
import { promises as fs } from 'fs';
import * as path from 'path';

import type { CIGNode, LLMClient, Logger, StorageAdapter } from '@codeinsight/types';

import { estimateTokens } from './ChunkingService';
import type { Chunk } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileSummaryConfig {
  /** Store raw content if estimated tokens below this. Default: 500. */
  rawTokenThreshold?: number;
  /** Use full file content for LLM if below this. Above → excerpt + symbol list. Default: 3000. */
  fullSummaryThreshold?: number;
  /** Lines to include in large-file excerpt. Default: 60. */
  maxExcerptLines?: number;
  /** Chars per token for estimation. Default: 3. */
  charsPerToken?: number;
}

export interface FileSummaryStats {
  rawChunks: number;
  llmSummaries: number;
  slidingChunks: number;
  skipped: number;
  totalChunks: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RAW_TOKEN_THRESHOLD = 500;
const DEFAULT_FULL_SUMMARY_THRESHOLD = 3000;
const DEFAULT_MAX_EXCERPT_LINES = 60;
const DEFAULT_CHARS_PER_TOKEN = 3;

const SYSTEM_PROMPT =
  'You summarize source files for a code search index. Be concise, specific, ' +
  'and grounded in the actual code. Never speculate — only describe what is shown.';

// ---------------------------------------------------------------------------
// FileSummaryService
// ---------------------------------------------------------------------------

export class FileSummaryService {
  private readonly rawTokenThreshold: number;
  private readonly fullSummaryThreshold: number;
  private readonly maxExcerptLines: number;
  private readonly charsPerToken: number;

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly llmClient: LLMClient,
    private readonly logger?: Logger,
    config?: FileSummaryConfig,
  ) {
    this.rawTokenThreshold = config?.rawTokenThreshold ?? DEFAULT_RAW_TOKEN_THRESHOLD;
    this.fullSummaryThreshold = config?.fullSummaryThreshold ?? DEFAULT_FULL_SUMMARY_THRESHOLD;
    this.maxExcerptLines = config?.maxExcerptLines ?? DEFAULT_MAX_EXCERPT_LINES;
    this.charsPerToken = config?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  }

  /**
   * Produce file_summary chunks for every RepoFile in the repo.
   *
   * @param existingShas  Map of chunkId → contentSha currently in the vector store.
   *                      For file_summary chunks contentSha equals the source file's
   *                      currentSha — so a match means the file hasn't changed and
   *                      the LLM call can be skipped entirely.
   */
  async summarize(
    repoId: string,
    cloneDir: string,
    existingShas: Map<string, string>,
  ): Promise<{ chunks: Chunk[]; stats: FileSummaryStats }> {
    this.logger?.info('FileSummaryService: starting', { repoId });

    const [repoFiles, allNodes] = await Promise.all([
      this.storageAdapter.getRepoFiles(repoId),
      this.storageAdapter.getCIGNodes(repoId),
    ]);

    // Index CIG nodes by file path
    const nodesByFilePath = new Map<string, CIGNode[]>();
    for (const node of allNodes) {
      const bucket = nodesByFilePath.get(node.filePath) ?? [];
      bucket.push(node);
      nodesByFilePath.set(node.filePath, bucket);
    }

    const stats: FileSummaryStats = {
      rawChunks: 0,
      llmSummaries: 0,
      slidingChunks: 0,
      skipped: 0,
      totalChunks: 0,
    };
    const chunks: Chunk[] = [];

    for (const repoFile of repoFiles) {
      const baseChunkId = buildFileSummaryChunkId(repoId, repoFile.filePath);

      // Delta skip: contentSha stored for file_summary is the source fileSha.
      // If it matches currentSha the file hasn't changed — keep existing chunk.
      if (existingShas.get(baseChunkId) === repoFile.currentSha) {
        stats.skipped++;
        continue;
      }

      // Read from clone
      let rawContent: string;
      try {
        rawContent = await fs.readFile(path.join(cloneDir, repoFile.filePath), 'utf-8');
      } catch {
        this.logger?.warn('FileSummaryService: could not read file from clone', {
          filePath: repoFile.filePath,
        });
        stats.skipped++;
        continue;
      }

      const rawTokens = estimateTokens(rawContent, this.charsPerToken);
      const fileNodes = nodesByFilePath.get(repoFile.filePath) ?? [];
      const isSourceFile = repoFile.fileType === 'source';
      const language = repoFile.language ?? undefined;

      if (rawTokens < this.rawTokenThreshold) {
        // Tier 1: small file — store raw content
        chunks.push({
          chunkId: baseChunkId,
          repoId,
          content: rawContent.trim(),
          layer: 'file_summary',
          filePath: repoFile.filePath,
          fileSha: repoFile.currentSha,
          metadata: { filePath: repoFile.filePath, language },
        });
        stats.rawChunks++;
      } else if (rawTokens <= this.fullSummaryThreshold) {
        // Tier 2: medium file — full content → LLM summary
        const summary = await this.callLLM(repoFile.filePath, rawContent);
        if (summary) {
          chunks.push({
            chunkId: baseChunkId,
            repoId,
            content: summary,
            layer: 'file_summary',
            filePath: repoFile.filePath,
            fileSha: repoFile.currentSha,
            metadata: { filePath: repoFile.filePath, language },
          });
          stats.llmSummaries++;
        } else {
          stats.skipped++;
        }
      } else if (isSourceFile) {
        // Tier 3a: large source file — excerpt + symbol list → LLM summary
        const excerpt = this.buildExcerpt(rawContent, fileNodes);
        const summary = await this.callLLM(repoFile.filePath, excerpt);
        if (summary) {
          chunks.push({
            chunkId: baseChunkId,
            repoId,
            content: summary,
            layer: 'file_summary',
            filePath: repoFile.filePath,
            fileSha: repoFile.currentSha,
            metadata: { filePath: repoFile.filePath, language },
          });
          stats.llmSummaries++;
        } else {
          stats.skipped++;
        }
      } else {
        // Tier 3b: large non-source file — sliding window, no LLM
        const slideChunks = this.slidingWindowChunks(
          repoId,
          repoFile.filePath,
          repoFile.currentSha,
          rawContent,
          language,
        );
        chunks.push(...slideChunks);
        stats.slidingChunks += slideChunks.length;
      }
    }

    stats.totalChunks = chunks.length;
    this.logger?.info('FileSummaryService: complete', { repoId, ...stats });
    return { chunks, stats };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildExcerpt(content: string, nodes: CIGNode[]): string {
    const firstLines = content.split('\n').slice(0, this.maxExcerptLines).join('\n');
    const header = `[First ${this.maxExcerptLines} lines]\n${firstLines}`;
    if (nodes.length === 0) return header;

    const symbolList = nodes
      .map(n => `${n.symbolType} ${n.symbolName} (lines ${n.startLine}–${n.endLine})`)
      .join('\n');
    return `${header}\n\n[Exported symbols]\n${symbolList}`;
  }

  private async callLLM(filePath: string, content: string): Promise<string | null> {
    const userPrompt =
      `Summarize this file for a code search index. In 4–6 sentences cover:\n` +
      `- What this file does and its role in the system\n` +
      `- Key behaviors or logic (e.g., how it filters data, what APIs it calls, what patterns it uses)\n` +
      `- Any non-obvious implementation details\n\n` +
      `File: ${filePath}\n\n${content}`;

    try {
      return await this.llmClient.complete(SYSTEM_PROMPT, userPrompt, {
        maxTokens: 300,
        temperature: 0.2,
      });
    } catch (err) {
      this.logger?.warn('FileSummaryService: LLM call failed', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private slidingWindowChunks(
    repoId: string,
    filePath: string,
    fileSha: string,
    content: string,
    language: string | undefined,
  ): Chunk[] {
    const paragraphs = content.split(/\n\n+/);
    const targetTokens = this.fullSummaryThreshold;
    const produced: Chunk[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;
    let index = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para, this.charsPerToken);
      if (currentTokens + paraTokens > targetTokens && currentBlock.length > 0) {
        produced.push(
          this.makeSlideChunk(repoId, filePath, fileSha, currentBlock.join('\n\n'), index++, language),
        );
        currentBlock = [];
        currentTokens = 0;
      }
      currentBlock.push(para);
      currentTokens += paraTokens;
    }

    if (currentBlock.length > 0) {
      produced.push(
        this.makeSlideChunk(repoId, filePath, fileSha, currentBlock.join('\n\n'), index, language),
      );
    }

    return produced.filter(c => c.content.trim().length > 0);
  }

  private makeSlideChunk(
    repoId: string,
    filePath: string,
    fileSha: string,
    content: string,
    index: number,
    language: string | undefined,
  ): Chunk {
    return {
      chunkId: `${buildFileSummaryChunkId(repoId, filePath)}:${index}`,
      repoId,
      content: content.trim(),
      layer: 'file_summary',
      filePath,
      fileSha,
      metadata: { filePath, language, subChunkIndex: index },
    };
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Build the base chunk ID for a file_summary chunk. */
export function buildFileSummaryChunkId(repoId: string, filePath: string): string {
  return `${repoId}:${filePath}:file_summary`;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @codeinsight/chunking test -- --testPathPattern=FileSummaryService
```

Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add packages/core/chunking/src/types.ts packages/core/chunking/src/FileSummaryService.ts packages/core/chunking/src/FileSummaryService.test.ts
git commit -m "feat(chunking): scaffold FileSummaryService with raw tier"
```

---

## Task 2: LLM tiers — medium file (full content) and large source file (excerpt)

**Files:**
- Modify: `packages/core/chunking/src/FileSummaryService.test.ts`

- [ ] **Step 1: Write failing tests for medium and large source file tiers**

Add these `describe` blocks inside the top-level `describe('FileSummaryService')` block in `FileSummaryService.test.ts`:

```typescript
  describe('LLM tier — medium file (500–3000 tokens)', () => {
    it('calls LLM with full file content and stores summary', async () => {
      // ~600 tokens (above raw threshold 500, below full summary threshold 3000)
      const mediumContent = 'x'.repeat(600 * 3); // ~600 tokens at 3 chars/token
      mockReadFile.mockResolvedValue(mediumContent);

      const file = makeRepoFile('src/lib/github.ts');
      const storage = makeStorage([file]);
      const llm = makeLLMClient('This file implements the GitHub provider.');
      const service = new FileSummaryService(storage, llm);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('This file implements the GitHub provider.');
      expect(chunks[0].fileSha).toBe('sha-abc');
      expect(llm.complete).toHaveBeenCalledTimes(1);
      // LLM prompt must include the full file content
      const userPrompt = llm.complete.mock.calls[0][1] as string;
      expect(userPrompt).toContain('src/lib/github.ts');
      expect(userPrompt).toContain(mediumContent);
      expect(stats.llmSummaries).toBe(1);
    });
  });

  describe('LLM tier — large source file with CIG nodes (> 3000 tokens)', () => {
    it('calls LLM with first-N-lines excerpt and symbol list, not full content', async () => {
      // ~4000 tokens (above full summary threshold)
      const largeContent = Array.from({ length: 200 }, (_, i) => `// line ${i}\nconst x${i} = ${i};`).join('\n');
      mockReadFile.mockResolvedValue(largeContent);

      const cigNode: CIGNode = {
        nodeId: 'node-1',
        repoId: REPO_ID,
        filePath: 'src/lib/github.ts',
        symbolName: 'fetchProjects',
        symbolType: 'function',
        startLine: 10,
        endLine: 45,
        exported: true,
        extractedSha: 'sha-abc',
      };
      const file = makeRepoFile('src/lib/github.ts');
      const storage = makeStorage([file], [cigNode]);
      const llm = makeLLMClient('Fetches GitHub projects filtered by topic.');
      const service = new FileSummaryService(storage, llm, undefined, { maxExcerptLines: 5 });

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Fetches GitHub projects filtered by topic.');
      expect(llm.complete).toHaveBeenCalledTimes(1);
      const userPrompt = llm.complete.mock.calls[0][1] as string;
      // Must contain the excerpt header and symbol list — but NOT the full 4000-token content
      expect(userPrompt).toContain('[First 5 lines]');
      expect(userPrompt).toContain('[Exported symbols]');
      expect(userPrompt).toContain('function fetchProjects (lines 10–45)');
      expect(userPrompt.length).toBeLessThan(largeContent.length);
      expect(stats.llmSummaries).toBe(1);
    });

    it('calls LLM with first-N-lines only when large source file has no CIG nodes', async () => {
      const largeContent = Array.from({ length: 200 }, (_, i) => `echo line ${i}`).join('\n');
      mockReadFile.mockResolvedValue(largeContent);

      const file = makeRepoFile('scripts/deploy.sh', 'sha-sh', 'source', 'shell');
      const storage = makeStorage([file], []); // no CIG nodes
      const llm = makeLLMClient('Deployment script.');
      const service = new FileSummaryService(storage, llm, undefined, { maxExcerptLines: 5 });

      const { chunks } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(1);
      const userPrompt = llm.complete.mock.calls[0][1] as string;
      expect(userPrompt).toContain('[First 5 lines]');
      expect(userPrompt).not.toContain('[Exported symbols]');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @codeinsight/chunking test -- --testPathPattern=FileSummaryService
```

Expected: FAIL — the medium file content assertion fails (LLM is not being called for medium files yet — actually Task 1 already implemented all tiers, so these should PASS now). If they pass, note that the implementation is already complete for these tiers.

> **Note:** All tiers were implemented in Task 1. If these tests pass immediately, that is expected — the implementation was complete. Move to Step 3.

- [ ] **Step 3: Run all chunking tests to verify nothing broke**

```bash
pnpm --filter @codeinsight/chunking test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/chunking/src/FileSummaryService.test.ts
git commit -m "test(chunking): add LLM tier tests for FileSummaryService"
```

---

## Task 3: Sliding window tier, delta skip, and error handling tests

**Files:**
- Modify: `packages/core/chunking/src/FileSummaryService.test.ts`

- [ ] **Step 1: Add sliding window, delta skip, and error handling tests**

Add these `describe` blocks inside `describe('FileSummaryService')`:

```typescript
  describe('sliding window tier — large non-source file (> 3000 tokens)', () => {
    it('produces multiple chunks without calling LLM', async () => {
      // Large markdown file — ~6000 tokens
      const para = 'word '.repeat(100); // ~150 tokens per paragraph at 3 chars/token
      const largeMarkdown = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\n${para}`).join('\n\n');
      mockReadFile.mockResolvedValue(largeMarkdown);

      const file = makeRepoFile('docs/guide.md', 'sha-md', 'source', 'markdown');
      // file_summary tier uses fileType; markdown files are classified as 'source'
      // but have no CIG nodes — however we need to force them through the sliding window path.
      // Override: pass fileType as 'config' to represent non-TypeScript non-source.
      const nonSourceFile: RepoFile = { ...file, fileType: 'config' };
      const storage = makeStorage([nonSourceFile]);
      const llm = makeLLMClient();
      const service = new FileSummaryService(storage, llm, undefined, {
        rawTokenThreshold: 500,
        fullSummaryThreshold: 3000,
      });

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks.length).toBeGreaterThan(1);
      expect(llm.complete).not.toHaveBeenCalled();
      expect(stats.slidingChunks).toBe(chunks.length);
      // All chunks have the same fileSha
      for (const c of chunks) {
        expect(c.fileSha).toBe('sha-md');
        expect(c.layer).toBe('file_summary');
      }
    });
  });

  describe('delta skip', () => {
    it('skips file and does not call LLM when contentSha matches currentSha', async () => {
      const file = makeRepoFile('src/version.ts', 'sha-unchanged');
      const storage = makeStorage([file]);
      const llm = makeLLMClient();
      const service = new FileSummaryService(storage, llm);

      // Simulate existing chunk with contentSha = file's currentSha
      const existingShas = new Map([
        [buildFileSummaryChunkId(REPO_ID, 'src/version.ts'), 'sha-unchanged'],
      ]);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, existingShas);

      expect(chunks).toHaveLength(0);
      expect(llm.complete).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(stats.skipped).toBe(1);
    });
  });

  describe('error handling', () => {
    it('skips file and logs warning when file cannot be read from clone', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const file = makeRepoFile('src/missing.ts');
      const storage = makeStorage([file]);
      const llm = makeLLMClient();
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const service = new FileSummaryService(storage, llm, logger);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        'FileSummaryService: could not read file from clone',
        expect.objectContaining({ filePath: 'src/missing.ts' }),
      );
      expect(stats.skipped).toBe(1);
    });

    it('skips file and logs warning when LLM call fails', async () => {
      const mediumContent = 'x'.repeat(600 * 3);
      mockReadFile.mockResolvedValue(mediumContent);
      const file = makeRepoFile('src/lib/github.ts');
      const storage = makeStorage([file]);
      const llm = makeLLMClient();
      llm.complete.mockRejectedValue(new Error('LLM timeout'));
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const service = new FileSummaryService(storage, llm, logger);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        'FileSummaryService: LLM call failed',
        expect.objectContaining({ filePath: 'src/lib/github.ts' }),
      );
      expect(stats.skipped).toBe(1);
    });
  });
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @codeinsight/chunking test -- --testPathPattern=FileSummaryService
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/chunking/src/FileSummaryService.test.ts
git commit -m "test(chunking): add sliding window, delta skip, and error handling tests"
```

---

## Task 4: Export `FileSummaryService` from `@codeinsight/chunking`

**Files:**
- Modify: `packages/core/chunking/src/index.ts`

- [ ] **Step 1: Add exports**

Replace the contents of `packages/core/chunking/src/index.ts` with:

```typescript
export {
  ChunkingService,
  buildChunkId,
  buildDiagramChunkText,
  computeCompositeSha,
  estimateTokens,
} from './ChunkingService';

export {
  FileSummaryService,
  buildFileSummaryChunkId,
} from './FileSummaryService';

export type {
  FileSummaryConfig,
  FileSummaryStats,
} from './FileSummaryService';

export type {
  Chunk,
  ChunkLayer,
  ChunkMetadata,
  ChunkingConfig,
  ChunkingResult,
} from './types';
```

- [ ] **Step 2: Build the package to verify no TypeScript errors**

```bash
pnpm --filter @codeinsight/chunking build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/chunking/src/index.ts
git commit -m "feat(chunking): export FileSummaryService from package"
```

---

## Task 5: Wire `FileSummaryService` into `IndexingService`

**Files:**
- Modify: `packages/core/indexing/src/IndexingService.ts`
- Modify: `packages/core/indexing/src/__tests__/IndexingService.test.ts`

- [x] **Step 1: Write failing tests for IndexingService with LLMClient**

Add a new `describe` block at the end of `packages/core/indexing/src/__tests__/IndexingService.test.ts`.

First, add this import at the top of the file (after existing imports):

```typescript
import type { LLMClient } from '@codeinsight/types';
```

Then add the missing storage mock stubs. Find the `makeStorage` function and add missing methods so it doesn't fail when `FileSummaryService` calls `getCIGNodes`:

```typescript
// In the existing makeStorage function, the mock already has getCIGNodes — verify it's present.
// It is: getCIGNodes: jest.fn().mockResolvedValue([])
// No change needed to makeStorage.
```

Add a `makeLLMClient` helper after `makeVectorStore`:

```typescript
function makeLLMClient(): LLMClient & { complete: jest.Mock } {
  return {
    complete: jest.fn().mockResolvedValue('File summary from LLM'),
    stream: jest.fn(),
  };
}
```

Add a new describe block at the bottom of the file:

```typescript
describe('IndexingService with LLMClient (file_summary layer)', () => {
  it('produces file_summary chunks when llmClient is provided and file is new', async () => {
    // A small file (< 500 tokens) so no LLM call is needed — raw tier
    const smallContent = 'export const VERSION = "1.0.0";';

    // Mock fs.readFile for FileSummaryService
    jest.mock('fs', () => ({
      promises: { readFile: jest.fn().mockResolvedValue(smallContent) },
    }));

    const storage = makeStorage({
      getRepoFiles: jest.fn().mockResolvedValue([
        {
          repoId: 'repo-1',
          filePath: 'src/version.ts',
          currentSha: 'file-sha-1',
          fileType: 'source',
          language: 'typescript',
          parseStatus: 'parsed',
        },
      ]),
    });
    const embed = makeEmbeddingClient();
    const vs = makeVectorStore(); // no existing chunks
    const llm = makeLLMClient();

    const svc = new IndexingService(embed, vs, storage, undefined, undefined, llm);
    const result = await svc.indexRepo('repo-1', '/tmp/clone');

    // file_summary chunk should be in the indexed set
    const allUpserted = vs.upsertCalls.flat();
    const summaryChunks = allUpserted.filter(c => c.layer === 'file_summary');
    expect(summaryChunks).toHaveLength(1);
    expect(summaryChunks[0].chunkId).toBe('repo-1:src/version.ts:file_summary');
    // contentSha must equal the file's currentSha (not a hash of the content)
    expect(summaryChunks[0].contentSha).toBe('file-sha-1');
    expect(result.chunksIndexed).toBeGreaterThanOrEqual(1);
  });

  it('does not produce file_summary chunks when llmClient is absent', async () => {
    const storage = makeStorage({
      getRepoFiles: jest.fn().mockResolvedValue([
        {
          repoId: 'repo-1',
          filePath: 'src/version.ts',
          currentSha: 'file-sha-1',
          fileType: 'source',
          language: 'typescript',
          parseStatus: 'parsed',
        },
      ]),
    });
    const embed = makeEmbeddingClient();
    const vs = makeVectorStore();

    // No llmClient passed
    const svc = new IndexingService(embed, vs, storage);
    await svc.indexRepo('repo-1', '/tmp/clone');

    const allUpserted = vs.upsertCalls.flat();
    const summaryChunks = allUpserted.filter(c => c.layer === 'file_summary');
    expect(summaryChunks).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run tests to verify the new tests fail**

```bash
pnpm --filter @codeinsight/indexing test
```

Expected: The new tests FAIL — `IndexingService` constructor does not yet accept `llmClient`.

- [x] **Step 3: Update `IndexingService.ts`**

Replace `packages/core/indexing/src/IndexingService.ts` with:

```typescript
import { createHash } from 'crypto';

import { ChunkingService } from '@codeinsight/chunking';
import { FileSummaryService } from '@codeinsight/chunking';
import type { EmbeddingClient, LLMClient, Logger, StorageAdapter, VectorChunk, VectorStore } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexingResult {
  chunksTotal: number;
  chunksIndexed: number;
  chunksSkipped: number;
  chunksDeleted: number;
}

/** Optional configuration for IndexingService. */
export interface IndexingConfig {
  /**
   * Token limit for the embedding model. Default: 8192.
   * All current OpenAI embedding models (text-embedding-3-small,
   * text-embedding-3-large, ada-002) share this limit.
   */
  modelTokenLimit?: number;
  /**
   * Characters per token estimate. Default: 3.
   * Passed to ChunkingService for chunk splitting decisions.
   * The embedding safety cap uses a more conservative 2 chars/token to
   * account for dense content (Mermaid, minified code) that has fewer
   * chars per actual token than typical prose or TypeScript.
   */
  charsPerToken?: number;
}

// ---------------------------------------------------------------------------
// IndexingService
// ---------------------------------------------------------------------------

/**
 * Orchestrates the QnA indexing pipeline:
 *
 *   ChunkingService + FileSummaryService → delta filter → EmbeddingClient (batched) → VectorStore
 *
 * Delta behaviour: chunks whose `contentSha` matches what is already stored
 * in the vector store are skipped — no redundant embedding API calls.
 *
 * For `file_summary` layer chunks, `contentSha` is set to the source file's
 * `currentSha` (not a hash of the summary text) to prevent unnecessary LLM
 * re-runs when the file content has not changed.
 *
 * Batch size for embedding calls: 100 (OpenAI default limit).
 */
export class IndexingService {
  private static readonly EMBED_BATCH_SIZE = 100;

  private readonly maxEmbedChars: number;
  private readonly chunkingService: ChunkingService;
  private readonly fileSummaryService: FileSummaryService | undefined;

  constructor(
    private readonly embeddingClient: EmbeddingClient,
    private readonly vectorStore: VectorStore,
    storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
    config?: IndexingConfig,
    llmClient?: LLMClient,
  ) {
    const charsPerToken = config?.charsPerToken ?? 3;
    const modelTokenLimit = config?.modelTokenLimit ?? 8_192;
    this.maxEmbedChars = modelTokenLimit;
    this.chunkingService = new ChunkingService(storageAdapter, logger, { charsPerToken });
    this.fileSummaryService = llmClient
      ? new FileSummaryService(storageAdapter, llmClient, logger, { charsPerToken })
      : undefined;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build (or incrementally update) the vector index for a repository.
   *
   * @param repoId   Repository ID
   * @param cloneDir Path to the cloned repo on disk (needed for code and file_summary chunks)
   */
  async indexRepo(repoId: string, cloneDir: string): Promise<IndexingResult> {
    this.logger?.info('IndexingService: starting', { repoId });

    // 1. Load existing index state first — FileSummaryService needs it for delta skip
    const existing = await this.vectorStore.listChunks(repoId);
    const existingMap = new Map(existing.map(c => [c.chunkId, c.contentSha]));

    // 2. Produce chunks from all layers (run in parallel where possible)
    const [{ chunks: regularChunks }, summaryResult] = await Promise.all([
      this.chunkingService.chunkRepo(repoId, cloneDir),
      this.fileSummaryService
        ? this.fileSummaryService.summarize(repoId, cloneDir, existingMap)
        : Promise.resolve({ chunks: [], stats: null }),
    ]);

    const chunks = [...regularChunks, ...summaryResult.chunks];

    // 3. Compute contentSha for each chunk:
    //    - file_summary: use fileSha (source file SHA) for LLM-stability
    //    - all others: SHA-256 of chunk content
    const chunksWithSha = chunks.map(chunk => ({
      chunk,
      contentSha:
        chunk.layer === 'file_summary'
          ? chunk.fileSha
          : computeContentSha(chunk.content),
    }));

    // 4. Identify which chunks need (re-)embedding
    const toIndex = chunksWithSha.filter(
      ({ chunk, contentSha }) => existingMap.get(chunk.chunkId) !== contentSha,
    );

    // 5. Identify stale chunks (no longer produced by any service)
    const currentIds = new Set(chunks.map(c => c.chunkId));
    const deletedIds = [...existingMap.keys()].filter(id => !currentIds.has(id));
    if (deletedIds.length > 0) {
      await this.vectorStore.deleteChunks(repoId, deletedIds);
      this.logger?.info('IndexingService: deleted stale chunks', {
        repoId,
        count: deletedIds.length,
      });
    }

    // 6. Embed + upsert in batches
    let indexed = 0;
    for (let i = 0; i < toIndex.length; i += IndexingService.EMBED_BATCH_SIZE) {
      const batch = toIndex.slice(i, i + IndexingService.EMBED_BATCH_SIZE);
      const texts = batch.map(({ chunk }) => {
        if (chunk.content.length > this.maxEmbedChars) {
          this.logger?.warn('IndexingService: chunk exceeds maxEmbedChars, truncating', {
            repoId,
            chunkId: chunk.chunkId,
            layer: chunk.layer,
            contentLength: chunk.content.length,
            maxEmbedChars: this.maxEmbedChars,
          });
          return chunk.content.slice(0, this.maxEmbedChars);
        }
        return chunk.content;
      });

      this.logger?.debug('IndexingService: embedding batch', {
        repoId,
        batchStart: i,
        batchSize: batch.length,
      });

      const embeddings = await this.embeddingClient.embed(texts);

      const vectorChunks: VectorChunk[] = batch.map(({ chunk, contentSha }, j) => ({
        chunkId: chunk.chunkId,
        repoId: chunk.repoId,
        content: chunk.content,
        contentSha,
        embedding: embeddings[j],
        layer: chunk.layer,
        metadata: chunk.metadata as Record<string, unknown> | undefined,
      }));

      await this.vectorStore.upsert(vectorChunks);
      indexed += batch.length;
    }

    const result: IndexingResult = {
      chunksTotal: chunks.length,
      chunksIndexed: indexed,
      chunksSkipped: chunks.length - toIndex.length,
      chunksDeleted: deletedIds.length,
    };

    this.logger?.info('IndexingService: complete', { repoId, ...result });
    return result;
  }
}

// ---------------------------------------------------------------------------
// Pure utility
// ---------------------------------------------------------------------------

/** SHA-256 of chunk text — used as the content-addressable key. */
export function computeContentSha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
```

- [x] **Step 4: Run all indexing tests**

```bash
pnpm --filter @codeinsight/indexing test
```

Expected: All tests PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/indexing/src/IndexingService.ts packages/core/indexing/src/__tests__/IndexingService.test.ts
git commit -m "feat(indexing): wire FileSummaryService into IndexingService"
```

---

## Task 6: Wire `llmClient` into `IndexingService` in the plugin composition root

**Files:**
- Modify: `packages/backstage/plugin-backend/src/plugin.ts:219-221`

- [ ] **Step 1: Pass `llmClient` to `IndexingService`**

In `packages/backstage/plugin-backend/src/plugin.ts`, find this block (around line 219):

```typescript
        const indexingService = embeddingClient
          ? new IndexingService(embeddingClient, vectorStore, storageAdapter, coreLogger, indexingConfig)
          : undefined;
```

Replace it with:

```typescript
        const indexingService = embeddingClient
          ? new IndexingService(embeddingClient, vectorStore, storageAdapter, coreLogger, indexingConfig, llmClient)
          : undefined;
```

- [ ] **Step 2: Build the plugin-backend package**

```bash
pnpm --filter @codeinsight/plugin-backend build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Run all tests across affected packages**

```bash
pnpm --filter @codeinsight/chunking test && pnpm --filter @codeinsight/indexing test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/backstage/plugin-backend/src/plugin.ts
git commit -m "feat(plugin-backend): pass llmClient to IndexingService to enable file_summary layer"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `FileSummaryService` in `@codeinsight/chunking` | Task 1 |
| Tiered strategy: raw (< 500 tokens) | Task 1 |
| Tiered strategy: medium → full content → LLM | Task 1 |
| Tiered strategy: large source with CIG → excerpt + symbol list → LLM | Task 1 |
| Tiered strategy: large source without CIG → first 60 lines → LLM | Task 1 |
| Tiered strategy: large non-source → sliding window, no LLM | Task 1 |
| `fileSha` as `contentSha` for delta stability | Task 5 |
| `IndexingService` accepts optional `LLMClient` | Task 5 |
| Backwards compatible (no LLM = no file_summary) | Task 5 |
| `plugin.ts` wiring | Task 6 |
| Unit tests for all 6 tier/error cases | Tasks 1–3 |
| Integration test: file_summary chunks in vector store | Task 5 |

All spec requirements covered. No gaps.

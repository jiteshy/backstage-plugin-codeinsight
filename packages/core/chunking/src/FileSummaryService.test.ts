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
      expect(chunks[0].layer).toBe('file_summary');
      expect(llm.complete).toHaveBeenCalledTimes(1);
      // LLM prompt must include the full file content
      const userPrompt = llm.complete.mock.calls[0][1] as string;
      expect(userPrompt).toContain('src/lib/github.ts');
      expect(userPrompt).toContain(mediumContent);
      expect(stats.llmSummaries).toBe(1);
    });
  });

  describe('LLM tier — large source file (> 3000 tokens)', () => {
    it('calls LLM with first-N-lines excerpt and symbol list, not full content', async () => {
      // ~4000 tokens (above full summary threshold of 3000 at 3 chars/token = 9000 chars)
      const largeContent = Array.from({ length: 200 }, (_, i) => `// line ${i}\nconst x${i} = ${'a'.repeat(40)};`).join('\n');
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
      // Must contain the excerpt header and symbol list — but NOT the full content
      expect(userPrompt).toContain('[First 5 lines]');
      expect(userPrompt).toContain('[Symbols]'); // section header used in buildExcerpt()
      expect(userPrompt).toContain('function fetchProjects (lines 10–45)');
      expect(userPrompt.length).toBeLessThan(largeContent.length);
      expect(stats.llmSummaries).toBe(1);
    });

    it('calls LLM with first-N-lines only when large source file has no CIG nodes', async () => {
      // ~4000 tokens (above full summary threshold of 3000 at 3 chars/token = 9000 chars)
      const largeContent = Array.from({ length: 200 }, (_, i) => `echo line ${i} ${'x'.repeat(40)}`).join('\n');
      mockReadFile.mockResolvedValue(largeContent);

      const file = makeRepoFile('scripts/deploy.sh', 'sha-sh', 'source', 'shell');
      const storage = makeStorage([file], []); // no CIG nodes
      const llm = makeLLMClient('Deployment script.');
      const service = new FileSummaryService(storage, llm, undefined, { maxExcerptLines: 5 });

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Deployment script.');
      expect(chunks[0].fileSha).toBe('sha-sh');
      expect(stats.llmSummaries).toBe(1);
      const userPrompt = llm.complete.mock.calls[0][1] as string;
      expect(userPrompt).toContain('[First 5 lines]');
      expect(userPrompt).not.toContain('[Symbols]');
    });
  });

  describe('sliding window tier — large non-source file (> 3000 tokens)', () => {
    it('produces multiple chunks without calling LLM', async () => {
      // Large config file — ~6000 tokens, no paragraph breaks → triggers line-based fallback
      const para = 'a'.repeat(100); // ~33 tokens per paragraph
      const largeContent = Array.from({ length: 200 }, (_, i) => `key_${i}: ${para}`).join('\n');
      mockReadFile.mockResolvedValue(largeContent);

      const nonSourceFile: RepoFile = {
        repoId: REPO_ID,
        filePath: 'config/app.yaml',
        currentSha: 'sha-yaml',
        fileType: 'config',
        language: 'yaml',
        parseStatus: 'parsed',
      };
      const storage = makeStorage([nonSourceFile]);
      const llm = makeLLMClient();
      const service = new FileSummaryService(storage, llm);

      const { chunks, stats } = await service.summarize(REPO_ID, CLONE_DIR, EXISTING_SHAS);

      expect(chunks.length).toBeGreaterThan(1);
      expect(llm.complete).not.toHaveBeenCalled();
      expect(stats.slidingChunks).toBe(chunks.length);
      // All chunks have correct fileSha and layer
      for (const c of chunks) {
        expect(c.fileSha).toBe('sha-yaml');
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
});

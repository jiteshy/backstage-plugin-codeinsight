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

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
    return `${header}\n\n[Symbols]\n${symbolList}`;
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

    // Fallback: if splitting on blank lines produced only one oversized block,
    // split by line count to stay within the token budget.
    if (produced.length === 1 && estimateTokens(produced[0].content, this.charsPerToken) > targetTokens) {
      const lines = content.split('\n');
      const totalTokens = estimateTokens(content, this.charsPerToken);
      const targetLines = Math.ceil(
        lines.length / Math.ceil(totalTokens / targetTokens),
      );
      produced.length = 0;
      index = 0;
      for (let i = 0; i < lines.length; i += targetLines) {
        const slice = lines.slice(i, i + targetLines).join('\n').trim();
        if (slice.length > 0) {
          produced.push(
            this.makeSlideChunk(repoId, filePath, fileSha, slice, index++, language),
          );
        }
      }
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

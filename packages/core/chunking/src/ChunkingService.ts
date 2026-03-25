import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import type {
  CIGEdge,
  CIGNode,
  DiagramContent,
  DocContent,
  Logger,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

import type {
  Chunk,
  ChunkLayer,
  ChunkMetadata,
  ChunkingConfig,
  ChunkingResult,
} from './types';

// ---------------------------------------------------------------------------
// Token estimation — ~4 chars per token (rough GPT/Claude estimate)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// ChunkingService
// ---------------------------------------------------------------------------

export class ChunkingService {
  private readonly maxChunkTokens: number;

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
    config?: ChunkingConfig,
  ) {
    this.maxChunkTokens = config?.maxChunkTokens ?? 1000;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Chunk all indexed data for a repo: CIG nodes (code), doc artifacts, and
   * diagram artifacts. Returns flat chunk array ready for embedding.
   *
   * @param repoId  Repository ID
   * @param cloneDir  Path to the cloned repo on disk (for reading source files)
   */
  async chunkRepo(repoId: string, cloneDir: string): Promise<ChunkingResult> {
    this.logger?.info('ChunkingService: starting chunking', { repoId });

    // Load CIG data
    const [nodes, edges, repoFiles] = await Promise.all([
      this.storageAdapter.getCIGNodes(repoId),
      this.storageAdapter.getCIGEdges(repoId),
      this.storageAdapter.getRepoFiles(repoId),
    ]);

    // Build lookup maps
    const filesBySha = new Map<string, RepoFile>();
    for (const f of repoFiles) {
      filesBySha.set(f.filePath, f);
    }

    const edgesByFrom = new Map<string, CIGEdge[]>();
    const edgesByTo = new Map<string, CIGEdge[]>();
    for (const e of edges) {
      const fromList = edgesByFrom.get(e.fromNodeId) ?? [];
      fromList.push(e);
      edgesByFrom.set(e.fromNodeId, fromList);

      const toList = edgesByTo.get(e.toNodeId) ?? [];
      toList.push(e);
      edgesByTo.set(e.toNodeId, toList);
    }

    const nodesById = new Map<string, CIGNode>();
    for (const n of nodes) {
      nodesById.set(n.nodeId, n);
    }

    // Load artifacts for doc + diagram chunks
    const [docArtifacts, diagramArtifacts] = await Promise.all([
      this.storageAdapter.getArtifactsByType(repoId, 'doc'),
      this.storageAdapter.getArtifactsByType(repoId, 'diagram'),
    ]);

    let oversizedSplit = 0;

    // --- Layer 1: Code chunks from CIG nodes ---
    const codeChunks: Chunk[] = [];
    for (const node of nodes) {
      const repoFile = filesBySha.get(node.filePath);
      const fileSha = repoFile?.currentSha ?? node.extractedSha;

      // Read source lines for this symbol
      const sourceCode = await this.readSymbolSource(
        cloneDir,
        node.filePath,
        node.startLine,
        node.endLine,
      );

      if (!sourceCode) continue;

      // Build metadata with call graph
      const calls = (edgesByFrom.get(node.nodeId) ?? [])
        .filter(e => e.edgeType === 'calls')
        .map(e => {
          const target = nodesById.get(e.toNodeId);
          return target ? `${target.filePath}:${target.symbolName}` : e.toNodeId;
        });

      const calledBy = (edgesByTo.get(node.nodeId) ?? [])
        .filter(e => e.edgeType === 'calls')
        .map(e => {
          const source = nodesById.get(e.fromNodeId);
          return source
            ? `${source.filePath}:${source.symbolName}`
            : e.fromNodeId;
        });

      const metadata: ChunkMetadata = {
        filePath: node.filePath,
        symbol: node.symbolName,
        symbolType: node.symbolType,
        startLine: node.startLine,
        endLine: node.endLine,
        exported: node.exported,
        language: repoFile?.language ?? undefined,
        calls: calls.length > 0 ? calls : undefined,
        calledBy: calledBy.length > 0 ? calledBy : undefined,
      };

      const baseId = buildChunkId(repoId, node.filePath, node.symbolName, 'code');

      // Check if oversized — split if needed
      if (estimateTokens(sourceCode) > this.maxChunkTokens) {
        const subChunks = this.splitOversizedCode(
          sourceCode,
          baseId,
          repoId,
          node.filePath,
          fileSha,
          metadata,
        );
        codeChunks.push(...subChunks);
        oversizedSplit += subChunks.length - 1; // extra chunks created
      } else {
        codeChunks.push({
          chunkId: baseId,
          repoId,
          content: sourceCode,
          layer: 'code',
          filePath: node.filePath,
          fileSha,
          metadata,
        });
      }
    }

    // --- Layer 2: Doc chunks from doc artifacts ---
    const docChunks: Chunk[] = [];
    for (const artifact of docArtifacts) {
      if (!artifact.content || artifact.content.kind !== 'doc') continue;
      const doc = artifact.content as DocContent;
      if (!doc.markdown.trim()) continue;

      // Get artifact inputs to determine file_sha
      const inputs = await this.storageAdapter.getArtifactInputs(
        repoId,
        artifact.artifactId,
      );
      const fileSha = inputs.length > 0
        ? computeCompositeSha(inputs.map(i => i.fileSha))
        : artifact.inputSha;

      const filePath = inputs.length > 0 ? inputs[0].filePath : artifact.artifactId;

      const chunkId = buildChunkId(repoId, artifact.artifactId, doc.module, 'doc');
      const metadata: ChunkMetadata = {
        module: doc.module,
        filePath,
      };

      if (estimateTokens(doc.markdown) > this.maxChunkTokens) {
        const subChunks = this.splitOversizedText(
          doc.markdown,
          chunkId,
          repoId,
          filePath,
          fileSha,
          'doc',
          metadata,
        );
        docChunks.push(...subChunks);
        oversizedSplit += subChunks.length - 1;
      } else {
        docChunks.push({
          chunkId,
          repoId,
          content: doc.markdown,
          layer: 'doc',
          filePath,
          fileSha,
          metadata,
        });
      }
    }

    // --- Layer 3: Diagram description chunks ---
    const diagramChunks: Chunk[] = [];
    for (const artifact of diagramArtifacts) {
      if (!artifact.content || artifact.content.kind !== 'diagram') continue;
      const diagram = artifact.content as DiagramContent;

      // Use description + title as the chunk text; skip if no description
      const text = buildDiagramChunkText(diagram);
      if (!text) continue;

      const inputs = await this.storageAdapter.getArtifactInputs(
        repoId,
        artifact.artifactId,
      );
      const fileSha = inputs.length > 0
        ? computeCompositeSha(inputs.map(i => i.fileSha))
        : artifact.inputSha;

      const filePath = inputs.length > 0 ? inputs[0].filePath : artifact.artifactId;

      const chunkId = buildChunkId(
        repoId,
        artifact.artifactId,
        diagram.diagramType,
        'diagram',
      );

      diagramChunks.push({
        chunkId,
        repoId,
        content: text,
        layer: 'diagram',
        filePath,
        fileSha,
        metadata: {
          diagramType: diagram.diagramType,
          filePath,
        },
      });
    }

    const chunks = [...codeChunks, ...docChunks, ...diagramChunks];

    const stats = {
      codeChunks: codeChunks.length,
      docChunks: docChunks.length,
      diagramChunks: diagramChunks.length,
      oversizedSplit,
      totalChunks: chunks.length,
    };

    this.logger?.info('ChunkingService: chunking complete', {
      repoId,
      ...stats,
    });

    return { chunks, stats };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Read source lines for a symbol from the cloned repo. */
  private async readSymbolSource(
    cloneDir: string,
    filePath: string,
    startLine: number,
    endLine: number,
  ): Promise<string | null> {
    try {
      const fullPath = path.join(cloneDir, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      // Lines are 1-indexed in CIG
      const slice = lines.slice(startLine - 1, endLine);
      const result = slice.join('\n').trim();
      return result || null;
    } catch {
      this.logger?.warn('ChunkingService: failed to read source', { filePath });
      return null;
    }
  }

  /**
   * Split oversized code at logical sub-blocks (blank lines, function
   * boundaries). Falls back to splitting at roughly equal line counts.
   */
  private splitOversizedCode(
    source: string,
    baseId: string,
    repoId: string,
    filePath: string,
    fileSha: string,
    baseMetadata: ChunkMetadata,
  ): Chunk[] {
    const lines = source.split('\n');
    const targetLines = Math.ceil(
      lines.length / Math.ceil(estimateTokens(source) / this.maxChunkTokens),
    );

    const blocks: string[] = [];
    let currentBlock: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      currentBlock.push(lines[i]);

      // Split at blank lines or when we exceed target size
      const atBlankLine = lines[i].trim() === '' && i > 0;
      const atTargetSize = currentBlock.length >= targetLines;

      if (atBlankLine && atTargetSize && i < lines.length - 1) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    }

    // Push remaining
    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'));
    }

    // If splitting didn't help (single block), force-split at target lines
    if (blocks.length <= 1) {
      return this.forceSplitLines(
        lines,
        targetLines,
        baseId,
        repoId,
        filePath,
        fileSha,
        'code',
        baseMetadata,
      );
    }

    return blocks.map((block, idx) => ({
      chunkId: `${baseId}:${idx}`,
      repoId,
      content: block.trim(),
      layer: 'code' as ChunkLayer,
      filePath,
      fileSha,
      metadata: {
        ...baseMetadata,
        subChunkIndex: idx,
        totalSubChunks: blocks.length,
      },
    }));
  }

  /** Split oversized doc/diagram text at paragraph boundaries. */
  private splitOversizedText(
    text: string,
    baseId: string,
    repoId: string,
    filePath: string,
    fileSha: string,
    layer: ChunkLayer,
    baseMetadata: ChunkMetadata,
  ): Chunk[] {
    // Split at double newlines (paragraph boundaries)
    const paragraphs = text.split(/\n\n+/);
    const targetTokens = this.maxChunkTokens;

    const blocks: string[] = [];
    let currentBlock: string[] = [];
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      if (currentTokens + paraTokens > targetTokens && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n\n'));
        currentBlock = [];
        currentTokens = 0;
      }

      currentBlock.push(para);
      currentTokens += paraTokens;
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n\n'));
    }

    // If splitting didn't help, force-split by lines
    if (blocks.length <= 1) {
      const lines = text.split('\n');
      const targetLines = Math.ceil(
        lines.length / Math.ceil(estimateTokens(text) / this.maxChunkTokens),
      );
      return this.forceSplitLines(
        lines,
        targetLines,
        baseId,
        repoId,
        filePath,
        fileSha,
        layer,
        baseMetadata,
      );
    }

    return blocks.map((block, idx) => ({
      chunkId: `${baseId}:${idx}`,
      repoId,
      content: block.trim(),
      layer,
      filePath,
      fileSha,
      metadata: {
        ...baseMetadata,
        subChunkIndex: idx,
        totalSubChunks: blocks.length,
      },
    }));
  }

  /** Force-split an array of lines into roughly equal sub-chunks. */
  private forceSplitLines(
    lines: string[],
    targetLines: number,
    baseId: string,
    repoId: string,
    filePath: string,
    fileSha: string,
    layer: ChunkLayer,
    baseMetadata: ChunkMetadata,
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const totalSubChunks = Math.ceil(lines.length / targetLines);

    for (let i = 0; i < lines.length; i += targetLines) {
      const slice = lines.slice(i, i + targetLines);
      const idx = Math.floor(i / targetLines);
      chunks.push({
        chunkId: `${baseId}:${idx}`,
        repoId,
        content: slice.join('\n').trim(),
        layer,
        filePath,
        fileSha,
        metadata: {
          ...baseMetadata,
          subChunkIndex: idx,
          totalSubChunks,
        },
      });
    }

    return chunks;
  }
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Build a stable chunk ID.
 * Format: `{repoId}:{filePath}:{symbol}:{layer}`
 */
export function buildChunkId(
  repoId: string,
  filePath: string,
  symbol: string,
  layer: string,
): string {
  return `${repoId}:${filePath}:${symbol}:${layer}`;
}

/** Build text content for a diagram chunk from its description + title. */
export function buildDiagramChunkText(diagram: DiagramContent): string | null {
  const parts: string[] = [];
  if (diagram.title) parts.push(`# ${diagram.title}`);
  if (diagram.description) parts.push(diagram.description);
  // Include the Mermaid source as context (it's useful for structural queries)
  if (diagram.mermaid) parts.push(`\`\`\`mermaid\n${diagram.mermaid}\n\`\`\``);

  const text = parts.join('\n\n').trim();
  return text || null;
}

/** Compute a composite SHA from multiple SHAs (for multi-file inputs). */
export function computeCompositeSha(shas: string[]): string {
  const hash = createHash('sha256');
  for (const sha of shas.sort()) {
    hash.update(sha);
  }
  return hash.digest('hex');
}

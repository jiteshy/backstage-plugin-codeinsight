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
// Token estimation
// ---------------------------------------------------------------------------

// Default: 3 chars/token. Code (TypeScript operators, SVG paths, numbers)
// is denser than prose — using 4 caused oversized chunks to slip through the
// split threshold. 3 is still an estimate; use ChunkingConfig.charsPerToken
// to override for a specific deployment.
const DEFAULT_CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / charsPerToken);
}

// ---------------------------------------------------------------------------
// ChunkingService
// ---------------------------------------------------------------------------

export class ChunkingService {
  private readonly maxChunkTokens: number;
  private readonly charsPerToken: number;

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
    config?: ChunkingConfig,
  ) {
    this.maxChunkTokens = config?.maxChunkTokens ?? 1000;
    this.charsPerToken = config?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
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
    const filesByPath = new Map<string, RepoFile>();
    for (const f of repoFiles) {
      filesByPath.set(f.filePath, f);
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

    // Pre-fetch all artifact inputs in parallel — avoids N sequential DB calls
    // in the per-artifact loops below (one query per artifact → one batch instead)
    const allArtifacts = [...docArtifacts, ...diagramArtifacts];
    const artifactInputResults = await Promise.all(
      allArtifacts.map(a => this.storageAdapter.getArtifactInputs(repoId, a.artifactId)),
    );
    const artifactInputsMap = new Map(
      allArtifacts.map((a, i) => [a.artifactId, artifactInputResults[i]]),
    );

    // --- Containment detection: skip nodes whose line range is fully covered by
    //     a non-class parent node in the same file.
    //
    // The TypeScriptExtractor creates both an outer function node AND every
    // nested function/arrow-function inside it. When ChunkingService reads
    // startLine→endLine for each, the outer chunk content already contains
    // all inner chunks — pure duplication. Example: a 50-line component with
    // 5 nested handlers produces 6 chunks where 5 of them are subsets of the 1st.
    //
    // Exception: nodes that are contained ONLY within a 'class' node are kept —
    // class methods are independently useful retrieval units even though the class
    // body spans over them.
    const nodeGroups = new Map<string, CIGNode[]>();
    for (const node of nodes) {
      if (node.symbolName === '<module>') continue;
      const list = nodeGroups.get(node.filePath) ?? [];
      list.push(node);
      nodeGroups.set(node.filePath, list);
    }

    const containedNodeIds = new Set<string>();
    for (const fileNodes of nodeGroups.values()) {
      for (const candidate of fileNodes) {
        for (const container of fileNodes) {
          if (candidate.nodeId === container.nodeId) continue;
          // Class-body → method containment is intentional; don't penalise it.
          if (container.symbolType === 'class') continue;
          if (
            candidate.startLine >= container.startLine &&
            candidate.endLine <= container.endLine &&
            !(candidate.startLine === container.startLine &&
              candidate.endLine === container.endLine)
          ) {
            containedNodeIds.add(candidate.nodeId);
            break;
          }
        }
      }
    }

    this.logger?.info('ChunkingService: containment analysis', {
      repoId,
      totalSymbolNodes: [...nodeGroups.values()].reduce((s, a) => s + a.length, 0),
      containedSkipped: containedNodeIds.size,
    });

    let oversizedSplit = 0;

    // --- Layer 1: Code chunks from CIG nodes ---
    const codeChunks: Chunk[] = [];
    for (const node of nodes) {
      // Skip <module> nodes — these are CIG graph anchors for import edge resolution,
      // not meaningful code units. They span the entire file (startLine:1 to endLine:N)
      // so indexing them would embed the full file content redundantly on top of
      // individual symbol chunks and the file_summary layer.
      if (node.symbolName === '<module>') continue;

      // Skip nodes whose content is fully covered by a parent (non-class) node.
      if (containedNodeIds.has(node.nodeId)) continue;

      const repoFile = filesByPath.get(node.filePath);
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
      if (estimateTokens(sourceCode, this.charsPerToken) > this.maxChunkTokens) {
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

      // Get artifact inputs to determine file_sha (pre-fetched in parallel above)
      const inputs = artifactInputsMap.get(artifact.artifactId) ?? [];
      const fileSha = inputs.length > 0
        ? computeCompositeSha(inputs)
        : artifact.inputSha;

      // Pick lexicographically first path for deterministic chunk IDs
      const filePath = inputs.length > 0
        ? [...inputs].sort((a, b) => a.filePath.localeCompare(b.filePath))[0].filePath
        : artifact.artifactId;

      const chunkId = buildChunkId(repoId, artifact.artifactId, doc.module, 'doc');
      const metadata: ChunkMetadata = {
        module: doc.module,
        filePath,
      };

      if (estimateTokens(doc.markdown, this.charsPerToken) > this.maxChunkTokens) {
        const subChunks = this.splitOversizedText(
          doc.markdown,
          chunkId,
          repoId,
          filePath,
          fileSha,
          'doc_section',
          metadata,
        );
        docChunks.push(...subChunks);
        oversizedSplit += subChunks.length - 1;
      } else {
        docChunks.push({
          chunkId,
          repoId,
          content: doc.markdown,
          layer: 'doc_section',
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

      // Get artifact inputs to determine file_sha (pre-fetched in parallel above)
      const inputs = artifactInputsMap.get(artifact.artifactId) ?? [];
      const fileSha = inputs.length > 0
        ? computeCompositeSha(inputs)
        : artifact.inputSha;

      // Pick lexicographically first path for deterministic chunk IDs
      const filePath = inputs.length > 0
        ? [...inputs].sort((a, b) => a.filePath.localeCompare(b.filePath))[0].filePath
        : artifact.artifactId;

      const chunkId = buildChunkId(
        repoId,
        artifact.artifactId,
        diagram.diagramType,
        'diagram',
      );

      const diagramMetadata: ChunkMetadata = {
        diagramType: diagram.diagramType,
        filePath,
      };

      if (estimateTokens(text, this.charsPerToken) > this.maxChunkTokens) {
        const subChunks = this.splitOversizedText(
          text,
          chunkId,
          repoId,
          filePath,
          fileSha,
          'diagram_desc',
          diagramMetadata,
        );
        diagramChunks.push(...subChunks);
        oversizedSplit += subChunks.length - 1;
      } else {
        diagramChunks.push({
          chunkId,
          repoId,
          content: text,
          layer: 'diagram_desc',
          filePath,
          fileSha,
          metadata: diagramMetadata,
        });
      }
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
    } catch (err) {
      this.logger?.warn('ChunkingService: failed to read source', {
        filePath,
        startLine,
        endLine,
        error: err instanceof Error ? err.message : String(err),
      });
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
      lines.length / Math.ceil(estimateTokens(source, this.charsPerToken) / this.maxChunkTokens),
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
      const paraTokens = estimateTokens(para, this.charsPerToken);

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
        lines.length / Math.ceil(estimateTokens(text, this.charsPerToken) / this.maxChunkTokens),
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

    // Filter out empty sub-chunks (e.g. trailing blank-line slices)
    return chunks.filter(c => c.content.length > 0);
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

/** Build text content for a diagram chunk from its description + title.
 *
 * Raw Mermaid source is intentionally excluded: it is a dense programmatic
 * notation that inflates token counts without contributing to semantic search
 * quality. The title and description capture the diagram's meaning.
 */
export function buildDiagramChunkText(diagram: DiagramContent): string | null {
  const parts: string[] = [];
  if (diagram.title) parts.push(`# ${diagram.title}`);
  if (diagram.description) parts.push(diagram.description);

  const text = parts.join('\n\n').trim();
  return text || null;
}

/**
 * Compute a composite SHA from file inputs (for multi-file artifacts).
 * Matches the `computeInputSha` algorithm in ContextBuilder: SHA256 of
 * sorted `filePath:fileSha` pairs joined by `|`.
 */
export function computeCompositeSha(
  inputs: Array<{ filePath: string; fileSha: string }>,
): string {
  if (inputs.length === 0) return 'empty';
  const sorted = [...inputs].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const payload = sorted.map(i => `${i.filePath}:${i.fileSha}`).join('|');
  return createHash('sha256').update(payload).digest('hex');
}

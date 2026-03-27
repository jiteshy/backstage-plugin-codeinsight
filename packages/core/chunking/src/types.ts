// ---------------------------------------------------------------------------
// Chunking types — used internally by ChunkingService and its consumers
// ---------------------------------------------------------------------------

/** Chunk layer determines retrieval priority and search behavior.
 * Values must match the LAYER_* constants in @codeinsight/qna/layers.ts. */
export type ChunkLayer = 'code' | 'doc_section' | 'diagram_desc';

/** Metadata attached to every chunk for retrieval context. */
export interface ChunkMetadata {
  filePath?: string;
  symbol?: string;
  symbolType?: string;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  calls?: string[];
  calledBy?: string[];
  language?: string;
  module?: string;
  diagramType?: string;
  subChunkIndex?: number;
  totalSubChunks?: number;
}

/** A single chunk produced by the ChunkingService. */
export interface Chunk {
  chunkId: string;
  repoId: string;
  content: string;
  layer: ChunkLayer;
  filePath: string;
  fileSha: string;
  metadata: ChunkMetadata;
}

/** Result returned by ChunkingService.chunkRepo(). */
export interface ChunkingResult {
  chunks: Chunk[];
  stats: {
    codeChunks: number;
    docChunks: number;
    diagramChunks: number;
    oversizedSplit: number;
    totalChunks: number;
  };
}

/** Optional configuration for ChunkingService. */
export interface ChunkingConfig {
  /** Maximum tokens per chunk before splitting. Default: 1000. */
  maxChunkTokens?: number;
  /**
   * Characters per token for token estimation. Default: 3.
   * Code is denser than prose — lower values produce smaller, safer chunks.
   * Use 2 for dense SVG/minified code, 4 for mostly-prose content.
   */
  charsPerToken?: number;
}

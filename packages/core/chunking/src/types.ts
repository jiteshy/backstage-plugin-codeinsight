// ---------------------------------------------------------------------------
// Chunking types — used internally by ChunkingService and its consumers
// ---------------------------------------------------------------------------

/** Chunk layer determines retrieval priority and search behavior. */
export type ChunkLayer = 'code' | 'doc' | 'diagram';

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
}

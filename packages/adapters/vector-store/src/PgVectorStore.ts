import type { Logger, VectorChunk, VectorFilter, VectorStore } from '@codeinsight/types';
import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// DB row type — mirrors ci_qna_embeddings
// ---------------------------------------------------------------------------

interface QnaEmbeddingRow {
  repo_id: string;
  chunk_id: string;
  embedding?: string; // pgvector returns as '[0.1,0.2,...]'; not selected in search
  content: string;
  content_sha: string;
  layer: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// PgVectorStore
// ---------------------------------------------------------------------------

/**
 * VectorStore implementation backed by PostgreSQL + pgvector.
 * Reads/writes to `ci_qna_embeddings`.
 */
export class PgVectorStore implements VectorStore {
  constructor(
    private readonly knex: Knex,
    private readonly logger?: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // upsert
  // -------------------------------------------------------------------------

  async upsert(chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // Batch inserts to stay within Postgres parameter limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const rows = batch.map(c => ({
        repo_id: c.repoId,
        chunk_id: c.chunkId,
        embedding: `[${(c.embedding ?? []).join(',')}]`,
        content: c.content,
        content_sha: c.contentSha,
        layer: c.layer,
        metadata: c.metadata ? JSON.stringify(c.metadata) : null,
      }));

      await this.knex('ci_qna_embeddings')
        .insert(rows)
        .onConflict(['repo_id', 'chunk_id'])
        .merge([
          'embedding',
          'content',
          'content_sha',
          'layer',
          'metadata',
        ]);
    }

    this.logger?.debug('PgVectorStore.upsert', { count: chunks.length });
  }

  // -------------------------------------------------------------------------
  // search — cosine similarity via pgvector
  // -------------------------------------------------------------------------

  async search(
    embedding: number[],
    filter: VectorFilter,
    topK: number,
  ): Promise<VectorChunk[]> {
    const embeddingLiteral = `[${embedding.join(',')}]`;

    let query = this.knex<QnaEmbeddingRow>('ci_qna_embeddings')
      .where('repo_id', filter.repoId)
      .select(
        'repo_id',
        'chunk_id',
        'content',
        'content_sha',
        'layer',
        'metadata',
      )
      // Use pgvector cosine distance operator (<=>)
      .orderByRaw(`embedding <=> ?::vector`, [embeddingLiteral])
      .limit(topK);

    if (filter.layers && filter.layers.length > 0) {
      query = query.whereIn('layer', filter.layers);
    }

    if (filter.filePaths && filter.filePaths.length > 0) {
      query = query.whereRaw(
        `metadata->>'filePath' = ANY(?)`,
        [filter.filePaths],
      );
    }

    const rows = await query;

    return rows.map(row => this.rowToVectorChunk(row));
  }

  // -------------------------------------------------------------------------
  // listChunks — for delta detection
  // -------------------------------------------------------------------------

  async listChunks(
    repoId: string,
  ): Promise<Array<{ chunkId: string; contentSha: string }>> {
    const rows = await this.knex('ci_qna_embeddings')
      .where('repo_id', repoId)
      .select('chunk_id', 'content_sha');

    return rows.map((r: { chunk_id: string; content_sha: string }) => ({
      chunkId: r.chunk_id,
      contentSha: r.content_sha,
    }));
  }

  // -------------------------------------------------------------------------
  // deleteChunks
  // -------------------------------------------------------------------------

  async deleteChunks(repoId: string, chunkIds: string[]): Promise<void> {
    if (chunkIds.length === 0) return;

    // Batch deletes to avoid large IN clauses
    const BATCH_SIZE = 500;
    for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
      const batch = chunkIds.slice(i, i + BATCH_SIZE);
      await this.knex('ci_qna_embeddings')
        .where('repo_id', repoId)
        .whereIn('chunk_id', batch)
        .delete();
    }

    this.logger?.debug('PgVectorStore.deleteChunks', {
      repoId,
      count: chunkIds.length,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private rowToVectorChunk(row: QnaEmbeddingRow): VectorChunk {
    return {
      chunkId: row.chunk_id,
      repoId: row.repo_id,
      content: row.content,
      contentSha: row.content_sha,
      layer: row.layer,
      metadata: row.metadata ?? undefined,
      // embedding not returned from search (large; not needed by callers)
    };
  }
}

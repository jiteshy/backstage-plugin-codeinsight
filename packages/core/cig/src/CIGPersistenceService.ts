import type { Logger, StorageAdapter } from '@codeinsight/types';

import type { CIGBuildResult } from './types';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PersistOptions {
  /** File paths that were re-extracted in a delta run. */
  changedFiles?: string[];
}

// ---------------------------------------------------------------------------
// CIGPersistenceService
// ---------------------------------------------------------------------------

/**
 * Persists CIG build results to storage via the StorageAdapter.
 *
 * Full run:  upsert all extracted nodes and edges.
 * Delta run: delete existing CIG data for changed files, then upsert.
 *
 * **Delta invariant**: in delta mode, `result` must contain only nodes and
 * edges extracted from the changed files. The caller (ingestion pipeline) is
 * responsible for running CIGBuilder on changed files only and passing that
 * scoped result here. Unchanged-file CIG data is preserved in the DB.
 */
export class CIGPersistenceService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly logger?: Logger,
  ) {}

  /**
   * Persist a CIG build result.
   *
   * @param repoId  - Repository identifier.
   * @param result  - Output from CIGBuilder.build(). In delta mode, should
   *                  contain only nodes/edges from the changed files.
   * @param opts    - If `changedFiles` is provided, runs delta mode:
   *                  deletes existing CIG for those files before upserting.
   */
  async persist(
    repoId: string,
    result: CIGBuildResult,
    opts?: PersistOptions,
  ): Promise<{ nodesAttempted: number; edgesAttempted: number }> {
    const changedFiles = opts?.changedFiles;
    const isDelta = (changedFiles?.length ?? 0) > 0;

    // --- Delta: remove stale CIG data for changed files ---
    if (isDelta) {
      this.logger?.info(
        `CIG delta persist: deleting CIG for ${changedFiles!.length} changed files`,
      );
      await this.storage.deleteCIGForFiles(repoId, changedFiles!);
    }

    // --- Upsert nodes ---
    if (result.nodes.length > 0) {
      this.logger?.info(
        `CIG persist: upserting ${result.nodes.length} nodes`,
      );
      await this.storage.upsertCIGNodes(result.nodes);
    }

    // --- Upsert edges ---
    if (result.edges.length > 0) {
      this.logger?.info(
        `CIG persist: upserting ${result.edges.length} edges`,
      );
      await this.storage.upsertCIGEdges(result.edges);
    }

    this.logger?.info(
      `CIG persist complete: ${result.nodes.length} nodes, ${result.edges.length} edges` +
      (isDelta ? ` (delta: ${changedFiles!.length} files changed)` : ' (full run)'),
    );

    return {
      nodesAttempted: result.nodes.length,
      edgesAttempted: result.edges.length,
    };
  }
}

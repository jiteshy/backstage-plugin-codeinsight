import type { Logger, StorageAdapter } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// StalenessService — 2.6
// ---------------------------------------------------------------------------

/**
 * Sweeps ci_artifact_inputs after a CIG rebuild and marks affected artifacts
 * as stale so the next doc generation pass will regenerate them.
 *
 * Flow:
 *   1. Query ci_artifact_inputs for artifacts whose input files are in changedFiles
 *   2. Mark those artifacts is_stale=true, stale_reason='file_changed'
 *   3. Walk ci_artifact_dependencies → cascade stale marking (reason='dependency_stale')
 *   4. Repeat until the cascade frontier is empty (fixed-point)
 *
 * Returns the complete set of artifact IDs that were marked stale.
 */
export class StalenessService {
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly logger?: Logger,
  ) {}

  async sweep(repoId: string, changedFiles: string[]): Promise<string[]> {
    if (changedFiles.length === 0) {
      this.logger?.info('StalenessService: no changed files, skipping sweep', {
        repoId,
      });
      return [];
    }

    this.logger?.info('StalenessService: sweeping for stale artifacts', {
      repoId,
      changedFiles: changedFiles.length,
    });

    // 1. Find artifacts that directly reference one or more changed files
    const directlyStaleIds = await this.storageAdapter.getArtifactIdsByFilePaths(
      repoId,
      changedFiles,
    );

    if (directlyStaleIds.length === 0) {
      this.logger?.info(
        'StalenessService: no artifacts depend on changed files',
        { repoId },
      );
      return [];
    }

    // 2. Mark directly stale
    await this.storageAdapter.markArtifactsStale(
      repoId,
      directlyStaleIds,
      'file_changed',
    );
    this.logger?.info('StalenessService: marked artifacts stale (file_changed)', {
      repoId,
      count: directlyStaleIds.length,
    });

    // 3. Cascade via artifact dependency graph
    const allStaleIds = new Set<string>(directlyStaleIds);
    let frontier = directlyStaleIds;

    while (frontier.length > 0) {
      const dependents = await this.storageAdapter.getArtifactDependents(
        repoId,
        frontier,
      );
      const newlyStale = dependents.filter(id => !allStaleIds.has(id));
      if (newlyStale.length === 0) break;

      await this.storageAdapter.markArtifactsStale(
        repoId,
        newlyStale,
        'dependency_stale',
      );
      this.logger?.info(
        'StalenessService: cascade stale (dependency_stale)',
        { repoId, count: newlyStale.length },
      );

      newlyStale.forEach(id => allStaleIds.add(id));
      frontier = newlyStale;
    }

    this.logger?.info('StalenessService: sweep complete', {
      repoId,
      totalStale: allStaleIds.size,
    });

    return Array.from(allStaleIds);
  }
}

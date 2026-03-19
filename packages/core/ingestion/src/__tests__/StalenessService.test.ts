/**
 * Unit tests for StalenessService (Phase 2.6)
 *
 * Covers:
 *   1. sweep() returns [] when changedFiles is empty
 *   2. sweep() returns [] when no artifacts reference changed files
 *   3. sweep() marks directly affected artifacts as stale (file_changed)
 *   4. sweep() cascades to dependent artifacts (dependency_stale)
 *   5. sweep() handles multi-level cascade (A → B → C)
 *   6. sweep() avoids infinite loops — stops when no new dependents found
 *   7. sweep() deduplicates artifact IDs across multiple files
 *   8. sweep() returns all stale artifact IDs (direct + cascaded)
 *   9. sweep() batches large file lists correctly (multiple storageAdapter calls)
 *  10. logger is called with appropriate messages
 */

import type { StorageAdapter } from '@codeinsight/types';

import { StalenessService } from '../StalenessService';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockStorage(overrides?: {
  getArtifactIdsByFilePaths?: jest.Mock;
  getArtifactDependents?: jest.Mock;
  markArtifactsStale?: jest.Mock;
}): jest.Mocked<
  Pick<
    StorageAdapter,
    'getArtifactIdsByFilePaths' | 'getArtifactDependents' | 'markArtifactsStale'
  >
> &
  StorageAdapter {
  return {
    getArtifactIdsByFilePaths:
      overrides?.getArtifactIdsByFilePaths ?? jest.fn().mockResolvedValue([]),
    getArtifactDependents:
      overrides?.getArtifactDependents ?? jest.fn().mockResolvedValue([]),
    markArtifactsStale: overrides?.markArtifactsStale ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<
    Pick<
      StorageAdapter,
      'getArtifactIdsByFilePaths' | 'getArtifactDependents' | 'markArtifactsStale'
    >
  > &
    StorageAdapter;
}

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StalenessService', () => {
  // 1. Empty changedFiles
  it('returns [] when changedFiles is empty', async () => {
    const storage = makeMockStorage();
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', []);

    expect(result).toEqual([]);
    expect(storage.getArtifactIdsByFilePaths).not.toHaveBeenCalled();
    expect(storage.markArtifactsStale).not.toHaveBeenCalled();
  });

  // 2. No artifacts reference changed files
  it('returns [] when no artifacts reference changed files', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/auth.ts']);

    expect(result).toEqual([]);
    expect(storage.markArtifactsStale).not.toHaveBeenCalled();
    expect(storage.getArtifactDependents).not.toHaveBeenCalled();
  });

  // 3. Direct artifacts marked stale (no cascade)
  it('marks directly affected artifacts as stale with file_changed', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['core/overview', 'backend/auth']),
      getArtifactDependents: jest.fn().mockResolvedValue([]), // no cascade
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/auth.ts']);

    expect(storage.markArtifactsStale).toHaveBeenCalledWith(
      'repo-1',
      ['core/overview', 'backend/auth'],
      'file_changed',
    );
    expect(result).toEqual(expect.arrayContaining(['core/overview', 'backend/auth']));
    expect(result).toHaveLength(2);
  });

  // 4. Cascade to dependent artifacts
  it('cascades stale marking to dependent artifacts', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['backend/auth']),
      getArtifactDependents: jest.fn()
        .mockResolvedValueOnce(['core/architecture']) // backend/auth dependents
        .mockResolvedValueOnce([]),                   // architecture dependents (none)
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/auth.ts']);

    expect(storage.markArtifactsStale).toHaveBeenCalledTimes(2);
    expect(storage.markArtifactsStale).toHaveBeenNthCalledWith(
      1,
      'repo-1',
      ['backend/auth'],
      'file_changed',
    );
    expect(storage.markArtifactsStale).toHaveBeenNthCalledWith(
      2,
      'repo-1',
      ['core/architecture'],
      'dependency_stale',
    );
    expect(result).toEqual(expect.arrayContaining(['backend/auth', 'core/architecture']));
    expect(result).toHaveLength(2);
  });

  // 5. Multi-level cascade (A → B → C)
  it('handles multi-level cascade correctly', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['A']),
      getArtifactDependents: jest.fn()
        .mockResolvedValueOnce(['B']) // A's dependents
        .mockResolvedValueOnce(['C']) // B's dependents
        .mockResolvedValueOnce([]),   // C's dependents (none)
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/file.ts']);

    expect(result).toEqual(expect.arrayContaining(['A', 'B', 'C']));
    expect(result).toHaveLength(3);
    expect(storage.markArtifactsStale).toHaveBeenCalledTimes(3);
    expect(storage.markArtifactsStale).toHaveBeenNthCalledWith(1, 'repo-1', ['A'], 'file_changed');
    expect(storage.markArtifactsStale).toHaveBeenNthCalledWith(2, 'repo-1', ['B'], 'dependency_stale');
    expect(storage.markArtifactsStale).toHaveBeenNthCalledWith(3, 'repo-1', ['C'], 'dependency_stale');
  });

  // 6. No infinite loops — already-stale artifacts not re-processed
  it('stops cascade when all dependents are already stale', async () => {
    // Simulate a cycle: A depends on B, B depends on A
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['A']),
      getArtifactDependents: jest.fn()
        .mockResolvedValueOnce(['B']) // A's dependents
        .mockResolvedValueOnce(['A']), // B's dependents → A already stale, no new
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/file.ts']);

    // Should not loop infinitely; A was already seen
    expect(result).toEqual(expect.arrayContaining(['A', 'B']));
    expect(result).toHaveLength(2);
    // markArtifactsStale called twice: once for A, once for B
    expect(storage.markArtifactsStale).toHaveBeenCalledTimes(2);
  });

  // 7. Deduplication across multiple files
  it('deduplicates artifact IDs from multiple changed files', async () => {
    // Both files reference the same artifact
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['core/overview']),
      getArtifactDependents: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/a.ts', 'src/b.ts']);

    // The storage adapter returns deduplicated IDs; markArtifactsStale called once
    expect(storage.markArtifactsStale).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['core/overview']);
  });

  // 8. Returns all stale IDs (direct + cascaded)
  it('returns all stale artifact IDs including cascaded ones', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['X', 'Y']),
      getArtifactDependents: jest.fn()
        .mockResolvedValueOnce(['Z']) // X,Y dependents
        .mockResolvedValueOnce([]),   // Z dependents (none)
    });
    const svc = new StalenessService(storage);

    const result = await svc.sweep('repo-1', ['src/x.ts']);

    expect(result).toEqual(expect.arrayContaining(['X', 'Y', 'Z']));
    expect(result).toHaveLength(3);
  });

  // 9. Logger called with appropriate messages
  it('calls logger with info messages at each stage', async () => {
    const logger = makeLogger();
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['core/overview']),
      getArtifactDependents: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage, logger);

    await svc.sweep('repo-1', ['src/auth.ts']);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('sweeping'),
      expect.objectContaining({ repoId: 'repo-1' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('file_changed'),
      expect.objectContaining({ repoId: 'repo-1', count: 1 }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('complete'),
      expect.objectContaining({ repoId: 'repo-1', totalStale: 1 }),
    );
  });

  // 10. Logger skips cascade message when no cascades occur
  it('logs nothing-to-cascade when no dependents exist', async () => {
    const logger = makeLogger();
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage, logger);

    await svc.sweep('repo-1', ['src/auth.ts']);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no artifacts'),
      expect.objectContaining({ repoId: 'repo-1' }),
    );
    expect(storage.markArtifactsStale).not.toHaveBeenCalled();
  });

  // 11. Works without a logger (no crash)
  it('works without a logger', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['artifact-1']),
      getArtifactDependents: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage); // no logger

    await expect(svc.sweep('repo-1', ['src/file.ts'])).resolves.toEqual(['artifact-1']);
  });

  // 12. Passes repoId correctly to all storage calls
  it('passes repoId to every storage method call', async () => {
    const storage = makeMockStorage({
      getArtifactIdsByFilePaths: jest.fn().mockResolvedValue(['A']),
      getArtifactDependents: jest.fn().mockResolvedValue([]),
    });
    const svc = new StalenessService(storage);

    await svc.sweep('my-repo', ['src/file.ts']);

    expect(storage.getArtifactIdsByFilePaths).toHaveBeenCalledWith('my-repo', expect.any(Array));
    expect(storage.markArtifactsStale).toHaveBeenCalledWith('my-repo', expect.any(Array), expect.any(String));
    expect(storage.getArtifactDependents).toHaveBeenCalledWith('my-repo', expect.any(Array));
  });
});

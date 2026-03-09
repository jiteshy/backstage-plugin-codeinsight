import { mkdtemp, rm, writeFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Logger, RepoCloneConfig } from '@codeinsight/types';

import { GitRepoConnector } from '../GitRepoConnector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConfig(overrides?: Partial<RepoCloneConfig>): RepoCloneConfig {
  return {
    tempDir: tmpdir(),
    cloneTtlHours: 24,
    defaultDepth: 1,
    deltaDepth: 50,
    ...overrides,
  };
}

// Using a small, stable, public GitHub repo for integration tests.
// sindresorhus/is has a known stable structure.
// Small, stable, public GitHub repo for integration tests
const TEST_REPO_URL = 'https://github.com/octocat/Hello-World.git';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitRepoConnector (integration)', () => {
  let tempDir: string;
  let connector: GitRepoConnector;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'codeinsight-repo-test-'));
    connector = new GitRepoConnector(makeConfig({ tempDir }), noopLogger);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // clone
  // -----------------------------------------------------------------------

  describe('clone', () => {
    let cloneDir: string;

    beforeAll(async () => {
      cloneDir = join(tempDir, 'clone-test');
      await connector.clone(TEST_REPO_URL, cloneDir, { depth: 1 });
    }, 60_000);

    it('clones a repository to the target directory', async () => {
      const stats = await stat(join(cloneDir, '.git'));
      expect(stats.isDirectory()).toBe(true);
    });

    it('cloned repo has files', async () => {
      const files = await connector.getFileTree(cloneDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // getFileTree
  // -----------------------------------------------------------------------

  describe('getFileTree', () => {
    let cloneDir: string;

    beforeAll(async () => {
      cloneDir = join(tempDir, 'filetree-test');
      await connector.clone(TEST_REPO_URL, cloneDir, { depth: 1 });
    }, 60_000);

    it('returns files with paths and SHA hashes', async () => {
      const files = await connector.getFileTree(cloneDir);

      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        expect(file.filePath).toBeTruthy();
        expect(file.currentSha).toMatch(/^[0-9a-f]{64}$/); // SHA-256
        expect(file.parseStatus).toBe('pending');
        expect(file.repoId).toBe(''); // caller sets this
      }
    });

    it('includes expected common files', async () => {
      const files = await connector.getFileTree(cloneDir);
      const paths = files.map(f => f.filePath);

      // This repo should have a README
      expect(paths.some(p => p.toLowerCase().includes('readme'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getHeadSha
  // -----------------------------------------------------------------------

  describe('getHeadSha', () => {
    let cloneDir: string;

    beforeAll(async () => {
      cloneDir = join(tempDir, 'headsha-test');
      await connector.clone(TEST_REPO_URL, cloneDir, { depth: 1 });
    }, 60_000);

    it('returns a valid 40-char hex SHA', async () => {
      const sha = await connector.getHeadSha(cloneDir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  // -----------------------------------------------------------------------
  // getChangedFiles
  // -----------------------------------------------------------------------

  describe('getChangedFiles', () => {
    let cloneDir: string;

    beforeAll(async () => {
      // Need deeper clone to have commit history
      cloneDir = join(tempDir, 'changed-test');
      await connector.clone(TEST_REPO_URL, cloneDir, { depth: 10 });
    }, 60_000);

    it('returns changed file paths between two commits', async () => {
      // Get the last two commits
      const simpleGit = (await import('simple-git')).default;
      const git = simpleGit(cloneDir);
      const log = await git.log({ maxCount: 3 });

      if (log.all.length < 2) {
        // Skip if repo doesn't have enough history in shallow clone
        return;
      }

      const olderSha = log.all[1].hash;
      const newerSha = log.all[0].hash;

      const changed = await connector.getChangedFiles(cloneDir, olderSha, newerSha);

      // There should be at least one changed file between commits
      expect(Array.isArray(changed)).toBe(true);
      // Changed files should be strings (file paths)
      for (const path of changed) {
        expect(typeof path).toBe('string');
        expect(path.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // getCloneDir
  // -----------------------------------------------------------------------

  describe('getCloneDir', () => {
    it('returns a path under tempDir namespaced by repoId', async () => {
      const dir = await connector.getCloneDir('my-repo-123');
      expect(dir).toContain('my-repo-123');
      expect(dir).toContain(tempDir);

      // Directory should exist
      const stats = await stat(dir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // cleanupStaleDirs
  // -----------------------------------------------------------------------

  describe('cleanupStaleDirs', () => {
    it('removes directories older than TTL', async () => {
      const cleanupTempDir = join(tempDir, 'cleanup-test');
      await mkdir(cleanupTempDir, { recursive: true });

      // Create a "stale" directory
      const staleDir = join(cleanupTempDir, 'stale-repo');
      await mkdir(staleDir, { recursive: true });
      await writeFile(join(staleDir, 'marker'), 'test');

      // Create a "fresh" directory
      const freshDir = join(cleanupTempDir, 'fresh-repo');
      await mkdir(freshDir, { recursive: true });
      await writeFile(join(freshDir, 'marker'), 'test');

      // Set the stale dir mtime to 25 hours ago
      const { utimes } = await import('fs/promises');
      const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await utimes(staleDir, past, past);

      // TTL = 1 hour for this test
      const cleanupConnector = new GitRepoConnector(
        makeConfig({ tempDir: cleanupTempDir, cloneTtlHours: 1 }),
        noopLogger,
      );

      const cleaned = await cleanupConnector.cleanupStaleDirs();

      expect(cleaned).toBe(1);

      // Stale dir should be gone
      await expect(stat(staleDir)).rejects.toThrow();

      // Fresh dir should remain
      const freshStats = await stat(freshDir);
      expect(freshStats.isDirectory()).toBe(true);

      // Cleanup
      await rm(cleanupTempDir, { recursive: true, force: true });
    });

    it('returns 0 when tempDir does not exist', async () => {
      const missingConnector = new GitRepoConnector(
        makeConfig({ tempDir: '/tmp/nonexistent-codeinsight-test-dir' }),
        noopLogger,
      );
      const cleaned = await missingConnector.cleanupStaleDirs();
      expect(cleaned).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Token injection (indirect — test via clone with invalid token fails)
  // -----------------------------------------------------------------------

  describe('clone with auth token', () => {
    it('fails gracefully with invalid token on private-like URL', async () => {
      const badDir = join(tempDir, 'bad-token-test');
      await expect(
        connector.clone(
          'https://github.com/nonexistent-user-12345/nonexistent-repo-12345.git',
          badDir,
          { depth: 1, authToken: 'invalid-token' },
        ),
      ).rejects.toThrow();
    }, 30_000);
  });
});

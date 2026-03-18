import { createHash } from 'crypto';
import { readFile, readdir, stat, rm, mkdir } from 'fs/promises';
import { join, resolve } from 'path';

import type {
  CloneOptions,
  Logger,
  RepoCloneConfig,
  RepoConnector,
  RepoFile,
} from '@codeinsight/types';
import simpleGit from 'simple-git';

/**
 * Git-based RepoConnector using simple-git.
 * Phase 1: GitHub only (HTTPS + token auth). GitLab/Bitbucket deferred.
 */
export class GitRepoConnector implements RepoConnector {
  private readonly config: RepoCloneConfig;
  private readonly logger: Logger;

  constructor(config: RepoCloneConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async clone(url: string, targetDir: string, opts?: CloneOptions): Promise<void> {
    const depth = opts?.depth ?? this.config.defaultDepth;
    const authToken = opts?.authToken ?? this.config.authToken;
    const cloneUrl = authToken ? this.injectToken(url, authToken) : url;

    const cloneArgs: string[] = [];
    if (depth > 0) {
      cloneArgs.push('--depth', String(depth));
    }
    if (opts?.branch) {
      cloneArgs.push('--branch', opts.branch);
    }
    // --single-branch by default for shallow clones
    if (depth > 0) {
      cloneArgs.push('--single-branch');
    }

    this.logger.info('Cloning repository', { url: this.redactUrl(url), targetDir, depth });

    const git = simpleGit();
    await git.clone(cloneUrl, targetDir, cloneArgs);

    this.logger.info('Clone completed', { targetDir });
  }

  async getFileTree(dir: string): Promise<RepoFile[]> {
    const git = simpleGit(dir);

    // git ls-files returns all tracked files respecting .gitignore
    const result = await git.raw(['ls-files', '-z']);
    const filePaths = result
      .split('\0')
      .map(p => p.trim())
      .filter(Boolean);

    this.logger.info('File tree retrieved', { dir, fileCount: filePaths.length });

    const files: RepoFile[] = [];
    for (const filePath of filePaths) {
      const absPath = join(dir, filePath);
      const content = await readFile(absPath);
      const sha = createHash('sha256').update(content).digest('hex');

      files.push({
        repoId: '', // caller sets repoId after retrieval
        filePath,
        currentSha: sha,
        lastProcessedSha: null,
        fileType: 'source', // caller classifies via file filter
        language: null,
        parseStatus: 'pending',
      });
    }

    return files;
  }

  async getHeadSha(dir: string): Promise<string> {
    const git = simpleGit(dir);
    const sha = await git.revparse(['HEAD']);
    return sha.trim();
  }

  async getChangedFiles(dir: string, fromSha: string, toSha: string): Promise<string[]> {
    const git = simpleGit(dir);
    const result = await git.diff(['--name-only', fromSha, toSha]);
    return result
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Clone directory management
  // ---------------------------------------------------------------------------

  /**
   * Returns a deterministic temp directory path for a given repoId.
   * Creates the directory if it doesn't exist.
   */
  async getCloneDir(repoId: string): Promise<string> {
    const dir = resolve(this.config.tempDir, repoId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Cleans up clone directories older than the configured TTL.
   * Scans all directories under tempDir and removes those modified
   * longer ago than cloneTtlHours.
   */
  async cleanupStaleDirs(): Promise<number> {
    const ttlMs = this.config.cloneTtlHours * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    let entries: string[];
    try {
      entries = await readdir(this.config.tempDir);
    } catch {
      // tempDir doesn't exist yet — nothing to clean
      return 0;
    }

    for (const entry of entries) {
      const entryPath = join(this.config.tempDir, entry);
      try {
        const stats = await stat(entryPath);
        if (stats.isDirectory() && now - stats.mtimeMs > ttlMs) {
          this.logger.info('Removing stale clone directory', { path: entryPath });
          await rm(entryPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch (err) {
        this.logger.warn('Failed to clean up directory', {
          path: entryPath,
          error: String(err),
        });
      }
    }

    if (cleaned > 0) {
      this.logger.info('Stale clone cleanup complete', { removed: cleaned });
    }

    return cleaned;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Injects an auth token into an HTTPS Git URL.
   * e.g. https://github.com/foo/bar.git → https://x-access-token:{token}@github.com/foo/bar.git
   */
  private injectToken(url: string, token: string): string {
    try {
      const parsed = new URL(url);
      parsed.username = 'x-access-token';
      parsed.password = token;
      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is (SSH URLs, etc.)
      return url;
    }
  }

  /**
   * Redacts tokens from URLs for safe logging.
   */
  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

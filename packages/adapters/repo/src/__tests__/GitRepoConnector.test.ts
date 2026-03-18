/**
 * Unit tests for GitRepoConnector (Phase 1.8 change)
 *
 * Covers the default-token fallback introduced in Phase 1.8:
 *   clone() should use this.config.authToken when no per-call token is supplied.
 *
 * simple-git is mocked so no real filesystem or network I/O occurs.
 */

import type { Logger, RepoCloneConfig } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Mock simple-git
// ---------------------------------------------------------------------------

const mockGitClone = jest.fn().mockResolvedValue(undefined);
const mockGitInstance = { clone: mockGitClone };

jest.mock('simple-git', () => jest.fn(() => mockGitInstance));

import { GitRepoConnector } from '../GitRepoConnector';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeConfig(overrides?: Partial<RepoCloneConfig>): RepoCloneConfig {
  return {
    tempDir: '/tmp/repo-test',
    cloneTtlHours: 24,
    defaultDepth: 1,
    deltaDepth: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitRepoConnector — clone token resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('injects the config-level authToken when no per-call token is provided', async () => {
    const config = makeConfig({ authToken: 'config-level-token' });
    const connector = new GitRepoConnector(config, noopLogger);

    await connector.clone('https://github.com/org/repo.git', '/tmp/target');

    // The URL passed to git.clone should have the config token embedded
    const cloneUrl: string = mockGitClone.mock.calls[0][0];
    expect(cloneUrl).toContain('config-level-token');
  });

  it('uses the per-call authToken when supplied, ignoring the config token', async () => {
    const config = makeConfig({ authToken: 'config-level-token' });
    const connector = new GitRepoConnector(config, noopLogger);

    await connector.clone('https://github.com/org/repo.git', '/tmp/target', {
      authToken: 'per-call-token',
    });

    const cloneUrl: string = mockGitClone.mock.calls[0][0];
    expect(cloneUrl).toContain('per-call-token');
    expect(cloneUrl).not.toContain('config-level-token');
  });

  it('clones without token injection when neither config nor per-call token is set', async () => {
    const config = makeConfig(); // no authToken field
    const connector = new GitRepoConnector(config, noopLogger);

    const url = 'https://github.com/org/public-repo.git';
    await connector.clone(url, '/tmp/target');

    const cloneUrl: string = mockGitClone.mock.calls[0][0];
    // URL should not have x-access-token injected
    expect(cloneUrl).toBe(url);
  });

  it('passes depth and --single-branch args for shallow clones', async () => {
    const connector = new GitRepoConnector(makeConfig({ defaultDepth: 1 }), noopLogger);

    await connector.clone('https://github.com/org/repo.git', '/tmp/target');

    const cloneArgs: string[] = mockGitClone.mock.calls[0][2];
    expect(cloneArgs).toContain('--depth');
    expect(cloneArgs).toContain('1');
    expect(cloneArgs).toContain('--single-branch');
  });

  it('passes --branch arg when opts.branch is specified', async () => {
    const connector = new GitRepoConnector(makeConfig(), noopLogger);

    await connector.clone('https://github.com/org/repo.git', '/tmp/target', {
      branch: 'feature/xyz',
    });

    const cloneArgs: string[] = mockGitClone.mock.calls[0][2];
    expect(cloneArgs).toContain('--branch');
    expect(cloneArgs).toContain('feature/xyz');
  });
});

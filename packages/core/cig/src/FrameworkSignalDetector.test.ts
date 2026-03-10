import { FrameworkSignalDetector } from './FrameworkSignalDetector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePkgJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'test-app',
    version: '1.0.0',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrameworkSignalDetector', () => {
  let detector: FrameworkSignalDetector;

  beforeEach(() => {
    detector = new FrameworkSignalDetector();
  });

  // -------------------------------------------------------------------------
  // Empty / invalid input
  // -------------------------------------------------------------------------

  it('returns empty signals for empty input array', () => {
    const result = detector.detect([]);
    expect(result.frameworks).toEqual([]);
    expect(result.orms).toEqual([]);
    expect(result.testFrameworks).toEqual([]);
    expect(result.authLibraries).toEqual([]);
    expect(result.buildTools).toEqual([]);
    expect(result.packageMeta).toBeNull();
  });

  it('returns empty signals for invalid JSON', () => {
    const result = detector.detect(['not json', '{invalid}']);
    expect(result.packageMeta).toBeNull();
  });

  it('returns empty signals for non-object JSON (array)', () => {
    const result = detector.detect(['[1, 2, 3]']);
    expect(result.packageMeta).toBeNull();
  });

  it('returns empty signals for JSON null', () => {
    const result = detector.detect(['null']);
    expect(result.packageMeta).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Framework detection
  // -------------------------------------------------------------------------

  it('detects React in dependencies', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } }),
    ]);

    expect(result.frameworks).toHaveLength(2);
    expect(result.frameworks[0]).toEqual({
      name: 'react',
      version: '^18.2.0',
      isDev: false,
      category: 'react',
    });
    expect(result.frameworks[1]).toEqual({
      name: 'react-dom',
      version: '^18.2.0',
      isDev: false,
      category: 'react',
    });
  });

  it('detects Express', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { express: '^4.18.0' } }),
    ]);

    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].category).toBe('express');
  });

  it('detects Next.js', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { next: '^14.0.0', react: '^18.0.0' } }),
    ]);

    const categories = result.frameworks.map(f => f.category);
    expect(categories).toContain('next');
    expect(categories).toContain('react');
  });

  it('detects NestJS via scoped packages', () => {
    const result = detector.detect([
      makePkgJson({
        dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
      }),
    ]);

    expect(result.frameworks).toHaveLength(2);
    expect(result.frameworks.every(f => f.category === 'nestjs')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ORM detection
  // -------------------------------------------------------------------------

  it('detects Prisma', () => {
    const result = detector.detect([
      makePkgJson({
        dependencies: { '@prisma/client': '^5.0.0' },
        devDependencies: { prisma: '^5.0.0' },
      }),
    ]);

    expect(result.orms).toHaveLength(2);
    expect(result.orms.map(o => o.name)).toContain('@prisma/client');
    expect(result.orms.map(o => o.name)).toContain('prisma');
  });

  it('detects TypeORM', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { typeorm: '^0.3.0', pg: '^8.0.0' } }),
    ]);

    expect(result.orms).toHaveLength(2);
    expect(result.orms.map(o => o.category)).toContain('typeorm');
    expect(result.orms.map(o => o.category)).toContain('pg');
  });

  // -------------------------------------------------------------------------
  // Test framework detection
  // -------------------------------------------------------------------------

  it('detects Jest in devDependencies', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { jest: '^29.0.0' } }),
    ]);

    expect(result.testFrameworks).toHaveLength(1);
    expect(result.testFrameworks[0]).toEqual({
      name: 'jest',
      version: '^29.0.0',
      isDev: true,
      category: 'jest',
    });
  });

  it('detects Vitest', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { vitest: '^1.0.0' } }),
    ]);

    expect(result.testFrameworks[0].category).toBe('vitest');
  });

  it('detects Playwright', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { '@playwright/test': '^1.40.0' } }),
    ]);

    expect(result.testFrameworks[0].category).toBe('playwright');
  });

  // -------------------------------------------------------------------------
  // Auth library detection
  // -------------------------------------------------------------------------

  it('detects Passport', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { passport: '^0.7.0', 'express-session': '^1.17.0' } }),
    ]);

    expect(result.authLibraries).toHaveLength(2);
    expect(result.authLibraries.map(a => a.category)).toContain('passport');
    expect(result.authLibraries.map(a => a.category)).toContain('express-session');
  });

  it('detects JWT libraries', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { jsonwebtoken: '^9.0.0' } }),
    ]);

    expect(result.authLibraries[0].category).toBe('jwt');
  });

  // -------------------------------------------------------------------------
  // Build tool detection
  // -------------------------------------------------------------------------

  it('detects Webpack', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { webpack: '^5.0.0' } }),
    ]);

    expect(result.buildTools).toHaveLength(1);
    expect(result.buildTools[0].category).toBe('webpack');
  });

  it('detects Vite', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { vite: '^5.0.0' } }),
    ]);

    expect(result.buildTools[0].category).toBe('vite');
  });

  // -------------------------------------------------------------------------
  // isDev flag
  // -------------------------------------------------------------------------

  it('marks dependencies as isDev: false', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { express: '^4.18.0' } }),
    ]);

    expect(result.frameworks[0].isDev).toBe(false);
  });

  it('marks devDependencies as isDev: true', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { jest: '^29.0.0' } }),
    ]);

    expect(result.testFrameworks[0].isDev).toBe(true);
  });

  it('marks peerDependencies as isDev: false', () => {
    const result = detector.detect([
      makePkgJson({ peerDependencies: { react: '>=18.0.0' } }),
    ]);

    expect(result.frameworks[0].isDev).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Deduplication: deps take precedence over devDeps/peerDeps
  // -------------------------------------------------------------------------

  it('deduplicates when same package is in deps and devDeps', () => {
    const result = detector.detect([
      makePkgJson({
        dependencies: { react: '^18.0.0' },
        devDependencies: { react: '^17.0.0' },
      }),
    ]);

    // Should only appear once, with the deps version (isDev: false)
    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].version).toBe('^18.0.0');
    expect(result.frameworks[0].isDev).toBe(false);
  });

  it('deduplicates when same package is in peerDeps and devDeps', () => {
    const result = detector.detect([
      makePkgJson({
        peerDependencies: { react: '>=18.0.0' },
        devDependencies: { react: '^18.2.0' },
      }),
    ]);

    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].isDev).toBe(false); // peerDeps wins
  });

  // -------------------------------------------------------------------------
  // PackageMeta
  // -------------------------------------------------------------------------

  it('extracts package metadata', () => {
    const result = detector.detect([
      makePkgJson({
        name: 'my-app',
        version: '2.0.0',
        main: './dist/index.js',
        scripts: { start: 'node dist/index.js', test: 'jest' },
      }),
    ]);

    expect(result.packageMeta).toEqual({
      name: 'my-app',
      version: '2.0.0',
      hasEntryPoint: true,
      hasStartScript: true,
      usesTypeScript: false,
    });
  });

  it('detects TypeScript usage', () => {
    const result = detector.detect([
      makePkgJson({ devDependencies: { typescript: '^5.0.0' } }),
    ]);

    expect(result.packageMeta?.usesTypeScript).toBe(true);
  });

  it('detects module entry point', () => {
    const result = detector.detect([
      makePkgJson({ module: './dist/index.mjs' }),
    ]);

    expect(result.packageMeta?.hasEntryPoint).toBe(true);
  });

  it('reports no entry point or start script when absent', () => {
    const result = detector.detect([makePkgJson()]);

    expect(result.packageMeta?.hasEntryPoint).toBe(false);
    expect(result.packageMeta?.hasStartScript).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Multi-file merging
  // -------------------------------------------------------------------------

  it('merges dependencies from multiple package.json files', () => {
    const root = makePkgJson({
      name: 'root',
      dependencies: { express: '^4.18.0' },
      devDependencies: { jest: '^29.0.0' },
    });
    const sub = makePkgJson({
      name: 'sub-package',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    });

    const result = detector.detect([root, sub]);

    expect(result.frameworks.map(f => f.name)).toContain('express');
    expect(result.frameworks.map(f => f.name)).toContain('react');
    expect(result.testFrameworks.map(t => t.name)).toContain('jest');
    expect(result.testFrameworks.map(t => t.name)).toContain('vitest');
    // Meta comes from the first valid package.json
    expect(result.packageMeta?.name).toBe('root');
  });

  it('skips invalid JSON among valid ones', () => {
    const result = detector.detect([
      'not json',
      makePkgJson({ dependencies: { express: '^4.18.0' } }),
    ]);

    expect(result.frameworks).toHaveLength(1);
    expect(result.packageMeta).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Realistic scenario
  // -------------------------------------------------------------------------

  it('handles a typical full-stack Next.js project', () => {
    const result = detector.detect([
      makePkgJson({
        name: 'my-nextjs-app',
        version: '1.0.0',
        scripts: { start: 'next start', dev: 'next dev' },
        dependencies: {
          next: '^14.0.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
          '@prisma/client': '^5.0.0',
          'next-auth': '^4.24.0',
        },
        devDependencies: {
          typescript: '^5.3.0',
          prisma: '^5.0.0',
          jest: '^29.7.0',
          '@testing-library/react': '^14.0.0',
        },
      }),
    ]);

    // Frameworks
    expect(result.frameworks.map(f => f.category)).toEqual(
      expect.arrayContaining(['next', 'react']),
    );

    // ORMs
    expect(result.orms.map(o => o.category)).toEqual(
      expect.arrayContaining(['prisma']),
    );

    // Auth
    expect(result.authLibraries.map(a => a.category)).toContain('next-auth');

    // Test frameworks
    expect(result.testFrameworks.map(t => t.category)).toEqual(
      expect.arrayContaining(['jest', 'testing-library']),
    );

    // Meta
    expect(result.packageMeta?.usesTypeScript).toBe(true);
    expect(result.packageMeta?.hasStartScript).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('ignores non-string version values', () => {
    const result = detector.detect([
      JSON.stringify({
        name: 'test',
        dependencies: { react: 123, express: '^4.18.0' },
      }),
    ]);

    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].name).toBe('express');
  });

  it('returns empty arrays for package.json with no dependencies', () => {
    const result = detector.detect([makePkgJson({ scripts: { test: 'echo test' } })]);

    expect(result.frameworks).toEqual([]);
    expect(result.orms).toEqual([]);
    expect(result.testFrameworks).toEqual([]);
    expect(result.authLibraries).toEqual([]);
    expect(result.buildTools).toEqual([]);
    expect(result.packageMeta).not.toBeNull();
  });

  it('handles unknown dependencies gracefully', () => {
    const result = detector.detect([
      makePkgJson({ dependencies: { 'some-unknown-pkg': '^1.0.0', lodash: '^4.17.0' } }),
    ]);

    expect(result.frameworks).toEqual([]);
    expect(result.orms).toEqual([]);
  });

  it('last file wins for same package across multiple package.json files', () => {
    const first = makePkgJson({ dependencies: { express: '^4.18.0' } });
    const second = makePkgJson({ dependencies: { express: '^5.0.0' } });
    const result = detector.detect([first, second]);

    expect(result.frameworks).toHaveLength(1);
    expect(result.frameworks[0].version).toBe('^5.0.0');
  });

  it('handles completely empty package.json object', () => {
    const result = detector.detect(['{}']);

    expect(result.frameworks).toEqual([]);
    expect(result.packageMeta).toEqual({
      name: undefined,
      version: undefined,
      hasEntryPoint: false,
      hasStartScript: false,
      usesTypeScript: false,
    });
  });
});

import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { EntryPointDetector } from './EntryPointDetector';
import type { CIGBuildResult } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal synthetic CIGBuildResult for unit-level tests. */
function syntheticResult(opts: {
  files: string[];
  edges: Array<{ from: string; to: string }>;
}): CIGBuildResult {
  const nodes: CIGNode[] = opts.files.map(fp => ({
    nodeId: `repo:${fp}:<module>:variable`,
    repoId: 'repo',
    filePath: fp,
    symbolName: '<module>',
    symbolType: 'variable',
    startLine: 1,
    endLine: 1,
    exported: false,
    extractedSha: 'sha',
  }));

  const edges: CIGEdge[] = opts.edges.map(e => ({
    edgeId: `repo:${e.from}:<module>:variable->imports->repo:${e.to}:<module>:variable`,
    repoId: 'repo',
    fromNodeId: `repo:${e.from}:<module>:variable`,
    toNodeId: `repo:${e.to}:<module>:variable`,
    edgeType: 'imports',
  }));

  return {
    nodes,
    edges,
    filesProcessed: opts.files.length,
    filesSkipped: 0,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntryPointDetector', () => {
  describe('detect()', () => {
    it('returns empty array when there are no files', () => {
      const detector = new EntryPointDetector();
      const result: CIGBuildResult = {
        nodes: [],
        edges: [],
        filesProcessed: 0,
        filesSkipped: 0,
        errors: [],
      };
      expect(detector.detect(result)).toEqual([]);
    });

    it('detects a file with high fan-in', () => {
      // utils.ts is imported by a.ts, b.ts, c.ts, d.ts (fan-in = 4)
      const result = syntheticResult({
        files: ['src/utils.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        edges: [
          { from: 'src/a.ts', to: 'src/utils.ts' },
          { from: 'src/b.ts', to: 'src/utils.ts' },
          { from: 'src/c.ts', to: 'src/utils.ts' },
          { from: 'src/d.ts', to: 'src/utils.ts' },
        ],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      const utilsEp = eps.find(e => e.filePath === 'src/utils.ts');
      expect(utilsEp).toBeDefined();
      expect(utilsEp!.reasons).toContain('high-fan-in');
      expect(utilsEp!.reasons).toContain('low-fan-out');
      expect(utilsEp!.score).toBeGreaterThanOrEqual(4);
    });

    it('detects a file with zero importers (leaf entry)', () => {
      // main.ts imports utils.ts but nothing imports main.ts
      const result = syntheticResult({
        files: ['src/main.ts', 'src/utils.ts'],
        edges: [{ from: 'src/main.ts', to: 'src/utils.ts' }],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      const mainEp = eps.find(e => e.filePath === 'src/main.ts');
      expect(mainEp).toBeDefined();
      expect(mainEp!.reasons).toContain('zero-importers');
      expect(mainEp!.reasons).toContain('filename-match');
    });

    it('detects common entry-point filenames', () => {
      const result = syntheticResult({
        files: [
          'src/index.ts',
          'src/app.ts',
          'src/server.ts',
          'src/cli.ts',
          'src/helpers.ts',
        ],
        edges: [],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      const names = eps.map(e => e.filePath);
      expect(names).toContain('src/index.ts');
      expect(names).toContain('src/app.ts');
      expect(names).toContain('src/server.ts');
      expect(names).toContain('src/cli.ts');
      expect(names).not.toContain('src/helpers.ts');
    });

    it('does not flag high-fan-out files as entry points', () => {
      // app.ts imports 5 files — high fan-out, no fan-in
      const result = syntheticResult({
        files: ['src/app.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'],
        edges: [
          { from: 'src/app.ts', to: 'src/a.ts' },
          { from: 'src/app.ts', to: 'src/b.ts' },
          { from: 'src/app.ts', to: 'src/c.ts' },
          { from: 'src/app.ts', to: 'src/d.ts' },
          { from: 'src/app.ts', to: 'src/e.ts' },
        ],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      const appEp = eps.find(e => e.filePath === 'src/app.ts');
      // app.ts gets flagged for filename-match and zero-importers, not high-fan-in
      expect(appEp).toBeDefined();
      expect(appEp!.reasons).not.toContain('high-fan-in');
      expect(appEp!.reasons).toContain('zero-importers');
      expect(appEp!.reasons).toContain('filename-match');
      // Does NOT have low-fan-out (fan-out = 5 > maxFanOut=2)
      expect(appEp!.reasons).not.toContain('low-fan-out');
    });

    it('sorts results by score descending', () => {
      // types.ts has fan-in=5, utils.ts has fan-in=3
      const result = syntheticResult({
        files: [
          'src/types.ts',
          'src/utils.ts',
          'src/a.ts',
          'src/b.ts',
          'src/c.ts',
          'src/d.ts',
          'src/e.ts',
        ],
        edges: [
          { from: 'src/a.ts', to: 'src/types.ts' },
          { from: 'src/b.ts', to: 'src/types.ts' },
          { from: 'src/c.ts', to: 'src/types.ts' },
          { from: 'src/d.ts', to: 'src/types.ts' },
          { from: 'src/e.ts', to: 'src/types.ts' },
          { from: 'src/a.ts', to: 'src/utils.ts' },
          { from: 'src/b.ts', to: 'src/utils.ts' },
          { from: 'src/c.ts', to: 'src/utils.ts' },
        ],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      // types.ts should come first (higher fan-in score)
      expect(eps[0].filePath).toBe('src/types.ts');
      expect(eps[0].score).toBeGreaterThan(eps[1].score);
    });

    it('respects custom minFanIn and maxFanOut config', () => {
      const result = syntheticResult({
        files: ['src/utils.ts', 'src/a.ts', 'src/b.ts'],
        edges: [
          { from: 'src/a.ts', to: 'src/utils.ts' },
          { from: 'src/b.ts', to: 'src/utils.ts' },
        ],
      });

      // Default minFanIn=3, so fan-in=2 wouldn't trigger high-fan-in
      const defaultDetector = new EntryPointDetector();
      const defaultEps = defaultDetector.detect(result);
      const utilsDefault = defaultEps.find(e => e.filePath === 'src/utils.ts');
      expect(utilsDefault?.reasons).not.toContain('high-fan-in');

      // With minFanIn=2, it should trigger
      const customDetector = new EntryPointDetector({ minFanIn: 2 });
      const customEps = customDetector.detect(result);
      const utilsCustom = customEps.find(e => e.filePath === 'src/utils.ts');
      expect(utilsCustom).toBeDefined();
      expect(utilsCustom!.reasons).toContain('high-fan-in');
    });

    it('supports extra entry-point names via config', () => {
      const result = syntheticResult({
        files: ['src/worker.ts'],
        edges: [],
      });

      const detector = new EntryPointDetector({
        extraEntryPointNames: ['worker'],
      });
      const eps = detector.detect(result);

      expect(eps).toHaveLength(1);
      expect(eps[0].reasons).toContain('filename-match');
    });

    it('ignores self-imports (same file)', () => {
      const result = syntheticResult({
        files: ['src/a.ts'],
        edges: [{ from: 'src/a.ts', to: 'src/a.ts' }],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);
      // No fan-in/fan-out from self-import
      expect(eps).toEqual([]);
    });

    it('does not flag test files named index.test.ts as entry points', () => {
      const result = syntheticResult({
        files: ['src/index.test.ts', 'src/helpers.ts'],
        edges: [],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      // index.test.ts basename without last extension is "index.test", not "index"
      const names = eps.map(e => e.filePath);
      expect(names).not.toContain('src/index.test.ts');
    });

    it('skips edges with malformed nodeIds gracefully', () => {
      // Edges with only 2 colons, 1 colon, or no colons should be silently skipped
      const result: CIGBuildResult = {
        nodes: [
          {
            nodeId: 'repo:src/a.ts:<module>:variable',
            repoId: 'repo',
            filePath: 'src/a.ts',
            symbolName: '<module>',
            symbolType: 'variable',
            startLine: 1,
            endLine: 1,
            exported: false,
            extractedSha: 'sha',
          },
        ],
        edges: [
          {
            edgeId: 'bad-edge-1',
            repoId: 'repo',
            fromNodeId: 'malformed',          // no colons
            toNodeId: 'repo:src/a.ts:<module>:variable',
            edgeType: 'imports',
          },
          {
            edgeId: 'bad-edge-2',
            repoId: 'repo',
            fromNodeId: 'repo:src/a.ts',      // only 1 colon
            toNodeId: 'repo:src/a.ts:<module>:variable',
            edgeType: 'imports',
          },
          {
            edgeId: 'bad-edge-3',
            repoId: 'repo',
            fromNodeId: 'repo:src/a.ts:stub', // only 2 colons
            toNodeId: 'repo:src/a.ts:<module>:variable',
            edgeType: 'imports',
          },
        ],
        filesProcessed: 1,
        filesSkipped: 0,
        errors: [],
      };

      const detector = new EntryPointDetector();
      // Should not throw; malformed edges are silently ignored
      const eps = detector.detect(result);
      expect(eps).toEqual([]);
    });

    it('does not flag isolated files with no imports and no importers', () => {
      const result = syntheticResult({
        files: ['src/helpers.ts'],
        edges: [],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);
      // helpers.ts has no entry-point filename, no fan-in, no fan-out
      expect(eps).toEqual([]);
    });

    it('handles a file that is both filename match and high-fan-in', () => {
      const result = syntheticResult({
        files: ['src/index.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
        edges: [
          { from: 'src/a.ts', to: 'src/index.ts' },
          { from: 'src/b.ts', to: 'src/index.ts' },
          { from: 'src/c.ts', to: 'src/index.ts' },
        ],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      const indexEp = eps.find(e => e.filePath === 'src/index.ts');
      expect(indexEp).toBeDefined();
      expect(indexEp!.reasons).toContain('high-fan-in');
      expect(indexEp!.reasons).toContain('low-fan-out');
      expect(indexEp!.reasons).toContain('filename-match');
      // Score = fan-in(3) + low-fan-out(1) + filename(2) = 6
      expect(indexEp!.score).toBe(6);
    });
  });

  describe('detectAndEnrich()', () => {
    it('enriches <module> node metadata for entry points', () => {
      const result = syntheticResult({
        files: ['src/index.ts', 'src/helpers.ts'],
        edges: [{ from: 'src/index.ts', to: 'src/helpers.ts' }],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detectAndEnrich(result);

      // index.ts should be enriched
      const indexNode = result.nodes.find(
        n => n.filePath === 'src/index.ts' && n.symbolName === '<module>',
      );
      expect(indexNode!.metadata).toMatchObject({
        isEntryPoint: true,
        entryPointScore: expect.any(Number),
        entryPointReasons: expect.arrayContaining(['filename-match']),
      });

      // helpers.ts gets low-fan-out (imported by index.ts, imports nothing)
      const helpersNode = result.nodes.find(
        n => n.filePath === 'src/helpers.ts' && n.symbolName === '<module>',
      );
      expect(helpersNode!.metadata).toMatchObject({
        isEntryPoint: true,
        entryPointReasons: expect.arrayContaining(['low-fan-out']),
      });

      expect(eps.length).toBeGreaterThan(0);
    });

    it('preserves existing metadata when enriching', () => {
      const result = syntheticResult({
        files: ['src/index.ts'],
        edges: [],
      });

      // Add pre-existing metadata
      result.nodes[0].metadata = { existingKey: 'value' };

      const detector = new EntryPointDetector();
      detector.detectAndEnrich(result);

      expect(result.nodes[0].metadata).toMatchObject({
        existingKey: 'value',
        isEntryPoint: true,
      });
    });
  });

  describe('realistic multi-file project (synthetic)', () => {
    it('detects entry points in a realistic import graph', () => {
      // Simulates: types.ts ← db.ts, service.ts, routes.ts, index.ts (fan-in=4)
      //            utils.ts ← db.ts, service.ts (fan-in=2)
      //            db.ts ← service.ts (fan-in=1)
      //            service.ts ← routes.ts, index.ts, server.ts (fan-in=3)
      //            routes.ts ← index.ts, server.ts (fan-in=2)
      //            index.ts ← nobody (zero-importers, filename-match)
      //            server.ts ← nobody (zero-importers, filename-match)
      const result = syntheticResult({
        files: [
          'src/types.ts',
          'src/utils.ts',
          'src/db.ts',
          'src/service.ts',
          'src/routes.ts',
          'src/index.ts',
          'src/server.ts',
        ],
        edges: [
          { from: 'src/db.ts', to: 'src/types.ts' },
          { from: 'src/db.ts', to: 'src/utils.ts' },
          { from: 'src/service.ts', to: 'src/types.ts' },
          { from: 'src/service.ts', to: 'src/utils.ts' },
          { from: 'src/service.ts', to: 'src/db.ts' },
          { from: 'src/routes.ts', to: 'src/types.ts' },
          { from: 'src/routes.ts', to: 'src/service.ts' },
          { from: 'src/index.ts', to: 'src/service.ts' },
          { from: 'src/index.ts', to: 'src/routes.ts' },
          { from: 'src/index.ts', to: 'src/types.ts' },
          { from: 'src/server.ts', to: 'src/service.ts' },
          { from: 'src/server.ts', to: 'src/routes.ts' },
        ],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detect(result);

      // types.ts: fan-in=4 → high-fan-in
      const typesEp = eps.find(e => e.filePath === 'src/types.ts');
      expect(typesEp).toBeDefined();
      expect(typesEp!.reasons).toContain('high-fan-in');

      // service.ts: fan-in=3 → high-fan-in
      const serviceEp = eps.find(e => e.filePath === 'src/service.ts');
      expect(serviceEp).toBeDefined();
      expect(serviceEp!.reasons).toContain('high-fan-in');

      // index.ts: filename-match + zero-importers
      const indexEp = eps.find(e => e.filePath === 'src/index.ts');
      expect(indexEp).toBeDefined();
      expect(indexEp!.reasons).toContain('filename-match');
      expect(indexEp!.reasons).toContain('zero-importers');

      // server.ts: filename-match + zero-importers
      const serverEp = eps.find(e => e.filePath === 'src/server.ts');
      expect(serverEp).toBeDefined();
      expect(serverEp!.reasons).toContain('filename-match');
      expect(serverEp!.reasons).toContain('zero-importers');

      // utils.ts: fan-in=2, below default minFanIn=3 → not high-fan-in
      const utilsEp = eps.find(e => e.filePath === 'src/utils.ts');
      if (utilsEp) {
        expect(utilsEp.reasons).not.toContain('high-fan-in');
      }
    });

    it('detectAndEnrich marks module nodes for detected entry points', () => {
      const result = syntheticResult({
        files: ['src/main.ts', 'src/lib.ts'],
        edges: [{ from: 'src/main.ts', to: 'src/lib.ts' }],
      });

      const detector = new EntryPointDetector();
      const eps = detector.detectAndEnrich(result);

      expect(eps.length).toBeGreaterThan(0);

      // main.ts should be enriched (filename-match + zero-importers)
      const mainNode = result.nodes.find(
        n => n.filePath === 'src/main.ts' && n.symbolName === '<module>',
      );
      expect(mainNode!.metadata).toMatchObject({
        isEntryPoint: true,
        entryPointReasons: expect.arrayContaining(['filename-match', 'zero-importers']),
      });
    });
  });
});

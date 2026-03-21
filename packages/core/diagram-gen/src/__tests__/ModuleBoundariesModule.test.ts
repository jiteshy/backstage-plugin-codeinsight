import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { ModuleBoundariesModule } from '../diagrams/universal/ModuleBoundariesModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(nodeId: string, filePath: string): CIGNode {
  return {
    nodeId,
    repoId: 'repo',
    filePath,
    symbolName: nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 5,
    exported: false,
    extractedSha: 'sha',
  };
}

function importEdge(edgeId: string, from: string, to: string): CIGEdge {
  return { edgeId, repoId: 'repo', fromNodeId: from, toNodeId: to, edgeType: 'imports' };
}

function snap(nodes: CIGNode[], edges: CIGEdge[]): CIGSnapshot {
  return { nodes, edges };
}

// Build a snapshot with `count` domain groups, each with a single file under src/<domain>/
function makeMultiDomainSnap(
  domains: string[],
  crossEdges: Array<[string, string]> = [],
): CIGSnapshot {
  const nodes = domains.map(d => makeNode(d, `src/${d}/index.ts`));
  const edges = crossEdges.map(([from, to], i) =>
    importEdge(`e${i}`, from, to),
  );
  return snap(nodes, edges);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModuleBoundariesModule', () => {
  let mod: ModuleBoundariesModule;

  beforeEach(() => {
    mod = new ModuleBoundariesModule();
  });

  // ── Static properties ─────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('universal/module-boundaries');
    expect(mod.llmNeeded).toBe(false);
    expect(mod.triggersOn).toHaveLength(0); // always-on
  });

  // ── Null-return conditions ────────────────────────────────────────────────

  it('returns null for empty CIG', async () => {
    expect(await mod.generate(snap([], []))).toBeNull();
  });

  it('returns null when fewer than 3 domain groups are found (0 domains)', async () => {
    // Files without a recognisable src/lib/app root
    const nodes = [makeNode('a', 'a.ts'), makeNode('b', 'b.ts')];
    expect(await mod.generate(snap(nodes, []))).toBeNull();
  });

  it('returns null when fewer than 3 domain groups are found (2 domains)', async () => {
    const s = makeMultiDomainSnap(['auth', 'billing'], [['auth', 'billing']]);
    expect(await mod.generate(s)).toBeNull();
  });

  it('returns null when 3+ domain groups exist but no cross-domain imports', async () => {
    // 3 domains, no edges
    const nodes = [
      makeNode('a', 'src/auth/service.ts'),
      makeNode('b', 'src/billing/service.ts'),
      makeNode('c', 'src/users/service.ts'),
    ];
    expect(await mod.generate(snap(nodes, []))).toBeNull();
  });

  it('returns null when edges exist but none are import edges', async () => {
    const nodes = [
      makeNode('a', 'src/auth/service.ts'),
      makeNode('b', 'src/billing/service.ts'),
      makeNode('c', 'src/users/service.ts'),
    ];
    const callEdge: CIGEdge = {
      edgeId: 'e1', repoId: 'repo', fromNodeId: 'a', toNodeId: 'b', edgeType: 'calls',
    };
    expect(await mod.generate(snap(nodes, [callEdge]))).toBeNull();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('produces a graph LR diagram when 3+ domains have cross-domain imports', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'c')]; // auth imports users
    const result = await mod.generate(snap(nodes, edges));

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Module Boundaries');
    expect(result!.diagramType).toBe('graph');
    expect(result!.llmUsed).toBe(false);
    expect(result!.mermaid).toMatch(/^graph LR/);
  });

  it('includes both domain names in the mermaid output', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [importEdge('e1', 'b', 'a')]; // billing imports auth
    const result = await mod.generate(snap(nodes, edges));

    expect(result!.mermaid).toContain('billing');
    expect(result!.mermaid).toContain('auth');
  });

  // ── Domain group exclusions ───────────────────────────────────────────────

  it('excludes generic segments: index, utils, types, shared, common, helpers', async () => {
    // Files under src/utils/ and src/types/ should not form domain groups
    const nodes = [
      makeNode('a', 'src/utils/format.ts'),
      makeNode('b', 'src/types/index.ts'),
      makeNode('c', 'src/shared/base.ts'),
      makeNode('d', 'src/auth/AuthService.ts'),    // valid domain
      makeNode('e', 'src/billing/BillingService.ts'), // valid domain
    ];
    // auth → utils (cross-domain import only if utils is a domain, which it should not be)
    const edges = [importEdge('e1', 'd', 'a')];
    // Only 2 valid domains (auth, billing), utils/types/shared excluded → null
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  it('excludes __tests__ and test segments', async () => {
    const nodes = [
      makeNode('a', 'src/__tests__/auth.test.ts'),
      makeNode('b', 'src/auth/AuthService.ts'),
      makeNode('c', 'src/billing/BillingService.ts'),
    ];
    const edges = [importEdge('e1', 'b', 'a')];
    // Only 2 valid domains (auth, billing, __tests__ excluded)
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  // ── lib/ and app/ source roots ────────────────────────────────────────────

  it('detects domain groups under lib/ root', async () => {
    const nodes = [
      makeNode('a', 'lib/auth/AuthHelper.ts'),
      makeNode('b', 'lib/billing/BillingHelper.ts'),
      makeNode('c', 'lib/users/UserHelper.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'c')];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('auth');
  });

  it('detects domain groups under app/ root', async () => {
    const nodes = [
      makeNode('a', 'app/auth/AuthPage.ts'),
      makeNode('b', 'app/billing/BillingPage.ts'),
      makeNode('c', 'app/users/UsersPage.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'b')];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    expect(result!.mermaid).toContain('auth');
    expect(result!.mermaid).toContain('billing');
  });

  // ── nodeMap ───────────────────────────────────────────────────────────────

  it('populates nodeMap with domain node IDs mapped to representative file paths', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'c')];
    const result = await mod.generate(snap(nodes, edges));

    expect(result!.nodeMap).toBeDefined();
    // Each domain that participated should have a representative path
    const nodeMap = result!.nodeMap!;
    const values = Object.values(nodeMap);
    // The representative paths should be actual file paths from the snapshot
    expect(values.every(p => nodes.some(n => n.filePath === p))).toBe(true);
  });

  // ── Edge deduplication ────────────────────────────────────────────────────

  it('deduplicates multiple symbol-level imports into a single domain-level edge', async () => {
    const nodes = [
      makeNode('a1', 'src/auth/ServiceA.ts'),
      makeNode('a2', 'src/auth/ServiceB.ts'),
      makeNode('b1', 'src/users/UserService.ts'),
      makeNode('c1', 'src/billing/BillingService.ts'),
    ];
    // auth/ServiceA → users and auth/ServiceB → users (both collapse to auth→users)
    const edges = [
      importEdge('e1', 'a1', 'b1'),
      importEdge('e2', 'a2', 'b1'),
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result).not.toBeNull();
    // Both collapse to one domain edge
    const arrowCount = (result!.mermaid.match(/-->/g) ?? []).length;
    expect(arrowCount).toBe(1);
  });

  it('skips edges referencing unknown node IDs', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'unknown-node')];
    // The unknown target is skipped, no valid cross-domain edge remains
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });

  // ── Description ───────────────────────────────────────────────────────────

  it('includes domain count and cross-import count in description', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [importEdge('e1', 'a', 'c')];
    const result = await mod.generate(snap(nodes, edges));
    expect(result!.description).toContain('3 domain modules');
    expect(result!.description).toContain('1 cross-domain import');
  });

  it('uses plural "imports" in description for multiple cross-domain edges', async () => {
    const nodes = [
      makeNode('a', 'src/auth/AuthService.ts'),
      makeNode('b', 'src/billing/BillingService.ts'),
      makeNode('c', 'src/users/UserService.ts'),
    ];
    const edges = [
      importEdge('e1', 'a', 'c'),  // auth → users
      importEdge('e2', 'b', 'c'),  // billing → users
    ];
    const result = await mod.generate(snap(nodes, edges));
    expect(result!.description).toContain('2 cross-domain imports');
  });

  // ── Monorepo layout (nested src/) ─────────────────────────────────────────

  it('handles monorepo layout — uses first segment after src/', async () => {
    const nodes = [
      makeNode('a', 'packages/core/types/src/data.ts'),
      makeNode('b', 'packages/core/auth/src/AuthService.ts'),
      makeNode('c', 'packages/core/billing/src/BillingService.ts'),
    ];
    // data is the segment after src/ in packages/core/types/src/data.ts →
    // but data is a single file (no sub-segment), so domainOf returns null for it
    // auth and billing are valid
    const edges = [importEdge('e1', 'b', 'c')];
    // Only 2 valid domains → null
    expect(await mod.generate(snap(nodes, edges))).toBeNull();
  });
});

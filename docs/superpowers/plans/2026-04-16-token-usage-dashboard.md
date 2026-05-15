# Token Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global Backstage admin page at `/codeinsight/usage` showing aggregated token usage across all repos, with model-aware cost estimates and per-repo breakdown.

**Architecture:** Direct SQL aggregation over existing `ci_artifacts` and `ci_qna_messages` tables, served via a new `GET /usage` backend route. Frontend is a standalone Backstage page with stat cards, model breakdown table, and sortable repo usage table. No new DB tables or migrations.

**Tech Stack:** Knex (SQL aggregation), Express (route), React + MUI + Backstage `Table` component (frontend), Backstage `createRoutableExtension` (page registration)

**Spec:** `docs/superpowers/specs/2026-04-16-token-usage-dashboard-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/core/types/src/usage.ts` | `UsageTimeRange`, `RepoUsageRow`, `ModelBreakdown`, `TokenUsageStats`, `UsageConfig` types |
| `packages/backstage/plugin/src/components/TokenUsagePage.tsx` | Main usage dashboard page component |
| `packages/backstage/plugin/src/components/TokenUsagePage.test.tsx` | Unit tests for the usage page |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/types/src/index.ts` | Re-export usage types |
| `packages/core/types/src/config.ts` | Add `UsageConfig` to `CodeInsightConfig` |
| `packages/core/types/src/interfaces.ts` | Add `getTokenUsageStats()` to `StorageAdapter` |
| `packages/adapters/storage/src/KnexStorageAdapter.ts` | Implement `getTokenUsageStats()` |
| `packages/adapters/storage/src/KnexStorageAdapter.test.ts` | Tests for the new method |
| `packages/adapters/llm/src/CachingLLMClient.ts` | Fix `tokens_used: 0` to heuristic estimate |
| `packages/adapters/llm/src/__tests__/CachingLLMClient.test.ts` | Update test for token estimate |
| `packages/backstage/plugin-backend/config.d.ts` | Add `usage` namespace |
| `packages/backstage/plugin-backend/src/router.ts` | Add `GET /usage` route |
| `packages/backstage/plugin-backend/src/router.test.ts` | Tests for usage route |
| `packages/backstage/plugin-backend/src/plugin.ts` | Read cost config, pass to router |
| `packages/backstage/plugin/src/api.ts` | Add `getTokenUsage()` to `CodeInsightApi` |
| `packages/backstage/plugin/src/api-client.ts` | Implement `getTokenUsage()` |
| `packages/backstage/plugin/src/plugin.ts` | Register `TokenUsagePage` as routable extension |
| `packages/backstage/plugin/src/routes.ts` | Add `usageRouteRef` |
| `packages/backstage/plugin/src/index.ts` | Export `TokenUsagePage` |
| `dev/app/src/App.tsx` | Add `/codeinsight/usage` route |

---

## Task 1: Usage Types

**Files:**
- Create: `packages/core/types/src/usage.ts`
- Modify: `packages/core/types/src/index.ts`
- Modify: `packages/core/types/src/config.ts`

- [ ] **Step 1: Create usage types file**

```typescript
// packages/core/types/src/usage.ts

export type UsageTimeRange = '7d' | '30d' | 'all';

export interface RepoUsageRow {
  repoId: string;
  repoName: string;
  ingestionTokens: number;
  qnaTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastActivity: Date | null;
}

export interface ModelBreakdown {
  model: string;
  tokens: number;
  estimatedCost: number;
}

export interface TokenUsageStats {
  timeRange: UsageTimeRange;
  totalTokens: number;
  totalEstimatedCost: number;
  byModel: ModelBreakdown[];
  byRepo: RepoUsageRow[];
}
```

- [ ] **Step 2: Add UsageConfig to config.ts**

In `packages/core/types/src/config.ts`, add before the `CodeInsightConfig` interface:

```typescript
export interface UsageConfig {
  costPerMillionTokens: Record<string, number>;
}
```

Then add `usage?: UsageConfig;` to `CodeInsightConfig`:

```typescript
export interface CodeInsightConfig {
  database: DatabaseConfig;
  repo: RepoCloneConfig;
  llm?: LLMConfig;
  embedding?: EmbeddingConfig;
  ingestion: IngestionConfig;
  qna?: QnAConfig;
  usage?: UsageConfig;
  features: {
    docs: boolean;
    diagrams: boolean;
    qna: boolean;
  };
}
```

- [ ] **Step 3: Re-export from index.ts**

In `packages/core/types/src/index.ts`, add:

```typescript
export type {
  UsageTimeRange,
  RepoUsageRow,
  ModelBreakdown,
  TokenUsageStats,
} from './usage';
export type { UsageConfig } from './config';
```

- [ ] **Step 4: Build the types package**

Run: `pnpm --filter @codeinsight/types build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/types/src/usage.ts packages/core/types/src/config.ts packages/core/types/src/index.ts
git commit -m "feat(types): add token usage dashboard types and UsageConfig"
```

---

## Task 2: StorageAdapter Interface Update

**Files:**
- Modify: `packages/core/types/src/interfaces.ts`

- [ ] **Step 1: Add getTokenUsageStats to StorageAdapter**

In `packages/core/types/src/interfaces.ts`, add the import for the new types at the top (in the existing import block from `'./data'`... actually these are in `./usage`):

```typescript
import type { TokenUsageStats, UsageTimeRange } from './usage';
```

Then add to the `StorageAdapter` interface, after the QnA Messages section:

```typescript
  // Token Usage (Phase 6.3)
  getTokenUsageStats(
    timeRange: UsageTimeRange,
    costMap: Record<string, number>,
  ): Promise<TokenUsageStats>;
```

- [ ] **Step 2: Build the types package**

Run: `pnpm --filter @codeinsight/types build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/core/types/src/interfaces.ts
git commit -m "feat(types): add getTokenUsageStats to StorageAdapter interface"
```

---

## Task 3: KnexStorageAdapter Implementation

**Files:**
- Modify: `packages/adapters/storage/src/KnexStorageAdapter.ts`
- Test: `packages/adapters/storage/src/KnexStorageAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `packages/adapters/storage/src/KnexStorageAdapter.test.ts`, inside the main `describe` block. This test uses the existing real-Postgres test setup. First, check the test structure:

The existing test file uses `beforeAll` to set up a Knex connection and run migrations, and `afterAll` to tear down. Each test uses transactions or direct inserts.

Add this describe block:

```typescript
describe('getTokenUsageStats', () => {
  const costMap = { 'claude-sonnet-4-20250514': 3.0, 'text-embedding-3-small': 0.02, default: 3.0 };

  beforeEach(async () => {
    // Clean up tables used by these tests
    await knex('ci_qna_messages').del();
    await knex('ci_qna_sessions').del();
    await knex('ci_artifacts').del();
    await knex('ci_repositories').del();
  });

  it('returns empty stats when no data exists', async () => {
    const stats = await adapter.getTokenUsageStats('30d', costMap);
    expect(stats.timeRange).toBe('30d');
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalEstimatedCost).toBe(0);
    expect(stats.byModel).toEqual([]);
    expect(stats.byRepo).toEqual([]);
  });

  it('aggregates ingestion tokens by repo from ci_artifacts', async () => {
    await knex('ci_repositories').insert({
      repo_id: 'org~repo-a',
      name: 'repo-a',
      url: 'https://github.com/org/repo-a',
      provider: 'github',
      status: 'ready',
    });
    await knex('ci_artifacts').insert([
      {
        repo_id: 'org~repo-a',
        artifact_id: 'core/overview',
        artifact_type: 'doc',
        content: JSON.stringify({ markdown: 'hello' }),
        input_sha: 'sha1',
        tokens_used: 500,
        llm_used: true,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      },
      {
        repo_id: 'org~repo-a',
        artifact_id: 'core/testing',
        artifact_type: 'doc',
        content: JSON.stringify({ markdown: 'world' }),
        input_sha: 'sha2',
        tokens_used: 300,
        llm_used: true,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      },
    ]);

    const stats = await adapter.getTokenUsageStats('30d', costMap);
    expect(stats.totalTokens).toBe(800);
    expect(stats.byRepo).toHaveLength(1);
    expect(stats.byRepo[0].repoId).toBe('org~repo-a');
    expect(stats.byRepo[0].ingestionTokens).toBe(800);
    expect(stats.byRepo[0].qnaTokens).toBe(0);
    expect(stats.byRepo[0].totalTokens).toBe(800);
  });

  it('aggregates QnA tokens from ci_qna_messages', async () => {
    await knex('ci_repositories').insert({
      repo_id: 'org~repo-b',
      name: 'repo-b',
      url: 'https://github.com/org/repo-b',
      provider: 'github',
      status: 'ready',
    });
    await knex('ci_qna_sessions').insert({
      session_id: '00000000-0000-0000-0000-000000000001',
      repo_id: 'org~repo-b',
      active_context: JSON.stringify({ mentionedFiles: [], mentionedSymbols: [] }),
    });
    await knex('ci_qna_messages').insert([
      {
        message_id: '00000000-0000-0000-0000-000000000010',
        session_id: '00000000-0000-0000-0000-000000000001',
        role: 'assistant',
        content: 'answer 1',
        tokens_used: 200,
      },
      {
        message_id: '00000000-0000-0000-0000-000000000011',
        session_id: '00000000-0000-0000-0000-000000000001',
        role: 'assistant',
        content: 'answer 2',
        tokens_used: 150,
      },
    ]);

    const stats = await adapter.getTokenUsageStats('30d', costMap);
    expect(stats.byRepo).toHaveLength(1);
    expect(stats.byRepo[0].repoId).toBe('org~repo-b');
    expect(stats.byRepo[0].qnaTokens).toBe(350);
    expect(stats.byRepo[0].ingestionTokens).toBe(0);
  });

  it('breaks down tokens by model from generation_sig', async () => {
    await knex('ci_repositories').insert({
      repo_id: 'org~repo-c',
      name: 'repo-c',
      url: 'https://github.com/org/repo-c',
      provider: 'github',
      status: 'ready',
    });
    await knex('ci_artifacts').insert([
      {
        repo_id: 'org~repo-c',
        artifact_id: 'core/overview',
        artifact_type: 'doc',
        content: JSON.stringify({ markdown: 'x' }),
        input_sha: 'sha1',
        tokens_used: 600,
        llm_used: true,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      },
      {
        repo_id: 'org~repo-c',
        artifact_id: 'er-diagram',
        artifact_type: 'diagram',
        content: JSON.stringify({ mermaid: 'erDiagram' }),
        input_sha: 'sha2',
        tokens_used: 0,
        llm_used: false,
        generation_sig: null,
        generated_at: new Date(),
      },
    ]);

    const stats = await adapter.getTokenUsageStats('all', costMap);
    expect(stats.byModel).toHaveLength(1);
    expect(stats.byModel[0].model).toBe('claude-sonnet-4-20250514');
    expect(stats.byModel[0].tokens).toBe(600);
  });

  it('filters by time range', async () => {
    await knex('ci_repositories').insert({
      repo_id: 'org~repo-d',
      name: 'repo-d',
      url: 'https://github.com/org/repo-d',
      provider: 'github',
      status: 'ready',
    });
    const old = new Date();
    old.setDate(old.getDate() - 40);
    await knex('ci_artifacts').insert([
      {
        repo_id: 'org~repo-d',
        artifact_id: 'core/overview',
        artifact_type: 'doc',
        content: JSON.stringify({ markdown: 'old' }),
        input_sha: 'sha1',
        tokens_used: 1000,
        llm_used: true,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: old,
      },
      {
        repo_id: 'org~repo-d',
        artifact_id: 'core/testing',
        artifact_type: 'doc',
        content: JSON.stringify({ markdown: 'new' }),
        input_sha: 'sha2',
        tokens_used: 500,
        llm_used: true,
        generation_sig: 'claude-sonnet-4-20250514:v1',
        generated_at: new Date(),
      },
    ]);

    const stats7d = await adapter.getTokenUsageStats('7d', costMap);
    expect(stats7d.totalTokens).toBe(500);

    const stats30d = await adapter.getTokenUsageStats('30d', costMap);
    expect(stats30d.totalTokens).toBe(500);

    const statsAll = await adapter.getTokenUsageStats('all', costMap);
    expect(statsAll.totalTokens).toBe(1500);
  });

  it('computes cost using the cost map', async () => {
    await knex('ci_repositories').insert({
      repo_id: 'org~repo-e',
      name: 'repo-e',
      url: 'https://github.com/org/repo-e',
      provider: 'github',
      status: 'ready',
    });
    await knex('ci_artifacts').insert({
      repo_id: 'org~repo-e',
      artifact_id: 'core/overview',
      artifact_type: 'doc',
      content: JSON.stringify({ markdown: 'x' }),
      input_sha: 'sha1',
      tokens_used: 1_000_000,
      llm_used: true,
      generation_sig: 'claude-sonnet-4-20250514:v1',
      generated_at: new Date(),
    });

    const stats = await adapter.getTokenUsageStats('all', costMap);
    expect(stats.byModel[0].estimatedCost).toBeCloseTo(3.0, 2);
    expect(stats.totalEstimatedCost).toBeCloseTo(3.0, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/storage test -- --testPathPattern=KnexStorageAdapter`
Expected: FAIL — `adapter.getTokenUsageStats is not a function`

- [ ] **Step 3: Implement getTokenUsageStats in KnexStorageAdapter**

Add the import at the top of `packages/adapters/storage/src/KnexStorageAdapter.ts`:

```typescript
import type {
  // ... existing imports ...
  TokenUsageStats,
  UsageTimeRange,
} from '@codeinsight/types';
```

Add the method to the `KnexStorageAdapter` class:

```typescript
  async getTokenUsageStats(
    timeRange: UsageTimeRange,
    costMap: Record<string, number>,
  ): Promise<TokenUsageStats> {
    const cutoff = this.computeCutoff(timeRange);
    const defaultRate = costMap['default'] ?? Math.max(...Object.values(costMap), 0);

    // Query 1: Ingestion tokens by repo (from ci_artifacts where llm_used=true)
    const artifactQuery = this.knex('ci_artifacts as a')
      .join('ci_repositories as r', 'a.repo_id', 'r.repo_id')
      .where('a.llm_used', true)
      .select(
        'a.repo_id as repoId',
        'r.name as repoName',
        this.knex.raw('COALESCE(SUM(a.tokens_used), 0)::int as "ingestionTokens"'),
        this.knex.raw('MAX(a.generated_at) as "lastIngestionActivity"'),
      )
      .groupBy('a.repo_id', 'r.name');

    if (cutoff) {
      artifactQuery.where('a.generated_at', '>=', cutoff);
    }

    const artifactRows: Array<{
      repoId: string;
      repoName: string;
      ingestionTokens: number;
      lastIngestionActivity: Date | null;
    }> = await artifactQuery;

    // Query 2: QnA tokens by repo (from ci_qna_messages via ci_qna_sessions)
    const qnaQuery = this.knex('ci_qna_messages as m')
      .join('ci_qna_sessions as s', 'm.session_id', 's.session_id')
      .join('ci_repositories as r', 's.repo_id', 'r.repo_id')
      .select(
        's.repo_id as repoId',
        'r.name as repoName',
        this.knex.raw('COALESCE(SUM(m.tokens_used), 0)::int as "qnaTokens"'),
        this.knex.raw('MAX(m.created_at) as "lastQnAActivity"'),
      )
      .groupBy('s.repo_id', 'r.name');

    if (cutoff) {
      qnaQuery.where('m.created_at', '>=', cutoff);
    }

    const qnaRows: Array<{
      repoId: string;
      repoName: string;
      qnaTokens: number;
      lastQnAActivity: Date | null;
    }> = await qnaQuery;

    // Query 3: Model breakdown (from ci_artifacts where llm_used=true)
    const modelQuery = this.knex('ci_artifacts')
      .where('llm_used', true)
      .whereNotNull('generation_sig')
      .select(
        this.knex.raw("SPLIT_PART(generation_sig, ':', 1) as model"),
        this.knex.raw('COALESCE(SUM(tokens_used), 0)::int as tokens'),
      )
      .groupBy(this.knex.raw("SPLIT_PART(generation_sig, ':', 1)"));

    if (cutoff) {
      modelQuery.where('generated_at', '>=', cutoff);
    }

    const modelRows: Array<{ model: string; tokens: number }> = await modelQuery;

    // Also get QnA total for model breakdown (attributed to generic "llm" label)
    let qnaTotalTokens = 0;
    const qnaTotalQuery = this.knex('ci_qna_messages')
      .select(this.knex.raw('COALESCE(SUM(tokens_used), 0)::int as total'));
    if (cutoff) {
      qnaTotalQuery.where('created_at', '>=', cutoff);
    }
    const qnaTotalResult = await qnaTotalQuery.first();
    qnaTotalTokens = qnaTotalResult?.total ?? 0;

    // Merge artifact and QnA rows into per-repo breakdown
    const repoMap = new Map<string, {
      repoId: string;
      repoName: string;
      ingestionTokens: number;
      qnaTokens: number;
      lastActivity: Date | null;
    }>();

    for (const row of artifactRows) {
      repoMap.set(row.repoId, {
        repoId: row.repoId,
        repoName: row.repoName,
        ingestionTokens: Number(row.ingestionTokens),
        qnaTokens: 0,
        lastActivity: row.lastIngestionActivity,
      });
    }

    for (const row of qnaRows) {
      const existing = repoMap.get(row.repoId);
      if (existing) {
        existing.qnaTokens = Number(row.qnaTokens);
        if (row.lastQnAActivity && (!existing.lastActivity || row.lastQnAActivity > existing.lastActivity)) {
          existing.lastActivity = row.lastQnAActivity;
        }
      } else {
        repoMap.set(row.repoId, {
          repoId: row.repoId,
          repoName: row.repoName,
          ingestionTokens: 0,
          qnaTokens: Number(row.qnaTokens),
          lastActivity: row.lastQnAActivity,
        });
      }
    }

    // Build model breakdown with costs
    const byModel = modelRows.map(row => ({
      model: row.model,
      tokens: Number(row.tokens),
      estimatedCost: (Number(row.tokens) / 1_000_000) * (costMap[row.model] ?? defaultRate),
    }));

    if (qnaTotalTokens > 0) {
      byModel.push({
        model: 'llm',
        tokens: qnaTotalTokens,
        estimatedCost: (qnaTotalTokens / 1_000_000) * defaultRate,
      });
    }

    byModel.sort((a, b) => b.tokens - a.tokens);

    // Build per-repo rows with costs
    const byRepo = Array.from(repoMap.values()).map(row => {
      const total = row.ingestionTokens + row.qnaTokens;
      return {
        repoId: row.repoId,
        repoName: row.repoName,
        ingestionTokens: row.ingestionTokens,
        qnaTokens: row.qnaTokens,
        totalTokens: total,
        estimatedCost: (total / 1_000_000) * defaultRate,
        lastActivity: row.lastActivity,
      };
    });

    byRepo.sort((a, b) => b.totalTokens - a.totalTokens);

    const totalTokens = byRepo.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalEstimatedCost = byModel.reduce((sum, m) => sum + m.estimatedCost, 0);

    return {
      timeRange,
      totalTokens,
      totalEstimatedCost,
      byModel,
      byRepo,
    };
  }

  private computeCutoff(timeRange: UsageTimeRange): Date | null {
    if (timeRange === 'all') return null;
    const now = new Date();
    const days = timeRange === '7d' ? 7 : 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @codeinsight/storage test -- --testPathPattern=KnexStorageAdapter`
Expected: All new `getTokenUsageStats` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/storage/src/KnexStorageAdapter.ts packages/adapters/storage/src/KnexStorageAdapter.test.ts
git commit -m "feat(storage): implement getTokenUsageStats aggregation queries"
```

---

## Task 4: Fix CachingLLMClient tokens_used

**Files:**
- Modify: `packages/adapters/llm/src/CachingLLMClient.ts`
- Test: `packages/adapters/llm/src/__tests__/CachingLLMClient.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/adapters/llm/src/__tests__/CachingLLMClient.test.ts`, find the test that verifies cache miss behavior and add a new test (or modify the existing one) to verify `tokens_used` is estimated:

```typescript
it('estimates tokens_used from response length on cache miss', async () => {
  const response = 'a'.repeat(400); // 400 chars => ceil(400/4) = 100 tokens
  mockInner.complete.mockResolvedValue(response);

  await client.complete('sys', 'usr');

  const row = await knex('ci_llm_cache').first();
  expect(row).toBeDefined();
  expect(row!.tokens_used).toBe(100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/llm test -- --testPathPattern=CachingLLMClient`
Expected: FAIL — `tokens_used` is `0`, expected `100`.

- [ ] **Step 3: Fix the implementation**

In `packages/adapters/llm/src/CachingLLMClient.ts`, change line 67:

Old:
```typescript
        tokens_used: 0, // tokens not available from the LLMClient interface; Phase 2.5 can enrich
```

New:
```typescript
        tokens_used: Math.ceil(response.length / 4),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @codeinsight/llm test -- --testPathPattern=CachingLLMClient`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/llm/src/CachingLLMClient.ts packages/adapters/llm/src/__tests__/CachingLLMClient.test.ts
git commit -m "fix(llm): estimate tokens_used in CachingLLMClient instead of hardcoded 0"
```

---

## Task 5: Backend Config & Route

**Files:**
- Modify: `packages/backstage/plugin-backend/config.d.ts`
- Modify: `packages/backstage/plugin-backend/src/router.ts`
- Modify: `packages/backstage/plugin-backend/src/plugin.ts`
- Test: `packages/backstage/plugin-backend/src/router.test.ts`

- [ ] **Step 1: Add usage config to config.d.ts**

In `packages/backstage/plugin-backend/config.d.ts`, add before the closing `};` of the `codeinsight` object:

```typescript
    /**
     * Token usage dashboard settings.
     * @visibility backend
     */
    usage?: {
      /**
       * Cost per million tokens, keyed by model name.
       * Include a 'default' key for fallback. Example: { 'claude-sonnet-4-20250514': 3.0, default: 3.0 }
       */
      costPerMillionTokens?: Record<string, number>;
    };
```

- [ ] **Step 2: Write the failing router test**

In `packages/backstage/plugin-backend/src/router.test.ts`, add `getTokenUsageStats` to the `mockStorageAdapter()` function:

```typescript
    getTokenUsageStats: jest.fn(),
```

Add a test in the existing describe block:

```typescript
  describe('GET /usage', () => {
    it('returns token usage stats', async () => {
      const mockStats = {
        timeRange: '30d',
        totalTokens: 1500,
        totalEstimatedCost: 4.5,
        byModel: [{ model: 'claude-sonnet-4-20250514', tokens: 1500, estimatedCost: 4.5 }],
        byRepo: [{
          repoId: 'org~repo',
          repoName: 'repo',
          ingestionTokens: 1000,
          qnaTokens: 500,
          totalTokens: 1500,
          estimatedCost: 4.5,
          lastActivity: new Date().toISOString(),
        }],
      };
      storage.getTokenUsageStats.mockResolvedValue(mockStats);

      const { status, body } = await request(server, 'GET', '/usage?range=30d');
      expect(status).toBe(200);
      expect(body).toMatchObject({ timeRange: '30d', totalTokens: 1500 });
      expect(storage.getTokenUsageStats).toHaveBeenCalledWith('30d', { default: 3.0 });
    });

    it('defaults to 30d when no range param', async () => {
      storage.getTokenUsageStats.mockResolvedValue({
        timeRange: '30d',
        totalTokens: 0,
        totalEstimatedCost: 0,
        byModel: [],
        byRepo: [],
      });

      const { status } = await request(server, 'GET', '/usage');
      expect(status).toBe(200);
      expect(storage.getTokenUsageStats).toHaveBeenCalledWith('30d', { default: 3.0 });
    });

    it('rejects invalid range', async () => {
      const { status, body } = await request(server, 'GET', '/usage?range=1y');
      expect(status).toBe(400);
      expect((body as any).error).toContain('Invalid range');
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @codeinsight/plugin-backend test -- --testPathPattern=router.test`
Expected: FAIL — no route matches `GET /usage`.

- [ ] **Step 4: Update router.ts to add the usage route**

In `packages/backstage/plugin-backend/src/router.ts`, add the `costMap` type to `RouterOptions`:

```typescript
export interface RouterOptions {
  config: RootConfigService;
  logger: LoggerService;
  database: DatabaseService;
  jobQueue: JobQueue;
  storageAdapter: StorageAdapter;
  qnaService?: QnAService;
  costMap?: Record<string, number>;
}
```

Then update the destructuring in `createRouter`:

```typescript
  const { logger, jobQueue, storageAdapter, qnaService, costMap = { default: 3.0 } } = options;
```

Add the import for `UsageTimeRange` at the top:

```typescript
import type { DiagramContent, DocContent, JobQueue, StorageAdapter, UsageTimeRange } from '@codeinsight/types';
```

Add the route before the `return router;` line:

```typescript
  // ---------------------------------------------------------------------------
  // 6.3 — Token usage dashboard
  // GET /usage?range=7d|30d|all
  // ---------------------------------------------------------------------------

  const VALID_RANGES = new Set<string>(['7d', '30d', 'all']);

  router.get('/usage', async (req, res) => {
    const range = (req.query.range as string) || '30d';
    if (!VALID_RANGES.has(range)) {
      res.status(400).json({ error: `Invalid range: ${range}. Must be one of: 7d, 30d, all` });
      return;
    }
    const stats = await storageAdapter.getTokenUsageStats(range as UsageTimeRange, costMap);
    res.json(stats);
  });
```

- [ ] **Step 5: Update plugin.ts to read cost config and pass to router**

In `packages/backstage/plugin-backend/src/plugin.ts`, after the `qnaService` block and before the `// Mount router` comment, add:

```typescript
        // Usage dashboard — cost-per-million-tokens map from config
        const usageCostConfig = config.getOptionalConfig('codeinsight.usage.costPerMillionTokens');
        const costMap: Record<string, number> = { default: 3.0 };
        if (usageCostConfig) {
          for (const key of usageCostConfig.keys()) {
            costMap[key] = usageCostConfig.getNumber(key);
          }
        }
```

Then update the `createRouter` call to include `costMap`:

```typescript
        const router = await createRouter({
          config,
          logger,
          database,
          storageAdapter,
          jobQueue,
          qnaService,
          costMap,
        });
```

- [ ] **Step 6: Update the router test mock setup to pass costMap**

In the router test's setup (where `createRouter` is called), make sure `costMap` is passed. The mock config `getOptionalString` won't have usage config, so the default `{ default: 3.0 }` will be used. No change needed if `costMap` is optional with a default.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @codeinsight/plugin-backend test -- --testPathPattern=router.test`
Expected: All tests PASS including the new `GET /usage` tests.

- [ ] **Step 8: Commit**

```bash
git add packages/backstage/plugin-backend/config.d.ts packages/backstage/plugin-backend/src/router.ts packages/backstage/plugin-backend/src/plugin.ts packages/backstage/plugin-backend/src/router.test.ts
git commit -m "feat(backend): add GET /usage route for token usage dashboard"
```

---

## Task 6: Frontend API Layer

**Files:**
- Modify: `packages/backstage/plugin/src/api.ts`
- Modify: `packages/backstage/plugin/src/api-client.ts`
- Modify: `packages/backstage/plugin/src/routes.ts`
- Modify: `packages/backstage/plugin/src/index.ts`

- [ ] **Step 1: Add types and method to api.ts**

In `packages/backstage/plugin/src/api.ts`, add these types before the `CodeInsightApi` interface:

```typescript
export type UsageTimeRange = '7d' | '30d' | 'all';

export interface RepoUsageRow {
  repoId: string;
  repoName: string;
  ingestionTokens: number;
  qnaTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastActivity: string | null;
}

export interface ModelBreakdown {
  model: string;
  tokens: number;
  estimatedCost: number;
}

export interface TokenUsageStats {
  timeRange: UsageTimeRange;
  totalTokens: number;
  totalEstimatedCost: number;
  byModel: ModelBreakdown[];
  byRepo: RepoUsageRow[];
}
```

Add to the `CodeInsightApi` interface:

```typescript
  getTokenUsage(range: UsageTimeRange): Promise<TokenUsageStats>;
```

- [ ] **Step 2: Implement in api-client.ts**

In `packages/backstage/plugin/src/api-client.ts`, update the import:

```typescript
import { CodeInsightApi, DiagramSection, DocSection, QnASource, TokenUsageStats, UsageTimeRange } from './api';
```

Add the method to `CodeInsightClient`:

```typescript
  async getTokenUsage(range: UsageTimeRange): Promise<TokenUsageStats> {
    const base = await this.baseUrl();
    const response = await this.fetchApi.fetch(
      `${base}/usage?range=${encodeURIComponent(range)}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get token usage: ${response.statusText}`);
    }
    return (await response.json()) as TokenUsageStats;
  }
```

- [ ] **Step 3: Add usageRouteRef to routes.ts**

In `packages/backstage/plugin/src/routes.ts`:

```typescript
import { createRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'codeinsight',
});

export const usageRouteRef = createRouteRef({
  id: 'codeinsight.usage',
});
```

- [ ] **Step 4: Update exports in index.ts**

In `packages/backstage/plugin/src/index.ts`, add:

```typescript
export { TokenUsagePage } from './plugin';
export type { TokenUsageStats, UsageTimeRange, RepoUsageRow, ModelBreakdown } from './api';
```

- [ ] **Step 5: Build the frontend plugin to check for compile errors**

Run: `pnpm --filter @codeinsight/plugin build`
Expected: Build will fail because `TokenUsagePage` doesn't exist yet in plugin.ts. That's expected; we'll add it in Task 7.

- [ ] **Step 6: Commit**

```bash
git add packages/backstage/plugin/src/api.ts packages/backstage/plugin/src/api-client.ts packages/backstage/plugin/src/routes.ts packages/backstage/plugin/src/index.ts
git commit -m "feat(plugin): add frontend API types and client method for token usage"
```

---

## Task 7: Frontend TokenUsagePage Component

**Files:**
- Create: `packages/backstage/plugin/src/components/TokenUsagePage.tsx`
- Modify: `packages/backstage/plugin/src/plugin.ts`

- [ ] **Step 1: Create TokenUsagePage.tsx**

Create `packages/backstage/plugin/src/components/TokenUsagePage.tsx`:

```tsx
import {
  Content,
  Header,
  Page,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import Box from '@material-ui/core/Box';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import { makeStyles } from '@material-ui/core/styles';
import MuiTable from '@material-ui/core/Table';
import MuiTableBody from '@material-ui/core/TableBody';
import MuiTableCell from '@material-ui/core/TableCell';
import MuiTableHead from '@material-ui/core/TableHead';
import MuiTableRow from '@material-ui/core/TableRow';
import ToggleButton from '@material-ui/lab/ToggleButton';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import Typography from '@material-ui/core/Typography';
import { useCallback, useEffect, useState } from 'react';

import {
  codeInsightApiRef,
  ModelBreakdown,
  RepoUsageRow,
  TokenUsageStats,
  UsageTimeRange,
} from '../api';

const useStyles = makeStyles(theme => ({
  summaryBar: {
    display: 'flex',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(3),
  },
  statCard: {
    flex: 1,
    textAlign: 'center',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 700,
  },
  statLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.875rem',
  },
  modelTable: {
    marginBottom: theme.spacing(3),
  },
  rangeToggle: {
    marginBottom: theme.spacing(2),
  },
}));

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const repoColumns: TableColumn<RepoUsageRow>[] = [
  { title: 'Repo', field: 'repoName' },
  {
    title: 'Ingestion Tokens',
    field: 'ingestionTokens',
    type: 'numeric',
    render: row => formatTokens(row.ingestionTokens),
  },
  {
    title: 'QnA Tokens',
    field: 'qnaTokens',
    type: 'numeric',
    render: row => formatTokens(row.qnaTokens),
  },
  {
    title: 'Total Tokens',
    field: 'totalTokens',
    type: 'numeric',
    defaultSort: 'desc',
    render: row => formatTokens(row.totalTokens),
  },
  {
    title: 'Estimated Cost',
    field: 'estimatedCost',
    type: 'numeric',
    render: row => formatCost(row.estimatedCost),
  },
  {
    title: 'Last Activity',
    field: 'lastActivity',
    render: row => formatRelativeTime(row.lastActivity),
  },
];

export function TokenUsagePage() {
  const api = useApi(codeInsightApiRef);
  const classes = useStyles();
  const [range, setRange] = useState<UsageTimeRange>('30d');
  const [stats, setStats] = useState<TokenUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async (r: UsageTimeRange) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTokenUsage(r);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchUsage(range);
  }, [range, fetchUsage]);

  const handleRangeChange = (_: unknown, newRange: UsageTimeRange | null) => {
    if (newRange) setRange(newRange);
  };

  return (
    <Page themeId="tool">
      <Header title="Token Usage" subtitle="CodeInsight LLM token consumption and cost estimates" />
      <Content>
        <Box className={classes.rangeToggle}>
          <ToggleButtonGroup
            value={range}
            exclusive
            onChange={handleRangeChange}
            size="small"
          >
            <ToggleButton value="7d">Last 7 days</ToggleButton>
            <ToggleButton value="30d">Last 30 days</ToggleButton>
            <ToggleButton value="all">All time</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {error && (
          <Typography color="error" gutterBottom>
            Failed to load usage data: {error}
          </Typography>
        )}

        {!loading && stats && (
          <>
            <Box className={classes.summaryBar}>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {formatTokens(stats.totalTokens)}
                  </Typography>
                  <Typography className={classes.statLabel}>Total Tokens</Typography>
                </CardContent>
              </Card>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {formatCost(stats.totalEstimatedCost)}
                  </Typography>
                  <Typography className={classes.statLabel}>Estimated Cost</Typography>
                </CardContent>
              </Card>
              <Card className={classes.statCard}>
                <CardContent>
                  <Typography className={classes.statValue}>
                    {stats.byRepo.length}
                  </Typography>
                  <Typography className={classes.statLabel}>Active Repos</Typography>
                </CardContent>
              </Card>
            </Box>

            {stats.byModel.length > 0 && (
              <Card className={classes.modelTable}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Model Breakdown
                  </Typography>
                  <MuiTable size="small">
                    <MuiTableHead>
                      <MuiTableRow>
                        <MuiTableCell>Model</MuiTableCell>
                        <MuiTableCell align="right">Tokens</MuiTableCell>
                        <MuiTableCell align="right">Estimated Cost</MuiTableCell>
                      </MuiTableRow>
                    </MuiTableHead>
                    <MuiTableBody>
                      {stats.byModel.map((m: ModelBreakdown) => (
                        <MuiTableRow key={m.model}>
                          <MuiTableCell>{m.model}</MuiTableCell>
                          <MuiTableCell align="right">{formatTokens(m.tokens)}</MuiTableCell>
                          <MuiTableCell align="right">{formatCost(m.estimatedCost)}</MuiTableCell>
                        </MuiTableRow>
                      ))}
                    </MuiTableBody>
                  </MuiTable>
                </CardContent>
              </Card>
            )}

            <Table<RepoUsageRow>
              title="Per-Repo Usage"
              columns={repoColumns}
              data={stats.byRepo}
              options={{
                pageSize: 10,
                search: true,
                sorting: true,
                padding: 'dense',
              }}
            />
          </>
        )}
      </Content>
    </Page>
  );
}
```

- [ ] **Step 2: Register TokenUsagePage in plugin.ts**

In `packages/backstage/plugin/src/plugin.ts`, add the import for `usageRouteRef`:

```typescript
import { rootRouteRef, usageRouteRef } from './routes';
```

Update the plugin `routes` to include the usage route:

```typescript
export const codeinsightPlugin = createPlugin({
  id: 'codeinsight',
  routes: {
    root: rootRouteRef,
    usage: usageRouteRef,
  },
  apis: [
    // ... same as before
  ],
});
```

Add the new routable extension after the existing `EntityCodeInsightContent`:

```typescript
export const TokenUsagePage = codeinsightPlugin.provide(
  createRoutableExtension({
    name: 'TokenUsagePage',
    component: () =>
      import('./components/TokenUsagePage').then(m => m.TokenUsagePage),
    mountPoint: usageRouteRef,
  }),
);
```

- [ ] **Step 3: Build the frontend plugin**

Run: `pnpm --filter @codeinsight/plugin build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/backstage/plugin/src/components/TokenUsagePage.tsx packages/backstage/plugin/src/plugin.ts packages/backstage/plugin/src/index.ts
git commit -m "feat(plugin): add TokenUsagePage component with summary cards, model breakdown, and repo table"
```

---

## Task 8: Dev App Wiring & Manual Testing

**Files:**
- Modify: `dev/app/src/App.tsx`

- [ ] **Step 1: Add the usage page route to the dev app**

In `dev/app/src/App.tsx`, add the import:

```typescript
import { EntityCodeInsightContent, TokenUsagePage } from '@codeinsight/plugin';
```

Add a route inside `<FlatRoutes>`, after the existing catalog routes:

```typescript
      <Route path="/codeinsight/usage" element={<TokenUsagePage />} />
```

- [ ] **Step 2: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 3: Start the dev server and test the page**

Run: `pnpm dev:backend` and `pnpm dev:app`

Navigate to `http://localhost:3000/codeinsight/usage`

Verify:
- Page renders with "Token Usage" header
- Time range toggle works (7d / 30d / All)
- If no data: shows 0 tokens, $0.00, 0 repos (empty state)
- If data exists from previous ingestions: shows populated stats

- [ ] **Step 4: Commit**

```bash
git add dev/app/src/App.tsx
git commit -m "feat(dev): wire TokenUsagePage into dev app at /codeinsight/usage"
```

---

## Task 9: Frontend Unit Test

**Files:**
- Create: `packages/backstage/plugin/src/components/TokenUsagePage.test.tsx`

- [ ] **Step 1: Write the test**

Create `packages/backstage/plugin/src/components/TokenUsagePage.test.tsx`:

```tsx
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { codeInsightApiRef, CodeInsightApi, TokenUsageStats } from '../api';

import { TokenUsagePage } from './TokenUsagePage';

const mockStats: TokenUsageStats = {
  timeRange: '30d',
  totalTokens: 1_234_567,
  totalEstimatedCost: 3.7,
  byModel: [
    { model: 'claude-sonnet-4-20250514', tokens: 1_000_000, estimatedCost: 3.0 },
    { model: 'llm', tokens: 234_567, estimatedCost: 0.7 },
  ],
  byRepo: [
    {
      repoId: 'org~my-repo',
      repoName: 'my-repo',
      ingestionTokens: 1_000_000,
      qnaTokens: 234_567,
      totalTokens: 1_234_567,
      estimatedCost: 3.7,
      lastActivity: new Date().toISOString(),
    },
  ],
};

const mockApi: jest.Mocked<Pick<CodeInsightApi, 'getTokenUsage'>> = {
  getTokenUsage: jest.fn().mockResolvedValue(mockStats),
};

function renderPage() {
  return renderInTestApp(
    <TestApiProvider apis={[[codeInsightApiRef, mockApi as any]]}>
      <TokenUsagePage />
    </TestApiProvider>,
  );
}

describe('TokenUsagePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getTokenUsage.mockResolvedValue(mockStats);
  });

  it('renders summary cards with formatted values', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('1.2M')).toBeInTheDocument();
      expect(screen.getByText('$3.70')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('renders model breakdown table', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument();
      expect(screen.getByText('llm')).toBeInTheDocument();
    });
  });

  it('renders repo usage table', async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument();
    });
  });

  it('fetches with default 30d range', async () => {
    await renderPage();
    await waitFor(() => {
      expect(mockApi.getTokenUsage).toHaveBeenCalledWith('30d');
    });
  });

  it('re-fetches when time range changes', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('1.2M')).toBeInTheDocument());

    const emptyStats = { ...mockStats, totalTokens: 0, byModel: [], byRepo: [] };
    mockApi.getTokenUsage.mockResolvedValue(emptyStats);

    const sevenDayButton = screen.getByText('Last 7 days');
    await userEvent.click(sevenDayButton);

    await waitFor(() => {
      expect(mockApi.getTokenUsage).toHaveBeenCalledWith('7d');
    });
  });

  it('shows error message on API failure', async () => {
    mockApi.getTokenUsage.mockRejectedValue(new Error('Network error'));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @codeinsight/plugin test -- --testPathPattern=TokenUsagePage`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backstage/plugin/src/components/TokenUsagePage.test.tsx
git commit -m "test(plugin): add unit tests for TokenUsagePage component"
```

---

## Task 10: Lint & Final Verification

- [ ] **Step 1: Run linter across all packages**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 4: Fix any issues found in steps 1-3, then commit**

If any lint errors or test failures: fix them and commit with:

```bash
git commit -m "fix: lint and test fixes for token usage dashboard"
```

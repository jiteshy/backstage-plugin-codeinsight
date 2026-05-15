# Token Usage Dashboard — Design Spec

## Overview

A global Backstage admin page at `/codeinsight/usage` that shows aggregated token usage across all registered repos, with model-aware cost estimates and per-repo breakdown. Uses direct SQL aggregation over existing tables with an API contract designed for a future rollup table swap.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Placement | Global admin page (`/codeinsight/usage`) | Cross-repo visibility, not scoped to one entity |
| Cost estimation | Model-aware, single token count | 80% accuracy without `LLMClient` interface changes |
| Time ranges | Fixed buckets: 7d, 30d, all | Simplest UX, covers common cases |
| Cache metrics | Deferred | Requires schema changes, not core value |
| Repo breakdown | Sortable table | Standard Backstage admin pattern, scales well |
| Data source | Direct SQL aggregation (Approach C) | Ships fast; contract supports future rollup table |

## Data Types

```typescript
// In @codeinsight/types

type UsageTimeRange = '7d' | '30d' | 'all';

interface RepoUsageRow {
  repoId: string;
  repoName: string;
  ingestionTokens: number;
  qnaTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastActivity: Date | null;
}

interface ModelBreakdown {
  model: string;
  tokens: number;
  estimatedCost: number;
}

interface TokenUsageStats {
  timeRange: UsageTimeRange;
  totalTokens: number;
  totalEstimatedCost: number;
  byModel: ModelBreakdown[];
  byRepo: RepoUsageRow[];
}
```

## Backend

### StorageAdapter

New method on the interface:

```typescript
interface StorageAdapter {
  getTokenUsageStats(
    timeRange: UsageTimeRange,
    costMap: Record<string, number>,
  ): Promise<TokenUsageStats>;
}
```

### KnexStorageAdapter Implementation

Runs three queries:

1. **Ingestion tokens by repo** — Aggregates `ci_artifacts.tokens_used` where `llm_used = true`, filtered by `generated_at` within the time range. Joins `ci_repositories` for repo name. Groups by `repo_id`.

2. **QnA tokens by repo** — Aggregates `ci_qna_messages.tokens_used`, joined through `ci_qna_sessions` for `repo_id`. Filters by `ci_qna_messages.created_at` within the time range. Groups by `repo_id`.

3. **Model breakdown** — Queries `ci_artifacts` where `llm_used = true`, extracts model name from `generation_sig` (format `"{modelName}:{promptVersion}"`, split on `:`). Groups by model. For QnA tokens, groups under a generic `"llm"` label (no model column on `ci_qna_messages` currently).

Cost calculation: `(tokens / 1_000_000) * costMap[model]`. Unknown models fall back to `costMap['default']` or the highest configured rate.

Merges the three result sets in application code into a single `TokenUsageStats` response.

### Route

```
GET /api/codeinsight/usage?range=7d|30d|all
```

Thin handler. Reads `costMap` from Backstage config, calls `storage.getTokenUsageStats(range, costMap)`, returns JSON.

### Config

```yaml
codeinsight:
  usage:
    costPerMillionTokens:
      claude-sonnet-4-20250514: 3.0
      claude-haiku-4-5-20251001: 0.25
      text-embedding-3-small: 0.02
      default: 3.0
```

Config type addition:

```typescript
interface UsageConfig {
  costPerMillionTokens: Record<string, number>;
}

interface CodeInsightConfig {
  // ... existing fields ...
  usage?: UsageConfig;
}
```

`config.d.ts` updated to register the `codeinsight.usage` namespace. Defaults to `{ default: 3.0 }` if not configured.

## Frontend

### Page Registration

New standalone Backstage page at `/codeinsight/usage`, registered via `createRoutableExtension`. Not an entity tab. Accessible from sidebar or direct URL.

### Component Tree

```
TokenUsagePage
├── UsageHeader              — Title + ToggleButtonGroup (7d / 30d / All)
├── UsageSummaryBar          — Three stat cards: Total Tokens, Estimated Cost, Repos Active
├── ModelBreakdownTable      — Compact table: Model | Tokens | Cost (sorted by tokens desc)
└── RepoUsageTable           — Main table with sortable columns (Backstage Table component)
```

### RepoUsageTable Columns

| Column | Sortable | Notes |
|--------|----------|-------|
| Repo Name | Yes | Links to entity page |
| Ingestion Tokens | Yes | |
| QnA Tokens | Yes | |
| Total Tokens | Yes | Default sort, descending |
| Estimated Cost | Yes | Formatted as `$X.XX` |
| Last Activity | Yes | Relative time (e.g., "2 days ago") |

### API Hook

`useTokenUsage(range: UsageTimeRange)` in the frontend API client. Calls `GET /usage?range=...`, returns `{ data: TokenUsageStats | null, loading: boolean, error: Error | null }`.

### Dev App

Page route registered in the dev app for local testing.

## Bug Fix: CachingLLMClient tokens_used

The `CachingLLMClient` currently writes `tokens_used: 0` to `ci_llm_cache`. Fix: estimate token count as `Math.ceil(response.length / 4)` before writing to cache. This is a rough heuristic, not an interface change. Only affects the cache table, not the dashboard's primary data sources (`ci_artifacts` and `ci_qna_messages`).

## Out of Scope

- Cache hit rate metrics (requires schema changes)
- Input/output token split (requires `LLMClient` interface changes)
- Real-time updates (no WebSocket/polling)
- CSV export
- Usage alerts or budget thresholds
- Per-user breakdown
- Rollup table migration (direct SQL for now, interface supports future swap)

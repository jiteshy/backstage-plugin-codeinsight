# Phase 5.1 Review Notes — Embedding Client + Cache

## Package: `@codeinsight/embeddings`
- Location: `packages/adapters/embeddings/`
- Mirrors `@codeinsight/llm` structure exactly: OpenAIEmbeddingClient, CachingEmbeddingClient, createEmbeddingClient, index.ts
- Framework-agnostic: zero @backstage/* imports. Clean.
- Config injected via constructor. Clean.

## Known Issues Found in Phase 5.1 Review

### MAJOR — Cache reads missing `model_used` filter (CachingEmbeddingClient.ts line 49-51)
The `whereIn('content_sha', shas)` query has no `.andWhere('model_used', this.modelName)` clause.
If operator switches models (e.g. text-embedding-3-small → text-embedding-3-large), wrong-dimension
embeddings will be returned from cache silently. Fix: add model filter to read query AND change
conflict target from `('content_sha')` to composite `('content_sha', 'model_used')` on writes.
This also requires updating the migration (007_ci_cache.ts) to use a composite PK.

### MAJOR — VECTOR(1536) hardcoded in migration 007_ci_cache.ts line 32
EmbeddingConfig.dimensions is configurable. text-embedding-3-large → 3072 dims; 3-small → up to 3072.
Hardcoding 1536 causes insert failures for any non-default dimension config.
Fix: use VECTOR(3072) as safe upper bound, or add follow-up migration 010_embedding_cache_widen.ts.

### MAJOR — config.d.ts missing `dimensions` field for `codeinsight.embeddings`
plugin.ts line 136 reads `codeinsight.embeddings.dimensions` but config.d.ts doesn't declare it.
Backstage will reject this key in app-config.yaml at validation. Fix: add `dimensions?: number` to
the embeddings block in config.d.ts.

### MINOR — Missing test script + devDependencies in package.json (same gap as @codeinsight/llm)
No `test` script, no jest/ts-jest/@types/jest in devDeps.
`pnpm --filter @codeinsight/embeddings test` will error. Tests only run via root jest config.

### MINOR — tsconfig.json doesn't exclude __tests__ (same gap as @codeinsight/llm)
Test files compiled into dist/. Add `"src/**/__tests__"` to exclude array.

### MINOR — parseEmbedding fallback branch is dead code
EmbeddingCacheRow.embedding is typed `string`, so `typeof raw !== 'string'` can never be true.
Either remove the fallback or change the type to `string | number[]` with proper Array.isArray guard.

### MINOR — Duplicate-text test has misleading comment
CachingEmbeddingClient.test.ts lines 230-233: comment says "cache handles it on the second occurrence"
but both duplicates are cache misses (mock returns []). Also missing: assertion that inner.embed
was called with [text, text].

## Still-Open Issues from Previous Phases
- config.d.ts diagramGen block: STILL OPEN (flagged in Phase 3 and Phase 4.1 reviews)
  Now fixed only by adding dimensions field — the diagramGen keys remain undeclared.

## Pattern Notes
- CachingEmbeddingClient uses SHA256(text) as cache key (content-only, no model baked in)
  — DIFFERENT from CachingLLMClient which uses SHA256(systemPrompt + userPrompt + model)
  — This design requires model_used filter on reads (currently missing — see bug above)
- storeCacheEntries uses BATCH_SIZE=50 loop — good practice, fills gap from LLM caching layer
- Result reassembly uses missIdx counter (correct) and cacheMap.get() truthiness (imprecise — prefer !== undefined)
- onConflict('content_sha').ignore() on writes — correct for idempotency once model filter is also in PK
- embeddingClient is optional in plugin.ts (same pattern as llmClient) — correct for Phase 5.1 scope
- embeddingClient not yet wired into any service — intentional, QnA services are Phase 5.2+

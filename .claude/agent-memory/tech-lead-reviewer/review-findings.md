# Review Findings Log

---

## Phase 1 Holistic Review (2026-03-18)
Verdict: YELLOW (approve with 2 must-fix issues)

### Must Fix
1. 3 failing integration tests on main -- `IngestionService.integration.test.ts:366` expects 'completed' but gets 'partial' (legitimate behavior for mixed-language repos)
2. Shallow clone (depth=1 default) breaks delta `getChangedFiles` -- `IngestionService.runPipeline()` doesn't pass `deltaDepth` to clone when `lastCommitSha` exists

### Important (fix at Phase 2 start)
1. StorageAdapter missing artifact input/staleness methods Phase 2 needs
2. Artifact.content too loosely typed (Record<string,unknown>) -- needs discriminated unions
3. JobQueue interface defined but not implemented -- IngestionService acts as queue
4. Frontend EntityCodeInsightContent has hardcoded entity.kind guard

### Strengths Confirmed
- Zero @backstage/* imports in core/ or adapters/ (grep-verified)
- Backstage new backend system used correctly
- 510 tests total, 507 pass
- Clean DB schema with proper FKs, indexes, cascade deletes
- Config always injected, no process.env in core/adapters

---

## Phase 2 Documentation Generation Review (2026-03-20)
Verdict: YELLOW (1 critical gap, proceed after fix)

### Critical
1. DocGenerationService exists in packages/core/doc-generator/ but is NOT wired into the backend plugin composition root or the ingestion pipeline. No code path ever calls generateDocs(). The /repos/:repoId/docs endpoint will always return []. Fix: wire into IngestionService.runPipeline() after CIG build and staleness sweep, before cloneDir cleanup.

### Important
1. LLM cache key implementation (SHA256 of rendered prompts + model) diverges from spec (SHA256 of prompt_file_sha + input_sha + model). Implementation is correct for current architecture but spec needs updating.
2. Prompts hardcoded in PromptRegistry.ts, not loaded from prompts/*.md files. Acceptable for v1 but .md files should be marked as design specs.
3. promptVersion always null on artifacts -- prompt versioning deferred.

### Strengths Confirmed
- Zero @backstage/* imports in core/ or adapters/ (grep-verified)
- 604 unit tests pass (24 suites), 3 integration suites need Postgres (expected)
- Discriminated union types for ArtifactContent (DocContent/DiagramContent/QnAChunkContent)
- Staleness cascade with fixed-point termination (handles cycles)
- CachingLLMClient: transparent, best-effort writes, null-byte separators
- ContextBuilder: path traversal protection, lazy repoFileMap, 13 module builders
- InProcessJobQueue with semaphore-based concurrency
- Frontend: proper annotation-driven, polling, stale indicators
- Config always injected, no process.env in core/adapters

---

# Pre-Implementation Design Review Findings

Date: 2026-03-07
Verdict: YELLOW (approve with fixes)

## Required Fixes Before Coding
1. Fix `.gitignore` -- remove `docs`, `.claude`, `Claude.md` exclusions
2. Reconcile `RepoConnector` interface (llm-context.md vs build-plan.md)
3. Reconcile `LLMClient` interface (ensure `stream()` method included from day one)
4. Add `tenant_id TEXT NOT NULL DEFAULT 'default'` to ALL schema DDL in llm-context.md
5. Add explicit PKs, FKs, indexes to schema definitions

## Important Improvements
- Define full `StorageAdapter` method set (at least for Phase 1)
- Add error handling strategy section to llm-context.md
- Create shared types package (`@codeinsight/types`)
- Phase 1.3: implement GitHub connector only (defer GitLab, Bitbucket)
- Define testing strategy (framework, mock approach, fixtures)
- Specify monorepo tooling as explicit first task

## Risks Identified
- Tree-sitter native compilation across platforms (macOS ARM, Linux, Alpine)
- pgvector extension not available in all Postgres deployments
- `ci_artifacts` JSONB content column needs TypeScript type enforcement
- Backstage Knex migration may not support CREATE EXTENSION

## Doc Inconsistencies
- build-plan.md line 539: `claude-sonnet-4-6` not a real model name
- architecture-guide.md vs llm-context.md: repo connector approach (ScmIntegration vs direct)
- QnA/embedding tables created in Phase 1 migrations but only used in Phase 4 -- document why
- llm-context.md should explicitly state new backend system requirement

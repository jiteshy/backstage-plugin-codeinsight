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

## Phase 2 Documentation Generation Review (2026-03-20) — First Pass
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

## Phase 2 Completion Review / Phase 3 Readiness (2026-03-20) — Second Pass
Verdict: GREEN (ready to proceed to Phase 3)

All previous YELLOW issues resolved. DocGenerationService wired. RetryingLLMClient added. UI redesigned into unified tab.

### Carried Debt (non-blocking)
1. No ErrorApi/AlertApi in frontend -- errors shown inline (functional, not idiomatic)
2. deleteRepoFilesNotIn defined in StorageAdapter but never called -- orphan file cleanup missing
3. GET /repos/:repoId/docs has N+1 query (getArtifactInputs per artifact)
4. No frontend component tests (only API client tests)
5. 35 lint warnings in test files (all no-explicit-any)
6. promptVersion always null

### Phase 3 Readiness Assessment
- DiagramContent discriminated union already defined in data.ts
- getArtifactsByType('diagram') already implemented in KnexStorageAdapter
- CIG nodes/edges available (dependency graph, schema nodes, route nodes)
- LLM client + cache + retry chain ready for LLM-assisted diagrams
- Unified frontend already has Diagrams tab placeholder ("Coming soon")
- Phase 3 build plan (3.1-3.5) is well-scoped and has clear acceptance criteria
- Phase 3 can reuse DocGenerationService patterns: Semaphore, ContextBuilder, PromptRegistry

---

## Phase 3 Diagram Generation Review (2026-03-20)
Verdict: YELLOW (diagram portfolio value gap; proceed with Phase 3.6 revision)

### Critical
1. Only DependencyGraphModule is always-on. Without LLM, detectedSignals is always {} (docGenerator is undefined, so classifier never runs), meaning 6 of 7 modules never produce output. Users without LLM see exactly 1 diagram every time. Fix: AST-based signal detector + make more modules always-on.
2. computeInputSha is identical for all modules (ignores module param) -- forces full regeneration of all diagrams on any CIG change.

### Important
1. DependencyGraphModule has O(E*N) node lookups (use Map like ComponentHierarchyModule)
2. No diagnostic logging when signal-gated modules are skipped
3. Mermaid securityLevel:'loose' is unnecessary risk
4. DiagramSection API response missing description field
5. RequestLifecycleModule and StateFlowModule produce low-value output (LLM guessing from names)

### Proposed Phase 3.6 Additions
- AST-based signal detector (scan file paths for patterns)
- Module/Package Boundary Diagram (always-on, workspace deps)
- Circular Dependency Detection diagram (always-on, DFS on import edges)
- Make ComponentHierarchyModule always-on

### Strengths Confirmed
- Zero @backstage/* imports in core/ or adapters/ (grep-verified)
- DiagramModule interface is clean and extensible
- Error isolation: each module in try/catch, diagram gen non-fatal in pipeline
- Duck-typed DiagramGenerator in IngestionService (no cross-package import)
- 69 new tests, thorough DiagramGenerationService coverage
- Frontend: async mermaid import, error fallback, AST/AI badge, responsive grid
- Config always injected, no process.env

---

## Phase 5 QnA Pipeline Holistic Review (2026-03-26)
Verdict: YELLOW (2 critical must-fix issues)

### Critical
1. IndexingService NOT WIRED into composition root. plugin.ts creates IngestionService with 8 args, missing the 9th (indexer). ci_qna_embeddings will always be empty. QnA answers will always say "not enough context." Same class of bug as Phase 2 (DocGenerationService) and Phase 3. Fix: import IndexingService, instantiate, pass as 9th arg.
2. Vector dimension mismatch: migration 011 creates VECTOR(3072) but config.d.ts documents 1536 default and build plan says text-embedding-3-small. Users following defaults will get Postgres errors on upsert.

### Important
1. config.d.ts missing qna.* config namespace (5 settings read in plugin.ts but not declared)
2. IVFFlat index created on empty table -- useless clustering. Switch to HNSW.
3. SSE streaming endpoint doesn't handle client disconnect -- LLM keeps running.
4. No frontend error boundary around MarkdownContent in QnA chat.
5. QnAService.extractSources is public but should be private.

### Strengths Confirmed
- Zero @backstage/* imports in core/adapters (grep-verified)
- Clean 5-package decomposition: chunking, indexing, qna, vector-store, embeddings
- Three-path retrieval with independent error isolation
- Context assembly with CIG expansion (callees, imports, doc links)
- Token budget enforcement with tail-drop
- Streaming via AsyncGenerator + SSE + ReadableStream parsing
- Session management with active context accumulation + history compression
- Delta indexing (content-addressed, stale chunk cleanup)
- 105+ QnA-specific unit tests across 3 core test files
- Duck-typed Indexer interface in IngestionService (no cross-package import)
- Config always injected, no process.env in core/adapters

### Recurring Pattern: Composition Root Wiring Gap
This is the THIRD time a service was fully implemented but not wired:
- Phase 2: DocGenerationService not wired
- Phase 3: DiagramGenerationService (was wired, but signals not wired)
- Phase 5: IndexingService not wired
Recommendation: Add a composition root integration test or startup assertion.

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

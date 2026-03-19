# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10 merged to main) as of 2026-03-18
- Phase 1 holistic review 2026-03-18: YELLOW (2 must-fix before Phase 2)
- Next: Fix failing tests + shallow clone bug, then start Phase 2
- See `review-findings.md` for detailed review history

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers (CIG section added 2026-03-11)
- `CLAUDE.md` -- project instructions and hard rules

## Phase 1 Completion -- Outstanding Issues
- 3 failing integration tests on main (IngestionService.integration.test.ts) -- expects 'completed' but gets 'partial'
- Shallow clone (depth=1) breaks delta `getChangedFiles` -- old SHA not in history
- StorageAdapter missing 4 methods for Phase 2: artifact inputs CRUD, staleness marking, getByType
- Artifact.content typed as Record<string,unknown> -- needs discriminated unions for Phase 2
- JobQueue interface defined but never implemented -- IngestionService acts as queue directly
- No `deleteRepoFilesNotIn` for cleaning stale file records on full runs
- Frontend EntityCodeInsightContent has hardcoded entity.kind guard -- should let consumer control

## Older Items (from 1.7 review, still valid)
- `resolveImportPath` in TypeScriptExtractor creates new Set per call -- O(n^2), should hoist
- `extends`/`implements` edges not yet extracted (TS classes) -- flag for Phase 3

## Architectural Decisions (Established -- Do Not Re-litigate)
- CIG built via Tree-sitter AST, zero LLM, shared by all 3 features
- Unified `ci_artifacts` table for docs, diagrams, QnA chunks
- Composite SHA: `SHA256(sorted "filepath:sha" pairs joined by "|")`
- LLM cache key: `SHA256(prompt_file_sha + input_sha + model_name)`
- pgvector over standalone vector DB
- Modular prompts -- one file per doc section
- 40% threshold for full vs delta ingestion
- Multi-layer QnA index (5 layers)
- Framework-agnostic core: `core/` and `adapters/` have ZERO `@backstage/*` imports
- No tenant_id -- self-hosted, infrastructure isolation
- New Backstage backend system (`createBackendPlugin`), not legacy `createRouter`

## Package Structure
- `packages/core/` -- pure business logic, zero framework deps
- `packages/adapters/` -- pluggable I/O implementations
- `packages/backstage/` -- thin Backstage delivery wrapper
- `@codeinsight/types` under core/ for shared types + interfaces

## CIG Builder Architecture (confirmed 2026-03-11)
- Two-pass: Pass 1 symbols, Pass 2 edges (needs cross-file nodesByFile map)
- `LanguageExtractor` (Tree-sitter AST) vs `ContentExtractor` (raw string) interfaces
- TypeScriptExtractor: TS/TSX/JS -- symbols, routes, import/export edges
- PrismaExtractor: regex-based ContentExtractor -- models, enums, relation edges
- EntryPointDetector: post-build analysis using fan-in/fan-out + filename heuristics
- FrameworkSignalDetector: package.json analysis, 5 categories
- CIGPersistenceService: full/delta persistence via StorageAdapter
- `<module>` anchor nodes per file for file-level import edges
- nodeId format: `repoId:filePath:symbolName:symbolType` (deterministic, human-readable)
- Route nodeId uses `#` separator: `repoId:filePath:GET#/path:route`

## Review Pattern: Recurring Issues
- Phantom dependencies in monorepo (imports work via hoisting but not declared in package.json)
- `.gitignore` excludes docs/ and .claude/ -- user wants local only, skip this issue
- Integration tests asserting exact status without accounting for mixed-language file skips
- Shallow clone depth not propagated for delta runs (default depth=1 insufficient)

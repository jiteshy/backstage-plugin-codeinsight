# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 COMPLETE (all 2.0-2.8 sub-phases done) -- GREEN verdict 2026-03-20
- Previous YELLOW issues all resolved: DocGenService wired, RetryingLLMClient added, UI redesigned
- Phase 3 (Diagram Generation) ready to start
- See `review-findings.md` for detailed review history

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers
- `CLAUDE.md` -- project instructions and hard rules

## Phase 2 Resolved Items
- DocGenerationService wired into IngestionService.runPipeline() + plugin.ts composition root
- RetryingLLMClient added (rate-limit backoff, 10s/20s/40s + jitter, retry-after header support)
- EntityDocumentationTab collapsed into unified EntityCodeInsightContent (single tab, inner tabs)
- LLM cache key: rendered prompt text, not prompt_file_sha (spec updated to match)
- Prompts hardcoded in PromptRegistry.ts (design spec .md files kept separately)
- promptVersion always null -- deferred, acceptable for v1

## Known Debt Entering Phase 3
1. No ErrorApi/AlertApi usage in frontend (errors shown inline, functional but not Backstage-idiomatic)
2. deleteRepoFilesNotIn defined in interface but not called from IngestionService (orphan file cleanup missing)
3. GET /repos/:repoId/docs has N+1 query pattern (getArtifactInputs per artifact)
4. Frontend tests missing (only API client tests, no component tests)
5. 35 lint warnings in test files (all `no-explicit-any`, no errors)

## Architectural Decisions (Established -- Do Not Re-litigate)
- CIG built via Tree-sitter AST, zero LLM, shared by all 3 features
- Unified `ci_artifacts` table for docs, diagrams, QnA chunks
- Composite SHA: `SHA256(sorted "filepath:sha" pairs joined by "|")`
- LLM cache key: actual impl is SHA256(systemPrompt+'\x00'+userPrompt+'\x00'+modelName)
- pgvector over standalone vector DB
- Modular prompts -- one file per doc section (runtime: hardcoded in PromptRegistry)
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

## Phase 2 Package Map
- `packages/adapters/llm/` -- AnthropicLLMClient, OpenAILLMClient, CachingLLMClient, createLLMClient
- `packages/core/doc-generator/` -- ClassifierService, DocGenerationService, ContextBuilder, PromptRegistry
- `packages/core/ingestion/src/StalenessService.ts` -- staleness sweep + cascade
- `packages/backstage/plugin/src/components/EntityDocumentationTab.tsx` -- frontend tab
- `packages/backstage/plugin-backend/src/router.ts` -- GET /repos/:repoId/docs endpoint

## Review Pattern: Recurring Issues
- Services implemented but not wired into composition root/pipeline (check end-to-end paths!)
- Spec documents diverge from implementation over time (cache keys, prompt loading)
- `.gitignore` excludes docs/ and .claude/ -- user wants local only, skip this issue
- Integration tests asserting exact status without accounting for mixed-language file skips

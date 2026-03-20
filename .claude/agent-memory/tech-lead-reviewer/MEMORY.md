# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 YELLOW verdict (2026-03-20): 1 critical gap (DocGenerationService not wired)
- All Phase 2 sub-phases 2.0-2.7 code exists but end-to-end not functional
- See `review-findings.md` for detailed review history

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers
- `CLAUDE.md` -- project instructions and hard rules

## Phase 2 Outstanding Issues
1. **CRITICAL**: DocGenerationService not wired into backend/ingestion pipeline -- docs never generated
2. **IMPORTANT**: LLM cache key diverges from spec (actual: SHA256(sysPrompt+userPrompt+model), spec: SHA256(prompt_file_sha+input_sha+model))
3. Prompts hardcoded in PromptRegistry.ts, not loaded from prompts/*.md files at runtime
4. EntityDocumentationTab not registered as Backstage extension (just exported component)
5. promptVersion always null -- prompt versioning deferred
6. No LLM retry logic (deferred to Phase 5.4)

## Phase 2 Test Status
- 604 unit tests pass (24 suites)
- 3 integration test suites fail (need Postgres on port 5433, expected)
- Key test files: DocGenerationService.test.ts (8), ClassifierService.test.ts (20), ContextBuilder.test.ts (8), PromptRegistry.test.ts (7), StalenessService.test.ts (12), CachingLLMClient.test.ts, router.test.ts (18)

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

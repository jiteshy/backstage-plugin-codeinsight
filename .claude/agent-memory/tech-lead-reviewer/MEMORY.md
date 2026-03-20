# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 COMPLETE (all 2.0-2.8 sub-phases done) -- GREEN verdict 2026-03-20
- Phase 3 COMPLETE (all 3.1-3.5 sub-phases done) -- YELLOW verdict 2026-03-20
- Phase 3 needs Phase 3.6 revision (diagram value gap) before Phase 4
- See `review-findings.md` for detailed review history

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers
- `CLAUDE.md` -- project instructions and hard rules

## Phase 3 Review Findings (2026-03-20)
- YELLOW: architecturally sound but diagram portfolio has critical value gap
- Only DependencyGraphModule is always-on; other 6 require classifier signals
- Without LLM: detectedSignals={} so only DependencyGraphModule produces output
- RequestLifecycleModule and StateFlowModule are low-value (LLM guessing from names)
- computeInputSha is identical for all modules (not module-aware)
- DependencyGraphModule has O(E*N) node lookups (use Map like ComponentHierarchyModule)
- Mermaid securityLevel:'loose' should be removed
- DiagramSection API response missing description field
- No diagnostic logging for skipped modules (why diagrams are missing)

## Phase 3.6 Revision Items (Must Fix)
1. AST-based signal detector (scan CIG file paths for patterns when detectedSignals empty)
2. Make ComponentHierarchyModule always-on (already returns null when not applicable)
3. Add Module/Package Boundary Diagram (always-on, pure AST, workspace deps)
4. Add Circular Dependency Detection diagram (always-on, pure AST, DFS on import edges)
5. Fix DependencyGraphModule O(E*N) node lookups
6. Add diagnostic logging for skipped modules
7. Remove securityLevel:'loose' from Mermaid init
8. Include description in diagram API response

## Phase 3 Package Map
- `packages/core/diagram-gen/` -- DiagramGenerationService, DiagramRegistry, 7 modules
- 3 pure AST: DependencyGraphModule, ErDiagramModule, ComponentHierarchyModule
- 4 LLM-assisted: ApiFlowModule, RequestLifecycleModule, CiCdPipelineModule, StateFlowModule
- DiagramGenerator duck-type interface defined locally in IngestionService (no cross-package import)

## Known Debt Entering Phase 4
1. No ErrorApi/AlertApi usage in frontend (errors shown inline)
2. GET /repos/:repoId/docs has N+1 query pattern
3. Frontend tests missing (only API client tests)
4. 35 lint warnings in test files (all no-explicit-any)
5. Diagram value gap (Phase 3.6 items above)
6. Diagram computeInputSha not module-aware (forces full regen on any CIG change)

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

## Review Pattern: Recurring Issues
- Services implemented but not wired into composition root/pipeline (check end-to-end paths!)
- Spec documents diverge from implementation over time (cache keys, prompt loading)
- Signal-gated features silently produce no output when signals missing (add diagnostics!)
- AST modules with linear node lookups instead of Map-based O(1) lookups
- `.gitignore` excludes docs/ and .claude/ -- user wants local only, skip this issue

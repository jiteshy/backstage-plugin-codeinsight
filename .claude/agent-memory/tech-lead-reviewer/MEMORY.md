# Tech Lead Reviewer Memory

## Project Status
- Phases 1-5 ALL COMPLETE
- Phase 5 QnA Pipeline review 2026-03-26: YELLOW (2 critical must-fix)
  - IndexingService not wired into composition root (QnA dead on arrival)
  - Vector dimension mismatch: migration=VECTOR(3072), default config=1536
- See `review-findings.md` for detailed review history

## Phase Renumbering (effective 2026-03-20)
- Phase 4 = Diagram Overhaul (Value & UX) -- COMPLETE
- Phase 5 = QnA Pipeline (was Phase 4)
- Phase 6 = Integration & Cross-Feature (was Phase 5)
- Phase 7 = Open Source Release (was Phase 6)

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers
- `CLAUDE.md` -- project instructions and hard rules

## Phase 4 Review Findings (final 2026-03-24) -- GREEN
- 5 sub-phases: 4.1 types+signals, 4.2 new modules, 4.3 registry, 4.4 frontend UI, 4.5 pruning+auth-flow
- Final 7-module portfolio (pruned from 9)
- Post-4.4 fixes: nodeMap click handler (SVG id extraction), token estimation (diagram.llmUsed), 404 handling
- Phase 4.5 removed 3 low-value AST modules, added AuthFlowModule (LLM, auth:* signals)
- 264 diagram-gen tests pass across 15 test suites

## Phase 4 Module Portfolio (final, post-4.5)
- Always-on AST: circular-dependencies (null if clean)
- Always-on LLM: high-level-architecture
- Signal-gated AST: er-diagram (orm:prisma)
- Signal-gated hybrid: api-entity-mapping (framework:express/...), state-management (state-management:*)
- Signal-gated LLM: deployment-infra (ci:*/infra:*), auth-flow (auth:*)
- Legacy (exported but not registered): dependency-graph, module-boundaries, package-boundaries, component-hierarchy, api-flow, ci-cd-pipeline, state-flow, request-lifecycle

## Known Debt Entering Phase 6
1. computeInputSha hashes full CIG per module (not filtered to relevant nodes)
2. No ErrorApi/AlertApi usage in frontend (errors shown inline)
3. GET /repos/:repoId/docs has N+1 query pattern
4. 35+ lint warnings in test files (all no-explicit-any)
5. CIG lookup in RetrievalService loads ALL nodes per query (O(N) scan)
6. IVFFlat index on empty table -- should switch to HNSW
7. No rate limiting on QnA ask endpoint
8. History compression LLM call not tracked in token usage
9. SSE streaming does not handle client disconnect (wastes LLM tokens)

## Architectural Decisions (Established -- Do Not Re-litigate)
- CIG built via Tree-sitter AST, zero LLM, shared by all 3 features
- Unified `ci_artifacts` table for docs, diagrams, QnA chunks
- Composite SHA: `SHA256(sorted "filepath:sha" pairs joined by "|")`
- LLM cache key: SHA256(systemPrompt+'\x00'+userPrompt+'\x00'+modelName)
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
- Spec documents diverge from implementation over time (cache keys, prompt loading, phase numbers)
- Signal-gated features silently produce no output when signals missing (add diagnostics!)
- Module overlap risk: new modules may duplicate existing ones (module-boundaries vs package-boundaries)
- Hybrid modules (llmNeeded=false but accept optional LLM) need special handling for token metrics
- DOM-based post-render wiring (clickable nodes) is fragile -- test with real Mermaid output
- `.gitignore` excludes docs/ and .claude/ -- user wants local only, skip this issue

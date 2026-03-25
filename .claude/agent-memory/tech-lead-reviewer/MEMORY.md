# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 COMPLETE (all 2.0-2.8 sub-phases done) -- GREEN verdict 2026-03-20
- Phase 3 COMPLETE (all 3.1-3.6 sub-phases done) -- 3.6 hardening resolved all YELLOW items
- Phase 4 COMPLETE (all 4.1-4.4 sub-phases done) -- GREEN verdict 2026-03-20
- 940 tests pass across full suite (42 test suites)
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

## Phase 4 Review Findings (2026-03-20) -- GREEN
- 4 sub-phases: 4.1 types+signals, 4.2 new modules, 4.3 registry, 4.4 frontend UI
- 9-module portfolio: 4 always-on AST + 1 always-on LLM + 1 signal-gated AST + 3 signal-gated hybrid/LLM
- nodeMap flows cleanly: MermaidDiagram -> DiagramContent (JSONB) -> API -> frontend
- MermaidDiagramViewer: zoom/pan, fullscreen Dialog, clickable nodes, SVG download, 30 tests
- Two carry-forward issues:
  1. Clickable nodes match on SVG label text but nodeMap keys are sanitized IDs (mismatch)
  2. Token estimation uses module.llmNeeded not diagram.llmUsed (hybrid modules undercount)

## Phase 4 Module Portfolio (post-4.3)
- Always-on AST: dependency-graph, module-boundaries, circular-dependencies, package-boundaries
- Always-on LLM: high-level-architecture
- Signal-gated AST: er-diagram (orm:prisma)
- Signal-gated hybrid: state-management (state-management:*), api-entity-mapping (framework:express/...)
- Signal-gated LLM: deployment-infra (ci:*/infra:*)
- Legacy (exported but not registered): component-hierarchy, api-flow, ci-cd-pipeline, state-flow, request-lifecycle

## Known Debt Entering Phase 5
1. nodeMap click matching: label text vs node ID mismatch (Phase 4 review issue #1)
2. Token estimation: hybrid modules undercount (Phase 4 review issue #2)
3. computeInputSha hashes full CIG per module (not filtered to relevant nodes)
4. No ErrorApi/AlertApi usage in frontend (errors shown inline)
5. GET /repos/:repoId/docs has N+1 query pattern
6. 35+ lint warnings in test files (all no-explicit-any)

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

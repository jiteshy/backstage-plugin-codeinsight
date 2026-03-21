# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 COMPLETE (all 2.0-2.8 sub-phases done) -- GREEN verdict 2026-03-20
- Phase 3 COMPLETE (all 3.1-3.6 sub-phases done) -- 3.6 hardening resolved all YELLOW items
- Phase 4 (Diagram Overhaul) plan reviewed 2026-03-20 -- GREEN verdict, approved to proceed
- See `review-findings.md` for detailed review history

## Phase Renumbering (effective 2026-03-20)
- Phase 4 = Diagram Overhaul (Value & UX) -- NEW, inserted
- Phase 5 = QnA Pipeline (was Phase 4)
- Phase 6 = Integration & Cross-Feature (was Phase 5)
- Phase 7 = Open Source Release (was Phase 6)
- NOTE: `llm-context.md` still has OLD numbering (Phase 4=QnA) -- must update before coding

## Key Files
- `docs/llm-context.md` -- single source of truth for all technical decisions
- `docs/build-plan.md` -- phase-by-phase task list
- `docs/architecture-guide.md` -- onboarding doc for newcomers
- `CLAUDE.md` -- project instructions and hard rules

## Phase 4 Review Findings (2026-03-20) -- GREEN
- 4 sub-phases: 4.1 types, 4.2 new modules, 4.3 registry, 4.4 frontend UI
- nodeMap (Record<string,string>) flows MermaidDiagram -> DiagramContent -> DiagramSection
- No DB migration needed (JSONB absorbs nodeMap)
- Pre-implementation fixes required:
  1. Update llm-context.md phase numbers (stale: still says Phase 4=QnA)
  2. Clarify module-boundaries vs package-boundaries overlap
- Important notes:
  - high-level-architecture is "LLM-required, always-triggered" not truly "always-on"
  - deployment-infra needs explicit triggersOn for both ci:* AND infra:* signals
  - No effort estimates in plan (~27-33h estimated in review)

## Phase 3 Package Map (current state post-3.6)
- `packages/core/diagram-gen/` -- DiagramGenerationService, DiagramRegistry, SignalDetector
- 4 always-on pure AST: dependency-graph, component-hierarchy, circular-dependencies, package-boundaries
- 1 signal-gated AST: er-diagram (orm:prisma)
- 2 signal-gated LLM: api-flow (framework:express/...), ci-cd-pipeline (ci:*)
- DiagramGenerator duck-type interface defined locally in IngestionService
- Phase 4 will add 5 modules, remove component-hierarchy+api-flow+ci-cd-pipeline from default registry

## Known Debt Entering Phase 4
1. No ErrorApi/AlertApi usage in frontend (errors shown inline)
2. GET /repos/:repoId/docs has N+1 query pattern
3. Frontend tests missing (only API client tests)
4. 35 lint warnings in test files (all no-explicit-any)
5. computeInputSha hashes full CIG per module (not filtered to relevant nodes)

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
- `.gitignore` excludes docs/ and .claude/ -- user wants local only, skip this issue

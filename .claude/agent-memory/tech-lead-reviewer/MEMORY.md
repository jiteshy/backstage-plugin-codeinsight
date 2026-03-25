# Tech Lead Reviewer Memory

## Project Status
- Phase 1 COMPLETE (all 11 sub-phases 1.0-1.10)
- Phase 2 COMPLETE (all 2.0-2.8 sub-phases done) -- GREEN verdict 2026-03-20
- Phase 3 COMPLETE (all 3.1-3.6 sub-phases done) -- 3.6 hardening resolved all YELLOW items
- Phase 4 COMPLETE (all 4.1-4.5 sub-phases done) -- GREEN verdict 2026-03-24
- 264 diagram-gen tests pass; full suite test count TBD
- Phase 5 (QnA Pipeline) ready to begin
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

## Known Debt Entering Phase 5
1. nodeMap click matching -- FIXED in Phase 4.4 post-completion (SVG id extraction)
2. Token estimation -- FIXED in Phase 4.4 post-completion (diagram.llmUsed)
3. computeInputSha hashes full CIG per module (not filtered to relevant nodes)
4. No ErrorApi/AlertApi usage in frontend (errors shown inline)
5. GET /repos/:repoId/docs has N+1 query pattern
6. 35+ lint warnings in test files (all no-explicit-any)

## Phase 5 Readiness (assessed 2026-03-24)
- EmbeddingClient + VectorStore + VectorChunk + VectorFilter interfaces: DEFINED in @codeinsight/types
- QnAChunkContent discriminated union variant: DEFINED in data.ts
- pgvector migration 007: EXISTS with forward-compatible placeholder pattern
- QnA schema (ci_qna_embeddings, ci_qna_sessions, ci_qna_messages): DESIGNED in llm-context.md
- Gaps (not blockers): QnA DB migrations, StorageAdapter QnA methods, QnA session/message types, ci_embedding_cache ALTER TABLE for VECTOR column

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

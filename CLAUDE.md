# CLAUDE.md

This file provides guidance to Claude Code when working in this repository. For full technical context read `docs/llm-context.md`. For the phase-by-phase task list see `docs/build-plan.md`.

## Commands

```bash
pnpm install                          # install all workspace deps
pnpm --filter <package> build         # build a specific package
pnpm --filter <package> test          # run tests for a package
pnpm --filter <package> test -- --testPathPattern=<file>  # run a single test file
pnpm lint                             # lint all packages
pnpm --filter <package> lint          # lint a specific package
pnpm db:migrate                       # run Knex migrations
```

## Git Commit Rules

- **No `Co-Authored-By` trailers** — never add `Co-Authored-By`, `Co-authored-by`, or any AI/Claude co-author attribution to commit messages.

## Hard Rules — Never Break These

1. **Zero `@backstage/*` imports in `core/` or `adapters/`** — if core needs something from Backstage, it must go through an interface defined in core.

2. **Config is always injected** — services receive config as constructor params. Never `process.env` or Backstage `ConfigReader` in core/adapters.

3. **All I/O behind interfaces** — LLM, embeddings, vector store, repo, storage, and job queue are TypeScript interfaces defined in core. Core never instantiates concrete adapters.

4. **HTTP handlers are thin** — route handlers only call a service method and serialize. Zero business logic in route files.

5. **No `tenant_id` in DB tables** — deployment is always self-hosted (one Postgres per deployment), so infrastructure isolation is sufficient.

## Workflow Preferences

- **Do not commit and push** after completing a task. Just complete the implementation and mark the task done in `docs/build-plan.md`.
- When asked to implement a task, mark its completion in the build plan with notes.

## Current Progress

- **Phase 1**: Foundation — ✅ COMPLETED (all 1.0–1.10 sub-phases done)
- **Phase 2**: Documentation Generation — ✅ COMPLETED (all 2.0–2.8 sub-phases done)
  - 2.0 Phase 1 Hardening — ✅ COMPLETED
  - 2.1 LLM Client + Cache — ✅ COMPLETED (`@codeinsight/llm` package)
  - 2.2 Classifier Prompt — ✅ COMPLETED (`ClassifierService` in `@codeinsight/doc-generator`)
  - 2.3 Core Prompt Modules — ✅ COMPLETED (7 prompts in `prompts/core/`)
  - 2.4 Framework-Specific Prompt Modules — ✅ COMPLETED (6 prompts in `prompts/backend/` + `prompts/frontend/`)
  - 2.5 Doc Generation Service — ✅ COMPLETED (`DocGenerationService` wired into `IngestionService.runPipeline()` + plugin composition root)
  - 2.6 Staleness Detection + Delta Docs — ✅ COMPLETED (`StalenessService`, `getArtifactIdsByFilePaths`, `getArtifactDependents`)
  - 2.7 Documentation Frontend Tab — ✅ COMPLETED (`EntityDocumentationTab`, `GET /repos/:repoId/docs`)
  - 2.8 UI Redesign & Hardening — ✅ COMPLETED (unified tab, smart button labels, TOC, back-to-top FAB, dark theme fix)
- **Phase 3**: Diagram Generation — ✅ COMPLETED (all 3.1–3.6 sub-phases done)
  - 3.1 Diagram Module Interface — ✅ COMPLETED (`DiagramModule`, `DiagramRegistry`, `createDefaultRegistry`)
  - 3.2 Pure AST Diagrams — ✅ COMPLETED (dependency-graph, er-diagram, component-hierarchy)
  - 3.3 LLM-Assisted Diagrams — ✅ COMPLETED (api-flow, request-lifecycle, ci-cd-pipeline, state-flow)
  - 3.4 Diagram Generation Service — ✅ COMPLETED (`DiagramGenerationService` wired into ingestion pipeline)
  - 3.5 Diagrams Frontend Tab — ✅ COMPLETED (Mermaid.js rendering, gallery grid, AST/AI badge, stale indicator)
  - 3.6 Diagram Portfolio Hardening — ✅ COMPLETED (`SignalDetector`, `CircularDependencyModule`, `PackageBoundaryModule`; `computeInputSha` fix; `securityLevel` fix; removed low-value LLM modules)
- **Phase 4**: Diagram Overhaul — ✅ COMPLETED (all 4.1–4.4 sub-phases done)
  - 4.1 Type System & Signal Detection Foundation — ✅ COMPLETED (`nodeMap` flow, new signals)
  - 4.2 New Diagram Modules — ✅ COMPLETED (5 new modules, 4 retrofitted with `nodeMap`)
  - 4.3 Registry & Wiring — ✅ COMPLETED (9-module default registry)
  - 4.4 Frontend UI Overhaul — ✅ COMPLETED (zoom, pan, fullscreen, clickable nodes, SVG download)
- **Phase 5**: QnA Pipeline — IN PROGRESS
  - 5.1 Embedding Client + Cache — ✅ COMPLETED (`@codeinsight/embeddings` package)
  - 5.2 Chunking Service — ✅ COMPLETED (`@codeinsight/chunking` package, 28 tests)

## Custom Agents & Skills

Project-scoped agents in `.claude/agents/`:
- `unit-test-writer` — invoked after writing new code
- `code-reviewer` — invoked after completing a feature or phase
- `tech-lead-reviewer` — invoked at phase boundaries or for architecture review; Backstage expert
- `git-commit-pusher` — invoked when a logical chunk of work is ready to commit

Skills in `.claude/skills/`:
- `/ship` — lint → code review → write tests → commit in one command
- `/lead-review [focus]` — full tech lead review with Green/Yellow/Red phase-transition verdict

# CodeInsight v2 — Evaluable, Structured, Consolidated

**Date:** 2026-04-19
**Status:** Approved (shape)
**Scope:** Full redesign of the doc / diagram / QnA pipeline. Replaces prose file summaries with structured file intelligence, introduces a repo-level cognition map, consolidates 13 doc modules → 3 and 7 diagram modules → 3, fixes QnA retrieval, introduces an eval harness, and tiers models by cost-per-unit-value. No v1 code remains after migration.

---

## 1. Goals

- **Measurable quality.** Every change proves or disproves itself against a gold set.
- **≥5× cost reduction** on full ingestion. Target: ~$3 / ~15 min for openclaw-class repos. Delta ~$0.15 / ~2 min.
- **Better output** on all three surfaces: docs, diagrams, QnA.
- **Backstage-scoped**: 3 docs, 3 diagrams, strong QnA.
- **No dead v1 code after migration.** Every v1 artifact has a deletion slot.

## 2. Non-goals

- Multi-tenant support (still self-hosted, one Postgres per deployment).
- Non-GitHub SCMs (still deferred to a later phase).
- Training or fine-tuning any model.
- Replacing Mermaid as the diagram renderer.

## 3. Guiding principles

1. **Evaluable first.** No change ships without a before/after number on the gold set.
2. **Extract structure, don't summarize prose.** Typed records beat paragraphs as context for downstream LLM calls.
3. **One plan, many workers.** A single repo-level synthesis call (RCM) decides what the repo needs; generators are workers against that plan.
4. **Model-tier by cost-per-value.** Haiku-class does per-file work; sonnet-class does synthesis.
5. **Deterministic where possible.** Anything computable from AST/CIG (API surface, data model, entry points, route counts) is computed, not generated.
6. **Delete on replace.** When v2 replaces a v1 component, v1 is removed in the same phase as the flag flip.

## 4. New pipeline (replaces current)

```
CIG build
  └─▶ FileIntelService           (N haiku calls, structured output, SHA-cached)
        ├─▶ RepoCognitionMap     (1 sonnet call — the repo's source of truth)
        │       ├─▶ Doc generator        (3 modules, sonnet)
        │       ├─▶ Diagram generator    (3 modules, sonnet, diagrams embedded in Architecture doc)
        │       └─▶ QnA indexer          (file-level chunks + exported-symbol chunks, small embedding model)
        │
        └─▶ File-level chunks for QnA (derived deterministically from FileIntel, no second LLM call)

QnA runtime:
  query → embed → RetrievalService (vector + keyword + CIG, topK=20, MMR)
       → ContextAssemblyService   (30K token budget, RCM-seeded, no layer skipping)
       → LLM (streaming)
```

---

## 5. Pillar 1 — Eval harness

### 5.1 Package

New package `packages/core/eval/` — `@codeinsight/eval`. Depends on `@codeinsight/types` and `@codeinsight/ingestion`; the existing services. Has its own CLI entry.

### 5.2 Gold dataset

Stored under `packages/core/eval/fixtures/<repo-slug>/`:

- `repo.json` — `{ gitUrl, commitSha, description, size }`.
- `expected-overview.json` — `{ bullets: string[] }` (3–6 high-level facts the overview MUST mention).
- `expected-architecture.json` — `{ subsystems: Array<{ name, mustMentionFiles: string[] }>, externalDependencies: string[] }`.
- `expected-diagrams.json` —
  ```
  {
    systemArchitecture: { mustContainLabels: string[], mustContainEdges: Array<[string,string]> },
    dataModel: { mustContainEntities: string[] } | null,
    keyFlows: Array<{ name, mustContainSteps: string[] }>
  }
  ```
- `qa-pairs.json` — array of `{ question, expectedFiles: string[], mustIncludeFacts: string[], shouldNotHallucinate: string[] }`, 10–15 per repo.

Initial gold set: 3 repos, covering small / medium / complex.
- Small: a simple Express + Prisma service (~50 files).
- Medium: a React + Redux SPA (~200 files).
- Complex: openclaw or similar (~500+ files).

### 5.3 Scoring

**Docs** — LLM-as-judge (sonnet, temp=0). Returns `{factScores: number[], overall: 0-1}`. Each bullet is scored 0 / 0.5 / 1 for "present and correct", "partially present", "absent".

**Diagrams** — deterministic structural checks on the Mermaid AST after parsing:
- Label presence (substring match, case-insensitive).
- Edge presence (both endpoints present, edge exists between them).
- Entity presence for ER diagrams.

**QnA** — per-question:
- `Recall@10` on `expectedFiles` across retrieved chunk `filePath` metadata.
- LLM-judged completeness against `mustIncludeFacts` (0–1).
- LLM-judged hallucination check: any statement NOT grounded in retrieved chunks OR RCM → `hallucinationCount > 0` = fail.

Overall repo score = weighted mean of the three surfaces. Report writer produces a markdown summary and a JSON report.

### 5.4 CLI

```
pnpm eval run                       # all gold repos
pnpm eval run --repo small          # single repo
pnpm eval run --surface qna         # only QnA tests
pnpm eval run --budget 10           # abort if per-repo cost > $10
pnpm eval baseline                  # runs v1 pipeline, writes baseline.json
pnpm eval compare --baseline=...    # diff report
```

Output: `eval/reports/<ISO date>/report.md` + `report.json`. Cost, tokens, latency, scores per surface per repo.

### 5.5 Gate

Phase 7 target: v2 scores on every surface on every repo ≥ v1 baseline, with ≥50% improvement on at least one surface per repo.

---

## 6. Pillar 2 — FileIntelService

Replaces `FileSummaryService` entirely.

### 6.1 Schema

```ts
type FileRole =
  | 'entry'       // CLI / server bootstrap
  | 'route'       // HTTP route / handler file
  | 'service'     // business logic
  | 'model'       // schema / entity / type-only
  | 'component'   // UI component
  | 'util'        // shared utility
  | 'config'      // config loading / schema
  | 'test'        // never processed, listed for completeness
  | 'other';

type SideEffect = 'db' | 'http' | 'fs' | 'env' | 'queue' | 'cache' | 'log' | 'none';

interface FileIntel {
  filePath: string;
  fileSha: string;          // source currentSha (for delta)
  role: FileRole;
  domain: string | null;    // low-noise keyword e.g. 'auth', 'billing', 'search'
  exports: string[];        // top exported symbols (max 10)
  importsExternal: string[];// non-relative package names (max 15)
  sideEffects: SideEffect[];
  oneLiner: string;         // <= 20 words, mandatory
  keyLogic: string | null;  // paragraph, only if non-obvious (<= 80 words)
}
```

### 6.2 Prompt

System: deterministic structural extractor. Strict JSON Schema output (`response_format`). No creative text in `exports` / `domain`.

User prompt is small — first ~60 lines of file + list of CIG symbols (from existing extractor) + file path. File path gives format/framework cues.

Model: `claude-haiku-4-5` (or `gpt-4.1-mini` for OpenAI users). ~500 in / ~150 out per call. Temperature 0.

### 6.3 Storage

New table `ci_file_intel`:

```sql
CREATE TABLE ci_file_intel (
  repo_id      TEXT    NOT NULL,
  file_path    TEXT    NOT NULL,
  file_sha     TEXT    NOT NULL,
  role         TEXT    NOT NULL,
  domain       TEXT,
  exports      JSONB   NOT NULL,
  imports_ext  JSONB   NOT NULL,
  side_effects JSONB   NOT NULL,
  one_liner    TEXT    NOT NULL,
  key_logic    TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repo_id, file_path),
  FOREIGN KEY (repo_id) REFERENCES ci_repos (id) ON DELETE CASCADE
);
CREATE INDEX idx_file_intel_repo ON ci_file_intel (repo_id);
```

New migration (next number in sequence). `StorageAdapter` gains `getFileIntel(repoId): Promise<FileIntel[]>`, `upsertFileIntel(records): Promise<void>`, `getFileIntelByPaths(repoId, paths): Promise<FileIntel[]>`.

### 6.4 Delta behavior

Existing records loaded by `fileSha`. File whose `currentSha` matches stored `fileSha` → skipped. Others → re-extracted. Test files and files under a `NON_INTEL_LANGUAGES` set (css, scss, html, markdown) → skipped entirely.

### 6.5 Cost model

Haiku-4.5 at ~$0.80 input / ~$4 output per 1M tokens. Per file: ~500 input + ~150 output ≈ **$0.001**.

- 500-file repo, full run: **~$0.50**.
- 2000-file repo (openclaw-scale): **~$2**.
- Delta (10% changed): **~$0.10–0.20**.

### 6.6 Token accounting

`ci_file_intel` gains a `tokens_used INT NOT NULL DEFAULT 0` column so the token-usage dashboard can aggregate FileIntel calls alongside existing artifact-generation calls. The dashboard's byModel / byRepo queries pick up `file_intel` as a new source. This resolves the under-reporting the current dashboard exhibits on v1's pre-artifact LLM calls (FileSummaryService runs were not attributed).

---

## 7. Pillar 3 — RepoCognitionMap (RCM)

### 7.1 Schema

```ts
interface RepoCognitionMap {
  repoId: string;
  repoType: 'backend-api' | 'frontend' | 'full-stack' | 'library' | 'cli' | 'worker' | 'mixed';
  languages: string[];
  frameworks: string[];
  subsystems: Array<{
    name: string;          // human label
    files: string[];       // concrete file paths (validated)
    responsibility: string;// 1-2 sentences
    externalDeps: string[];// external packages this subsystem uses
  }>;
  domains: Array<{ name: string; files: string[]; purpose: string }>;
  entryPoints: Array<{ filePath: string; kind: 'cli' | 'server' | 'worker' | 'test-runner' }>;
  externalDependencies: Array<{ name: string; usedBy: string[] }>;
  dataModel: Array<{
    entity: string;
    filePath: string;
    fields: Array<{ name: string; type: string }>;
    relations: Array<{ to: string; kind: '1:1' | '1:N' | 'N:M' }>;
  }>;
  apiSurface: Array<{ method: string; path: string; handler: string; filePath: string }>;
  buildInfra: { docker: string | null; ci: string | null; compose: string | null };
  inputSha: string; // composite SHA of files that contributed to RCM
  generatedAt: Date;
}
```

### 7.2 Prompt strategy

Single sonnet call. Input:
- Compressed FileIntel (path + role + domain + oneLiner only) for all source files.
- CIG entry points (already computed).
- Top-level directory tree (depth 2).
- `package.json` / manifest.
- README first 2000 chars.
- Pre-computed AST data: `apiSurface` from CIG route nodes, `dataModel` from CIG schema nodes, `buildInfra` from file scan.

AST-derived fields (`apiSurface`, `dataModel`, `buildInfra`) are pre-populated deterministically and passed to the LLM only for validation/refinement, not generation.

LLM fills `subsystems`, `domains`, `responsibility` text. Strict JSON Schema output.

Target: ~10K input / ~2K output. ~$0.10 per repo.

### 7.3 Post-generation validation

All `files` arrays must be subsets of the actual repo file set — filtered silently if not. `externalDependencies[].name` must appear in at least one FileIntel's `importsExternal`. Invalid claims are stripped; the validator logs stripped counts.

### 7.4 Storage

New table `ci_repo_cognition`:

```sql
CREATE TABLE ci_repo_cognition (
  repo_id      TEXT PRIMARY KEY,
  rcm          JSONB        NOT NULL,
  input_sha    TEXT         NOT NULL,
  generation_sig TEXT       NOT NULL,   -- "model:promptVersion"
  generated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (repo_id) REFERENCES ci_repos (id) ON DELETE CASCADE
);
```

`StorageAdapter` gains `getRCM(repoId)`, `upsertRCM(rcm, inputSha, sig)`.

### 7.5 Input SHA (delta firewall)

`inputSha` = SHA256 over, in order:
1. All entry-point file SHAs.
2. All source-file `domain` + `role` pairs from FileIntel (sorted).
3. Manifest file SHA.
4. README file SHA.

This is intentionally coarse: renaming an internal function does not invalidate RCM; adding a new entry point or changing a file's role/domain does.

Docs/diagrams depend on RCM's `inputSha` as part of their composite input SHA. When leaf code changes but RCM is stable, doc/diagram regeneration is skipped — this is where the delta cost collapse comes from.

---

## 8. Pillar 4 — Doc generator (3 modules)

### 8.1 Modules

1. **`overview`** — 1-page Wikipedia-style intro. Inputs: RCM, README. Output: 400-700 words.
2. **`architecture`** — the meatiest doc. Inputs: RCM. Output: 800-1500 words. Embeds the 3 diagrams inline as Mermaid code blocks (generated by the diagram pipeline and inserted deterministically).
3. **`reference`** — mostly deterministic. Inputs: RCM + AST. Sections:
   - API Reference: table from `RCM.apiSurface`.
   - Data Model: table from `RCM.dataModel`.
   - Environment & Configuration: from env example + config files.
   - Scripts: from package.json.

   LLM polish only for narrative intros (<100 words per section).

### 8.2 Prompt architecture

Shared system prompt across doc modules instructs: grounded in RCM only; no speculation; if RCM lacks the data, omit the subsection; never invent file paths.

Each module is one sonnet call. Max output 2500 tokens.

### 8.3 Artifact storage

Reuses existing `ci_artifacts` table. `artifactId` = module ID (`overview` | `architecture` | `reference`). Existing `Artifact` / `ArtifactContent` types are kept; `DocContent.module` now has 3 legal values instead of 13+.

### 8.4 Cost model

Sonnet at ~$3 input / ~$15 output per 1M tokens.

- Overview: ~3K in / 1.5K out ≈ **$0.03**
- Architecture: ~5K in / 2.5K out ≈ **$0.05**
- Reference: ~4K in / 1K out ≈ **$0.03**

**Full doc run: ~$0.10–0.15.**

---

## 9. Pillar 5 — Diagram generator (3 modules)

### 9.1 Modules

1. **System Architecture** (`flowchart TD`) — subgraphs from `RCM.subsystems` + external deps as leaf nodes. LLM generates edges between subsystems based on `externalDeps` overlap and import relationships. nodeMap maps subgraph → representative files for click-to-file.
2. **Data Model** (`erDiagram`) — deterministic from `RCM.dataModel`. LLM not used except to short-label fields. Emits `null` if `dataModel` is empty.
3. **Key Flows** (`flowchart LR`, 1–3 per repo) — a planner mini-call selects which flows to generate based on RCM signals (auth flow, request lifecycle, job pipeline, state update). Each selected flow generated via a focused module. Emits `null` when no flow signals detected.

### 9.2 No other diagrams

Dropped permanently: Dependency Graph, Module Boundaries, Package Boundary, Circular Dependencies (ASTs already exposed in Architecture doc), Component Hierarchy (no value on Backstage screen), CI/CD Pipeline, Request Lifecycle (merged into Key Flows), State Management (merged into Key Flows).

### 9.3 Architecture doc embedding

The Architecture doc (Pillar 4) embeds all three diagrams as Mermaid code blocks inline. The "Diagrams" tab remains as a dedicated full-screen view of the same three diagrams — no duplication of generation.

### 9.4 Cost model

- System Architecture: ~$0.03
- Data Model: ~$0.01 (mostly deterministic)
- Key Flows: ~$0.02 per flow × 1–3

**Full diagram run: ~$0.05–0.10.**

---

## 10. Pillar 6 — QnA redesign

### 10.1 Embedding strategy

Chunks produced per repo (replaces the current ~3000-chunk strategy):

| Chunk type | Source | Per 500-file repo |
|---|---|---|
| `file_intel` | One per FileIntel record | ~500 |
| `doc_section` | One per doc artifact | 3 |
| `diagram_desc` | One per diagram artifact | 3 |
| `symbol` | Only exported symbols from `entry`/`route`/`service`/`component` roles | ~150–250 |

Total: **~700 chunks vs previous ~3000+.**

`file_intel` chunks are built deterministically from the FileIntel record — no second LLM call. Format:
```
[service | auth domain] src/auth/authService.ts
Does: Verifies JWTs, issues refresh tokens, manages sessions.
Exports: signIn, signOut, refresh, verifyToken.
External: jsonwebtoken, redis.
Side effects: db, http, cache.
Non-obvious: Refresh tokens are stored in Redis with a 7-day TTL and hashed with PBKDF2 before storage.
```

Layer rename: `file_summary` → `file_intel` (migration + `qna/layers.ts` constant rename). Old layer code deleted.

Embedding model: **`text-embedding-3-small`** (replaces `text-embedding-3-large`). 6.5× cheaper, near-identical quality on code. Configurable via `codeinsight.embeddings.model`.

### 10.2 Retrieval fixes (deterministic, no LLM)

- **Never skip code layer.** `layersForQueryType`:
  - `conceptual` → `[file_intel, doc_section, diagram_desc, code]` (code added, lower weight).
  - `specific` → `[code, file_intel]`.
  - `relational` → `[code, file_intel]` + CIG lookup.
  - `navigational` → CIG lookup primary + `[code, file_intel]`.
  - `general` → all.
- `topK`: 8 → **20**.
- `FETCH_PER_PATH`: 10 → **25**.
- **MMR reranking** on the merged results: balance relevance vs diversity (λ=0.5). Prevents over-retrieving near-duplicates from the same file.

### 10.3 Context assembly

- `maxContextTokens`: 8000 → **30000**.
- Every assembled context starts with a **compressed RCM block** (~1K tokens): repo type, subsystems list, entry points, external deps. This gives the LLM repo-level grounding before specific chunks arrive.
- Expansions (callee refs, import list, doc link) retained but budget adjusted: `maxCalleeTokens` 200, `maxDocLinkTokens` 400. Reasonable because context budget grew.
- Doc link expansion uses `symbol` or `filePath` search on `[doc_section]` layer — unchanged from v1.

### 10.4 Streaming & latency

Sonnet streaming; first-token latency target <2s. Groundedness: answer post-processor tags each claim with the chunk it came from (simple regex on chunk file paths mentioned). Not user-visible in v2 but logged for eval.

### 10.5 Cost model

Per query (avg): ~5K input + ~500 output ≈ $0.02 per question. No change from v1 at the per-query level; win comes from index-build cost.

---

## 11. Pillar 7 — Model tiering & config

### 11.1 Config changes

`config.d.ts` extended:

```ts
codeinsight: {
  llm: {
    provider: 'anthropic' | 'openai';
    apiKey: string;
    models: {
      fileIntel: string;       // default: claude-haiku-4-5 / gpt-4.1-mini
      rcm:       string;       // default: claude-sonnet-4-6 / gpt-4.1
      docs:      string;       // default: claude-sonnet-4-6 / gpt-4.1
      diagrams:  string;       // default: claude-sonnet-4-6 / gpt-4.1
      qna:       string;       // default: claude-sonnet-4-6 / gpt-4.1
      classifier:string;       // default: claude-haiku-4-5 / gpt-4.1-mini
    };
  };
  embeddings: {
    provider: 'openai';
    apiKey: string;
    model: string;             // default: text-embedding-3-small
  };
  ...
}
```

Fallback: if `models.fileIntel` etc. unset, fall back to `models.default` which retains the existing `llm.model` string for back-compat until flag flip, after which `llm.model` is removed.

### 11.2 Cost projection

openclaw-scale (measured): v1 full run = **~$33–35**. The bulk of the spend was `FileSummaryService` per-file prose summaries (~85–90% of chat cost), then 13 doc modules and 7 diagram modules on top.

v2 projection for the same workload:

| Stage | v2 cost (500 files) | v2 cost (2000 files, openclaw-scale) |
|---|---|---|
| FileIntel | ~$0.50 | ~$2.00 |
| Classifier | ~$0.01 | ~$0.01 |
| RCM | ~$0.06 | ~$0.10 |
| Docs (3) | ~$0.10–0.15 | ~$0.15 |
| Diagrams (3) | ~$0.05–0.10 | ~$0.10 |
| Embeddings (3-small) | ~$0.05 | ~$0.20 |
| **Total full run** | **~$0.80–1.00** | **~$2.50–3.00** |
| Delta (10% changed) | **~$0.08–0.15** | **~$0.25–0.40** |

**Projected reduction at openclaw scale: ~10×.** Projected reduction for a typical medium repo: ~25–40×.

Note: these are upper-bound LLM cost estimates assuming no prompt cache hits. Anthropic prompt caching on shared system prompts (file-intel extraction shares a system prompt across all N files in a run) can reduce FileIntel cost a further 30–50% on providers that support it.

---

## 12. Pillar 8 — Migration phases & deletion slots

Seven phases. Each gated by eval scores ≥ baseline on affected surface.

### Phase 1 — Eval harness (1–2d)
**Adds:** `packages/core/eval/`, gold fixtures (3 repos), CLI.
**Deletes:** nothing yet.
**Gate:** CLI runs, produces report, baseline repo scores reproducible.

### Phase 2 — Baseline measurement (0.5d)
**Adds:** `eval/reports/<date>-v1-baseline.json`.
**Deletes:** nothing.
**Gate:** baseline numbers committed to repo.

### Phase 3 — FileIntel + RCM (behind flag) (3–4d)
**Adds:** `FileIntelService`, `ci_file_intel` migration, `RepoCognitionMap` service, `ci_repo_cognition` migration, `StorageAdapter` methods. Feature flag: `codeinsight.features.v2Pipeline`. When true, pipeline runs FileIntel + RCM before old doc/diagram modules but continues to run old modules.
**Deletes:** nothing yet.
**Gate:** RCM produced on all 3 gold repos, validated, cached correctly on delta.

### Phase 4 — Consolidated docs + diagrams (behind flag) (2–3d)
**Adds:** 3 new doc modules (`overview`, `architecture`, `reference`), 3 new diagram modules (System Architecture, Data Model, Key Flows), diagram embedding in Architecture doc. Under flag, these run *instead of* old modules.
**Deletes:** nothing yet.
**Gate:** eval scores on docs + diagrams ≥ baseline for all 3 gold repos.

### Phase 5 — QnA redesign (behind flag) (2d)
**Adds:** new chunk builders (file_intel + selective symbol), MMR reranker, updated `layersForQueryType`, `topK`/context expansion, RCM seed in `ContextAssemblyService`, embedding model switch.
**Deletes:** nothing yet.
**Gate:** QnA eval ≥ baseline, Recall@10 ≥ baseline + 20%.

### Phase 6 — Flip flag + delete v1 (1d)
**Flag becomes default-on, then removed entirely.**

**Deletion checklist** — the following MUST be fully removed, not left gated:

| Code | Reason |
|---|---|
| `packages/core/chunking/src/FileSummaryService.ts` + tests | Replaced by `FileIntelService` |
| Old `file_summary` layer constant / usage in `qna/layers.ts`, `RetrievalService`, `ContextAssemblyService` | Renamed to `file_intel` |
| `FileSummaryService` wiring in `IndexingService` (incl. `precomputeSummaries`, `_precomputedSummaryChunks`, `_precomputedExistingMap`) | Pipeline restructured |
| `VectorStore.getFileSummaries()` + `KnexVectorStore` impl | Replaced by `StorageAdapter.getFileIntel()` |
| All 13 doc-module entries in `PromptRegistry.ts` except `overview`, `architecture`, `reference` (renamed from `core/overview`, etc.) | Consolidated |
| All 13 module builders in `ContextBuilder.ts` (`buildOverviewVars`, `buildProjectStructureVars`, `buildGettingStartedVars`, `buildConfigurationVars`, `buildDependenciesVars`, `buildTestingVars`, `buildDeploymentVars`, `buildApiReferenceVars`, `buildDatabaseVars`, `buildAuthVars`, `buildComponentHierarchyVars`, `buildStateManagementVars`, `buildRoutingVars`, `buildArchitectureVars`, `buildFeaturesVars`) | Replaced by RCM-driven single context |
| `ContextBuilder.getFilesByInDegree` | No longer used |
| `packages/core/diagram-gen/src/SignalDetector.ts` | RCM subsumes signal detection |
| Dropped diagram modules: `DependencyGraphModule`, `ModuleBoundariesModule`, `PackageBoundaryModule`, `CircularDependencyModule`, `ComponentHierarchyModule`, `CiCdPipelineModule`, `RequestLifecycleModule`, `StateFlowModule`, `StateManagementModule`, `ApiFlowModule`, `ApiEntityMappingModule`, `DeploymentInfraModule`, `ErDiagramModule` (replaced by v2 Data Model), `HighLevelArchitectureModule` (replaced by v2 System Architecture), `AuthFlowModule` (folded into Key Flows) | Consolidated to 3 |
| `diagram-gen/utils.ts` `buildFileSummaryBlock` | Callers deleted |
| `ClassifierService` (or: kept but hollowed to just language/framework detection that RCM still needs) — decision documented in Phase 3 | RCM subsumes prompt-module selection |
| `DocGenConfig.modelName` → replaced by tiered config | Config shape change |
| Any `computeInputSha` helpers unused after module consolidation | Orphaned |
| Any `NON_LLM_LANGUAGES` / `nonLlmLanguages` handling only relevant to old FileSummary sliding-window path | Orphaned |
| Frontend doc-module TOC entries (if any) that list removed modules | Orphaned |

**Migration (destructive):**
- Drop `ci_vector_chunks` rows where `layer = 'file_summary'` (superseded by `file_intel`).
- Drop old doc artifacts (`artifactType = 'doc'` with `content->>'module'` ∉ {`overview`,`architecture`,`reference`}).
- Drop old diagram artifacts whose `content->>'diagramType'` ∉ the new set.
- Drop orphaned `ci_artifact_inputs` via `ON DELETE CASCADE` (verify FK exists; add if not).

These are executed via a new migration. The migration is **not reversible** — v1 is gone.

**Gate:** `grep` for every deleted symbol returns zero hits in `packages/`. CI lints pass.

### Phase 7 — Final eval (0.5d)
**Adds:** `eval/reports/<date>-v2.json`, `eval/reports/<date>-delta.md`.
**Gate:** v2 beats v1 on every surface on every repo AND beats it by ≥50% on at least one surface per repo.

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gold set is unrepresentative; v2 optimizes to wrong target | M | H | Start with 3 carefully-chosen repos; grow to 8–10 as misgeneralization surfaces. Review gold fixtures at Phase 7 based on observed failures. |
| RCM hallucinates files / dependencies | M | H | Strict JSON Schema output; post-generation validator filters claims with file refs not in repo; deps must appear in at least one FileIntel.importsExternal. |
| RCM inputSha is too sensitive → delta cost benefit lost | L | M | inputSha computed only over entry points + file role/domain + manifest + README. Internal refactors don't invalidate. |
| Sonnet + 30K context → high QnA first-token latency | M | L | Measure in Phase 5; reduce topK or context if p95 > 3s. Streaming mitigates perceived latency. |
| Haiku structured-output fails on complex files | L | M | Schema validation; on parse failure, fall back to a retry with sonnet; log failures for gold set review. |
| Deleting v1 artifacts breaks existing Backstage deployments | L | M | Phase 6 migration is a breaking change; documented in a RELEASE-NOTES entry; deployments with running v1 must run the migration during upgrade. |
| New `text-embedding-3-small` quality regression on code | L | M | A/B in Phase 5 eval: run with both; keep the one that beats baseline on QnA Recall@10. |

---

## 14. What is NOT changing

- Ingestion orchestration (`IngestionService.runPipeline()`) — only the stages it invokes change.
- `RepoConnector` / Git cloning.
- `FileFilter` — classification of source/test/config files remains.
- CIG extraction (Tree-sitter, Prisma) — all AST work is untouched.
- Backstage plugin surface (tabs, routes, frontend entry points). The 3 tabs (Documentation, Diagrams, QnA) stay. The Documentation tab renders 3 sections instead of 13. The Diagrams tab renders 3 diagrams instead of 7.
- `JobQueue` / `InProcessJobQueue`.
- Auth / tenancy posture (still self-hosted, one Postgres).
- CachingLLMClient — still the wrapper around every provider client.

### Frontend impact (minimal)

- Documentation tab: existing TOC and renderer work with the 3 new module IDs once module ID → human title mapping is updated.
- Diagrams tab: existing gallery renders the new 3-diagram set; card layout unchanged.
- QnA: no UI changes.
- Token-usage dashboard: picks up `file_intel` source automatically once `StorageAdapter.getTokenUsageStats` aggregates the new column.

---

## 15. Testing strategy

**Unit:**
- `FileIntelService`: parse prompt output, schema validation, delta-skip, small-file branch, test-file skip.
- `RCM` service: validator strips invalid file refs, validator strips invalid deps, delta caching behavior.
- Doc generators: run with RCM fixtures, assert structure of produced markdown.
- Diagram generators: run with RCM fixtures, assert Mermaid is valid and contains expected labels.
- QnA retrieval: `layersForQueryType` matches new spec; MMR reranker distribution; RCM seed appears in context.

**Integration:**
- `IngestionService.runPipeline` + FileIntel + RCM + generators using Postgres test container.
- Delta behavior: run full, modify one file, run again, assert only that file's intel regenerates and RCM stays cached.
- End-to-end QnA: index the small gold repo, ask 5 of its QA questions, assert Recall@10.

**Eval (continuous):**
- Eval run as part of CI on Phase 6 PR.
- Eval tracked in git (reports directory) so we see trends.

---

## 16. Open questions (to resolve during Phase 3 planning)

1. **Classifier retention.** Does RCM fully absorb `ClassifierService`, or do we keep a trimmed version for language/framework detection? → Phase 3 plan answers.
2. **Key Flows module structure.** Is Key Flows one module with a switch statement, or a module-per-flow (auth, request, job)? → Phase 4 plan answers.
3. **Streaming partial QnA with RCM seed.** Does the seed go in system prompt or user prompt? (Affects prompt-caching hit rate on providers that support it.) → Phase 5 plan answers.
4. **Embedding model switch rollback.** If `text-embedding-3-small` regresses on QnA Recall, do we keep `-large` as a per-repo setting or globally? → Phase 5 eval decides.

---

## 17. Summary

v1 generates more artifacts than Backstage users can consume, pays for per-file LLM prose that grounds nothing, and ships without measurement. v2 inverts: a typed per-file record + one repo-level synthesis feed three high-signal doc sections, three high-signal diagrams, and a QnA pipeline that actually includes code in conceptual answers. Every step is gated by an eval score against a gold set. Every v1 component that v2 replaces is deleted in the migration — no flag graveyard, no dead code.

Projected impact on openclaw-scale repos: **$33–35 → ~$3, 60min → ~15min, measurably better output on all three surfaces.**

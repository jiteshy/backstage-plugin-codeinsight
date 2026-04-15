# P2 — Documentation and Diagram Quality

**Date:** 2026-04-15
**Status:** Approved
**Scope:** File summaries as shared context for doc and diagram generation; two new doc modules; overview enrichment; diagram prompt enrichment.

---

## Problem

Generated documentation is developer-setup-heavy (install steps, env vars, config) and lacks:
- Project architecture and how subsystems interact
- Domain/feature descriptions and what the system actually does
- Usage guidance beyond "how to run it"

Generated diagrams (LLM-assisted) lack semantic context about what individual files do, producing generic output.

Root cause: `ContextBuilder` and diagram module prompts are fed file paths, CIG topology, and a handful of raw file excerpts. They have no semantic understanding of what any given service or module does.

---

## Solution Overview

Run `FileSummaryService` as an explicit pre-step before doc and diagram generation. The resulting `Map<filePath, summary>` flows to both generators. Two new doc modules (`core/architecture`, `core/features`) and an enriched `core/overview` use these summaries to produce architecture- and domain-level documentation. LLM-assisted diagram modules receive a compact "key file summaries" block that grounds their output in real code semantics.

FileSummaryService is still run by IndexingService for QnA indexing — but the pre-step results are cached so no LLM call is ever duplicated.

---

## Pipeline Order

```
CIG build
  └─> pre-compute file summaries          ← NEW (runs before docs/diagrams)
        └─> doc generation  (with summaries)
        └─> diagram generation  (with summaries)
              └─> QnA indexing  (reuses cached summary chunks, no re-run)
```

### First run vs delta

- **First run:** `getFileSummaries()` returns empty map; `FileSummaryService.summarize()` generates all summaries; full map returned to generators; chunks cached for QnA indexing.
- **Delta run:** `getFileSummaries()` fetches all existing summaries from VectorStore; `FileSummaryService.summarize()` runs only for files whose `currentSha` changed (existing delta logic); new results merged over existing map; merged map returned to generators; new chunks cached for QnA indexing.

In both cases `FileSummaryService` LLM calls are made at most once per changed file per run.

---

## Component Changes

### 1. `VectorStore` interface (`@codeinsight/types`)

New method:
```typescript
/**
 * Return LLM-generated file summaries keyed by filePath.
 * Only base-level summaries (Tier 1/2/3a) are returned.
 * Sliding-window sub-chunks (subChunkIndex present) are excluded.
 */
getFileSummaries(repoId: string): Promise<Map<string, string>>;
```

### 2. `KnexVectorStore` (`@codeinsight/adapters/storage`)

Implementation of `getFileSummaries`:
- Query `ci_vector_chunks` where `repo_id = ?`, `layer = 'file_summary'`, and `metadata->>'subChunkIndex' IS NULL`
- Return `Map<filePath, content>` using `metadata->>'filePath'` as key

### 3. `IndexingService` (`@codeinsight/indexing`)

New public method:
```typescript
async precomputeSummaries(
  repoId: string,
  cloneDir: string,
): Promise<Map<string, string>>
```

Behaviour:
1. Load `existingShas` from `vectorStore.listChunks(repoId)` (same as `indexRepo()` already does)
2. Load `existingSummaries` from `vectorStore.getFileSummaries(repoId)`
3. If `this.fileSummaryService` is undefined (no LLM client configured): cache empty array, return `existingSummaries` as-is
4. Otherwise: run `fileSummaryService.summarize(repoId, cloneDir, existingShas)` → `newChunks[]`
5. Cache `newChunks` in `this._precomputedSummaryChunks` for reuse by `indexRepo()`
6. Build and return merged map: start with `existingSummaries`, overlay entries from `newChunks`

`indexRepo()` change:
- At the summary step, check `this._precomputedSummaryChunks`. If set, use those directly and skip `fileSummaryService.summarize()`. Clear the cache after use.

Returns: `Map<string, string>` where key = `filePath`, value = summary text.

### 4. `Indexer` duck-type interface (inside `@codeinsight/ingestion`)

```typescript
interface Indexer {
  precomputeSummaries(repoId: string, cloneDir: string): Promise<Map<string, string>>;
  indexRepo(repoId: string, cloneDir: string): Promise<{
    chunksIndexed: number;
    chunksSkipped: number;
    chunksDeleted: number;
  }>;
}
```

### 5. `IngestionService.runPipeline()` (`@codeinsight/ingestion`)

New step inserted between CIG and doc generation:

```typescript
// Pre-compute file summaries (if indexer present) so docs + diagrams
// can use them as context. IndexingService caches the chunks internally
// so no LLM call is duplicated when indexRepo() runs later.
let fileSummaries: Map<string, string> = new Map();
if (this.indexer) {
  try {
    this.logger.info('Pre-computing file summaries', { repoId, jobId });
    fileSummaries = await this.indexer.precomputeSummaries(repoId, cloneDir);
    this.logger.info('File summaries ready', { repoId, count: fileSummaries.size });
  } catch (err) {
    this.logger.warn('File summary pre-computation failed (non-fatal)', {
      repoId, error: String(err),
    });
    // fileSummaries stays empty Map — generators degrade gracefully
  }
}
```

Pass `fileSummaries` to `docGenerator.generateDocs()` and `diagramGenerator.generateDiagrams()`.

### 6. `DocGenerator` duck-type interface (inside `@codeinsight/ingestion`)

```typescript
interface DocGenerator {
  generateDocs(
    repoId: string,
    cloneDir: string,
    fileSummaries?: Map<string, string>,
  ): Promise<{ totalTokensUsed: number; detectedSignals: Record<string, string> }>;
}
```

### 7. `DiagramGenerator` duck-type interface (inside `@codeinsight/ingestion`)

```typescript
interface DiagramGenerator {
  generateDiagrams(
    repoId: string,
    detectedSignals?: Record<string, string>,
    fileSummaries?: Map<string, string>,
  ): Promise<{ totalTokensUsed: number }>;
}
```

### 8. `DocGenerationService` (`@codeinsight/doc-generator`)

`generateDocs()` signature updated:
```typescript
async generateDocs(
  repoId: string,
  cloneDir: string,
  fileSummaries?: Map<string, string>,
): Promise<DocGenerationResult>
```

`ContextBuilder` constructed with `fileSummaries`:
```typescript
const contextBuilder = new ContextBuilder(
  nodes, edges, repoFiles, classifierResult, cloneDir, fileSummaries,
);
```

### 9. `ContextBuilder` (`@codeinsight/doc-generator`)

Constructor gains:
```typescript
constructor(
  private readonly nodes: CIGNode[],
  private readonly edges: CIGEdge[],
  private readonly repoFiles: RepoFile[],
  private readonly classifierResult: ClassifierResult,
  private readonly cloneDir: string,
  private readonly fileSummaries: Map<string, string> = new Map(),
) {}
```

New private helper — computes file-level in-degree from CIG import edges:
```typescript
private getFilesByInDegree(topN: number): string[]
```
Returns the `topN` source file paths that are imported by the most other files. Used by architecture, features, and overview context builders.

**`buildOverviewVars()` enriched:**
After existing README + manifest + entry points, add up to 5 summaries of the most-central files (by in-degree). Variable name: `keySummaries` — a formatted block of `### filePath\nsummaryText` entries.

**New `buildArchitectureVars()`:**
- Top 20 source files by in-degree from `getFilesByInDegree(20)`
- Their summaries from `fileSummaries` map
- CIG import edges between those files (inter-file edges only, deduped, up to 100)
- Variables: `fileSummariesBlock`, `importGraphBlock`
- Returns `null` if `fileSummaries` is empty (module skipped on first run without LLM client)

**New `buildFeaturesVars()`:**
- Files matching path patterns: `service`, `handler`, `controller`, `provider`, `manager`, `repository`, `use-case`, `usecase`
- Up to 25 files, sorted by in-degree descending
- Look up summaries; for files with no summary, attempt a truncated file read (500 chars)
- Variable: `featureSummariesBlock`
- Returns `null` if no matching files found

### 10. `PromptRegistry` (`@codeinsight/doc-generator`)

Two new entries:

**`core/architecture`**
- System prompt: instructs LLM to produce `## Architecture` section covering: major layers/subsystems and their responsibilities, how data flows between them, which files are the core abstractions, and any notable architectural patterns. Under 600 words. Grounded only in provided summaries — no speculation.
- User prompt builder: `fileSummariesBlock` + `importGraphBlock` + generation instruction.

**`core/features`**
- System prompt: instructs LLM to produce `## Features` section covering: what the system does from a user/consumer perspective, the major features or domains, what each service/handler is responsible for, and how features compose end-to-end. Under 500 words.
- User prompt builder: `featureSummariesBlock` + generation instruction.

**`core/overview` system prompt updated:**
Extended to explicitly use `keySummaries` if present: "Use the Key File Summaries section to describe what the project actually does at a code level, not just what the README says."

### 11. `DiagramGenerationService` (`@codeinsight/diagram-gen`)

`generateDiagrams()` signature updated:
```typescript
async generateDiagrams(
  repoId: string,
  detectedSignals?: Record<string, string>,
  fileSummaries?: Map<string, string>,
): Promise<{ totalTokensUsed: number }>
```

Each LLM-assisted module's `build()` call receives the summary context. The `DiagramContext` type (passed to `module.build()`) gains:
```typescript
fileSummaries?: Map<string, string>;
```

Each LLM-assisted module that currently builds a prompt adds a `## Key File Summaries` section using the top 20 files by in-degree (computed from CIG nodes passed in context). This affects: `high-level-architecture`, `api-entity-mapping`, `auth-flow`, `deployment-infra`, `state-management` (hybrid), `er-diagram` (hybrid).

The summary block is capped at 20 entries and ~4000 chars total to stay within prompt budgets.

---

## File-Centrality Selection

All "top N files by in-degree" computations use the same logic:
1. Filter CIG edges to `edgeType === 'imports'`
2. Map each `toNodeId` back to its `filePath` via the nodes index
3. Count distinct source files (`fromNodeId` file paths) per destination file
4. Sort descending; return top N `filePath` strings
5. Apply source-file-only filter (`fileType === 'source'`) to exclude config/schema/CI files

---

## Error Handling and Graceful Degradation

- If `precomputeSummaries()` fails: `fileSummaries` stays as empty `Map`. Generators receive empty map. `core/architecture` and `core/features` return `null` from their `buildVars()` and are skipped. `core/overview`, diagrams, and existing modules all proceed normally with their existing context.
- If a specific file has no summary: `buildFeaturesVars()` falls back to a truncated file read. `buildArchitectureVars()` skips that file's summary entry silently.
- If `getFileSummaries()` query fails: `precomputeSummaries()` catches and proceeds with empty existing summaries (new chunks from this run are still returned).

---

## New Modules Added to Classifier

`ClassifierService` currently returns a list of `promptModules` to run. `core/architecture` and `core/features` are added to the default module list for all repo types. They are guarded by a `null` return from `buildVars()` (skip if no summaries available), so they never produce empty artifacts.

---

## What Is Not Changing

- `FileSummaryService` itself: no changes needed
- `ChunkingService`: no changes
- QnA retrieval, session management, streaming: untouched
- Existing 13 doc modules: only `core/overview` system prompt is extended; all others unchanged
- AST-only diagram modules (`circular-dependencies`, `er-diagram` base): unchanged

---

## Testing

- `IndexingService`: new unit test for `precomputeSummaries()` covering first-run (empty store) and delta-run (existing summaries + new ones) scenarios; test that `indexRepo()` skips FileSummaryService when cache is populated
- `ContextBuilder`: unit tests for `buildArchitectureVars()` and `buildFeaturesVars()` with a mock summary map; test graceful null return when map is empty
- `PromptRegistry`: snapshot or content tests for the two new prompt builders
- Integration: existing `DocGenerationService` and `DiagramGenerationService` tests pass `fileSummaries: new Map()` to verify backward compatibility

# QnA File Summary Layer Design

**Date:** 2026-04-09  
**Status:** Approved  
**Phase:** 5.x (QnA hardening)

---

## Problem

QnA fails to answer conceptual questions (e.g. "how does it identify inner-source repos?") even when the relevant code exists in the indexed repository. Two root causes were identified:

1. **`file_summary` layer never populated.** Conceptual queries (classified by `RetrievalService` as `conceptual`) only search `[file_summary, doc_section, diagram_desc]`. The `LAYER_FILE_SUMMARY` constant is defined and wired into retrieval but `ChunkingService` never produces chunks for it. Conceptual queries are therefore missing half their search space.

2. **Symbol-only indexing misses file-level context.** `ChunkingService` chunks individual CIG symbols (functions, classes). Files whose logic spans multiple small functions, or files with no CIG coverage (config, YAML, markdown), have no indexed representation of their overall purpose or behavior.

---

## Solution Overview

Introduce a `FileSummaryService` that produces one (or more) `file_summary` chunks per repository file by reading directly from the cloned repo. The service uses a tiered strategy that balances LLM quality against token cost: small files are stored as raw content (free), medium/large files get LLM-generated summaries (using actual source code as input, not synthetic metadata).

`IndexingService` orchestrates `FileSummaryService` alongside the existing `ChunkingService`, merging all chunk layers before delta detection and embedding.

No changes to `RetrievalService`, `ContextAssemblyService`, or `QnAService` — once `file_summary` chunks exist in the vector store, conceptual query retrieval works correctly without modification.

---

## Architecture

```
cloneDir + repoId
     │
     ├── ChunkingService.chunkRepo()     → code + doc_section + diagram_desc chunks
     │
     └── FileSummaryService.summarize() → file_summary chunks
               │
               ├── small file  (< 500 tokens)  → raw content chunk         (no LLM)
               ├── medium file (500–3000 tokens) → full content → LLM summary
               ├── large source file (> 3000 tokens, has CIG) → first 60 lines + symbol list → LLM summary
               └── large non-code file (> 3000 tokens, no CIG) → sliding window chunks (no LLM)

All chunks merged → delta filter → embed → VectorStore
```

### Package placement

| Component | Package |
|---|---|
| `FileSummaryService` | `@codeinsight/chunking` |
| `IndexingService` changes | `@codeinsight/indexing` |
| Composition root wiring | `packages/backstage/plugin-backend` |

---

## FileSummaryService

### Constructor

```typescript
class FileSummaryService {
  constructor(
    storageAdapter: StorageAdapter,
    llmClient: LLMClient,
    logger?: Logger,
    config?: FileSummaryConfig,
  )
}
```

### Public API

```typescript
summarize(repoId: string, cloneDir: string): Promise<{ chunks: Chunk[], stats: FileSummaryStats }>
```

`FileSummaryStats`:
```typescript
interface FileSummaryStats {
  rawChunks: number;       // files stored as raw content
  llmSummaries: number;    // files summarized by LLM
  slidingChunks: number;   // large non-code files chunked without LLM
  skipped: number;         // unchanged files (contentSha match) or unreadable
  totalChunks: number;
}
```

### Configuration

```typescript
interface FileSummaryConfig {
  rawTokenThreshold?: number;     // default: 500  — store raw if below
  fullSummaryThreshold?: number;  // default: 3000 — use full content if below, else smart excerpt
  maxExcerptLines?: number;       // default: 60   — lines in large-file excerpt
  charsPerToken?: number;         // default: 3
}
```

### Tiered Strategy

| Condition | Strategy | LLM? |
|---|---|---|
| Raw content < 500 tokens | Store as-is as `file_summary` chunk | No |
| Raw content 500–3000 tokens | Full file → LLM summary | Yes |
| Raw content > 3000 tokens, has CIG nodes | First 60 lines + CIG symbol list → LLM summary | Yes |
| Raw content > 3000 tokens, no CIG nodes, `fileType === 'source'` | First 60 lines only → LLM summary | Yes |
| Raw content > 3000 tokens, non-source file (markdown, YAML, config, etc.) | Sliding window chunks (paragraph/line boundaries) | No |

### Chunk ID

```
{repoId}:{filePath}:file_summary
```

For large non-code files with multiple sliding window chunks:
```
{repoId}:{filePath}:file_summary:{index}
```

### LLM Prompt

```
Summarize this file for a code search index. In 4–6 sentences cover:
- What this file does and its role in the system
- Key behaviors or logic (e.g., how it filters data, what APIs it calls, what patterns it uses)
- Any non-obvious implementation details

File: {filePath}

{content}
```

For large source files, `{content}` is replaced with:
```
[First 60 lines]
{firstSixtyLines}

[Exported symbols]
{symbolList}
```

Where `symbolList` is built from CIG nodes for the file: `function fetchProjects (src/lib/github.ts:12–45)`, one per line.

### File Manifest

`FileSummaryService` iterates `storageAdapter.getRepoFiles(repoId)` — the full file manifest is already tracked during ingestion. No re-scanning of the clone directory is needed.

---

## Delta Handling

Staleness is handled without any new logic:

- **Unchanged files:** `contentSha` is computed from the **source file's `currentSha`** (from `RepoFile`), not from the generated summary text. If `currentSha` matches what is stored in the vector store, the LLM call is skipped entirely and no new chunk is produced. The existing `IndexingService` delta filter handles the rest.
- **Changed files:** New chunk produced → `contentSha` differs → re-embedded.
- **Deleted files:** No chunk produced → `IndexingService` detects it as stale and removes it from the vector store.

This prevents redundant LLM calls caused by non-deterministic summary generation across runs.

---

## IndexingService Changes

`IndexingService` receives an optional `LLMClient` in its constructor. When present, it constructs a `FileSummaryService` and calls it alongside `ChunkingService`, merging all chunks before the delta filter:

```typescript
constructor(
  embeddingClient: EmbeddingClient,
  vectorStore: VectorStore,
  storageAdapter: StorageAdapter,
  logger?: Logger,
  config?: IndexingConfig,
  llmClient?: LLMClient,   // NEW — optional, enables file_summary layer
)
```

If `llmClient` is absent, `FileSummaryService` is not constructed and the behaviour is identical to today (backwards compatible).

---

## Plugin-Backend Wiring

`packages/backstage/plugin-backend/src/router.ts` already constructs an `LLMClient` for doc/diagram generation. The same client instance is passed into `IndexingService`. No new config keys needed.

---

## Testing Plan

### Unit tests — `FileSummaryService`

- Small file (< 500 tokens) → raw `file_summary` chunk produced, `llmClient` not called
- Medium file (500–3000 tokens) → LLM called with full content, summary stored as chunk
- Large source file (> 3000 tokens, has CIG nodes) → LLM called with excerpt + symbol list, not full content
- Large non-code file (> 3000 tokens, markdown) → sliding window chunks produced, LLM not called
- Unchanged file (`currentSha` matches stored) → LLM skipped, no chunk produced
- File unreadable from clone → logged as warning, skipped gracefully

### Integration tests — `IndexingService`

- When `LLMClient` provided: `file_summary` chunks appear in vector store alongside `code`/`doc_section`/`diagram_desc`
- When `LLMClient` absent: behaviour identical to current (no `file_summary` chunks)

---

## Files Changed

| File | Change |
|---|---|
| `packages/core/chunking/src/FileSummaryService.ts` | New |
| `packages/core/chunking/src/FileSummaryService.test.ts` | New |
| `packages/core/chunking/src/index.ts` | Export `FileSummaryService` |
| `packages/core/indexing/src/IndexingService.ts` | Add optional `LLMClient`, wire `FileSummaryService` |
| `packages/core/indexing/src/__tests__/IndexingService.test.ts` | New test cases |
| `packages/backstage/plugin-backend/src/router.ts` | Pass `LLMClient` to `IndexingService` |

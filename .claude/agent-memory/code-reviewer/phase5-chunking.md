# Phase 5.2 Review Notes — ChunkingService

## Package: `@codeinsight/chunking`
- Location: `packages/core/chunking/`
- Framework-agnostic: zero @backstage/* imports. Clean.
- Config injected via constructor (ChunkingConfig). Clean.
- All I/O via StorageAdapter interface. Clean.
- 28 tests, all passing. Build clean.

## Architecture Alignment
- computeCompositeSha WAS originally just `shas: string[]` but was fixed to `Array<{ filePath, fileSha }>` matching ContextBuilder.computeInputSha algorithm. Tests reflect the correct signature.
- chunk_id format: `{repoId}:{filePath}:{symbol}:{layer}` — matches build plan spec exactly.
- Three layers implemented: code (CIG nodes), doc (doc artifacts), diagram (diagram artifacts).
- Sub-chunk IDs use `:0`, `:1`, `:N` suffix — per build plan spec.

## Issues Found in Phase 5.2 Review

### MAJOR — N+1 query pattern in getArtifactInputs loop
ChunkingService.ts lines 180-186 and 231-237: `getArtifactInputs(repoId, artifactId)` is called once
per doc/diagram artifact inside sequential for loops. For a repo with 50 doc artifacts this is 50
serial DB round-trips. Fix: add `getAllArtifactInputs(repoId: string): Promise<ArtifactInput[]>` to
StorageAdapter and group by artifactId in a Map<string, ArtifactInput[]>.
Note: This is a v1 performance issue. Functionally correct. Flag for 5.3/IndexingService context.

### MINOR — Misleading variable name: filesBySha
ChunkingService.ts line 70: `const filesBySha = new Map<string, RepoFile>()`. The map is keyed by
`filePath` (line 71: `filesBySha.set(f.filePath, f)`), not by SHA. Rename to `filesByPath`.

### MINOR — oversizedSplit counter counts extra sub-chunks, not oversized symbols
Line 158: `oversizedSplit += subChunks.length - 1` — counts extra chunks created, not the count of
original oversized nodes. E.g., 2 oversized symbols each split into 3 gives oversizedSplit=4, not 2.
The naming and JSDoc do not describe this clearly. Add a comment: "number of extra sub-chunks created
due to splitting" or rename to `extraSubChunksCreated`.

### MINOR — No test for diagram chunk oversized splitting
`splitOversizedText` is tested only for doc layer in the test suite. The diagram layer passes through
the same code path but there is no test verifying it. Add a test with a diagram artifact whose
title+description+mermaid content exceeds maxChunkTokens.

### MINOR — Path traversal not guarded in readSymbolSource
ChunkingService.ts line 298: `path.join(cloneDir, filePath)`. path.join does not prevent traversal.
A CIG node with `filePath='../../etc/passwd'` escapes cloneDir. Same pattern exists in
IngestionService.ts line 494 and ContextBuilder.ts line 734 (both flagged in prior reviews — this is
a systemic gap). Risk is low (CIG comes from user's own repo), but add a guard:
`if (!path.resolve(cloneDir, filePath).startsWith(path.resolve(cloneDir))) return null;`

### MINOR — Double-sort for filePath in doc/diagram loop is redundant
Lines 189-191 and 238-240 sort `inputs` by filePath to pick the lexicographically first path.
`computeCompositeSha` already sorts internally. The external sort is harmless but redundant — you
could pick `inputs[0].filePath` after `computeCompositeSha` sorts internally, or expose the sort.
Low priority — cosmetic.

### SUGGESTION — as DocContent cast is redundant given discriminated union guard
Lines 175-176 and 227-228: the kind guard `artifact.content.kind !== 'doc'` before the `as DocContent`
cast is sufficient for discriminated union narrowing. TypeScript should narrow automatically after the
`continue` path. The cast is safe but stylistically redundant. Could replace with:
`const doc = artifact.content;` after the guard (TS should infer DocContent).

### SUGGESTION — forceSplitLines cannot handle a single line exceeding maxChunkTokens
If a CIG node has a single source line longer than maxChunkTokens*CHARS_PER_TOKEN (e.g., a minified
file stored as one line), targetLines=1 and forceSplitLines emits one chunk that still exceeds the
limit. No test covers this. In v1 this is an acceptable limitation (minified files should be excluded
by FileFilter), but worth a comment in forceSplitLines docstring.

## Confirmed Correct
- Zero @backstage/* imports ✓
- Config injected via ChunkingConfig ✓
- All I/O through StorageAdapter interface ✓
- computeCompositeSha correctly mirrors ContextBuilder.computeInputSha (filepath:sha pairs sorted by filePath) ✓
- Chunk ID format matches build plan spec ✓
- Sub-chunk IDs stable and deterministic ✓
- extractedSha fallback when RepoFile not found ✓
- Serial source file reads use try/catch with graceful skip ✓
- Blank-line and paragraph boundary splitting logic correct ✓
- forceSplitLines fallback correctly triggered when no blank lines found ✓
- Edge type filter (only 'calls') for calls/calledBy correct ✓
- 28/28 tests pass ✓

## Pattern Notes
- ChunkingService takes optional Logger (same pattern as DiagramGenerationService logger param)
- ChunkingService takes StorageAdapter + optional Logger + optional ChunkingConfig — clean constructor
- `estimateTokens` is exported (for use by IndexingService in 5.3)
- `computeCompositeSha` exported and reusable by IndexingService
- filesBySha map built once, reused per-node (correct — avoids N lookups in nodesById)
- edgesByFrom / edgesByTo maps built from full edge list — O(n) prep, O(1) lookup per node. Good.
- nodesById map for call-graph label resolution — correct pattern

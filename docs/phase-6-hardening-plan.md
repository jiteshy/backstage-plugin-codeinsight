# Phase 6: Pre-Beta Hardening Plan

> **Goal:** Fix confirmed bugs and close config/API gaps before any external user testing.
> Scope: doc generation, diagram generation, and QnA are all feature-complete.
> This phase hardens what exists and adds one targeted good-to-have (repo re-registration).
>
> All tasks here must be completed before marking the product ready for initial user testing.

---

## 6.0 — Critical Bug Fixes

These are correctness bugs that will cause incorrect behaviour with real users.

---

### 6.0.1 — Repo ID Collision Fix ✅ Must Fix

**Problem:**
`EntityCodeInsightContent.tsx:1212` derives `repoId` as:

```ts
const repoId = annotation ? annotation.replaceAll('/', '-') : null;
```

The `github.com/project-slug` annotation value is `owner/repo`. Replacing `/` with `-` creates collisions:
- `org-a/my-repo` → `org-a-my-repo`
- `org-a-my/repo` → `org-a-my-repo`  ← same ID, different repo

Any two organisations whose combined slug produces the same hyphenated string will share DB rows, causing one team to see another team's docs, diagrams, and QnA.

**Fix:**
Use the annotation value directly as `repoId` (already unique by Backstage convention). The only constraint is that `repoId` must be URL-safe for use in route parameters. Replace `/` with `~` (URL-safe, visually unambiguous) rather than `-`.

```ts
const repoId = annotation ? annotation.replace('/', '~') : null;
// 'acme-corp/backend' → 'acme-corp~backend'
```

**Affected files:**
- `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx` — derive repoId
- `packages/backstage/plugin/src/api-client.ts` — verify no extra encoding
- `packages/backstage/plugin-backend/src/router.ts` — `:repoId` param, confirm Express handles `~`

**Note on existing data:** Any repos already registered with the old `-`-based ID will need to be re-ingested after the fix. Document this in release notes.

---

### 6.0.2 — SSE Disconnect Does Not Abort LLM Stream ✅ Must Fix

**Problem:**
`router.ts:252-282` — the `/ask-stream` route iterates the LLM stream with `for await`:

```ts
const stream = qnaService.askStream(sessionId, question);
for await (const token of stream) {
  res.write(`data: ${JSON.stringify({ token })}\n\n`);
}
```

When the browser tab is closed or the user navigates away, the SSE connection drops but the backend keeps calling the LLM until the full answer is generated, wasting tokens and compute.

**Fix:**
Wire an `AbortController` to the `req.on('close')` event and pass the signal through to `QnAService.askStream()`.

```ts
const controller = new AbortController();
req.on('close', () => controller.abort());

const stream = qnaService.askStream(sessionId, question, controller.signal);
```

`QnAService.askStream()` (and the underlying `LLMClient.stream()`) must propagate the signal and throw/return early when aborted.

**Affected files:**
- `packages/backstage/plugin-backend/src/router.ts` — add AbortController wiring
- `packages/core/qna/src/QnAService.ts` — accept and propagate `AbortSignal` in `askStream()`
- `packages/core/types/src/interfaces.ts` — add optional `signal?: AbortSignal` to `LLMOptions`
- `packages/adapters/llm/src/AnthropicLLMClient.ts` — pass signal to Anthropic SDK stream
- `packages/adapters/llm/src/OpenAILLMClient.ts` — pass signal to OpenAI SDK stream

---

### 6.0.3 — Stream Retry Re-yields Duplicate Tokens ✅ Must Fix

**Problem:**
`RetryingLLMClient.ts:115-143` — if a 429 hits mid-stream (after some tokens have already been yielded), the retry restarts the stream from the beginning, causing the caller to receive duplicate tokens:

```ts
for let attempt = 0; attempt <= MAX_RETRIES; attempt++ {
  try {
    for await (const chunk of this.inner.stream(...)) {
      yield chunk;  // already yielded on previous attempt before the error
    }
    return;
  } catch (err) {
    // retries — re-yields from the start
  }
}
```

**Fix:**
Do not retry a stream that has already started yielding. Once the first chunk is emitted, the caller has begun rendering; a retry would produce gibberish. The correct behaviour is to propagate the error so the frontend can show a "stream failed" message.

```ts
async *stream(...): AsyncIterable<string> {
  let started = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await this.waitBeforeRetry(attempt, lastErr);
    try {
      for await (const chunk of this.inner.stream(...)) {
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      if (started || !isRateLimitError(err) || attempt >= MAX_RETRIES) throw err;
      lastErr = err;
    }
  }
}
```

**Affected files:**
- `packages/adapters/llm/src/RetryingLLMClient.ts` — add `started` guard

---

## 6.1 — Config & Schema Gaps

These don't cause bugs today but will trip up operators configuring the plugin.

---

### 6.1.1 — Add QnA Config Namespace to `config.d.ts` ✅ Must Fix

**Problem:**
`plugin.ts:252-263` reads `codeinsight.qna.*` keys from the Backstage config:

```ts
config.getOptionalNumber('codeinsight.qna.maxHistoryTurns')
config.getOptionalNumber('codeinsight.qna.compressAfterTurns')
config.getOptionalNumber('codeinsight.qna.maxContextTokens')
config.getOptionalNumber('codeinsight.qna.maxAnswerTokens')
config.getOptionalNumber('codeinsight.qna.temperature')
```

None of these keys are declared in `packages/backstage/plugin-backend/config.d.ts`. Backstage config schema validation will warn about unknown keys. Operators get no autocomplete, no docs, and no validation.

**Fix:**
Add a `qna` block to the `codeinsight` namespace in `config.d.ts`:

```ts
qna?: {
  /** Max conversation turns kept in the prompt window. Default: 6. */
  maxHistoryTurns?: number;
  /** Compress older turns after this many messages. Default: 10. */
  compressAfterTurns?: number;
  /** Max tokens for assembled retrieval context. Default: 8000. */
  maxContextTokens?: number;
  /** Max tokens for LLM answer generation. Default: 2000. */
  maxAnswerTokens?: number;
  /** LLM temperature for answer generation. Default: 0.3. */
  temperature?: number;
};
```

Also add `QnAConfig` to `CodeInsightConfig` in `packages/core/types/src/config.ts` so the type flows through the typed config system consistently with `DocGenConfig` and `DiagramGenConfig`.

**Affected files:**
- `packages/backstage/plugin-backend/config.d.ts` — add `qna` namespace
- `packages/core/types/src/config.ts` — add `QnAConfig` interface, add `qna?: QnAConfig` to `CodeInsightConfig`

---

### 6.1.2 — Widen `EmbeddingConfig.provider` Type ✅ Must Fix

**Problem:**
`packages/core/types/src/config.ts:29`:

```ts
export interface EmbeddingConfig {
  provider: 'openai';   // ← literal type
  ...
}
```

This rejects any operator who tries to configure a non-OpenAI embedding provider (e.g., Voyage, Cohere). The `config.d.ts` already uses `provider?: string` (more permissive) creating an inconsistency. If a future embedding adapter is added, `EmbeddingConfig` becomes a compile-time blocker.

**Fix:**
Widen to a union that matches the real set of supported adapters, consistent with `LLMConfig`:

```ts
export interface EmbeddingConfig {
  provider: 'openai' | string;  // 'openai' keeps autocomplete, string allows extensions
  ...
}
```

Or, if only OpenAI is planned for the foreseeable future, add a comment clarifying this is intentional and document the extension point.

**Affected files:**
- `packages/core/types/src/config.ts` — widen `EmbeddingConfig.provider`

---

## 6.2 — Improvements & Hardening

These don't cause data loss or billing waste but improve robustness for real deployments.

---

### 6.2.1 — Repo Registration Input Validation

**Problem:**
The `POST /repos/:repoId/ingest` route accepts any `repoUrl` in the request body and passes it directly to `IngestionService.runPipeline()` without validating format. A malformed URL causes an unhelpful cryptic error deep in the Git clone step. There is also no check that `repoUrl` matches the `repoId` derived from the Backstage entity annotation — a mismatch would silently ingest the wrong repository under a given ID.

**Fix:**
In the route handler, validate that:
1. `repoUrl` is a parseable `https://` URL.
2. The hostname is a known Git provider (`github.com`, `gitlab.com`, `bitbucket.org`) — or allow-list via config.
3. The `repoId` matches what would be derived from that URL's owner/repo path.

Return a clear `400 Bad Request` with an actionable message on failure.

**Affected files:**
- `packages/backstage/plugin-backend/src/router.ts` — add `repoUrl` validation helper

---

### 6.2.2 — InProcessJobQueue Startup Warning for Lost Jobs

**Problem:**
`InProcessJobQueue` holds all queued and running jobs in memory. On any server restart (deploy, crash, OOM kill), all in-flight jobs are silently lost. The frontend shows the spinner indefinitely because the job ID was stored in `sessionStorage` but the backend has forgotten the job.

**Fix:**
On plugin startup, log a prominent warning that in-flight jobs from a previous run may be lost and that re-triggering ingestion is required. Additionally, the frontend should handle a `404` response on `GET /repos/:repoId/jobs/:jobId` by clearing `sessionStorage` and resetting the UI to the idle state (instead of polling forever).

**Affected files:**
- `packages/backstage/plugin-backend/src/plugin.ts` — add startup log warning
- `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx` — handle `404` on job poll → clear stored job ID, reset to idle

---

### 6.2.3 — QnA Session Lost on Server Restart

**Problem:**
`QnAService` stores active sessions in a `Map<string, Session>` (in-memory). On server restart, all session state is lost. The frontend stores the `sessionId` in React state (not `sessionStorage`), so it will be lost on page refresh anyway — but a mid-conversation server restart will cause a confusing `404 Session not found` error with no user-facing explanation.

**Fix:**
The frontend `QnAContent` component should catch `404` errors on `ask` / `ask-stream` calls, display a friendly "Session expired. Starting a new conversation." message, and automatically create a new session. No backend changes required.

**Affected files:**
- `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx` — handle session-not-found 404 in `handleAsk()`

---

### 6.2.4 — Path Traversal Guard in IngestionService

**Problem:**
`IngestionService.ts:189`:

```ts
const cloneDir = path.join(this.config.tempDir, repoId);
```

After the repo ID fix in 6.0.1 (`~` separator), the repoId will be `owner~repo`, safe for path joins. However, this guard is absent and relies on the repoId always being well-formed. A misconfigured Backstage annotation (e.g., `../../../etc`) or a future code path that derives repoId differently could escape the temp directory.

**Fix:**
After computing `cloneDir`, assert it starts with `this.config.tempDir`:

```ts
const cloneDir = path.resolve(this.config.tempDir, repoId);
if (!cloneDir.startsWith(path.resolve(this.config.tempDir) + path.sep)) {
  throw new Error(`Invalid repoId produces unsafe clone path: ${repoId}`);
}
```

**Affected files:**
- `packages/core/ingestion/src/IngestionService.ts` — add path containment check

---

## 6.3 — Good-to-Have Feature: Repo Re-registration

**User story:**
An operator registered a repo under an old LLM model. They want to switch to a better model, change the GitHub token, or simply force a fresh full re-ingestion (wipe all existing docs/diagrams/QnA and start clean). Currently this requires direct database manipulation.

**Scope:**
- Backend: `DELETE /repos/:repoId` — hard-delete repo row, all artifacts, all QnA chunks, all sessions. Returns `204`.
- Frontend: An "Advanced" or "Settings" overflow menu on the plugin header with a "Reset & Re-discover" option that:
  1. Shows a confirmation dialog: "This will delete all generated docs, diagrams, and Q&A for this repo. You can re-run discovery after. Continue?"
  2. On confirm: calls `DELETE /repos/:repoId`, then immediately triggers a new full ingestion.
  3. Handles the transition state cleanly (shows loading, then resets to first-run state).

**Out of scope for this task:**
- Partial re-configuration (changing model without wiping data) — this would require a separate migration path and is deferred.
- Per-feature wipe (e.g., wipe only docs) — deferred.

**Affected files:**
- `packages/core/types/src/interfaces.ts` — add `deleteRepo(repoId: string): Promise<void>` to `StorageAdapter`
- `packages/adapters/storage/src/KnexStorageAdapter.ts` — implement `deleteRepo` (delete from `ci_repos`, cascade via FK)
- `packages/backstage/plugin-backend/src/router.ts` — add `DELETE /repos/:repoId` route
- `packages/backstage/plugin/src/api.ts` — add `deleteRepo(repoId: string): Promise<void>` to `CodeInsightApi`
- `packages/backstage/plugin/src/api-client.ts` — implement `deleteRepo`
- `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx` — add overflow menu, confirmation dialog, reset flow

---

## Summary — Priority Order

| # | Task | Category | Effort |
|---|------|----------|--------|
| 6.0.1 | Repo ID collision fix | Critical Bug | S |
| 6.0.2 | SSE disconnect → LLM abort | Critical Bug | M |
| 6.0.3 | Stream retry token duplication | Critical Bug | S |
| 6.1.1 | `config.d.ts` QnA section | Config Gap | S |
| 6.1.2 | `EmbeddingConfig.provider` type widening | Config Gap | XS |
| 6.2.1 | Repo registration URL validation | Hardening | S |
| 6.2.2 | Job lost on restart — frontend 404 handling | Hardening | S |
| 6.2.3 | Session lost on restart — frontend error handling | Hardening | XS |
| 6.2.4 | Path traversal guard in IngestionService | Hardening | XS |
| 6.3 | Repo re-registration (delete + re-ingest flow) | Feature | M |

**Estimated total effort:** ~2–3 days solo.

---

## Acceptance Criteria

- [ ] Two repos with slugs `org-a/my-repo` and `org-a-my/repo` registered independently produce separate rows in `ci_repos` with distinct IDs.
- [ ] Closing the browser tab while an LLM stream is in progress terminates the stream on the backend (verifiable via server logs showing "stream aborted").
- [ ] A 429 that arrives before the first stream token is retried successfully; a 429 after the first token propagates as an error to the frontend.
- [ ] `pnpm --filter @codeinsight/plugin-backend lint` passes with no unknown config key warnings for `codeinsight.qna.*`.
- [ ] Configuring `embeddings.provider: voyage` in `app-config.yaml` does not produce a TypeScript compile error.
- [ ] Submitting an invalid `repoUrl` to `POST /repos/:repoId/ingest` returns `400` with a descriptive message.
- [ ] A server restart while a job is in-progress results in the frontend displaying idle state after the next poll (no infinite spinner).
- [ ] A server restart mid-QnA-conversation results in "Session expired" message in the chat UI with automatic new session creation.
- [ ] "Reset & Re-discover" flow in the UI deletes all existing data, triggers fresh ingestion, and returns to first-run state cleanly.

# Feedback Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thumbs up/down rating buttons to doc sections, diagram cards, and Q&A answers so users can signal output quality, with all ratings persisted to a single DB table.

**Architecture:** One new migration adds `ci_artifact_feedback` table. One new `StorageAdapter` method (`saveFeedback`) writes to it. One new backend route (`POST /repos/:repoId/feedback`) calls that method. The frontend API interface and client get a `submitFeedback` method. Thumbs UI is added inline to each of the three content types — `DocSectionCard`, `DiagramCard`, and the Q&A answer bubble — with local optimistic state so the button feels instant.

**Tech Stack:** Knex (migration), TypeScript, Express (route), React + MUI (UI), existing `@backstage/core-plugin-api` patterns.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/adapters/storage/migrations/019_ci_artifact_feedback.ts` | Create | New table migration |
| `packages/core/types/src/interfaces.ts` | Modify | Add `saveFeedback` to `StorageAdapter` interface |
| `packages/core/types/src/data.ts` | Modify | Add `ArtifactFeedback` type |
| `packages/adapters/storage/src/KnexStorageAdapter.ts` | Modify | Implement `saveFeedback` |
| `packages/backstage/plugin-backend/src/router.ts` | Modify | Add `POST /repos/:repoId/feedback` route |
| `packages/backstage/plugin/src/api.ts` | Modify | Add `submitFeedback` to `CodeInsightApi` interface |
| `packages/backstage/plugin/src/api-client.ts` | Modify | Implement `submitFeedback` in `CodeInsightClient` |
| `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx` | Modify | Add `ThumbsRating` component + wire into `DocSectionCard`, `DiagramCard`, Q&A answer bubble |

---

## Task 1: Migration — `ci_artifact_feedback` table

**Files:**
- Create: `packages/adapters/storage/migrations/019_ci_artifact_feedback.ts`

- [ ] **Step 1: Write the migration**

```typescript
// packages/adapters/storage/migrations/019_ci_artifact_feedback.ts
import type { Knex } from 'knex';

/**
 * Stores thumbs up/down ratings for generated artifacts (docs, diagrams, Q&A answers).
 *
 * artifact_id — matches ci_artifacts.artifact_id (or a Q&A message_id for Q&A ratings)
 * artifact_type — 'doc' | 'diagram' | 'qna'
 * rating — 1 (thumbs up) | -1 (thumbs down)
 *
 * No FK to ci_artifacts because Q&A ratings reference message IDs from ci_qna_messages,
 * not the artifact table. Referential integrity enforced at the application layer.
 *
 * No user tracking for MVP — one rating per (repo_id, artifact_id) pair (last-write-wins).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ci_artifact_feedback', table => {
    table.text('repo_id').notNullable();
    table.text('artifact_id').notNullable();
    table.text('artifact_type').notNullable(); // 'doc' | 'diagram' | 'qna'
    table.integer('rating').notNullable();     // 1 | -1
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['repo_id', 'artifact_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('ci_artifact_feedback');
}
```

- [ ] **Step 2: Run the migration**

```bash
pnpm db:migrate
```

Expected: migration 019 runs without error. Verify:
```bash
psql -h localhost -p 5433 -U codeinsight -d backstage_plugin_codeinsight \
  -c "\d ci_artifact_feedback"
```
Should show columns: `repo_id`, `artifact_id`, `artifact_type`, `rating`, `created_at`.

---

## Task 2: Shared types — `ArtifactFeedback` + `StorageAdapter.saveFeedback`

**Files:**
- Modify: `packages/core/types/src/data.ts`
- Modify: `packages/core/types/src/interfaces.ts`

- [ ] **Step 1: Add `ArtifactFeedback` to `data.ts`**

Find the file and add after the last exported type:

```typescript
export interface ArtifactFeedback {
  repoId: string;
  artifactId: string;
  artifactType: 'doc' | 'diagram' | 'qna';
  rating: 1 | -1;
}
```

- [ ] **Step 2: Add `saveFeedback` to `StorageAdapter` in `interfaces.ts`**

Find the `StorageAdapter` interface and add after `deleteRepo`:

```typescript
saveFeedback(feedback: ArtifactFeedback): Promise<void>;
```

Make sure `ArtifactFeedback` is imported at the top of `interfaces.ts` (it's in the same package so it'll be `import type { ArtifactFeedback } from './data'` or re-exported from `index.ts` — follow the existing import pattern in the file).

- [ ] **Step 3: Build the types package to confirm no errors**

```bash
pnpm --filter @codeinsight/types build
```

Expected: clean build, no TypeScript errors.

---

## Task 3: Storage adapter — implement `saveFeedback`

**Files:**
- Modify: `packages/adapters/storage/src/KnexStorageAdapter.ts`

- [ ] **Step 1: Add `FeedbackRow` interface near the other row types (around line 120)**

```typescript
interface FeedbackRow {
  repo_id: string;
  artifact_id: string;
  artifact_type: string;
  rating: number;
  created_at: Date;
}
```

- [ ] **Step 2: Implement `saveFeedback` on `KnexStorageAdapter`**

Find the class and add as a new method (follow the pattern of other single-row upserts in the file):

```typescript
async saveFeedback(feedback: ArtifactFeedback): Promise<void> {
  await this.db('ci_artifact_feedback')
    .insert({
      repo_id: feedback.repoId,
      artifact_id: feedback.artifactId,
      artifact_type: feedback.artifactType,
      rating: feedback.rating,
      created_at: new Date(),
    })
    .onConflict(['repo_id', 'artifact_id'])
    .merge(['rating', 'created_at']);
}
```

- [ ] **Step 3: Ensure `ArtifactFeedback` is imported at the top of `KnexStorageAdapter.ts`**

It should already come through `@codeinsight/types`. Add `ArtifactFeedback` to the existing import from `@codeinsight/types`.

- [ ] **Step 4: Build the storage adapter to confirm no errors**

```bash
pnpm --filter @codeinsight/storage build
```

Expected: clean build.

---

## Task 4: Backend route — `POST /repos/:repoId/feedback`

**Files:**
- Modify: `packages/backstage/plugin-backend/src/router.ts`

- [ ] **Step 1: Add the feedback route to `router.ts`**

Add after the `DELETE /repos/:repoId` route block:

```typescript
// ---------------------------------------------------------------------------
// Feedback — submit thumbs up/down for a doc section, diagram, or Q&A answer
// POST /repos/:repoId/feedback
// Body: { artifactId: string, artifactType: 'doc' | 'diagram' | 'qna', rating: 1 | -1 }
// ---------------------------------------------------------------------------

const VALID_ARTIFACT_TYPES = new Set(['doc', 'diagram', 'qna']);
const VALID_RATINGS = new Set([1, -1]);

router.post('/repos/:repoId/feedback', async (req, res) => {
  const { repoId } = req.params;
  const { artifactId, artifactType, rating } = req.body ?? {};

  if (!artifactId || typeof artifactId !== 'string') {
    res.status(400).json({ error: 'artifactId is required' });
    return;
  }
  if (!VALID_ARTIFACT_TYPES.has(artifactType)) {
    res.status(400).json({ error: 'artifactType must be one of: doc, diagram, qna' });
    return;
  }
  if (!VALID_RATINGS.has(rating)) {
    res.status(400).json({ error: 'rating must be 1 or -1' });
    return;
  }

  await storageAdapter.saveFeedback({ repoId, artifactId, artifactType, rating });
  res.status(204).end();
});
```

- [ ] **Step 2: Build plugin-backend**

```bash
pnpm --filter @codeinsight/plugin-backend build
```

Expected: clean build.

---

## Task 5: Frontend API — `submitFeedback`

**Files:**
- Modify: `packages/backstage/plugin/src/api.ts`
- Modify: `packages/backstage/plugin/src/api-client.ts`

- [ ] **Step 1: Add `submitFeedback` to `CodeInsightApi` interface in `api.ts`**

```typescript
submitFeedback(
  repoId: string,
  artifactId: string,
  artifactType: 'doc' | 'diagram' | 'qna',
  rating: 1 | -1,
): Promise<void>;
```

- [ ] **Step 2: Implement `submitFeedback` in `CodeInsightClient` in `api-client.ts`**

```typescript
async submitFeedback(
  repoId: string,
  artifactId: string,
  artifactType: 'doc' | 'diagram' | 'qna',
  rating: 1 | -1,
): Promise<void> {
  const base = await this.baseUrl();
  const response = await this.fetchApi.fetch(
    `${base}/repos/${encodeURIComponent(repoId)}/feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifactId, artifactType, rating }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to submit feedback: ${response.statusText}`);
  }
}
```

- [ ] **Step 3: Build the plugin**

```bash
pnpm --filter @codeinsight/plugin build
```

Expected: clean build.

---

## Task 6: Frontend UI — `ThumbsRating` component + wire into all three cards

**Files:**
- Modify: `packages/backstage/plugin/src/components/EntityCodeInsightContent.tsx`

This is one task because all three wiring points are in the same file and share identical logic. The `ThumbsRating` component is defined once and reused.

### 6a — Add `ThumbsRating` component

- [ ] **Step 1: Add MUI `Tooltip` and `IconButton` imports (already present — verify)**

Check the top of `EntityCodeInsightContent.tsx`. `IconButton` and `Tooltip` are already imported. No new MUI imports needed — thumbs icons are rendered as Unicode characters (`▲` / `▼`) inside `IconButton` children to avoid adding an icon library dependency.

- [ ] **Step 2: Add `ThumbsRating` component**

Add this just before the `TableOfContents` function (around line 585):

```typescript
// ---------------------------------------------------------------------------
// ThumbsRating
// ---------------------------------------------------------------------------

interface ThumbsRatingProps {
  repoId: string;
  artifactId: string;
  artifactType: 'doc' | 'diagram' | 'qna';
}

function ThumbsRating({ repoId, artifactId, artifactType }: ThumbsRatingProps) {
  const api = useApi(codeInsightApiRef);
  // null = no rating yet, 1 = thumbs up, -1 = thumbs down
  const [rating, setRating] = useState<1 | -1 | null>(null);

  const handleRate = useCallback(async (value: 1 | -1) => {
    // Optimistic update
    setRating(prev => prev === value ? null : value);
    try {
      const next = rating === value ? null : value;
      if (next !== null) {
        await api.submitFeedback(repoId, artifactId, artifactType, next);
      }
    } catch {
      // Silently revert on error — feedback is best-effort
      setRating(rating);
    }
  }, [api, repoId, artifactId, artifactType, rating]);

  return (
    <Box display="inline-flex" alignItems="center" style={{ gap: 2 }}>
      <Tooltip title="Helpful">
        <IconButton
          size="small"
          onClick={() => handleRate(1)}
          style={{ opacity: rating === 1 ? 1 : 0.4, padding: 4 }}
        >
          <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>👍</span>
        </IconButton>
      </Tooltip>
      <Tooltip title="Not helpful">
        <IconButton
          size="small"
          onClick={() => handleRate(-1)}
          style={{ opacity: rating === -1 ? 1 : 0.4, padding: 4 }}
        >
          <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>👎</span>
        </IconButton>
      </Tooltip>
    </Box>
  );
}
```

### 6b — Wire into `DocSectionCard`

- [ ] **Step 3: Find `DocSectionCard` and locate its header/title row**

Search for `function DocSectionCard` in `EntityCodeInsightContent.tsx`. Find where the section title (`artifactId` label) is rendered. The card has a header area with the section name and a stale chip.

- [ ] **Step 4: Add `ThumbsRating` to `DocSectionCard`**

`DocSectionCard` receives `section: DocSection` and `repoId` is not currently a prop. Two options: pass `repoId` down or read it from context. The simplest approach is to add `repoId` as a prop:

Change the component signature from:
```typescript
function DocSectionCard({ section }: { section: DocSection }) {
```
to:
```typescript
function DocSectionCard({ section, repoId }: { section: DocSection; repoId: string }) {
```

Then in the card's header area (wherever the title and stale chip appear), add `ThumbsRating` to the right:
```typescript
<ThumbsRating repoId={repoId} artifactId={section.artifactId} artifactType="doc" />
```

Update the call site in `DocumentationContent` (where `DocSectionCard` is rendered) to pass `repoId`:
```typescript
<DocSectionCard key={section.artifactId} section={section} repoId={repoId} />
```

`DocumentationContent` needs `repoId` as a prop too. Add it:
```typescript
function DocumentationContent({
  docs,
  loadError,
  isFirstRun,
  repoId,
}: {
  docs: DocSection[] | null;
  loadError: string | null;
  isFirstRun: boolean;
  repoId: string;
}) {
```

And update the call in `EntityCodeInsightContent`:
```typescript
<DocumentationContent docs={docs} loadError={loadError} isFirstRun={isFirstRun} repoId={repoId} />
```

(`repoId` is already in scope in the parent component — it's derived from the entity annotation.)

### 6c — Wire into `DiagramCard`

- [ ] **Step 5: Find `DiagramCard` and add `ThumbsRating`**

Search for `function DiagramCard`. It currently renders a card with title, description, and the Mermaid viewer. Add `repoId` as a prop (same pattern as `DocSectionCard`):

Change signature from:
```typescript
function DiagramCard({ diagram }: { diagram: DiagramSection }) {
```
to:
```typescript
function DiagramCard({ diagram, repoId }: { diagram: DiagramSection; repoId: string }) {
```

In the card footer or title area, add:
```typescript
<ThumbsRating repoId={repoId} artifactId={diagram.artifactId} artifactType="diagram" />
```

Update `DiagramsContent` to accept and pass `repoId`:
```typescript
function DiagramsContent({
  diagrams,
  loadError,
  isFirstRun,
  repoId,
}: {
  diagrams: DiagramSection[] | null;
  loadError: string | null;
  isFirstRun: boolean;
  repoId: string;
}) {
```

And pass it to each `DiagramCard`:
```typescript
<DiagramCard key={diagram.artifactId} diagram={diagram} repoId={repoId} />
```

Update the call site in `EntityCodeInsightContent`:
```typescript
<DiagramsContent diagrams={diagrams} loadError={diagramLoadError} isFirstRun={isFirstRun} repoId={repoId} />
```

### 6d — Wire into Q&A answer bubble

- [ ] **Step 6: Find the assistant message render in `QnAContent`**

Search for `role === 'assistant'` or the assistant message bubble in the chat render loop. It renders a `ChatMessage` which has `id`, `role`, `content`, `sources`.

Add `ThumbsRating` below the answer text for assistant messages. The `message.id` here is a client-side UUID (from `useState` initialisation), not a DB message ID. Check how messages are created:

In `handleSend`, messages are pushed with `id: crypto.randomUUID()` (or similar). This client ID won't match the DB. For MVP, use the message's position/session context — or simply use the `sessionId + index` as the `artifactId`. The cleanest MVP approach: use the message `id` as the `artifactId` for feedback (type `qna`). The backend stores whatever string is passed as `artifactId` — it doesn't validate against the messages table.

In the assistant bubble render:
```typescript
{message.role === 'assistant' && !message.isStreaming && (
  <Box display="flex" justifyContent="flex-end" mt={0.5}>
    <ThumbsRating repoId={repoId} artifactId={message.id} artifactType="qna" />
  </Box>
)}
```

`QnAContent` already has `repoId` as a prop, so no prop changes needed here.

- [ ] **Step 7: Build and verify**

```bash
pnpm --filter @codeinsight/plugin build
```

Expected: clean build, no TypeScript errors.

---

## Task 7: Manual smoke test

- [ ] **Step 1: Start backend and frontend**

```bash
pnpm dev:backend   # terminal 1
pnpm dev:app       # terminal 2
```

- [ ] **Step 2: Open the plugin, navigate to Documentation tab**

Click thumbs up on one doc section. Expect: button becomes fully opaque (opacity 1). Click again: button returns to dim (toggle off, no re-submission).

- [ ] **Step 3: Verify row in DB**

```bash
psql -h localhost -p 5433 -U codeinsight -d backstage_plugin_codeinsight \
  -c "SELECT * FROM ci_artifact_feedback;"
```

Expected: one row with `artifact_type = 'doc'`, `rating = 1`.

- [ ] **Step 4: Test diagram rating**

Navigate to Diagrams tab. Click thumbs down on a diagram card. Verify new row in DB with `artifact_type = 'diagram'`, `rating = -1`.

- [ ] **Step 5: Test Q&A rating**

Navigate to Q&A tab. Ask a question. After the streaming answer completes, click thumbs up. Verify row in DB with `artifact_type = 'qna'`, `rating = 1`.

- [ ] **Step 6: Test toggle behavior**

Click the same thumb again — it should optimistically toggle off (opacity drops back to 0.4). No additional DB row should appear (upsert means last-write-wins on the same `artifact_id`).

---

## Self-Review

**Spec coverage:**
- [x] Migration — Task 1
- [x] `StorageAdapter.saveFeedback` — Tasks 2 + 3
- [x] Backend route with validation — Task 4
- [x] Frontend API method — Task 5
- [x] `ThumbsRating` UI component — Task 6a
- [x] Doc section wiring — Task 6b
- [x] Diagram card wiring — Task 6c
- [x] Q&A answer wiring — Task 6d
- [x] Smoke test — Task 7

**Type consistency check:**
- `ArtifactFeedback.rating` is `1 | -1` throughout (data.ts → interface → KnexStorageAdapter → router validation → api.ts → api-client.ts)
- `artifactType` is `'doc' | 'diagram' | 'qna'` consistently
- `ThumbsRating` props match the `submitFeedback` signature exactly

**No placeholders:** All code blocks are complete and self-contained.

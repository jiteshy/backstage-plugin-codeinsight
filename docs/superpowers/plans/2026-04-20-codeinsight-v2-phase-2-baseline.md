# CodeInsight v2 — Phase 2 Baseline Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a v1 baseline eval report (`eval/reports/<date>-v1-baseline.json`) so later v2 phases can be compared against real numbers.

**Architecture:** Extract the plugin-backend composition root into a new framework-agnostic package `@codeinsight/composition` that exports `createIngestionStack(opts)`. Both `plugin.ts` and a new `v1Adapter.ts` (in `@codeinsight/eval`) call it — one source of truth, zero drift. v1Adapter implements `PipelineAdapter` (already defined in Phase 1), wraps LLM + embedding clients with cost tracking, manages per-repo DB cleanup against the dev Postgres, and exposes `version = "v1"`. CLI gains `--config <path>` to load `app-config.local.yaml`.

**Tech Stack:** TypeScript strict, pnpm workspace, Knex (existing), `@backstage/config` (read YAML via ConfigReader in plugin-backend only — `@codeinsight/composition` takes plain TS opts), simple-git (already a dep), existing `@codeinsight/*` packages.

---

## Architectural notes

**Package boundaries:**

- `@codeinsight/composition` is **new**, at `packages/composition/` (top-level, alongside `core/`, `adapters/`, `backstage/`).
- Depends on: all `@codeinsight/core/*`, all `@codeinsight/adapters/*`, `@codeinsight/types`.
- Zero `@backstage/*` imports — this is the key rule that lets `@codeinsight/eval` consume it.
- Zero `process.env` reads — opts are passed in.

**Hard rule check:**

- Rule 1 (no `@backstage/*` in core/ or adapters/): `@codeinsight/composition` is neither core nor adapter — it's a wiring layer, so adapter instantiation there is intentional. `@codeinsight/eval` remains under `packages/core/eval/` but imports only from `@codeinsight/composition`, which is @backstage-free.
- Rule 2 (config injected): `createIngestionStack({config: CompositionConfig})` takes a plain object. plugin.ts maps Backstage Config → CompositionConfig; v1Adapter.ts maps ConfigReader YAML → CompositionConfig.
- Rule 3 (I/O via interfaces): core services still receive interface-typed adapters; composition just wires concrete impls into those slots.

**DB isolation:** Baseline runs reuse the dev Postgres at `backstage_plugin_codeinsight` on port 5433. Before each repo ingest, v1Adapter deletes all rows for that `repo_id` across the `ci_*` tables (storage adapter already exposes `deleteRepo()`-equivalent methods; if not, the plan adds one). The composition factory accepts an injected `knex` instance so tests/eval can point at any DB.

**Cost tracking:** Wrap the factory's LLM and embedding clients with thin decorators that record token counts on a `CostTracker` instance held by v1Adapter. Decorators live in `@codeinsight/eval` (adapter-specific concern), not in composition.

---

## File Structure

| Path | Purpose |
|---|---|
| `packages/composition/package.json` | New workspace package `@codeinsight/composition` |
| `packages/composition/tsconfig.json` | Composite TS config with refs to all deps |
| `packages/composition/src/index.ts` | Re-exports `createIngestionStack`, `CompositionConfig`, `IngestionStack` |
| `packages/composition/src/createIngestionStack.ts` | Factory that returns `{storage, jobQueue, ingestionService, qnaService, llmClient, embeddingClient, vectorStore, logger}` |
| `packages/composition/src/types.ts` | `CompositionConfig` (plain TS config shape) and `IngestionStack` return type |
| `packages/composition/src/__tests__/createIngestionStack.test.ts` | Smoke test using in-memory-ish setup (mocked knex, no LLM keys) — verifies factory builds a full stack when config is complete, partial stack when LLM is missing |
| `packages/backstage/plugin-backend/package.json` | Add `"@codeinsight/composition": "workspace:*"` |
| `packages/backstage/plugin-backend/src/plugin.ts` | Modify: replace in-lined wiring with `createIngestionStack()` call; keep Backstage-specific router+auth-policy glue |
| `packages/core/eval/package.json` | Add deps: `"@codeinsight/composition": "workspace:*"`, `"@backstage/config": "^1.2.0"`, `"js-yaml": "^4.1.0"` + `@types/js-yaml` |
| `packages/core/eval/src/adapters/v1Adapter.ts` | New — implements `PipelineAdapter`, wires composition stack, cost tracking, DB cleanup |
| `packages/core/eval/src/adapters/costWrappers.ts` | New — `withLlmCostTracking(client, tracker)` and `withEmbeddingCostTracking(client, tracker)` |
| `packages/core/eval/src/adapters/loadConfig.ts` | New — loads `app-config.local.yaml` via `@backstage/config`'s ConfigReader (OK to import here since eval is a dev tool, not shipped — re-evaluate boundary if this becomes a concern) |
| `packages/core/eval/src/__tests__/costWrappers.test.ts` | Unit tests for cost tracking decorators |
| `packages/core/eval/src/__tests__/v1Adapter.test.ts` | Unit tests for v1Adapter with mocked composition stack |
| `packages/core/eval/src/cli.ts` | Modify: add `--config <path>` option to `run` and `baseline` subcommands; default `backstage/dev/app-config.local.yaml` |
| `packages/core/eval/src/index.ts` | Re-export `V1Adapter` class |
| `package.json` (root) | Modify: `eval:baseline` script already writes to `eval/reports/baseline/` — change to `eval/reports/<YYYY-MM-DD>-v1-baseline.json` |
| `eval/reports/2026-04-20-v1-baseline.json` | Output — committed at end |
| `eval/reports/README.md` | Update to reference baseline file |
| `docs/build-plan.md` | Mark 8.2 complete |

---

## Config file layout

Eval has its own standalone config file — not shared with `app-config.local.yaml`. Rationale:
- DB connection details (host/port/user/password) are eval-only concerns — not consumer-facing plugin config.
- Eval users may want different LLM/embedding keys than the dev app (e.g. a lower-cost account, or keys with higher quotas for long baseline runs).
- Keeping them separate also keeps `app-config.local.yaml` focused on the Backstage dev app.

**File location:** `eval/eval.config.local.yaml` (gitignored). An example template `eval/eval.config.example.yaml` is committed.

**Schema** (flat, eval-specific keys at the top):

```yaml
# eval/eval.config.local.yaml
db:
  host: localhost
  port: 5433
  user: codeinsight
  password: codeinsight
  database: backstage_plugin_codeinsight
llm:
  provider: anthropic
  apiKey: sk-ant-...
  model: claude-opus-4-7
embeddings:
  provider: openai
  apiKey: sk-openai-...
  model: text-embedding-3-small
cloneTempDir: /tmp/codeinsight-eval
githubToken: ghp_...     # optional, for private clones
```

**Parser:** `js-yaml` (no `@backstage/config` anywhere). eval stays `@backstage/*`-free. Loader returns `{ composition: CompositionConfig; db: KnexConnectionConfig }`.

---

### Task 1: Scaffold `@codeinsight/composition` package

**Files:**
- Create: `packages/composition/package.json`
- Create: `packages/composition/tsconfig.json`
- Create: `packages/composition/src/index.ts`
- Create: `packages/composition/src/types.ts`
- Modify: `tsconfig.json` (root) — add `{ "path": "./packages/composition" }` to references
- Modify: `pnpm-workspace.yaml` (verify `packages/**` already globs; if not, add `packages/composition`)

- [ ] **Step 1: Create `packages/composition/package.json`**

```json
{
  "name": "@codeinsight/composition",
  "version": "0.1.0",
  "description": "Composition root factory that wires CodeInsight core services + adapters into a ready-to-use stack. Framework-agnostic; zero @backstage imports.",
  "license": "Apache-2.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist *.tsbuildinfo",
    "test": "jest"
  },
  "dependencies": {
    "@codeinsight/chunking": "workspace:*",
    "@codeinsight/cig": "workspace:*",
    "@codeinsight/diagram-gen": "workspace:*",
    "@codeinsight/doc-generator": "workspace:*",
    "@codeinsight/embeddings": "workspace:*",
    "@codeinsight/indexing": "workspace:*",
    "@codeinsight/ingestion": "workspace:*",
    "@codeinsight/llm": "workspace:*",
    "@codeinsight/qna": "workspace:*",
    "@codeinsight/repo": "workspace:*",
    "@codeinsight/storage": "workspace:*",
    "@codeinsight/types": "workspace:*",
    "@codeinsight/vector-store": "workspace:*",
    "knex": "^3.1.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^20.11.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "~5.4.0"
  },
  "peerDependencies": {}
}
```

- [ ] **Step 2: Create `packages/composition/tsconfig.json`**

Mirror the structure of `packages/core/eval/tsconfig.json`. Reference all `@codeinsight/*` packages it depends on. Composite: true. `outDir: "./dist"`, `rootDir: "./src"`.

- [ ] **Step 3: Create `packages/composition/src/types.ts`**

```ts
import type {
  EmbeddingConfig,
  IngestionConfig,
  LLMConfig,
  Logger,
  QnAConfig,
  RepoCloneConfig,
} from '@codeinsight/types';
import type { DiagramGenConfig } from '@codeinsight/diagram-gen';
import type { DocGenConfig } from '@codeinsight/doc-generator';
import type { IndexingConfig } from '@codeinsight/indexing';
import type { IngestionService, InProcessJobQueue } from '@codeinsight/ingestion';
import type { DocGenerationService } from '@codeinsight/doc-generator';
import type { DiagramGenerationService } from '@codeinsight/diagram-gen';
import type { IndexingService } from '@codeinsight/indexing';
import type { QnAService } from '@codeinsight/qna';
import type { LLMClient, EmbeddingClient, StorageAdapter, VectorStore } from '@codeinsight/types';
import type { Knex } from 'knex';

/**
 * Plain-TS configuration for the composition factory. No framework-specific types.
 */
export interface CompositionConfig {
  repoClone: RepoCloneConfig;
  ingestion: IngestionConfig;
  llm?: LLMConfig;
  embedding?: EmbeddingConfig;
  docGen: DocGenConfig;
  diagramGen: DiagramGenConfig;
  indexing: IndexingConfig;
  qna: QnAConfig;
}

/**
 * Everything the caller needs to either mount a router or drive ingestion directly.
 */
export interface IngestionStack {
  storageAdapter: StorageAdapter;
  jobQueue: InProcessJobQueue;
  ingestionService: IngestionService;
  qnaService: QnAService | undefined;
  llmClient: LLMClient | undefined;
  embeddingClient: EmbeddingClient | undefined;
  vectorStore: VectorStore;
  docGenerationService: DocGenerationService | undefined;
  diagramGenerationService: DiagramGenerationService;
  indexingService: IndexingService | undefined;
  logger: Logger;
}

export interface CreateIngestionStackOpts {
  knex: Knex;
  logger: Logger;
  config: CompositionConfig;
  /** Allow callers to wrap LLM/embedding clients (e.g. cost tracking in eval). */
  wrapLlm?: (c: LLMClient) => LLMClient;
  wrapEmbedding?: (c: EmbeddingClient) => EmbeddingClient;
}
```

- [ ] **Step 4: Create placeholder `packages/composition/src/index.ts`**

```ts
export { createIngestionStack } from './createIngestionStack';
export type { CompositionConfig, IngestionStack, CreateIngestionStackOpts } from './types';
```

- [ ] **Step 5: Add package to root `tsconfig.json` references**

Add entry `{ "path": "./packages/composition" }` alphabetically with the other `@codeinsight/*` references.

- [ ] **Step 6: Install + build**

Run: `pnpm install`
Expected: `@codeinsight/composition` registered as a workspace package.

Run: `pnpm --filter @codeinsight/composition build`
Expected: FAILS because `createIngestionStack.ts` doesn't exist yet. That's the point — we write it in Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/composition tsconfig.json
git commit -m "feat(composition): scaffold @codeinsight/composition package"
```

---

### Task 2: Write `createIngestionStack()` factory

**Files:**
- Create: `packages/composition/src/createIngestionStack.ts`
- Create: `packages/composition/jest.config.ts`
- Create: `packages/composition/src/__tests__/createIngestionStack.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/composition/src/__tests__/createIngestionStack.test.ts
import { createIngestionStack } from '../createIngestionStack';
import type { CompositionConfig } from '../types';
import type { Logger } from '@codeinsight/types';

function mockKnex(): unknown {
  // Minimal shape — not executed in the factory (services hold it but don't query during construction).
  return { raw: jest.fn(), migrate: { latest: jest.fn() } };
}

const logger: Logger = {
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
};

const baseConfig: CompositionConfig = {
  repoClone: { tempDir: '/tmp/x', cloneTtlHours: 24, defaultDepth: 1, deltaDepth: 50 },
  ingestion: {
    tempDir: '/tmp/x', deltaThreshold: 0.4, maxConcurrentJobs: 2,
    jobTimeoutMinutes: 30, cloneDepth: 1, deltaCloneDepth: 50, cleanupAfterIngestion: true,
  },
  docGen: { maxConcurrency: 20, maxOutputTokens: 2000, temperature: 0.2 },
  diagramGen: { maxConcurrency: 10, maxOutputTokens: 2000, temperature: 0.2 },
  indexing: { modelTokenLimit: 8192, charsPerToken: 3 },
  qna: { maxHistoryTurns: 6, compressAfterTurns: 10, maxContextTokens: 8000, maxAnswerTokens: 2000, temperature: 0.3 },
};

describe('createIngestionStack', () => {
  it('returns a full stack when LLM and embedding configs are present', () => {
    const stack = createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: {
        ...baseConfig,
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-4-7' },
        embedding: { provider: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' },
      },
    });
    expect(stack.llmClient).toBeDefined();
    expect(stack.embeddingClient).toBeDefined();
    expect(stack.qnaService).toBeDefined();
    expect(stack.indexingService).toBeDefined();
    expect(stack.docGenerationService).toBeDefined();
  });

  it('returns a partial stack (no llm, no qna) when LLM config is omitted', () => {
    const stack = createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: baseConfig,
    });
    expect(stack.llmClient).toBeUndefined();
    expect(stack.qnaService).toBeUndefined();
    expect(stack.docGenerationService).toBeUndefined();
    expect(stack.indexingService).toBeUndefined();
    // Diagram gen works without LLM (pure-AST modules still run).
    expect(stack.diagramGenerationService).toBeDefined();
  });

  it('applies wrapLlm and wrapEmbedding when provided', () => {
    const wrapLlm = jest.fn(c => c);
    const wrapEmbedding = jest.fn(c => c);
    createIngestionStack({
      knex: mockKnex() as never,
      logger,
      config: {
        ...baseConfig,
        llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-4-7' },
        embedding: { provider: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' },
      },
      wrapLlm, wrapEmbedding,
    });
    expect(wrapLlm).toHaveBeenCalledTimes(1);
    expect(wrapEmbedding).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm --filter @codeinsight/composition test`
Expected: FAIL — createIngestionStack not exported.

- [ ] **Step 3: Write the factory**

Mirror plugin.ts lines 56–282 but parameterized. Concrete pseudocode (finalise types by reading plugin.ts lines 56–282 for exact constructor arities):

```ts
// packages/composition/src/createIngestionStack.ts
import { DiagramGenerationService } from '@codeinsight/diagram-gen';
import { DocGenerationService } from '@codeinsight/doc-generator';
import { createEmbeddingClient, deriveEmbeddingDimension } from '@codeinsight/embeddings';
import { IndexingService } from '@codeinsight/indexing';
import { InProcessJobQueue, IngestionService } from '@codeinsight/ingestion';
import { createLLMClient } from '@codeinsight/llm';
import { QnAService } from '@codeinsight/qna';
import { GitRepoConnector } from '@codeinsight/repo';
import { KnexStorageAdapter } from '@codeinsight/storage';
import { PgVectorStore, syncEmbeddingDimension } from '@codeinsight/vector-store';

import type { IngestionStack, CreateIngestionStackOpts } from './types';

export function createIngestionStack(opts: CreateIngestionStackOpts): IngestionStack {
  const { knex, logger, config, wrapLlm, wrapEmbedding } = opts;

  const storageAdapter = new KnexStorageAdapter(knex);

  const repoConnector = new GitRepoConnector(config.repoClone, logger);

  const rawLlm = config.llm ? createLLMClient(config.llm, logger, knex) : undefined;
  const llmClient = rawLlm && wrapLlm ? wrapLlm(rawLlm) : rawLlm;

  const rawEmbedding = config.embedding ? createEmbeddingClient(config.embedding, logger, knex) : undefined;
  const embeddingClient = rawEmbedding && wrapEmbedding ? wrapEmbedding(rawEmbedding) : rawEmbedding;

  const embeddingModelName = config.embedding?.model ?? 'text-embedding-3-small';
  const vectorStore = new PgVectorStore(knex, logger, embeddingModelName);

  const docGenerationService = llmClient
    ? new DocGenerationService(storageAdapter, llmClient, logger, {
        ...config.docGen,
        modelName: config.llm?.model,
      })
    : undefined;

  const diagramGenerationService = new DiagramGenerationService(
    storageAdapter, logger, llmClient,
    { ...config.diagramGen, modelName: config.llm?.model },
  );

  const indexingService = embeddingClient
    ? new IndexingService(embeddingClient, vectorStore, storageAdapter, logger, config.indexing, llmClient)
    : undefined;

  const ingestionService = new IngestionService(
    repoConnector, storageAdapter, logger, config.ingestion,
    undefined, undefined,
    docGenerationService, diagramGenerationService, indexingService,
  );

  const jobQueue = new InProcessJobQueue(
    ingestionService, storageAdapter, config.ingestion.maxConcurrentJobs,
  );

  const qnaService = llmClient && embeddingClient
    ? new QnAService(llmClient, embeddingClient, storageAdapter, vectorStore, config.qna, logger)
    : undefined;

  return {
    storageAdapter, jobQueue, ingestionService, qnaService, llmClient, embeddingClient,
    vectorStore, docGenerationService, diagramGenerationService, indexingService, logger,
  };
}

/**
 * Sync pgvector dimension after migrations. Side-effecting, so callers opt in.
 * plugin-backend calls this after `knex.migrate.latest()`; v1Adapter calls it after per-repo cleanup.
 */
export async function ensureEmbeddingDimension(
  knex: import('knex').Knex,
  logger: import('@codeinsight/types').Logger,
  embedding: import('@codeinsight/types').EmbeddingConfig,
): Promise<void> {
  const expectedDimension = deriveEmbeddingDimension(embedding);
  const expectedModel = embedding.model ?? 'text-embedding-3-small';
  await syncEmbeddingDimension(knex, expectedDimension, expectedModel, logger);
}
```

Also add `jest.config.ts` mirroring `packages/core/eval/jest.config.ts` structure (copy and adjust moduleNameMapper).

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @codeinsight/composition test`
Expected: 3 tests pass.

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @codeinsight/composition build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/composition
git commit -m "feat(composition): add createIngestionStack factory"
```

---

### Task 3: Refactor `plugin.ts` to use the factory

**Files:**
- Modify: `packages/backstage/plugin-backend/package.json` — add `"@codeinsight/composition": "workspace:*"`
- Modify: `packages/backstage/plugin-backend/tsconfig.json` — add reference `{ "path": "../../composition" }`
- Modify: `packages/backstage/plugin-backend/src/plugin.ts` — replace lines 56–282 with factory call + config adaption

- [ ] **Step 1: Add dep + tsconfig reference**

Edit `packages/backstage/plugin-backend/package.json`:
```json
  "dependencies": {
    ...
    "@codeinsight/composition": "workspace:*",
    ...
  }
```

Edit `packages/backstage/plugin-backend/tsconfig.json` references array:
```json
    { "path": "../../composition" },
```

Run: `pnpm install`

- [ ] **Step 2: Refactor `plugin.ts`**

Read current plugin.ts (317 lines). Replace inline wiring with:

```ts
// ... keep imports for createBackendPlugin, coreServices, migrations dir
import { createIngestionStack, ensureEmbeddingDimension } from '@codeinsight/composition';
import type { CompositionConfig } from '@codeinsight/composition';
import type { Logger, LLMConfig, EmbeddingConfig } from '@codeinsight/types';

// ... inside init()

// 1) Run migrations (same as today)
const knex = await database.getClient();
const migrationsDir = path.resolve(__dirname, '../../../adapters/storage/migrations');
await knex.migrate.latest({ directory: migrationsDir, loadExtensions: ['.js', '.ts'], tableName: 'ci_knex_migrations' });

// 2) Adapt Backstage logger
const coreLogger: Logger = {
  debug: (m, meta) => logger.debug(m, meta as never),
  info:  (m, meta) => logger.info(m,  meta as never),
  warn:  (m, meta) => logger.warn(m,  meta as never),
  error: (m, meta) => logger.error(m, meta as never),
};

// 3) Build CompositionConfig from Backstage Config
const tempDir = config.getOptionalString('codeinsight.cloneTempDir') ?? '/tmp/codeinsight';

const llmProvider = config.getOptionalString('codeinsight.llm.provider');
const llmApiKey   = config.getOptionalString('codeinsight.llm.apiKey');
const llmModel    = config.getOptionalString('codeinsight.llm.model');
const llmConfig: LLMConfig | undefined =
  llmProvider && llmApiKey && llmModel
    ? { provider: llmProvider as LLMConfig['provider'], apiKey: llmApiKey, model: llmModel }
    : undefined;

const embeddingProvider = config.getOptionalString('codeinsight.embeddings.provider');
const embeddingApiKey   = config.getOptionalString('codeinsight.embeddings.apiKey');
const embeddingConfig: EmbeddingConfig | undefined =
  embeddingProvider && embeddingApiKey
    ? {
        provider: embeddingProvider as EmbeddingConfig['provider'],
        apiKey:   embeddingApiKey,
        model:    config.getOptionalString('codeinsight.embeddings.model') ?? undefined,
        dimensions: config.getOptionalNumber('codeinsight.embeddings.dimensions') ?? undefined,
      }
    : undefined;

const compositionConfig: CompositionConfig = {
  repoClone: {
    tempDir,
    cloneTtlHours: config.getOptionalNumber('codeinsight.cloneTtlHours') ?? 24,
    defaultDepth: 1, deltaDepth: 50,
    authToken: config.getOptionalString('codeinsight.githubToken') ?? undefined,
  },
  ingestion: {
    tempDir,
    deltaThreshold:        config.getOptionalNumber('codeinsight.ingestion.deltaThreshold') ?? 0.4,
    maxConcurrentJobs:     config.getOptionalNumber('codeinsight.ingestion.maxConcurrentJobs') ?? 2,
    jobTimeoutMinutes:     config.getOptionalNumber('codeinsight.ingestion.jobTimeoutMinutes') ?? 30,
    cloneDepth:            config.getOptionalNumber('codeinsight.ingestion.cloneDepth') ?? 1,
    deltaCloneDepth:       config.getOptionalNumber('codeinsight.ingestion.deltaCloneDepth') ?? 50,
    cleanupAfterIngestion: config.getOptionalBoolean('codeinsight.ingestion.cleanupAfterIngestion') ?? true,
  },
  llm: llmConfig,
  embedding: embeddingConfig,
  docGen: {
    maxConcurrency:  config.getOptionalNumber('codeinsight.docGen.maxConcurrency') ?? 20,
    maxOutputTokens: config.getOptionalNumber('codeinsight.docGen.maxOutputTokens') ?? 2000,
    temperature:     config.getOptionalNumber('codeinsight.docGen.temperature') ?? 0.2,
  },
  diagramGen: {
    maxConcurrency:  config.getOptionalNumber('codeinsight.diagramGen.maxConcurrency') ?? 10,
    maxOutputTokens: config.getOptionalNumber('codeinsight.diagramGen.maxOutputTokens') ?? 2000,
    temperature:     config.getOptionalNumber('codeinsight.diagramGen.temperature') ?? 0.2,
  },
  indexing: { modelTokenLimit: 8192, charsPerToken: 3 },
  qna: {
    maxHistoryTurns:    config.getOptionalNumber('codeinsight.qna.maxHistoryTurns') ?? 6,
    compressAfterTurns: config.getOptionalNumber('codeinsight.qna.compressAfterTurns') ?? 10,
    maxContextTokens:   config.getOptionalNumber('codeinsight.qna.maxContextTokens') ?? 8000,
    maxAnswerTokens:    config.getOptionalNumber('codeinsight.qna.maxAnswerTokens') ?? 2000,
    temperature:        config.getOptionalNumber('codeinsight.qna.temperature') ?? 0.3,
  },
};

// 4) Sync pgvector dimension (plugin-only side-effect)
if (embeddingConfig) {
  await ensureEmbeddingDimension(knex, coreLogger, embeddingConfig);
}

// 5) Build the stack
const stack = createIngestionStack({ knex, logger: coreLogger, config: compositionConfig });

// 6) Usage dashboard cost map — same as before
const usageCostConfig = config.getOptionalConfig('codeinsight.usage.costPerMillionTokens');
const costMap: Record<string, number> = { default: 3.0 };
if (usageCostConfig) {
  for (const key of usageCostConfig.keys()) costMap[key] = usageCostConfig.getNumber(key);
}

// 7) Mount router — unchanged
const router = await createRouter({
  config, logger, database,
  storageAdapter: stack.storageAdapter,
  jobQueue:       stack.jobQueue,
  qnaService:     stack.qnaService,
  costMap,
});
httpRouter.use(router);
httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });

logger.info('CodeInsight backend plugin initialized');
```

- [ ] **Step 3: Run existing plugin-backend tests**

Run: `pnpm --filter @codeinsight/plugin-backend test`
Expected: all existing router tests pass (router signature unchanged).

- [ ] **Step 4: Build the plugin-backend package**

Run: `pnpm --filter @codeinsight/plugin-backend build`
Expected: success.

- [ ] **Step 5: Smoke-test dev app boot**

Run: `pnpm --filter @codeinsight/dev-app dev` in background for 20s, then kill.
Expected: logs show "CodeInsight backend plugin initialized" without errors. If plugin.ts's logger adaptation is wrong, errors will appear here.

- [ ] **Step 6: Commit**

```bash
git add packages/backstage/plugin-backend
git commit -m "refactor(plugin-backend): use @codeinsight/composition factory for composition root"
```

---

### Task 4: Build `v1Adapter.ts` in eval package

**Files:**
- Modify: `packages/core/eval/package.json` — add `@codeinsight/composition`, `js-yaml`, `@types/js-yaml`, `knex`, `pg` deps
- Modify: `packages/core/eval/tsconfig.json` — add reference `{ "path": "../../composition" }`
- Create: `packages/core/eval/src/adapters/loadConfig.ts`
- Create: `packages/core/eval/src/adapters/costWrappers.ts`
- Create: `packages/core/eval/src/adapters/v1Adapter.ts`
- Create: `packages/core/eval/src/__tests__/costWrappers.test.ts`
- Create: `packages/core/eval/src/__tests__/v1Adapter.test.ts`
- Modify: `packages/core/eval/src/index.ts` — export `V1Adapter` and `loadConfig`

- [ ] **Step 1: Add deps + tsconfig reference**

Edit `packages/core/eval/package.json`:
```json
  "dependencies": {
    ...existing...,
    "@codeinsight/composition": "workspace:*",
    "knex": "^3.1.0",
    "pg": "^8.11.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    ...existing...,
    "@types/js-yaml": "^4.0.9"
  }
```

Edit `packages/core/eval/tsconfig.json` references array:
```json
    { "path": "../../composition" }
```

Run: `pnpm install`

- [ ] **Step 2: Write `loadConfig.ts` test** (failing)

```ts
// packages/core/eval/src/__tests__/loadConfig.test.ts
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadEvalConfig } from '../adapters/loadConfig';

describe('loadEvalConfig', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'loadcfg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('parses a minimal eval.config.yaml into composition + db', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(yamlPath, `
db:
  host: localhost
  port: 5433
  user: codeinsight
  password: codeinsight
  database: backstage_plugin_codeinsight
llm:
  provider: anthropic
  apiKey: sk-ant-test
  model: claude-opus-4-7
embeddings:
  provider: openai
  apiKey: sk-openai-test
  model: text-embedding-3-small
cloneTempDir: /tmp/eval
`);
    const { composition, db } = loadEvalConfig(yamlPath);
    expect(db.host).toBe('localhost');
    expect(db.port).toBe(5433);
    expect(composition.repoClone.tempDir).toBe('/tmp/eval');
    expect(composition.llm?.provider).toBe('anthropic');
    expect(composition.embedding?.model).toBe('text-embedding-3-small');
    expect(composition.qna.maxHistoryTurns).toBe(6); // default
  });

  it('throws a clear error when db block is missing', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(yamlPath, 'llm: { provider: anthropic, apiKey: x, model: y }');
    expect(() => loadEvalConfig(yamlPath)).toThrow(/db/);
  });

  it('throws a clear error when the file is not valid YAML', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(yamlPath, ':\n  - not: valid: yaml: here');
    expect(() => loadEvalConfig(yamlPath)).toThrow();
  });
});
```

- [ ] **Step 3: Write `loadConfig.ts`**

```ts
// packages/core/eval/src/adapters/loadConfig.ts
import { readFileSync } from 'fs';

import type { CompositionConfig } from '@codeinsight/composition';
import yaml from 'js-yaml';

export interface EvalDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface EvalConfig {
  composition: CompositionConfig;
  db: EvalDbConfig;
}

interface RawEval {
  db?: Partial<EvalDbConfig>;
  cloneTempDir?: string;
  cloneTtlHours?: number;
  githubToken?: string;
  llm?: { provider?: string; apiKey?: string; model?: string };
  embeddings?: { provider?: string; apiKey?: string; model?: string; dimensions?: number };
  ingestion?: Partial<CompositionConfig['ingestion']>;
  docGen?: Partial<CompositionConfig['docGen']>;
  diagramGen?: Partial<CompositionConfig['diagramGen']>;
  qna?: Partial<CompositionConfig['qna']>;
}

export function loadEvalConfig(yamlPath: string): EvalConfig {
  const raw = yaml.load(readFileSync(yamlPath, 'utf8')) as RawEval | null;
  if (!raw) {
    throw new Error(`Empty eval config file: ${yamlPath}`);
  }
  if (!raw.db || !raw.db.host || !raw.db.database) {
    throw new Error(`Missing "db" block (host + database required) in ${yamlPath}`);
  }

  const db: EvalDbConfig = {
    host:     raw.db.host,
    port:     raw.db.port     ?? 5432,
    user:     raw.db.user     ?? 'postgres',
    password: raw.db.password ?? '',
    database: raw.db.database,
  };

  const tempDir = raw.cloneTempDir ?? '/tmp/codeinsight-eval';
  const composition: CompositionConfig = {
    repoClone: {
      tempDir,
      cloneTtlHours: raw.cloneTtlHours ?? 24,
      defaultDepth: 1, deltaDepth: 50,
      authToken: raw.githubToken,
    },
    ingestion: {
      tempDir,
      deltaThreshold:        raw.ingestion?.deltaThreshold        ?? 0.4,
      maxConcurrentJobs:     raw.ingestion?.maxConcurrentJobs     ?? 2,
      jobTimeoutMinutes:     raw.ingestion?.jobTimeoutMinutes     ?? 30,
      cloneDepth:            raw.ingestion?.cloneDepth            ?? 1,
      deltaCloneDepth:       raw.ingestion?.deltaCloneDepth       ?? 50,
      cleanupAfterIngestion: raw.ingestion?.cleanupAfterIngestion ?? true,
    },
    llm: raw.llm?.provider && raw.llm.apiKey && raw.llm.model
      ? { provider: raw.llm.provider as never, apiKey: raw.llm.apiKey, model: raw.llm.model }
      : undefined,
    embedding: raw.embeddings?.provider && raw.embeddings.apiKey
      ? { provider: raw.embeddings.provider as never, apiKey: raw.embeddings.apiKey, model: raw.embeddings.model, dimensions: raw.embeddings.dimensions }
      : undefined,
    docGen:     { maxConcurrency: 20, maxOutputTokens: 2000, temperature: 0.2, ...raw.docGen },
    diagramGen: { maxConcurrency: 10, maxOutputTokens: 2000, temperature: 0.2, ...raw.diagramGen },
    indexing:   { modelTokenLimit: 8192, charsPerToken: 3 },
    qna: {
      maxHistoryTurns:    6,
      compressAfterTurns: 10,
      maxContextTokens:   8000,
      maxAnswerTokens:    2000,
      temperature:        0.3,
      ...raw.qna,
    },
  };

  return { composition, db };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=loadConfig`
Expected: 2 tests pass.

- [ ] **Step 5: Write `costWrappers.ts` test** (failing)

```ts
// packages/core/eval/src/__tests__/costWrappers.test.ts
import { withLlmCostTracking, withEmbeddingCostTracking } from '../adapters/costWrappers';
import { CostTracker } from '../costTracker';
import type { LLMClient, EmbeddingClient } from '@codeinsight/types';

describe('withLlmCostTracking', () => {
  it('records tokens reported by complete()', async () => {
    const tracker = new CostTracker();
    const inner: LLMClient = {
      complete: jest.fn().mockResolvedValue('hi'),
      completeWithUsage: jest.fn().mockResolvedValue({
        text: 'hi', inputTokens: 100, outputTokens: 20, modelUsed: 'claude-opus-4-7',
      }),
      stream: jest.fn(),
    } as unknown as LLMClient;

    const wrapped = withLlmCostTracking(inner, tracker);
    await wrapped.completeWithUsage({ messages: [], model: 'claude-opus-4-7' } as never);

    const s = tracker.summary();
    expect(s.chatRequests).toBe(1);
    expect(s.chatInputTokens).toBe(100);
    expect(s.chatOutputTokens).toBe(20);
  });
});

describe('withEmbeddingCostTracking', () => {
  it('records tokens reported by embed()', async () => {
    const tracker = new CostTracker();
    const inner: EmbeddingClient = {
      embed: jest.fn().mockResolvedValue({
        embeddings: [[0.1]], model: 'text-embedding-3-small', inputTokens: 50,
      }),
    } as unknown as EmbeddingClient;

    const wrapped = withEmbeddingCostTracking(inner, tracker);
    await wrapped.embed({ texts: ['hello'] });

    const s = tracker.summary();
    expect(s.embeddingRequests).toBe(1);
    expect(s.embeddingInputTokens).toBe(50);
  });
});
```

> **Note:** Before writing the wrapper, **read `packages/adapters/llm/src/LLMClient.ts` and `packages/adapters/embeddings/src/EmbeddingClient.ts` to get the actual method signatures** (`complete` vs `completeWithUsage`, whether `embed` returns `inputTokens` directly). Adjust the wrappers and this test if the shapes differ — don't copy the above verbatim.

- [ ] **Step 6: Write `costWrappers.ts`**

```ts
// packages/core/eval/src/adapters/costWrappers.ts
import type { EmbeddingClient, LLMClient } from '@codeinsight/types';

import type { CostTracker } from '../costTracker';

/**
 * Wrap an LLMClient so every completion run through it reports input+output tokens
 * to the CostTracker. Uses the completeWithUsage method; falls back to estimating 0
 * if the underlying client lacks token reporting.
 */
export function withLlmCostTracking(inner: LLMClient, tracker: CostTracker): LLMClient {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'completeWithUsage') {
        return async (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (target as any).completeWithUsage(...args);
          tracker.recordChat(result.modelUsed, result.inputTokens ?? 0, result.outputTokens ?? 0);
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function withEmbeddingCostTracking(inner: EmbeddingClient, tracker: CostTracker): EmbeddingClient {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'embed') {
        return async (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (target as any).embed(...args);
          tracker.recordEmbedding(result.model, result.inputTokens ?? 0);
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
```

- [ ] **Step 7: Run test — expect pass**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=costWrappers`
Expected: 2 tests pass.

- [ ] **Step 8: Write `v1Adapter.ts` test** (failing)

```ts
// packages/core/eval/src/__tests__/v1Adapter.test.ts
import type { Artifact, VectorChunk } from '@codeinsight/types';

import { V1Adapter } from '../adapters/v1Adapter';
import type { IngestionStack } from '@codeinsight/composition';

function mockStack(): IngestionStack {
  return {
    storageAdapter: {
      getArtifactsByRepo: jest.fn().mockResolvedValue([]),
      upsertRepo: jest.fn().mockResolvedValue({ id: 'repo-1', slug: 'test' }),
      getRepoBySlug: jest.fn().mockResolvedValue({ id: 'repo-1', slug: 'test' }),
      deleteRepoByIdCascade: jest.fn().mockResolvedValue(undefined),
    } as never,
    jobQueue: {
      enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJobStatus: jest.fn(),
    } as never,
    qnaService: { ask: jest.fn().mockResolvedValue({ answer: 'x', sources: [] }) } as never,
    ingestionService: { runPipeline: jest.fn().mockResolvedValue(undefined) } as never,
    llmClient: {} as never,
    embeddingClient: {} as never,
    vectorStore: {} as never,
    docGenerationService: undefined,
    diagramGenerationService: {} as never,
    indexingService: {} as never,
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('V1Adapter', () => {
  it('version is "v1"', () => {
    const a = new V1Adapter(mockStack(), { knex: {} as never, costTracker: {} as never });
    expect(a.version).toBe('v1');
  });

  it('ingest() deletes prior repo rows then runs pipeline', async () => {
    const stack = mockStack();
    const a = new V1Adapter(stack, { knex: {} as never, costTracker: {} as never });
    await a.ingest({ slug: 'test', gitUrl: 'https://x', commitSha: 'sha', description: '', sizeCategory: 'small', fileCountApprox: 10 }, '/tmp/clone');
    expect(stack.storageAdapter.deleteRepoByIdCascade).toHaveBeenCalled();
    expect(stack.ingestionService.runPipeline).toHaveBeenCalled();
  });

  it('getDocArtifacts filters to artifactType=doc', async () => {
    const stack = mockStack();
    (stack.storageAdapter.getArtifactsByRepo as jest.Mock).mockResolvedValue([
      { artifactType: 'doc', artifactId: 'overview' },
      { artifactType: 'diagram', artifactId: 'x' },
    ]);
    const a = new V1Adapter(stack, { knex: {} as never, costTracker: {} as never });
    const result = await a.getDocArtifacts('test');
    expect(result).toHaveLength(1);
    expect(result[0].artifactType).toBe('doc');
  });
});
```

- [ ] **Step 9: Write `v1Adapter.ts`**

```ts
// packages/core/eval/src/adapters/v1Adapter.ts
import type { IngestionStack } from '@codeinsight/composition';
import type { Artifact, VectorChunk } from '@codeinsight/types';
import type { Knex } from 'knex';

import { CostTracker } from '../costTracker';
import type { PipelineAdapter, RepoFixtureMeta } from '../types';

export interface V1AdapterOpts {
  knex: Knex;
  costTracker: CostTracker;
}

export class V1Adapter implements PipelineAdapter {
  readonly version = 'v1';

  constructor(private readonly stack: IngestionStack, private readonly opts: V1AdapterOpts) {}

  async ingest(meta: RepoFixtureMeta, cloneDir: string): Promise<void> {
    const existing = await this.stack.storageAdapter.getRepoBySlug(meta.slug);
    if (existing) {
      await this.stack.storageAdapter.deleteRepoByIdCascade(existing.id);
    }
    const repo = await this.stack.storageAdapter.upsertRepo({
      slug:   meta.slug,
      gitUrl: meta.gitUrl,
      description: meta.description,
    });
    // Bypass the job queue — drive ingestion synchronously for eval.
    await this.stack.ingestionService.runPipeline({
      repoId: repo.id,
      commitSha: meta.commitSha,
      cloneDir,
      isFullIngest: true,
    });
  }

  async getDocArtifacts(repoSlug: string): Promise<Artifact[]> {
    const repo = await this.stack.storageAdapter.getRepoBySlug(repoSlug);
    if (!repo) return [];
    const all = await this.stack.storageAdapter.getArtifactsByRepo(repo.id);
    return all.filter(a => a.artifactType === 'doc');
  }

  async getDiagramArtifacts(repoSlug: string): Promise<Artifact[]> {
    const repo = await this.stack.storageAdapter.getRepoBySlug(repoSlug);
    if (!repo) return [];
    const all = await this.stack.storageAdapter.getArtifactsByRepo(repo.id);
    return all.filter(a => a.artifactType === 'diagram');
  }

  async askQna(
    repoSlug: string,
    question: string,
  ): Promise<{ answer: string; retrievedChunks: VectorChunk[] }> {
    if (!this.stack.qnaService) {
      throw new Error('QnA service not configured (missing LLM or embedding config)');
    }
    const repo = await this.stack.storageAdapter.getRepoBySlug(repoSlug);
    if (!repo) throw new Error(`Repo "${repoSlug}" not ingested`);

    const result = await this.stack.qnaService.ask({
      repoId: repo.id,
      question,
      sessionId: `eval-${Date.now()}`,
    });
    // QnA's `sources` already contains the VectorChunk shapes retrieval returned.
    return { answer: result.answer, retrievedChunks: result.sources as VectorChunk[] };
  }

  cost() {
    return this.opts.costTracker.summary();
  }
}
```

> **Note:** Before merging Task 4, **read these files to verify shapes**: `packages/adapters/storage/src/KnexStorageAdapter.ts` (confirm `deleteRepoByIdCascade`, `upsertRepo`, `getRepoBySlug`, `getArtifactsByRepo` exist with these signatures — rename calls if different), `packages/core/ingestion/src/IngestionService.ts` (confirm `runPipeline` signature), and `packages/core/qna/src/QnAService.ts` (confirm `ask()` returns `answer` + `sources`). Adjust the adapter calls to match actual method names.

- [ ] **Step 10: Run full eval test suite**

Run: `pnpm --filter @codeinsight/eval test`
Expected: all existing + new tests pass.

- [ ] **Step 11: Lint + build**

Run: `pnpm --filter @codeinsight/eval lint && pnpm --filter @codeinsight/eval build`
Expected: clean.

- [ ] **Step 12: Export v1Adapter from index**

Edit `packages/core/eval/src/index.ts` — add:
```ts
export { V1Adapter } from './adapters/v1Adapter';
export { loadEvalConfig } from './adapters/loadConfig';
export type { EvalConfig, EvalDbConfig } from './adapters/loadConfig';
export { withLlmCostTracking, withEmbeddingCostTracking } from './adapters/costWrappers';
```

- [ ] **Step 13: Commit**

```bash
git add packages/core/eval
git commit -m "feat(eval): add V1Adapter — drives v1 pipeline via @codeinsight/composition with cost tracking"
```

---

### Task 5: Wire CLI `--config` flag + baseline npm script

**Files:**
- Modify: `packages/core/eval/src/cli.ts` — add `--config <path>` option; detect `v1` adapter and auto-wire
- Create: `eval/eval.config.example.yaml` — template committed with placeholder values
- Modify: `.gitignore` — add `eval/eval.config.local.yaml`
- Modify: `package.json` (root) — update `eval:baseline` script

- [ ] **Step 1: Update CLI**

Add to both `run` and `baseline` subcommands:

```ts
.option('--config <path>', 'path to eval.config.local.yaml', './eval/eval.config.local.yaml')
```

Change the `--adapter` option's default from the v1 dist path to the literal string `'v1'`. When the resolved adapter is `'v1'`, skip the dynamic-require path and construct V1Adapter directly:

```ts
import knex from 'knex';

import { createIngestionStack } from '@codeinsight/composition';

import { loadEvalConfig } from './adapters/loadConfig';
import { V1Adapter } from './adapters/v1Adapter';
import { withLlmCostTracking, withEmbeddingCostTracking } from './adapters/costWrappers';
import { CostTracker } from './costTracker';

async function createV1Adapter(configPath: string): Promise<V1Adapter> {
  const { composition, db } = loadEvalConfig(configPath);
  const dbClient = knex({
    client: 'pg',
    connection: {
      host: db.host, port: db.port,
      user: db.user, password: db.password, database: db.database,
    },
  });

  const costTracker = new CostTracker();
  const stack = createIngestionStack({
    knex: dbClient,
    logger: {
      debug: () => {},
      info:  (msg, meta) => console.log(msg, meta ?? ''),
      warn:  (msg, meta) => console.warn(msg, meta ?? ''),
      error: (msg, meta) => console.error(msg, meta ?? ''),
    },
    config: composition,
    wrapLlm:       c => withLlmCostTracking(c, costTracker),
    wrapEmbedding: c => withEmbeddingCostTracking(c, costTracker),
  });

  return new V1Adapter(stack, { knex: dbClient, costTracker });
}
```

- [ ] **Step 2: Wire adapter resolution**

Existing flow: CLI takes `--adapter <path>`, dynamically imports the file, calls its default export factory.

New flow:
- If `--adapter === 'v1'` (the new default), call `createV1Adapter(configPath)`.
- Otherwise, preserve existing dynamic-require flow for future adapters (e.g. v2).

- [ ] **Step 3: Create `eval/eval.config.example.yaml`**

```yaml
# eval/eval.config.example.yaml
# Copy to eval/eval.config.local.yaml and fill in real values.
db:
  host: localhost
  port: 5433
  user: codeinsight
  password: codeinsight
  database: backstage_plugin_codeinsight

llm:
  provider: anthropic
  apiKey: REPLACE_ME
  model: claude-opus-4-7

embeddings:
  provider: openai
  apiKey: REPLACE_ME
  model: text-embedding-3-small

cloneTempDir: /tmp/codeinsight-eval
# githubToken: ghp_xxx  # optional, for cloning private repos
```

- [ ] **Step 4: Update `.gitignore`**

Add:
```
eval/eval.config.local.yaml
```

- [ ] **Step 5: Update root `package.json`**

Change `eval:baseline` to:
```json
"eval:baseline": "pnpm eval:build && node ./packages/core/eval/dist/cli.js baseline --adapter v1 --config ./eval/eval.config.local.yaml --out eval/reports/$(date +%Y-%m-%d)-v1-baseline.json"
```

(POSIX `$(date +%Y-%m-%d)` — macOS/Linux only.)

- [ ] **Step 6: Smoke test CLI help**

Run: `pnpm eval:build && node ./packages/core/eval/dist/cli.js baseline --help`
Expected: help text shows `--config` (default `./eval/eval.config.local.yaml`) and `--adapter` (default `v1`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/eval eval/eval.config.example.yaml .gitignore package.json
git commit -m "feat(eval): wire V1Adapter into CLI with standalone eval.config.yaml"
```

---

### Task 6: Run baseline + commit report

**Files:**
- Create: `eval/reports/2026-04-20-v1-baseline.json` (generated)
- Modify: `eval/reports/README.md` — add baseline entry
- Modify: `docs/build-plan.md` — mark 8.2 done

- [ ] **Step 1: Verify prerequisites**

Verify:
1. `docker-compose up -d` is running (port 5433 postgres).
2. `eval/eval.config.local.yaml` exists and has real API keys + db credentials. User creates this from the committed example template.
3. All 3 fixtures (small-ts, medium-react, complex) are reachable: test-clone `typeorm/typeorm@8ba2d25...` succeeds (this is the slowest).

Ask the user to confirm `eval.config.local.yaml` is populated before proceeding. **Do not read the config file yourself** (hard rule: no secrets).

- [ ] **Step 2: Run baseline**

```bash
pnpm eval:baseline
```

Expected: 3 repos ingested in sequence, scores computed, report written to `eval/reports/2026-04-20-v1-baseline.json`. Total time likely 15–40 min (typeorm is slow). Watch for:
- OOM during typeorm's 500-file ingestion — if so, reduce `ingestion.maxConcurrentJobs` in app-config.
- Rate-limit errors — baseline must use the same cache as prod so re-runs are cheap.

- [ ] **Step 3: Inspect report**

Open `eval/reports/2026-04-20-v1-baseline.json`. Sanity-check:
- All 3 repos have non-null `doc`, `diagram`, `qna`, `cost` blocks.
- No score is exactly `NaN` or `null`.
- `cost.totalUsd` is plausible (expect $1–15 across 3 repos on first run, much less on re-runs thanks to cache).

- [ ] **Step 4: Update `eval/reports/README.md`**

Add a row describing the baseline file: pipelineVersion, date, each repo's doc/diagram/qna overall scores, total cost.

- [ ] **Step 5: Mark 8.2 complete in `docs/build-plan.md`**

Change:
```md
### 8.2 Baseline Measurement (Phase 2 of v2) — PENDING
```
to:
```md
### 8.2 Baseline Measurement (Phase 2 of v2) — ✅ COMPLETED

- `@codeinsight/composition` package extracted (shared factory between plugin.ts and v1Adapter)
- `V1Adapter` implements `PipelineAdapter` against the v1 pipeline
- `eval/reports/2026-04-20-v1-baseline.json` committed — 3 repos, doc/diagram/qna scores captured
```

- [ ] **Step 6: Commit**

```bash
git add eval/reports/2026-04-20-v1-baseline.json eval/reports/README.md docs/build-plan.md
git commit -m "chore(eval): commit v1 baseline report (2026-04-20)"
```

---

## Self-Review Check (run at the end of execution)

- [ ] All Task N tests pass: `pnpm --filter @codeinsight/composition test && pnpm --filter @codeinsight/eval test` → all green.
- [ ] Dev app boots: `pnpm --filter @codeinsight/dev-app dev` logs "CodeInsight backend plugin initialized" without errors.
- [ ] `pnpm eval:baseline` produces a non-empty JSON report for 3 repos.
- [ ] `eval/reports/2026-04-20-v1-baseline.json` is committed and non-empty.
- [ ] `docs/build-plan.md` has 8.2 marked ✅.
- [ ] Zero `@backstage/*` imports in `@codeinsight/composition` or `@codeinsight/eval`.
- [ ] Zero `process.env` reads in `@codeinsight/composition` or `@codeinsight/eval`.
- [ ] Root `package.json` `eval:baseline` script works.

---

## What Phase 3 (next plan) will add

- `FileIntelService` + `ci_file_intel` migration
- `RepoCognitionMap` service + `ci_repo_cognition` migration
- `StorageAdapter` methods for both
- Feature flag: `codeinsight.features.v2Pipeline`
- When true, pipeline runs FileIntel + RCM before old doc/diagram modules but continues to run old modules
- Gate: RCM produced on all 3 gold repos, validated, cached correctly on delta

# CodeInsight — Phase-by-Phase Build Plan

> Small, logical steps. Each phase produces something working and demonstrable.
> Dependencies are explicit — don't start a phase until its blockers are done.

---

## Phase 1: Foundation
**Goal:** A Backstage plugin scaffold that can clone a repo, build a CIG, and store it. Frontend can trigger ingestion and see status. No LLM. Just the plumbing working end-to-end.

**Why first:** Everything else depends on this. No docs, diagrams, or QnA without a working CIG and job pipeline.

**Estimated effort:** ~63 hours (3-4 weeks solo, 2-2.5 weeks with two developers)

---

### 1.0 — Monorepo Scaffold ✅ COMPLETED
**Dependencies:** None. This is the absolute first step.

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.0.1 | ✅ | Create root `package.json` (`"private": true`, workspace defs), `pnpm-workspace.yaml` (`packages: ['packages/core/*', 'packages/adapters/*', 'packages/backstage/*']`), root `tsconfig.json` (project references, strict mode), `.npmrc` (`shamefully-hoist=true` for Backstage deps) | 1h |
| 1.0.2 | ✅ | Set up shared ESLint config (TypeScript, import sorting, no-console) and Prettier config. Add root lint scripts | 1h |
| 1.0.3 | ✅ | Set up Jest with shared config at monorepo root. Add root test scripts. Verify a trivial test passes | 1h |
| 1.0.4 | ✅ | Add appropriate `.gitignore` exclusions for build artifacts (`dist/`, `*.tsbuildinfo`, `node_modules/`). Commit all tracked files | 0.5h |

**Acceptance:** ✅ `pnpm install` succeeds. `pnpm lint` and `pnpm test` run. Build artifacts are gitignored.

**Notes:**
- Jest config uses `.js` (not `.ts`) to avoid `ts-node` dependency
- Added `@types/jest` and `@types/node` as root devDependencies
- Trivial test at `packages/core/setup.test.ts`

---

### 1.1 — Shared Types Package ✅ COMPLETED
**Dependencies:** 1.0

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.1.1 | ✅ | Create `packages/core/types/` package scaffold: `package.json` (`@codeinsight/types`), `tsconfig.json`, `src/index.ts` | 0.5h |
| 1.1.2 | ✅ | Define core data types: `Repository`, `RepoFile`, `CIGNode`, `CIGEdge`, `Artifact`, `ArtifactInput`, `ArtifactDependency`, `IngestionJob`, `JobStatus`, `JobTrigger` | 1.5h |
| 1.1.3 | ✅ | Define all I/O interfaces: `LLMClient`, `EmbeddingClient`, `VectorStore`, `RepoConnector`, `StorageAdapter` (full Phase 1 method set), `JobQueue`, `Logger` — canonical definitions from `llm-context.md` | 1.5h |
| 1.1.4 | ✅ | Define config types: `DatabaseConfig`, `RepoCloneConfig`, `LLMConfig`, `EmbeddingConfig`, `IngestionConfig` | 0.5h |

**Acceptance:** ✅ Package builds. All types exported from `@codeinsight/types`. Zero runtime code, zero external dependencies.

**Notes:**
- Types organized as `src/data.ts` (data types), `src/interfaces.ts` (I/O interfaces), `src/config.ts` (config types)
- All union types use string literals (not enums) for serialization simplicity
- `Job` type added for `JobQueue.enqueue()` param
- `CodeInsightConfig` top-level config type aggregates all sub-configs

---

### 1.2 — Backstage Plugin Scaffold ✅ COMPLETED
**Dependencies:** 1.0 (can run in parallel with 1.1)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.2.1 | ✅ | Create `packages/backstage/plugin-backend/` with `createBackendPlugin` boilerplate: `src/plugin.ts`, `src/index.ts`, `package.json` (`@codeinsight/plugin-backend`). Register with `coreServices` (database, config, logger, httpRouter) | 1.5h |
| 1.2.2 | ✅ | Create `packages/backstage/plugin/` with `createPlugin`, `createApiRef`, placeholder `EntityCodeInsightContent` component ("CodeInsight — coming soon"). Export a routable extension | 1.5h |
| 1.2.3 | ✅ | Define `config.d.ts` schema for the `codeinsight` config namespace. Start minimal: clone temp dir, clone TTL, feature flags (docs, diagrams, qna enabled) | 0.5h |
| 1.2.4 | ✅ | Set up a local Backstage dev app (`dev/`) that registers both plugins. Verify frontend plugin renders the placeholder tab on a component entity page. Verify backend plugin starts without errors | 1h |

**Acceptance:** ✅ All criteria met. Backend starts with CodeInsight plugin initialized, health endpoint at `/api/codeinsight/health` returns OK. Frontend renders CodeInsight tab on entity page showing placeholder content with entity name. Catalog loads sample-service entity.

**Notes:**
- Backend: `src/plugin.ts` (createBackendPlugin), `src/router.ts` (express Router), `src/index.ts` (default export)
- Frontend: `src/plugin.ts` (createPlugin + routable extension), `src/api.ts` (CodeInsightApi interface + apiRef), `src/api-client.ts` (CodeInsightClient using discoveryApi + fetchApi), `src/routes.ts`, `src/components/EntityCodeInsightContent.tsx`
- `config.d.ts` covers: cloneTempDir, cloneTtlHours, features (docs/diagrams/qna), llm (provider/apiKey/model), embeddings, githubToken, ingestion settings
- Dev app: `dev/backend/` (createBackend + all core Backstage plugins + codeinsight), `dev/app/` (createApp + catalog + EntityLayout with CodeInsight tab)
- `dev/backend/app-config.yaml` — SQLite in-memory, guest auth, `dangerouslyDisableDefaultAuthPolicy`, local catalog file
- `dev/catalog-info.yaml` — sample-service Component entity
- Run: `pnpm dev:backend` (port 7007), `pnpm dev:app` (port 3000)
- `EntityLayout` is in `@backstage/plugin-catalog` (not `plugin-catalog-react`)
- Frontend app package must be named `app` (not custom name) for `plugin-app-backend` to resolve it

---

### 1.3 — Database Migrations ✅ COMPLETED
**Dependencies:** 1.1 (needs type definitions for column design)

All DDL with PKs, FKs, and indexes is in `llm-context.md` — use that as the implementation reference. No `tenant_id` on any table.

| Task | Description | Est. |
|------|-------------|------|
| 1.3.1 | Create `packages/adapters/storage/` package scaffold. Set up Knex migration infrastructure: `knexfile.ts`, `migrations/` directory, `package.json` (`@codeinsight/storage`) | 1h |
| 1.3.2 | Migration 001: `ci_repositories` — `repo_id` (PK), `name`, `url`, `provider`, `status`, `last_commit_sha`, `created_at`, `updated_at` | 0.5h |
| 1.3.3 | Migration 002: `ci_repo_files` — `repo_id`, `file_path`, `current_sha`, `last_processed_sha`, `file_type`, `language`, `parse_status`. PK: `(repo_id, file_path)`. FK to `ci_repositories`. Index on `repo_id` | 0.5h |
| 1.3.4 | Migration 003: `ci_cig_nodes` — `node_id` (UUID PK), `repo_id`, `file_path`, `symbol_name`, `symbol_type`, `start_line`, `end_line`, `exported`, `extracted_sha`, `metadata JSONB`. Unique: `(repo_id, file_path, symbol_name, symbol_type)`. Index on `(repo_id, file_path)` | 0.5h |
| 1.3.5 | Migration 004: `ci_cig_edges` — `edge_id` (UUID PK), `repo_id`, `from_node_id`, `to_node_id`, `edge_type`. FKs to `ci_cig_nodes`. Indexes on `from_node_id` and `to_node_id` | 0.5h |
| 1.3.6 | Migration 005: `ci_artifacts`, `ci_artifact_inputs`, `ci_artifact_dependencies`. PKs: `(repo_id, artifact_id)`, `(repo_id, artifact_id, file_path)`, `(repo_id, dependent_id, dependency_id)`. Partial index on `is_stale = true` | 1h |
| 1.3.7 | Migration 006: `ci_ingestion_jobs` — `job_id` (UUID PK), `repo_id`, `trigger`, `status`, `from_commit`, `to_commit`, `changed_files TEXT[]`, `files_processed`, `files_skipped`, `tokens_consumed`, `error_message`, timestamps. FK to `ci_repositories`. Index on `(repo_id, status)` | 0.5h |
| 1.3.8 | Migration 007: `ci_llm_cache` (PK: `cache_key`) and `ci_embedding_cache` (PK: `content_sha`). Wrap pgvector extension creation in try-catch (optional until Phase 4). QnA tables deferred to Phase 4 | 1h |
| 1.3.9 | Verify: run all migrations against local Postgres. Confirm all tables, PKs, indexes. Run rollback and re-apply to verify reversibility | 0.5h |

**Acceptance:** ✅ All tables exist with correct schema. Migrations are idempotent. Rollback works cleanly. No `tenant_id` on any table.

**Notes:**
- Package: `packages/adapters/storage/` (`@codeinsight/storage`)
- Knex migrations in `migrations/` — 7 migration files (001–007)
- Migration runner: `NODE_OPTIONS='--require ts-node/register' knex --knexfile knexfile.ts migrate:latest`
- Docker Compose at repo root: `pgvector/pgvector:pg16` on port **5433** (avoids conflict with local Postgres on 5432)
- pgvector extension enabled (v0.8.2) — migration 007 wraps extension creation in try-catch for safety
- All 7 custom indexes created and verified
- Root scripts: `pnpm db:up`, `pnpm db:down`, `pnpm db:reset`, `pnpm db:migrate`, `pnpm db:rollback`
- Docker credentials: user=`codeinsight`, password=`codeinsight`, db=`codeinsight`, port=`5433`

---

### 1.4 — Storage Adapter (Phase 1 Methods) ✅ COMPLETED
**Dependencies:** 1.3 (tables must exist), 1.1 (types)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.4.1 | ✅ | Implement `KnexStorageAdapter` class structure: constructor takes `Knex` instance | 1h |
| 1.4.2 | ✅ | Implement repository methods: `getRepo`, `upsertRepo`, `updateRepoStatus` | 1h |
| 1.4.3 | ✅ | Implement file tracking methods: `upsertRepoFiles` (batch upsert), `getRepoFiles`, `getChangedRepoFiles` (where `current_sha != last_processed_sha`) | 1h |
| 1.4.4 | ✅ | Implement CIG methods: `upsertCIGNodes` (batch), `upsertCIGEdges` (batch), `deleteCIGForFiles` (delete all nodes/edges for given file paths), `getCIGNodes`, `getCIGEdges` | 1.5h |
| 1.4.5 | ✅ | Implement job methods: `createJob`, `updateJob`, `getJob`, `getActiveJobForRepo` (find running job for dedup) | 1h |
| 1.4.6 | ✅ | Write integration tests for all storage adapter methods against a test PostgreSQL database. Use transactions for test isolation (begin transaction before each test, rollback after). Test batch operations with 500+ records | 2h |

**Acceptance:** ✅ All CRUD operations work correctly. 31 integration tests pass. Batch operations handle 600 records without error.

**Notes:**
- `KnexStorageAdapter` in `packages/adapters/storage/src/KnexStorageAdapter.ts`
- Snake_case DB rows ↔ camelCase domain types via explicit mapper functions (no ORM magic)
- Batch operations chunk at 500 records per INSERT for safe Postgres param limits
- Upserts use `onConflict().merge()` with `EXCLUDED.*` references for atomic insert-or-update
- `getChangedRepoFiles` handles both `current_sha != last_processed_sha` AND `last_processed_sha IS NULL` (new files)
- `deleteCIGForFiles` relies on FK CASCADE to auto-delete edges when nodes are removed
- `getActiveJobForRepo` finds most recent `queued` or `running` job (ordered by `created_at DESC`)
- Artifact methods included (Phase 2+) — `upsertArtifact`, `getArtifact`, `getStaleArtifacts`
- Integration tests use transaction rollback isolation — each test begins a transaction, adapter operates within it, rollback after
- Tests run against Docker Postgres on port 5433 (same as migrations)

---

### 1.5 — Repository Connector (GitHub Only) ✅ COMPLETED
**Dependencies:** 1.1 (RepoConnector interface)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.5.1 | ✅ | Create `packages/adapters/repo/` package scaffold (`@codeinsight/repo`). Add `simple-git` as dependency | 0.5h |
| 1.5.2 | ✅ | Implement `clone(url, targetDir, opts)`: shallow clone with configurable depth (`--depth 1` for full runs, `--depth 50` for delta). Support HTTPS URLs with token auth (token injected via config, interpolated into URL) | 1.5h |
| 1.5.3 | ✅ | Implement `getFileTree(dir)`: walk the cloned directory using `git ls-files`, return all files with paths and computed SHA (via `git hash-object` or crypto hash of content). Respect `.gitignore` | 1h |
| 1.5.4 | ✅ | Implement `getHeadSha(dir)` (reads `HEAD` ref) and `getChangedFiles(dir, fromSha, toSha)` (uses `git diff --name-only fromSha toSha`) | 1h |
| 1.5.5 | ✅ | Implement clone directory management: create temp dirs namespaced by `repo_id`, clean up dirs older than configurable TTL (default 24h) | 1h |
| 1.5.6 | ✅ | Write integration tests: clone a small public GitHub repo (pick a stable one with known file count). Verify file tree matches expected count. Verify changed file detection between two known commits. Verify TTL cleanup | 1h |

**Acceptance:** ✅ Can clone a real GitHub repo. File tree is correct. Changed file detection works between two commits. Clone directory cleaned up after TTL. All 10 integration tests pass.

**Notes:**
- `GitRepoConnector` in `packages/adapters/repo/src/GitRepoConnector.ts`
- Uses `simple-git` for all git operations, `crypto.createHash('sha256')` for file content hashing
- `clone()`: shallow clone with `--single-branch`, HTTPS token auth via URL injection (`x-access-token:{token}@`)
- `getFileTree()`: `git ls-files -z` for tracked files, SHA-256 content hash per file. Returns `RepoFile[]` with `repoId=''` (caller sets after retrieval)
- `getHeadSha()`: `git rev-parse HEAD`
- `getChangedFiles()`: `git diff --name-only fromSha toSha`
- `getCloneDir(repoId)`: creates deterministic temp dir under `config.tempDir/{repoId}`
- `cleanupStaleDirs()`: scans tempDir, removes directories with mtime older than `cloneTtlHours`
- URL redaction in logs: tokens replaced with `***`
- Integration tests use `octocat/Hello-World` (GitHub's canonical demo repo)
- Jest `moduleNameMapper` updated to explicitly map all `@codeinsight/*` packages (core + adapters)

---

### 1.6 — File Filter Service ✅ COMPLETED
**Dependencies:** 1.5 (needs RepoFile output to filter), 1.1 (types)

This is the first `core/` package — verify zero external dependencies besides `@codeinsight/types`.

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.6.1 | ✅ | Create file filter module within `packages/core/ingestion/`. Package scaffold: `package.json` (`@codeinsight/ingestion`), `tsconfig.json`, `src/index.ts` | 0.5h |
| 1.6.2 | ✅ | Implement exclusion rules: directory exclusions (`node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `__pycache__/`, `.tox/`, `target/`), file exclusions (lock files, binaries by extension), header-based exclusions (`// generated`, `// DO NOT EDIT` — read first 5 lines only). Make exclusion lists configurable | 1.5h |
| 1.6.3 | ✅ | Implement file classification: `source` (by extension mapping), `config` (known filenames), `schema` (prisma/graphql/migrations), `infra` (Dockerfile, docker-compose, k8s, terraform), `ci` (GitHub Actions, GitLab CI, Jenkinsfile), `test` (by directory pattern or filename pattern). Return `FileType` enum per file | 1h |
| 1.6.4 | ✅ | Write unit tests with fixture file path lists. Cover edge cases: nested `node_modules` (should be excluded at any depth), files with no extension, dotfiles, symlinks, very long paths. Test classification accuracy for 50+ file paths covering all types | 1h |

**Acceptance:** ✅ All 184 unit tests pass. Classification covers 100+ file paths across all 6 FileType categories. Exclusion handles nested dirs, custom config, edge cases.

**Notes:**
- `FileFilter` in `packages/core/ingestion/src/FileFilter.ts` — zero runtime deps besides `path` (Node built-in) + `@codeinsight/types`
- `shouldExclude(filePath)`: checks excluded dirs (at any depth), excluded filenames, excluded extensions, custom regex patterns
- `isHeaderGenerated(headerLines)`: checks first N lines for generated-file markers (case-insensitive)
- `classifyFile(filePath)`: returns `FileType` — ci > test > schema > infra > config > source (priority order)
- `detectLanguage(filePath)`: extension → language string mapping, returns null for unknown
- Configurable via `FileFilterConfig`: `excludeDirs`, `excludeExtensions`, `excludePatterns` (merged with defaults)
- 25 default excluded directories, 50+ excluded extensions, 12 excluded filenames

---

### 1.7 — CIG Builder
**Dependencies:** 1.6 (filtered file list), 1.4 (storage for persistence), 1.1 (types)

Start with TypeScript/JavaScript only — other languages are added incrementally.

| Task | Description | Est. |
|------|-------------|------|
| ✅ 1.7.1 | Create `packages/core/cig/` package (`@codeinsight/cig`). Install `tree-sitter` and `tree-sitter-typescript` (covers both TS and JS). Verify Tree-sitter loads and parses a simple file. **Done** — also added `LanguageExtractor` interface, two-pass `CIGBuilder` dispatcher with tree caching, grammar registry for TS/TSX/JS, 7 passing tests | 1h |
| ✅ 1.7.2 | Implement symbol extraction: parse a TS/JS file, extract functions (named, arrow, exported), classes, interfaces, type aliases, enums. For each: name, type, start line, end line, exported (boolean). Handle nested functions and class methods. **Done** — `TypeScriptExtractor` handles TS/TSX/JS, get/set accessors with distinct nodeIds, deeply nested functions, 35 tests | 2h |
| ✅ 1.7.3 | Implement import/export relationship extraction: parse `import` and `export` statements, resolve relative paths to absolute file paths within the repo. Handle `import * as`, `import { }`, `import default`, `export { }`, `export default`, `export *`, re-exports. **Done** — `extractEdges()` in `TypeScriptExtractor` handles all import/export forms, path resolution with extension/index fallback, `<module>` anchor nodes added by `CIGBuilder`, 16 new edge tests (56 total) | 1.5h |
| ✅ 1.7.4 | Implement entry point detection: identify files that are imported by many other files but import few themselves (high fan-in, low fan-out). Also detect common entry point filenames: `index.ts`, `main.ts`, `app.ts`, `server.ts`. **Done** — `EntryPointDetector` class with `detect()` and `detectAndEnrich()` methods, configurable thresholds (minFanIn, maxFanOut, extraEntryPointNames), 4 reason types (high-fan-in, low-fan-out, filename-match, zero-importers), scoring system, 15 tests | 1h |
| ✅ 1.7.5 | Implement framework signal detection: analyze `package.json` dependencies to detect frameworks (react, express, next, fastapi, django), ORMs (prisma, typeorm, sequelize), test frameworks (jest, vitest, pytest, mocha), auth libraries. Output a `DetectedSignals` object. This is config-file analysis, no AST needed. **Done** — `FrameworkSignalDetector` analyzes package.json for 5 categories (frameworks, ORMs, test frameworks, auth libs, build tools), supports multi-file merging, extracts `PackageMeta`, 34 tests | 1h |
| ✅ 1.7.6 | Implement Express route extraction: find patterns like `router.get('/path', handler)`, `app.post('/path', middleware, handler)`, `router.use('/prefix', subRouter)`. Extract method, path, handler function name. AST-based — find `CallExpression` nodes matching known patterns | 1.5h |
| ✅ 1.7.7 | Implement Prisma schema extraction: parse `.prisma` files (Tree-sitter grammar or regex-based for the simple `model Foo { ... }` structure). Extract model names, fields, types, relations. **Done** — `PrismaExtractor` implements `ContentExtractor` interface (regex-based, no Tree-sitter), extracts models/enums/composite types with full field metadata (types, arrays, optionals, @id, @unique, @default, @relation), generates relation edges between models, CIGBuilder extended with `registerContentExtractor()` for non-Tree-sitter languages, 23 tests | 1h |
| ✅ 1.7.8 | Implement CIG persistence: take extracted nodes and edges, call `StorageAdapter.upsertCIGNodes` and `upsertCIGEdges`. Handle delta case: `StorageAdapter.deleteCIGForFiles` for changed files before reinserting. **Done** — `CIGPersistenceService` with `persist(repoId, result, opts?)` method, full run (upsert all) and delta run (delete changed files first, then upsert), optional Logger injection, 16 tests | 1h |
| ✅ 1.7.9 | Write integration tests: create a fixture TypeScript+Express project in `test/fixtures/sample-express-app/` with 10-15 files covering all extraction patterns (imports, exports, routes, classes, interfaces). Build CIG and verify node/edge counts and correctness. **Done** — 13-file fixture Express+Prisma app (controllers, services, routes, middleware, types, Prisma schema), 30 integration tests covering symbol extraction (functions, classes, methods, interfaces, enums, types), route extraction (user/post CRUD + health), import edges, Prisma schema/enum/relation extraction, framework signal detection, entry point detection, module nodes | 1.5h |

**Acceptance:** CIG built for the fixture Express repo. All functions, classes, interfaces extracted with correct line ranges. Import graph correct. Express routes extracted with correct method/path/handler. Prisma models extracted if present. Framework signals detected from `package.json`.

---

### 1.8 — Ingestion Pipeline ✅ COMPLETED
**Dependencies:** 1.7 (CIG builder), 1.5 (repo connector), 1.4 (storage adapter)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.8.1 | ✅ | Create `IngestionService` in `packages/core/ingestion/`. Constructor receives: `RepoConnector`, `StorageAdapter`, `Logger`, `IngestionConfig`. Implement `triggerIngestion(repoId, repoUrl, trigger)`: create job record via storage adapter, return job ID, begin async pipeline | 1h |
| 1.8.2 | ✅ | Implement the full ingestion pipeline as a private method: clone repo → get file tree → filter files → build CIG → update repo files in DB → update repo status to `ready`. Each step updates job status. Wrap entire pipeline in try-catch that marks job as `failed` with `error_message` on unhandled error | 1.5h |
| 1.8.3 | ✅ | Implement `determineRunType(repoId, currentFiles)`: check `ci_repositories.last_commit_sha` — if null, full run. Otherwise, get changed files from `RepoConnector.getChangedFiles`. If `changedFiles.length / totalFiles > 0.4`, full run. Else, delta run. Return run type + changed file list | 1h |
| 1.8.4 | ✅ | Implement delta CIG rebuild: for changed files only, call `StorageAdapter.deleteCIGForFiles`, then re-run CIG builder on just those files. Update `ci_repo_files.last_processed_sha` for processed files. Track `files_processed` and `files_skipped` counts | 1h |
| 1.8.5 | ✅ | Implement duplicate job prevention: before creating a job, call `StorageAdapter.getActiveJobForRepo`. If a job is already `running` for this repo, reject with appropriate error. If `queued`, return existing job ID | 0.5h |
| 1.8.6 | ✅ | Write integration test: run full ingestion pipeline end-to-end against the fixture repo. Verify: job goes through `queued → running → completed`, repo status is `ready`, CIG nodes and edges exist in DB, repo files are tracked. Then run delta ingestion, verify only changed file's CIG is rebuilt | 2h |

**Acceptance:** ✅ Full ingestion works end-to-end: clone, filter, CIG, stored in DB. Delta re-run only reprocesses changed files. Duplicate job rejection works. Job status transitions correct. All 197 tests pass.

**Notes:**
- `IngestionService` in `packages/core/ingestion/src/IngestionService.ts`
- Constructor: `RepoConnector`, `StorageAdapter`, `Logger`, `IngestionConfig`, optional `CIGBuilder`
- `IngestionConfig` gained `tempDir: string` field (cloneDir = `tempDir/{repoId}`)
- Repo record upserted in `triggerIngestion` (before job insert) to satisfy FK constraint
- `createDefaultCIGBuilder()` factory registers `TypeScriptExtractor` + `PrismaExtractor`
- File contents read with `fs.promises.readFile` from cloned directory
- `applyFilter` sets `language` and `fileType` via `FileFilter` (overrides `getFileTree` defaults)
- Migration 008 added: changes `node_id`/`edge_id`/FK columns from UUID → TEXT (CIG builder uses composite string IDs, not UUIDs)
- Integration tests use fixture app at `test/fixtures/sample-express-app/` with a mock `RepoConnector`; real Postgres on port 5433
- 6 integration tests: full pipeline, queued dedup, running dedup (throws), delta run, empty delta, full-run threshold

---

### 1.9 — Backend API Routes ✅ COMPLETED
**Dependencies:** 1.8 (ingestion service), 1.2 (Backstage plugin scaffold)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.9.1 | ✅ | Wire `IngestionService` into the Backstage backend plugin: in `plugin.ts`, read config via Backstage `ConfigApi`, instantiate `KnexStorageAdapter` (using Backstage's database service), instantiate `GitRepoConnector` (with auth token from config), instantiate `IngestionService` with all dependencies injected. This is the composition root | 1.5h |
| 1.9.2 | ✅ | Register route: `POST /repos/:repoId/ingest`. Route handler reads `repoId` from params, reads `repoUrl` from request body, calls `ingestionService.triggerIngestion()`, returns `{ jobId }` with status 202 Accepted. 409 on already-running, 400 on missing repoUrl | 1h |
| 1.9.3 | ✅ | Register route: `GET /repos/:repoId/jobs/:jobId`. Returns job from `storageAdapter.getJob()`. 404 if not found or repoId mismatch | 0.5h |
| 1.9.4 | ✅ | Register route: `GET /repos/:repoId/status`. Returns repo status, lastCommitSha, updatedAt from `storageAdapter.getRepo()`. 404 if not found | 0.5h |
| 1.9.5 | ✅ | 15 router tests: trigger ingestion 202+jobId, default trigger, missing repoUrl 400, invalid trigger 400, already-running 409, 500 on unexpected error, job found, job 404, job repoId mismatch, repo status, repo 404. Plus 19 IngestionService unit tests + 5 GitRepoConnector unit tests (230 total) | 1.5h |

**Acceptance:** ✅ All three endpoints work. Ingestion can be triggered via HTTP. Job status can be polled. Repo status reflects current state. Error responses have consistent format.

**Notes:**
- Also fixed 3 issues identified in 1.8 tech lead review (shipped together):
  1. `partial` job status now used when `filesSkipped > 0`
  2. Clone directory cleanup in `finally` block (`cleanupAfterIngestion` config flag, default true)
  3. `changedFiles` preserved on threshold-triggered full runs for observability
- Added `authToken` to `RepoCloneConfig` so GitHub token flows from config.yaml → `GitRepoConnector`
- Logger adapted from Backstage `LoggerService` to core `Logger` via thin inline adapter in composition root
- 205 tests pass (191 FileFilter + 14 router)

---

### 1.10 — Frontend: Repo Registration ✅ COMPLETED
**Dependencies:** 1.9 (backend API), 1.2 (frontend plugin scaffold)

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 1.10.1 | ✅ | `CodeInsightApi` interface with `createApiRef`. Methods: `triggerIngestion`, `getJobStatus`, `getRepoStatus` — done in Phase 1.2 scaffold | 0.5h |
| 1.10.2 | ✅ | `CodeInsightClient` using `DiscoveryApi` + `fetchApi`. Registered via `createApiFactory` in plugin definition — done in Phase 1.2 scaffold | 1h |
| 1.10.3 | ✅ | `IngestionButton` component: reads `github.com/project-slug` annotation, shows "No annotation" message when missing, triggers `triggerIngestion` on click with loading state | 1h |
| 1.10.4 | ✅ | `JobProgressSection`: polls `getJobStatus` every 3s after trigger, shows `CircularProgress` spinner with status text, stops on terminal state (`completed`, `failed`, `partial`) | 1h |
| 1.10.5 | ✅ | `RepoStatusSection`: fetches `getRepoStatus`, shows color-coded `Chip` (idle/processing/ready/error), last analyzed timestamp, error message display | 1h |
| 1.10.6 | ✅ | `entity.kind.toLowerCase() !== 'component'` guard (replaces `EntitySwitch`/`isKind` which were removed in `@backstage/plugin-catalog-react@2.0.0`). Shows fallback InfoCard for non-component entities | 0.5h |

**Acceptance:** ✅ All acceptance criteria met. Annotation-driven triggering, live polling progress, repo status with colors/timestamps, kind guard working.

**Notes:**
- `EntitySwitch` and `isKind` were removed from `@backstage/plugin-catalog-react@2.0.0` — replaced with a direct `entity.kind` check, which is functionally equivalent
- All components in a single `EntityCodeInsightContent.tsx` — `RepoStatusSection`, `JobProgressSection`, `IngestionButton`, `StatusChip` helper
- `repoId` derived from annotation: `org/repo` → `org-repo` (URL-safe, stable)
- `refreshToken` pattern: incremented when job completes to trigger re-fetch of repo status
- 13 API client tests already passing from Phase 1.2

---

### Phase 1 Summary

| Sub-Phase | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| 1.0 | Monorepo Scaffold | 4 | 3.5h |
| 1.1 | Shared Types | 4 | 4h |
| 1.2 | Backstage Plugin Scaffold | 4 | 4.5h |
| 1.3 | Database Migrations | 9 | 5.5h |
| 1.4 | Storage Adapter | 6 | 7.5h |
| 1.5 | Repo Connector (GitHub) | 6 | 6h |
| 1.6 | File Filter Service | 4 | 4h |
| 1.7 | CIG Builder | 9 | 11.5h |
| 1.8 | Ingestion Pipeline | 6 | 7h |
| 1.9 | Backend API Routes | 5 | 5h |
| 1.10 | Frontend Repo Registration | 6 | 5h |
| **Total** | | **63 sub-tasks** | **~63.5h** |

**Parallelization opportunities:**
- 1.1 and 1.2 can run in parallel (both depend only on 1.0)
- 1.4 and 1.5 can run in parallel (1.4 depends on 1.3+1.1, 1.5 depends on 1.1)
- 1.9 and 1.10 can overlap if backend routes are done first

---

## Phase 2: Documentation Generation
**Goal:** Clicking "Generate Docs" produces readable documentation rendered in a Backstage tab.

**Depends on:** Phase 1 complete (CIG built, job pipeline working)

---

### 2.0 — Phase 1 Hardening ✅ COMPLETED
**Dependencies:** Phase 1 complete

These items were flagged in the Phase 1 holistic tech lead review as deferred gaps that must be resolved before Phase 2 work begins, to avoid interface churn and type-safety holes accumulating across multiple phases.

| Task | Status | Description | Est. |
|------|--------|-------------|------|
| 2.0.1 | ✅ | Extend `StorageAdapter` interface with Phase 2 required methods: `getArtifactsByType(repoId, type)`, `markArtifactsStale(repoId, artifactIds, reason)`, `deleteRepoFilesNotIn(repoId, currentFilePaths)`. Add stubs (throw NotImplemented) in `KnexStorageAdapter` then implement each fully | 2h |
| 2.0.2 | ✅ | Replace `Artifact.content: Record<string, unknown>` with discriminated union types per artifact kind: `DocContent`, `DiagramContent`, `QnAChunkContent`. Update `KnexStorageAdapter` serialization/deserialization accordingly | 1.5h |
| 2.0.3 | ✅ | Implement `InProcessJobQueue` with bounded concurrency semaphore (`maxConcurrentJobs`). Wire into `IngestionService` or composition root so concurrent webhook bursts are bounded. | 2h |
| 2.0.4 | ✅ | Remove the hardcoded `entity.kind === 'component'` guard from `EntityCodeInsightContent`. Move the guard to the dev-app entity page config (or export an `isCodeInsightAvailable` helper) so consumers control which entity kinds see the tab | 0.5h |

**Acceptance:** ✅ All four storage methods exist and are implemented. `Artifact` is a discriminated union. Concurrent ingestion jobs are bounded by config. Frontend component works on any entity kind.

**Notes:**
- `ArtifactContent` = `DocContent | DiagramContent | QnAChunkContent` — each has a `kind` discriminant
- `DocContent`: `{ kind: 'doc', module, markdown }` — generated markdown per doc module
- `DiagramContent`: `{ kind: 'diagram', diagramType, mermaid, title? }` — raw Mermaid DSL
- `QnAChunkContent`: `{ kind: 'qna_chunk', text, chunkIndex, totalChunks, sourceFile? }` — RAG chunks
- `InProcessJobQueue` in `packages/core/ingestion/src/InProcessJobQueue.ts` — Semaphore class (FIFO wait queue), polls job status every 500ms to release slot
- Router now calls `jobQueue.enqueue()` — `ingestionService` removed from `RouterOptions`
- `isCodeInsightAvailable(entity)` checks for `github.com/project-slug` annotation; exported from plugin package
- 531 tests pass (18 suites, +21 new tests for new methods + InProcessJobQueue)

---

### 2.1 — LLM Client + Cache ✅ COMPLETED

- [x] Implement `LLMClient` interface (canonical definition in `@codeinsight/types`)
- [x] Implement for Claude (`AnthropicLLMClient` using `@anthropic-ai/sdk`)
- [x] Implement for OpenAI (`OpenAILLMClient` — works with Azure, Ollama, vLLM via `baseURL`)
- [x] Implement LLM response cache (`CachingLLMClient`):
  - Key: `SHA256(systemPrompt + '\x00' + userPrompt + '\x00' + modelName)`
  - Check `ci_llm_cache` before every `complete()` call
  - Store response after every `complete()` call (best-effort, write errors swallowed)
  - `stream()` delegates directly — not cached
- [x] `createLLMClient(config, logger?, knex?)` factory wires provider + cache
- [x] Composition root reads LLM config from Backstage app-config, instantiates client (optional — graceful no-op when absent)

**Acceptance:** ✅ LLM calls work. Second identical call returns from cache. Cache hit logged. 65 new unit tests, 596 total.

**Notes:**
- Package: `packages/adapters/llm/` (`@codeinsight/llm`)
- `CachingLLMClient` cache key uses null-byte separators to prevent collisions across field boundaries
- `tokens_used` stored as 0 in cache row — `LLMClient` interface doesn't expose token counts; Phase 2.5 can enrich
- Plugin-backend logs "No LLM config found" when `llm.*` config is absent (docs/diagrams unavailable but plugin still starts)

---

### 2.2 — Classifier Prompt ✅ COMPLETED

- [x] Write `prompts/classifier.md`:
  - Input: file tree paths + package manifest content (~1.5K tokens)
  - Output: JSON with repo_type, frameworks, detected_signals, prompt_modules[]
- [x] Create `ClassifierService.classify(cig)` — runs classifier, returns module list
- [x] Parse and validate classifier JSON output
- [x] Handle classification failures gracefully (fall back to core modules only)

**Acceptance:** ✅ Classifier correctly identifies React+Express, Python FastAPI, Go service, Next.js app from file trees. 20 unit tests pass.

**Notes:**
- Package: `packages/core/doc-generator/` (`@codeinsight/doc-generator`)
- `ClassifierInput`: `{ filePaths: string[], packageJsonContents: string[] }` — file tree paths (capped at 200) + raw package.json content
- `ClassifierResult`: `{ repoType, language, frameworks, detectedSignals, promptModules }` — matches classifier JSON output
- System prompt embeds full module registry (14 valid module IDs) + selection rules
- `sanitizeModules()`: filters LLM output to known-valid module IDs; always guarantees `core/overview` + `core/project-structure`
- Fallback result: all 7 core modules, `repoType: ['unknown']`, `language: 'unknown'` — triggered on LLM error, missing JSON, or malformed JSON
- `extractDetectedSignals()`: skips keys with `null` or string `'null'` values
- `prompts/classifier.md`: documents prompt contract, input/output format, acceptance criteria for 5 repo types, fallback behavior, token budget
- 20 unit tests covering all classification paths, fallback scenarios, prompt construction, and field validation

---

### 2.3 — Core Prompt Modules ✅ COMPLETED

Write one prompt file per section. Each declares its required CIG fields and output format.

- [x] `prompts/core/overview.md` — inputs: README + entry points + package manifest
- [x] `prompts/core/project-structure.md` — inputs: directory tree (paths only, no content)
- [x] `prompts/core/getting-started.md` — inputs: package.json + Dockerfile + .env.example
- [x] `prompts/core/configuration.md` — inputs: config files + .env.example
- [x] `prompts/core/dependencies.md` — inputs: package.json/requirements.txt/go.mod
- [x] `prompts/core/testing.md` — inputs: test config files + sample test files
- [x] `prompts/core/deployment.md` — inputs: Dockerfile + CI files + k8s yamls

**Acceptance:** ✅ Each prompt declares required CIG fields, file inputs, system prompt, user prompt template with variables, output format, acceptance criteria, and token budget.

**Notes:**
- All 7 files live in `prompts/core/`
- Each file follows the same contract format as `prompts/classifier.md`
- Every prompt includes: required CIG fields, required file inputs, system prompt, user prompt template with `{variables}`, expected output format, acceptance criteria, and token budget
- `overview.md`: README + entry points + manifest → `## Overview` section (~5K tokens in / ~400 out)
- `project-structure.md`: file paths only from CIG → `## Project Structure` annotated tree (~2K in / ~350 out)
- `getting-started.md`: manifest + .env.example + Dockerfile → `## Getting Started` step-by-step (~2K in / ~450 out)
- `configuration.md`: .env.example + config files → `## Configuration` variable tables (~3K in / ~500 out)
- `dependencies.md`: package manifest → `## Dependencies` grouped tables (~2K in / ~400 out)
- `testing.md`: test config + 2-3 sample test files → `## Testing` with commands and structure (~2.5K in / ~400 out)
- `deployment.md`: Dockerfile + CI config + docker-compose + k8s → `## Deployment` with commands (~5K in / ~500 out)
- `DocGenerationService` (Phase 2.5) will load these files, inject CIG context into template variables, and call LLM

---

### 2.4 — Framework-Specific Prompt Modules ✅ COMPLETED

- [x] `prompts/backend/api-reference.md` — inputs: route files from CIG
- [x] `prompts/backend/database.md` — inputs: schema files + migration files
- [x] `prompts/backend/auth.md` — inputs: auth middleware + token files
- [x] `prompts/frontend/state-management.md` — inputs: store files + sample components
- [x] `prompts/frontend/routing.md` — inputs: router config files
- [x] `prompts/frontend/component-hierarchy.md` — inputs: component import graph from CIG (no file content needed)

**Acceptance:** ✅ All 6 framework-specific prompt files written. Each declares required CIG fields, file inputs, system prompt adapted to its library's idioms, user prompt template, output format with worked examples, acceptance criteria, and token budget.

**Notes:**
- `backend/api-reference.md`: CIG `routes` list + top route handler files → `## API Reference` with endpoint tables (~5K in / ~700 out); groups by resource noun
- `backend/database.md`: schema file + recent migrations → `## Database` with per-entity field tables and relationship descriptions (~6K in / ~600 out)
- `backend/auth.md`: auth middleware + token files + protected routes from CIG → `## Authentication & Authorization` with flow, token payload, and route table (~6K in / ~500 out)
- `frontend/state-management.md`: store files + sample component → `## State Management`; system prompt adapts to library idioms (Zustand vs Redux vs MobX vs Pinia vs Recoil/Jotai); includes worked examples for both Zustand and Redux Toolkit (~5.5K in / ~500 out)
- `frontend/routing.md`: router config + guard + layout files → `## Routing` with full route table, protected route explanation, and navigation API (~5.5K in / ~450 out)
- `frontend/component-hierarchy.md`: **no file content required** — pure CIG import graph (dependency_graph edges filtered to component files) → `## Component Hierarchy` with annotated tree, shared components table, and feature groupings (~3K in / ~450 out)

---

### 2.5 — Doc Generation Service ✅ COMPLETED

- [x] Create `DocGenerationService`:
  - `generateDocs(repoId, cloneDir)` — runs full pipeline
  - `generateDocsWithClassification(repoId, cloneDir, classifierResult)` — runs with pre-classified result
  - For each module in classifier output:
    - Build context from CIG (specific files, not everything)
    - Compute composite input SHA
    - Check `ci_artifacts` — if not stale, skip
    - Check LLM cache — if hit, use cached response (via CachingLLMClient)
    - Call LLM with focused prompt + context
    - Store result in `ci_artifacts`
    - Record inputs in `ci_artifact_inputs`
- [x] Phase 1 (file docs): run all in parallel with concurrency limit (max 20 simultaneous, configurable)
- [ ] Phase 2 (dir summaries): run after Phase 1 completes (deferred — no prompt modules yet)
- [ ] Phase 3 (architecture): run after Phase 2 completes (deferred — no prompt modules yet)
- [x] Track `tokens_used` per artifact and aggregate per job

**Acceptance:** ✅ Doc generation pipeline implemented with parallel execution, staleness-aware skip logic, composite SHA tracking, and artifact input recording. 39 new tests (570 total unit tests pass). Phase 2/3 deferred until directory-summary and architecture prompts are written. `DocGenerationService` is now wired into `IngestionService.runPipeline()` (called after staleness sweep, before cloneDir cleanup) and into the `plugin-backend` composition root via optional `docGenerator` constructor param.

**Notes:**
- `DocGenerationService` in `packages/core/doc-generator/src/DocGenerationService.ts`
- `ContextBuilder` in `packages/core/doc-generator/src/ContextBuilder.ts` — builds CIG-driven prompt context for 13 modules
- `PromptRegistry` in `packages/core/doc-generator/src/PromptRegistry.ts` — maps module IDs to system/user prompt definitions; prompts are inline string constants (runtime source of truth); the `.md` files in `prompts/` are design specs only — file-based prompt loading is deferred
- All 13 prompt modules supported: 7 core + 3 backend + 3 frontend
- Semaphore-based concurrency control (configurable `maxConcurrency`, default 20)
- All file reads use `readFileSafe` — graceful degradation when files unavailable
- `computeInputSha()` generates deterministic composite SHA (sorted file paths + SHAs)
- `StorageAdapter` extended with `upsertArtifactInputs` and `getArtifactInputs` methods
- `KnexStorageAdapter` implements new methods with batch upsert + onConflict merge
- Artifacts stored with `DocContent { kind: 'doc', module, markdown }` discriminated union
- Token usage estimated at ~4 chars/token for both input and output
- 4 test suites: DocGenerationService (8 tests), PromptRegistry (7 tests), ContextBuilder (8 tests), ClassifierService (20 tests)

---

### 2.6 — Staleness Detection + Delta Docs ✅ COMPLETED

- [x] Implement `StalenessService.sweep(repoId, changedFiles)`:
  - Query `ci_artifact_inputs` for artifacts whose input files are in `changedFiles`
  - Mark those artifacts `is_stale=true, stale_reason='file_changed'`
  - Walk `ci_artifact_dependencies` → cascade stale marking (reason=`dependency_stale`)
- [x] Integrate into ingestion job: sweep runs after CIG rebuild (both full and delta runs)
- [x] Regeneration respects `is_stale` flag — `DocGenerationService.processModuleInner` already skips fresh artifacts via the `!existing.isStale && existing.inputSha === inputSha` check
- [x] Stale artifact IDs recorded in job's `artifacts_stale` field for observability

**Acceptance:** ✅ Change one file → only artifacts that used that file are marked stale. Cascade propagates via `ci_artifact_dependencies`. Unchanged artifacts skip on next doc gen run. 12 new unit tests (584 total unit tests pass).

**Notes:**
- `StalenessService` in `packages/core/ingestion/src/StalenessService.ts` — zero deps besides `@codeinsight/types`
- Two new `StorageAdapter` methods: `getArtifactIdsByFilePaths(repoId, filePaths)` — queries `ci_artifact_inputs` by file; `getArtifactDependents(repoId, artifactIds)` — queries `ci_artifact_dependencies`
- Both methods implemented in `KnexStorageAdapter` with proper batching (500-record chunks)
- `IngestionService` instantiates `StalenessService` internally (injectable via 6th constructor param for testing)
- Full run: sweeps all filtered file paths; delta run: sweeps only changed files
- Cascade is a fixed-point loop — terminates when no new dependents are found (handles cycles safely via `allStaleIds` set)

---

### 2.7 — Documentation Frontend Tab ✅ COMPLETED

- [x] Create `EntityDocumentationTab` component:
  - Fetch doc sections via `GET /api/codeinsight/repos/:repoId/docs`
  - Render Markdown sections (use `@backstage/core-components` MarkdownContent)
  - Show per-section: "Generated from X files • Last updated Y"
  - "Regenerate" button → calls ingest endpoint → shows progress
  - Show staleness indicator if `is_stale=true`
- [x] Add tab to Backstage entity page (dev app wired at `/docs` route)

**Acceptance:** ✅ Full documentation visible in Backstage for a real repo. Regenerate button works. Stale sections are visually indicated.

**Notes:**
- Backend: `GET /repos/:repoId/docs` route in `router.ts` — calls `getArtifactsByType(repoId, 'doc')` + `getArtifactInputs` per artifact; returns sorted list with `artifactId`, `markdown`, `isStale`, `staleReason`, `fileCount`, `generatedAt`, `tokensUsed`
- Frontend API: `getDocs(repoId): Promise<DocSection[]>` added to `CodeInsightApi` interface and `CodeInsightClient`
- `EntityDocumentationTab` in `packages/backstage/plugin/src/components/EntityDocumentationTab.tsx` — exported from plugin `index.ts`
- Per-section: formatted module name (e.g. "core/overview" → "Overview"), staleness `Chip`, file count + date metadata, `MarkdownContent` render
- Stale indicator: yellow `Chip` with `staleReason` in tooltip
- Regenerate: calls `triggerIngestion` → polls job status → re-fetches docs on completion
- Dev app: `EntityLayout.Route path="/docs" title="Documentation"` added to `App.tsx`
- 3 new router tests (18 total for router suite)

---

## Phase 3: Diagram Generation
**Goal:** Diagrams tab shows auto-generated visual diagrams. Pure-AST diagrams work without any LLM key configured.

**Depends on:** Phase 1 (CIG), Phase 2.1 (LLM client for LLM-based diagrams)

---

### 3.1 — Diagram Module Interface

- [ ] Define `DiagramModule` interface:
  ```typescript
  interface DiagramModule {
    id: string
    requires: string[]       // CIG fields needed
    triggersOn: string[]     // conditions: 'orm:prisma', 'framework:react'
    llmNeeded: boolean
    generate(cig: CIG, llmClient?: LLMClient): Promise<MermaidDiagram>
  }
  ```
- [ ] Create `DiagramRegistry` — registers and selects modules based on CIG detected signals

**Acceptance:** Registry correctly selects diagram modules for different repo types.

---

### 3.2 — Pure AST Diagrams

- [ ] `diagrams/universal/dependency-graph.ts`:
  - Read `ci_cig_edges` (import type edges)
  - Serialize to `graph TD` Mermaid syntax
  - Group by directory for large repos (collapse internal edges)
- [ ] `diagrams/universal/er-diagram.ts`:
  - Read `ci_cig_nodes` (schema type nodes) and their relationships
  - Serialize to `erDiagram` Mermaid syntax
  - Support: Prisma, SQLAlchemy, TypeORM, Mongoose
- [ ] `diagrams/frontend/component-hierarchy.ts`:
  - Filter `ci_cig_edges` to component import edges only
  - Serialize to `graph TD` Mermaid syntax

**Acceptance:** All three diagrams generate instantly (no LLM). Correct for 3+ real repos.

---

### 3.3 — LLM-Assisted Diagrams

Write prompt files + generation modules:

- [ ] `prompts/diagrams/api-flow.md` + `diagrams/backend/api-flow.ts`:
  - Input: routes from CIG + call graph for each route handler (~3-5K tokens)
  - Output: `sequenceDiagram` showing request → handler → service → DB
- [ ] `prompts/diagrams/ci-cd-pipeline.md` + `diagrams/universal/ci-cd-pipeline.ts`:
  - Input: parsed CI YAML structure (not raw YAML, structured data)
  - Output: `flowchart LR` of build → test → deploy stages
- [ ] `prompts/diagrams/state-flow.md` + `diagrams/frontend/state-flow.ts`:
  - Input: store definitions from CIG
  - Output: `stateDiagram-v2`
- [ ] `prompts/diagrams/request-lifecycle.md` + `diagrams/backend/request-lifecycle.ts`:
  - Input: middleware chain from CIG
  - Output: `flowchart TD`

**Acceptance:** LLM diagrams generate correctly. Token usage per diagram < 6K input.

---

### 3.4 — Diagram Generation Service

- [ ] Create `DiagramGenerationService`:
  - `generateDiagrams(repoId)` — selects and runs applicable modules
  - Pure AST modules run in parallel, instantly
  - LLM modules run in parallel with concurrency limit
  - Each stores result in `ci_artifacts` (type='diagram')
  - Delta: only regenerate diagrams whose input files changed

**Acceptance:** Full diagram generation for a real repo. Delta run only regenerates affected diagrams.

---

### 3.5 — Diagrams Frontend Tab

- [ ] Create `EntityDiagramsTab` component:
  - Fetch diagrams via `GET /api/codeinsight/repos/:repoId/diagrams`
  - Render Mermaid diagrams (use `mermaid.js` package or Backstage TechDocs renderer)
  - Gallery view: diagram title + description + full-size expand
  - Show which diagrams are pure-AST vs LLM-generated
  - Stale indicator + per-diagram regenerate option
- [ ] Handle Mermaid syntax errors gracefully (show parse error + raw syntax)

**Acceptance:** Diagrams tab shows all generated diagrams. Dependency graph and ER diagram visible without LLM key.

---

## Phase 4: QnA Pipeline
**Goal:** Chat tab where users ask questions about the repo and get grounded, sourced answers.

**Depends on:** Phase 1 (CIG), Phase 2 (doc sections to index), Phase 3 (diagram descriptions to index)

---

### 4.1 — Embedding Client + Cache

- [ ] Create `EmbeddingClient` abstraction
- [ ] Implement with OpenAI `text-embedding-3-small`
- [ ] Implement embedding cache:
  - Key: `SHA256(chunk_text)`
  - Check `ci_embedding_cache` before every embed call
  - Store embedding after every embed call

**Acceptance:** Embedding calls work. Second identical text returns from cache.

---

### 4.2 — Chunking Service

- [ ] Create `ChunkingService` using CIG:
  - For each symbol in `ci_cig_nodes`: create code chunk with full metadata
  - For each file summary (from doc Phase 1): create summary chunk
  - For each doc section (from doc Phase 2+3): create doc chunk
  - Chunk metadata: file_path, symbol, layer, lines, calls[], called_by[], file_sha
  - chunk_id format: `{repo_id}:{file_path}:{symbol}:{layer}`
- [ ] Handle oversized chunks (symbol > 1000 tokens): split at logical sub-blocks

**Acceptance:** Chunking produces correct chunks for a 100-file repo. Chunk IDs are stable across re-runs for unchanged files.

---

### 4.3 — Indexing Service

- [ ] Create `IndexingService`:
  - `indexRepo(repoId)` — chunks all layers, embeds, upserts to `ci_qna_embeddings`
  - Delta: only re-embed chunks where `file_sha` changed
  - Batch embed calls (OpenAI supports batch of 100)
  - Store each embedding with `content_sha` for cache lookup
- [ ] Run indexing as part of ingestion job, after doc generation (so doc chunks exist)

**Acceptance:** Full index built for a 100-file repo. Delta re-index after one file change only re-embeds that file's chunks.

---

### 4.4 — Retrieval Service

- [ ] Create `RetrievalService`:
  - `retrieve(repoId, query, queryEmbedding)` → top chunks
  - Vector search via pgvector cosine similarity, filtered by `repo_id`
  - Keyword search via PostgreSQL full-text search on `content` field
  - CIG direct lookup for structural queries (no embedding)
  - Merge results, deduplicate by `chunk_id`
  - Return top 5-8 chunks after deduplication
- [ ] Layer filtering: conceptual queries search Layers 2+3 first; specific queries hit Layer 1

**Acceptance:** Relevant chunks retrieved for 10+ test questions against a real repo.

---

### 4.5 — Context Assembly Service

- [ ] Create `ContextAssemblyService`:
  - For each retrieved chunk, expand with CIG data:
    - Pull direct callees (short snippets, max 200 tokens each)
    - Pull linked doc chunk if exists
    - Pull file import list
  - Assemble into structured context block
  - Enforce total token budget (~8K tokens for chunks + expansion)
  - Truncate least-relevant chunks if over budget

**Acceptance:** Context block for "how does auth work" contains function code + callees + doc section. Total tokens verified within budget.

---

### 4.6 — QnA Service

- [ ] Create `QnAService`:
  - `ask(sessionId, question)` → structured response
  - Classify query type (conceptual / specific / relational / navigational / generative)
  - Run appropriate retrieval path
  - Assemble context
  - Call LLM with system prompt + conversation history + context
  - Parse response → extract answer + source references
  - Store in `ci_qna_messages`
  - Update session `active_context` (accumulate mentioned symbols/files)
- [ ] Session management:
  - `createSession(repoId, userId)` → session_id
  - Load last 6 turns as history
  - Compress older turns after 10 turns
- [ ] Streaming: use SSE to stream LLM response tokens to frontend

**Acceptance:** QnA answers 10+ test questions accurately with correct source references. Follow-up questions resolve references correctly.

---

### 4.7 — QnA Frontend Tab

- [ ] Create `EntityQnATab` component:
  - Chat UI: message list + input box
  - Stream tokens as they arrive (SSE)
  - Each assistant message shows:
    - Answer text (Markdown rendered)
    - Source cards: file path + symbol + line range (clickable → opens in GitHub/GitLab)
    - Related docs: links to doc sections
    - Related diagrams: inline preview thumbnail
  - Session persists across page navigation (session_id in component state)
  - "New conversation" button

**Acceptance:** Chat works end-to-end. Sources are clickable and open correct file. Streaming renders token by token.

---

## Phase 5: Integration & Cross-Feature Enrichment
**Goal:** The three features work together. Webhooks keep everything fresh automatically.

**Depends on:** Phases 1-4 complete

---

### 5.1 — Webhook Endpoints

- [ ] `POST /api/codeinsight/webhooks/github` — verify HMAC signature + trigger ingestion
- [ ] `POST /api/codeinsight/webhooks/gitlab` — verify token + trigger ingestion
- [ ] `POST /api/codeinsight/webhooks/bitbucket` — verify + trigger ingestion
- [ ] Extract changed files from webhook payload (avoid full tree fetch when possible)
- [ ] Debounce: if job already running for this repo, queue next run (don't spawn duplicate)

**Acceptance:** Push to GitHub triggers delta ingestion. Docs/diagrams/QnA updated within 2 minutes.

---

### 5.2 — Cross-Feature QnA Enrichment

- [ ] When QnA query mentions a diagram: include diagram description in context
- [ ] When QnA query has generative intent ("show me", "diagram", "flow of"):
  - Detect intent (keyword pattern or classifier)
  - Use CIG to trace relevant call chain
  - Generate focused Mermaid diagram
  - Include in response as `generated_diagram` field
- [ ] Frontend: render `generated_diagram` inline in QnA response
- [ ] Link QnA answers to relevant doc sections:
  - Match retrieved doc chunks → surface as "Related documentation" cards

**Acceptance:** "Show me the login flow" returns both a sequence diagram and explanation. "How does auth work" surfaces the auth doc section as a related card.

---

### 5.3 — Token Usage Dashboard

- [ ] Aggregate `tokens_used` from `ci_ingestion_jobs` and `ci_qna_messages`
- [ ] Show in Backstage: "This month: X tokens used, estimated cost $Y"
- [ ] Per-repo breakdown
- [ ] Cache hit rate (LLM cache hits vs misses)

**Acceptance:** Token usage visible per repo. Cache hit rate visible for last 30 days.

---

### 5.4 — Error Handling + Resilience

- [ ] LLM call failures: retry with exponential backoff (max 3 retries)
- [ ] If LLM call fails after retries: mark artifact with `error` status, don't block other artifacts
- [ ] Partial generation: if 5 out of 10 sections succeed, show the 5 and indicate partial state
- [ ] Invalid Mermaid syntax: store raw + error, show syntax error message in UI with copy button

**Acceptance:** One failing LLM call doesn't block the whole generation run.

---

## Phase 6: Open Source Release
**Goal:** Plugin is installable by anyone from npm. Contribution-ready.

**Depends on:** Phases 1-5 complete and stable

---

### 6.1 — Configuration

- [ ] All settings configurable via Backstage `app-config.yaml`:
  ```yaml
  codeinsight:
    llm:
      provider: anthropic  # or openai
      apiKey: ${CODEINSIGHT_LLM_API_KEY}
      model: claude-sonnet-4-20250514  # or any model identifier
    embeddings:
      provider: openai
      apiKey: ${OPENAI_API_KEY}
    storage:
      cloneTtlHours: 24
    features:
      docs: true
      diagrams: true
      qna: true
  ```
- [ ] All LLM/embedding keys optional — plugin degrades gracefully when missing
- [ ] Pure-AST diagrams work with zero API keys

**Acceptance:** Plugin fully configurable without code changes.

---

### 6.2 — Package Structure

- [ ] `@codeinsight/backstage-plugin` — frontend plugin
- [ ] `@codeinsight/backstage-plugin-backend` — backend plugin
- [ ] `@codeinsight/backstage-plugin-common` — shared types
- [ ] Publish to npm under a consistent namespace
- [ ] Export all necessary extension points for customization

---

### 6.3 — Documentation

- [ ] `README.md` — installation, quick start, configuration reference
- [ ] `CONTRIBUTING.md` — how to add new prompt modules, diagram modules, language support
- [ ] Example Backstage app with plugin pre-installed
- [ ] Changelog

---

### 6.4 — CI/CD for the Plugin

- [ ] GitHub Actions: test, lint, build on PR
- [ ] Automated npm publish on tag
- [ ] E2E test against a sample public repo

---

## Milestone Summary

| Phase | Deliverable | Demonstrates |
|---|---|---|
| 1 | CIG built and stored | Clone, parse, structure any repo |
| 2 | Docs tab working | AI docs, delta cache, token efficiency |
| 3 | Diagrams tab working | Pure-AST + LLM diagrams, Mermaid render |
| 4 | QnA tab working | RAG pipeline, grounded answers, sources |
| 5 | Webhooks + enrichment | Automated freshness, cross-feature links |
| 6 | npm release | Open source installable plugin |

Each phase is a shippable increment. Phase 2 alone is useful without diagrams or QnA. Phase 3 alone (with pure-AST diagrams) is useful without an LLM key.

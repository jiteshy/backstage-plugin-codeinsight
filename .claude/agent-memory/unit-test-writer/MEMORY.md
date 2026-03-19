# Unit Test Writer Memory

## Test Conventions
- Test files co-located with source: `foo.test.ts` next to `foo.ts`
- Root Jest config at `jest.config.js`, roots: `['<rootDir>/packages']`
- Run tests: `pnpm test` or `npx jest --testPathPattern='<pattern>'`
- ts-jest preset, node environment, strict TS

## Mock Patterns
- **Constructor injection** throughout — pass mock objects directly, no `jest.mock()` needed
- Backstage service mocks (LoggerService, RootConfigService, DatabaseService): simple objects with `jest.fn()` methods, cast with `as any`
- DiscoveryApi mock: `{ getBaseUrl: jest.fn().mockResolvedValue(url) }`
- FetchApi mock: `{ fetch: jest.fn().mockResolvedValue({ ok, statusText, json: jest.fn().mockResolvedValue(body) }) }`

## Known Issues
- `response.json()` returns `unknown` under strict TS — source files need explicit `as Type` casts
- `supertest` is NOT installed — use `http` module for backend router tests (create express app, listen on port 0, use `http.request`)
- Knex loads dialect drivers eagerly at construction — only use client strings whose native packages are installed in the workspace (`pg` is installed; `sqlite3`, `mysql2` are NOT). Tests that verify client pass-through must use `'pg'` only.

## CIG / TypeScriptExtractor Test Patterns
- `buildMultiFile(files)` helper uses `CIGBuilder` + `TypeScriptExtractor` to avoid raw Tree-sitter native module handling
- `result.edges.filter(e => e.edgeType === 'imports')` to isolate import edges
- Fallback-to-module-edge: import a non-exported symbol to assert `toNodeId` ends in `<module>:variable`
- Faulty-extractor error propagation pattern: create a plain object with `languages`, `extractSymbols`, and an `extractEdges` that throws; cast to `LanguageExtractor`; verify `result.errors[0].error` matches `/Edge extraction failed/`
- `jest.requireActual('../CIGBuilder')` is NOT needed for error-propagation tests — construct `CIGBuilder` directly (it is not mocked)

## InProcessJobQueue Unit Test Patterns
- Mock `IngestionService` as `{ triggerIngestion: jest.fn() } as unknown as IngestionService` — only that method is used
- Mock `StorageAdapter` as `{ getJob: jest.fn() } as unknown as StorageAdapter` — only `getJob` is used by the queue
- Semaphore "blocked" test: use a never-resolving `triggerIngestion` (returns `new Promise(() => {})`), enqueue 3 jobs to fill all slots, then enqueue a 4th and assert its `.then()` callback has not fired after `await Promise.resolve()` drains
- Semaphore "released on terminal" test: `jest.useFakeTimers()` + `jest.advanceTimersByTime(500)` per poll cycle; `getJob` mock returns 'running' then 'completed' on sequential calls; verify blocked enqueue resolves after timers advance past the second poll
- Semaphore release on error: use `maxConcurrentJobs=1`, fail the first `triggerIngestion`, verify the second enqueue succeeds without hanging

## IngestionService Unit Test Patterns
- `CIGPersistenceService` is constructed internally — must `jest.mock('@codeinsight/cig')` at module level; expose `__mockPersist` and `__mockBuild` from the mock factory for per-test configuration
- `CIGBuilder` IS injectable (5th constructor param) — but mocking the whole module is cleaner since it also handles `TypeScriptExtractor`/`PrismaExtractor` construction
- `fs/promises` mocked via `jest.mock('fs', ...)` merging with `jest.requireActual('fs')` — mock `readFile` and `rm` only
- Fire-and-forget pipeline: call `triggerIngestion()` then `await new Promise(resolve => setImmediate(resolve))` twice to let the async pipeline settle
- Final `updateJob` call holds the terminal status — find it with `storage.updateJob.mock.calls[calls.length - 1][1]`
- To test `triggerIngestion` in isolation without running the pipeline: `jest.spyOn(service as any, 'runPipeline').mockResolvedValue(undefined)`

## LLM Adapter Unit Test Patterns
- SDK modules (`@anthropic-ai/sdk`, `openai`) mocked with `jest.mock('module', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ ... })) }))` — use `__esModule: true` for default exports
- Mock method references (`mockCreate`, `mockStream`) declared BEFORE `jest.mock()` call (Jest hoisting safe because they are `const` declarations in module scope, not `let`/`var`)
- OpenAI constructor cast: `(OpenAI as unknown as jest.Mock)` — direct `as jest.Mock` causes TS2352 overlap error; always cast through `unknown` first
- `CachingLLMClient` Knex chain mock: `.ignore().catch(fn)` — `catch` here is `Promise.prototype.catch`, NOT a new chain link. When simulating write errors, make `catch` a `jest.fn().mockImplementation((fn) => { fn(error); return Promise.resolve(); })`. Pass `writeError` as a factory param to keep tests clean.
- `CachingLLMClient` `stream()` returns the inner iterable directly (synchronously) — can use `toBe()` identity check, no `await` needed on `stream()` itself
- `createLLMClient` factory: mock `../AnthropicLLMClient`, `../OpenAILLMClient`, `../CachingLLMClient` via relative paths; imported mocked constructors are `instanceof`-checkable after `jest.mock()` because Jest mock classes preserve the prototype chain
- Cache key determinism tests: instantiate two separate clients with separate knex mocks; compare the `where()` second argument across the two calls

## GitRepoConnector Unit Test Patterns
- `@codeinsight/repo` has no local Jest config — tests are picked up by the root `jest.config.js` (roots: `packages/`)
- Mock `simple-git` with `jest.mock('simple-git', () => jest.fn(() => mockGitInstance))` where `mockGitInstance` exposes `{ clone: mockGitClone }`
- Token injection verified by asserting the URL arg (`mockGitClone.mock.calls[0][0]`) contains the token string
- Clone args (depth, branch) verified via `mockGitClone.mock.calls[0][2]`

## Project Structure (test-relevant)
- `packages/backstage/plugin-backend/` — backend plugin, uses `@backstage/*` (OK here)
- `packages/backstage/plugin/` — frontend plugin, uses `@backstage/*` (OK here)
- `packages/core/` — ZERO `@backstage/*` imports (enforced)
- `packages/adapters/` — ZERO `@backstage/*` imports (enforced)

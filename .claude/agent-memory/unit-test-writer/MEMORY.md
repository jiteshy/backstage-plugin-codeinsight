# Unit Test Writer Memory

## Test Conventions
- Test files co-located with source: `foo.test.ts` next to `foo.ts`, `foo.test.tsx` for React components
- Root Jest config at `jest.config.js`, roots: `['<rootDir>/packages']`
- `testMatch` includes both `*.test.ts` and `*.test.tsx` (updated when React component tests were added)
- Run tests: `pnpm test` or `npx jest --testPathPattern='<pattern>'`
- ts-jest preset, node environment by default; React component test files use `@jest-environment jsdom` docblock
- ts-jest transform uses inline tsconfig overrides (`jsx: 'react-jsx'`, `lib: ['ES2021','DOM','DOM.Iterable']`) — no separate tsconfig file needed
- `@testing-library/jest-dom` is installed at workspace root; import with `import '@testing-library/jest-dom'` at top of each component test file (no global setup file)

## Mock Patterns
- **Constructor injection** throughout — pass mock objects directly, no `jest.mock()` needed
- Backstage service mocks (LoggerService, RootConfigService, DatabaseService): simple objects with `jest.fn()` methods, cast with `as any`
- DiscoveryApi mock: `{ getBaseUrl: jest.fn().mockResolvedValue(url) }`
- FetchApi mock: `{ fetch: jest.fn().mockResolvedValue({ ok, statusText, json: jest.fn().mockResolvedValue(body) }) }`

## Known Issues
- `response.json()` returns `unknown` under strict TS — source files need explicit `as Type` casts
- `supertest` is NOT installed — use `http` module for backend router tests (create express app, listen on port 0, use `http.request`)
- Strict TS: importing unused types in test files causes `TS6196` compile errors — always trim import lists to only what is referenced in the file
- Knex loads dialect drivers eagerly at construction — only use client strings whose native packages are installed in the workspace (`pg` is installed; `sqlite3`, `mysql2` are NOT). Tests that verify client pass-through must use `'pg'` only.
- MUI v4 `Tooltip` + React 18 produces `findDOMNode is deprecated` console.error warnings in component tests — these are cosmetic, not failures

## Backstage Component Test Pattern (no @backstage/test-utils)
`@backstage/test-utils` is NOT installed. For frontend component tests, mock Backstage at the module level:
- `@backstage/plugin-catalog-react`: mock `useEntity` to return a controlled entity fixture
- `@backstage/core-plugin-api`: mock BOTH `useApi` (returns mock API object) AND `createApiRef` (called at module-level in `api.ts` — return `{ id: config.id }` stub). Missing `createApiRef` causes `TypeError: createApiRef is not a function` at suite load.
- `@backstage/core-components`: mock `InfoCard` and `MarkdownContent` as plain div stubs (they need full Backstage app context)
- Import the raw component file (`'./EntityCodeInsightContent'`), NOT the routable extension from `'../plugin'` — the extension uses `createRoutableExtension` which requires a full Backstage app context
- `FetchApi mock` in `api-client.test.ts`: helper accepts `{ ok, status, statusText }` — `status` defaults to `ok ? 200 : 500`. For 404-specific branches: `{ ok: false, status: 404, statusText: 'Not Found' }`
- When `getByText` finds multiple elements (e.g. "Q&A" appears as both a tab and a feature pill), use `getAllByText(...).length >= 1` or scope with `within(container)`

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
- Fire-and-forget pipeline: call `triggerIngestion()` then `await new Promise(resolve => setImmediate(resolve))` twice to let the async pipeline settle — two ticks are sufficient even when the pipeline includes doc generation
- Final `updateJob` call holds the terminal status — find it with `storage.updateJob.mock.calls[calls.length - 1][1]`
- To test `triggerIngestion` in isolation without running the pipeline: `jest.spyOn(service as any, 'runPipeline').mockResolvedValue(undefined)`
- DocGenerator mock factory: `{ generateDocs: jest.fn().mockResolvedValue({ totalTokensUsed: N }) }` — pass as 7th constructor arg; `stalenessService` (6th) can be `undefined` to use the default
- Doc generation failure is non-fatal: mock `generateDocs` to reject, assert final `updateJob` status is `'completed'` and `tokensConsumed` is `0`

## RetryingLLMClient Test Patterns
- Back-off `sleep()` is a private `setTimeout`-based promise — bypass by `jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; })` in `beforeEach`. Restore with `setTimeoutSpy.mockRestore()` in `afterEach`. This avoids the complexity of `jest.useFakeTimers()` + async timer advancement.
- `jest.useFakeTimers()` + `jest.runAllTimers()` does NOT work for this pattern: the timers are scheduled AFTER the async `await complete()` call reaches the sleep, which happens on a later microtask tick. Mock setTimeout directly instead.
- "started guard" test: use a generator that yields one token then throws a 429; assert inner.stream was called exactly once (no retry) and the caught token was received before the error.
- Pre-token retry test: first mock returns a generator that throws immediately; second returns a successful generator. Assert inner.stream called twice and all tokens from second generator are collected.
- SSE router tests that inject `qnaService` are placed in a separate file (`router.sse.test.ts` next to `router.test.ts`) to keep SSE-specific HTTP helpers (chunked response collection) isolated from the main router tests.

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

## DiagramModule Unit Test Patterns
- LLM mock: `{ complete: jest.fn().mockResolvedValue(str), stream: jest.fn() } as unknown as jest.Mocked<LLMClient>`
- Valid mermaid starters for `extractMermaid`: `flowchart TD`, `graph TD`, `graph LR` — always use one of these in LLM mock return values
- LLM call verification: `(llm.complete as jest.Mock).mock.calls[0]` gives `[systemPrompt, userPrompt, opts]`
- Null-return pattern: always test (a) no llmClient, (b) too few items, (c) LLM returns non-mermaid text
- Pure-AST modules: `triggersOn.toHaveLength(0)` for always-on, signal-gated modules list specific signals
- nodeMap verification: `Object.values(result.nodeMap!)` should contain actual file paths from the fixture
- `makeMockLLM(returnValue)` factory pattern keeps tests DRY when most tests need a valid LLM mock

## JSDOM Missing APIs — Required Stubs
- `scrollIntoView` is NOT implemented in JSDOM — add `beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); })` to any test file that renders components with scroll-to effects (e.g. QnA message list scroll-to-bottom)
- MUI v4 `Box component="a"` with anchor props (`href`, `target`, `rel`) causes TS2322 in strict mode — fix with spread cast: `{...({ href, target: '_blank', rel: '...' } as any)}`

## React Component Unit Test Patterns (@material-ui/core v4 + @testing-library/react)
- Wrap all renders in `<ThemeProvider theme={createTheme()}>` — `makeStyles` requires a MUI theme context
- Use `createTheme` (not the deprecated `createMuiTheme`) from `@material-ui/core/styles`
- Mock dynamic imports with `jest.mock('module-name', factory)` declared BEFORE component import
- Browser globals (`navigator.clipboard`, `XMLSerializer`, `URL.createObjectURL/revokeObjectURL`) must be mocked via `Object.defineProperty` or `(global as any).Foo = ...`
- Use `waitFor(() => expect(document.querySelector('svg')).toBeInTheDocument())` to wait for async effects (e.g. mermaid render) to complete before asserting
- Tooltip-wrapped buttons are found by `screen.getByTitle('Tooltip text')` — MUI v4 Tooltip renders the title as the accessible label
- For nodes injected via `innerHTML` (e.g. SVG content), use `document.querySelector('.node')` not `screen.getBy*` — React Testing Library only queries within React's render root
- Module-level mutable state (like `mermaidInitialized` flag) resets naturally across test files but NOT across tests within a file — design tests to be order-independent by controlling mock behavior per-test
- `buildSvgWithNodes(labels)` helper pattern: construct SVG string with `.node` > `.label` > `text` structure to match Mermaid's DOM output
- Pass mermaid source as a JS variable, never as a JSX string literal with `\n` — JSX template strings interpret escape sequences differently than JS strings

## PgVectorStore / Knex Query-Builder Mock Pattern
- Adapter packages that have no test infrastructure yet need `jest.config.ts` + devDependencies (`@types/jest`, `jest`, `ts-jest`) + `"test": "jest"` script added to `package.json`
- Copy `jest.config.ts` from `packages/core/chunking/jest.config.ts` — only change is the `root` path relative to `__dirname`
- Knex mock factory for `PgVectorStore`: use a `makeKnex()` that returns a `tableResult` (has `where`, `insert`), `whereResult` (returned by `where()`), and `whereInResult` (returned by `whereIn()`). For `listChunks`, `whereResult.select` resolves directly with DB rows.
- For `search()` tests, override `whereResult.select` to be chainable (`mockReturnValue(whereResult)`), then build `orderByRawResult = { limit, whereIn, whereRaw }` where `whereIn`/`whereRaw` return a `filterResult = { limit }`. The actual chain is: `.where().select().orderByRaw()[.whereIn(...)][.whereRaw(...)].limit(topK)` — `limit` is always last.
- `makeSearchKnex(resolvedRows)` factory returns `{ knex, tableResult, whereResult, orderByRawResult, filterResult }`. Assertions for `whereIn`/`whereRaw` filter calls go against `orderByRawResult`; for limit call in base case use `orderByRawResult.limit`; for limit in filter cases use `filterResult.limit`.
- Linter (ESLint + Prettier) in this project aggressively rewrites diffs on save — if an Edit fails with "file modified since read", always re-read before editing again.

## Project Structure (test-relevant)
- `packages/backstage/plugin-backend/` — backend plugin, uses `@backstage/*` (OK here)
- `packages/backstage/plugin/` — frontend plugin, uses `@backstage/*` (OK here)
- `packages/core/` — ZERO `@backstage/*` imports (enforced)
- `packages/adapters/` — ZERO `@backstage/*` imports (enforced)

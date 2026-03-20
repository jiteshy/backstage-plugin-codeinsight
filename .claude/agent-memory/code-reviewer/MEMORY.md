# Code Reviewer Agent Memory

## Project State (as of 2026-03-19)
- Phase 1.0 (scaffold), 1.1 (types), 1.2 (plugin scaffold) implemented
- Phase 1.3 (DB migrations) implemented, reviewed — 3 fixes required before merge (see Known Issues)
- Phase 1.4 (storage adapter) implemented (KnexStorageAdapter)
- Phase 1.6 (file filter) implemented and reviewed — 2 bugs require fixing before 1.7 CIG builder
- Phase 1.7.1 (CIG builder scaffold) implemented and reviewed — 3 major bugs require fixing
- Phase 1.7.2 (TypeScript symbol extraction) implemented and reviewed — 3 issues (1 major, 1 minor, 1 suggestion); 38 tests passing; all 1.7.1 bugs were FIXED before this phase
- Phase 1.7.3 (import/export edge extraction) implemented and reviewed — 2 major bugs, 4 minor issues, 3 suggestions; 16 new edge tests; see Known Issues below
- Phase 1.7.5 (framework signal detection) implemented and reviewed — 0 critical, 2 major, 4 minor, 3 suggestions; see Known Issues below
- Phase 1.7.6 (Express route extraction) implemented and reviewed — 0 critical, 3 major, 4 minor, 3 suggestions; see Known Issues below
- Phase 1.7.7 (PrismaExtractor / ContentExtractor) implemented and reviewed — 0 critical, 5 major, 4 minor, 3 suggestions; see Known Issues below
- Phase 1.7.8 (CIGPersistenceService) implemented and reviewed — 0 critical, 2 major, 3 minor, 2 suggestions; see Known Issues below
- packages/adapters/storage/ exists with knex.ts factory, 7 migrations, knexfile.ts
- packages/core/ingestion/ exists with FileFilter.ts (184 tests passing)
- packages/core/cig/ exists with CIGBuilder.ts, types.ts, index.ts, CIGBuilder.test.ts, extractors/TypeScriptExtractor.ts, extractors/PrismaExtractor.ts

## Verified Patterns
- `@codeinsight/types` barrel export uses `export type` throughout (zero runtime)
- Backend plugin uses new backend system (`createBackendPlugin` + `coreServices`)
- Frontend plugin uses `createPlugin` + `createApiFactory` + `createRoutableExtension`
- `.npmrc` has `shamefully-hoist=true` (required for Backstage)
- Root tsconfig: `strict: true`, `composite: true`, `module: commonjs`

## Known Issues Found in Phase 1.3 Review
- `createKnex` in src/knex.ts has `directory: '../migrations'` — WRONG: relative path resolves against cwd, not package root. Remove migrations block from runtime factory entirely.
- `ts-node` missing from devDependencies in storage/package.json — db:migrate scripts will fail in clean checkout (works now only via shamefully-hoist from Backstage packages)
- `ci_cig_edges` has `repo_id` column with no FK to ci_repositories and no index — add both
- `db:reset` script at root does not run db:migrate after recreating container — leaves schema empty

## Known Issues Found in Phase 1.0-1.2 Review (carried forward)
- `StorageAdapter.updateRepoStatus` uses `string` not `RepoStatus` type — FIXED (now typed correctly)
- `Logger` interface lacks `debug` level — FIXED (debug added)
- `VectorChunk`/`VectorFilter` missing `tenantId` — RESOLVED: tenantId removed project-wide (see Architectural Decisions)
- `JobQueue.getStatus` missing `tenantId` — RESOLVED: same reason
- Frontend plugin has `react` in both deps and peerDeps (should be peerDeps only) — still open
- jest moduleNameMapper maps all `@codeinsight/*` to `core/` (will break for adapters) — still open
- Health endpoint logs at info level (noisy) — FIXED (now debug)

## Known Issues Found in Phase 1.6 Review
- FileFilter.ts line 430: CI pattern `dir.includes(pattern.dir)` is a substring match — causes false positives (e.g. `src/my-.gitlab-theme/colors.ts` → 'ci'). Multi-segment patterns like `.github/workflows` only work by accident via this fallback. Fix: use `filePath.startsWith(pattern.dir + '/')` for multi-segment dirs.
- FileFilter.ts line 483: Root YAML/JSON heuristic uses `!dir.includes('/')` — wrong. `dirname('config/foo.yml')` returns `'config'` with no `/`, so single-level subdirectory files are also caught. Fix: `dir === '.' || dir === ''`.
- FileFilter package.json: Missing `test` script and `jest`/`ts-jest`/`@types/jest` in devDependencies. Tests only run via root jest config currently.
- FileFilter.ts line 38: `.DS_Store` appears in both DEFAULT_EXCLUDED_DIRS and EXCLUDED_FILENAMES — remove from dirs set.
- EXTENSION_TO_LANGUAGE declared after FileFilter class but referenced inside it — breaks reading flow; move above class.
- SCHEMA_DIR_PATTERNS too narrow (`migrations`, `migrate` only) — `db/init.sql` returns 'source'. Add `schema`, `schemas`, `db`, `database`.

## Known Issues Found in Phase 1.7.1 Review — FIXED STATUS
- CIGBuilder.ts pass 2 re-parses every file from scratch — FIXED: treeCache Map added in 1.7.2
- tsconfig.json `exclude` loses root's `**/*.test.ts` — FIXED: test exclusion added
- GRAMMAR_REGISTRY missing `tsx` entry — FIXED: tsx entry added
- jest.config.ts missing moduleNameMapper — WORKS: pnpm workspace symlinks resolve without it
- `filesSkipped` counter conflates "no extractor" and "parse error/oversized" — still open
- No test for two-pass edge extraction path — FIXED: CIGBuilder.test.ts now has this test

## Known Issues Found in Phase 1.7.2 Review
- TypeScriptExtractor.ts line 50-59: `isDefault` variable is computed but its guard (line 59) is dead code — the loop on line 53-56 always `return`s before reaching it. The `if (isDefault...)` branch is unreachable; remove it.
- TypeScriptExtractor.ts line 300: nodeId `${repoId}:${file.filePath}:${symbolName}:${symbolType}` collides for getter+setter pairs (same class, same property name "port", same symbolType "function"). For 1.7.3+ consider appending startLine as disambiguator.
- extractors/TypeScriptExtractor.test.ts: No test for `export default SomeClass` (re-export of a class variable, not inline class_declaration) — edge case skipped.
- jest.config.ts: `maxWorkers: 1` added to fix native module conflicts — correct and documented.

## Known Issues Found in Phase 1.7.3 Review
- TypeScriptExtractor.ts line 485 (MAJOR): `isRelativeImport` returns true for absolute paths (startsWith '/'). Should be `startsWith('./')` or `startsWith('../')` only. Currently a silent no-op since absolute imports never appear in nodesByFile, but semantically wrong.
- CIGBuilder.ts lines 115-118 (MAJOR): module node endLine uses `reduce(max endLine of symbols, 1)` — returns 1 for files with zero symbols. Fix: use `tree.rootNode.endPosition.row + 1` from the treeCache entry.
- TypeScriptExtractor.ts line 49 + 5 other sites (MINOR): `<module>:variable` sentinel string duplicated 6x across TypeScriptExtractor.ts and CIGBuilder.ts. Extract a private static helper.
- CIGBuilder.ts line 113 (MINOR/suggestion): `if (!nodesByFile.has(filePath)) continue` guard in module-node loop is dead code — treeCache and nodesByFile always have identical keys.
- TypeScriptExtractor.ts line 493 (SUGGESTION/perf): `new Set(allFilePaths)` rebuilt on every `resolveImportPath` call. Should build Set once in `extractEdges` and pass as `ReadonlySet<string>`. Matters at 10k+ file repos.
- TypeScriptExtractor.test.ts line 562-564 (MINOR): `findEdge` helper uses `includes()` substring matching — can produce false positives as test suite grows. Use exact `toNodeId` match.
- Missing test: `export * as ns from './x'` (namespace re-export) not tested; falls into wildcard branch silently.

## Known Issues Found in Phase 1.7.5 Review
- FrameworkSignalDetector.ts: `PackageJson` is exported from the class file but not re-exported from index.ts — callers who pass pre-parsed objects need the type. Add `export type { PackageJson }` to index.ts.
- FrameworkSignalDetector.ts: `SignalRule.prefix` field is declared but never read — dead code. Either implement prefix matching or remove the field.
- FrameworkSignalDetector.ts: Multi-file merge gives last-writer-wins for same package across files. For a monorepo scanning root + sub-packages this is correct, but the comment says "primary meta from first valid" — yet deps from later files silently overwrite earlier ones. This inconsistency is a minor correctness concern and should be documented.
- FrameworkSignalDetector.ts: `tsc` in BUILD_TOOL_RULES is not an npm package name — it is a binary. No project lists `tsc` as a dependency; `typescript` is the package. The rule never fires. Replace with `typescript` (or remove if covered elsewhere).
- FrameworkSignalDetector.ts: `nestjs` bare package name in FRAMEWORK_RULES will never match real projects — NestJS users install `@nestjs/core` and `@nestjs/common`, never a bare `nestjs` package. Remove the dead entry.
- FrameworkSignalDetector.test.ts: No test covering the `prefix` field behavior (since it is unimplemented). If the field is removed, no test update is needed; if implemented, a test is required.
- FrameworkSignalDetector.test.ts: The multi-file merge test does not assert that a same-named dep across two files is deduplicated — only that both frameworks appear. Add an explicit dedup-across-files test.

## Known Issues Found in Phase 1.7.7 Review (PrismaExtractor / ContentExtractor)
- PrismaExtractor.ts line 104 (MAJOR): `edgeType: 'extends'` is semantically wrong for Prisma model relations. 'extends' means class inheritance. Prisma relations are field-level references. Fix: add `'references'` to `EdgeType` union in data.ts and use it here.
- PrismaExtractor.ts line 49 (MAJOR): `RELATION_RE = /@relation\(([^)]*)\)/` — stops at first `)`. Fragile for any nested parens inside @relation body. Acceptable for v1 but needs a comment documenting the limitation.
- PrismaExtractor.ts lines 92-115 (MAJOR): edgeId format `fromNodeId->extends->toNodeId` omits field name. Two fields on the same model pointing to the same target type produce duplicate edgeIds. Fix: include field name in edgeId.
- PrismaExtractor.ts line 164 (MAJOR): Inline comments (`// remark`) on field lines are not stripped before attribute regex matching. A field comment like `// @unique` produces a false-positive `isUnique: true`. Fix: `(attrs ?? '').replace(/\/\/.*$/, '').trim()` before attribute tests.
- PrismaExtractor.ts line 51 (MINOR): `RELATION_NAME_RE` optional `name:` prefix means it can match a `map: "..."` string as the relation name in @relation bodies without positional name. Fix: require `name:` explicitly or match only first quoted string.
- CIGBuilder.ts lines 171-172 (MINOR): Content-file module node endLine uses `reduce(max endLine, 1)` — returns 1 for files with only datasource/generator blocks (zero extractable nodes). Fix: use `content.split('\n').length` as fallback; content is available in contentFiles map.
- PrismaExtractor.test.ts line 463 (MINOR): self-referential edge assertion is `toBeGreaterThanOrEqual(1)` — should be `toBe(2)` since both Category.parent and Category.children have @relation names and should both emit edges.

## Known Issues Found in Phase 1.7.8 Review (CIGPersistenceService)
- CIGPersistenceService.ts line 66 (MAJOR): delta mode calls `upsertCIGEdges(result.edges)` where `result.edges` is the full edge set from the caller. The service makes an undocumented invariant that callers only pass edges for changed files in delta mode. If a caller passes the full graph's edges, stale-edge cleanup is bypassed for unchanged files. Fix: add explicit JSDoc invariant, or add a debug-time guard that warns when an edge's source node is from a non-changed file.
- CIGPersistenceService.ts lines 74-77 (MAJOR): return fields are named `nodesUpserted`/`edgesUpserted` but `StorageAdapter.upsertCIGNodes/upsertCIGEdges` both return `void` — the actual count written to DB is unknown. These are "attempted" counts. Rename to `nodesAttempted`/`edgesAttempted` (or `nodesSubmitted`/`edgesSubmitted`).
- CIGPersistenceService.ts line 43 (MINOR): `isDelta` inferred as `string[] | boolean | undefined` not `boolean`. Use `(opts?.changedFiles?.length ?? 0) > 0` for a clean boolean.
- CIGPersistenceService.ts lines 47-51 (MINOR): four `!` non-null assertions after `isDelta` boolean guard. TypeScript cannot narrow through the intermediate variable. Extract `changedFiles` to a local variable and use `if (isDelta && changedFiles)` to eliminate all assertions.
- CIGPersistenceService.test.ts mock (MINOR): non-critical StorageAdapter methods use bare `jest.fn()` while CIG methods use `.mockResolvedValue(undefined)` — inconsistent. Standardize all void-returning methods to `.mockResolvedValue(undefined)`.

## Known Issues Found in Phase 1.7.6 Review
- TypeScriptExtractor.ts line 692-694 (MAJOR): `template_string` stripping with `.slice(1,-1)` is wrong — backtick template literals have different quoting. The `` ` `` is stripped but embedded expressions (`${...}`) are kept verbatim. For route paths like `` `/api/${version}/users` `` the stored path will be `/api/${version}/users` which is useful, but the slice logic is identical to the string branch and only happens to work for simple cases without embedded expressions. This is not outright broken for static paths but is a latent bug for any template literal with interpolation. Rename the branch to be explicit, or skip template strings entirely in v1.
- TypeScriptExtractor.ts line 638 (MAJOR): nodeId format `${repoId}:${filePath}:${symbolName}:route` includes spaces (e.g. `GET /users`) — the `symbolName` is `"GET /users"`. The `makeNode` helper uses the same pattern but for symbol names that never contain spaces. Route nodeIds will contain spaces, which is unusual and may cause issues in downstream SQL WHERE clauses or URL encodings if nodeId is ever surfaced. Not a current crash risk, but inconsistent with every other nodeId in the system.
- TypeScriptExtractor.ts lines 562-566 (MAJOR): `ROUTER_OBJECTS` includes `'route'` as a recognized object name — `'route'` is also the string value of the `SymbolType` for route nodes. This is not a code collision (different domains) but the identifier `route` as a variable name in user code rarely holds a router (it usually holds the result of `router.route('/path')`). Including it causes false positives on chains like `const route = someLib.route('/x'); route.get(handler)`, which is the chained Express pattern and would be doubly extracted (once for `route.get` on the inner call and once for the outer). This should be removed or validated more carefully.
- TypeScriptExtractor.ts line 688 (MINOR): The `isUse` parameter is derived from `methodName === 'use'` in the caller but is passed separately — there is no case where `isUse` is true and `methodName !== 'use'`. Remove `isUse` parameter and compute `const isUse = methodName === 'use'` inside `extractRouteInfo`.
- TypeScriptExtractor.ts line 703 (MINOR): `httpMethod = isUse ? 'USE' : methodName` — `methodName` is already lowercase (e.g. `'get'`). The caller uppercases it via `httpMethod.toUpperCase()` later (line 628). The asymmetry (USE vs get) is inconsistent — both should be returned as-is and uppercased once at the call site, or both returned uppercase. Currently works correctly due to the `.toUpperCase()` at line 628, but is confusing.
- TypeScriptExtractor.test.ts: No test for `app.route('/path').get(handler)` chained Express syntax — `extractObjectName` has explicit chaining support (lines 662-668) but it is completely untested.
- TypeScriptExtractor.test.ts: No test for duplicate nodeId when the same route path+method appears twice in a file (e.g. two `router.get('/health', h1)` declarations) — the CIG will silently contain both nodes with identical nodeIds.
- TypeScriptExtractor.test.ts: No test for template literal route paths (`` router.get(`/api/${version}`, h) ``).

## Patterns in core/cig Package
- Two-pass build: pass 1 extracts symbols (builds nodesByFile map), pass 2 extracts edges (uses full nodesByFile for cross-file resolution).
- Module-node creation happens BETWEEN pass 1 and pass 2 — CIGBuilder adds `<module>:variable` sentinel nodes for each successfully processed file after pass 1. These nodes are the anchor for import edges.
- Module nodeId format: `${repoId}:${filePath}:<module>:variable` — used in both CIGBuilder.ts and TypeScriptExtractor.ts. Must stay in sync.
- LanguageExtractor interface: `readonly languages: string[]`, `extractSymbols(tree, file, repoId)`, `extractEdges(tree, file, repoId, nodesByFile)`. One extractor can cover multiple languages.
- ContentExtractor interface (added 1.7.7): same shape as LanguageExtractor but receives raw `content: string` instead of `Parser.Tree`. Used for regex-based extractors (Prisma, GraphQL) without Tree-sitter grammars.
- ContentExtractor files tracked in `contentFiles` Map (parallel to `treeCache` for TS/JS files). Module nodes created for both types between pass 1 and pass 2.
- parseBlocks() is called TWICE in PrismaExtractor (once for extractSymbols, once for extractEdges). This is a known inefficiency — caching the parsed blocks would require instance-level state keyed by content.
- Parser instances are cached per language (`this.parsers` map) — grammars loaded lazily on first use.
- GRAMMAR_REGISTRY is separate from extractor dispatch map — adding a new language needs both a registry entry AND a registerExtractor() call.
- `Required<CIGBuilderConfig>` used as internal config type to eliminate nullability downstream.
- Buffer.byteLength(content, 'utf8') for size checking (correct; content.length would be wrong for multi-byte chars).
- Import path resolution order: exact match → +.ts → +.tsx → +.js → +.jsx → index.ts → index.tsx → index.js → index.jsx.
- Only relative imports (`./` or `../`) produce edges — bare/external specifiers are skipped. Absolute paths (`/`) should also be skipped (currently a bug).
- Type-only imports (`import type { Foo } from './x'`) are handled transparently by the same extractImportEdges path — no special-casing needed in Tree-sitter TS grammar.
- Default imports and namespace imports (`import * as ns`) both resolve to the target module node (not a symbol node), since the specific exported symbol cannot be statically determined without further analysis.
- Named re-exports (`export { Foo } from './x'`) resolve to the original symbol's nodeId in the target file where possible, falling back to the module node if the symbol is not in nodesByFile (e.g. re-exported type, or re-export of a re-export).

## Patterns in core/ingestion Package
- Uses ReadonlySet<string> for all lookup tables — good pattern to carry forward
- path.split('/') for segment extraction — should use path.sep or /[\\/]/ for cross-platform safety
- Classification priority: CI > test > schema > infra > config > source (correct ordering)
- isHeaderGenerated takes pre-read string (not file path) — pure, no I/O, correct
- FileFilter constructor merges user config additively over defaults (not replacing) — correct

## Conventions Observed
- camelCase TS fields mapping to snake_case DB columns
- Optional/nullable fields typed as `fieldName?: T | null`
- Interfaces do NOT use tenantId (single-tenant by design, post 2026-03-08 change)
- Data interfaces mirror DB tables 1:1; all tables scoped by repoId only
- Config types in separate `config.ts`, interfaces in `interfaces.ts`, data in `data.ts`

## Architectural Decisions (Confirmed)
- SINGLE-TENANT: No tenant_id in any DB table or TS interface. One Postgres per deployment.
  Rationale: both Backstage plugin and standalone SaaS are self-hosted. Infrastructure isolation is sufficient.
  Decision date: 2026-03-08. All 8 data interfaces, StorageAdapter, VectorChunk, VectorFilter, Job, JobQueue updated.
- RepoFile has no surrogate PK in the TS interface — composite key is (repoId, filePath) at DB level

## Known Issues Found in Phase 1.7.9 Review (CIG integration test)
- cig-builder.integration.test.ts line 33 (MAJOR): `return` instead of `continue` in walk() — exits the entire walk function when a skipped directory is encountered. If node_modules or .git exists in fixture root, all siblings sort-after are silently skipped.
- cig-builder.integration.test.ts line 124 (MAJOR): `toBe(tsFiles.length + prismaFiles.length)` is exact equality — breaks when a new language extractor is added. Change to `toBeGreaterThanOrEqual`.
- cig-builder.integration.test.ts lines 223-227 (MAJOR): `?.exported` via optional chaining on potentially-undefined nodes — if node is not found, `undefined` is compared with `toBe(false)` which fails but confusingly. Add `.toBeDefined()` guard first.
- cig-builder.integration.test.ts lines 385-388 (MAJOR): `includes('Post:schema')` substring matching on nodeIds — can produce false positives as schema grows. Use exact nodeId strings.
- No test for `extends` edges (UserService/PostService → BaseService) — significant acceptance criteria gap.
- No test for `app.use()` route nodes (USE /api/users, USE /api/posts from index.ts).

## Integration Test Patterns Observed
- `beforeAll` used to run CIG build once, shared across all `it` blocks via closure — correct for slow native-module operations
- `nodesByType(result, type)` helper filters out `<module>` sentinel nodes — correct
- `FrameworkSignalDetector` and `EntryPointDetector` instantiated independently from CIGBuilder in integration tests — correct (pure functions over data)
- Fixture file walker uses `FileFilter` for language detection and exclusion — couples integration test to FileFilter correctness

## Known Issues Found in Phase 2.6 Review (StalenessService / KnexStorageAdapter / IngestionService)
- IngestionService.ts line 213 (MAJOR): Full-run sweep passes `filteredFiles.map(f => f.filePath)` — all repo files — instead of `changedFiles` on threshold-triggered full runs. Fix: use `changedFiles ?? filteredFiles.map(...)` to avoid marking every artifact stale on a 40%-threshold upgrade.
- Migration 005 (MAJOR): `ci_artifact_dependencies` has no index on `(repo_id, dependency_id)`. `getArtifactDependents` queries this column — every cascade hop is a sequential scan. Add `009_artifact_deps_index.ts` migration.
- StalenessService.ts line 27 (MINOR): Empty-changedFiles no-op logs at `info` level — should be `debug` (same pattern as health endpoint fix in Phase 1.2).
- StalenessService.test.ts header comment (MINOR): Lists "test 9 — batching" but no such test exists. Comment is inaccurate; remove or add the test.
- IngestionService.test.ts: No test verifies StalenessService.sweep is called with correct arguments after full run or delta run; the sweep integration path is untested at unit level (integration tests may cover it, but unit tests use a real StalenessService with the mock storage, so sweep calls are not directly asserted).
- StalenessService.test.ts test 9 comment mismatch: header says test 9 is "batching" but the actual test 9 is "logger called with appropriate messages". This is a documentation mismatch only — no behaviour is missing.

## Known Issues Found in Phase 2 Gap Fix Review (IngestionService wiring + plugin.ts)
- plugin.ts: `docGen.*` config keys (maxConcurrency, maxOutputTokens, temperature) are read but NOT declared in config.d.ts — Backstage schema validation will fail silently; add docGen block to config.d.ts.
- plugin.ts line 109: `docGenConfig` object is always constructed (unconditionally), even when `llmClient` is undefined. Minor waste; harmless since it's only passed to DocGenerationService when llmClient exists.
- IngestionService.ts: `DocGenerator` duck-type interface returns `Promise<{ totalTokensUsed: number }>` — correctly structural match to `DocGenerationResult`. This is intentional to avoid a hard dep on @codeinsight/doc-generator from core/ingestion.
- IngestionService.ts: doc generation runs AFTER staleness sweep and BEFORE finally block (cloneDir cleanup) — correct placement.
- IngestionService.ts: `tokensConsumed` initialized to 0 and stays 0 if docGenerator is absent or throws — correctly reflected in job record.
- CLAUDE.md says "No tenant_id in DB tables" (corrected from earlier memory which said the opposite about the original review findings — that was the pre-2026-03-08 state).

## Known Issues Found in Phase 2.5 Review (DocGenerationService / ContextBuilder / PromptRegistry)
- ContextBuilder.ts line 734: `path.join(cloneDir, filePath)` with no path traversal guard — filePaths come from DB/git so risk is low but `../` in a filePath escapes cloneDir silently.
- DocGenerationService.ts line 56: `PromptRegistry` instantiated twice (once in DocGenerationService, once in ContextBuilder) — wasted allocation; no registry state but inconsistent.
- DocGenerationService.ts line 237: `storageAdapter.getArtifact(moduleId, repoId)` — parameter order is `(artifactId, repoId)`. This is correct per interface definition at interfaces.ts line 107. No bug.
- ContextBuilder.ts buildDeploymentVars() lines 360-369: Reads package.json for buildScripts but does NOT push to `inputFiles` — the artifact's inputSha won't change when package.json scripts change. Minor correctness issue.
- DocGenerationService.ts line 270: `promptVersion: null` — prompts are currently hardcoded strings in PromptRegistry (not versioned from files). TODO note is present. This is a known gap from build plan, not a review finding.
- PromptRegistry.ts: All 13 system prompts and user prompt builders are inline strings — contradicts phase 2.3/2.4 plan which specified `prompts/*.md` files. Build plan notes accept this deviation.
- ContextBuilder.ts buildTestingVars(): `configFileName` and `testConfigContent` written but prompt template uses `configFileName` only for display — if testConfig exists but is unreadable, the section is omitted silently without warning.
- DocGenerationService.ts buildClassifierInput() line 304: `packageJsonContents: []` — always empty. ClassifierService will classify using file paths only. Real package.json content not passed even though it's available in the cloneDir. Classifier quality degraded for large repos.
- DocGenerationService.ts: `generateDocs()` calls `buildClassifierInput()` which passes empty `packageJsonContents`; `generateDocsWithClassification()` is the recommended path that avoids this.
- DocGenerationService.test.ts: Mock `getArtifact` at line 144 ignores `repoId` parameter — only keys on `artifactId`. Acceptable for test simplicity.
- ContextBuilder.ts: `readFile()` private method is defined but never called externally — only `readFileSafe()` is used. `readFile()` is an implementation detail that could be inlined.
- CIGPersistenceService.test.ts: Updated mock adds all Phase 2.5 StorageAdapter methods — good maintenance.

## File Structure Reference
- Types: `packages/core/types/src/{data,interfaces,config,index}.ts`
- Backend plugin: `packages/backstage/plugin-backend/src/{plugin,router,index}.ts`
- Frontend plugin: `packages/backstage/plugin/src/{plugin,api,api-client,routes,index}.ts`
- Dev app: `dev/{backend,app}/src/`
- Config schema: `packages/backstage/plugin-backend/config.d.ts`
- Storage adapter: `packages/adapters/storage/src/{knex,index}.ts`, migrations in `packages/adapters/storage/migrations/`
- Migration CLI: knexfile.ts at package root, run via `NODE_OPTIONS='--require ts-node/register' knex`
- Migration table name: `ci_knex_migrations` (scoped prefix avoids collision)
- Diagram-gen package: `packages/core/diagram-gen/src/{types,utils,DiagramRegistry,DiagramGenerationService,index}.ts`, modules under `diagrams/{universal,frontend,backend}/`

## Known Issues Found in Phase 3 Review (Diagram Generation)
- config.d.ts MISSING diagramGen block: plugin.ts reads `codeinsight.diagramGen.{maxConcurrency,maxOutputTokens,temperature}` but none of these keys are declared in config.d.ts. Backstage schema validation silently rejects them. Fix: add a `diagramGen?` block to config.d.ts.
- ComponentHierarchyModule.ts lines 46-47: non-null assertions `!` used after a `.filter()` loop that already guards for undefined on lines 34-35. The second `cig.nodes.find()` call on the collapsed-edges loop is theoretically safe (edges that passed the filter must have valid node IDs), but the assertions are fragile — if the filter is ever changed or re-ordered, these become runtime crashes. Explicit check or factored-out map lookup is safer.
- mermaidInitialized module-level flag in EntityCodeInsightContent.tsx: module-scope variable — correct for a CSR SPA, but if the Backstage app ever runs in SSR context the flag persists across requests (shared state). Acceptable risk for current Backstage v1 usage, but worth noting.
- DiagramGenerationService: inputSha computed over ALL CIG nodes+edges uniformly per module, regardless of which CIG fields the module actually `requires`. Modules that only read `nodes` (not edges) are invalidated when edges-only change. This is a minor over-invalidation, not a correctness bug.
- IngestionService.ts: diagramGenerator.generateDiagrams(repoId) called without passing detectedSignals. LLM modules triggered by signals (orm:prisma, framework:react, etc.) will never fire in production. detectedSignals from ClassifierService must be threaded through.
- diagramGen config block missing from config.d.ts — confirmed critical issue (same pattern as docGen was in Phase 2.5 review).

## Phase 3 Pattern Notes
- DiagramGenerator duck-type interface correctly defined in IngestionService.ts (not importing @codeinsight/diagram-gen directly) — good pattern.
- DiagramGenerationService always instantiated unconditionally (unlike DocGenerationService which is gated on llmClient). This is correct because AST modules work without an LLM.
- LLM modules gracefully skip when llmClient is undefined — checked inside each module's generate() and also at the service level.
- Node/edge lookup in pure-AST modules uses cig.nodes.find() in O(n) loops — acceptable for v1 CIG sizes, but O(n*m) in the worst case.
- mermaid.js rendered via dynamic import() inside useEffect — correct approach for avoiding SSR/bundle issues.
- securityLevel: 'loose' in mermaid initialization — necessary for click events in erDiagram but is a known XSS risk if mermaid content is ever user-supplied rather than generated.

# CodeInsight — Architecture Guide
> For humans new to AI-based development. Explains what we're building, why each decision was made, and how all the pieces connect.

---

## What Is CodeInsight?

CodeInsight is a plugin for **Backstage** — Spotify's open-source developer portal — that makes any code repository in your organization intelligible on demand.

When a developer opens a service in Backstage, they normally see metadata: who owns it, what it links to, maybe a README. CodeInsight adds three new capabilities to that page:

1. **Documentation Tab** — AI-generated documentation for the repo, always derived from the actual current code. No manually maintained wiki pages that go stale.
2. **Diagrams Tab** — Auto-generated architecture diagrams, entity-relationship diagrams, API flow diagrams, dependency graphs — all reflecting the live codebase.
3. **QnA Tab** — A chat interface where you ask questions about the repo and get answers grounded in that specific codebase. Like asking a senior engineer who has read every file.

The plugin connects to GitHub initially (GitLab and Bitbucket are added via the same `RepoConnector` interface in later phases). It works with any language or framework — Phase 1 starts with TypeScript/JavaScript and adds more languages incrementally.

---

## The Core Problem This Solves

Large engineering orgs have hundreds or thousands of services. Documentation is always incomplete, always stale, and often nonexistent. New engineers spend days reading code just to understand how one service works. Even experienced engineers forget the details of services they haven't touched in six months.

CodeInsight makes documentation a derived artifact — generated from code, not maintained separately — and makes the codebase queryable like a database.

---

## Key Concepts to Understand First

If you're new to AI-based development, these concepts appear throughout the architecture. Understanding them upfront will make everything else clear.

### Large Language Models (LLMs)
LLMs (like Claude, GPT-4) are AI models that understand and generate text — including code. You send them a prompt (instructions + context), and they return a response. They have a **context window** — a maximum amount of text they can process in one call. Claude's is ~200,000 tokens (~150,000 words). GPT-4o's is ~128,000 tokens.

This limit matters for large codebases: you can't send 500 files to one LLM call. The architecture is designed around this constraint.

### Tokens
LLMs don't process words — they process tokens. Roughly: 1 token ≈ 0.75 words for prose, ~0.5 words for code (code is denser). A 300-line TypeScript file is typically 2,000–4,000 tokens. LLM providers charge per token, so token efficiency directly affects cost.

### Embeddings
An embedding is a way to convert text (or code) into a list of numbers (a vector) that captures its meaning. Two pieces of text with similar meaning will have vectors that are mathematically close to each other. This is how semantic search works: convert the user's question into a vector, find chunks of code/docs whose vectors are closest, and use those as context for the LLM's answer. This process is called **Retrieval-Augmented Generation (RAG)**.

### RAG (Retrieval-Augmented Generation)
RAG is the pattern used for the QnA feature. Instead of trying to fit an entire codebase into one LLM call:
1. Pre-process the codebase into small, meaningful chunks
2. Convert each chunk into an embedding (vector)
3. When a user asks a question, convert the question into an embedding
4. Find the most relevant chunks by vector similarity
5. Send only those chunks as context to the LLM
6. The LLM answers using that retrieved context

The result: accurate, grounded answers without needing to fit the entire codebase in context.

### AST (Abstract Syntax Tree)
When you parse code, an AST is the structured representation of it — the tree of functions, classes, imports, and expressions. For example, an AST parser can tell you: "this file exports three functions: `loginUser`, `validateCredentials`, `hashPassword`; `loginUser` calls `validateCredentials` and `db.users.findOne`." We use Tree-sitter for this — it supports 40+ languages and runs in Node.js.

### Mermaid
Mermaid is a text-based diagramming language. You write a description of a diagram in plain text, and it renders as a visual diagram. Example:
```
sequenceDiagram
  Client->>API: POST /auth/login
  API->>AuthService: loginUser(email, password)
  AuthService->>DB: findUser(email)
  DB-->>AuthService: user record
  AuthService-->>API: JWT token
  API-->>Client: 200 OK + token
```
Backstage already renders Mermaid natively via TechDocs. All diagrams in CodeInsight are generated as Mermaid syntax.

---

## Package Architecture: Framework-Agnostic Core

CodeInsight is not a monolithic Backstage plugin. It is a set of independent packages where all business logic lives in framework-agnostic `core/` packages with zero Backstage dependencies. Backstage is just one delivery wrapper.

```
packages/
├── core/                           # ZERO @backstage/* imports
│   ├── @codeinsight/types          # Shared types + all I/O interfaces (zero runtime deps)
│   ├── @codeinsight/cig            # CIG builder (Tree-sitter AST)
│   ├── @codeinsight/ingestion      # Job orchestration + file filtering
│   ├── @codeinsight/doc-generator  # Documentation generation service
│   ├── @codeinsight/diagram-gen    # Diagram generation service
│   └── @codeinsight/qna           # RAG pipeline
│
├── adapters/                       # Concrete implementations of core interfaces
│   ├── @codeinsight/llm            # Claude / OpenAI LLMClient impls
│   ├── @codeinsight/embeddings     # OpenAI EmbeddingClient impl
│   ├── @codeinsight/vector-store   # pgvector VectorStore impl
│   ├── @codeinsight/repo           # GitHub RepoConnector impl (GitLab/Bitbucket later)
│   └── @codeinsight/storage        # Knex/Postgres StorageAdapter impl
│
├── backstage/                      # Thin Backstage delivery wrapper
│   ├── @codeinsight/plugin         # Frontend: React tabs
│   └── @codeinsight/plugin-backend # Backend: wires adapters into core services
│
└── standalone/ (future)            # Same core, Express/Fastify wrapper for SaaS
```

**Why this matters:** The `@codeinsight/types` package is the single place where all data types (Repository, CIGNode, Artifact, etc.) and all I/O interfaces (LLMClient, StorageAdapter, RepoConnector, etc.) are defined. Both `core/` and `adapters/` import from `@codeinsight/types` — never from each other. This prevents circular dependencies and means the entire core can be extracted into a standalone SaaS product by swapping only the adapter and wrapper packages.

All services receive their dependencies via constructor injection. No service ever reads `process.env` or Backstage config directly. The Backstage plugin's only job is to read config, instantiate the correct adapters, and inject them into core services.

---

## The Foundation: Code Intelligence Graph (CIG)

Before any of the three features run, a shared foundation is built called the **Code Intelligence Graph**. This is the most important concept in the architecture.

The CIG is built entirely from static analysis — **no LLM calls, no API costs**. It's a structured representation of everything knowable about the repo's code without understanding meaning:

```
What the CIG knows:
├── Every file (path, language, type: source/config/infra/test/schema)
├── Every symbol (functions, classes, interfaces) with line numbers
├── Import/export relationships between files
├── HTTP route definitions (method, path, handler function)
├── Database schema definitions (from Prisma, SQLAlchemy, TypeORM, etc.)
├── Entry points (main.ts, index.ts, app.py, etc.)
└── Framework signals (which ORM, auth library, state management, test framework)
```

**Why this matters:** All three features read from the CIG instead of re-parsing the code. You parse once, share everywhere. And when a file changes, you only re-parse that file's portion of the CIG.

### How the CIG Is Built

```
1. Clone the repository (shallow: --depth 1, gets all files but only latest commit)
2. Filter out noise:
   - node_modules/, vendor/, .git/, dist/, build/
   - Lock files (package-lock.json, yarn.lock, Gemfile.lock)
   - Binary files (images, compiled artifacts)
   - Auto-generated files
3. Run Tree-sitter AST parser on each source file
4. Extract symbols, imports, exports into structured data
5. Parse route files (Express routes, FastAPI decorators, etc.)
6. Parse schema files (Prisma schema, SQLAlchemy models, etc.)
7. Store everything in the database as ci_cig_nodes and ci_cig_edges
```

This takes seconds and costs nothing. Everything downstream is built on this foundation.

---

## CIG Builder: Implementation Architecture

> This section is a technical reference for developers working on the `@codeinsight/cig` package. It describes the actual implementation — the classes, interfaces, data flow, and extension points.

The CIG Builder lives in `packages/core/cig/` and has zero framework dependencies. Its only imports are `@codeinsight/types` (shared data types and interfaces) and Tree-sitter (AST parsing). Everything in this package runs synchronously on a set of in-memory file contents — no I/O, no database access, no LLM calls.

### Two-Pass Extraction

The `CIGBuilder` class is the entry point. It takes a list of files (each with a `RepoFile` descriptor and its source content) and produces a `CIGBuildResult` containing all extracted nodes and edges.

Extraction happens in two passes:

```
Pass 1 — Symbol Extraction
  For each file:
    1. Look up the file's language in the extractor registry
    2. Parse the file with Tree-sitter (or pass raw content for ContentExtractors)
    3. Call extractor.extractSymbols() → CIGNode[]
    4. Store nodes in a nodesByFile map (keyed by filePath)
    5. Cache the parsed Tree-sitter tree for reuse in Pass 2
  After all files:
    6. Create a <module> anchor node for each processed file

Pass 2 — Edge Extraction
  For each file:
    1. Retrieve the cached tree (or raw content) and the nodesByFile map
    2. Call extractor.extractEdges(tree, file, repoId, nodesByFile) → CIGEdge[]
    3. Edges reference nodes by their deterministic nodeId
```

The two-pass design is necessary because edge resolution requires knowing all symbols across all files. An import edge from file A to a symbol in file B can only be created after file B's symbols have been extracted in Pass 1.

The `CIGBuildResult` returned by `CIGBuilder.build()`:

```typescript
interface CIGBuildResult {
  nodes: CIGNode[];           // All extracted symbols + module nodes
  edges: CIGEdge[];           // All relationships (imports, references, etc.)
  filesProcessed: number;     // Files that had a registered extractor
  filesSkipped: number;       // Files with no extractor or exceeding size limit
  errors: Array<{ filePath: string; error: string }>;  // Non-fatal extraction errors
}
```

Files that fail extraction are recorded in `errors` but do not abort the build. The CIG is always a best-effort graph — partial results are better than no results.

### LanguageExtractor vs ContentExtractor

Two extractor interfaces exist for different parsing strategies:

**`LanguageExtractor`** — for languages with Tree-sitter grammars. Receives a parsed `Parser.Tree` (AST). The CIGBuilder handles Tree-sitter parser creation, grammar loading, and tree caching. The extractor just walks the AST.

```typescript
interface LanguageExtractor {
  readonly languages: string[];  // e.g. ['typescript', 'tsx', 'javascript']
  extractSymbols(tree: Parser.Tree, file: RepoFile, repoId: string): CIGNode[];
  extractEdges(tree: Parser.Tree, file: RepoFile, repoId: string,
               nodesByFile: Map<string, CIGNode[]>): CIGEdge[];
}
```

**`ContentExtractor`** — for languages without Tree-sitter grammars but with parseable syntax (Prisma, GraphQL, etc.). Receives raw file content as a string. The extractor is responsible for its own parsing (regex, line-by-line, etc.).

```typescript
interface ContentExtractor {
  readonly languages: string[];  // e.g. ['prisma']
  extractSymbols(content: string, file: RepoFile, repoId: string): CIGNode[];
  extractEdges(content: string, file: RepoFile, repoId: string,
               nodesByFile: Map<string, CIGNode[]>): CIGEdge[];
}
```

**When to use which:** If a Tree-sitter grammar exists for the language and handles the constructs you need, use `LanguageExtractor`. If the language has simple, regular syntax (like Prisma's `model Name { ... }` blocks), `ContentExtractor` with regex is simpler and avoids a native dependency.

Registration:
```typescript
const builder = new CIGBuilder();
builder.registerExtractor(new TypeScriptExtractor());      // LanguageExtractor
builder.registerContentExtractor(new PrismaExtractor());   // ContentExtractor
```

The grammar registry inside CIGBuilder maps language strings to Tree-sitter grammar loaders. Currently registered: `typescript`, `tsx`, `javascript`.

### TypeScriptExtractor

The `TypeScriptExtractor` handles TypeScript, TSX, and JavaScript files. It is the most complex extractor and covers three extraction domains.

**Symbol extraction** (Pass 1): Recursively walks the AST looking for declaration nodes:

| AST Node Type | CIG SymbolType | Notes |
|---|---|---|
| `function_declaration`, `generator_function_declaration` | `function` | Named functions at any scope |
| `class_declaration`, `abstract_class_declaration` | `class` | Class name; methods extracted separately |
| `method_definition` | `function` | Symbol name: `ClassName.methodName` |
| `interface_declaration` | `interface` | |
| `type_alias_declaration` | `type` | |
| `enum_declaration` | `enum` | |
| `lexical_declaration` / `variable_declaration` with arrow function value | `function` | `const foo = () => {}` treated as function |
| `call_expression` matching route patterns | `route` | See route extraction below |

The walker handles nested scopes: functions inside functions, arrow functions inside arrow functions, functions inside `if`/`for`/`while` blocks. Class methods include get/set accessor disambiguation (`methodName:get`, `methodName:set`) to avoid nodeId collisions.

Export detection: `export_statement` nodes are unwrapped and their children marked as `exported: true`.

**Route extraction** (also Pass 1): After symbol walking, a separate walk finds Express-style route definitions by matching `call_expression` nodes where:
- The function is a `member_expression` (e.g., `router.get`)
- The object name is in `ROUTER_OBJECTS` (`app`, `router`, `server`)
- The property name is a known HTTP method (`get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `all`) or `use`
- The first argument is a string literal (the route path)

This also handles chained routes: `router.route('/path').get(handler).post(handler)`.

Route nodes use `symbolType: 'route'` and store `httpMethod`, `routePath`, and `handler` in their metadata. The nodeId uses `#` as the method/path separator to avoid spaces: `repoId:filePath:GET#/api/users:route`.

**Edge extraction** (Pass 2): Walks the AST for `import_statement` and `export_statement` (re-exports) nodes. For each:
1. Extracts the import source path from the string literal
2. Skips non-relative imports (bare specifiers like `express` are external)
3. Resolves the relative path against the current file, trying extensions (`.ts`, `.tsx`, `.js`, `.jsx`) and `index.*` fallbacks
4. For named imports (`import { Foo } from './bar'`), looks up `Foo` in the target file's nodes (matching by name + `exported: true`) and creates an edge to that specific symbol
5. For default imports, namespace imports, and side-effect imports, creates an edge to the target file's `<module>` node

Edge type is always `imports` for import/export edges. The `edgeId` is deterministic: `fromNodeId->imports->toNodeId`.

### PrismaExtractor

The `PrismaExtractor` is a `ContentExtractor` that parses `.prisma` schema files using regex, not Tree-sitter. It extracts:

- **Models** (`model User { ... }`) as `CIGNode` with `symbolType: 'schema'`
- **Enums** (`enum Role { ... }`) as `CIGNode` with `symbolType: 'enum'`
- **Composite types** (`type Address { ... }`) as `CIGNode` with `symbolType: 'schema'`

For each model/type, field metadata is extracted and stored in the node's `metadata.fields` array:
- Field name, type, isArray, isOptional
- `@id`, `@unique`, `@default` attributes
- `@relation` parsing: relation name, fields, references

Edge extraction: For each field whose type matches a known model name in `nodesByFile`, a `references` edge is created (e.g., `Post.author -> User`). Self-references without explicit `@relation` names are skipped to avoid false positives.

All Prisma nodes are marked `exported: true` since Prisma models are inherently public schema definitions.

### EntryPointDetector

The `EntryPointDetector` analyzes a `CIGBuildResult` to identify which files are likely entry points into the application. It runs after the CIG is built (not during extraction) and uses the graph structure rather than file content.

Four scoring signals:

| Signal | Condition | Score Contribution |
|---|---|---|
| `high-fan-in` | File is imported by >= `minFanIn` (default: 3) other files | +fanInCount |
| `low-fan-out` | File imports <= `maxFanOut` (default: 2) other files AND has at least 1 importer | +1 |
| `zero-importers` | No other file imports this file, but it imports others (leaf consumer: CLI, server main) | +2 |
| `filename-match` | Basename matches known names: `index`, `main`, `app`, `server`, `cli`, `bin`, `entry`, `bootstrap`, `startup` | +2 |

The detector computes fan-in/fan-out from `imports` edges only, counting at the file level (not symbol level). Results are sorted by score descending.

`detectAndEnrich()` is a convenience method that both detects entry points and annotates the corresponding `<module>` nodes in the CIG result with `isEntryPoint: true` and `entryPointScore` in their metadata.

Configuration is injected via constructor: `minFanIn`, `maxFanOut`, and `extraEntryPointNames` are all optional overrides.

### FrameworkSignalDetector

The `FrameworkSignalDetector` analyzes `package.json` contents (not AST, not file content) to detect what technologies a project uses. It accepts an array of `package.json` strings (to support monorepos with multiple package.json files) and returns a `DetectedSignals` object.

Five detection categories, each with a rule table mapping npm package names to canonical categories:

| Category | Example Detections |
|---|---|
| `frameworks` | react, express, next, fastify, nestjs, vue, svelte, angular |
| `orms` | prisma, typeorm, sequelize, knex, drizzle, mongoose |
| `testFrameworks` | jest, vitest, mocha, cypress, playwright |
| `authLibraries` | passport, next-auth, jsonwebtoken, jose, bcrypt |
| `buildTools` | webpack, vite, esbuild, rollup, turbo, tsup |

Additionally, `PackageMeta` is extracted from the first valid package.json: package name, version, whether it has a main/module entry, whether it has a start script, and whether TypeScript is a dependency.

Dependencies from `dependencies`, `peerDependencies`, and `devDependencies` are merged with deduplication. The `isDev` flag tracks whether a detection came from devDependencies.

This detector is designed to run once per ingestion and store its output as metadata on the repository or in the CIG. It is not part of the CIG build itself but is typically invoked alongside it.

### CIGPersistenceService

The `CIGPersistenceService` bridges the CIG Builder (which is pure, in-memory computation) with the database (via `StorageAdapter`). It handles two persistence modes:

**Full run** (first ingestion or when >40% of files changed):
1. Upsert all extracted nodes via `storage.upsertCIGNodes()`
2. Upsert all extracted edges via `storage.upsertCIGEdges()`

**Delta run** (incremental update when fewer files changed):
1. Delete existing CIG data for the changed files via `storage.deleteCIGForFiles(repoId, changedFiles)`
2. Upsert the newly extracted nodes and edges (scoped to changed files only)

The delta invariant is important: in delta mode, the `CIGBuildResult` passed to `persist()` must contain only nodes and edges from the changed files. The caller (ingestion pipeline) is responsible for running `CIGBuilder.build()` on just the changed files and passing that scoped result. Unchanged-file CIG data is preserved in the database.

The service accepts an optional `Logger` and logs node/edge counts and run mode. It propagates all storage errors without catching them — error handling is the caller's responsibility.

### Data Model

The CIG is stored as two entity types:

**CIGNode** — represents a symbol, route, or schema definition:
```
nodeId:       Deterministic string: "repoId:filePath:symbolName:symbolType"
repoId:       Repository identifier
filePath:     Relative path within the repo
symbolName:   Human-readable name (e.g., "UserService", "GET /api/users", "User")
symbolType:   function | class | interface | variable | type | enum | route | schema
startLine:    1-based start line in the source file
endLine:      1-based end line
exported:     Whether the symbol is exported from its module
extractedSha: The file's content SHA at time of extraction (for staleness detection)
metadata:     Optional JSONB — varies by symbolType (route metadata, Prisma field metadata, etc.)
```

A special `<module>` node (symbolType: `variable`, symbolName: `<module>`) is created for every processed file. This serves as the anchor for file-level import edges and for entry point detection.

**CIGEdge** — represents a relationship between two nodes:
```
edgeId:     Deterministic string: "fromNodeId->edgeType->toNodeId"
repoId:     Repository identifier
fromNodeId: Source node's nodeId
toNodeId:   Target node's nodeId
edgeType:   imports | calls | extends | implements | references
```

Currently extracted edge types:
- `imports` — from TypeScriptExtractor (import/export statements)
- `references` — from PrismaExtractor (model-to-model relations)
- `calls`, `extends`, `implements` — defined in the type system but not yet extracted (planned for future phases)

### Extension Points: Adding a New Language or Extractor

**Adding a new Tree-sitter language (e.g., Python):**

1. Install the grammar: `pnpm --filter @codeinsight/cig add tree-sitter-python`
2. Register the grammar in `CIGBuilder.ts`'s `GRAMMAR_REGISTRY`:
   ```typescript
   const treeSitterPython = require('tree-sitter-python');
   GRAMMAR_REGISTRY['python'] = () => treeSitterPython;
   ```
3. Create `extractors/PythonExtractor.ts` implementing `LanguageExtractor`
4. Map AST node types to `SymbolType` values (function_definition -> function, class_definition -> class, etc.)
5. Implement `extractEdges` for Python's import system
6. Register in the builder: `builder.registerExtractor(new PythonExtractor())`
7. Ensure `FileFilter.detectLanguage()` maps `.py` to `'python'` (already does)

**Adding a new schema language (e.g., GraphQL):**

1. Create `extractors/GraphQLExtractor.ts` implementing `ContentExtractor`
2. Parse the schema using regex or a lightweight parser
3. Extract types, queries, mutations as `CIGNode` entries
4. Extract field-type references as `CIGEdge` entries
5. Register: `builder.registerContentExtractor(new GraphQLExtractor())`
6. Ensure `FileFilter.detectLanguage()` maps `.graphql`/`.gql` to `'graphql'`

**Adding a new edge type (e.g., `extends` for class inheritance):**

1. The `EdgeType` union already includes `'extends'` and `'implements'`
2. Add detection logic in the relevant extractor's `extractEdges()` method
3. Walk the AST for `class_heritage` / `extends_clause` nodes
4. Resolve the base class to its `CIGNode` using `nodesByFile`
5. Create edges with `edgeType: 'extends'`

---

## How the Three Features Use the CIG

```
                      ┌────────────────────────┐
                      │  Code Intelligence     │
                      │  Graph (CIG)           │
                      │  Built once per delta  │
                      └───────────┬────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │  DOCUMENTATION   │ │    DIAGRAMS      │ │      QnA         │
    │                  │ │                  │ │                  │
    │  CIG provides:   │ │  CIG provides:   │ │  CIG provides:   │
    │  Entry points    │ │  Import graph    │ │  Symbol table    │
    │  Symbols for     │ │  → dependency    │ │  → chunk index   │
    │  accurate docs   │ │    diagram       │ │                  │
    │  Route list for  │ │  Routes → API    │ │  Dependency      │
    │  API reference   │ │    flow diagram  │ │  graph for       │
    │  Schema for      │ │  Schemas → ER    │ │  context         │
    │  data model docs │ │    diagram       │ │  expansion       │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
```

Additionally, the three features **feed each other**:
- Doc sections generated in documentation are indexed as QnA chunks (natural language answers conceptual questions better than raw code)
- Diagram descriptions are indexed for QnA (user can ask "explain the architecture diagram")
- QnA can generate on-demand focused diagrams for specific questions

---

## Feature 1: Documentation Generation

### The Challenge: Context Window Limits

A 200-file codebase can't fit in one LLM call. The solution is a **hierarchical, modular approach** — like how a book is structured from sentences → paragraphs → chapters → the whole book.

### Prompt Modules

Documentation is not generated by one big prompt. Each section is a separate **prompt module** — a small file that:
- Declares exactly what input it needs (specific files from the CIG, not everything)
- Has a single focused task ("document the state management approach")
- Produces one section of documentation

This means:
- Each call is small (~5-10K tokens instead of 80K+)
- Calls run in parallel
- If only one section needs updating, only that prompt runs
- Prompts are version-controlled — improving a prompt automatically triggers re-generation

### Framework Detection

The first step is a **classifier** — one cheap LLM call that reads the file tree and package manifests (not actual code content) and determines:
- What type of repo this is (frontend, backend, mobile, ML, infra)
- What framework/libraries are used
- Which prompt modules should run

A React+Express repo gets frontend prompt modules (component hierarchy, state management, routing) AND backend modules (API reference, database, auth). A pure Python data pipeline gets ML modules instead.

### The Three Passes

```
Pass 1 — File-level docs (PARALLEL, ~200 calls for 200-file repo)
  Each call: one file's content → one file's documentation
  Input: ~5-8K tokens | Output: ~400 tokens
  All calls independent → run simultaneously

Pass 2 — Directory summaries (PARALLEL)
  Each call: all file docs for one directory → directory summary
  Input: ~5K tokens | Output: ~300 tokens

Pass 3 — Architecture synthesis (ONE call)
  Input: all directory summaries (~15-30K tokens)
  Output: architecture overview, cross-cutting concerns doc
```

### Delta Documentation

On a re-run after code changes:
- Only files whose content changed get re-documented (Pass 1)
- Only directories containing changed files get re-summarized (Pass 2)
- Pass 3 only runs if core/entry-point files changed
- Unchanged files return from the LLM cache instantly — zero API cost

For a typical PR changing 10 files in a 200-file repo: you pay for ~5% of a full run.

---

## Feature 2: Diagram Generation

### Two Stages

Most diagram types follow a two-stage process:

**Stage 1: Structural extraction (zero LLM)**
Using the CIG (already built), extract the structural data the diagram needs. For an ER diagram, this means the parsed schema definitions. For a dependency graph, this means the import/export graph. This is deterministic and instant.

**Stage 2: Mermaid synthesis (minimal LLM)**
For diagrams that need semantic understanding, pass the structured data (not raw code) to the LLM to generate Mermaid syntax. Because you're sending structured data instead of raw code, input is typically only 2-5K tokens.

Some diagrams skip Stage 2 entirely:

| Diagram | Stage 1 Only? | Notes |
|---|---|---|
| Dependency graph | Yes | Import graph renders directly to Mermaid |
| ER diagram | Yes | Parse Prisma/SQLAlchemy/TypeORM → erDiagram |
| Component hierarchy | Yes | React/Vue import graph → tree diagram |
| API flow | No | Routes + call chain → sequence diagram |
| State flow | No | Store definitions → stateDiagram |
| CI/CD pipeline | Sometimes | Simple YAML → can parse directly |
| Service topology | No | docker-compose/k8s → needs LLM |

### Why Pure-AST Diagrams First

For the initial release targeting open-source traction, the pure-AST diagrams (dependency graph, ER diagram, component hierarchy) are the best first priority:
- **Instant** — no LLM call, generates in milliseconds
- **Always accurate** — derived directly from code, not LLM interpretation
- **Zero cost** — no API key needed to see these
- **Visually impressive** — a dependency graph of a real codebase is immediately useful

Users will see value before they even configure an LLM API key.

### On-Demand Diagrams from QnA

When a user asks a question with generative intent in the QnA tab ("show me the login flow", "diagram how a payment gets processed"), instead of just returning text:
1. Detect the generative intent
2. Use the CIG to trace the specific call chain the user asked about
3. Generate a focused Mermaid sequence diagram for just that flow
4. Return diagram + explanation

This is different from the pre-generated diagrams — it's scoped to exactly what the user asked.

---

## Feature 3: QnA (RAG Pipeline)

### Why Not Just Send All the Code to the LLM?

Two reasons:
1. **Cost** — A 200-file codebase might be 500,000 tokens. At Claude's pricing, one QnA question would cost several dollars.
2. **Quality** — LLMs perform worse with very long contexts. The "lost in the middle" problem means the LLM may ignore content in the middle of a huge context.

RAG solves both: retrieve only what's relevant (~10-15K tokens), get a better answer at a fraction of the cost.

### Multi-Layer Indexing

The key insight: **index multiple representations of the same code**, each suited to different question types.

```
Layer 1 — Raw code chunks
  What: Each function/class as a separate chunk
  Good for: "What does loginUser() do exactly?" (needs to see the actual code)

Layer 2 — File summaries
  What: The file-level documentation from Pass 1 of doc generation
  Good for: "What does the auth module handle?" (needs module-level understanding)

Layer 3 — Documentation sections
  What: The full doc sections (backend/auth, frontend/state-management, etc.)
  Good for: "How does authentication work in this service?" (conceptual)

Layer 4 — CIG metadata
  What: Structured data from CIG (routes, schemas, symbols)
  Good for: "What API endpoints exist?" (direct lookup, no embedding needed)

Layer 5 — Diagram descriptions
  What: Descriptions of the generated diagrams
  Good for: "Explain the architecture diagram"
```

Natural language questions are answered better by natural language context (Layers 2, 3) than by raw code (Layer 1). This is why generating docs first, then indexing those docs for QnA, produces better QnA answers than indexing raw code alone.

### How a Question Gets Answered

```
User: "How does token refresh work?"

Step 1: Query classification
  → Conceptual question → search Layers 2 + 3

Step 2: Parallel retrieval
  Vector search:   embed question → find similar chunks in Layers 2+3
  Keyword search:  find chunks containing "token", "refresh", "JWT"
  CIG lookup:      find symbols containing "refresh" in their name

Step 3: Merge + re-rank
  Combine results → top 5-8 most relevant chunks

Step 4: Context expansion
  For each retrieved chunk, also pull from CIG:
  - Functions it calls (short snippets)
  - Functions that call it
  - The linked documentation section

Step 5: Assemble context (~13K tokens total)
  System prompt + conversation history + retrieved chunks + expanded context

Step 6: LLM generates answer
  Grounded in retrieved context, with file/line references

Step 7: Return structured response
  Answer text + source references (file, function, lines) + related docs/diagrams
```

### The Conversation

QnA is a session — not one-shot. The system tracks what's been discussed:

```
active_context = {
  symbols: ["refreshToken", "generateToken"],  // mentioned so far
  files:   ["src/auth/token.ts"],              // referenced so far
  concepts: ["JWT", "token expiry"]            // discussed so far
}
```

When the user says "what about the expiry check in that function?" — "that function" is resolved to `refreshToken` from active_context before retrieval runs. Without this, follow-up questions break.

After 8-10 turns, older turns are summarized (not discarded) to keep the history window stable.

---

## Database Design

### Why PostgreSQL + pgvector?

Backstage already requires PostgreSQL. By adding the `pgvector` extension, we get vector similarity search in the same database — no new infrastructure for the plugin to deploy. This is critical for open-source adoption: users shouldn't need to set up Pinecone or a separate vector DB just to install the plugin.

pgvector is optional until Phase 4 (QnA). Phases 1-3 (CIG, docs, diagrams) work without it. The migration wraps `CREATE EXTENSION IF NOT EXISTS vector` in a try-catch — if it fails, QnA features are disabled but everything else works.

### Single-Tenant by Design

Both the Backstage plugin and the standalone SaaS are always self-hosted — each deployment gets its own dedicated Postgres instance. There is no centralized multi-tenant infrastructure, so row-level `tenant_id` isolation is unnecessary. No `tenant_id` column exists on any table.

### The Unified Artifact Table

All generated outputs — doc sections, diagrams, QnA chunks — live in one table: `ci_artifacts`. This table has a `type` column (`doc`, `diagram`, `qna_chunk`) and a `content` JSONB column whose structure varies per type.

Why unified? Because staleness tracking, caching, and delta handling are identical across all three features. One sweep marks stale artifacts across docs, diagrams, and QnA simultaneously.

### SHA-Based Staleness

Every artifact tracks which files it was generated from and what SHA those files had at generation time:

```
ci_artifact_inputs table:
  artifact_id: "backend/auth"
  file_path:   "src/auth/login.ts"
  file_sha:    "d4e5f6"           ← SHA when this doc section was generated
```

When `src/auth/login.ts` is updated and its SHA becomes `a1b2c3`, the comparison `d4e5f6 != a1b2c3` marks this artifact as stale. Simple, deterministic, no timestamps needed.

For artifacts derived from multiple files (architecture doc, ER diagram), a **composite SHA** is computed:
```
composite = SHA256(sorted list of "filepath:sha" for all inputs)
```
If any input file changes, the composite SHA changes → stale.

### Cascade Invalidation

Some artifacts depend on other artifacts (the architecture doc depends on section docs, which depend on file docs). The `ci_artifact_dependencies` table tracks this DAG.

When a file doc is marked stale, the system walks the dependency DAG and marks everything downstream stale too — automatically, in one sweep.

### The LLM Cache

The most important cache in the system. The cache key is:
```
SHA256(prompt_file_sha + composite_input_sha + model_name)
```

If the input files haven't changed AND the prompt file hasn't changed AND the same model is used → the LLM response is mathematically guaranteed to be identical. No API call needed. Return from cache.

This means:
- On delta re-runs, only changed files cost API calls
- If you redeploy the same codebase → instant, zero-cost re-generation
- Prompt improvements selectively invalidate only artifacts that prompt generates

---

## Error Handling and Job Lifecycle

### Job States

An ingestion job follows this lifecycle:

```
queued → running → completed | failed | partial
```

- **completed** — all files parsed and CIG built successfully
- **failed** — unrecoverable error (clone failure, DB down). Error message stored in the job record
- **partial** — pipeline finished but some files could not be processed (unsupported language, syntax errors). The CIG is valid for the files that were parsed

### Graceful Degradation

The system is designed to produce the best result possible rather than failing on the first problem:

- **Unparseable files** are skipped with a warning. The file is tracked in `ci_repo_files` with `parse_status = 'skipped'` or `'error'`, but the CIG is still valid for all other files
- **LLM failures** (Phase 2+) retry with exponential backoff (max 3 retries). If still failing, that specific artifact is marked with an error but other artifacts continue generating
- **Partial generation** is always better than no generation — if 8 out of 10 doc sections succeed, show the 8

### Duplicate Job Prevention

The `IngestionService` checks for active jobs before starting a new one. If a job is already running for a repo, the second trigger returns the existing job ID instead of spawning a duplicate.

### In-Process Job Runner

Phase 1 uses an `InProcessJobRunner` — jobs run as async Promises within the Node.js process. There is no external queue (no Redis, no BullMQ). Job status is tracked in the `ci_ingestion_jobs` database table. Jobs are NOT recovered on process restart (acceptable for v1 — Backstage plugins restart cleanly). A health check on startup sweeps jobs stuck in `running` state for longer than 30 minutes and marks them `failed`.

The `JobQueue` interface is designed so BullMQ can be swapped in later without changing any core code.

---

## How a Webhook Keeps Everything Fresh

When a developer pushes code to their repo:

```
GitHub/GitLab/Bitbucket fires webhook → CodeInsight backend

1. Verify webhook signature (security)
2. Extract: repo ID, new commit SHA, list of changed files
3. Create ingestion job (queued)

Background job runs:
4. Update file SHAs in ci_repo_files
5. Rebuild CIG for changed files only
6. Sweep artifacts → mark stale where input files changed
7. Walk dependency DAG → cascade stale marking
8. Re-generate stale artifacts (check LLM cache first for each)
9. Update vector embeddings for changed QnA chunks
10. Mark repo status = 'ready', update last_commit_sha

Backstage UI shows:
"Last updated 3 minutes ago — 12 artifacts regenerated"
```

One push event → docs, diagrams, and QnA all updated atomically.

---

## The Full Technology Stack

| Component | Technology | Why |
|---|---|---|
| Plugin framework | Backstage `createBackendPlugin` + `createPlugin` | Required for Backstage integration |
| AST parsing | Tree-sitter (Node.js) | Multi-language, runs in Node.js without spawning processes |
| LLM | Claude API (configurable to any OpenAI-compatible API) | Best code reasoning; 200K context handles large files |
| Embeddings | OpenAI `text-embedding-3-small` | Good quality for both code and prose; inexpensive |
| Vector store | pgvector (PostgreSQL extension) | Same DB as Backstage, zero new infrastructure |
| Diagram format | Mermaid.js | Native Backstage TechDocs rendering |
| DB migrations | Knex.js | Backstage standard for backend plugins |
| Job queue | In-process async initially; BullMQ for scale | Start simple, upgrade when needed |
| Repo access | `simple-git` (framework-agnostic) | Auth token injected from config; Backstage layer reads from Backstage's configured SCM tokens |

---

## What the Backstage UI Looks Like

The plugin adds three tabs to any `Component` entity in the Backstage catalog:

```
┌─────────────────────────────────────────────────────────────┐
│  service-auth                                    Component  │
│  ─────────────────────────────────────────────────────────  │
│  Overview  │  CI/CD  │  Docs  │  Diagrams  │  QnA  │  API  │
│            │         │   ↑    │     ↑      │   ↑   │       │
│            │         │   └────┴─────┴──────┘       │       │
│            │         │     CodeInsight tabs         │       │
└─────────────────────────────────────────────────────────────┘
```

**Docs tab:** Renders the generated Markdown sections. Shows last-updated time, regenerate button, per-section staleness indicators.

**Diagrams tab:** Renders Mermaid diagrams in a gallery. Each diagram has a title, description, and a link to view full-size. "Regenerate" button triggers delta re-run.

**QnA tab:** Chat interface. Each response shows source file references as clickable links that open the file in GitHub/GitLab. Related docs and diagrams are surfaced as cards below the answer.

---

## What Gets Built in Each Phase

See `build-plan.md` for the full phase-by-phase breakdown with tasks, dependencies, and acceptance criteria.

Short version:
- **Phase 1** — Foundation: monorepo scaffold, shared types, Backstage plugin scaffold, DB migrations, storage adapter, GitHub repo connector, file filter, CIG builder (TS/JS), ingestion pipeline, backend API, frontend repo registration
- **Phase 2** — Documentation: classifier, prompt modules, delta cache, frontend tab
- **Phase 3** — Diagrams: pure AST diagrams, LLM diagrams, Mermaid frontend
- **Phase 4** — QnA: embeddings, vector search, chat UI, sessions (QnA DB tables created here)
- **Phase 5** — Integration: webhooks, cross-feature enrichment
- **Phase 6** — Open source release

---

## Common Questions

**Q: What happens if the LLM API is down?**
The plugin degrades gracefully. Pure-AST diagrams still generate. Cached docs and diagrams still display. QnA shows an error message but cached responses in the session still render.

**Q: Is the cloned code stored permanently?**
No. The clone is in a temp directory with a TTL. The CIG (structured metadata) is stored in the database, not the raw code. Raw code is only on disk long enough to parse.

**Q: Can two users trigger generation simultaneously for the same repo?**
The job queue prevents duplicate concurrent jobs for the same repo. The second trigger either waits or returns the in-progress job's status.

**Q: What about private repositories?**
The `GitRepoConnector` adapter uses `simple-git` with an auth token injected via config. In Backstage, the backend plugin reads the token from `app-config.yaml` and passes it to the connector. The connector itself has no Backstage dependency — it just needs a URL and a token.

**Q: Can I use a different LLM?**
Yes. The LLM client is abstracted behind an interface. Any OpenAI-compatible API endpoint works. You can also configure Anthropic (Claude) directly.

**Q: How is it tested?**
The architecture makes testing straightforward. Every service receives its dependencies via constructor injection, so unit tests pass in simple in-memory mocks. The `KnexStorageAdapter` is tested against a real PostgreSQL instance using transaction rollback for isolation. Tree-sitter parsing is tested against fixture files — small, focused code snippets committed in `test/fixtures/`. Integration tests use a small fixture repo for end-to-end ingestion pipeline testing. The test framework is Jest (Backstage convention).

**Q: How does it handle monorepos?**
The CIG is built for the full repo but artifacts can be scoped to sub-directories. A monorepo with `packages/frontend` and `packages/backend` generates separate doc sets per package, with a top-level architecture doc covering the whole repo.

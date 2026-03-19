# PROJECT: CodeInsight — Backstage Plugin (Framework-Agnostic Core)

## What It Is
A Backstage plugin that connects to GitHub, GitLab, and Bitbucket repositories and provides three features for any registered catalog entity:
1. **Documentation Generation** — On-demand, AI-generated docs from source code
2. **Diagram Generation** — Architecture, ER, API flow, dependency, state, CI/CD diagrams
3. **QnA (RAG pipeline)** — Chat with the codebase, scoped per repository

**Primary delivery target is Backstage. However, the entire core is framework-agnostic and must be extractable into a standalone SaaS product with only adapter/wrapper changes — zero core modifications.**

## Core Architecture Principles
1. One shared processing pipeline (Clone → Filter → CIG → Artifacts). All three features consume from the same Code Intelligence Graph (CIG). Delta changes propagate once and invalidate all three features correctly.
2. Backstage is a delivery layer, not the foundation. All business logic lives in framework-agnostic core packages. Backstage plugin only wires config, adapters, and HTTP routing.

---

## MODULAR ARCHITECTURE — FRAMEWORK-AGNOSTIC CORE

### Package Structure
```
packages/
├── core/                              # ZERO framework dependencies — pure business logic
│   ├── @codeinsight/types            # Shared types + interfaces — zero logic, zero runtime deps
│   ├── @codeinsight/cig              # CIG builder (Tree-sitter AST)
│   ├── @codeinsight/doc-generator    # Documentation generation service
│   ├── @codeinsight/diagram-gen      # Diagram generation service
│   ├── @codeinsight/qna               # RAG pipeline (chunking, retrieval, QnA)
│   └── @codeinsight/ingestion        # Job orchestration (clone → filter → CIG → artifacts)
│
├── adapters/                          # Pluggable I/O — concrete implementations of core interfaces
│   ├── @codeinsight/llm              # Claude / OpenAI LLMClient impls
│   ├── @codeinsight/embeddings       # OpenAI EmbeddingClient impl
│   ├── @codeinsight/vector-store     # pgvector / Chroma / Pinecone VectorStore impls
│   ├── @codeinsight/repo             # GitHub / GitLab / Bitbucket RepoConnector impls
│   └── @codeinsight/storage          # Knex/Postgres StorageAdapter impl
│
├── backstage/                         # Backstage delivery layer — thin wrapper only
│   ├── @codeinsight/plugin           # Frontend: React tabs using Backstage UI components
│   └── @codeinsight/plugin-backend   # Backend: createBackendPlugin wrapping core services
│
└── standalone/ (future SaaS)          # Same core, different wrapper
    └── @codeinsight/server            # Express/Fastify + multi-tenancy + API key auth
```

### Hard Rules — Enforced Throughout All Development

1. **Zero Backstage imports in `core/` or `adapters/`** — Never `import from '@backstage/*'` outside the `backstage/` packages. If a core service needs something from Backstage, it must go through an interface.

2. **Config is always injected** — Services receive configuration as constructor parameters. They never read `process.env` or Backstage's `ConfigReader` directly. The caller (Backstage plugin or standalone server) reads config and passes it in.

3. **All I/O behind interfaces** — LLM, embeddings, vector store, repo access, storage, and job queue are all TypeScript interfaces defined in core. Core instantiates nothing concrete.

4. **HTTP handlers are thin** — Route handlers only call a service method and serialize the response. Zero business logic in route files.

5. **Auth is adapter-level** — Core services are auth-unaware. Backstage uses its identity middleware. Standalone server injects JWT/API key middleware. Core never checks tokens.

6. **No Backstage-specific data types in service signatures** — Service method params and return types are plain TypeScript types defined in `@codeinsight/core`. Never `BackstageIdentity`, `Config`, `Logger` from Backstage — use equivalent plain interfaces.

### Core Interface Contracts
```typescript
// All defined in @codeinsight/types package
// Both core/ and adapters/ packages import from @codeinsight/types — never concrete implementations
// This package contains: all data types, all I/O interfaces, all config types — zero logic, zero runtime deps

interface LLMClient {
  complete(systemPrompt: string, userPrompt: string, opts?: LLMOptions): Promise<string>
  stream(systemPrompt: string, userPrompt: string, opts?: LLMOptions): AsyncIterable<string>
}

interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

interface VectorStore {
  upsert(chunks: VectorChunk[]): Promise<void>
  search(embedding: number[], filter: VectorFilter, topK: number): Promise<VectorChunk[]>
}

interface RepoConnector {
  clone(url: string, targetDir: string, opts?: CloneOptions): Promise<void>
  getFileTree(dir: string): Promise<RepoFile[]>
  getHeadSha(dir: string): Promise<string>
  getChangedFiles(dir: string, fromSha: string, toSha: string): Promise<string[]>  // returns file paths changed between two commits
}

interface StorageAdapter {
  // Repository operations
  getRepo(repoId: string): Promise<Repository | null>
  upsertRepo(repo: Repository): Promise<void>
  updateRepoStatus(repoId: string, status: string, lastCommitSha?: string): Promise<void>

  // File tracking
  upsertRepoFiles(files: RepoFile[]): Promise<void>
  getRepoFiles(repoId: string): Promise<RepoFile[]>
  getChangedRepoFiles(repoId: string): Promise<RepoFile[]>  // where current_sha != last_processed_sha

  // CIG
  upsertCIGNodes(nodes: CIGNode[]): Promise<void>
  upsertCIGEdges(edges: CIGEdge[]): Promise<void>
  deleteCIGForFiles(repoId: string, filePaths: string[]): Promise<void>
  getCIGNodes(repoId: string): Promise<CIGNode[]>
  getCIGEdges(repoId: string): Promise<CIGEdge[]>

  // Artifacts (used from Phase 2+)
  upsertArtifact(artifact: Artifact): Promise<void>
  getArtifact(artifactId: string, repoId: string): Promise<Artifact | null>
  getStaleArtifacts(repoId: string): Promise<Artifact[]>

  // Jobs
  createJob(job: IngestionJob): Promise<string>
  updateJob(jobId: string, update: Partial<IngestionJob>): Promise<void>
  getJob(jobId: string): Promise<IngestionJob | null>
  getActiveJobForRepo(repoId: string): Promise<IngestionJob | null>
}

interface JobQueue {
  enqueue(job: Job): Promise<string>       // writes to ci_ingestion_jobs + starts async pipeline
  getStatus(jobId: string): Promise<JobStatus>  // reads from ci_ingestion_jobs
}
// Phase 1: InProcessJobRunner — runs pipeline via Promise, writes status to DB.
//   Does NOT recover jobs on restart (acceptable for v1).
//   Prevents duplicate concurrent jobs for same repo by checking DB for 'running' status.
// Future: BullMQ adapter for Redis-backed queue with job recovery.

interface Logger {
  info(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  error(msg: string, meta?: object): void
}
```

### What Each Delivery Target Does

**Backstage backend plugin** (`@codeinsight/plugin-backend`) — uses the **new backend system** (`createBackendPlugin` + `coreServices`, not the legacy `createRouter` pattern):
1. Reads config from Backstage `ConfigReader`
2. Instantiates concrete adapters: `KnexStorageAdapter`, `ClaudeClient`, `OpenAIEmbeddingClient`, `pgVectorStore`, `GitRepoConnector` (auth token from Backstage config)
3. Injects them into core services via constructors
4. Registers routes via `createBackendPlugin` router
5. Passes Backstage's logger wrapped in the `Logger` interface

**Standalone SaaS server** (`@codeinsight/server`, future):
1. Reads config from env vars / YAML config file
2. Instantiates same or different adapter impls (e.g., PineconeVectorStore, GitHubAppRepoConnector)
3. Injects into same core services — **zero core changes**
4. Exposes routes via Express/Fastify
5. Adds: API key auth middleware, usage billing hooks

### What Changes Per Deployment Target

| Concern | Backstage Plugin | Standalone SaaS |
|---|---|---|
| Config reading | Backstage ConfigReader | env vars / config file |
| Authentication | Backstage identity middleware | JWT / API key middleware |
| Repo access | ScmIntegration (Backstage adapter) | GitHub App / OAuth (direct adapter) |
| Database | Backstage's Postgres (shared) | Dedicated Postgres |
| Multi-tenancy | Single-tenant per Backstage instance | Single-tenant per self-hosted deployment (infra isolation) |
| Vector store | pgvector (same Backstage DB) | pgvector or Pinecone/Weaviate |
| Job queue | In-process async | BullMQ + Redis |
| HTTP layer | createBackendPlugin router | Express/Fastify |
| Frontend | Backstage React plugin | Any React app / Next.js |

### Deployment Model
Both Backstage plugin and standalone SaaS are self-hosted — each deployment gets its own Postgres instance. There is no centralized multi-tenant infrastructure, so row-level `tenant_id` isolation is unnecessary. No `tenant_id` column on any table.

---

## SHARED FOUNDATION: Code Intelligence Graph (CIG)

Built once per delta. Zero LLM calls. Pure AST parsing via Tree-sitter.

Contains:
- `files`: file tree with language, type classification
- `dependency_graph`: import/export relationships between files
- `symbols`: functions, classes, interfaces per file with line ranges
- `routes`: HTTP route definitions (method, path, handler)
- `schemas`: ORM model definitions (Prisma, SQLAlchemy, TypeORM, etc.)
- `entry_points`: main/index files
- `detected`: framework, ORM, auth library, test framework signals

CIG is rebuilt incrementally — only files whose SHA changed get re-parsed.

---

## FEATURE 1: DOCUMENTATION GENERATION

### Approach
- Modular prompt system. Each section is a separate prompt file with declared inputs.
- Classifier runs first (1 cheap LLM call on file tree + package manifest) → outputs JSON selecting which prompt modules to run
- Sections run in parallel (Phase 1), then aggregate (Phase 2), then synthesis (Phase 3)

### Prompt Module Registry
```
prompts/
├── classifier.md              # Step 0: detect type, select modules
├── core/                      # Every repo
│   ├── overview.md
│   ├── project-structure.md
│   ├── getting-started.md
│   ├── configuration.md
│   ├── dependencies.md
│   ├── testing.md
│   └── deployment.md
├── frontend/                  # React, Vue, Angular, Svelte
│   ├── component-hierarchy.md
│   ├── state-management.md
│   ├── routing.md
│   └── styling-system.md
├── backend/                   # Express, FastAPI, Go, etc.
│   ├── api-reference.md
│   ├── database.md
│   ├── auth.md
│   ├── middleware.md
│   └── error-handling.md
├── mobile/
│   ├── navigation.md
│   └── platform-specifics.md
├── ml/
│   ├── data-pipeline.md
│   └── model-architecture.md
└── infra/
    └── ci-cd-pipeline.md
```

### Classifier Output (JSON)
```json
{
  "repo_type": ["frontend", "backend"],
  "language": "typescript",
  "frameworks": ["react", "express"],
  "detected_signals": { "state_management": "zustand", "database": "prisma", "test_framework": "jest" },
  "prompt_modules": ["core/overview", "core/project-structure", "frontend/state-management", "backend/api-reference", "backend/database"]
}
```

### Processing DAG
```
Phase 0: Classifier (file tree + package manifest only, ~1.5K tokens)
Phase 1: Parallel file-level docs (each ~5-8K tokens input, ~400 tokens output)
Phase 2: Directory summaries (aggregate Phase 1 outputs per directory)
Phase 3: Architecture synthesis (all Phase 2 outputs, ~15-30K tokens input)
```

### Token Budget Per Call
- Phase 1 file doc: ~5-8K in / ~400 out
- Phase 2 dir summary: ~6K in / ~300 out
- Phase 3 architecture: ~15-30K in / ~2K out
- Oversized file: AST-split into symbol chunks → doc each → aggregate

### Prompt File Contract (each prompt declares)
- Required input fields (what from CIG)
- Task description
- Output format (markdown section)

---

## FEATURE 2: DIAGRAM GENERATION

### Approach
Two-stage: AST extraction (from CIG, no LLM) → Mermaid synthesis (LLM, minimal tokens).
Many diagrams require no LLM at all.

### Diagram Module Registry
```
diagrams/
├── universal/
│   ├── dependency-graph.ts    # Pure AST, no LLM
│   ├── project-structure.ts   # Pure AST, no LLM
│   └── ci-cd-pipeline.ts      # Parse workflow YAML → LLM
├── backend/
│   ├── api-flow.ts            # Routes + call graph → sequence diagram
│   ├── request-lifecycle.ts   # Middleware chain → flowchart
│   ├── er-diagram.ts          # Schema parsing → Pure AST, no LLM
│   └── data-flow.ts           # Service layer → LLM
├── frontend/
│   ├── component-hierarchy.ts # Import graph → tree, Pure AST
│   ├── routing-map.ts         # Router config → flowchart
│   └── state-flow.ts          # Store definitions → stateDiagram
└── infra/
    └── service-topology.ts    # docker-compose/k8s → LLM
```

### Diagram Module Contract
```typescript
{
  id: string,
  requires: string[],      // CIG fields needed
  triggers_on: string[],   // framework/signal conditions
  llm_needed: boolean,
  prompt_file?: string,    // null if pure AST
  context_builder?: (cig) => string  // extract minimal context from CIG
}
```

### Processing DAG
```
Phase 0: Classifier (same output reused from docs)
Phase 1: Pure AST diagrams (instant, parallel, no LLM)
         → dependency-graph, er-diagram, component-hierarchy
Phase 2: LLM diagrams (parallel, minimal tokens per call)
         → api-flow, state-flow, ci-cd-pipeline, request-lifecycle
Phase 3: Optional composite architecture description (ties diagrams together)
```

### Output Format
All diagrams output Mermaid syntax. Stored in ci_artifacts with type="diagram".
Frontend renders via Mermaid.js (Backstage TechDocs compatible).

### On-Demand Diagrams (from QnA)
When QnA query has generative intent ("show me the flow for X"):
- CIG traversal extracts specific call chain
- Generate focused Mermaid diagram for that chain only
- Return diagram + text explanation

---

## FEATURE 3: QnA (RAG PIPELINE)

### Multi-Layer Index
Each layer optimized for different query types:
```
Layer 1: Code chunks (AST function/class level) → "What does loginUser() do?"
Layer 2: File summaries (from doc Phase 1 outputs) → "What does the auth module handle?"
Layer 3: Doc sections (from documentation generation) → "How does auth work overall?"
Layer 4: CIG metadata (routes, schemas, symbols) → structural queries, no embedding needed
Layer 5: Diagram descriptions → "Explain the architecture"
```

### Chunking Strategy
- Use CIG symbol table — each function/class = one chunk
- Each chunk carries metadata: calls[], called_by[], file_path, lines, file_sha, layer
- chunk_id format: "repo_id:file_path:symbol_name"
- File imports/exports = separate metadata chunk
- Oversized symbols split further

### Retrieval Strategy
Three parallel retrieval modes, merged and re-ranked:
1. **Vector search** — semantic matches (pgvector cosine similarity)
2. **Keyword/BM25** — exact function names, file paths, specific identifiers
3. **CIG graph traversal** — relational queries (no embedding), uses ci_cig_edges

### Query Types + Routing
```
Conceptual  → "How does auth work?"           → Layer 3 (doc sections)
Specific    → "What does loginUser() do?"     → Layer 1 (code) + CIG direct lookup
Relational  → "What calls loginUser()?"       → CIG graph traversal, no LLM needed
Navigational→ "Where is DB config?"           → CIG metadata search
Comparative → "Auth vs payments error handling?" → Multi-section Layer 2+3
Generative  → "Show login flow"               → CIG call chain → Mermaid diagram
Diagnostic  → "Why might login fail?"         → Layer 1 + error handling chunks
```

### Context Assembly (per retrieved chunk)
Retrieve chunk X → also pull from CIG:
- Direct callees (short snippets)
- Linked doc chunk (from Layer 3)
- File import list
- Called-by context

### Token Budget Per QnA Call
```
System prompt:          ~800 tokens
Conversation history:   ~2,000 tokens (last 4-6 turns)
Retrieved chunks:       ~6,000 tokens (5-8 chunks × ~800 tokens)
Context expansion:      ~2,000 tokens
Output buffer:          ~3,000 tokens
Total:                  ~13,800 tokens
```

### Session Management
- Session scoped to repo_id
- active_context tracks mentioned symbols, files, concepts for reference resolution
- History compression after 8-10 turns (summarize older turns)

### Response Structure
```json
{
  "answer": "...",
  "sources": [{ "file": "src/auth/login.ts", "symbol": "loginUser", "lines": [12,45], "snippet": "..." }],
  "related_docs": ["backend/auth"],
  "related_diagrams": ["api-flow"],
  "generated_diagram": null
}
```

---

## DATABASE SCHEMA (PostgreSQL + pgvector)

No `tenant_id` on any table — deployment is always self-hosted (one Postgres per deployment), so infrastructure isolation is sufficient.
QnA tables (`ci_qna_*`) are created in Phase 4 migrations. All other tables are created in Phase 1.
pgvector extension is optional until Phase 4 — `ci_embedding_cache` migration wraps `CREATE EXTENSION` in try-catch.

### Core Tables
```sql
ci_repositories (
  repo_id          TEXT NOT NULL PRIMARY KEY,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  provider         TEXT NOT NULL,       -- github | gitlab | bitbucket
  status           TEXT NOT NULL DEFAULT 'idle',  -- idle | processing | ready | error
  last_commit_sha  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ci_repo_files (
  repo_id            TEXT NOT NULL,
  file_path          TEXT NOT NULL,
  current_sha        TEXT NOT NULL,
  last_processed_sha TEXT,
  file_type          TEXT NOT NULL,     -- source | config | schema | infra | ci | test
  language           TEXT,
  parse_status       TEXT NOT NULL DEFAULT 'pending',  -- pending | parsed | skipped | error
  PRIMARY KEY (repo_id, file_path),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_repo_files_repo ON ci_repo_files(repo_id);

ci_cig_nodes (
  node_id        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id        TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  symbol_name    TEXT NOT NULL,
  symbol_type    TEXT NOT NULL,         -- function | class | interface | variable | type | enum | route | schema
  start_line     INTEGER NOT NULL,
  end_line       INTEGER NOT NULL,
  exported       BOOLEAN NOT NULL DEFAULT false,
  extracted_sha  TEXT NOT NULL,         -- file SHA at extraction time
  metadata       JSONB,
  UNIQUE (repo_id, file_path, symbol_name, symbol_type),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_cig_nodes_file ON ci_cig_nodes(repo_id, file_path);

ci_cig_edges (
  edge_id        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id        TEXT NOT NULL,
  from_node_id   UUID NOT NULL,
  to_node_id     UUID NOT NULL,
  edge_type      TEXT NOT NULL,         -- calls | imports | extends | implements
  FOREIGN KEY (from_node_id) REFERENCES ci_cig_nodes(node_id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id) REFERENCES ci_cig_nodes(node_id) ON DELETE CASCADE
);
CREATE INDEX idx_cig_edges_from ON ci_cig_edges(from_node_id);
CREATE INDEX idx_cig_edges_to ON ci_cig_edges(to_node_id);
```

### Artifact Tables (unified across all three features)
```sql
ci_artifacts (
  repo_id        TEXT NOT NULL,
  artifact_id    TEXT NOT NULL,         -- "core/overview" | "er-diagram" | "qna/chunk:loginUser"
  artifact_type  TEXT NOT NULL,         -- doc | diagram | qna_chunk
  content        JSONB,                 -- structure differs per type
  input_sha      TEXT NOT NULL,         -- composite SHA of all input files
  prompt_version TEXT,                  -- null for pure AST artifacts
  is_stale       BOOLEAN NOT NULL DEFAULT false,
  stale_reason   TEXT,                  -- file_changed | prompt_updated | dependency_stale
  tokens_used    INTEGER DEFAULT 0,
  llm_used       BOOLEAN NOT NULL DEFAULT false,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repo_id, artifact_id),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_artifacts_stale ON ci_artifacts(repo_id, is_stale) WHERE is_stale = true;

ci_artifact_inputs (
  repo_id        TEXT NOT NULL,
  artifact_id    TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  file_sha       TEXT NOT NULL,         -- SHA of this file when artifact was generated
  PRIMARY KEY (repo_id, artifact_id, file_path),
  FOREIGN KEY (repo_id, artifact_id) REFERENCES ci_artifacts(repo_id, artifact_id) ON DELETE CASCADE
);
CREATE INDEX idx_artifact_inputs_file ON ci_artifact_inputs(repo_id, file_path);

ci_artifact_dependencies (
  repo_id        TEXT NOT NULL,
  dependent_id   TEXT NOT NULL,         -- artifact_id that depends on another
  dependency_id  TEXT NOT NULL,         -- artifact_id being depended on
  dep_type       TEXT NOT NULL DEFAULT 'content',  -- content | structural
  PRIMARY KEY (repo_id, dependent_id, dependency_id),
  FOREIGN KEY (repo_id, dependent_id) REFERENCES ci_artifacts(repo_id, artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id, dependency_id) REFERENCES ci_artifacts(repo_id, artifact_id) ON DELETE CASCADE
);
```

### QnA Tables (Phase 4 migrations — not created in Phase 1)
```sql
ci_qna_embeddings (
  repo_id        TEXT NOT NULL,
  chunk_id       TEXT NOT NULL,         -- "repo_id:file_path:symbol:layer"
  embedding      VECTOR(1536) NOT NULL, -- pgvector
  content        TEXT NOT NULL,
  content_sha    TEXT NOT NULL,
  layer          TEXT NOT NULL,         -- code | file_summary | doc_section | cig_metadata | diagram_desc
  metadata       JSONB,
  PRIMARY KEY (repo_id, chunk_id),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_qna_embeddings_ivfflat ON ci_qna_embeddings USING ivfflat (embedding vector_cosine_ops);

ci_qna_sessions (
  session_id     UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id        TEXT NOT NULL,
  user_ref       TEXT,
  active_context JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);

ci_qna_messages (
  message_id     UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id     UUID NOT NULL,
  role           TEXT NOT NULL,         -- user | assistant
  content        TEXT NOT NULL,
  sources        JSONB,
  tokens_used    INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (session_id) REFERENCES ci_qna_sessions(session_id) ON DELETE CASCADE
);
```

### Cache Tables
```sql
ci_llm_cache (
  cache_key      TEXT NOT NULL PRIMARY KEY,  -- SHA256(prompt_version + input_sha + model_name)
  response       TEXT NOT NULL,
  tokens_used    INTEGER NOT NULL,
  model_used     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Content-addressed: never expires unless prompt_version changes

ci_embedding_cache (
  content_sha    TEXT NOT NULL PRIMARY KEY,  -- SHA256(chunk_text)
  embedding      VECTOR(1536) NOT NULL,      -- requires pgvector extension
  model_used     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Deterministic: same text = same embedding, never expires
-- Note: pgvector extension created via: CREATE EXTENSION IF NOT EXISTS vector
```

### Job Tracking
```sql
ci_ingestion_jobs (
  job_id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id          TEXT NOT NULL,
  trigger          TEXT NOT NULL,         -- manual | webhook | schedule
  status           TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed | partial
  from_commit      TEXT,
  to_commit        TEXT,
  changed_files    TEXT[],
  artifacts_stale  TEXT[],
  files_processed  INTEGER DEFAULT 0,
  files_skipped    INTEGER DEFAULT 0,
  tokens_consumed  INTEGER DEFAULT 0,
  error_message    TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (repo_id) REFERENCES ci_repositories(repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_jobs_repo_status ON ci_ingestion_jobs(repo_id, status);
```

---

## SHA TRACKING & DELTA MECHANISM

### Single-File Artifact
```
input_sha = file.current_sha
Stale if: artifact_input.file_sha != ci_repo_files.current_sha
```

### Multi-File Artifact (composite SHA)
```typescript
input_sha = SHA256(
  inputs.sort((a,b) => a.path.localeCompare(b.path))
        .map(f => `${f.path}:${f.sha}`)
        .join('|')
)
```

### LLM Cache Key
```
cache_key = SHA256(prompt_file_sha + composite_input_sha + model_name)
```

### Staleness Detection Flow
```
1. Fetch current HEAD SHA
2. Compare file tree SHAs → find changed_files
3. Update ci_repo_files.current_sha
4. Rebuild CIG for changed files only
5. Sweep ci_artifact_inputs → mark is_stale=true where input file SHA changed
6. Walk ci_artifact_dependencies → cascade stale marking
7. Queue regeneration in dependency-depth order
```

### Cascade Example
```
src/auth/login.ts SHA changes
  → CIG nodes/edges for this file rebuilt
  → Artifacts with this file in ci_artifact_inputs → is_stale=true
      → doc: "backend/auth" section
      → diagram: "api-flow"
      → qna: code chunks for this file
  → Cascade via ci_artifact_dependencies:
      → doc: "architecture" (depends on "backend/auth")
      → qna: doc-layer chunks for "backend/auth"
```

### Full vs Delta Run Decision
```typescript
if (!repo.last_commit_sha) → full run
if (changedFiles.length / totalFiles > 0.4) → full run (too many changes)
else → delta run
```

---

## CACHING LAYERS

| Layer | What | Key | Eviction |
|---|---|---|---|
| Clone cache | Shallow cloned repo on disk | repo_id | Commit SHA change or 24h TTL |
| CIG cache | ci_cig_nodes + edges in DB | (repo_id, file_path, file_sha) | File SHA change |
| LLM response cache | Raw LLM output | SHA256(prompt_version+input_sha+model) | Prompt version change |
| Embedding cache | Vector embeddings | SHA256(chunk_text) | Never (deterministic) |
| Query result cache | Top-K search results | SHA256(query_embedding+repo_id) | 5min TTL |

LLM cache is most impactful: unchanged files return from cache with zero API cost.

---

## PROCESSING PIPELINE (Full Flow)

```
User triggers "Analyze Repository"
  → Clone (shallow, --depth 1 or --depth 50 for delta)
  → Filter (exclude: node_modules, dist, lock files, binaries)
  → Classify repo (file tree + manifests, 1 LLM call)
  → Build CIG (AST parse, zero LLM)
  → Determine run type (full vs delta)
  → Mark stale artifacts + cascade
  → Process in parallel:
      DOCS: Run selected prompt modules in parallel
            → file docs (Phase 1)
            → module summaries (Phase 2)
            → architecture synthesis (Phase 3)
      DIAGRAMS: Run selected diagram modules
                → Pure AST diagrams (instant)
                → LLM diagrams (parallel)
      QnA: Chunk via CIG symbols
          → Check embedding cache
          → Embed new/changed chunks
          → Upsert ci_qna_embeddings
  → Update ci_artifacts, ci_artifact_inputs
  → Set repo status = 'ready', update last_commit_sha
```

---

## ERROR HANDLING STRATEGY

1. **Unparseable files**: Skip with a warning. Still tracked in `ci_repo_files` with `parse_status = 'skipped'` or `'error'`. The CIG is a best-effort graph — missing nodes for one file do not invalidate nodes for other files.

2. **Clone failures**: Mark the job as `failed` with an `error_message` field. Do not leave orphan state in the database. Update repo status to `error`.

3. **Partial CIG builds**: Valid. The CIG contains what could be parsed. `ci_ingestion_jobs` tracks `files_processed` and `files_skipped` counts. Job status is `partial` if some files failed but the pipeline completed.

4. **Job states**: `queued → running → completed | failed | partial`. `partial` means the pipeline finished but some files could not be processed.

5. **DB failures during pipeline**: If the DB goes down mid-ingestion, the job remains in `running` state. A health check on startup should sweep jobs stuck in `running` for longer than a configurable timeout (default 30 minutes) and mark them `failed`.

6. **LLM failures (Phase 2+)**: Retry with exponential backoff (max 3 retries). If still failing, mark the specific artifact with error status but continue processing other artifacts. Never block the entire generation run for one failing call.

---

## TESTING STRATEGY

- **Framework**: Jest (Backstage convention). Shared config at monorepo root.
- **Unit tests**: Mock all interfaces via constructor injection. Use simple in-memory mocks, not mocking libraries. The architecture makes this trivial — every service receives its dependencies via constructor.
- **DB tests**: Test `KnexStorageAdapter` against a real PostgreSQL instance. Use transactions for test isolation (begin before each test, rollback after). In CI, use Testcontainers or a dedicated test DB.
- **Tree-sitter tests**: Use fixture files in `test/fixtures/` — small, focused code snippets per language that exercise specific extraction patterns. Do not depend on external repos for unit tests.
- **Integration tests**: Use a small fixture repo (committed to `test/fixtures/sample-repo/`) for end-to-end ingestion pipeline tests.
- **Coverage**: No hard target for v1, but all public interface methods and core services should have tests.

---

## TECHNOLOGY STACK

| Component | Choice | Reason |
|---|---|---|
| Plugin framework | Backstage createBackendPlugin + createPlugin | Required for Backstage integration |
| AST parsing | Tree-sitter (Node.js bindings) | Multi-language, runs in Node.js |
| LLM | Claude API (configurable) | Best code reasoning, 200K context |
| Embeddings | text-embedding-3-small | Good code+text quality, cheap |
| Vector store | pgvector (PostgreSQL extension) | Same DB as Backstage, no new infra |
| Diagram format | Mermaid.js | Native Backstage TechDocs support |
| DB migrations | Knex.js | Backstage standard |
| Job queue | In-process initially, BullMQ for scale | Start simple |

---

## PHASE-WISE BUILD PLAN (SUMMARY)

Phase 1: Foundation — Infra, clone, CIG, DB, job scaffold
Phase 2: Documentation — Classifier, prompt modules, section gen, delta cache, frontend tab
Phase 3: Diagrams — Pure AST diagrams, LLM diagrams, diagram tab with Mermaid
Phase 4: QnA — Embeddings, vector search, chat UI, session management
Phase 5: Integration — Webhooks, cross-feature enrichment, on-demand diagrams
Phase 6: Release — Docs, contribution guide, npm publish

---

## KEY DESIGN DECISIONS

1. CIG is the single source of truth — built once, shared across all three features
2. Modular prompts — one file per doc section, declared inputs, separately versioned
3. Composite SHA for multi-input artifacts — deterministic staleness detection
4. LLM cache is content-addressed — same input = same output, never re-call
5. pgvector over standalone vector DB — no new infrastructure for open-source users
6. Pure AST diagrams first — high value, zero LLM cost, best demo for traction
7. Multi-layer QnA index — doc chunks retrieve better than raw code for conceptual queries
8. Unified ci_artifacts table — all three features use same staleness/caching mechanism
9. Delta run threshold at 40% — full run is cleaner above this
10. Prompt version tracked in cache key — improving prompts auto-invalidates stale docs
11. Framework-agnostic core — Backstage is a delivery adapter, not the foundation; all business logic in core packages with zero Backstage imports; SaaS path requires only new adapters + server wrapper, zero core changes
12. No tenant_id in DB — both Backstage plugin and standalone SaaS are self-hosted (one Postgres per deployment); infrastructure isolation is sufficient; no row-level multi-tenancy needed
13. All I/O behind interfaces — LLM, embeddings, vector store, repo, storage, job queue are interfaces in core; concrete implementations live only in adapter packages

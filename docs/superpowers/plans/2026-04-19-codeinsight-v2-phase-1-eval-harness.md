# CodeInsight v2 — Phase 1: Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evaluation harness that scores CodeInsight ingestion output (docs, diagrams, QnA) against a hand-curated gold set, producing per-repo scores and cost/latency metrics in a reproducible way. After this phase, every pipeline change has a measurable before/after number.

**Architecture:** New package `@codeinsight/eval` sits alongside existing core packages. It consumes a small, version-agnostic `PipelineAdapter` interface so the same runner works against the current v1 pipeline (this phase) and the future v2 pipeline (later phases). Scorers are pure: given an `Artifact` / `VectorChunk[]` / `answer`, they return a score in `[0, 1]` plus a structured breakdown. Gold fixtures live on disk as JSON + markdown files pinned to specific commit SHAs.

**Tech Stack:** TypeScript, Jest, `simple-git` (already in use), `commander` for CLI, anthropic/openai SDKs (existing `@codeinsight/llm` adapter) for LLM-as-judge, `mermaid` package for Mermaid AST parsing.

**Spec:** `docs/superpowers/specs/2026-04-19-codeinsight-v2-design.md` (§5, §12 Phase 1).

---

## File Structure

**New files (all under `packages/core/eval/`):**

| Path | Responsibility |
|---|---|
| `package.json` | Package manifest (`@codeinsight/eval`) |
| `tsconfig.json` | Extends root tsconfig |
| `jest.config.js` | Jest config pointing at root `jest.config.js` |
| `src/index.ts` | Package barrel |
| `src/types.ts` | Public types: `RepoFixture`, `ExpectedOverview`, `ExpectedArchitecture`, `ExpectedDiagrams`, `QaPair`, `EvalReport`, `PipelineAdapter` |
| `src/fixtureLoader.ts` | `loadFixture(dir: string): Promise<RepoFixture>` — reads + validates the on-disk fixture layout |
| `src/costTracker.ts` | `CostTracker` — accumulates tokens × per-model prices; produces a cost summary |
| `src/scorers/docScorer.ts` | Scores doc artifacts using LLM-as-judge against expected bullets |
| `src/scorers/diagramScorer.ts` | Parses Mermaid and checks for expected labels/edges/entities |
| `src/scorers/qnaScorer.ts` | Scores answer + retrieval (Recall@N, must-include facts, hallucination flag) |
| `src/scorers/llmJudge.ts` | Shared LLM-judge wrapper (deterministic prompt, temperature 0, JSON schema output) |
| `src/runner.ts` | `runEval(fixture, adapter, opts)` — orchestrates ingestion, generation, scoring |
| `src/reportWriter.ts` | Writes `report.json` + `report.md` |
| `src/cli.ts` | CLI entry: `eval run`, `eval baseline`, `eval compare` |
| `src/adapters/v1Adapter.ts` | `PipelineAdapter` implementation that drives the current v1 pipeline |
| `fixtures/_template/` | Template fixture directory with placeholder files, copied to create new fixtures |
| `fixtures/small-ts/repo.json` | Gold fixture 1 — small TS service |
| `fixtures/small-ts/expected-overview.json` | Expected overview bullets |
| `fixtures/small-ts/expected-architecture.json` | Expected subsystems + external deps |
| `fixtures/small-ts/expected-diagrams.json` | Expected diagram labels/edges/entities |
| `fixtures/small-ts/qa-pairs.json` | Expected QA pairs |
| `fixtures/medium-react/…` | Gold fixture 2 — same layout |
| `fixtures/complex/…` | Gold fixture 3 (openclaw or chosen equivalent) — same layout |
| `src/__tests__/fixtureLoader.test.ts` | Tests for fixture loader |
| `src/__tests__/costTracker.test.ts` | Tests for cost tracker |
| `src/__tests__/docScorer.test.ts` | Tests for doc scorer with mocked LLM judge |
| `src/__tests__/diagramScorer.test.ts` | Tests for diagram scorer (deterministic) |
| `src/__tests__/qnaScorer.test.ts` | Tests for QnA scorer with mocked LLM judge |
| `src/__tests__/runner.test.ts` | Tests for runner with mock `PipelineAdapter` |
| `src/__tests__/reportWriter.test.ts` | Tests for report output shape |
| `README.md` | How to run, how to add a fixture |

**Modified files:**

| Path | Change |
|---|---|
| `pnpm-workspace.yaml` | Already globs `packages/core/*` — no change unless workspace file is stricter; verify |
| `package.json` (root) | Add `"eval"` scripts group: `eval:run`, `eval:baseline`, `eval:compare` |
| `docs/build-plan.md` | Append Phase 8 section with sub-phase 8.1 = Eval Harness; mark 8.1 complete at end |

---

## Ground rules for this plan

- **Test framework:** Jest (root config). Every service has a unit test. Integration test for the runner uses a mock `PipelineAdapter` — we do NOT hit a real repo or LLM in unit tests.
- **Live runs** (actually cloning gold repos, running v1 ingestion, hitting real LLMs) are done manually via `pnpm eval run` after unit tests pass — these are NOT unit tests.
- **TDD:** every task starts by writing the failing test, then makes it pass.
- **Frequent commits:** each task ends in a commit. Never batch.
- **No dead code:** this is a greenfield package — nothing to delete this phase. Later phases will audit the `packages/core/eval/` for any drift.
- **Do NOT commit the fixtures directory contents without reading them** — they contain URLs, SHAs, human-curated text only.

---

## Task 1: Scaffold `@codeinsight/eval` package

**Files:**
- Create: `packages/core/eval/package.json`
- Create: `packages/core/eval/tsconfig.json`
- Create: `packages/core/eval/jest.config.js`
- Create: `packages/core/eval/src/index.ts`
- Create: `packages/core/eval/README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@codeinsight/eval",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@codeinsight/types": "workspace:*",
    "@codeinsight/llm": "workspace:*",
    "commander": "^12.0.0",
    "mermaid": "^10.9.0",
    "simple-git": "^3.24.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "**/*.test.ts", "**/__tests__/**"],
  "references": [
    { "path": "../types" },
    { "path": "../../adapters/llm" }
  ]
}
```

- [ ] **Step 3: Create `jest.config.js`**

```javascript
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
};
```

- [ ] **Step 4: Create `src/index.ts` barrel**

```typescript
export * from './types';
export { loadFixture } from './fixtureLoader';
export { CostTracker } from './costTracker';
export { runEval } from './runner';
export { writeReport } from './reportWriter';
```

- [ ] **Step 5: Create minimal `README.md`**

```markdown
# @codeinsight/eval

Evaluation harness for CodeInsight. Scores doc, diagram, and QnA output against
a hand-curated gold set of repositories.

## Running

    pnpm eval:run                  # all gold repos, current pipeline
    pnpm eval:run -- --repo small  # single repo
    pnpm eval:baseline             # lock a baseline report
    pnpm eval:compare -- --baseline eval/reports/2026-04-19-baseline.json

## Adding a fixture

Copy `fixtures/_template/` to `fixtures/<new-slug>/` and fill in the JSON files.
Each fixture is pinned to a specific commit SHA for reproducibility.

See `docs/superpowers/specs/2026-04-19-codeinsight-v2-design.md` §5 for schemas.
```

- [ ] **Step 6: Install + build**

Run: `pnpm install && pnpm --filter @codeinsight/eval build`
Expected: exits 0, `dist/index.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/core/eval/
git commit -m "feat(eval): scaffold @codeinsight/eval package"
```

---

## Task 2: Define fixture and report types

**Files:**
- Create: `packages/core/eval/src/types.ts`

- [ ] **Step 1: Write the types**

```typescript
import type { Artifact, VectorChunk } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Fixture types — what lives on disk in fixtures/<slug>/
// ---------------------------------------------------------------------------

export interface RepoFixtureMeta {
  slug: string;             // directory name
  gitUrl: string;           // https clone URL
  commitSha: string;        // pinned SHA
  description: string;      // one-line human description
  sizeCategory: 'small' | 'medium' | 'complex';
  fileCountApprox: number;  // rough file count at pinned SHA, for cost projection
}

export interface ExpectedOverview {
  bullets: string[];        // 3-6 high-level facts the overview MUST mention
}

export interface ExpectedSubsystem {
  name: string;             // e.g. "Authentication"
  mustMentionFiles: string[]; // at least one of these file paths must appear
}

export interface ExpectedArchitecture {
  subsystems: ExpectedSubsystem[];
  externalDependencies: string[];
}

export interface ExpectedDiagramEdge {
  from: string;
  to: string;
}

export interface ExpectedSystemArchDiagram {
  mustContainLabels: string[];
  mustContainEdges: ExpectedDiagramEdge[];
}

export interface ExpectedDataModelDiagram {
  mustContainEntities: string[];
}

export interface ExpectedKeyFlow {
  name: string;
  mustContainSteps: string[];
}

export interface ExpectedDiagrams {
  systemArchitecture: ExpectedSystemArchDiagram;
  dataModel: ExpectedDataModelDiagram | null;
  keyFlows: ExpectedKeyFlow[];
}

export interface QaPair {
  question: string;
  expectedFiles: string[];       // any retrieved chunk whose filePath matches counts
  mustIncludeFacts: string[];    // each fact is a required claim in the answer
  shouldNotHallucinate: string[];// phrases that should NOT appear (optional; empty list OK)
}

export interface RepoFixture {
  meta: RepoFixtureMeta;
  expectedOverview: ExpectedOverview;
  expectedArchitecture: ExpectedArchitecture;
  expectedDiagrams: ExpectedDiagrams;
  qaPairs: QaPair[];
}

// ---------------------------------------------------------------------------
// Report types — what runner + reportWriter emit
// ---------------------------------------------------------------------------

export interface FactScore {
  fact: string;
  score: 0 | 0.5 | 1;
  reason: string;
}

export interface DocScore {
  module: 'overview' | 'architecture' | 'reference';
  overall: number;              // mean of factScores
  factScores: FactScore[];
}

export interface DiagramCheck {
  type: 'systemArchitecture' | 'dataModel' | 'keyFlows';
  passed: number;
  total: number;
  missing: string[];            // labels/edges/entities/steps that were expected but not found
}

export interface QaScoreDetail {
  question: string;
  recallAt10: number;           // 0..1
  completeness: number;         // 0..1
  hallucinationCount: number;
  retrievedFilePaths: string[];
  answer: string;
}

export interface QaScore {
  overall: number;              // mean of (recallAt10 + completeness) / 2 - (hallucinationCount > 0 ? 0.2 : 0)
  details: QaScoreDetail[];
}

export interface CostSummary {
  chatRequests: number;
  chatInputTokens: number;
  chatOutputTokens: number;
  chatUsd: number;
  embeddingRequests: number;
  embeddingInputTokens: number;
  embeddingUsd: number;
  totalUsd: number;
}

export interface RepoReport {
  fixtureSlug: string;
  commitSha: string;
  pipelineVersion: string;      // e.g. "v1" or "v2"
  doc: DocScore[];              // one per module
  diagram: DiagramCheck[];      // one per diagram type
  qna: QaScore;
  cost: CostSummary;
  wallClockSeconds: number;
  timestamp: string;            // ISO date
}

export interface EvalReport {
  generatedAt: string;
  pipelineVersion: string;
  repos: RepoReport[];
}

// ---------------------------------------------------------------------------
// PipelineAdapter — version-agnostic interface runner talks to
// ---------------------------------------------------------------------------

export interface PipelineAdapter {
  /** Register + ingest the repo. Returns when artifacts exist and indexing is done. */
  ingest(meta: RepoFixtureMeta, cloneDir: string): Promise<void>;
  /** Retrieve the doc artifacts that ingestion produced. */
  getDocArtifacts(repoSlug: string): Promise<Artifact[]>;
  /** Retrieve the diagram artifacts that ingestion produced. */
  getDiagramArtifacts(repoSlug: string): Promise<Artifact[]>;
  /** Ask a QnA question and return the answer + the chunks that grounded it. */
  askQna(repoSlug: string, question: string): Promise<{ answer: string; retrievedChunks: VectorChunk[] }>;
  /** Stable string for the pipeline version — goes into RepoReport.pipelineVersion. */
  readonly version: string;
}
```

- [ ] **Step 2: Build — no separate test for plain types**

Run: `pnpm --filter @codeinsight/eval build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/eval/src/types.ts
git commit -m "feat(eval): define fixture + report + adapter types"
```

---

## Task 3: Fixture loader with validation

**Files:**
- Create: `packages/core/eval/src/fixtureLoader.ts`
- Test: `packages/core/eval/src/__tests__/fixtureLoader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/fixtureLoader.test.ts
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadFixture } from '../fixtureLoader';

async function writeJson(path: string, obj: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
}

describe('loadFixture', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eval-fixture-'));
    await mkdir(join(tmp, 'small'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads a well-formed fixture', async () => {
    const dir = join(tmp, 'small');
    await writeJson(join(dir, 'repo.json'), {
      gitUrl: 'https://github.com/example/small.git',
      commitSha: 'abc123',
      description: 'A tiny service',
      sizeCategory: 'small',
      fileCountApprox: 40,
    });
    await writeJson(join(dir, 'expected-overview.json'), {
      bullets: ['Does thing A', 'Uses lib B'],
    });
    await writeJson(join(dir, 'expected-architecture.json'), {
      subsystems: [{ name: 'Core', mustMentionFiles: ['src/index.ts'] }],
      externalDependencies: ['express'],
    });
    await writeJson(join(dir, 'expected-diagrams.json'), {
      systemArchitecture: { mustContainLabels: ['API'], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    });
    await writeJson(join(dir, 'qa-pairs.json'), [
      {
        question: 'What is this?',
        expectedFiles: ['src/index.ts'],
        mustIncludeFacts: ['it does thing A'],
        shouldNotHallucinate: [],
      },
    ]);

    const fixture = await loadFixture(dir);

    expect(fixture.meta.slug).toBe('small');
    expect(fixture.meta.gitUrl).toBe('https://github.com/example/small.git');
    expect(fixture.expectedOverview.bullets).toHaveLength(2);
    expect(fixture.qaPairs).toHaveLength(1);
  });

  it('throws a clear error when a required file is missing', async () => {
    const dir = join(tmp, 'small');
    // Only write repo.json
    await writeJson(join(dir, 'repo.json'), {
      gitUrl: 'https://x', commitSha: 's', description: 'd',
      sizeCategory: 'small', fileCountApprox: 1,
    });

    await expect(loadFixture(dir)).rejects.toThrow(
      /expected-overview\.json/,
    );
  });

  it('throws when repo.json fields are missing', async () => {
    const dir = join(tmp, 'small');
    await writeJson(join(dir, 'repo.json'), { gitUrl: 'x' }); // missing commitSha
    await writeJson(join(dir, 'expected-overview.json'), { bullets: [] });
    await writeJson(join(dir, 'expected-architecture.json'), { subsystems: [], externalDependencies: [] });
    await writeJson(join(dir, 'expected-diagrams.json'), {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null, keyFlows: [],
    });
    await writeJson(join(dir, 'qa-pairs.json'), []);

    await expect(loadFixture(dir)).rejects.toThrow(/commitSha/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=fixtureLoader`
Expected: FAIL with "Cannot find module '../fixtureLoader'".

- [ ] **Step 3: Write `fixtureLoader.ts`**

```typescript
// packages/core/eval/src/fixtureLoader.ts
import { readFile } from 'fs/promises';
import { basename, join } from 'path';

import type {
  ExpectedArchitecture,
  ExpectedDiagrams,
  ExpectedOverview,
  QaPair,
  RepoFixture,
  RepoFixtureMeta,
} from './types';

const REQUIRED_FILES = [
  'repo.json',
  'expected-overview.json',
  'expected-architecture.json',
  'expected-diagrams.json',
  'qa-pairs.json',
] as const;

export async function loadFixture(fixtureDir: string): Promise<RepoFixture> {
  const slug = basename(fixtureDir);

  // Read + parse all required files, surfacing missing-file errors first
  const contents: Record<string, unknown> = {};
  for (const file of REQUIRED_FILES) {
    const path = join(fixtureDir, file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch (err) {
      throw new Error(
        `Fixture ${slug}: missing required file ${file} at ${path}`,
      );
    }
    try {
      contents[file] = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Fixture ${slug}: ${file} is not valid JSON: ${String(err)}`);
    }
  }

  const metaRaw = contents['repo.json'] as Partial<RepoFixtureMeta>;
  requireString(slug, 'repo.json', 'gitUrl', metaRaw.gitUrl);
  requireString(slug, 'repo.json', 'commitSha', metaRaw.commitSha);
  requireString(slug, 'repo.json', 'description', metaRaw.description);
  requireString(slug, 'repo.json', 'sizeCategory', metaRaw.sizeCategory);
  if (typeof metaRaw.fileCountApprox !== 'number') {
    throw new Error(`Fixture ${slug}: repo.json: fileCountApprox must be a number`);
  }

  const meta: RepoFixtureMeta = {
    slug,
    gitUrl: metaRaw.gitUrl!,
    commitSha: metaRaw.commitSha!,
    description: metaRaw.description!,
    sizeCategory: metaRaw.sizeCategory as RepoFixtureMeta['sizeCategory'],
    fileCountApprox: metaRaw.fileCountApprox,
  };

  return {
    meta,
    expectedOverview: contents['expected-overview.json'] as ExpectedOverview,
    expectedArchitecture: contents['expected-architecture.json'] as ExpectedArchitecture,
    expectedDiagrams: contents['expected-diagrams.json'] as ExpectedDiagrams,
    qaPairs: contents['qa-pairs.json'] as QaPair[],
  };
}

function requireString(slug: string, file: string, field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Fixture ${slug}: ${file}: ${field} is required and must be a non-empty string`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=fixtureLoader`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/fixtureLoader.ts packages/core/eval/src/__tests__/fixtureLoader.test.ts
git commit -m "feat(eval): fixture loader with strict schema validation"
```

---

## Task 4: Cost tracker

**Files:**
- Create: `packages/core/eval/src/costTracker.ts`
- Test: `packages/core/eval/src/__tests__/costTracker.test.ts`

Prices hard-coded in cents-per-million-tokens, indexed by model slug. Unknown models fall back to zero (with a logged warning) so we never crash — but the report will be wrong, so the warning matters.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/costTracker.test.ts
import { CostTracker } from '../costTracker';

describe('CostTracker', () => {
  it('accumulates chat tokens and computes cost', () => {
    const t = new CostTracker();
    t.recordChat('claude-sonnet-4-6', 3000, 1500);
    t.recordChat('claude-sonnet-4-6', 1000, 500);

    const s = t.summary();
    expect(s.chatRequests).toBe(2);
    expect(s.chatInputTokens).toBe(4000);
    expect(s.chatOutputTokens).toBe(2000);
    // sonnet: $3/M in, $15/M out → 4000*3e-6 + 2000*15e-6 = 0.012 + 0.030 = 0.042
    expect(s.chatUsd).toBeCloseTo(0.042, 4);
  });

  it('accumulates embedding tokens and computes cost', () => {
    const t = new CostTracker();
    t.recordEmbedding('text-embedding-3-small', 100000);
    const s = t.summary();
    expect(s.embeddingRequests).toBe(1);
    expect(s.embeddingInputTokens).toBe(100000);
    // small: $0.02/M → 100000 * 0.02e-6 = 0.002
    expect(s.embeddingUsd).toBeCloseTo(0.002, 4);
  });

  it('totalUsd combines chat + embedding', () => {
    const t = new CostTracker();
    t.recordChat('claude-haiku-4-5', 1_000_000, 0);   // $0.80
    t.recordEmbedding('text-embedding-3-small', 1_000_000); // $0.02
    const s = t.summary();
    expect(s.totalUsd).toBeCloseTo(0.82, 3);
  });

  it('treats unknown models as zero cost but still counts tokens', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new CostTracker();
    t.recordChat('mystery-model', 1000, 500);
    const s = t.summary();
    expect(s.chatInputTokens).toBe(1000);
    expect(s.chatOutputTokens).toBe(500);
    expect(s.chatUsd).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mystery-model/));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=costTracker`
Expected: FAIL with "Cannot find module '../costTracker'".

- [ ] **Step 3: Write `costTracker.ts`**

```typescript
// packages/core/eval/src/costTracker.ts
import type { CostSummary } from './types';

// USD per million tokens. Updated 2026-04-19.
// Sources: Anthropic + OpenAI public pricing pages. Keep in sync with config defaults.
const CHAT_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, output:  4.00 },
  'gpt-4.1':           { input:  2.50, output: 10.00 },
  'gpt-4.1-mini':      { input:  0.15, output:  0.60 },
  'gpt-4o':            { input:  2.50, output: 10.00 },
};

const EMBED_PRICES: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
};

export class CostTracker {
  private _chatRequests = 0;
  private _chatInput = 0;
  private _chatOutput = 0;
  private _chatUsd = 0;
  private _embedRequests = 0;
  private _embedInput = 0;
  private _embedUsd = 0;

  recordChat(model: string, inputTokens: number, outputTokens: number): void {
    this._chatRequests += 1;
    this._chatInput += inputTokens;
    this._chatOutput += outputTokens;

    const price = CHAT_PRICES[model];
    if (!price) {
      console.warn(`CostTracker: unknown chat model "${model}" — cost reported as 0`);
      return;
    }
    this._chatUsd += (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  recordEmbedding(model: string, inputTokens: number): void {
    this._embedRequests += 1;
    this._embedInput += inputTokens;

    const price = EMBED_PRICES[model];
    if (!price) {
      console.warn(`CostTracker: unknown embedding model "${model}" — cost reported as 0`);
      return;
    }
    this._embedUsd += (inputTokens * price) / 1_000_000;
  }

  summary(): CostSummary {
    return {
      chatRequests:       this._chatRequests,
      chatInputTokens:    this._chatInput,
      chatOutputTokens:   this._chatOutput,
      chatUsd:            this._chatUsd,
      embeddingRequests:  this._embedRequests,
      embeddingInputTokens: this._embedInput,
      embeddingUsd:       this._embedUsd,
      totalUsd:           this._chatUsd + this._embedUsd,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=costTracker`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/costTracker.ts packages/core/eval/src/__tests__/costTracker.test.ts
git commit -m "feat(eval): cost tracker for chat + embedding usage"
```

---

## Task 5: LLM-judge wrapper

Shared wrapper used by doc + QnA scorers. Reads an `LLMClient` (existing interface) and issues a strict-schema judge call.

**Files:**
- Create: `packages/core/eval/src/scorers/llmJudge.ts`
- Test: `packages/core/eval/src/__tests__/llmJudge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/llmJudge.test.ts
import type { LLMClient } from '@codeinsight/types';

import { judgeFactPresence } from '../scorers/llmJudge';

function mockLLM(response: string): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue(response),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

describe('judgeFactPresence', () => {
  it('parses valid JSON and returns per-fact scores', async () => {
    const llm = mockLLM(JSON.stringify({
      results: [
        { fact: 'does A', score: 1, reason: 'explicitly says so' },
        { fact: 'does B', score: 0, reason: 'not mentioned' },
      ],
    }));

    const results = await judgeFactPresence(llm, 'some markdown', ['does A', 'does B']);

    expect(results).toEqual([
      { fact: 'does A', score: 1, reason: 'explicitly says so' },
      { fact: 'does B', score: 0, reason: 'not mentioned' },
    ]);
  });

  it('throws on malformed JSON', async () => {
    const llm = mockLLM('not json');
    await expect(judgeFactPresence(llm, 'x', ['f'])).rejects.toThrow(/JSON/);
  });

  it('throws when returned results length mismatches input facts', async () => {
    const llm = mockLLM(JSON.stringify({ results: [{ fact: 'a', score: 1, reason: 'ok' }] }));
    await expect(judgeFactPresence(llm, 'x', ['a', 'b'])).rejects.toThrow(/length/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=llmJudge`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `llmJudge.ts`**

```typescript
// packages/core/eval/src/scorers/llmJudge.ts
import type { LLMClient } from '@codeinsight/types';

import type { FactScore } from '../types';

const SYSTEM_PROMPT = `You are a strict grader for a documentation evaluation pipeline.
You receive (a) a piece of generated documentation and (b) a list of facts the documentation is expected to convey.
For each fact, judge whether it is clearly present (score 1), partially/implicitly present (score 0.5), or absent/wrong (score 0).
Return JSON ONLY, matching this shape exactly:
{"results": [{"fact": string, "score": 0|0.5|1, "reason": string (<=120 chars)}, ...]}
Return the same facts in the same order. Do not return markdown or prose.`;

export async function judgeFactPresence(
  llm: LLMClient,
  generatedText: string,
  facts: string[],
): Promise<FactScore[]> {
  const userPrompt =
    `Documentation to evaluate:\n---\n${generatedText}\n---\n\nFacts (in order):\n` +
    facts.map((f, i) => `${i + 1}. ${f}`).join('\n') +
    `\n\nReturn JSON only.`;

  const raw = await llm.complete(SYSTEM_PROMPT, userPrompt, {
    maxTokens: 1500,
    temperature: 0,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`judgeFactPresence: LLM returned invalid JSON: ${String(err)}`);
  }

  const results = (parsed as { results?: FactScore[] }).results;
  if (!Array.isArray(results)) {
    throw new Error('judgeFactPresence: response missing "results" array');
  }
  if (results.length !== facts.length) {
    throw new Error(
      `judgeFactPresence: results length ${results.length} mismatches facts length ${facts.length}`,
    );
  }

  // Coerce score to a legal value; reject anything else
  return results.map((r, i) => {
    const score = r.score === 1 || r.score === 0.5 || r.score === 0 ? r.score : null;
    if (score === null) {
      throw new Error(`judgeFactPresence: result ${i} has invalid score ${String(r.score)}`);
    }
    return {
      fact: facts[i],
      score,
      reason: typeof r.reason === 'string' ? r.reason : '',
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=llmJudge`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/scorers/llmJudge.ts packages/core/eval/src/__tests__/llmJudge.test.ts
git commit -m "feat(eval): llm-judge wrapper for fact-presence scoring"
```

---

## Task 6: Doc scorer

**Files:**
- Create: `packages/core/eval/src/scorers/docScorer.ts`
- Test: `packages/core/eval/src/__tests__/docScorer.test.ts`

Scores each of the 3 doc modules (overview, architecture, reference) against the fixture's expected facts. For v1 (this phase): `overview` is scored against `expectedOverview.bullets`; `architecture` is scored against a flat list derived from `expectedArchitecture.subsystems[].name + externalDependencies`; `reference` is not scored in v1 (returns `{module:'reference', overall: null}` which we skip in aggregation — see handling below).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/docScorer.test.ts
import type { Artifact, LLMClient } from '@codeinsight/types';

import { scoreDocs } from '../scorers/docScorer';
import type { ExpectedArchitecture, ExpectedOverview } from '../types';

function mockLLM(responses: string[]): LLMClient {
  let i = 0;
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(responses[i++])),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

function docArtifact(module: string, markdown: string): Artifact {
  return {
    repoId: 'r',
    artifactId: module,
    artifactType: 'doc',
    content: { kind: 'doc', module, markdown },
    inputSha: 'x',
    promptVersion: null,
    generationSig: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 100,
    llmUsed: true,
    generatedAt: new Date(),
  };
}

describe('scoreDocs', () => {
  const overview: ExpectedOverview = { bullets: ['is a web service', 'uses postgres'] };
  const arch: ExpectedArchitecture = {
    subsystems: [
      { name: 'API', mustMentionFiles: [] },
      { name: 'Worker', mustMentionFiles: [] },
    ],
    externalDependencies: ['postgres'],
  };

  it('returns scores for overview and architecture modules found in artifacts', async () => {
    const artifacts: Artifact[] = [
      docArtifact('overview', '# Overview\nIt is a web service using Postgres.'),
      docArtifact('architecture', '# Arch\nAPI and Worker subsystems talk to Postgres.'),
    ];
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'is a web service', score: 1, reason: 'said' },
        { fact: 'uses postgres', score: 1, reason: 'said' },
      ]}),
      JSON.stringify({ results: [
        { fact: 'mentions subsystem API', score: 1, reason: 'said' },
        { fact: 'mentions subsystem Worker', score: 1, reason: 'said' },
        { fact: 'mentions external dependency postgres', score: 1, reason: 'said' },
      ]}),
    ]);

    const result = await scoreDocs(artifacts, overview, arch, llm);

    expect(result).toHaveLength(2);
    expect(result[0].module).toBe('overview');
    expect(result[0].overall).toBe(1);
    expect(result[1].module).toBe('architecture');
    expect(result[1].overall).toBe(1);
  });

  it('gives zero overall for missing modules', async () => {
    const llm = mockLLM([]);
    const result = await scoreDocs([], overview, arch, llm);
    expect(result).toEqual([
      { module: 'overview', overall: 0, factScores: [] },
      { module: 'architecture', overall: 0, factScores: [] },
    ]);
  });

  it('averages per-fact scores', async () => {
    const artifacts = [docArtifact('overview', '# X')];
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'is a web service', score: 1, reason: '' },
        { fact: 'uses postgres', score: 0, reason: '' },
      ]}),
    ]);

    const result = await scoreDocs(artifacts, overview, { subsystems: [], externalDependencies: [] }, llm);
    expect(result[0].overall).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=docScorer`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `docScorer.ts`**

```typescript
// packages/core/eval/src/scorers/docScorer.ts
import type { Artifact, LLMClient } from '@codeinsight/types';

import type { DocScore, ExpectedArchitecture, ExpectedOverview } from '../types';

import { judgeFactPresence } from './llmJudge';

type DocModule = 'overview' | 'architecture' | 'reference';

export async function scoreDocs(
  artifacts: Artifact[],
  expectedOverview: ExpectedOverview,
  expectedArchitecture: ExpectedArchitecture,
  judgeLlm: LLMClient,
): Promise<DocScore[]> {
  const byModule = new Map<string, Artifact>();
  for (const a of artifacts) {
    if (a.content && a.content.kind === 'doc') {
      byModule.set(a.content.module, a);
    }
  }

  const overviewScore = await scoreOverview(byModule.get('overview'), expectedOverview, judgeLlm);
  const archScore = await scoreArchitecture(byModule.get('architecture'), expectedArchitecture, judgeLlm);

  return [overviewScore, archScore];
}

async function scoreOverview(
  artifact: Artifact | undefined,
  expected: ExpectedOverview,
  judgeLlm: LLMClient,
): Promise<DocScore> {
  if (!artifact || !artifact.content || artifact.content.kind !== 'doc') {
    return { module: 'overview', overall: 0, factScores: [] };
  }
  if (expected.bullets.length === 0) {
    return { module: 'overview', overall: 0, factScores: [] };
  }

  const scores = await judgeFactPresence(judgeLlm, artifact.content.markdown, expected.bullets);
  const overall = scores.reduce((s, f) => s + f.score, 0) / scores.length;
  return { module: 'overview', overall, factScores: scores };
}

async function scoreArchitecture(
  artifact: Artifact | undefined,
  expected: ExpectedArchitecture,
  judgeLlm: LLMClient,
): Promise<DocScore> {
  if (!artifact || !artifact.content || artifact.content.kind !== 'doc') {
    return { module: 'architecture', overall: 0, factScores: [] };
  }

  const facts = [
    ...expected.subsystems.map(s => `mentions subsystem ${s.name}`),
    ...expected.externalDependencies.map(d => `mentions external dependency ${d}`),
  ];

  if (facts.length === 0) {
    return { module: 'architecture', overall: 0, factScores: [] };
  }

  const scores = await judgeFactPresence(judgeLlm, artifact.content.markdown, facts);
  const overall = scores.reduce((s, f) => s + f.score, 0) / scores.length;
  return { module: 'architecture', overall, factScores: scores };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=docScorer`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/scorers/docScorer.ts packages/core/eval/src/__tests__/docScorer.test.ts
git commit -m "feat(eval): doc scorer using llm-judge on overview + architecture"
```

---

## Task 7: Diagram scorer (deterministic)

Parses Mermaid artifacts and checks for expected labels, edges, entities, steps. No LLM involved.

**Files:**
- Create: `packages/core/eval/src/scorers/diagramScorer.ts`
- Test: `packages/core/eval/src/__tests__/diagramScorer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/diagramScorer.test.ts
import type { Artifact } from '@codeinsight/types';

import { scoreDiagrams } from '../scorers/diagramScorer';
import type { ExpectedDiagrams } from '../types';

function diagramArtifact(diagramType: string, mermaid: string, title = diagramType): Artifact {
  return {
    repoId: 'r',
    artifactId: `diagram:${diagramType}`,
    artifactType: 'diagram',
    content: { kind: 'diagram', diagramType, mermaid, title, description: '', llmUsed: true },
    inputSha: 'x',
    promptVersion: null,
    generationSig: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 0,
    llmUsed: true,
    generatedAt: new Date(),
  };
}

describe('scoreDiagrams', () => {
  it('scores system architecture by label + edge presence', () => {
    const mermaid = `flowchart TD
      API[API Layer] --> DB[(Postgres)]
      API --> Q[Queue]`;
    const artifacts = [diagramArtifact('system-architecture', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: {
        mustContainLabels: ['API Layer', 'Postgres'],
        mustContainEdges: [{ from: 'API', to: 'DB' }],
      },
      dataModel: null,
      keyFlows: [],
    };

    const result = scoreDiagrams(artifacts, expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.total).toBe(3); // 2 labels + 1 edge
    expect(sysArch.passed).toBe(3);
    expect(sysArch.missing).toEqual([]);
  });

  it('reports missing labels + edges', () => {
    const mermaid = `flowchart TD\n  A[Alpha] --> B[Beta]`;
    const artifacts = [diagramArtifact('system-architecture', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: {
        mustContainLabels: ['Alpha', 'Gamma'],
        mustContainEdges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
      },
      dataModel: null,
      keyFlows: [],
    };
    const result = scoreDiagrams(artifacts, expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.passed).toBe(2);   // Alpha label + A->B edge
    expect(sysArch.total).toBe(4);
    expect(sysArch.missing).toEqual(['label:Gamma', 'edge:A->C']);
  });

  it('scores data model by entity presence', () => {
    const mermaid = `erDiagram
      USER { int id string name }
      ORDER { int id }
      USER ||--o{ ORDER : places`;
    const artifacts = [diagramArtifact('data-model', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: { mustContainEntities: ['USER', 'ORDER', 'PRODUCT'] },
      keyFlows: [],
    };
    const result = scoreDiagrams(artifacts, expected);
    const dm = result.find(r => r.type === 'dataModel')!;
    expect(dm.passed).toBe(2);
    expect(dm.total).toBe(3);
    expect(dm.missing).toEqual(['entity:PRODUCT']);
  });

  it('scores key flows by step substring presence across all keyflow diagrams', () => {
    const authFlow = `flowchart LR
      U[User] --> L[Login] --> V[Verify JWT] --> S[Session]`;
    const artifacts = [diagramArtifact('key-flow-auth', authFlow)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [
        { name: 'auth', mustContainSteps: ['Login', 'Verify JWT', 'Forgot Password'] },
      ],
    };
    const result = scoreDiagrams(artifacts, expected);
    const kf = result.find(r => r.type === 'keyFlows')!;
    expect(kf.passed).toBe(2);
    expect(kf.total).toBe(3);
    expect(kf.missing).toEqual(['flow:auth:step:Forgot Password']);
  });

  it('returns zero-passed check when the diagram artifact is missing entirely', () => {
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: ['API'], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    };
    const result = scoreDiagrams([], expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.passed).toBe(0);
    expect(sysArch.total).toBe(1);
    expect(sysArch.missing).toEqual(['label:API']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=diagramScorer`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `diagramScorer.ts`**

String matching is substring, case-insensitive, whitespace-tolerant. Edge matching looks for `from --> to` OR `from -- text --> to` in the raw Mermaid (good enough; we already require round-trippable node IDs in the spec).

```typescript
// packages/core/eval/src/scorers/diagramScorer.ts
import type { Artifact } from '@codeinsight/types';

import type { DiagramCheck, ExpectedDiagrams } from '../types';

export function scoreDiagrams(
  artifacts: Artifact[],
  expected: ExpectedDiagrams,
): DiagramCheck[] {
  const diagramsByType = indexDiagrams(artifacts);

  return [
    scoreSystemArch(diagramsByType, expected),
    scoreDataModel(diagramsByType, expected),
    scoreKeyFlows(diagramsByType, expected),
  ];
}

function indexDiagrams(artifacts: Artifact[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of artifacts) {
    if (a.content && a.content.kind === 'diagram') {
      out.set(a.content.diagramType, a.content.mermaid);
    }
  }
  return out;
}

function scoreSystemArch(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  const mermaid = diagrams.get('system-architecture') ?? '';
  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const label of expected.systemArchitecture.mustContainLabels) {
    total++;
    if (containsSubstring(mermaid, label)) passed++;
    else missing.push(`label:${label}`);
  }

  for (const edge of expected.systemArchitecture.mustContainEdges) {
    total++;
    if (containsEdge(mermaid, edge.from, edge.to)) passed++;
    else missing.push(`edge:${edge.from}->${edge.to}`);
  }

  return { type: 'systemArchitecture', passed, total, missing };
}

function scoreDataModel(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  if (!expected.dataModel) {
    return { type: 'dataModel', passed: 0, total: 0, missing: [] };
  }
  const mermaid = diagrams.get('data-model') ?? '';
  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const entity of expected.dataModel.mustContainEntities) {
    total++;
    if (containsSubstring(mermaid, entity)) passed++;
    else missing.push(`entity:${entity}`);
  }
  return { type: 'dataModel', passed, total, missing };
}

function scoreKeyFlows(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  // Concatenate all `key-flow-*` diagrams so flows can live in separate artifacts
  let allFlows = '';
  for (const [type, mermaid] of diagrams) {
    if (type.startsWith('key-flow')) allFlows += '\n' + mermaid;
  }

  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const flow of expected.keyFlows) {
    for (const step of flow.mustContainSteps) {
      total++;
      if (containsSubstring(allFlows, step)) passed++;
      else missing.push(`flow:${flow.name}:step:${step}`);
    }
  }

  return { type: 'keyFlows', passed, total, missing };
}

function containsSubstring(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

function containsEdge(mermaid: string, from: string, to: string): boolean {
  // Matches patterns like "from --> to", "from -- label --> to", "from -->|text| to".
  // Uses whitespace-insensitive regex on lowercased text.
  const lower = mermaid.toLowerCase();
  const f = escapeRegex(from.toLowerCase());
  const t = escapeRegex(to.toLowerCase());
  const re = new RegExp(`\\b${f}\\b[^\\n]*--[\\-\\|>a-z0-9\\s\\|]*>[^\\n]*\\b${t}\\b`);
  return re.test(lower);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=diagramScorer`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/scorers/diagramScorer.ts packages/core/eval/src/__tests__/diagramScorer.test.ts
git commit -m "feat(eval): deterministic diagram scorer (labels, edges, entities, flow steps)"
```

---

## Task 8: QnA scorer

Recall@10 is pure deterministic; completeness + hallucination use `llmJudge.judgeFactPresence`.

**Files:**
- Create: `packages/core/eval/src/scorers/qnaScorer.ts`
- Test: `packages/core/eval/src/__tests__/qnaScorer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/qnaScorer.test.ts
import type { LLMClient, VectorChunk } from '@codeinsight/types';

import { scoreQna } from '../scorers/qnaScorer';
import type { PipelineAdapter, QaPair } from '../types';

function mockLLM(responses: string[]): LLMClient {
  let i = 0;
  return {
    complete: jest.fn().mockImplementation(() => Promise.resolve(responses[i++])),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

function mockAdapter(
  answers: Array<{ answer: string; retrieved: VectorChunk[] }>,
): PipelineAdapter {
  let i = 0;
  return {
    version: 'mock',
    ingest: jest.fn(),
    getDocArtifacts: jest.fn(),
    getDiagramArtifacts: jest.fn(),
    askQna: jest.fn().mockImplementation(() => Promise.resolve({
      answer: answers[i].answer,
      retrievedChunks: answers[i++].retrieved,
    })),
  };
}

function chunk(filePath: string, content = ''): VectorChunk {
  return { chunkId: filePath, repoId: 'r', content, contentSha: 's', layer: 'code', metadata: { filePath } };
}

describe('scoreQna', () => {
  it('computes recall@10 and per-question details', async () => {
    const qa: QaPair[] = [{
      question: 'How does auth work?',
      expectedFiles: ['src/auth.ts', 'src/session.ts'],
      mustIncludeFacts: ['verifies JWT', 'stores session in redis'],
      shouldNotHallucinate: [],
    }];
    const adapter = mockAdapter([{
      answer: 'Auth verifies JWT and stores session in redis.',
      retrieved: [chunk('src/auth.ts'), chunk('src/other.ts')],
    }]);
    const llm = mockLLM([
      JSON.stringify({ results: [
        { fact: 'verifies JWT', score: 1, reason: '' },
        { fact: 'stores session in redis', score: 1, reason: '' },
      ]}),
    ]);

    const result = await scoreQna('slug', qa, adapter, llm);

    expect(result.details).toHaveLength(1);
    expect(result.details[0].recallAt10).toBe(0.5); // 1 of 2 expected files retrieved
    expect(result.details[0].completeness).toBe(1);
    expect(result.details[0].hallucinationCount).toBe(0);
  });

  it('flags hallucinations when shouldNotHallucinate phrase appears', async () => {
    const qa: QaPair[] = [{
      question: 'q',
      expectedFiles: [],
      mustIncludeFacts: [],
      shouldNotHallucinate: ['we use kafka'],
    }];
    const adapter = mockAdapter([{
      answer: 'It runs on AWS. Also we use kafka for events.',
      retrieved: [],
    }]);
    const llm = mockLLM([]); // no facts → no judge call

    const result = await scoreQna('slug', qa, adapter, llm);
    expect(result.details[0].hallucinationCount).toBe(1);
  });

  it('overall penalizes hallucination (0.2 off)', async () => {
    const qa: QaPair[] = [{
      question: 'q',
      expectedFiles: ['src/a.ts'],
      mustIncludeFacts: ['fact'],
      shouldNotHallucinate: ['bad'],
    }];
    const adapter = mockAdapter([{
      answer: 'fact and bad',
      retrieved: [chunk('src/a.ts')],
    }]);
    const llm = mockLLM([
      JSON.stringify({ results: [{ fact: 'fact', score: 1, reason: '' }] }),
    ]);

    const result = await scoreQna('slug', qa, adapter, llm);
    // recall=1, completeness=1, hallucination penalty=0.2 → (1+1)/2 - 0.2 = 0.8
    expect(result.overall).toBeCloseTo(0.8, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=qnaScorer`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `qnaScorer.ts`**

```typescript
// packages/core/eval/src/scorers/qnaScorer.ts
import type { LLMClient, VectorChunk } from '@codeinsight/types';

import type { PipelineAdapter, QaPair, QaScore, QaScoreDetail } from '../types';

import { judgeFactPresence } from './llmJudge';

const RECALL_AT = 10;

export async function scoreQna(
  repoSlug: string,
  pairs: QaPair[],
  adapter: PipelineAdapter,
  judgeLlm: LLMClient,
): Promise<QaScore> {
  const details: QaScoreDetail[] = [];

  for (const pair of pairs) {
    const { answer, retrievedChunks } = await adapter.askQna(repoSlug, pair.question);

    const retrievedFilePaths = Array.from(new Set(
      retrievedChunks
        .slice(0, RECALL_AT)
        .map(c => typeof c.metadata?.filePath === 'string' ? c.metadata.filePath : ''),
    )).filter(s => s.length > 0);

    const recallAt10 = pair.expectedFiles.length === 0
      ? 1
      : pair.expectedFiles.filter(f => retrievedFilePaths.includes(f)).length / pair.expectedFiles.length;

    const completeness = pair.mustIncludeFacts.length === 0
      ? 1
      : (await judgeFactPresence(judgeLlm, answer, pair.mustIncludeFacts))
        .reduce((s, f) => s + f.score, 0) / pair.mustIncludeFacts.length;

    const hallucinationCount = pair.shouldNotHallucinate.reduce(
      (n, phrase) => answer.toLowerCase().includes(phrase.toLowerCase()) ? n + 1 : n,
      0,
    );

    details.push({
      question: pair.question,
      recallAt10,
      completeness,
      hallucinationCount,
      retrievedFilePaths,
      answer,
    });
  }

  // Overall: mean of per-question scores with hallucination penalty
  const perQ = details.map(d => {
    const base = (d.recallAt10 + d.completeness) / 2;
    const penalty = d.hallucinationCount > 0 ? 0.2 : 0;
    return Math.max(0, base - penalty);
  });
  const overall = perQ.length === 0 ? 0 : perQ.reduce((a, b) => a + b, 0) / perQ.length;

  return { overall, details };
}

// Silence unused-import linter when VectorChunk is only referenced in types above
const _keepImport: VectorChunk | undefined = undefined;
void _keepImport;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=qnaScorer`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/scorers/qnaScorer.ts packages/core/eval/src/__tests__/qnaScorer.test.ts
git commit -m "feat(eval): qna scorer (recall@10 + completeness + hallucination)"
```

---

## Task 9: Runner

Clones the gold repo to a temp dir at the pinned SHA, hands off to a `PipelineAdapter` to ingest, then runs all three scorers.

**Files:**
- Create: `packages/core/eval/src/runner.ts`
- Test: `packages/core/eval/src/__tests__/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/runner.test.ts
import type { Artifact, LLMClient } from '@codeinsight/types';

import { runEval } from '../runner';
import type { PipelineAdapter, RepoFixture } from '../types';

function fixture(): RepoFixture {
  return {
    meta: {
      slug: 'small',
      gitUrl: 'https://example.com/foo.git',
      commitSha: 'deadbeef',
      description: 'test',
      sizeCategory: 'small',
      fileCountApprox: 10,
    },
    expectedOverview: { bullets: ['does X'] },
    expectedArchitecture: { subsystems: [], externalDependencies: [] },
    expectedDiagrams: {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    },
    qaPairs: [],
  };
}

function mockAdapter(): PipelineAdapter {
  return {
    version: 'test',
    ingest: jest.fn().mockResolvedValue(undefined),
    getDocArtifacts: jest.fn().mockResolvedValue([] as Artifact[]),
    getDiagramArtifacts: jest.fn().mockResolvedValue([] as Artifact[]),
    askQna: jest.fn(),
  };
}

function mockLLM(): LLMClient {
  return {
    complete: jest.fn().mockResolvedValue('{"results":[]}'),
    stream: jest.fn(),
  } as unknown as LLMClient;
}

describe('runEval', () => {
  it('clones, ingests, scores, and returns a RepoReport', async () => {
    const cloneFn = jest.fn().mockResolvedValue('/tmp/clone-dir');
    const adapter = mockAdapter();
    const llm = mockLLM();

    const report = await runEval({
      fixture: fixture(),
      adapter,
      judgeLlm: llm,
      cloneFn,
      now: () => new Date('2026-04-19T12:00:00Z'),
    });

    expect(cloneFn).toHaveBeenCalledWith('https://example.com/foo.git', 'deadbeef');
    expect(adapter.ingest).toHaveBeenCalled();
    expect(report.fixtureSlug).toBe('small');
    expect(report.pipelineVersion).toBe('test');
    expect(report.doc).toHaveLength(2);
    expect(report.diagram).toHaveLength(3);
    expect(report.qna.details).toHaveLength(0);
    expect(report.wallClockSeconds).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=runner`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `runner.ts`**

```typescript
// packages/core/eval/src/runner.ts
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { LLMClient } from '@codeinsight/types';
import { simpleGit } from 'simple-git';

import { CostTracker } from './costTracker';
import { scoreDiagrams } from './scorers/diagramScorer';
import { scoreDocs } from './scorers/docScorer';
import { scoreQna } from './scorers/qnaScorer';
import type { PipelineAdapter, RepoFixture, RepoReport } from './types';

export interface RunEvalOptions {
  fixture: RepoFixture;
  adapter: PipelineAdapter;
  /** LLM used by scorers for judging — NOT the pipeline's generator LLM. */
  judgeLlm: LLMClient;
  /** Override for testability. Default: clone via simple-git into a temp dir. */
  cloneFn?: (gitUrl: string, commitSha: string) => Promise<string>;
  /** Override for testability. */
  now?: () => Date;
}

export async function runEval(opts: RunEvalOptions): Promise<RepoReport> {
  const { fixture, adapter, judgeLlm } = opts;
  const clone = opts.cloneFn ?? defaultClone;
  const now = opts.now ?? (() => new Date());

  const start = Date.now();
  const cloneDir = await clone(fixture.meta.gitUrl, fixture.meta.commitSha);

  try {
    await adapter.ingest(fixture.meta, cloneDir);

    const [docArtifacts, diagramArtifacts] = await Promise.all([
      adapter.getDocArtifacts(fixture.meta.slug),
      adapter.getDiagramArtifacts(fixture.meta.slug),
    ]);

    const doc = await scoreDocs(
      docArtifacts,
      fixture.expectedOverview,
      fixture.expectedArchitecture,
      judgeLlm,
    );
    const diagram = scoreDiagrams(diagramArtifacts, fixture.expectedDiagrams);
    const qna = await scoreQna(fixture.meta.slug, fixture.qaPairs, adapter, judgeLlm);

    const wallClockSeconds = (Date.now() - start) / 1000;

    // Cost is tracked by the adapter; scorer cost is out of scope for this phase.
    // Adapters that implement cost tracking should expose it via an optional `cost()` method.
    const cost =
      typeof (adapter as { cost?: () => ReturnType<CostTracker['summary']> }).cost === 'function'
        ? (adapter as { cost: () => ReturnType<CostTracker['summary']> }).cost()
        : new CostTracker().summary();

    return {
      fixtureSlug: fixture.meta.slug,
      commitSha: fixture.meta.commitSha,
      pipelineVersion: adapter.version,
      doc,
      diagram,
      qna,
      cost,
      wallClockSeconds,
      timestamp: now().toISOString(),
    };
  } finally {
    // Best-effort cleanup; ignore errors
    try {
      if (opts.cloneFn === undefined) {
        await rm(cloneDir, { recursive: true, force: true });
      }
    } catch {
      /* noop */
    }
  }
}

async function defaultClone(gitUrl: string, commitSha: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-clone-'));
  const git = simpleGit({ baseDir: dir });
  await git.clone(gitUrl, '.');
  await git.checkout(commitSha);
  return dir;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=runner`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/runner.ts packages/core/eval/src/__tests__/runner.test.ts
git commit -m "feat(eval): runner orchestrates clone + ingest + scoring"
```

---

## Task 10: Report writer

Writes JSON + markdown reports to a timestamped directory.

**Files:**
- Create: `packages/core/eval/src/reportWriter.ts`
- Test: `packages/core/eval/src/__tests__/reportWriter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/eval/src/__tests__/reportWriter.test.ts
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeReport } from '../reportWriter';
import type { EvalReport } from '../types';

function report(): EvalReport {
  return {
    generatedAt: '2026-04-19T12:00:00Z',
    pipelineVersion: 'v1',
    repos: [{
      fixtureSlug: 'small',
      commitSha: 'abc',
      pipelineVersion: 'v1',
      doc: [
        { module: 'overview', overall: 0.75, factScores: [
          { fact: 'f1', score: 1, reason: '' },
          { fact: 'f2', score: 0.5, reason: '' },
        ]},
        { module: 'architecture', overall: 1.0, factScores: [] },
      ],
      diagram: [
        { type: 'systemArchitecture', passed: 3, total: 4, missing: ['label:X'] },
        { type: 'dataModel', passed: 0, total: 0, missing: [] },
        { type: 'keyFlows', passed: 1, total: 2, missing: ['flow:auth:step:logout'] },
      ],
      qna: { overall: 0.6, details: [] },
      cost: {
        chatRequests: 20, chatInputTokens: 10000, chatOutputTokens: 3000, chatUsd: 0.15,
        embeddingRequests: 2, embeddingInputTokens: 5000, embeddingUsd: 0.01,
        totalUsd: 0.16,
      },
      wallClockSeconds: 42.5,
      timestamp: '2026-04-19T12:00:00Z',
    }],
  };
}

describe('writeReport', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eval-report-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes report.json and report.md', async () => {
    const out = await writeReport(report(), tmp);
    const json = JSON.parse(await readFile(out.jsonPath, 'utf-8'));
    expect(json.repos[0].fixtureSlug).toBe('small');

    const md = await readFile(out.markdownPath, 'utf-8');
    expect(md).toContain('# CodeInsight Eval Report');
    expect(md).toContain('small');
    expect(md).toContain('$0.16');
    expect(md).toContain('label:X');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=reportWriter`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `reportWriter.ts`**

```typescript
// packages/core/eval/src/reportWriter.ts
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { EvalReport, RepoReport } from './types';

export async function writeReport(
  report: EvalReport,
  outDir: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, 'report.json');
  const markdownPath = join(outDir, 'report.md');

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf-8');

  return { jsonPath, markdownPath };
}

function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# CodeInsight Eval Report`);
  lines.push(``);
  lines.push(`- **Generated:** ${r.generatedAt}`);
  lines.push(`- **Pipeline:** ${r.pipelineVersion}`);
  lines.push(`- **Repos:** ${r.repos.length}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Repo | Doc (overview) | Doc (arch) | Diagrams | QnA | Cost | Wall |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const repo of r.repos) {
    const overview = repo.doc.find(d => d.module === 'overview')?.overall ?? 0;
    const arch = repo.doc.find(d => d.module === 'architecture')?.overall ?? 0;
    const diagTotal = repo.diagram.reduce((a, b) => a + b.total, 0);
    const diagPass = repo.diagram.reduce((a, b) => a + b.passed, 0);
    const diag = diagTotal === 0 ? '—' : `${diagPass}/${diagTotal}`;
    lines.push(
      `| ${repo.fixtureSlug} | ${overview.toFixed(2)} | ${arch.toFixed(2)} | ${diag} ` +
      `| ${repo.qna.overall.toFixed(2)} | $${repo.cost.totalUsd.toFixed(2)} | ${repo.wallClockSeconds.toFixed(0)}s |`,
    );
  }

  for (const repo of r.repos) {
    lines.push('');
    lines.push(`## ${repo.fixtureSlug} (${repo.commitSha})`);
    lines.push(renderRepoSection(repo));
  }

  return lines.join('\n');
}

function renderRepoSection(repo: RepoReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`### Docs`);
  for (const doc of repo.doc) {
    lines.push(`- **${doc.module}** — ${doc.overall.toFixed(2)}`);
    for (const f of doc.factScores) {
      lines.push(`  - [${f.score}] ${f.fact} — ${f.reason}`);
    }
  }

  lines.push('');
  lines.push(`### Diagrams`);
  for (const d of repo.diagram) {
    lines.push(`- **${d.type}** — ${d.passed}/${d.total}`);
    for (const m of d.missing) {
      lines.push(`  - MISSING: ${m}`);
    }
  }

  lines.push('');
  lines.push(`### QnA (overall ${repo.qna.overall.toFixed(2)})`);
  for (const q of repo.qna.details) {
    lines.push(`- **${q.question}**`);
    lines.push(`  - recall@10=${q.recallAt10.toFixed(2)}, completeness=${q.completeness.toFixed(2)}, hallucinations=${q.hallucinationCount}`);
    lines.push(`  - retrieved: ${q.retrievedFilePaths.join(', ') || '(none)'}`);
  }

  lines.push('');
  lines.push(`### Cost & latency`);
  lines.push(`- Total: $${repo.cost.totalUsd.toFixed(2)} (chat $${repo.cost.chatUsd.toFixed(2)}, embed $${repo.cost.embeddingUsd.toFixed(2)})`);
  lines.push(`- Chat: ${repo.cost.chatRequests} req, ${repo.cost.chatInputTokens} in / ${repo.cost.chatOutputTokens} out`);
  lines.push(`- Embed: ${repo.cost.embeddingRequests} req, ${repo.cost.embeddingInputTokens} in`);
  lines.push(`- Wall clock: ${repo.wallClockSeconds.toFixed(1)}s`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=reportWriter`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/reportWriter.ts packages/core/eval/src/__tests__/reportWriter.test.ts
git commit -m "feat(eval): report writer (JSON + markdown)"
```

---

## Task 11: CLI entry

A minimal CLI backed by `commander`. Supports:
- `eval run [--repo <slug>] [--out <dir>]`
- `eval baseline [--out <dir>]` — same as run but tags the report as baseline
- `eval compare --baseline <path> [--current <path>]` — diff two report.json files

Adapter wiring (v1 adapter) arrives in Phase 2. In this phase, the CLI accepts an `--adapter=<module>` path and dynamically imports it. This is non-standard but keeps Phase 1 hermetic (unit tests never hit a real adapter).

**Files:**
- Create: `packages/core/eval/src/cli.ts`
- Create: `packages/core/eval/src/__tests__/compareReports.test.ts`

- [ ] **Step 1: Write the failing test for compare logic**

```typescript
// packages/core/eval/src/__tests__/compareReports.test.ts
import { compareReports } from '../cli';
import type { EvalReport } from '../types';

function reportWith(overviewScore: number, qnaScore: number, cost: number): EvalReport {
  return {
    generatedAt: '2026-04-19T00:00:00Z',
    pipelineVersion: 'v1',
    repos: [{
      fixtureSlug: 's',
      commitSha: 'c',
      pipelineVersion: 'v1',
      doc: [
        { module: 'overview', overall: overviewScore, factScores: [] },
        { module: 'architecture', overall: 0, factScores: [] },
      ],
      diagram: [
        { type: 'systemArchitecture', passed: 0, total: 0, missing: [] },
        { type: 'dataModel', passed: 0, total: 0, missing: [] },
        { type: 'keyFlows', passed: 0, total: 0, missing: [] },
      ],
      qna: { overall: qnaScore, details: [] },
      cost: {
        chatRequests: 0, chatInputTokens: 0, chatOutputTokens: 0, chatUsd: cost,
        embeddingRequests: 0, embeddingInputTokens: 0, embeddingUsd: 0,
        totalUsd: cost,
      },
      wallClockSeconds: 0,
      timestamp: '2026-04-19T00:00:00Z',
    }],
  };
}

describe('compareReports', () => {
  it('reports deltas per repo per surface and per cost', () => {
    const baseline = reportWith(0.5, 0.4, 10.0);
    const current = reportWith(0.8, 0.6, 2.0);
    const out = compareReports(baseline, current);
    expect(out).toContain('overview');
    expect(out).toContain('0.50 → 0.80');
    expect(out).toContain('qna');
    expect(out).toContain('$10.00 → $2.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=compareReports`
Expected: FAIL with "compareReports is not exported".

- [ ] **Step 3: Write `cli.ts`**

```typescript
// packages/core/eval/src/cli.ts
import { existsSync, readFileSync } from 'fs';
import { mkdir, readdir } from 'fs/promises';
import { join, resolve } from 'path';

import type { LLMClient } from '@codeinsight/types';
import { Command } from 'commander';

import { loadFixture } from './fixtureLoader';
import { writeReport } from './reportWriter';
import { runEval } from './runner';
import type { EvalReport, PipelineAdapter } from './types';

interface AdapterModule {
  createAdapter(): Promise<PipelineAdapter>;
  createJudgeLlm(): Promise<LLMClient>;
}

async function loadAdapter(adapterPath: string): Promise<AdapterModule> {
  const resolved = resolve(process.cwd(), adapterPath);
  const mod = (await import(resolved)) as Partial<AdapterModule>;
  if (typeof mod.createAdapter !== 'function' || typeof mod.createJudgeLlm !== 'function') {
    throw new Error(`Adapter module at ${resolved} must export createAdapter() and createJudgeLlm()`);
  }
  return mod as AdapterModule;
}

async function listFixtures(fixturesDir: string): Promise<string[]> {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name);
}

export function compareReports(baseline: EvalReport, current: EvalReport): string {
  const lines: string[] = [];
  lines.push('# Eval Comparison');
  lines.push('');
  for (const cur of current.repos) {
    const base = baseline.repos.find(r => r.fixtureSlug === cur.fixtureSlug);
    if (!base) {
      lines.push(`- ${cur.fixtureSlug}: new (no baseline)`);
      continue;
    }
    lines.push(`## ${cur.fixtureSlug}`);
    for (const d of ['overview', 'architecture'] as const) {
      const b = base.doc.find(x => x.module === d)?.overall ?? 0;
      const c = cur.doc.find(x => x.module === d)?.overall ?? 0;
      lines.push(`- doc ${d}: ${b.toFixed(2)} → ${c.toFixed(2)} (${delta(b, c)})`);
    }
    lines.push(`- qna: ${base.qna.overall.toFixed(2)} → ${cur.qna.overall.toFixed(2)} (${delta(base.qna.overall, cur.qna.overall)})`);
    lines.push(`- cost: $${base.cost.totalUsd.toFixed(2)} → $${cur.cost.totalUsd.toFixed(2)} (${delta(base.cost.totalUsd, cur.cost.totalUsd, true)})`);
  }
  return lines.join('\n');
}

function delta(b: number, c: number, lowerIsBetter = false): string {
  const d = c - b;
  if (d === 0) return '=';
  const sign = d > 0 ? '+' : '';
  const verdict = (lowerIsBetter ? d < 0 : d > 0) ? '✅' : '❌';
  return `${sign}${d.toFixed(2)} ${verdict}`;
}

async function cmdRun(opts: {
  adapter: string;
  out: string;
  repo?: string;
  fixturesDir: string;
}) {
  const { createAdapter, createJudgeLlm } = await loadAdapter(opts.adapter);
  const adapter = await createAdapter();
  const judgeLlm = await createJudgeLlm();

  const slugs = opts.repo ? [opts.repo] : await listFixtures(opts.fixturesDir);

  const repos: EvalReport['repos'] = [];
  for (const slug of slugs) {
    const fixtureDir = join(opts.fixturesDir, slug);
    const fixture = await loadFixture(fixtureDir);
    // eslint-disable-next-line no-console
    console.log(`[eval] running ${slug}...`);
    const report = await runEval({ fixture, adapter, judgeLlm });
    repos.push(report);
  }

  const evalReport: EvalReport = {
    generatedAt: new Date().toISOString(),
    pipelineVersion: adapter.version,
    repos,
  };

  const outDir = join(opts.out, new Date().toISOString().slice(0, 10));
  await mkdir(outDir, { recursive: true });
  const paths = await writeReport(evalReport, outDir);
  // eslint-disable-next-line no-console
  console.log(`[eval] wrote ${paths.markdownPath}`);
}

async function cmdCompare(opts: { baseline: string; current: string }) {
  const b = JSON.parse(readFileSync(opts.baseline, 'utf-8')) as EvalReport;
  const c = JSON.parse(readFileSync(opts.current, 'utf-8')) as EvalReport;
  // eslint-disable-next-line no-console
  console.log(compareReports(b, c));
}

/* istanbul ignore next — CLI entrypoint */
export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name('eval').description('CodeInsight evaluation harness');

  program
    .command('run')
    .option('--adapter <path>', 'path to the PipelineAdapter module', './packages/core/eval/dist/adapters/v1Adapter.js')
    .option('--out <dir>', 'output directory', './eval/reports')
    .option('--repo <slug>', 'single fixture slug to run')
    .option('--fixtures-dir <dir>', 'fixtures directory', './packages/core/eval/fixtures')
    .action(cmdRun);

  program
    .command('baseline')
    .option('--adapter <path>', 'path to the v1 PipelineAdapter module', './packages/core/eval/dist/adapters/v1Adapter.js')
    .option('--out <dir>', 'output directory', './eval/reports/baseline')
    .option('--fixtures-dir <dir>', 'fixtures directory', './packages/core/eval/fixtures')
    .action(opts => cmdRun({ ...opts, repo: undefined }));

  program
    .command('compare')
    .requiredOption('--baseline <path>', 'baseline report.json')
    .requiredOption('--current <path>', 'current report.json')
    .action(cmdCompare);

  await program.parseAsync(argv);
}

/* istanbul ignore next */
if (require.main === module) {
  main(process.argv).catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

// Silence unused when existsSync not directly referenced elsewhere
void existsSync;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=compareReports`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/src/cli.ts packages/core/eval/src/__tests__/compareReports.test.ts
git commit -m "feat(eval): CLI with run / baseline / compare commands"
```

---

## Task 12: Root workspace scripts + reports directory

**Files:**
- Modify: root `package.json`
- Create: `eval/reports/.gitkeep`
- Create: `eval/reports/README.md`

- [ ] **Step 1: Open the root `package.json` and find the `scripts` block**

Run: `grep -n '"scripts"' package.json`
Expected: output shows line number for the existing scripts block.

- [ ] **Step 2: Add eval scripts to root `package.json`**

Add these entries inside `"scripts"` (preserve existing keys):

```json
"eval:build": "pnpm --filter @codeinsight/eval build",
"eval:run":     "pnpm --filter @codeinsight/eval build && node packages/core/eval/dist/cli.js run",
"eval:baseline":"pnpm --filter @codeinsight/eval build && node packages/core/eval/dist/cli.js baseline",
"eval:compare": "pnpm --filter @codeinsight/eval build && node packages/core/eval/dist/cli.js compare"
```

- [ ] **Step 3: Create `eval/reports/` with a README and .gitkeep**

```markdown
# eval/reports/

CodeInsight eval reports. Each subdirectory is named by ISO date of the run
and contains `report.json` + `report.md`.

Baselines live in `baseline/`. Treat these as golden — do not rewrite without
a corresponding spec change.
```

And `eval/reports/.gitkeep` empty file.

- [ ] **Step 4: Verify scripts resolve**

Run: `pnpm eval:build`
Expected: builds `@codeinsight/eval` successfully.

- [ ] **Step 5: Commit**

```bash
git add package.json eval/
git commit -m "chore(eval): add root scripts + reports directory"
```

---

## Task 13: Fixture template

Template directory copied when creating a new fixture.

**Files:**
- Create: `packages/core/eval/fixtures/_template/README.md`
- Create: `packages/core/eval/fixtures/_template/repo.json`
- Create: `packages/core/eval/fixtures/_template/expected-overview.json`
- Create: `packages/core/eval/fixtures/_template/expected-architecture.json`
- Create: `packages/core/eval/fixtures/_template/expected-diagrams.json`
- Create: `packages/core/eval/fixtures/_template/qa-pairs.json`

- [ ] **Step 1: Create each template file with minimally valid content**

`README.md`:
```markdown
# Fixture: <slug>

Steps to curate:

1. Pick a pinned commit SHA on the target repo. Paste into `repo.json`.
2. Clone locally, skim directory tree + README. Draft 3–6 overview bullets.
3. Identify 3–5 subsystems with at least one real file path each.
4. List external deps from package.json / go.mod / etc.
5. For diagrams: pick labels you expect to see in a C4-style system diagram. Entities for ER.
6. Write 10–15 QA pairs by reading real code. Each pair has at least one expected file.

DO NOT commit aspirational expectations — everything must be verifiable by reading the pinned repo.
```

`repo.json`:
```json
{
  "gitUrl": "https://github.com/OWNER/REPO.git",
  "commitSha": "0000000000000000000000000000000000000000",
  "description": "One-line description of what this repo does",
  "sizeCategory": "small",
  "fileCountApprox": 0
}
```

`expected-overview.json`:
```json
{
  "bullets": [
    "Short factual bullet 1 (verifiable from the repo)",
    "Short factual bullet 2",
    "Short factual bullet 3"
  ]
}
```

`expected-architecture.json`:
```json
{
  "subsystems": [
    { "name": "Subsystem Name", "mustMentionFiles": ["src/example.ts"] }
  ],
  "externalDependencies": ["some-package"]
}
```

`expected-diagrams.json`:
```json
{
  "systemArchitecture": {
    "mustContainLabels": ["API", "DB"],
    "mustContainEdges": [{ "from": "API", "to": "DB" }]
  },
  "dataModel": null,
  "keyFlows": []
}
```

`qa-pairs.json`:
```json
[
  {
    "question": "What does this service do?",
    "expectedFiles": ["src/index.ts"],
    "mustIncludeFacts": ["it is an HTTP server"],
    "shouldNotHallucinate": []
  }
]
```

- [ ] **Step 2: Verify fixture loader accepts the template**

Run: `pnpm --filter @codeinsight/eval test -- --testPathPattern=fixtureLoader`
Expected: existing tests still pass. Template is unused by tests but must be a valid fixture.

- [ ] **Step 3: Commit**

```bash
git add packages/core/eval/fixtures/_template/
git commit -m "feat(eval): fixture template directory"
```

---

## Task 14: Curate fixture 1 — small TS service

**Files:**
- Create: `packages/core/eval/fixtures/small-ts/*` (5 files from template)

**This is a manual-curation task.** The engineer must read the chosen repo and hand-write the expected artifacts. Do NOT let an LLM author these — the whole point is that the gold set is trusted. LLM assistance for *drafting* is fine, but every claim must be verified by reading the pinned SHA.

**Suggested repo (replace if the user has a better one):** `https://github.com/hagopj13/node-express-boilerplate` — small Node + Express + Mongoose REST API with auth, ~50 source files, stable commit history.

- [ ] **Step 1: Pick a repo and pinned SHA**

- Confirm with the user which small repo to use.
- Clone it locally: `git clone <url> /tmp/fixture-small-ts && cd /tmp/fixture-small-ts`.
- Pick a commit on the default branch: `git log --oneline | head -5` → copy one SHA.
- Note the file count: `git ls-files | wc -l`.

- [ ] **Step 2: Copy the template and fill `repo.json`**

Run: `cp -r packages/core/eval/fixtures/_template packages/core/eval/fixtures/small-ts`

Edit `packages/core/eval/fixtures/small-ts/repo.json`:
```json
{
  "gitUrl": "<chosen URL>",
  "commitSha": "<chosen SHA>",
  "description": "<one-line description>",
  "sizeCategory": "small",
  "fileCountApprox": <number>
}
```

- [ ] **Step 3: Hand-curate `expected-overview.json`**

Read the README and top-level `src/`. Write 3–6 bullets that are:
- factual (verifiable by reading the repo at the pinned SHA),
- high-level (not "uses lodash"),
- specific enough that a good overview MUST mention them.

Example for node-express-boilerplate:
```json
{
  "bullets": [
    "REST API boilerplate built with Node.js and Express",
    "Uses Mongoose for MongoDB access",
    "Provides JWT-based authentication with access + refresh tokens",
    "Includes role-based access control via middleware",
    "Has email verification and password reset flows"
  ]
}
```

- [ ] **Step 4: Hand-curate `expected-architecture.json`**

Scan `src/` directory structure. Identify 3–5 subsystems with at least one real file path each. Example:
```json
{
  "subsystems": [
    { "name": "Routes", "mustMentionFiles": ["src/routes/v1/auth.route.js"] },
    { "name": "Controllers", "mustMentionFiles": ["src/controllers/auth.controller.js"] },
    { "name": "Services", "mustMentionFiles": ["src/services/auth.service.js"] },
    { "name": "Models", "mustMentionFiles": ["src/models/user.model.js"] },
    { "name": "Middleware", "mustMentionFiles": ["src/middlewares/auth.js"] }
  ],
  "externalDependencies": ["express", "mongoose", "jsonwebtoken", "passport", "joi"]
}
```

- [ ] **Step 5: Hand-curate `expected-diagrams.json`**

Think about what the 3 diagrams SHOULD contain. Example:
```json
{
  "systemArchitecture": {
    "mustContainLabels": ["Routes", "Controllers", "Services", "MongoDB"],
    "mustContainEdges": [
      { "from": "Routes", "to": "Controllers" },
      { "from": "Controllers", "to": "Services" }
    ]
  },
  "dataModel": { "mustContainEntities": ["User", "Token"] },
  "keyFlows": [
    { "name": "auth", "mustContainSteps": ["Login", "Generate Token", "Verify Token"] }
  ]
}
```

- [ ] **Step 6: Hand-curate `qa-pairs.json`**

Write 10–15 questions by reading actual code. Each one must be answerable from the repo. Example:
```json
[
  {
    "question": "How does login work?",
    "expectedFiles": ["src/controllers/auth.controller.js", "src/services/auth.service.js"],
    "mustIncludeFacts": ["password is verified with bcrypt", "an access and refresh token are issued"],
    "shouldNotHallucinate": ["OAuth", "Google login"]
  }
]
```

Aim for a mix:
- 3–4 conceptual: "How does X work?"
- 3–4 specific: "What does function Y return?"
- 2–3 relational: "What calls Z?"
- 2–3 navigational: "Where is the user schema defined?"

- [ ] **Step 7: Verify the fixture loads**

Write a quick assertion in a throwaway script (or at REPL):

```bash
node -e "require('./packages/core/eval/dist/fixtureLoader').loadFixture('./packages/core/eval/fixtures/small-ts').then(f => console.log(f.meta.slug, f.qaPairs.length))"
```

Expected: prints `small-ts` and the QA pair count. If it throws, read the error and fix the fixture.

- [ ] **Step 8: Commit**

```bash
git add packages/core/eval/fixtures/small-ts/
git commit -m "feat(eval): curate small-ts fixture"
```

---

## Task 15: Curate fixture 2 — medium React SPA

Same procedure as Task 14, but for a medium React app (~200 files).

**Suggested repo:** `https://github.com/bradtraversy/redux-essentials-example-app` (Redux Toolkit tutorial app, ~40 files) — or a larger one if user prefers. Confirm with user first.

- [ ] **Step 1–8:** Same as Task 14 tasks 1–8, substituting the medium repo.

Adjust QA pair distribution to cover React-specific patterns (components, hooks, Redux slices, routing).

- [ ] **Step 9: Commit**

```bash
git add packages/core/eval/fixtures/medium-react/
git commit -m "feat(eval): curate medium-react fixture"
```

---

## Task 16: Curate fixture 3 — complex

Same procedure as Task 14, but for the complex repo (openclaw or equivalent ≥500 files). Confirm with user first — this is the repo that drove the original cost complaints.

- [ ] **Step 1–8:** Same as Task 14 tasks 1–8, substituting the complex repo.

Because this is large, it's OK to under-specify QA pairs — 10 is fine; focus on questions that stress retrieval (cross-file relational, deep navigational).

- [ ] **Step 9: Commit**

```bash
git add packages/core/eval/fixtures/complex/
git commit -m "feat(eval): curate complex fixture"
```

---

## Task 17: Update build plan + memory

**Files:**
- Modify: `docs/build-plan.md`
- Modify: `/Users/jiteshyadav/.claude/projects/-Users-jiteshyadav-Documents-Work-projects-backstage-plugins-CodeInsight-backstage-plugin-codeinsight/memory/MEMORY.md`

- [ ] **Step 1: Append Phase 8 section to `docs/build-plan.md`**

Add at the end of the file:

```markdown
## Phase 8: v2 Redesign (Evaluable, Structured, Consolidated)

> Spec: `docs/superpowers/specs/2026-04-19-codeinsight-v2-design.md`

### 8.1 Eval Harness ✅ COMPLETED
- `@codeinsight/eval` package with fixture loader, cost tracker, 3 scorers (doc / diagram / QnA), runner, report writer, CLI.
- 3 hand-curated gold fixtures: `small-ts`, `medium-react`, `complex`.
- Root `pnpm eval:run` / `eval:baseline` / `eval:compare` scripts.
- PipelineAdapter interface enables version-agnostic runs.

### 8.2 Baseline Measurement (Phase 2 of v2) — PENDING
### 8.3 FileIntel + RCM — PENDING
### 8.4 Consolidated Docs + Diagrams — PENDING
### 8.5 QnA Redesign — PENDING
### 8.6 Flip Flag + Delete v1 — PENDING
### 8.7 Final Eval — PENDING
```

- [ ] **Step 2: Update MEMORY.md phase checklist**

Add under the existing phase tracking:

```markdown
## Phase 8 Build Plan — v2 Redesign
- ✅ 8.1 Eval harness (`@codeinsight/eval` package + 3 gold fixtures + pnpm eval:run)
- ⏳ 8.2 Baseline measurement (run eval against v1)
- ⏳ 8.3 FileIntel + RCM (behind v2Pipeline flag)
- ⏳ 8.4 Consolidated docs + diagrams (3+3 modules)
- ⏳ 8.5 QnA redesign (layer fix, MMR, 30K context, RCM seed, text-embedding-3-small)
- ⏳ 8.6 Flip flag + delete v1 (exhaustive deletion checklist in spec §12 Phase 6)
- ⏳ 8.7 Final eval vs baseline
```

- [ ] **Step 3: Verify whole package still passes**

Run: `pnpm --filter @codeinsight/eval test`
Expected: all tests pass.

Run: `pnpm --filter @codeinsight/eval lint`
Expected: no lint errors. If errors: fix them (typical: unused imports, missing semicolons).

Run: `pnpm --filter @codeinsight/eval build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/build-plan.md
git commit -m "docs: add Phase 8 (v2 redesign) to build plan, mark 8.1 complete"
```

(MEMORY.md is outside the repo and auto-tracked; no commit needed.)

---

## Self-Review Check (run this at the end of execution)

- [ ] All Task N tests pass: `pnpm --filter @codeinsight/eval test` → all green.
- [ ] `pnpm eval:build` works from repo root.
- [ ] `pnpm eval:run --help` (after `pnpm eval:build`) prints the CLI help text.
- [ ] `packages/core/eval/fixtures/` contains exactly `_template/`, `small-ts/`, `medium-react/`, `complex/`.
- [ ] Each gold fixture has all 5 required files and `loadFixture` succeeds.
- [ ] No `TBD`, `TODO`, `<chosen URL>`, or `<number>` placeholders remain in committed fixture JSON files.
- [ ] `docs/build-plan.md` has Phase 8 with 8.1 marked ✅.
- [ ] Zero `@backstage/*` imports in the new `@codeinsight/eval` package (per hard rule 1 in CLAUDE.md).
- [ ] Zero `process.env` reads in the new `@codeinsight/eval` package (per hard rule 2).

---

## What Phase 2 (next plan) will add

- `src/adapters/v1Adapter.ts` — drives the current v1 pipeline via `IngestionService` + `QnAService` directly. Reuses `plugin-backend`'s composition root factories (extracted into a shared module if needed).
- Cost-tracking wrapper around `CachingLLMClient` and `EmbeddingClient` so the adapter's `cost()` method reports real numbers.
- First live baseline run against all 3 gold repos. Output committed to `eval/reports/baseline/`.
- Baseline quality target: informational only — we just need the numbers. No quality gates this phase.

Phase 2 unblocks measurement. Phases 3–5 then change one thing at a time and show the eval number moving.

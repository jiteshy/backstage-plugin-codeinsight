# Core Prompt: Dependencies

**Module ID:** `core/dependencies`

**Purpose:** Generate a "Dependencies" section documenting the project's key runtime and development dependencies, explaining what each major package is used for.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.frameworks` | Provide context on primary framework dependencies |
| `detected.language` | Select the correct manifest format |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| `package.json` | For Node.js | `dependencies` + `devDependencies` sections |
| `requirements.txt` / `pyproject.toml` | For Python | All listed packages |
| `go.mod` | For Go | `require` block |
| `Cargo.toml` | For Rust | `[dependencies]` block |
| `pom.xml` / `build.gradle` | For Java | Dependency declarations |

**Token budget:** ~2–5K tokens input / ~500 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Dependencies" section for a software project based on its package manifest.

Output ONLY a markdown section starting with "## Dependencies". Do not include any other headers or preamble.

The section should cover:
1. Runtime/production dependencies — focus on the major packages (skip trivial utilities like lodash, uuid, etc. unless they are central to the architecture)
2. Development dependencies — group by purpose (testing, building, linting)
3. Notable version constraints or peer dependency requirements

Rules:
- Explain what each major dependency DOES in this project, not just what the package generally does
- Group dependencies by purpose (e.g., "Web Framework", "Database", "Authentication", "Testing")
- Skip patch-level utility packages (lodash, ramda, chalk, etc.) unless they are architecturally significant
- For each group, use a small table: Package | Version | Purpose
- Highlight any peer dependency requirements or known compatibility constraints
- Do not list more than 20 dependencies total — prioritise the most important ones
```

---

## User Prompt Template

```
## Package Manifest ({manifestFileName})
```
{manifestContent}
```

Generate the Dependencies section for this repository.
```

**Template variables:**
- `{manifestFileName}` — `package.json`, `pyproject.toml`, `go.mod`, etc.
- `{manifestContent}` — full manifest content; for `package.json` include `dependencies`, `devDependencies`, `peerDependencies`, and `engines` fields; truncate to 3K tokens if oversized

---

## Output Format

```markdown
## Dependencies

### Runtime Dependencies

#### Web Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | `^4.18` | HTTP server and routing |
| `cors` | `^2.8` | Cross-origin request handling |

#### Database

| Package | Version | Purpose |
|---------|---------|---------|
| `prisma` | `^5.0` | ORM and database schema management |
| `@prisma/client` | `^5.0` | Type-safe DB query client |

#### Authentication

| Package | Version | Purpose |
|---------|---------|---------|
| `jsonwebtoken` | `^9.0` | JWT generation and verification |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type-safe compilation |
| `jest` | Unit and integration testing |
| `eslint` | Code linting |
| `ts-node` | TypeScript execution for scripts |

### Runtime Requirements

- Node.js 18+
- PostgreSQL 14+
```

---

## Acceptance Criteria

The generated section must:
- Explain what each listed dependency does in the context of this project
- Group by purpose, not alphabetically
- Skip trivial utility packages
- Correctly identify the framework packages as primary
- Include runtime version requirements if declared in `engines` or equivalent

---

## Token Budget

- Package manifest: ~1,500 tokens
- System prompt: ~350 tokens
- **Total input:** ~2,000 tokens
- **Expected output:** ~400 tokens
- **Cached:** Yes — same inputs + prompt version → same output

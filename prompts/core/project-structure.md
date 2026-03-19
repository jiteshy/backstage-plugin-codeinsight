# Core Prompt: Project Structure

**Module ID:** `core/project-structure`

**Purpose:** Generate a "Project Structure" section explaining the directory layout, what each top-level directory contains, and where to find key files. Always included for every repo.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `files` | Full file tree (paths only — no content) |
| `entry_points` | Highlight main entry files |
| `detected.frameworks` | Annotate framework-specific directories (e.g., `pages/` for Next.js) |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Directory tree (from CIG `files`) | Yes | Paths only, no file content |

**Token budget:** ~2–4K tokens input / ~500 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Project Structure" section for a software repository based on its file tree.

Output ONLY a markdown section starting with "## Project Structure". Do not include any other headers or preamble.

The section should:
1. Show an annotated directory tree for the top 2 levels (use markdown code block with tree-style indentation)
2. Follow the annotated tree with a brief description of each top-level directory (1-2 sentences each)
3. Call out where to find key files: entry points, config, tests

Rules:
- Only include directories and a few representative files — do not list every file
- Collapse deep subtrees into "..."
- Skip generated directories: node_modules, dist, build, __pycache__, .git, .next, vendor
- Use the actual directory names from the file tree
- Annotate inline with "# ..." comments where meaningful
- Keep descriptions factual and specific
```

---

## User Prompt Template

```
## File Tree
```
{filePaths}
```

## Entry Points
{entryPointPaths}

Generate the Project Structure section for this repository.
```

**Template variables:**
- `{filePaths}` — up to 200 file paths from CIG `files`, one per line, sorted by path
- `{entryPointPaths}` — list of entry point paths from CIG `entry_points`

---

## Output Format

```markdown
## Project Structure

```
project-root/
├── src/                    # Application source code
│   ├── api/               # HTTP route handlers
│   ├── services/          # Business logic
│   ├── models/            # Data models and DB schemas
│   └── utils/             # Shared utilities
├── tests/                  # Test suites
├── config/                 # Configuration files
├── Dockerfile
└── package.json
```

### Directory Overview

**`src/`** — Main application source. Contains route handlers, services, and data models.

**`src/api/`** — HTTP route definitions and request handlers. Routes are registered in `src/api/index.ts`.

**`tests/`** — Unit and integration tests. Mirrors the `src/` structure.

**`config/`** — Environment-specific configuration files.
```

---

## Acceptance Criteria

The generated section must:
- Show an accurate annotated tree matching the actual repo structure
- Exclude noise directories (node_modules, dist, .git)
- Correctly identify what each key directory is for
- Link to entry points by name

---

## Token Budget

- File paths: ~1,500 tokens (200 paths)
- Entry points: ~100 tokens
- System prompt: ~300 tokens
- **Total input:** ~2,000 tokens
- **Expected output:** ~350 tokens
- **Cached:** Yes — same file tree + prompt version → same output

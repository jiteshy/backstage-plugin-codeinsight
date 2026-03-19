# Core Prompt: Overview

**Module ID:** `core/overview`

**Purpose:** Generate the top-level overview section for a repository. Describes what the project does, who it is for, and its key features. Always included for every repo.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `entry_points` | Identify main entry files (index, main, app) |
| `detected.frameworks` | Name key frameworks in the tech stack summary |
| `detected.language` | Primary language |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| `README.md` / `README.rst` / `readme.md` | Preferred | Primary source for project description |
| `package.json` / `pyproject.toml` / `go.mod` | Yes | name, description, version |
| Entry point files (from CIG) | Yes | Top 1-2 entry points for context |

**Token budget:** ~4–8K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a clear, concise "Overview" section for a software project based on its README, package manifest, and entry point files.

Output ONLY a markdown section starting with "## Overview". Do not include any other headers or preamble.

The section should cover:
1. What the project does (1-2 sentences, lead with the value)
2. Who it is for / primary use case
3. Key features (bullet list, 3-6 items)
4. Tech stack summary (1 sentence naming key technologies)

Rules:
- Be specific — use names from the actual code, not generic descriptions
- Do not mention things not evidenced in the provided files
- Keep it under 400 words
- Use active voice
- Do not repeat the project name in every sentence
```

---

## User Prompt Template

```
## README
{readmeContent}

## Package Manifest ({manifestFileName})
```
{manifestContent}
```

## Entry Points
{entryPointFiles}

Generate the Overview section for this repository.
```

**Template variables:**
- `{readmeContent}` — full README content, truncated to 3K tokens if oversized
- `{manifestFileName}` — `package.json`, `pyproject.toml`, `go.mod`, etc.
- `{manifestContent}` — full manifest content
- `{entryPointFiles}` — content of top 1-2 entry point files from CIG `entry_points`, each prefixed with its file path

---

## Output Format

```markdown
## Overview

{project name} is a {what it does} for {who it's for}.

**Key features:**
- {feature 1}
- {feature 2}
- {feature 3}

Built with {tech stack summary}.
```

---

## Acceptance Criteria

The generated section must:
- Accurately describe the project's purpose (not generic filler)
- List real features visible in the codebase, not invented ones
- Name the actual tech stack (React, not "a frontend framework")
- Be readable by a developer unfamiliar with the repo

---

## Token Budget

- README: up to 3,000 tokens
- Package manifest: ~300 tokens
- Entry point files: up to 1,500 tokens (1-2 files)
- System prompt: ~250 tokens
- **Total input:** ~5,000 tokens
- **Expected output:** ~400 tokens
- **Cached:** Yes — same inputs + prompt version → same output

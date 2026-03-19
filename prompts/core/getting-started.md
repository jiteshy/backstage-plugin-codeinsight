# Core Prompt: Getting Started

**Module ID:** `core/getting-started`

**Purpose:** Generate a "Getting Started" section with installation, environment setup, and local development instructions. Derived from the package manifest scripts, Dockerfile, and example environment files.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.language` | Determine package manager and runtime prerequisites |
| `detected.frameworks` | Identify framework-specific setup steps |
| `entry_points` | Identify the main start command |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| `package.json` / `pyproject.toml` / `go.mod` | Yes | Scripts, dependencies, runtime version |
| `.env.example` / `.env.sample` | If present | Environment variable setup |
| `Dockerfile` | If present | Container-based setup alternative |
| `Makefile` | If present | Common dev commands |

**Token budget:** ~2–3K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Getting Started" section for a software project based on its package manifest, environment variable template, and Dockerfile.

Output ONLY a markdown section starting with "## Getting Started". Do not include any other headers or preamble.

The section should cover:
1. Prerequisites — runtime version, required tools (Node.js, Python, Go, Docker, etc.)
2. Installation — clone the repo and install dependencies
3. Environment setup — copy .env.example and configure required variables (list the required ones by name)
4. Running locally — the exact command(s) to start the development server
5. (Optional) Docker alternative — if a Dockerfile is present

Rules:
- Use actual script names from package.json / Makefile (e.g., `npm run dev`, not `start the server`)
- List environment variables by their exact names as they appear in .env.example
- Distinguish required from optional environment variables if determinable
- Do not invent setup steps not evidenced in the provided files
- Use numbered steps for sequential instructions
- Use inline code formatting for all commands and file names
```

---

## User Prompt Template

```
## Package Manifest ({manifestFileName})
```
{manifestContent}
```

## Environment Variables (.env.example)
```
{envExampleContent}
```

## Dockerfile
```dockerfile
{dockerfileContent}
```

## Makefile
```makefile
{makefileContent}
```

Generate the Getting Started section for this repository.
```

**Template variables:**
- `{manifestFileName}` — `package.json`, `pyproject.toml`, `go.mod`, etc.
- `{manifestContent}` — full manifest (scripts + dependencies sections prioritised)
- `{envExampleContent}` — full `.env.example` content; omit block if file not present
- `{dockerfileContent}` — full `Dockerfile` content; omit block if file not present
- `{makefileContent}` — full `Makefile` content; omit block if file not present

---

## Output Format

```markdown
## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+

### Installation

```bash
git clone <repo-url>
cd <project-name>
pnpm install
```

### Environment Setup

Copy the example environment file and configure the required variables:

```bash
cp .env.example .env
```

**Required variables:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_TOKEN` | GitHub API token for repo access |

**Optional variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |

### Running Locally

```bash
pnpm dev
```

The server starts on `http://localhost:3000`.

### Docker (Alternative)

```bash
docker build -t myapp .
docker run -p 3000:3000 --env-file .env myapp
```
```

---

## Acceptance Criteria

The generated section must:
- Use the correct package manager command (`pnpm`, `npm`, `pip`, `go run`, etc.)
- List environment variables by their exact names from `.env.example`
- Include the exact dev/start script name from the manifest
- Not include steps for tools that aren't required by the project

---

## Token Budget

- Package manifest: ~800 tokens
- `.env.example`: ~400 tokens
- `Dockerfile`: ~400 tokens
- `Makefile`: ~300 tokens
- System prompt: ~350 tokens
- **Total input:** ~2,250 tokens
- **Expected output:** ~450 tokens
- **Cached:** Yes — same inputs + prompt version → same output

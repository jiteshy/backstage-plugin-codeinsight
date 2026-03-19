# Core Prompt: Configuration

**Module ID:** `core/configuration`

**Purpose:** Generate a "Configuration" section documenting all configuration options, environment variables, and config file settings for the project.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.frameworks` | Identify framework-specific config conventions |
| `files` | Locate config files (*.config.js, *.yaml, *.toml, .env.example) |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| `.env.example` / `.env.sample` | Preferred | Primary source for env var docs |
| Config files (`*.config.js`, `*.yaml`, `*.toml`, `*.json` in root or `config/`) | If present | App-level config schemas |
| `docker-compose.yml` | If present | Service-level env var overrides |

**Token budget:** ~3–6K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Configuration" section for a software project based on its environment variable template and configuration files.

Output ONLY a markdown section starting with "## Configuration". Do not include any other headers or preamble.

The section should cover:
1. How configuration is loaded (env vars, config files, both)
2. A complete table of environment variables with: name, required/optional, default value, description
3. Any config files and their purpose (if separate from env vars)
4. Configuration validation behavior (if determinable from code)

Rules:
- List every variable from .env.example — do not omit any
- Mark variables as Required if they have no default value in .env.example
- Use the actual variable names exactly as written (case-sensitive)
- Group related variables under sub-headings if there are more than 8 variables
- Do not invent variables not present in the provided files
- If a config file uses a schema, describe the schema fields, not just the file name
```

---

## User Prompt Template

```
## .env.example
```
{envExampleContent}
```

## Config Files
{configFilesContent}

Generate the Configuration section for this repository.
```

**Template variables:**
- `{envExampleContent}` — full `.env.example` content
- `{configFilesContent}` — content of each config file, each prefixed with its file path as a header; omit section if no config files found; cap at 3 files / 2K tokens total

---

## Output Format

```markdown
## Configuration

Configuration is loaded from environment variables. Copy `.env.example` to `.env` to get started.

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (e.g., `postgres://user:pass@localhost:5432/mydb`) |
| `DATABASE_POOL_SIZE` | No | `10` | Maximum number of DB connections in the pool |

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret key for signing JWT tokens. Use a long random string in production. |
| `JWT_EXPIRY` | No | `7d` | Token expiry duration (e.g., `1h`, `7d`) |

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP port the server listens on |
| `LOG_LEVEL` | No | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
```

---

## Acceptance Criteria

The generated section must:
- Include every variable from `.env.example` — no omissions
- Use exact variable names (case-sensitive)
- Correctly identify required vs optional (variables with no default are required)
- Group variables logically when there are more than 8
- Describe what each variable actually controls

---

## Token Budget

- `.env.example`: ~600 tokens
- Config files: up to 2,000 tokens (3 files max)
- System prompt: ~300 tokens
- **Total input:** ~3,000 tokens
- **Expected output:** ~500 tokens
- **Cached:** Yes — same inputs + prompt version → same output

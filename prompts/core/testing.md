# Core Prompt: Testing

**Module ID:** `core/testing`

**Purpose:** Generate a "Testing" section documenting the test setup, how to run tests, test structure, and coverage approach. Only included when the classifier detects test files in the repository.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.test_framework` | Name the test framework |
| `files` | Locate test files and directories |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Test config file (`jest.config.*`, `vitest.config.*`, `pytest.ini`, `pyproject.toml [tool.pytest]`, `go test`) | If present | Test runner configuration |
| Sample test files (2-3 representative files from CIG) | Yes | Show test patterns actually used |
| `package.json` | For Node.js | `test` script definition |

**Token budget:** ~3–6K tokens input / ~500 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Testing" section for a software project based on its test configuration and sample test files.

Output ONLY a markdown section starting with "## Testing". Do not include any other headers or preamble.

The section should cover:
1. How to run tests — the exact command(s)
2. Test framework and key plugins/extensions in use
3. Test structure — where tests live, how they are organised
4. Types of tests present (unit, integration, e2e) with examples of what each covers
5. Coverage collection (if configured)

Rules:
- Use actual command names from the test config or package.json scripts
- Reference real test file paths from the provided samples
- Describe what the sample tests actually test — not generic placeholder descriptions
- If multiple test commands exist (unit vs e2e), document each separately
- Do not describe test patterns not evidenced in the provided files
```

---

## User Prompt Template

```
## Test Configuration ({configFileName})
```
{testConfigContent}
```

## package.json (test scripts)
```json
{testScripts}
```

## Sample Test Files

### {testFile1Path}
```{language}
{testFile1Content}
```

### {testFile2Path}
```{language}
{testFile2Content}
```

### {testFile3Path}
```{language}
{testFile3Content}
```

Generate the Testing section for this repository.
```

**Template variables:**
- `{configFileName}` — `jest.config.ts`, `vitest.config.ts`, `pytest.ini`, etc.; omit block if not present
- `{testConfigContent}` — full test config file content
- `{testScripts}` — only the `scripts` object from `package.json`, filtered to test-related keys
- `{testFile1Path}`, `{testFile2Path}`, `{testFile3Path}` — paths of up to 3 representative test files selected from CIG; prefer files that show different test types (unit, integration, e2e); omit the third block if fewer than 3 test files are available
- `{testFile1Content}`, `{testFile2Content}`, `{testFile3Content}` — file content, truncated to 800 tokens each
- `{language}` — file language for syntax highlighting (`typescript`, `javascript`, `python`, etc.)

---

## Output Format

```markdown
## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage
```

### Test Framework

Uses **Jest** with **ts-jest** for TypeScript support. Tests run in Node.js environment.

### Test Structure

Tests live alongside source files in `__tests__/` directories, following the same module structure as `src/`.

```
src/
├── services/
│   ├── AuthService.ts
│   └── __tests__/
│       └── AuthService.test.ts    # Unit tests — mocks DB adapter
├── routes/
│   └── __tests__/
│       └── auth.test.ts           # Integration tests — uses supertest
```

### Test Types

**Unit tests** (`*.test.ts`) — Test individual services and utilities in isolation. External dependencies (DB, LLM, HTTP) are mocked via constructor injection.

**Integration tests** (`*.integration.test.ts`) — Test HTTP routes using `supertest` against an in-memory server. DB is mocked at the adapter level.

### Coverage

Coverage is collected with V8 and reported to `coverage/`. Run `pnpm test:coverage` to generate.
```

---

## Acceptance Criteria

The generated section must:
- Include the exact test commands from the manifest scripts
- Correctly name the test framework (Jest, Vitest, pytest, go test, etc.)
- Describe the actual test structure visible in the sample files
- Distinguish between unit and integration tests if both are present
- Not invent test patterns not visible in the provided files

---

## Token Budget

- Test config: ~400 tokens
- Test scripts: ~200 tokens
- Up to 3 sample test files: ~2,400 tokens (800 each)
- System prompt: ~300 tokens
- **Total input:** ~3,300 tokens
- **Expected output:** ~400 tokens
- **Cached:** Yes — same inputs + prompt version → same output

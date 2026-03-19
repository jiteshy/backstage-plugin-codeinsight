# Backend Prompt: API Reference

**Module ID:** `backend/api-reference`

**Purpose:** Generate an "API Reference" section documenting all HTTP endpoints: method, path, request parameters, request body, and response shape. Included when the repo is a backend or fullstack service.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `routes` | HTTP route definitions (method, path, handler) — primary data source |
| `symbols` | Handler function signatures for parameter/response inference |
| `detected.frameworks` | Identify routing conventions (Express, FastAPI, Gin, NestJS, etc.) |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Route files (from CIG `routes`) | Yes | Top route definition files; prioritise index/router files |
| Middleware files (auth, validation) | If present | For request schema and auth requirements per route |
| OpenAPI / Swagger spec | If present | Use directly if available; skip LLM for structure |

**Token budget:** ~5–10K tokens input / ~800 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate an "API Reference" section for a backend service based on its route definitions and handler code.

Output ONLY a markdown section starting with "## API Reference". Do not include any other headers or preamble.

The section should:
1. Open with 1-2 sentences on the base URL and authentication method (if determinable)
2. Group endpoints by resource/domain (e.g., "Users", "Repositories", "Jobs")
3. For each endpoint, document:
   - Method and path (e.g., `GET /api/repos/:repoId`)
   - Description (what it does)
   - Path parameters (name, type, description)
   - Query parameters (name, required/optional, description)
   - Request body (if applicable — fields, types)
   - Response (status codes and response shape)

Rules:
- Use the actual route paths exactly as defined in the code
- Group by the first path segment or resource noun — not by file
- If auth middleware is applied to a route group, note "Requires authentication"
- Infer request/response shapes from handler code and type annotations; do not invent fields not visible in the code
- Use markdown tables for parameters; use code blocks for request/response body examples
- If there are more than 20 endpoints, document the most important ones and note that the list is non-exhaustive
```

---

## User Prompt Template

```
## Routes (from CIG)
{routesList}

## Route Handler Files

### {routeFile1Path}
```{language}
{routeFile1Content}
```

### {routeFile2Path}
```{language}
{routeFile2Content}
```

## Framework: {framework}

Generate the API Reference section for this repository.
```

**Template variables:**
- `{routesList}` — structured list from CIG `routes`: one entry per route as `METHOD /path — handler: functionName (file:line)`
- `{routeFile1Path}`, `{routeFile2Path}` — paths of the top route definition files from CIG; prefer router/index files over individual handler files
- `{routeFile1Content}`, `{routeFile2Content}` — file content, truncated to 2K tokens each
- `{language}` — file language for syntax highlighting
- `{framework}` — the backend framework selected from CIG `detected.frameworks`; prefer backend frameworks (`express`, `fastapi`, `nestjs`, `gin`, `echo`, `fastify`, `flask`, `django`) over frontend ones when multiple are present (e.g., for a fullstack repo `["react", "express"]`, use `express`); fall back to the first element if no known backend framework is found

---

## Output Format

```markdown
## API Reference

Base URL: `/api/v1`. All endpoints that modify state require a valid JWT in the `Authorization: Bearer <token>` header.

### Repositories

#### `GET /api/repos`

List all registered repositories.

**Response**

```json
[
  {
    "repoId": "string",
    "name": "string",
    "url": "string",
    "status": "idle | processing | ready | error"
  }
]
```

---

#### `POST /api/repos`

Register a new repository for analysis.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Repository clone URL |
| `name` | string | Yes | Display name |
| `provider` | string | Yes | `github`, `gitlab`, or `bitbucket` |

**Response:** `201 Created` with the created repository object.

---

#### `GET /api/repos/:repoId`

Get a single repository by ID.

**Path Parameters**

| Parameter | Description |
|-----------|-------------|
| `repoId` | Repository identifier |

**Response:** `200 OK` with repository object, or `404` if not found.
```

---

## Acceptance Criteria

The generated section must:
- List all routes visible in the provided route files (not invented)
- Use exact route paths and HTTP methods from the code
- Group endpoints by resource, not by file
- Include path/query params visible in handler signatures
- Note auth requirements where middleware is applied

---

## Token Budget

- CIG routes list: ~500 tokens (structured list)
- Route handler files: up to 4,000 tokens (2 files × 2K)
- System prompt: ~400 tokens
- **Total input:** ~5,000 tokens
- **Expected output:** ~700 tokens
- **Cached:** Yes — same inputs + prompt version → same output

# Backend Prompt: Authentication & Authorization

**Module ID:** `backend/auth`

**Purpose:** Generate an "Authentication & Authorization" section documenting the auth strategy, token lifecycle, protected routes, and permission model. Included when an auth library or auth-related files are detected.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.auth` | Identify auth library/strategy (passport, next-auth, jwt, oauth2, clerk) |
| `symbols` | Auth-related function signatures (login, verify, guard, middleware) |
| `routes` | Identify which routes have auth middleware applied |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Auth middleware file(s) (`auth.ts`, `middleware/auth.ts`, `guards/`, `passport.ts`) | Yes | Core auth logic |
| Token/session files (`jwt.ts`, `session.ts`, `tokens.ts`) | If present | Token generation and validation |
| Auth route files (`auth/routes.ts`, `auth/controller.ts`) | If present | Login, logout, refresh endpoints |

**Token budget:** ~4–8K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate an "Authentication & Authorization" section for a backend service based on its auth middleware, token handling, and route protection code.

Output ONLY a markdown section starting with "## Authentication & Authorization". Do not include any other headers or preamble.

The section should cover:
1. Auth strategy — what mechanism is used (JWT, session, OAuth2, API keys, etc.)
2. Authentication flow — step-by-step: how a client obtains credentials and authenticates
3. Token/session lifecycle — how tokens are issued, validated, refreshed, and revoked
4. Protected routes — which route groups require authentication (reference the route structure)
5. Authorization / permissions — roles, scopes, or permission checks if present

Rules:
- Describe the auth flow from the client's perspective (request → response)
- Use actual function names and middleware names from the code
- If JWT is used, document the token payload fields (sub, exp, roles, etc.) if visible in the code
- If OAuth2, document the provider(s) and callback flow
- Do not document security vulnerabilities or internal implementation details not relevant to API consumers
- Do not include credential values, secrets, or example tokens
```

---

## User Prompt Template

```
## Auth Library: {authLibrary}

## Auth Middleware ({authMiddlewareFile})
```{language}
{authMiddlewareContent}
```

## Token Handling ({tokenFile})
```{language}
{tokenFileContent}
```

## Auth Routes ({authRoutesFile})
```{language}
{authRoutesContent}
```

## Protected Route Groups (from CIG)
{protectedRoutes}

Generate the Authentication & Authorization section for this repository.
```

**Template variables:**
- `{authLibrary}` — from CIG `detected.auth` (e.g., `passport-jwt`, `next-auth`, `jsonwebtoken`, `clerk`)
- `{authMiddlewareFile}` — path of the primary auth middleware file
- `{authMiddlewareContent}` — file content, up to 2K tokens
- `{tokenFile}` — path of token utility file; omit block if not found
- `{tokenFileContent}` — file content, up to 1.5K tokens
- `{authRoutesFile}` — path of auth route definitions; omit block if not found
- `{authRoutesContent}` — file content, up to 1.5K tokens
- `{protectedRoutes}` — list of routes from CIG that have auth middleware applied, formatted as `METHOD /path (middleware: authMiddlewareName)`; omit if not determinable

---

## Output Format

```markdown
## Authentication & Authorization

### Strategy

Uses **JWT (JSON Web Tokens)** for stateless authentication. Tokens are signed with HS256 using a secret key configured via `JWT_SECRET`.

### Authentication Flow

1. Client sends `POST /api/auth/login` with `{ email, password }` in the request body
2. Server validates credentials against the database
3. On success, server returns an access token (15 min expiry) and a refresh token (7 day expiry)
4. Client includes the access token in subsequent requests: `Authorization: Bearer <token>`
5. When the access token expires, client sends `POST /api/auth/refresh` with the refresh token

### Token Payload

Access tokens contain:

| Claim | Description |
|-------|-------------|
| `sub` | User ID |
| `email` | User's email |
| `roles` | Array of role names (e.g., `["admin", "viewer"]`) |
| `iat` | Issued-at timestamp |
| `exp` | Expiry timestamp |

### Protected Routes

All routes under `/api/repos`, `/api/jobs`, and `/api/docs` require a valid access token. The `authenticate` middleware validates the token on each request.

Public routes (no auth required):
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/health`

### Authorization

Role-based access control is applied via the `requireRole(role)` middleware:

- **`viewer`** — Read-only access to repos and generated docs
- **`admin`** — Full access including triggering analysis jobs and deleting repos
```

---

## Acceptance Criteria

The generated section must:
- Correctly identify the auth strategy from the code (JWT, session, OAuth2, etc.)
- Describe the actual authentication flow (login → token → protected request)
- List which routes are protected based on middleware application in the code
- Document token payload fields visible in signing/verification code
- Not include secrets, example tokens, or internal implementation details

---

## Token Budget

- Auth middleware: up to 2,000 tokens
- Token file: up to 1,500 tokens
- Auth routes: up to 1,500 tokens
- Protected routes list: ~300 tokens
- System prompt: ~400 tokens
- **Total input:** ~6,000 tokens
- **Expected output:** ~500 tokens
- **Cached:** Yes — same inputs + prompt version → same output

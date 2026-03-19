# Frontend Prompt: Routing

**Module ID:** `frontend/routing`

**Purpose:** Generate a "Routing" section documenting the client-side routing structure: route definitions, URL patterns, route guards, and navigation flow. Included when a router library is detected.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.frameworks` | Identify router library (react-router, vue-router, next.js app/pages router, angular router, tanstack router) |
| `symbols` | Route component registrations, guards, layouts |
| `files` | Locate router config files and page/view files |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Router config file (`router.ts`, `routes.ts`, `App.tsx` with `<Routes>`, `next.config.js`) | Yes | Primary route definitions |
| Auth guard / route guard files | If present | Protected route logic |
| Layout files (`Layout.tsx`, `RootLayout.tsx`) | If present | Shared layouts per route group |

**Token budget:** ~3–6K tokens input / ~500 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Routing" section for a frontend application based on its router configuration and page/view files.

Output ONLY a markdown section starting with "## Routing". Do not include any other headers or preamble.

The section should cover:
1. Router library and routing approach (hash, history, file-based, etc.)
2. Route table — all defined routes with their path, component/page, and access level
3. Route guards — how protected routes are implemented (auth guards, redirect logic)
4. Layouts — shared layouts applied to route groups (if present)
5. Navigation — how navigation is performed programmatically (useNavigate, useRouter, router.push)

Rules:
- List every route visible in the router config file
- Use the actual path strings and component names from the code
- For file-based routers (Next.js, Nuxt, SvelteKit), infer routes from the file structure
- Indicate which routes are public vs protected
- If nested routes exist, show the nesting with indentation
- Do not invent routes not visible in the provided files
```

---

## User Prompt Template

```
## Router Library: {routerLibrary}

## Router Configuration ({routerFile})
```{language}
{routerContent}
```

## Route Guard ({guardFile})
```{language}
{guardContent}
```

## Layout ({layoutFile})
```{language}
{layoutContent}
```

Generate the Routing section for this repository.
```

**Template variables:**
- `{routerLibrary}` — from CIG `detected.frameworks` filtered to router libs (e.g., `react-router-dom`, `vue-router`, `next.js`, `tanstack-router`, `angular-router`)
- `{routerFile}` — path of the primary router config file
- `{routerContent}` — file content, up to 3K tokens
- `{guardFile}` — path of auth/route guard file; omit block if not present
- `{guardContent}` — file content, up to 1K tokens
- `{layoutFile}` — path of root layout file; omit block if not present
- `{layoutContent}` — file content, up to 1K tokens

---

## Output Format

```markdown
## Routing

Uses **React Router v6** with a centralised route configuration in `src/router.tsx`.

### Route Table

| Path | Component | Access | Description |
|------|-----------|--------|-------------|
| `/` | `HomePage` | Public | Landing page |
| `/login` | `LoginPage` | Public | Authentication |
| `/dashboard` | `DashboardPage` | Protected | Main dashboard |
| `/repos` | `RepoListPage` | Protected | Repository list |
| `/repos/:repoId` | `RepoDetailPage` | Protected | Single repo view |
| `/repos/:repoId/docs` | `DocsPage` | Protected | Generated documentation |
| `/repos/:repoId/diagrams` | `DiagramsPage` | Protected | Diagram viewer |
| `*` | `NotFoundPage` | Public | 404 fallback |

### Protected Routes

Routes under `/dashboard`, `/repos`, and their children require authentication. The `<ProtectedRoute>` component checks for a valid token in `useAuthStore`. Unauthenticated users are redirected to `/login` with the intended path stored in `location.state.from`.

```typescript
// Usage in router config:
<Route element={<ProtectedRoute />}>
  <Route path="/repos" element={<RepoListPage />} />
</Route>
```

### Layouts

All authenticated routes share the `<AppLayout>` component, which renders the top navigation bar and sidebar. Public routes use the bare `<PublicLayout>` (no navigation).

### Programmatic Navigation

```typescript
const navigate = useNavigate();

// Redirect after login:
navigate(from || '/dashboard', { replace: true });

// Navigate to a repo:
navigate(`/repos/${repoId}/docs`);
```
```

---

## Acceptance Criteria

The generated section must:
- List all routes defined in the router config (not invented)
- Use exact path strings and component names from the code
- Correctly identify protected vs public routes based on guard/wrapper usage
- Describe the redirect behaviour for unauthenticated access
- Show the programmatic navigation API used

---

## Token Budget

- Router config: up to 3,000 tokens
- Guard file: up to 1,000 tokens
- Layout file: up to 1,000 tokens
- System prompt: ~350 tokens
- **Total input:** ~5,500 tokens
- **Expected output:** ~450 tokens
- **Cached:** Yes — same inputs + prompt version → same output

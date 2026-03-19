# Frontend Prompt: State Management

**Module ID:** `frontend/state-management`

**Purpose:** Generate a "State Management" section documenting the client-side state architecture: which library is used, how stores are structured, what state lives where, and how components interact with state. Included when a state management library is detected.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `detected.state_management` | Identify the library (redux, zustand, mobx, pinia, recoil, jotai) |
| `symbols` | Store definitions, actions, selectors, atoms |
| `files` | Locate store files |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Store definition files (`store/`, `stores/`, `*.store.ts`, `slices/`) | Yes | Primary source; top 2-3 store files |
| Sample component file that uses state | If present | Shows how components consume state |

**Token budget:** ~4–8K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "State Management" section for a frontend application based on its store definitions and sample component usage.

Output ONLY a markdown section starting with "## State Management". Do not include any other headers or preamble.

The section should cover:
1. Library and approach — which state management library and the core pattern it uses
2. Store structure — what stores/slices/atoms exist and what domain they own
3. State shape — the key data each major store holds (fields and types)
4. Actions / mutations — the main operations that modify state
5. Selectors / derived state — computed values or selectors if present
6. How components connect — the hook or HOC pattern used to access state in components

Rules:
- Use the actual store names and action names from the code
- For Redux: describe slices, actions, and selectors separately
- For Zustand: describe the store interface (state fields + actions in one object)
- For MobX: describe observable fields and actions
- For Pinia: describe state, getters, and actions per store
- For Recoil: describe atoms, selectors (derived state), and RecoilRoot provider placement
- For Jotai: describe atoms (primitive and derived via `atom(get => ...)`) and the providerless usage pattern (no wrapping Provider required)
- Adapt the structure to the library's actual pattern — do not force Redux terminology onto Zustand
- Do not describe internal implementation details (immer patches, middleware wiring, etc.) unless they affect how developers use the store
```

---

## User Prompt Template

```
## State Management Library: {stateLibrary}

## Store Files

### {storeFile1Path}
```{language}
{storeFile1Content}
```

### {storeFile2Path}
```{language}
{storeFile2Content}
```

## Sample Component Using State ({componentFilePath})
```{language}
{componentContent}
```

Generate the State Management section for this repository.
```

**Template variables:**
- `{stateLibrary}` — from CIG `detected.state_management` (e.g., `zustand`, `redux-toolkit`, `pinia`, `mobx`, `recoil`, `jotai`)
- `{storeFile1Path}`, `{storeFile2Path}` — paths of the top 2-3 store files selected from CIG; prefer root store, auth store, or the largest stores
- `{storeFile1Content}`, `{storeFile2Content}` — file content, up to 2K tokens each
- `{componentFilePath}` — path of a sample component that uses `useSelector`, `useStore`, or equivalent; omit block if not found
- `{componentContent}` — file content, up to 1K tokens

---

## Output Format (Zustand example)

```markdown
## State Management

Uses **Zustand** for lightweight, hook-based state management. Each store is a self-contained module with state and actions co-located.

### Stores

| Store | File | Domain |
|-------|------|--------|
| `useAuthStore` | `src/stores/auth.store.ts` | Authentication and user session |
| `useRepoStore` | `src/stores/repo.store.ts` | Repository list and selected repo |
| `useJobStore` | `src/stores/job.store.ts` | Ingestion job status and history |

### `useAuthStore`

```typescript
interface AuthStore {
  user: User | null;         // Authenticated user, null if logged out
  token: string | null;      // JWT access token
  isLoading: boolean;

  // Actions
  login(email: string, password: string): Promise<void>;
  logout(): void;
  refreshToken(): Promise<void>;
}
```

### `useRepoStore`

```typescript
interface RepoStore {
  repos: Repository[];       // All registered repositories
  selectedRepoId: string | null;
  isLoading: boolean;

  // Actions
  fetchRepos(): Promise<void>;
  selectRepo(repoId: string): void;
  triggerAnalysis(repoId: string): Promise<void>;
}
```

### Accessing State in Components

```typescript
// In a component:
const { user, login } = useAuthStore();
const { repos, fetchRepos } = useRepoStore();
```

Zustand stores are React hooks — no Provider wrapping required.
```

---

## Output Format (Redux Toolkit example)

```markdown
## State Management

Uses **Redux Toolkit** with a centralised store. State is divided into slices by domain.

### Store Structure

```
store/
├── index.ts              # configureStore with all reducers
├── slices/
│   ├── authSlice.ts      # User session and authentication state
│   ├── repoSlice.ts      # Repository list and selection
│   └── jobSlice.ts       # Ingestion job status
```

### `authSlice`

**State shape:**
```typescript
{
  user: User | null;
  token: string | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}
```

**Actions:** `loginAsync(credentials)`, `logout()`, `refreshTokenAsync()`

**Selectors:** `selectUser`, `selectIsAuthenticated`, `selectAuthStatus`

### Accessing State in Components

```typescript
// Reading state
const user = useSelector(selectUser);

// Dispatching actions
const dispatch = useDispatch();
dispatch(loginAsync({ email, password }));
```
```

---

## Acceptance Criteria

The generated section must:
- Correctly name the state management library (Redux, Zustand, Pinia, etc.)
- Use the actual store/slice/atom names from the code
- Describe the state shape for each major store using actual field names
- Show the component integration pattern (hook, mapStateToProps, etc.)
- Adapt structure to the library's idioms — not generic "store" terminology

---

## Token Budget

- 2-3 store files: up to 4,000 tokens
- Sample component: up to 1,000 tokens
- System prompt: ~400 tokens
- **Total input:** ~5,500 tokens
- **Expected output:** ~500 tokens
- **Cached:** Yes — same inputs + prompt version → same output

# Frontend Prompt: Component Hierarchy

**Module ID:** `frontend/component-hierarchy`

**Purpose:** Generate a "Component Hierarchy" section documenting the UI component tree, how components are composed, and which components are shared vs page-specific. Driven primarily by the CIG import graph — no file content needed.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `dependency_graph` | Component import relationships (what imports what) — **primary data source; no file content needed** |
| `files` | Identify component files vs page files vs utility files |
| `symbols` | Component function/class names and their export status |
| `detected.frameworks` | Identify component framework (React, Vue, Angular, Svelte) |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| **None required** — the CIG import graph provides the hierarchy without reading file content | — | File content is only included if the import graph alone is insufficient |
| Root app component (`App.tsx`, `App.vue`, `app.component.ts`) | Optional fallback | Only if CIG graph coverage is sparse |

**Token budget:** ~2–5K tokens input / ~500 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Component Hierarchy" section for a frontend application based on its component import graph.

Output ONLY a markdown section starting with "## Component Hierarchy". Do not include any other headers or preamble.

The section should cover:
1. Component organisation — how components are categorised (pages, layouts, features, shared/common)
2. Top-level structure — the main component tree from App root to major page components
3. Shared components — reusable components used across multiple pages
4. Feature components — components scoped to a specific feature or domain

Rules:
- Use the actual component names from the import graph
- Show hierarchy as an indented tree or nested list, not a flat list
- Separate "pages" (route-level, each used once) from "shared" components (imported by 2+ parents)
- Do not list every leaf component — focus on the structure (top 2-3 levels)
- Identify the most-imported shared components (high in-degree in the import graph) as "core UI components"
- Do not describe what each component renders unless it is clear from the name
```

---

## User Prompt Template

```
## Framework: {framework}

## Component Import Graph
```
{componentImportGraph}
```

## Component File List
{componentFiles}

Generate the Component Hierarchy section for this repository.
```

**Template variables:**
- `{framework}` — from CIG `detected.frameworks` (e.g., `react`, `vue`, `angular`, `svelte`)
- `{componentImportGraph}` — structured list from CIG `dependency_graph` filtered to component files only; format: one line per edge as `ComponentA → ComponentB`; cap at 150 edges (~2K tokens)
- `{componentFiles}` — list of component file paths from CIG `files` filtered by extension (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.component.ts`); grouped by directory; cap at 100 files

---

## Output Format

```markdown
## Component Hierarchy

### Organisation

Components are organised into four categories:

| Category | Location | Purpose |
|----------|----------|---------|
| **Pages** | `src/pages/` | Route-level views, one per route |
| **Layouts** | `src/layouts/` | Shared page frames (nav, sidebar) |
| **Features** | `src/features/` | Domain-specific component groups |
| **Common** | `src/components/` | Reusable UI primitives |

### Application Tree

```
App
├── AppLayout (layout)
│   ├── TopNav
│   │   ├── UserMenu
│   │   └── NotificationBell
│   ├── Sidebar
│   │   └── NavItem (×n)
│   └── <Outlet>
│       ├── DashboardPage
│       ├── RepoListPage
│       │   ├── RepoCard (×n)
│       │   └── RepoFilterBar
│       └── RepoDetailPage
│           ├── RepoHeader
│           ├── DocViewer
│           │   └── MarkdownSection (×n)
│           └── DiagramViewer
└── PublicLayout (layout)
    ├── LoginPage
    └── NotFoundPage
```

### Shared Components

These components are used across multiple pages and features:

| Component | Imported by | Description |
|-----------|-------------|-------------|
| `Button` | 12 components | Primary interactive element |
| `Card` | 8 components | Content container with border and shadow |
| `LoadingSpinner` | 6 components | Async loading indicator |
| `ErrorBoundary` | 4 components | Error state wrapper |
| `MarkdownContent` | 3 components | Rendered markdown display |

### Feature Components

**`src/features/repos/`** — Repository management UI: `RepoCard`, `RepoFilterBar`, `RepoStatusBadge`, `TriggerAnalysisButton`

**`src/features/docs/`** — Documentation viewer: `DocViewer`, `MarkdownSection`, `SectionNav`, `GeneratedAt`

**`src/features/diagrams/`** — Diagram display: `DiagramViewer`, `MermaidRenderer`, `DiagramSelector`
```

---

## Acceptance Criteria

The generated section must:
- Show the actual component tree derived from the import graph (not invented)
- Correctly identify shared components as those with high import fan-in
- Separate page-level components from reusable/shared components
- Use actual component names from CIG symbols
- Produce a useful tree without listing every leaf node

---

## Token Budget

- Component import graph: ~2,000 tokens (150 edges)
- Component file list: ~500 tokens
- System prompt: ~350 tokens
- **Total input:** ~3,000 tokens
- **Expected output:** ~450 tokens
- **No file content required** — pure CIG graph traversal
- **Cached:** Yes — same import graph + prompt version → same output

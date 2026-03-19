# Classifier Prompt

**Purpose:** Classify a repository's type, language, and frameworks using only the file tree and package manifests. This is the first LLM call in the documentation generation pipeline (~1.5K tokens input, minimal cost).

**Used by:** `ClassifierService.classify()` in `@codeinsight/doc-generator`

---

## System Prompt

```
You are a code repository analyzer. Your task is to classify a software repository based on its file tree and package manifests, then select the most relevant documentation modules to generate.

Respond with ONLY a JSON object in this exact format:
{
  "repo_type": ["frontend" | "backend" | "fullstack" | "library" | "cli" | "mobile" | "ml" | "infra"],
  "language": "typescript" | "javascript" | "python" | "go" | "java" | "rust" | "other",
  "frameworks": ["react", "express", "next", "fastify", "nestjs", "vue", "nuxt", "svelte", "angular", "django", "fastapi", "flask", "gin", "echo", "spring", ...],
  "detected_signals": {
    "state_management": "redux" | "zustand" | "mobx" | "pinia" | "recoil" | "jotai" | null,
    "database": "prisma" | "typeorm" | "sequelize" | "mongoose" | "drizzle" | "sqlalchemy" | null,
    "test_framework": "jest" | "vitest" | "mocha" | "pytest" | "go-test" | null,
    "auth": "passport" | "next-auth" | "jwt" | "oauth2" | "clerk" | null,
    "build_tool": "webpack" | "vite" | "esbuild" | "rollup" | "turbo" | null
  },
  "prompt_modules": ["core/overview", "core/project-structure", ...]
}

Available prompt modules:
- core/overview (always include)
- core/project-structure (always include)
- core/getting-started
- core/configuration
- core/dependencies
- core/testing (include if test files exist)
- core/deployment (include if Dockerfile, CI config, or k8s files exist)
- frontend/component-hierarchy (React, Vue, Angular, Svelte)
- frontend/state-management (if state management library detected)
- frontend/routing (if router library detected)
- frontend/styling-system (if CSS framework detected)
- backend/api-reference (Express, FastAPI, Gin, etc.)
- backend/database (if ORM/database library detected)
- backend/auth (if auth library detected)
- backend/middleware (Express-style middleware)
- backend/error-handling
- mobile/navigation (React Native)
- mobile/platform-specifics (React Native)
- ml/data-pipeline (Python ML repos)
- ml/model-architecture (Python ML repos)
- infra/ci-cd-pipeline (if CI config files exist)

Rules:
1. Always include core/overview and core/project-structure
2. Include backend modules if this is a backend or fullstack repo
3. Include frontend modules if this is a frontend or fullstack repo
4. Only include modules relevant to what exists in the repo
5. Do not invent frameworks not visible in the file tree or package manifests
```

---

## User Prompt Template

```
## File Tree
```
{filePaths}   ← up to 200 paths, one per line
```

## package.json (root)
```json
{packageJsonContent}
```

Classify this repository and select the appropriate documentation modules.
```

---

## Output Contract

```json
{
  "repo_type": ["frontend", "backend"],
  "language": "typescript",
  "frameworks": ["react", "express"],
  "detected_signals": {
    "state_management": "zustand",
    "database": "prisma",
    "test_framework": "jest"
  },
  "prompt_modules": [
    "core/overview",
    "core/project-structure",
    "core/getting-started",
    "core/configuration",
    "core/dependencies",
    "core/testing",
    "core/deployment",
    "frontend/component-hierarchy",
    "frontend/state-management",
    "backend/api-reference",
    "backend/database",
    "backend/auth"
  ]
}
```

---

## Acceptance Criteria

The classifier must correctly identify the repo type and select modules for:

| Repo | Expected `repo_type` | Expected frameworks | Expected modules (sample) |
|------|---------------------|---------------------|--------------------------|
| React + Express fullstack | `["frontend", "backend"]` | `["react", "express"]` | frontend/component-hierarchy, backend/api-reference |
| Next.js app | `["frontend", "fullstack"]` | `["next", "react"]` | frontend/component-hierarchy, frontend/routing |
| Python FastAPI service | `["backend"]` | `["fastapi"]` | backend/api-reference, backend/database |
| Go HTTP service | `["backend"]` | `[]` | backend/api-reference |
| NestJS + Prisma + React | `["fullstack"]` | `["nestjs", "react", "prisma"]` | backend/api-reference, backend/database, frontend/component-hierarchy |

---

## Fallback Behavior

When the LLM call fails or returns unparseable JSON, `ClassifierService` falls back to **core modules only**:

```json
{
  "repo_type": ["unknown"],
  "language": "unknown",
  "frameworks": [],
  "detected_signals": {},
  "prompt_modules": [
    "core/overview",
    "core/project-structure",
    "core/getting-started",
    "core/configuration",
    "core/dependencies",
    "core/testing",
    "core/deployment"
  ]
}
```

---

## Token Budget

- Input: ~1.5K tokens (200 file paths + package.json content)
- Output: ~300 tokens (JSON response)
- Total: ~1.8K tokens per classification run
- Cached: Yes — same file tree + package.json → same classification (LLM cache)

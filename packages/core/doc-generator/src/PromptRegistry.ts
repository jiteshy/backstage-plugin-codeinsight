// ---------------------------------------------------------------------------
// PromptRegistry — maps module IDs to system prompts and user prompt builders
// ---------------------------------------------------------------------------

/** A registered prompt module with system prompt and user prompt template. */
export interface PromptDefinition {
  moduleId: string;
  systemPrompt: string;
  /**
   * Build the user prompt from the provided variables.
   * Variables are key-value pairs whose meaning depends on the module.
   */
  buildUserPrompt(vars: Record<string, string>): string;
}

// ---------------------------------------------------------------------------
// System prompts — extracted from prompts/*.md files
// ---------------------------------------------------------------------------

const SYSTEM_PROMPTS: Record<string, string> = {
  'core/overview': `You are a technical documentation writer. Generate a clear, concise "Overview" section for a software project based on its README, package manifest, and entry point files.

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
- Do not repeat the project name in every sentence`,

  'core/project-structure': `You are a technical documentation writer. Generate a "Project Structure" section for a software repository based on its file tree.

Output ONLY a markdown section starting with "## Project Structure". Do not include any other headers or preamble.

The section should:
1. Show an annotated directory tree for the top 2 levels (use markdown code block with tree-style indentation)
2. Follow the annotated tree with a brief description of each top-level directory (1-2 sentences each)
3. Call out where to find key files: entry points, config, tests

Rules:
- Only include directories and a few representative files — do not list every file
- Collapse deep subtrees into "..."
- Skip generated directories: node_modules, dist, build, __pycache__, .git, .next, vendor
- Use the actual directory names from the file tree
- Annotate inline with "# ..." comments where meaningful
- Keep descriptions factual and specific`,

  'core/getting-started': `You are a technical documentation writer. Generate a "Getting Started" section for a software project based on its package manifest, environment variable template, and Dockerfile.

Output ONLY a markdown section starting with "## Getting Started". Do not include any other headers or preamble.

The section should cover:
1. Prerequisites — runtime version, required tools (Node.js, Python, Go, Docker, etc.)
2. Installation — clone the repo and install dependencies
3. Environment setup — copy .env.example and configure required variables (list the required ones by name)
4. Running locally — the exact command(s) to start the development server
5. (Optional) Docker alternative — if a Dockerfile is present

Rules:
- Use actual script names from package.json / Makefile (e.g., \`npm run dev\`, not \`start the server\`)
- List environment variables by their exact names as they appear in .env.example
- Distinguish required from optional environment variables if determinable
- Do not invent setup steps not evidenced in the provided files
- Use numbered steps for sequential instructions
- Use inline code formatting for all commands and file names`,

  'core/configuration': `You are a technical documentation writer. Generate a "Configuration" section for a software project based on its environment variable template and configuration files.

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
- If a config file uses a schema, describe the schema fields, not just the file name`,

  'core/dependencies': `You are a technical documentation writer. Generate a "Dependencies" section for a software project based on its package manifest.

Output ONLY a markdown section starting with "## Dependencies". Do not include any other headers or preamble.

The section should cover:
1. Runtime/production dependencies — focus on the major packages (skip trivial utilities like lodash, uuid, etc. unless they are central to the architecture)
2. Development dependencies — group by purpose (testing, building, linting)
3. Notable version constraints or peer dependency requirements

Rules:
- Explain what each major dependency DOES in this project, not just what the package generally does
- Group dependencies by purpose (e.g., "Web Framework", "Database", "Authentication", "Testing")
- Skip patch-level utility packages (lodash, ramda, chalk, etc.) unless they are architecturally significant
- For each group, use a small table: Package | Version | Purpose
- Highlight any peer dependency requirements or known compatibility constraints
- Do not list more than 20 dependencies total — prioritise the most important ones`,

  'core/testing': `You are a technical documentation writer. Generate a "Testing" section for a software project based on its test configuration and sample test files.

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
- Do not describe test patterns not evidenced in the provided files`,

  'core/deployment': `You are a technical documentation writer. Generate a "Deployment" section for a software project based on its Dockerfile, CI/CD workflow files, and infrastructure manifests.

Output ONLY a markdown section starting with "## Deployment". Do not include any other headers or preamble.

The section should cover:
1. Build — how to compile/build the project for production
2. Docker — how to build and run the Docker image (if Dockerfile present)
3. CI/CD pipeline — what the pipeline does at each stage (if CI config present)
4. Infrastructure — Kubernetes or docker-compose setup (if manifests present)
5. Environment — which environment variables must be set in production (cross-reference Configuration section)

Rules:
- Use actual stage names, job names, and script commands from the CI config
- Reference actual image names, port numbers, and volume mounts from the Dockerfile
- If multiple deployment targets exist (staging vs production), document both
- Do not invent deployment steps not evidenced in the provided files
- Keep the section factual and operational — someone should be able to deploy from this section`,

  'backend/api-reference': `You are a technical documentation writer. Generate an "API Reference" section for a backend service based on its route definitions and handler code.

Output ONLY a markdown section starting with "## API Reference". Do not include any other headers or preamble.

The section should:
1. Open with 1-2 sentences on the base URL and authentication method (if determinable)
2. Group endpoints by resource/domain (e.g., "Users", "Repositories", "Jobs")
3. For each endpoint, document:
   - Method and path (e.g., \`GET /api/repos/:repoId\`)
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
- If there are more than 20 endpoints, document the most important ones and note that the list is non-exhaustive`,

  'backend/database': `You are a technical documentation writer. Generate a "Database" section for a backend service based on its ORM schema definitions and migration files.

Output ONLY a markdown section starting with "## Database". Do not include any other headers or preamble.

The section should cover:
1. Database engine and ORM (e.g., PostgreSQL via Prisma, MySQL via SQLAlchemy)
2. Data model — one sub-section per major entity/table, each describing:
   - Fields with types and constraints (required, unique, default)
   - Relationships to other entities (one-to-many, many-to-many, etc.)
3. Entity relationship summary — a brief prose description of how the main entities relate
4. Migration strategy (if migration files present) — how migrations are run

Rules:
- Document every model/table visible in the schema files
- Use the actual field names and types as defined (do not normalise to SQL — use the ORM's type names)
- Represent relationships clearly: "A User has many Posts", "A Post belongs to one User"
- If an entity has more than 15 fields, group them by purpose (identity, timestamps, content, metadata)
- Do not invent relationships not present in the schema`,

  'backend/auth': `You are a technical documentation writer. Generate an "Authentication & Authorization" section for a backend service based on its auth middleware, token handling, and route protection code.

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
- Do not include credential values, secrets, or example tokens`,

  'frontend/component-hierarchy': `You are a technical documentation writer. Generate a "Component Hierarchy" section for a frontend application based on its component import graph.

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
- Do not describe what each component renders unless it is clear from the name`,

  'frontend/state-management': `You are a technical documentation writer. Generate a "State Management" section for a frontend application based on its store definitions and sample component usage.

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
- For Jotai: describe atoms (primitive and derived) and the providerless usage pattern
- Adapt the structure to the library's actual pattern — do not force Redux terminology onto Zustand
- Do not describe internal implementation details unless they affect how developers use the store`,

  'frontend/routing': `You are a technical documentation writer. Generate a "Routing" section for a frontend application based on its router configuration and page/view files.

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
- Do not invent routes not visible in the provided files`,
};

// ---------------------------------------------------------------------------
// User prompt templates
// ---------------------------------------------------------------------------

function buildOverviewPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['readmeContent']) {
    parts.push(`## README\n${vars['readmeContent']}`);
  }

  if (vars['manifestContent']) {
    const name = vars['manifestFileName'] || 'package.json';
    parts.push(`## Package Manifest (${name})\n\`\`\`\n${vars['manifestContent']}\n\`\`\``);
  }

  if (vars['entryPointFiles']) {
    parts.push(`## Entry Points\n${vars['entryPointFiles']}`);
  }

  parts.push('Generate the Overview section for this repository.');
  return parts.join('\n\n');
}

function buildProjectStructurePrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['filePaths']) {
    parts.push(`## File Tree\n\`\`\`\n${vars['filePaths']}\n\`\`\``);
  }

  if (vars['entryPointPaths']) {
    parts.push(`## Entry Points\n${vars['entryPointPaths']}`);
  }

  parts.push('Generate the Project Structure section for this repository.');
  return parts.join('\n\n');
}

function buildGettingStartedPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['manifestContent']) {
    const name = vars['manifestFileName'] || 'package.json';
    parts.push(`## Package Manifest (${name})\n\`\`\`\n${vars['manifestContent']}\n\`\`\``);
  }

  if (vars['envExampleContent']) {
    parts.push(`## Environment Variables (.env.example)\n\`\`\`\n${vars['envExampleContent']}\n\`\`\``);
  }

  if (vars['dockerfileContent']) {
    parts.push(`## Dockerfile\n\`\`\`dockerfile\n${vars['dockerfileContent']}\n\`\`\``);
  }

  if (vars['makefileContent']) {
    parts.push(`## Makefile\n\`\`\`makefile\n${vars['makefileContent']}\n\`\`\``);
  }

  parts.push('Generate the Getting Started section for this repository.');
  return parts.join('\n\n');
}

function buildConfigurationPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['envExampleContent']) {
    parts.push(`## .env.example\n\`\`\`\n${vars['envExampleContent']}\n\`\`\``);
  }

  if (vars['configFilesContent']) {
    parts.push(`## Config Files\n${vars['configFilesContent']}`);
  }

  parts.push('Generate the Configuration section for this repository.');
  return parts.join('\n\n');
}

function buildDependenciesPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['manifestContent']) {
    const name = vars['manifestFileName'] || 'package.json';
    parts.push(`## Package Manifest (${name})\n\`\`\`\n${vars['manifestContent']}\n\`\`\``);
  }

  parts.push('Generate the Dependencies section for this repository.');
  return parts.join('\n\n');
}

function buildTestingPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['testConfigContent']) {
    const name = vars['configFileName'] || 'jest.config.ts';
    parts.push(`## Test Configuration (${name})\n\`\`\`\n${vars['testConfigContent']}\n\`\`\``);
  }

  if (vars['testScripts']) {
    parts.push(`## package.json (test scripts)\n\`\`\`json\n${vars['testScripts']}\n\`\`\``);
  }

  const lang = vars['language'] || 'typescript';
  for (let i = 1; i <= 3; i++) {
    const path = vars[`testFile${i}Path`];
    const content = vars[`testFile${i}Content`];
    if (path && content) {
      parts.push(`### ${path}\n\`\`\`${lang}\n${content}\n\`\`\``);
    }
  }

  if (parts.length > 0) {
    parts.unshift('## Sample Test Files');
  }

  parts.push('Generate the Testing section for this repository.');
  return parts.join('\n\n');
}

function buildDeploymentPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['dockerfileContent']) {
    parts.push(`## Dockerfile\n\`\`\`dockerfile\n${vars['dockerfileContent']}\n\`\`\``);
  }

  if (vars['ciContent']) {
    const name = vars['ciFileName'] || 'CI/CD pipeline';
    parts.push(`## CI/CD Pipeline (${name})\n\`\`\`yaml\n${vars['ciContent']}\n\`\`\``);
  }

  if (vars['dockerComposeContent']) {
    const name = vars['dockerComposeFileName'] || 'docker-compose.yml';
    parts.push(`## Docker Compose (${name})\n\`\`\`yaml\n${vars['dockerComposeContent']}\n\`\`\``);
  }

  if (vars['k8sContent']) {
    parts.push(`## Kubernetes Manifests\n${vars['k8sContent']}`);
  }

  if (vars['buildScripts']) {
    parts.push(`## Build Scripts (package.json)\n\`\`\`json\n${vars['buildScripts']}\n\`\`\``);
  }

  parts.push('Generate the Deployment section for this repository.');
  return parts.join('\n\n');
}

function buildApiReferencePrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['routesList']) {
    parts.push(`## Routes (from CIG)\n${vars['routesList']}`);
  }

  parts.push('## Route Handler Files');
  const lang = vars['language'] || 'typescript';
  for (let i = 1; i <= 2; i++) {
    const path = vars[`routeFile${i}Path`];
    const content = vars[`routeFile${i}Content`];
    if (path && content) {
      parts.push(`### ${path}\n\`\`\`${lang}\n${content}\n\`\`\``);
    }
  }

  if (vars['framework']) {
    parts.push(`## Framework: ${vars['framework']}`);
  }

  parts.push('Generate the API Reference section for this repository.');
  return parts.join('\n\n');
}

function buildDatabasePrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['orm']) parts.push(`## ORM: ${vars['orm']}`);
  if (vars['database']) parts.push(`## Database: ${vars['database']}`);

  if (vars['schemaContent']) {
    const name = vars['schemaFileName'] || 'schema';
    parts.push(`## Schema Definition (${name})\n\`\`\`\n${vars['schemaContent']}\n\`\`\``);
  }

  if (vars['migrationsContent']) {
    parts.push(`## Recent Migrations\n${vars['migrationsContent']}`);
  }

  parts.push('Generate the Database section for this repository.');
  return parts.join('\n\n');
}

function buildAuthPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];
  const lang = vars['language'] || 'typescript';

  if (vars['authLibrary']) parts.push(`## Auth Library: ${vars['authLibrary']}`);

  if (vars['authMiddlewareContent']) {
    const file = vars['authMiddlewareFile'] || 'auth middleware';
    parts.push(`## Auth Middleware (${file})\n\`\`\`${lang}\n${vars['authMiddlewareContent']}\n\`\`\``);
  }

  if (vars['tokenFileContent']) {
    const file = vars['tokenFile'] || 'token handler';
    parts.push(`## Token Handling (${file})\n\`\`\`${lang}\n${vars['tokenFileContent']}\n\`\`\``);
  }

  if (vars['authRoutesContent']) {
    const file = vars['authRoutesFile'] || 'auth routes';
    parts.push(`## Auth Routes (${file})\n\`\`\`${lang}\n${vars['authRoutesContent']}\n\`\`\``);
  }

  if (vars['protectedRoutes']) {
    parts.push(`## Protected Route Groups (from CIG)\n${vars['protectedRoutes']}`);
  }

  parts.push('Generate the Authentication & Authorization section for this repository.');
  return parts.join('\n\n');
}

function buildComponentHierarchyPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];

  if (vars['framework']) parts.push(`## Framework: ${vars['framework']}`);

  if (vars['componentImportGraph']) {
    parts.push(`## Component Import Graph\n\`\`\`\n${vars['componentImportGraph']}\n\`\`\``);
  }

  if (vars['componentFiles']) {
    parts.push(`## Component File List\n${vars['componentFiles']}`);
  }

  parts.push('Generate the Component Hierarchy section for this repository.');
  return parts.join('\n\n');
}

function buildStateManagementPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];
  const lang = vars['language'] || 'typescript';

  if (vars['stateLibrary']) {
    parts.push(`## State Management Library: ${vars['stateLibrary']}`);
  }

  parts.push('## Store Files');
  for (let i = 1; i <= 3; i++) {
    const path = vars[`storeFile${i}Path`];
    const content = vars[`storeFile${i}Content`];
    if (path && content) {
      parts.push(`### ${path}\n\`\`\`${lang}\n${content}\n\`\`\``);
    }
  }

  if (vars['componentContent']) {
    const file = vars['componentFilePath'] || 'component';
    parts.push(`## Sample Component Using State (${file})\n\`\`\`${lang}\n${vars['componentContent']}\n\`\`\``);
  }

  parts.push('Generate the State Management section for this repository.');
  return parts.join('\n\n');
}

function buildRoutingPrompt(vars: Record<string, string>): string {
  const parts: string[] = [];
  const lang = vars['language'] || 'typescript';

  if (vars['routerLibrary']) {
    parts.push(`## Router Library: ${vars['routerLibrary']}`);
  }

  if (vars['routerContent']) {
    const file = vars['routerFile'] || 'router config';
    parts.push(`## Router Configuration (${file})\n\`\`\`${lang}\n${vars['routerContent']}\n\`\`\``);
  }

  if (vars['guardContent']) {
    const file = vars['guardFile'] || 'route guard';
    parts.push(`## Route Guard (${file})\n\`\`\`${lang}\n${vars['guardContent']}\n\`\`\``);
  }

  if (vars['layoutContent']) {
    const file = vars['layoutFile'] || 'layout';
    parts.push(`## Layout (${file})\n\`\`\`${lang}\n${vars['layoutContent']}\n\`\`\``);
  }

  parts.push('Generate the Routing section for this repository.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const USER_PROMPT_BUILDERS: Record<string, (vars: Record<string, string>) => string> = {
  'core/overview': buildOverviewPrompt,
  'core/project-structure': buildProjectStructurePrompt,
  'core/getting-started': buildGettingStartedPrompt,
  'core/configuration': buildConfigurationPrompt,
  'core/dependencies': buildDependenciesPrompt,
  'core/testing': buildTestingPrompt,
  'core/deployment': buildDeploymentPrompt,
  'backend/api-reference': buildApiReferencePrompt,
  'backend/database': buildDatabasePrompt,
  'backend/auth': buildAuthPrompt,
  'frontend/component-hierarchy': buildComponentHierarchyPrompt,
  'frontend/state-management': buildStateManagementPrompt,
  'frontend/routing': buildRoutingPrompt,
};

export class PromptRegistry {
  /**
   * Get the prompt definition for a module. Returns null for unknown modules.
   */
  getDefinition(moduleId: string): PromptDefinition | null {
    const systemPrompt = SYSTEM_PROMPTS[moduleId];
    const buildUserPrompt = USER_PROMPT_BUILDERS[moduleId];
    if (!systemPrompt || !buildUserPrompt) return null;

    return { moduleId, systemPrompt, buildUserPrompt };
  }

  /** Returns all supported module IDs. */
  getSupportedModules(): string[] {
    return Object.keys(SYSTEM_PROMPTS);
  }
}

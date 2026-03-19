import type { LLMClient, Logger } from '@codeinsight/types';
import type { ClassifierInput, ClassifierResult } from './types';

// ---------------------------------------------------------------------------
// Valid prompt module registry
// ---------------------------------------------------------------------------

/** Core modules always available — included in every classification. */
const CORE_MODULES: string[] = [
  'core/overview',
  'core/project-structure',
  'core/getting-started',
  'core/configuration',
  'core/dependencies',
  'core/testing',
  'core/deployment',
];

/** Full set of valid module IDs the LLM is allowed to select. */
const VALID_MODULES = new Set<string>([
  ...CORE_MODULES,
  'frontend/component-hierarchy',
  'frontend/state-management',
  'frontend/routing',
  'frontend/styling-system',
  'backend/api-reference',
  'backend/database',
  'backend/auth',
  'backend/middleware',
  'backend/error-handling',
  'mobile/navigation',
  'mobile/platform-specifics',
  'ml/data-pipeline',
  'ml/model-architecture',
  'infra/ci-cd-pipeline',
]);

// ---------------------------------------------------------------------------
// LLM prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a code repository analyzer. Your task is to classify a software repository based on its file tree and package manifests, then select the most relevant documentation modules to generate.

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "repo_type": ["frontend" | "backend" | "fullstack" | "library" | "cli" | "mobile" | "ml" | "infra"],
  "language": "typescript" | "javascript" | "python" | "go" | "java" | "rust" | "other",
  "frameworks": ["react", "express", "next", "fastify", "nestjs", "vue", "nuxt", "svelte", "angular", "django", "fastapi", "flask", "gin", "echo", "spring"],
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
5. Do not invent frameworks not visible in the file tree or package manifests`;

// ---------------------------------------------------------------------------
// ClassifierService
// ---------------------------------------------------------------------------

export class ClassifierService {
  private readonly llmClient: LLMClient;
  private readonly logger: Logger | undefined;

  constructor(llmClient: LLMClient, logger?: Logger) {
    this.llmClient = llmClient;
    this.logger = logger;
  }

  /**
   * Classify a repository based on its file tree and package manifests.
   *
   * Makes one LLM call (~1.5K tokens input). Returns a `ClassifierResult`
   * with the detected repo type, frameworks, and the list of prompt modules
   * to run for documentation generation.
   *
   * Falls back to core modules only if the LLM call fails or returns
   * unparseable JSON.
   */
  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const userPrompt = this.buildUserPrompt(input);

    let response: string;
    try {
      response = await this.llmClient.complete(SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn('ClassifierService: LLM call failed, falling back to core modules', {
        error: message,
      });
      return this.fallbackResult();
    }

    return this.parseResponse(response);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildUserPrompt(input: ClassifierInput): string {
    const parts: string[] = [];

    // File tree — cap at 200 paths to stay within token budget (~1K tokens)
    const paths = input.filePaths.slice(0, 200);
    parts.push('## File Tree\n```\n' + paths.join('\n') + '\n```');

    // Package manifests — root first, up to 2 files
    const manifests = input.packageJsonContents.slice(0, 2);
    for (let i = 0; i < manifests.length; i++) {
      const label = i === 0 ? 'package.json (root)' : `package.json (${i + 1})`;
      parts.push(`## ${label}\n\`\`\`json\n${manifests[i]}\n\`\`\``);
    }

    parts.push('\nClassify this repository and select the appropriate documentation modules.');

    return parts.join('\n\n');
  }

  private parseResponse(response: string): ClassifierResult {
    // LLMs sometimes wrap JSON in markdown code blocks — extract raw JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger?.warn(
        'ClassifierService: No JSON object found in LLM response, falling back to core modules',
      );
      return this.fallbackResult();
    }

    let raw: unknown;
    try {
      raw = JSON.parse(jsonMatch[0]);
    } catch {
      this.logger?.warn(
        'ClassifierService: JSON parse failed on LLM response, falling back to core modules',
      );
      return this.fallbackResult();
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      this.logger?.warn('ClassifierService: Unexpected JSON type in LLM response, falling back');
      return this.fallbackResult();
    }

    const obj = raw as Record<string, unknown>;

    const repoType = this.extractStringArray(obj['repo_type']);
    const language = typeof obj['language'] === 'string' ? obj['language'] : 'unknown';
    const frameworks = this.extractStringArray(obj['frameworks']);
    const detectedSignals = this.extractDetectedSignals(obj['detected_signals']);
    const rawModules = this.extractStringArray(obj['prompt_modules']);
    const promptModules = this.sanitizeModules(rawModules);

    return { repoType, language, frameworks, detectedSignals, promptModules };
  }

  private extractStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  }

  private extractDetectedSignals(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== 'null') {
        result[k] = v;
      }
    }
    return result;
  }

  private sanitizeModules(modules: string[]): string[] {
    // Filter to known-valid module IDs only (prevent LLM hallucination)
    const valid = modules.filter(m => VALID_MODULES.has(m));

    // Ensure core/overview and core/project-structure are always present
    const result = new Set<string>(['core/overview', 'core/project-structure', ...valid]);
    return Array.from(result);
  }

  private fallbackResult(): ClassifierResult {
    return {
      repoType: ['unknown'],
      language: 'unknown',
      frameworks: [],
      detectedSignals: {},
      promptModules: [...CORE_MODULES],
    };
  }
}

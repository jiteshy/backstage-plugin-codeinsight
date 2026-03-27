import type { Artifact } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// ClassifierInput — what the caller passes to ClassifierService.classify()
// ---------------------------------------------------------------------------

/**
 * Input for repository classification.
 * Deliberately minimal: only what's needed for a ~1.5K token LLM call.
 */
export interface ClassifierInput {
  /** All file paths in the repository (from file tree, up to 200 used). */
  filePaths: string[];
  /** Raw JSON content of package.json files found in the repo (root first). */
  packageJsonContents: string[];
}

// ---------------------------------------------------------------------------
// ClassifierResult — the output of ClassifierService.classify()
// ---------------------------------------------------------------------------

/**
 * Repository classification result.
 * Drives which documentation prompt modules are run.
 */
export interface ClassifierResult {
  /**
   * Broad repo type(s). One or more of:
   * frontend | backend | fullstack | library | cli | mobile | ml | infra | unknown
   */
  repoType: string[];

  /**
   * Primary programming language detected.
   * typescript | javascript | python | go | java | rust | other | unknown
   */
  language: string;

  /**
   * Frameworks and libraries detected (e.g. react, express, next, fastapi).
   */
  frameworks: string[];

  /**
   * Key signals detected, keyed by category.
   * e.g. { database: 'prisma', test_framework: 'jest', auth: 'jwt' }
   */
  detectedSignals: Record<string, string>;

  /**
   * Ordered list of prompt module IDs to run for this repo.
   * e.g. ['core/overview', 'core/project-structure', 'backend/api-reference']
   * Always contains at minimum: core/overview, core/project-structure.
   */
  promptModules: string[];
}

// ---------------------------------------------------------------------------
// PromptContext — built by ContextBuilder for a single prompt module
// ---------------------------------------------------------------------------

export interface PromptContext {
  /** System prompt for the LLM. */
  systemPrompt: string;
  /** User prompt with all template variables substituted. */
  userPrompt: string;
  /** Files used as inputs for this module (for composite SHA + artifact_inputs). */
  inputFiles: Array<{ filePath: string; sha: string }>;
}

// ---------------------------------------------------------------------------
// DocGenerationResult — returned by DocGenerationService.generateDocs()
// ---------------------------------------------------------------------------

export interface DocGenerationResult {
  /** Total modules processed (not skipped). */
  modulesGenerated: number;
  /** Total modules skipped (not stale, same inputSha). */
  modulesSkipped: number;
  /** Total LLM tokens consumed across all modules. */
  totalTokensUsed: number;
  /** Generated/updated artifacts. */
  artifacts: Artifact[];
  /** Modules that failed during generation. */
  errors: Array<{ moduleId: string; error: string }>;
  /**
   * Detected signals from the classifier, e.g. { orm: 'prisma', framework: 'react' }.
   * Passed downstream to DiagramGenerationService so signal-gated modules fire correctly.
   */
  detectedSignals: Record<string, string>;
}

// ---------------------------------------------------------------------------
// DocGenConfig — configuration for DocGenerationService
// ---------------------------------------------------------------------------

export interface DocGenConfig {
  /** Max concurrent LLM calls for Phase 1 parallel module generation. Default: 20 */
  maxConcurrency?: number;
  /** Max tokens for LLM completion responses. Default: 2000 */
  maxOutputTokens?: number;
  /** Temperature for LLM calls. Default: 0.2 */
  temperature?: number;
  /**
   * LLM model identifier used to compute generationSig.
   * When this changes, existing artifacts are considered stale and regenerated
   * on the next sync regardless of source file changes.
   */
  modelName?: string;
}

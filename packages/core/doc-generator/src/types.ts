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

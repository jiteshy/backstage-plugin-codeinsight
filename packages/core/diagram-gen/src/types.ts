import type { Artifact, CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// CIG snapshot passed into every DiagramModule
// ---------------------------------------------------------------------------

/**
 * Minimal CIG snapshot provided to diagram modules.
 * Loaded once per DiagramGenerationService run, shared across all modules.
 */
export interface CIGSnapshot {
  nodes: CIGNode[];
  edges: CIGEdge[];
  /** LLM-generated file summaries keyed by filePath. Used by LLM modules for richer prompts. */
  fileSummaries?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// MermaidDiagram — the output of every DiagramModule
// ---------------------------------------------------------------------------

export interface MermaidDiagram {
  /** Mermaid diagram type: 'graph', 'erDiagram', 'sequenceDiagram', etc. */
  diagramType: string;
  /** Raw Mermaid DSL string (without surrounding fences). */
  mermaid: string;
  /** Human-readable title shown in the UI. */
  title: string;
  /** Short description shown below the title. */
  description?: string;
  /** True if an LLM was used to produce this diagram. */
  llmUsed: boolean;
  /** Maps Mermaid node IDs to source file paths (for clickable nodes in the UI). */
  nodeMap?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// DiagramModule — the interface every diagram module must implement
// ---------------------------------------------------------------------------

export interface DiagramModule {
  /** Unique stable ID, e.g. 'universal/dependency-graph'. */
  readonly id: string;
  /** CIG fields this module reads: 'nodes', 'edges'. */
  readonly requires: ReadonlyArray<'nodes' | 'edges'>;
  /**
   * Signal conditions that activate this module.
   * Format: 'category:value', e.g. 'orm:prisma', 'framework:react'.
   * An empty array means the module always runs.
   */
  readonly triggersOn: readonly string[];
  /** Whether an LLM is needed. Pure-AST modules set this to false. */
  readonly llmNeeded: boolean;

  /**
   * Generate the Mermaid diagram.
   * Pure-AST modules ignore llmClient.
   * LLM modules receive it and may be skipped if undefined.
   */
  generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null>;
}

// ---------------------------------------------------------------------------
// DiagramGenerationResult
// ---------------------------------------------------------------------------

export interface DiagramGenerationResult {
  diagramsGenerated: number;
  diagramsSkipped: number;
  totalTokensUsed: number;
  artifacts: Artifact[];
  errors: Array<{ moduleId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// DiagramGenConfig
// ---------------------------------------------------------------------------

export interface DiagramGenConfig {
  /** Max concurrent LLM diagram calls. Default: 10 */
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

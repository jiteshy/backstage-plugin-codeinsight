import { createHash } from 'crypto';

import type {
  Artifact,
  ArtifactInput,
  DiagramContent,
  LLMClient,
  Logger,
  StorageAdapter,
} from '@codeinsight/types';

import { createDefaultRegistry } from './DiagramRegistry';
import { SignalDetector } from './SignalDetector';
import type {
  CIGSnapshot,
  DiagramGenConfig,
  DiagramGenerationResult,
  DiagramModule,
} from './types';

// ---------------------------------------------------------------------------
// DiagramGenerator duck-type interface (for IngestionService dependency inversion)
// ---------------------------------------------------------------------------

export interface DiagramGenerator {
  generateDiagrams(
    repoId: string,
    detectedSignals?: Record<string, string>,
  ): Promise<{ totalTokensUsed: number }>;
}

// ---------------------------------------------------------------------------
// DiagramGenerationService
// ---------------------------------------------------------------------------

export class DiagramGenerationService implements DiagramGenerator {
  private readonly config: Required<DiagramGenConfig>;
  private readonly signalDetector = new SignalDetector();

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly logger: Logger,
    private readonly llmClient?: LLMClient,
    config: DiagramGenConfig = {},
    private readonly registry = createDefaultRegistry(),
  ) {
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 10,
      maxOutputTokens: config.maxOutputTokens ?? 2000,
      temperature: config.temperature ?? 0.2,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Generate all applicable diagrams for a repository.
   *
   * @param repoId - Repository ID
   * @param externalSignals - Optional signals from ClassifierService (e.g. { orm: 'prisma' }).
   *   Must use the same 'category:value' key format as DiagramModule.triggersOn.
   *   These are merged with AST-derived signals from SignalDetector so that diagram
   *   modules activate even when no LLM classifier ran.
   */
  async generateDiagrams(
    repoId: string,
    externalSignals: Record<string, string> = {},
  ): Promise<DiagramGenerationResult> {
    const cig = await this.loadCIG(repoId);

    // Merge AST-detected signals with any LLM-provided signals
    const astSignals = this.signalDetector.detect(cig);
    const allSignals = this.mergeSignals(astSignals, externalSignals);

    this.logger.info('Starting diagram generation', {
      repoId,
      astSignals,
      externalSignals,
      totalSignals: allSignals,
    });

    const modules = this.registry.selectModules(allSignals);
    this.logger.info('Selected diagram modules', {
      repoId,
      selected: modules.map(m => m.id),
      skippedCount: this.registry.getAllModules().length - modules.length,
    });

    // Phase 1: Pure AST diagrams (instant, parallel)
    const astModules = modules.filter(m => !m.llmNeeded);
    // Phase 2: LLM-assisted diagrams (parallel with concurrency limit)
    const llmModules = modules.filter(m => m.llmNeeded);

    const result: DiagramGenerationResult = {
      diagramsGenerated: 0,
      diagramsSkipped: 0,
      totalTokensUsed: 0,
      artifacts: [],
      errors: [],
    };

    // Run AST modules in parallel (fast, no external I/O)
    await Promise.all(
      astModules.map(m => this.processModule(m, repoId, cig, result)),
    );

    // Run LLM modules with concurrency limit
    if (llmModules.length > 0 && this.llmClient) {
      await this.runWithConcurrency(
        llmModules,
        m => this.processModule(m, repoId, cig, result),
        this.config.maxConcurrency,
      );
    } else if (llmModules.length > 0) {
      this.logger.info('Skipping LLM diagram modules — no LLM client configured', {
        repoId,
        skipped: llmModules.map(m => m.id),
      });
      result.diagramsSkipped += llmModules.length;
    }

    this.logger.info('Diagram generation complete', {
      repoId,
      diagramsGenerated: result.diagramsGenerated,
      diagramsSkipped: result.diagramsSkipped,
      totalTokensUsed: result.totalTokensUsed,
      errors: result.errors.length,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async processModule(
    module: DiagramModule,
    repoId: string,
    cig: CIGSnapshot,
    result: DiagramGenerationResult,
  ): Promise<void> {
    try {
      const inputSha = this.computeInputSha(cig, module);

      // Check if we already have a fresh (non-stale) artifact with the same inputSha
      const existing = await this.storageAdapter.getArtifact(module.id, repoId);
      if (existing && !existing.isStale && existing.inputSha === inputSha) {
        this.logger.debug('Diagram up-to-date, skipping', {
          repoId,
          moduleId: module.id,
        });
        result.diagramsSkipped++;
        return;
      }

      const diagram = await module.generate(cig, this.llmClient);

      if (!diagram) {
        this.logger.debug('Module returned null (not applicable to this repo)', {
          repoId,
          moduleId: module.id,
        });
        result.diagramsSkipped++;
        return;
      }

      const tokensUsed = diagram.llmUsed
        ? this.estimateTokens(diagram.mermaid)
        : 0;

      const content: DiagramContent = {
        kind: 'diagram',
        diagramType: diagram.diagramType,
        mermaid: diagram.mermaid,
        title: diagram.title,
        description: diagram.description,
        ...(diagram.nodeMap && Object.keys(diagram.nodeMap).length > 0
          ? { nodeMap: diagram.nodeMap }
          : {}),
      };

      const artifact: Artifact = {
        repoId,
        artifactId: module.id,
        artifactType: 'diagram',
        content,
        inputSha,
        isStale: false,
        tokensUsed,
        llmUsed: diagram.llmUsed,
        generatedAt: new Date(),
      };

      await this.storageAdapter.upsertArtifact(artifact);

      // Record CIG nodes as artifact inputs for staleness tracking
      const inputs = this.buildArtifactInputs(repoId, module.id, cig);
      if (inputs.length > 0) {
        await this.storageAdapter.upsertArtifactInputs(inputs);
      }

      result.diagramsGenerated++;
      result.totalTokensUsed += tokensUsed;
      result.artifacts.push(artifact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Diagram module failed', {
        repoId,
        moduleId: module.id,
        error: message,
      });
      result.errors.push({ moduleId: module.id, error: message });
    }
  }

  private async loadCIG(repoId: string): Promise<CIGSnapshot> {
    const [nodes, edges] = await Promise.all([
      this.storageAdapter.getCIGNodes(repoId),
      this.storageAdapter.getCIGEdges(repoId),
    ]);
    return { nodes, edges };
  }

  /**
   * Compute a deterministic SHA over module ID + all CIG node/edge IDs.
   *
   * Including the module ID ensures each module has an independent inputSha —
   * a stale mark on one module does not cascade to others.
   */
  private computeInputSha(cig: CIGSnapshot, module: DiagramModule): string {
    const nodeIds = cig.nodes.map(n => n.nodeId).sort();
    const edgeIds = cig.edges.map(e => e.edgeId).sort();
    const payload = [module.id, ...nodeIds, '---', ...edgeIds].join('\n');
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Merge AST-detected signals with externally-provided signals.
   *
   * AST signals are in 'category:value' format. External signals
   * (from ClassifierService) are in Record<string,string> format and
   * are converted to the same 'category:value' strings.
   */
  private mergeSignals(
    astSignals: string[],
    external: Record<string, string>,
  ): string[] {
    const merged = new Set(astSignals);
    for (const [k, v] of Object.entries(external)) {
      merged.add(`${k}:${v}`);
    }
    return Array.from(merged);
  }

  /**
   * Build ArtifactInput records pointing to the unique file paths in the CIG snapshot.
   * This lets StalenessService cascade stale marks when any source file changes.
   */
  private buildArtifactInputs(
    repoId: string,
    artifactId: string,
    cig: CIGSnapshot,
  ): ArtifactInput[] {
    const seen = new Set<string>();
    const inputs: ArtifactInput[] = [];
    for (const node of cig.nodes) {
      if (seen.has(node.filePath)) continue;
      seen.add(node.filePath);
      inputs.push({
        repoId,
        artifactId,
        filePath: node.filePath,
        fileSha: node.extractedSha,
      });
    }
    return inputs;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private async runWithConcurrency<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    concurrency: number,
  ): Promise<void> {
    let index = 0;

    async function worker(): Promise<void> {
      while (index < items.length) {
        const i = index++;
        await fn(items[i]);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }
}

import { promises as fs } from 'fs';
import * as path from 'path';

import type {
  Artifact,
  ArtifactInput,
  LLMClient,
  Logger,
  RepoFile,
  StorageAdapter,
} from '@codeinsight/types';

import { ClassifierService } from './ClassifierService';
import { ContextBuilder, computeInputSha } from './ContextBuilder';
import { PromptRegistry } from './PromptRegistry';
import type {
  ClassifierInput,
  ClassifierResult,
  DocGenConfig,
  DocGenerationResult,
} from './types';

// ---------------------------------------------------------------------------
// Semaphore — bounds concurrency for parallel LLM calls
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.current--;
    }
  }
}

// ---------------------------------------------------------------------------
// DocGenerationService
// ---------------------------------------------------------------------------

export class DocGenerationService {
  private readonly classifierService: ClassifierService;
  private readonly promptRegistry = new PromptRegistry();
  private readonly maxConcurrency: number;
  private readonly maxOutputTokens: number;
  private readonly temperature: number;
  // "{modelName}:{promptVersion}" — stored on every artifact so model/prompt changes
  // invalidate artifacts on next sync even when source files haven't changed.
  private readonly generationSig: string;

  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly llmClient: LLMClient,
    private readonly logger?: Logger,
    config?: DocGenConfig,
  ) {
    this.classifierService = new ClassifierService(llmClient, logger);
    this.maxConcurrency = config?.maxConcurrency ?? 20;
    this.maxOutputTokens = config?.maxOutputTokens ?? 2000;
    this.temperature = config?.temperature ?? 0.2;
    this.generationSig = `${config?.modelName ?? 'unknown'}:v0`;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Generate documentation for a repository.
   *
   * Pipeline:
   * 1. Load CIG data (nodes, edges, files) from storage
   * 2. Classify the repo to determine which prompt modules to run
   * 3. For each module (Phase 1 — parallel with concurrency limit):
   *    a. Build context from CIG + files
   *    b. Compute composite input SHA
   *    c. Check existing artifact — skip if not stale and same inputSha
   *    d. Call LLM with focused prompt
   *    e. Store artifact + record inputs
   * 4. Return summary
   */
  async generateDocs(
    repoId: string,
    cloneDir: string,
    fileSummaries: Map<string, string> = new Map(),
  ): Promise<DocGenerationResult> {
    this.logger?.info('Starting doc generation', { repoId });

    // 1. Load CIG data from storage
    const [nodes, edges, repoFiles] = await Promise.all([
      this.storageAdapter.getCIGNodes(repoId),
      this.storageAdapter.getCIGEdges(repoId),
      this.storageAdapter.getRepoFiles(repoId),
    ]);

    this.logger?.info('CIG data loaded', {
      repoId,
      nodes: nodes.length,
      edges: edges.length,
      files: repoFiles.length,
    });

    // 2. Classify the repo
    const classifierInput = await this.buildClassifierInput(repoFiles, cloneDir);
    const classifierResult = await this.classifierService.classify(classifierInput);

    this.logger?.info('Classification complete', {
      repoId,
      repoType: classifierResult.repoType,
      modules: classifierResult.promptModules,
    });

    // 3. Build context builder
    const contextBuilder = new ContextBuilder(
      nodes,
      edges,
      repoFiles,
      classifierResult,
      cloneDir,
      fileSummaries,
    );

    // 4. Run Phase 1 — generate all modules in parallel with concurrency limit
    const result = await this.runPhase1(
      repoId,
      classifierResult.promptModules,
      contextBuilder,
    );

    this.logger?.info('Doc generation complete', {
      repoId,
      generated: result.modulesGenerated,
      skipped: result.modulesSkipped,
      errors: result.errors.length,
      totalTokens: result.totalTokensUsed,
    });

    return { ...result, detectedSignals: classifierResult.detectedSignals };
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — parallel module generation
  // ---------------------------------------------------------------------------

  private async runPhase1(
    repoId: string,
    moduleIds: string[],
    contextBuilder: ContextBuilder,
  ): Promise<DocGenerationResult> {
    const semaphore = new Semaphore(this.maxConcurrency);
    const artifacts: Artifact[] = [];
    const errors: Array<{ moduleId: string; error: string }> = [];
    let modulesGenerated = 0;
    let modulesSkipped = 0;
    let totalTokensUsed = 0;

    // Filter to modules we actually support in the registry
    const supportedModules = moduleIds.filter(
      id => this.promptRegistry.getDefinition(id) !== null,
    );

    const tasks = supportedModules.map(moduleId =>
      this.processModule(repoId, moduleId, contextBuilder, semaphore),
    );

    const results = await Promise.allSettled(tasks);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const moduleId = supportedModules[i];

      if (result.status === 'rejected') {
        const errMsg = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        this.logger?.error('Module generation failed', { moduleId, error: errMsg });
        errors.push({ moduleId, error: errMsg });
        continue;
      }

      const moduleResult = result.value;
      if (moduleResult.skipped) {
        modulesSkipped++;
      } else {
        modulesGenerated++;
        totalTokensUsed += moduleResult.tokensUsed;
        if (moduleResult.artifact) {
          artifacts.push(moduleResult.artifact);
        }
      }
    }

    // detectedSignals is populated by the caller (generateDocs / generateDocsWithClassification)
    return { modulesGenerated, modulesSkipped, totalTokensUsed, artifacts, errors, detectedSignals: {} };
  }

  // ---------------------------------------------------------------------------
  // Single module processing
  // ---------------------------------------------------------------------------

  private async processModule(
    repoId: string,
    moduleId: string,
    contextBuilder: ContextBuilder,
    semaphore: Semaphore,
  ): Promise<{ skipped: boolean; tokensUsed: number; artifact?: Artifact }> {
    await semaphore.acquire();
    try {
      return await this.processModuleInner(repoId, moduleId, contextBuilder);
    } finally {
      semaphore.release();
    }
  }

  private async processModuleInner(
    repoId: string,
    moduleId: string,
    contextBuilder: ContextBuilder,
  ): Promise<{ skipped: boolean; tokensUsed: number; artifact?: Artifact }> {
    // Build context for this module
    const context = await contextBuilder.buildContext(moduleId);
    if (!context) {
      this.logger?.warn('No context could be built for module', { moduleId });
      return { skipped: true, tokensUsed: 0 };
    }

    // Compute composite input SHA
    const inputSha = computeInputSha(context.inputFiles);

    // Check existing artifact — skip if not stale, same inputSha, and same generationSig.
    // A null existing sig means "legacy artifact" — treated as a sig match to avoid
    // forcing a full regeneration on first deploy after migration 017.
    const existing = await this.storageAdapter.getArtifact(moduleId, repoId);
    const sigMatch = !existing?.generationSig || existing.generationSig === this.generationSig;
    if (existing && !existing.isStale && existing.inputSha === inputSha && sigMatch) {
      this.logger?.info('Module artifact is fresh, skipping', { moduleId, inputSha });
      return { skipped: true, tokensUsed: 0 };
    }

    // Call LLM (cache is handled transparently by CachingLLMClient)
    this.logger?.info('Generating doc module', { moduleId, generationSig: this.generationSig });
    const markdown = await this.llmClient.complete(
      context.systemPrompt,
      context.userPrompt,
      {
        maxTokens: this.maxOutputTokens,
        temperature: this.temperature,
      },
    );

    // Rough token estimate: ~4 chars per token for English text
    const estimatedTokens = Math.ceil(
      (context.systemPrompt.length + context.userPrompt.length + markdown.length) / 4,
    );

    // Build artifact
    const artifact: Artifact = {
      repoId,
      artifactId: moduleId,
      artifactType: 'doc',
      content: {
        kind: 'doc',
        module: moduleId,
        markdown,
      },
      inputSha,
      promptVersion: null,
      generationSig: this.generationSig,
      isStale: false,
      staleReason: null,
      tokensUsed: estimatedTokens,
      llmUsed: true,
      generatedAt: new Date(),
    };

    // Persist artifact
    await this.storageAdapter.upsertArtifact(artifact);

    // Record artifact inputs
    if (context.inputFiles.length > 0) {
      const inputs: ArtifactInput[] = context.inputFiles.map(f => ({
        repoId,
        artifactId: moduleId,
        filePath: f.filePath,
        fileSha: f.sha,
      }));
      await this.storageAdapter.upsertArtifactInputs(inputs);
    }

    return { skipped: false, tokensUsed: estimatedTokens, artifact };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async buildClassifierInput(
    repoFiles: RepoFile[],
    cloneDir: string,
  ): Promise<ClassifierInput> {
    const packageJsonFiles = repoFiles.filter(
      f => path.basename(f.filePath) === 'package.json',
    );
    const contents = await Promise.all(
      packageJsonFiles.map(f =>
        fs.readFile(path.join(cloneDir, f.filePath), 'utf-8').catch(() => null),
      ),
    );
    return {
      filePaths: repoFiles.map(f => f.filePath),
      packageJsonContents: contents.filter((c): c is string => c !== null),
    };
  }

  /**
   * Generate docs with pre-loaded package.json contents for classification.
   * This is the recommended entry point when file content is available.
   */
  async generateDocsWithClassification(
    repoId: string,
    cloneDir: string,
    classifierResult: ClassifierResult,
    fileSummaries: Map<string, string> = new Map(),
  ): Promise<DocGenerationResult> {
    this.logger?.info('Starting doc generation with pre-classified result', { repoId });

    const [nodes, edges, repoFiles] = await Promise.all([
      this.storageAdapter.getCIGNodes(repoId),
      this.storageAdapter.getCIGEdges(repoId),
      this.storageAdapter.getRepoFiles(repoId),
    ]);

    const contextBuilder = new ContextBuilder(
      nodes,
      edges,
      repoFiles,
      classifierResult,
      cloneDir,
      fileSummaries,
    );

    return this.runPhase1(repoId, classifierResult.promptModules, contextBuilder);
  }
}

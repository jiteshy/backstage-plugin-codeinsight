import { ApiFlowModule } from './diagrams/backend/ApiFlowModule';
import { ComponentHierarchyModule } from './diagrams/frontend/ComponentHierarchyModule';
import { CiCdPipelineModule } from './diagrams/universal/CiCdPipelineModule';
import { CircularDependencyModule } from './diagrams/universal/CircularDependencyModule';
import { DependencyGraphModule } from './diagrams/universal/DependencyGraphModule';
import { ErDiagramModule } from './diagrams/universal/ErDiagramModule';
import { PackageBoundaryModule } from './diagrams/universal/PackageBoundaryModule';
import type { DiagramModule } from './types';

/**
 * DiagramRegistry — holds all registered DiagramModule implementations and
 * selects the applicable ones based on detected signals.
 *
 * Signal format: 'category:value', e.g. 'orm:prisma', 'framework:react'.
 * A module with an empty `triggersOn` array always runs.
 */
export class DiagramRegistry {
  private readonly modules: Map<string, DiagramModule> = new Map();

  register(module: DiagramModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`DiagramModule '${module.id}' is already registered`);
    }
    this.modules.set(module.id, module);
  }

  /**
   * Return modules applicable for the given set of detected signals.
   * Modules are returned in registration order.
   *
   * @param signals - Array of 'category:value' strings, e.g. ['framework:react', 'orm:prisma'].
   *   Produced by SignalDetector (AST-based) and/or ClassifierService (LLM-based).
   */
  selectModules(signals: string[]): DiagramModule[] {
    const signalSet = new Set(signals);

    const selected: DiagramModule[] = [];
    for (const module of this.modules.values()) {
      if (module.triggersOn.length === 0) {
        // Always-on module
        selected.push(module);
      } else if (module.triggersOn.some(trigger => signalSet.has(trigger))) {
        selected.push(module);
      }
    }
    return selected;
  }

  getModule(id: string): DiagramModule | undefined {
    return this.modules.get(id);
  }

  getAllModules(): DiagramModule[] {
    return Array.from(this.modules.values());
  }
}

// ---------------------------------------------------------------------------
// createDefaultRegistry — registers all built-in diagram modules
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): DiagramRegistry {
  const registry = new DiagramRegistry();

  // ── Always-on, pure AST ──────────────────────────────────────────────────
  // These run for every repo. Each module self-terminates (returns null) if
  // it has nothing meaningful to show (e.g. no cycles, single package, etc.)
  registry.register(new DependencyGraphModule());
  registry.register(new ComponentHierarchyModule());
  registry.register(new CircularDependencyModule());
  registry.register(new PackageBoundaryModule());

  // ── Signal-gated, pure AST ───────────────────────────────────────────────
  // Run when the relevant technology is detected — no LLM required.
  registry.register(new ErDiagramModule()); // triggers on orm:prisma

  // ── Signal-gated, LLM-assisted ───────────────────────────────────────────
  // Only run when (a) the relevant signal is present AND (b) an LLM is configured.
  registry.register(new ApiFlowModule());    // triggers on framework:express/fastify/koa/nestjs
  registry.register(new CiCdPipelineModule()); // triggers on ci:github-actions/gitlab-ci/etc.

  return registry;
}

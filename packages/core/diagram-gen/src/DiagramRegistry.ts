import { ApiFlowModule } from './diagrams/backend/ApiFlowModule';
import { RequestLifecycleModule } from './diagrams/backend/RequestLifecycleModule';
import { ComponentHierarchyModule } from './diagrams/frontend/ComponentHierarchyModule';
import { StateFlowModule } from './diagrams/frontend/StateFlowModule';
import { CiCdPipelineModule } from './diagrams/universal/CiCdPipelineModule';
import { DependencyGraphModule } from './diagrams/universal/DependencyGraphModule';
import { ErDiagramModule } from './diagrams/universal/ErDiagramModule';
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
   * @param detectedSignals - e.g. { orm: 'prisma', framework: 'react' }
   */
  selectModules(detectedSignals: Record<string, string>): DiagramModule[] {
    const signalSet = new Set<string>();
    for (const [category, value] of Object.entries(detectedSignals)) {
      signalSet.add(`${category}:${value}`);
    }

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
  // Pure AST (always-on)
  registry.register(new DependencyGraphModule());
  registry.register(new ComponentHierarchyModule());
  // Pure AST (signal-gated)
  registry.register(new ErDiagramModule());
  // LLM-assisted
  registry.register(new ApiFlowModule());
  registry.register(new RequestLifecycleModule());
  registry.register(new CiCdPipelineModule());
  registry.register(new StateFlowModule());
  return registry;
}

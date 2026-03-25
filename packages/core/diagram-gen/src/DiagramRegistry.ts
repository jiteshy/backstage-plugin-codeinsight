import { ApiEntityMappingModule } from './diagrams/backend/ApiEntityMappingModule';
import { StateManagementModule } from './diagrams/frontend/StateManagementModule';
import { AuthFlowModule } from './diagrams/universal/AuthFlowModule';
import { CircularDependencyModule } from './diagrams/universal/CircularDependencyModule';
import { DeploymentInfraModule } from './diagrams/universal/DeploymentInfraModule';
import { ErDiagramModule } from './diagrams/universal/ErDiagramModule';
import { HighLevelArchitectureModule } from './diagrams/universal/HighLevelArchitectureModule';
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

  // ── Always-on, LLM-assisted ──────────────────────────────────────────────
  registry.register(new HighLevelArchitectureModule()); // first — shown first in UI

  // ── Always-on, pure AST ──────────────────────────────────────────────────
  registry.register(new CircularDependencyModule()); // null if no cycles — diagnostic only

  // ── Signal-gated, pure AST ───────────────────────────────────────────────
  registry.register(new ErDiagramModule()); // triggers on orm:prisma

  // ── Signal-gated, hybrid/LLM ─────────────────────────────────────────────
  registry.register(new ApiEntityMappingModule()); // framework:express/fastify/koa/nestjs/hapi
  registry.register(new StateManagementModule()); // state-management:* — hybrid
  registry.register(new DeploymentInfraModule()); // ci:github-actions/gitlab-ci/etc. — LLM
  registry.register(new AuthFlowModule()); // auth:jwt/oauth/session/middleware — LLM

  return registry;
}

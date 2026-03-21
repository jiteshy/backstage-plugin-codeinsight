export { DiagramGenerationService } from './DiagramGenerationService';
export type { DiagramGenerator } from './DiagramGenerationService';
export { DiagramRegistry, createDefaultRegistry } from './DiagramRegistry';
export { SignalDetector } from './SignalDetector';
export type {
  CIGSnapshot,
  DiagramGenConfig,
  DiagramGenerationResult,
  DiagramModule,
  MermaidDiagram,
} from './types';
export { extractMermaid } from './utils';

// Diagram modules (re-exported for testing/extension)
// ── Always-on, pure AST ──────────────────────────────────────────────────
export { DependencyGraphModule } from './diagrams/universal/DependencyGraphModule';
export { ModuleBoundariesModule } from './diagrams/universal/ModuleBoundariesModule';
export { CircularDependencyModule } from './diagrams/universal/CircularDependencyModule';
export { PackageBoundaryModule } from './diagrams/universal/PackageBoundaryModule';
// ── Always-on, LLM-assisted ──────────────────────────────────────────────
export { HighLevelArchitectureModule } from './diagrams/universal/HighLevelArchitectureModule';
// ── Signal-gated, pure AST ───────────────────────────────────────────────
export { ErDiagramModule } from './diagrams/universal/ErDiagramModule';
// ── Signal-gated, hybrid/LLM ─────────────────────────────────────────────
export { StateManagementModule } from './diagrams/frontend/StateManagementModule';
export { ApiEntityMappingModule } from './diagrams/backend/ApiEntityMappingModule';
export { DeploymentInfraModule } from './diagrams/universal/DeploymentInfraModule';
// ── Kept for backward compat / potential future use, not in default registry ─
export { ComponentHierarchyModule } from './diagrams/frontend/ComponentHierarchyModule';
export { ApiFlowModule } from './diagrams/backend/ApiFlowModule';
export { CiCdPipelineModule } from './diagrams/universal/CiCdPipelineModule';
export { StateFlowModule } from './diagrams/frontend/StateFlowModule';
export { RequestLifecycleModule } from './diagrams/backend/RequestLifecycleModule';

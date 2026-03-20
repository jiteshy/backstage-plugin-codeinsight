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
export { DependencyGraphModule } from './diagrams/universal/DependencyGraphModule';
export { ErDiagramModule } from './diagrams/universal/ErDiagramModule';
export { CiCdPipelineModule } from './diagrams/universal/CiCdPipelineModule';
export { CircularDependencyModule } from './diagrams/universal/CircularDependencyModule';
export { PackageBoundaryModule } from './diagrams/universal/PackageBoundaryModule';
export { ComponentHierarchyModule } from './diagrams/frontend/ComponentHierarchyModule';
export { ApiFlowModule } from './diagrams/backend/ApiFlowModule';
// Kept for potential future use but not registered by default:
export { StateFlowModule } from './diagrams/frontend/StateFlowModule';
export { RequestLifecycleModule } from './diagrams/backend/RequestLifecycleModule';

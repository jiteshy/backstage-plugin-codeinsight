export { DiagramGenerationService } from './DiagramGenerationService';
export type { DiagramGenerator } from './DiagramGenerationService';
export { DiagramRegistry, createDefaultRegistry } from './DiagramRegistry';
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
export { ComponentHierarchyModule } from './diagrams/frontend/ComponentHierarchyModule';
export { StateFlowModule } from './diagrams/frontend/StateFlowModule';
export { ApiFlowModule } from './diagrams/backend/ApiFlowModule';
export { RequestLifecycleModule } from './diagrams/backend/RequestLifecycleModule';

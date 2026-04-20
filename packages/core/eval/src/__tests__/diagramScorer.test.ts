import type { Artifact } from '@codeinsight/types';

import { scoreDiagrams } from '../scorers/diagramScorer';
import type { ExpectedDiagrams } from '../types';

function diagramArtifact(diagramType: string, mermaid: string, title = diagramType): Artifact {
  return {
    repoId: 'r',
    artifactId: `diagram:${diagramType}`,
    artifactType: 'diagram',
    content: { kind: 'diagram', diagramType, mermaid, title, description: '' },
    inputSha: 'x',
    promptVersion: null,
    generationSig: 'v1',
    isStale: false,
    staleReason: null,
    tokensUsed: 0,
    llmUsed: true,
    generatedAt: new Date(),
  };
}

describe('scoreDiagrams', () => {
  it('scores system architecture by label + edge presence', () => {
    const mermaid = `flowchart TD
      API[API Layer] --> DB[(Postgres)]
      API --> Q[Queue]`;
    const artifacts = [diagramArtifact('system-architecture', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: {
        mustContainLabels: ['API Layer', 'Postgres'],
        mustContainEdges: [{ from: 'API', to: 'DB' }],
      },
      dataModel: null,
      keyFlows: [],
    };

    const result = scoreDiagrams(artifacts, expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.total).toBe(3);
    expect(sysArch.passed).toBe(3);
    expect(sysArch.missing).toEqual([]);
  });

  it('reports missing labels + edges', () => {
    const mermaid = `flowchart TD\n  A[Alpha] --> B[Beta]`;
    const artifacts = [diagramArtifact('system-architecture', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: {
        mustContainLabels: ['Alpha', 'Gamma'],
        mustContainEdges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
      },
      dataModel: null,
      keyFlows: [],
    };
    const result = scoreDiagrams(artifacts, expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.passed).toBe(2);
    expect(sysArch.total).toBe(4);
    expect(sysArch.missing).toEqual(['label:Gamma', 'edge:A->C']);
  });

  it('scores data model by entity presence', () => {
    const mermaid = `erDiagram
      USER { int id string name }
      ORDER { int id }
      USER ||--o{ ORDER : places`;
    const artifacts = [diagramArtifact('data-model', mermaid)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: { mustContainEntities: ['USER', 'ORDER', 'PRODUCT'] },
      keyFlows: [],
    };
    const result = scoreDiagrams(artifacts, expected);
    const dm = result.find(r => r.type === 'dataModel')!;
    expect(dm.passed).toBe(2);
    expect(dm.total).toBe(3);
    expect(dm.missing).toEqual(['entity:PRODUCT']);
  });

  it('scores key flows by step substring presence across all keyflow diagrams', () => {
    const authFlow = `flowchart LR
      U[User] --> L[Login] --> V[Verify JWT] --> S[Session]`;
    const artifacts = [diagramArtifact('key-flow-auth', authFlow)];
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [
        { name: 'auth', mustContainSteps: ['Login', 'Verify JWT', 'Forgot Password'] },
      ],
    };
    const result = scoreDiagrams(artifacts, expected);
    const kf = result.find(r => r.type === 'keyFlows')!;
    expect(kf.passed).toBe(2);
    expect(kf.total).toBe(3);
    expect(kf.missing).toEqual(['flow:auth:step:Forgot Password']);
  });

  it('returns zero-passed check when the diagram artifact is missing entirely', () => {
    const expected: ExpectedDiagrams = {
      systemArchitecture: { mustContainLabels: ['API'], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    };
    const result = scoreDiagrams([], expected);
    const sysArch = result.find(r => r.type === 'systemArchitecture')!;
    expect(sysArch.passed).toBe(0);
    expect(sysArch.total).toBe(1);
    expect(sysArch.missing).toEqual(['label:API']);
  });
});

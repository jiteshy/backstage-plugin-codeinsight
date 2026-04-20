import type { Artifact } from '@codeinsight/types';

import type { DiagramCheck, ExpectedDiagrams } from '../types';

export function scoreDiagrams(
  artifacts: Artifact[],
  expected: ExpectedDiagrams,
): DiagramCheck[] {
  const diagramsByType = indexDiagrams(artifacts);

  return [
    scoreSystemArch(diagramsByType, expected),
    scoreDataModel(diagramsByType, expected),
    scoreKeyFlows(diagramsByType, expected),
  ];
}

function indexDiagrams(artifacts: Artifact[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of artifacts) {
    if (a.content && a.content.kind === 'diagram') {
      out.set(a.content.diagramType, a.content.mermaid);
    }
  }
  return out;
}

function scoreSystemArch(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  const mermaid = diagrams.get('system-architecture') ?? '';
  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const label of expected.systemArchitecture.mustContainLabels) {
    total++;
    if (containsSubstring(mermaid, label)) passed++;
    else missing.push(`label:${label}`);
  }

  for (const edge of expected.systemArchitecture.mustContainEdges) {
    total++;
    if (containsEdge(mermaid, edge.from, edge.to)) passed++;
    else missing.push(`edge:${edge.from}->${edge.to}`);
  }

  return { type: 'systemArchitecture', passed, total, missing };
}

function scoreDataModel(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  if (!expected.dataModel) {
    return { type: 'dataModel', passed: 0, total: 0, missing: [] };
  }
  const mermaid = diagrams.get('data-model') ?? '';
  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const entity of expected.dataModel.mustContainEntities) {
    total++;
    if (containsSubstring(mermaid, entity)) passed++;
    else missing.push(`entity:${entity}`);
  }
  return { type: 'dataModel', passed, total, missing };
}

function scoreKeyFlows(
  diagrams: Map<string, string>,
  expected: ExpectedDiagrams,
): DiagramCheck {
  let allFlows = '';
  for (const [type, mermaid] of diagrams) {
    if (type.startsWith('key-flow')) allFlows += '\n' + mermaid;
  }

  const missing: string[] = [];
  let passed = 0;
  let total = 0;

  for (const flow of expected.keyFlows) {
    for (const step of flow.mustContainSteps) {
      total++;
      if (containsSubstring(allFlows, step)) passed++;
      else missing.push(`flow:${flow.name}:step:${step}`);
    }
  }

  return { type: 'keyFlows', passed, total, missing };
}

function containsSubstring(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

function containsEdge(mermaid: string, from: string, to: string): boolean {
  const lower = mermaid.toLowerCase();
  const f = escapeRegex(from.toLowerCase());
  const t = escapeRegex(to.toLowerCase());
  const re = new RegExp(`\\b${f}\\b[^\\n]*--[\\-\\|>a-z0-9\\s\\|]*>[^\\n]*\\b${t}\\b`);
  return re.test(lower);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import type { Artifact, LLMClient } from '@codeinsight/types';

import type { DocScore, ExpectedArchitecture, ExpectedOverview } from '../types';

import { judgeFactPresence } from './llmJudge';

export async function scoreDocs(
  artifacts: Artifact[],
  expectedOverview: ExpectedOverview,
  expectedArchitecture: ExpectedArchitecture,
  judgeLlm: LLMClient,
): Promise<DocScore[]> {
  const byModule = new Map<string, Artifact>();
  for (const a of artifacts) {
    if (a.content && a.content.kind === 'doc') {
      byModule.set(a.content.module, a);
    }
  }

  const overviewScore = await scoreOverview(byModule.get('overview'), expectedOverview, judgeLlm);
  const archScore = await scoreArchitecture(byModule.get('architecture'), expectedArchitecture, judgeLlm);

  return [overviewScore, archScore];
}

async function scoreOverview(
  artifact: Artifact | undefined,
  expected: ExpectedOverview,
  judgeLlm: LLMClient,
): Promise<DocScore> {
  if (!artifact || !artifact.content || artifact.content.kind !== 'doc') {
    return { module: 'overview', overall: 0, factScores: [] };
  }
  if (expected.bullets.length === 0) {
    return { module: 'overview', overall: 0, factScores: [] };
  }

  const scores = await judgeFactPresence(judgeLlm, artifact.content.markdown, expected.bullets);
  const overall = scores.reduce((s, f) => s + f.score, 0) / scores.length;
  return { module: 'overview', overall, factScores: scores };
}

async function scoreArchitecture(
  artifact: Artifact | undefined,
  expected: ExpectedArchitecture,
  judgeLlm: LLMClient,
): Promise<DocScore> {
  if (!artifact || !artifact.content || artifact.content.kind !== 'doc') {
    return { module: 'architecture', overall: 0, factScores: [] };
  }

  const facts = [
    ...expected.subsystems.map(s => `mentions subsystem ${s.name}`),
    ...expected.externalDependencies.map(d => `mentions external dependency ${d}`),
  ];

  if (facts.length === 0) {
    return { module: 'architecture', overall: 0, factScores: [] };
  }

  const scores = await judgeFactPresence(judgeLlm, artifact.content.markdown, facts);
  const overall = scores.reduce((s, f) => s + f.score, 0) / scores.length;
  return { module: 'architecture', overall, factScores: scores };
}

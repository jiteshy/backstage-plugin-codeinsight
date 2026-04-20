import type { Artifact, LLMClient } from '@codeinsight/types';

import type { DocScore, ExpectedArchitecture, ExpectedOverview, FactScore } from '../types';

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

  const markdown = artifact.content.markdown;

  const facts = [
    ...expected.subsystems.map(s => `mentions subsystem ${s.name}`),
    ...expected.externalDependencies.map(d => `mentions external dependency ${d}`),
  ];

  // File-presence checks are scored deterministically by substring match — the filename
  // is an exact token and using the LLM judge here would be expensive and less reliable.
  const fileFacts: FactScore[] = expected.subsystems.flatMap(s =>
    s.mustMentionFiles.map<FactScore>(f => {
      const found = markdown.includes(f);
      return {
        fact: `mentions file ${f}`,
        score: found ? 1 : 0,
        reason: found ? 'found in markdown' : 'not mentioned',
      };
    }),
  );

  if (facts.length === 0 && fileFacts.length === 0) {
    return { module: 'architecture', overall: 0, factScores: [] };
  }

  const judgedScores = facts.length === 0 ? [] : await judgeFactPresence(judgeLlm, markdown, facts);
  const allScores = [...judgedScores, ...fileFacts];
  const overall = allScores.reduce((s, f) => s + f.score, 0) / allScores.length;
  return { module: 'architecture', overall, factScores: allScores };
}

import type { LLMClient } from '@codeinsight/types';

import type { PipelineAdapter, QaPair, QaScore, QaScoreDetail } from '../types';

import { judgeFactPresence } from './llmJudge';

const RECALL_AT = 10;

export async function scoreQna(
  repoSlug: string,
  pairs: QaPair[],
  adapter: PipelineAdapter,
  judgeLlm: LLMClient,
): Promise<QaScore> {
  const details: QaScoreDetail[] = [];

  for (const pair of pairs) {
    const { answer, retrievedChunks } = await adapter.askQna(repoSlug, pair.question);

    const retrievedFilePaths = Array.from(new Set(
      retrievedChunks
        .slice(0, RECALL_AT)
        .map(c => typeof c.metadata?.['filePath'] === 'string' ? (c.metadata['filePath'] as string) : ''),
    )).filter(s => s.length > 0);

    const recallAt10 = pair.expectedFiles.length === 0
      ? 1
      : pair.expectedFiles.filter(f => retrievedFilePaths.includes(f)).length / pair.expectedFiles.length;

    const completeness = pair.mustIncludeFacts.length === 0
      ? 1
      : (await judgeFactPresence(judgeLlm, answer, pair.mustIncludeFacts))
        .reduce((s, f) => s + f.score, 0) / pair.mustIncludeFacts.length;

    const hallucinationCount = pair.shouldNotHallucinate.reduce(
      (n, phrase) => answer.toLowerCase().includes(phrase.toLowerCase()) ? n + 1 : n,
      0,
    );

    details.push({
      question: pair.question,
      recallAt10,
      completeness,
      hallucinationCount,
      retrievedFilePaths,
      answer,
    });
  }

  const perQ = details.map(d => {
    const base = (d.recallAt10 + d.completeness) / 2;
    const penalty = d.hallucinationCount > 0 ? 0.2 : 0;
    return Math.max(0, base - penalty);
  });
  const overall = perQ.length === 0 ? 0 : perQ.reduce((a, b) => a + b, 0) / perQ.length;

  return { overall, details };
}

import { compareReports } from '../cli';
import type { EvalReport } from '../types';

function reportWith(overviewScore: number, qnaScore: number, cost: number): EvalReport {
  return {
    generatedAt: '2026-04-19T00:00:00Z',
    pipelineVersion: 'v1',
    repos: [
      {
        fixtureSlug: 's',
        commitSha: 'c',
        pipelineVersion: 'v1',
        doc: [
          { module: 'overview', overall: overviewScore, factScores: [] },
          { module: 'architecture', overall: 0, factScores: [] },
        ],
        diagram: [
          { type: 'systemArchitecture', passed: 0, total: 0, missing: [] },
          { type: 'dataModel', passed: 0, total: 0, missing: [] },
          { type: 'keyFlows', passed: 0, total: 0, missing: [] },
        ],
        qna: { overall: qnaScore, details: [] },
        cost: {
          chatRequests: 0,
          chatInputTokens: 0,
          chatOutputTokens: 0,
          chatUsd: cost,
          embeddingRequests: 0,
          embeddingInputTokens: 0,
          embeddingUsd: 0,
          totalUsd: cost,
        },
        wallClockSeconds: 0,
        timestamp: '2026-04-19T00:00:00Z',
      },
    ],
  };
}

describe('compareReports', () => {
  it('reports deltas per repo per surface and per cost', () => {
    const baseline = reportWith(0.5, 0.4, 10.0);
    const current = reportWith(0.8, 0.6, 2.0);
    const out = compareReports(baseline, current);
    expect(out).toContain('overview');
    expect(out).toContain('0.50 → 0.80');
    expect(out).toContain('qna');
    expect(out).toContain('$10.00 → $2.00');
  });
});

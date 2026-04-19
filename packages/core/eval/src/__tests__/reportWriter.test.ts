import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeReport } from '../reportWriter';
import type { EvalReport } from '../types';

function report(): EvalReport {
  return {
    generatedAt: '2026-04-19T12:00:00Z',
    pipelineVersion: 'v1',
    repos: [{
      fixtureSlug: 'small',
      commitSha: 'abc',
      pipelineVersion: 'v1',
      doc: [
        { module: 'overview', overall: 0.75, factScores: [
          { fact: 'f1', score: 1, reason: '' },
          { fact: 'f2', score: 0.5, reason: '' },
        ]},
        { module: 'architecture', overall: 1.0, factScores: [] },
      ],
      diagram: [
        { type: 'systemArchitecture', passed: 3, total: 4, missing: ['label:X'] },
        { type: 'dataModel', passed: 0, total: 0, missing: [] },
        { type: 'keyFlows', passed: 1, total: 2, missing: ['flow:auth:step:logout'] },
      ],
      qna: { overall: 0.6, details: [] },
      cost: {
        chatRequests: 20, chatInputTokens: 10000, chatOutputTokens: 3000, chatUsd: 0.15,
        embeddingRequests: 2, embeddingInputTokens: 5000, embeddingUsd: 0.01,
        totalUsd: 0.16,
      },
      wallClockSeconds: 42.5,
      timestamp: '2026-04-19T12:00:00Z',
    }],
  };
}

describe('writeReport', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eval-report-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes report.json and report.md', async () => {
    const out = await writeReport(report(), tmp);
    const json = JSON.parse(await readFile(out.jsonPath, 'utf-8'));
    expect(json.repos[0].fixtureSlug).toBe('small');

    const md = await readFile(out.markdownPath, 'utf-8');
    expect(md).toContain('# CodeInsight Eval Report');
    expect(md).toContain('small');
    expect(md).toContain('$0.16');
    expect(md).toContain('label:X');
  });
});

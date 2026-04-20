import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { LLMClient } from '@codeinsight/types';
import { simpleGit } from 'simple-git';

import { CostTracker } from './costTracker';
import { scoreDiagrams } from './scorers/diagramScorer';
import { scoreDocs } from './scorers/docScorer';
import { scoreQna } from './scorers/qnaScorer';
import type { CostSummary, PipelineAdapter, RepoFixture, RepoReport } from './types';

export interface RunEvalOptions {
  fixture: RepoFixture;
  adapter: PipelineAdapter;
  /** LLM used by scorers for judging — NOT the pipeline's generator LLM. */
  judgeLlm: LLMClient;
  /** Override for testability. Default: clone via simple-git into a temp dir. */
  cloneFn?: (gitUrl: string, commitSha: string) => Promise<string>;
  /** Override for testability. */
  now?: () => Date;
}

export async function runEval(opts: RunEvalOptions): Promise<RepoReport> {
  const { fixture, adapter, judgeLlm } = opts;
  const clone = opts.cloneFn ?? defaultClone;
  const now = opts.now ?? (() => new Date());

  const start = Date.now();
  const cloneDir = await clone(fixture.meta.gitUrl, fixture.meta.commitSha);

  try {
    await adapter.ingest(fixture.meta, cloneDir);

    const [docArtifacts, diagramArtifacts] = await Promise.all([
      adapter.getDocArtifacts(fixture.meta.slug),
      adapter.getDiagramArtifacts(fixture.meta.slug),
    ]);

    const doc = await scoreDocs(
      docArtifacts,
      fixture.expectedOverview,
      fixture.expectedArchitecture,
      judgeLlm,
    );
    const diagram = scoreDiagrams(diagramArtifacts, fixture.expectedDiagrams);
    const qna = await scoreQna(fixture.meta.slug, fixture.qaPairs, adapter, judgeLlm);

    const wallClockSeconds = (Date.now() - start) / 1000;

    const cost = readAdapterCost(adapter);

    return {
      fixtureSlug: fixture.meta.slug,
      commitSha: fixture.meta.commitSha,
      pipelineVersion: adapter.version,
      doc,
      diagram,
      qna,
      cost,
      wallClockSeconds,
      timestamp: now().toISOString(),
    };
  } finally {
    try {
      if (opts.cloneFn === undefined) {
        await rm(cloneDir, { recursive: true, force: true });
      }
    } catch {
      /* noop */
    }
  }
}

function readAdapterCost(adapter: PipelineAdapter): CostSummary {
  const maybe = (adapter as unknown as { cost?: () => CostSummary }).cost;
  return typeof maybe === 'function' ? maybe.call(adapter) : new CostTracker().summary();
}

async function defaultClone(gitUrl: string, commitSha: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-clone-'));
  const git = simpleGit({ baseDir: dir });
  await git.clone(gitUrl, '.');
  await git.checkout(commitSha);
  return dir;
}

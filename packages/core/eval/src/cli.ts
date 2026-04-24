import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';

import { createIngestionStack } from '@codeinsight/composition';
import { createLLMClient } from '@codeinsight/llm';
import type { LLMClient } from '@codeinsight/types';
import { Command } from 'commander';
import knexPkg from 'knex';
import type { Knex } from 'knex';

import { withEmbeddingCostTracking, withLlmCostTracking } from './adapters/costWrappers';
import { loadEvalConfig } from './adapters/loadConfig';
import { V1Adapter } from './adapters/v1Adapter';
import { CostTracker } from './costTracker';
import { loadFixture } from './fixtureLoader';
import { writeReport } from './reportWriter';
import { runEval } from './runner';
import type { EvalReport, PipelineAdapter } from './types';

interface AdapterModule {
  createAdapter(): Promise<PipelineAdapter>;
  createJudgeLlm(): Promise<LLMClient>;
}

interface ResolvedAdapter {
  adapter: PipelineAdapter;
  judgeLlm: LLMClient;
  /** Optional teardown — closes any DB connection pools the adapter opened. */
  dispose?: () => Promise<void>;
}

async function loadAdapterModule(adapterPath: string): Promise<AdapterModule> {
  const resolved = resolve(process.cwd(), adapterPath);
  const mod = (await import(resolved)) as Partial<AdapterModule>;
  if (
    typeof mod.createAdapter !== 'function' ||
    typeof mod.createJudgeLlm !== 'function'
  ) {
    throw new Error(
      `Adapter module at ${resolved} must export createAdapter() and createJudgeLlm()`,
    );
  }
  return mod as AdapterModule;
}

async function createV1Adapter(configPath: string): Promise<ResolvedAdapter> {
  const { composition, db } = loadEvalConfig(configPath);
  if (!composition.llm) {
    throw new Error(
      `eval config at ${configPath} is missing an llm block — v1 baseline requires it`,
    );
  }
  if (!composition.embedding) {
    throw new Error(
      `eval config at ${configPath} is missing an embeddings block — v1 baseline requires it`,
    );
  }

  const dbClient: Knex = knexPkg({
    client: 'pg',
    connection: {
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
    },
  });

  const costTracker = new CostTracker();
  const llmModel = composition.llm.model;
  const embedModel = composition.embedding.model ?? 'text-embedding-3-small';

  const logger = {
    debug: () => {},
    // eslint-disable-next-line no-console
    info: (msg: string, meta?: Record<string, unknown>) =>
      console.log(`[info] ${msg}`, meta ?? ''),
    // eslint-disable-next-line no-console
    warn: (msg: string, meta?: Record<string, unknown>) =>
      console.warn(`[warn] ${msg}`, meta ?? ''),
    // eslint-disable-next-line no-console
    error: (msg: string, meta?: Record<string, unknown>) =>
      console.error(`[error] ${msg}`, meta ?? ''),
  };

  const stack = createIngestionStack({
    knex: dbClient,
    logger,
    config: composition,
    wrapLlm: c => withLlmCostTracking(c, costTracker, llmModel),
    wrapEmbedding: c => withEmbeddingCostTracking(c, costTracker, embedModel),
  });

  const adapter = new V1Adapter(stack, { costTracker });

  // Judge LLM is intentionally constructed outside the cost tracker so scorer
  // calls don't inflate the reported pipeline cost. It still uses the cache.
  const judgeLlm = createLLMClient(composition.llm, logger, dbClient);

  return {
    adapter,
    judgeLlm,
    dispose: async () => {
      await dbClient.destroy();
    },
  };
}

async function resolveAdapter(
  adapterOpt: string,
  configPath: string,
): Promise<ResolvedAdapter> {
  if (adapterOpt === 'v1') {
    return createV1Adapter(configPath);
  }
  const mod = await loadAdapterModule(adapterOpt);
  const adapter = await mod.createAdapter();
  const judgeLlm = await mod.createJudgeLlm();
  return { adapter, judgeLlm };
}

async function listFixtures(fixturesDir: string): Promise<string[]> {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => e.name);
}

export function compareReports(baseline: EvalReport, current: EvalReport): string {
  const lines: string[] = [];
  lines.push('# Eval Comparison');
  lines.push('');
  for (const cur of current.repos) {
    const base = baseline.repos.find(r => r.fixtureSlug === cur.fixtureSlug);
    if (!base) {
      lines.push(`- ${cur.fixtureSlug}: new (no baseline)`);
      continue;
    }
    lines.push(`## ${cur.fixtureSlug}`);
    for (const d of ['overview', 'architecture'] as const) {
      const b = base.doc.find(x => x.module === d)?.overall ?? 0;
      const c = cur.doc.find(x => x.module === d)?.overall ?? 0;
      lines.push(`- doc ${d}: ${b.toFixed(2)} → ${c.toFixed(2)} (${delta(b, c)})`);
    }
    lines.push(
      `- qna: ${base.qna.overall.toFixed(2)} → ${cur.qna.overall.toFixed(2)} (${delta(base.qna.overall, cur.qna.overall)})`,
    );
    lines.push(
      `- cost: $${base.cost.totalUsd.toFixed(2)} → $${cur.cost.totalUsd.toFixed(2)} (${delta(base.cost.totalUsd, cur.cost.totalUsd, true)})`,
    );
  }
  return lines.join('\n');
}

function delta(b: number, c: number, lowerIsBetter = false): string {
  const d = c - b;
  if (d === 0) return '=';
  const sign = d > 0 ? '+' : '';
  const verdict = (lowerIsBetter ? d < 0 : d > 0) ? '✅' : '❌';
  return `${sign}${d.toFixed(2)} ${verdict}`;
}

async function cmdRun(opts: {
  adapter: string;
  config: string;
  out: string;
  repo?: string;
  fixturesDir: string;
}) {
  const resolved = await resolveAdapter(opts.adapter, opts.config);
  const { adapter, judgeLlm, dispose } = resolved;

  try {
    const slugs = opts.repo ? [opts.repo] : await listFixtures(opts.fixturesDir);

    const repos: EvalReport['repos'] = [];
    for (const slug of slugs) {
      const fixtureDir = join(opts.fixturesDir, slug);
      const fixture = await loadFixture(fixtureDir);
      // eslint-disable-next-line no-console
      console.log(`[eval] running ${slug}...`);
      const report = await runEval({ fixture, adapter, judgeLlm });
      repos.push(report);
    }

    const evalReport: EvalReport = {
      generatedAt: new Date().toISOString(),
      pipelineVersion: adapter.version,
      repos,
    };

    const outDir = join(opts.out, new Date().toISOString().slice(0, 10));
    const paths = await writeReport(evalReport, outDir);
    // eslint-disable-next-line no-console
    console.log(`[eval] wrote ${paths.markdownPath}`);
  } finally {
    if (dispose) {
      await dispose();
    }
  }
}

async function cmdCompare(opts: { baseline: string; current: string }) {
  const b = JSON.parse(readFileSync(opts.baseline, 'utf-8')) as EvalReport;
  const c = JSON.parse(readFileSync(opts.current, 'utf-8')) as EvalReport;
  // eslint-disable-next-line no-console
  console.log(compareReports(b, c));
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name('eval').description('CodeInsight evaluation harness');

  program
    .command('run')
    .option(
      '--adapter <path>',
      'PipelineAdapter module path, or the literal "v1" to use the built-in V1Adapter',
      'v1',
    )
    .option(
      '--config <path>',
      'path to eval.config.local.yaml (used by v1 adapter)',
      './eval/eval.config.local.yaml',
    )
    .option('--out <dir>', 'output directory', './eval/reports')
    .option('--repo <slug>', 'single fixture slug to run')
    .option(
      '--fixtures-dir <dir>',
      'fixtures directory',
      './packages/core/eval/fixtures',
    )
    .action(cmdRun);

  program
    .command('baseline')
    .option(
      '--adapter <path>',
      'PipelineAdapter module path, or the literal "v1" to use the built-in V1Adapter',
      'v1',
    )
    .option(
      '--config <path>',
      'path to eval.config.local.yaml',
      './eval/eval.config.local.yaml',
    )
    .option('--out <dir>', 'output directory', './eval/reports/baseline')
    .option(
      '--fixtures-dir <dir>',
      'fixtures directory',
      './packages/core/eval/fixtures',
    )
    .action(opts => cmdRun({ ...opts, repo: undefined }));

  program
    .command('compare')
    .requiredOption('--baseline <path>', 'baseline report.json')
    .requiredOption('--current <path>', 'current report.json')
    .action(cmdCompare);

  await program.parseAsync(argv);
}

if (require.main === module) {
  main(process.argv).catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

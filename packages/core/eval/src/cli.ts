import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';

import type { LLMClient } from '@codeinsight/types';
import { Command } from 'commander';

import { loadFixture } from './fixtureLoader';
import { writeReport } from './reportWriter';
import { runEval } from './runner';
import type { EvalReport, PipelineAdapter } from './types';

interface AdapterModule {
  createAdapter(): Promise<PipelineAdapter>;
  createJudgeLlm(): Promise<LLMClient>;
}

async function loadAdapter(adapterPath: string): Promise<AdapterModule> {
  const resolved = resolve(process.cwd(), adapterPath);
  const mod = (await import(resolved)) as Partial<AdapterModule>;
  if (typeof mod.createAdapter !== 'function' || typeof mod.createJudgeLlm !== 'function') {
    throw new Error(
      `Adapter module at ${resolved} must export createAdapter() and createJudgeLlm()`,
    );
  }
  return mod as AdapterModule;
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
  out: string;
  repo?: string;
  fixturesDir: string;
}) {
  const { createAdapter, createJudgeLlm } = await loadAdapter(opts.adapter);
  const adapter = await createAdapter();
  const judgeLlm = await createJudgeLlm();

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
      'path to the PipelineAdapter module',
      './packages/core/eval/dist/adapters/v1Adapter.js',
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
      'path to the v1 PipelineAdapter module',
      './packages/core/eval/dist/adapters/v1Adapter.js',
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

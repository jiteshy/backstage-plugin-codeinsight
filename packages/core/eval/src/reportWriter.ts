import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { EvalReport, RepoReport } from './types';

export async function writeReport(
  report: EvalReport,
  outDir: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, 'report.json');
  const markdownPath = join(outDir, 'report.md');

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf-8');

  return { jsonPath, markdownPath };
}

function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# CodeInsight Eval Report`);
  lines.push(``);
  lines.push(`- **Generated:** ${r.generatedAt}`);
  lines.push(`- **Pipeline:** ${r.pipelineVersion}`);
  lines.push(`- **Repos:** ${r.repos.length}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Repo | Doc (overview) | Doc (arch) | Diagrams | QnA | Cost | Wall |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const repo of r.repos) {
    const overview = repo.doc.find(d => d.module === 'overview')?.overall ?? 0;
    const arch = repo.doc.find(d => d.module === 'architecture')?.overall ?? 0;
    const diagTotal = repo.diagram.reduce((a, b) => a + b.total, 0);
    const diagPass = repo.diagram.reduce((a, b) => a + b.passed, 0);
    const diag = diagTotal === 0 ? '—' : `${diagPass}/${diagTotal}`;
    lines.push(
      `| ${repo.fixtureSlug} | ${overview.toFixed(2)} | ${arch.toFixed(2)} | ${diag} ` +
      `| ${repo.qna.overall.toFixed(2)} | $${repo.cost.totalUsd.toFixed(2)} | ${repo.wallClockSeconds.toFixed(0)}s |`,
    );
  }

  for (const repo of r.repos) {
    lines.push('');
    lines.push(`## ${repo.fixtureSlug} (${repo.commitSha})`);
    lines.push(renderRepoSection(repo));
  }

  return lines.join('\n');
}

function renderRepoSection(repo: RepoReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`### Docs`);
  for (const doc of repo.doc) {
    lines.push(`- **${doc.module}** — ${doc.overall.toFixed(2)}`);
    for (const f of doc.factScores) {
      lines.push(`  - [${f.score}] ${f.fact} — ${f.reason}`);
    }
  }

  lines.push('');
  lines.push(`### Diagrams`);
  for (const d of repo.diagram) {
    lines.push(`- **${d.type}** — ${d.passed}/${d.total}`);
    for (const m of d.missing) {
      lines.push(`  - MISSING: ${m}`);
    }
  }

  lines.push('');
  lines.push(`### QnA (overall ${repo.qna.overall.toFixed(2)})`);
  for (const q of repo.qna.details) {
    lines.push(`- **${q.question}**`);
    lines.push(`  - recall@10=${q.recallAt10.toFixed(2)}, completeness=${q.completeness.toFixed(2)}, hallucinations=${q.hallucinationCount}`);
    lines.push(`  - retrieved: ${q.retrievedFilePaths.join(', ') || '(none)'}`);
  }

  lines.push('');
  lines.push(`### Cost & latency`);
  lines.push(`- Total: $${repo.cost.totalUsd.toFixed(2)} (chat $${repo.cost.chatUsd.toFixed(2)}, embed $${repo.cost.embeddingUsd.toFixed(2)})`);
  lines.push(`- Chat: ${repo.cost.chatRequests} req, ${repo.cost.chatInputTokens} in / ${repo.cost.chatOutputTokens} out`);
  lines.push(`- Embed: ${repo.cost.embeddingRequests} req, ${repo.cost.embeddingInputTokens} in`);
  lines.push(`- Wall clock: ${repo.wallClockSeconds.toFixed(1)}s`);
  return lines.join('\n');
}

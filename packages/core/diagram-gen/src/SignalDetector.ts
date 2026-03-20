import type { CIGSnapshot } from './types';

/**
 * SignalDetector — derives diagram-relevant signals purely from the CIG.
 *
 * Scans file path patterns and CIG node types to detect frameworks, ORMs,
 * and CI systems. No LLM required — this ensures signal-gated modules work
 * even when no LLM client is configured.
 *
 * Output format: array of 'category:value' strings matching DiagramModule.triggersOn
 * (e.g. ['framework:react', 'orm:prisma', 'ci:github-actions']).
 */
export class SignalDetector {
  /**
   * Scan the CIG and return detected signals.
   * Results are merged with any LLM-provided signals in DiagramGenerationService.
   */
  detect(cig: CIGSnapshot): string[] {
    const signals = new Set<string>();
    const filePaths = cig.nodes.map(n => n.filePath);

    // ── Frontend frameworks ──────────────────────────────────────────────────
    if (filePaths.some(fp => fp.endsWith('.tsx') || fp.endsWith('.jsx'))) {
      signals.add('framework:react');
    }
    if (filePaths.some(fp => fp.endsWith('.vue'))) {
      signals.add('framework:vue');
    }
    if (filePaths.some(fp => fp.endsWith('.svelte'))) {
      signals.add('framework:svelte');
    }

    // ── Backend framework: route nodes in CIG ────────────────────────────────
    // Route nodes are emitted by the TypeScript extractor for Express/Fastify/etc.
    // Use 'framework:express' as the generic backend web-framework signal since
    // all LLM-assisted backend modules trigger on it as well.
    if (cig.nodes.some(n => n.symbolType === 'route')) {
      signals.add('framework:express');
    }

    // ── ORM ─────────────────────────────────────────────────────────────────
    if (filePaths.some(fp => fp.endsWith('.prisma') || fp.includes('prisma/schema'))) {
      signals.add('orm:prisma');
    }

    // ── CI/CD ────────────────────────────────────────────────────────────────
    if (filePaths.some(fp => fp.includes('.github/workflows'))) {
      signals.add('ci:github-actions');
    }
    if (filePaths.some(fp => /\.gitlab-ci\.ya?ml$/.test(fp))) {
      signals.add('ci:gitlab-ci');
    }
    if (filePaths.some(fp => fp.includes('.circleci/'))) {
      signals.add('ci:circleci');
    }
    if (filePaths.some(fp => fp.includes('Jenkinsfile'))) {
      signals.add('ci:jenkins');
    }
    if (filePaths.some(fp => fp.includes('azure-pipelines'))) {
      signals.add('ci:azure-devops');
    }

    return Array.from(signals);
  }
}

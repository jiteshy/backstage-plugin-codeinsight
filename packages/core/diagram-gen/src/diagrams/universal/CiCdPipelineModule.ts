import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { extractMermaid } from '../../utils';

/**
 * CiCdPipelineModule — LLM-assisted.
 *
 * Triggered when CI files are present in the repo (signal: 'ci:github-actions',
 * 'ci:gitlab-ci', 'ci:circleci', 'ci:jenkins').
 *
 * The CIG stores CI YAML structure as nodes with symbolType='variable' in ci files.
 * This module collects those nodes and asks the LLM to synthesize a pipeline flowchart.
 */
export class CiCdPipelineModule implements DiagramModule {
  readonly id = 'universal/ci-cd-pipeline';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'ci:github-actions',
    'ci:gitlab-ci',
    'ci:circleci',
    'ci:jenkins',
    'ci:azure-devops',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    // Find nodes from CI files (file_type = 'ci' is stored in file path heuristics)
    const ciNodes = cig.nodes.filter(n =>
      n.filePath.includes('.github/workflows') ||
      n.filePath.includes('.gitlab-ci') ||
      n.filePath.includes('.circleci') ||
      n.filePath.includes('Jenkinsfile') ||
      n.filePath.includes('azure-pipelines'),
    );

    if (ciNodes.length === 0) return null;

    const nodeList = ciNodes
      .slice(0, 30)
      .map(n => `- ${n.symbolName} (${n.filePath})`)
      .join('\n');

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid flowchart LR syntax. No explanation, no fences, no markdown.
Keep node labels short (≤ 25 chars).`;

    const userPrompt = `Generate a Mermaid flowchart LR showing the CI/CD pipeline stages.
Show stages in order: build → test → lint/quality → deploy.

CI/CD symbols detected in this repo:
${nodeList}

Output only the Mermaid flowchart LR block.`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 800,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    return {
      diagramType: 'flowchart',
      mermaid,
      title: 'CI/CD Pipeline',
      description: 'Build, test, and deployment pipeline stages',
      llmUsed: true,
    };
  }
}

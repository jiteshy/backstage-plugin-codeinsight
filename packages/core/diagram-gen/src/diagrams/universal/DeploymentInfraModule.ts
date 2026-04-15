import type { LLMClient } from '@codeinsight/types';

import type { CIGSnapshot, DiagramModule, MermaidDiagram } from '../../types';
import { buildFileSummaryBlock, extractMermaid } from '../../utils';

/**
 * DeploymentInfraModule — LLM-assisted.
 *
 * Replaces CiCdPipelineModule with a more holistic deployment & infrastructure
 * overview. Combines CI/CD pipeline stages with Docker, Kubernetes, and
 * Terraform topology into a single `flowchart LR` diagram.
 *
 * Triggered when any CI or infra signal is present:
 *   ci:github-actions, ci:gitlab-ci, ci:circleci, ci:jenkins, ci:azure-devops,
 *   infra:docker, infra:kubernetes, infra:terraform.
 *
 * Collects:
 *   - CI nodes (from .github/workflows, .gitlab-ci, etc.)
 *   - Docker file paths (Dockerfile, docker-compose)
 *   - Kubernetes manifests (k8s/, helm/ YAML files)
 *   - Terraform files (.tf)
 *
 * The LLM synthesizes a `flowchart LR` showing:
 *   build → test → containerize → deploy → infra topology.
 */
export class DeploymentInfraModule implements DiagramModule {
  readonly id = 'universal/deployment-infra';
  readonly requires = ['nodes', 'edges'] as const;
  readonly triggersOn = [
    'ci:github-actions',
    'ci:gitlab-ci',
    'ci:circleci',
    'ci:jenkins',
    'ci:azure-devops',
    'infra:docker',
    'infra:kubernetes',
    'infra:terraform',
  ] as const;
  readonly llmNeeded = true;

  async generate(
    cig: CIGSnapshot,
    llmClient?: LLMClient,
  ): Promise<MermaidDiagram | null> {
    if (!llmClient) return null;

    const filePaths = [...new Set(cig.nodes.map(n => n.filePath))];

    // Classify infra files
    const ciFiles = filePaths.filter(fp =>
      fp.includes('.github/workflows') ||
      fp.includes('.gitlab-ci') ||
      fp.includes('.circleci') ||
      fp.includes('Jenkinsfile') ||
      fp.includes('azure-pipelines'),
    );

    const dockerFiles = filePaths.filter(fp =>
      /Dockerfile|docker-compose\.ya?ml$|\.dockerignore$/.test(fp),
    );

    const k8sFiles = filePaths.filter(fp =>
      (/\.ya?ml$/.test(fp) && (fp.includes('k8s/') || fp.includes('kubernetes/') || fp.includes('helm/'))) ||
      /Chart\.ya?ml$/.test(fp),
    );

    const tfFiles = filePaths.filter(fp => fp.endsWith('.tf') || fp.endsWith('.tf.json'));

    // Need at least one category of infra files
    const totalInfraFiles = ciFiles.length + dockerFiles.length + k8sFiles.length + tfFiles.length;
    if (totalInfraFiles === 0) return null;

    // Collect CI nodes for job/stage names
    const ciNodes = cig.nodes.filter(n =>
      ciFiles.includes(n.filePath),
    ).slice(0, 20);

    // Summarize for LLM
    const sections: string[] = [];

    if (ciNodes.length > 0) {
      const jobList = ciNodes.map(n => `    - ${n.symbolName} (${n.filePath.split('/').pop()})`).join('\n');
      sections.push(`CI/CD jobs/stages:\n${jobList}`);
    } else if (ciFiles.length > 0) {
      sections.push(`CI/CD files: ${ciFiles.map(f => f.split('/').pop()).join(', ')}`);
    }

    if (dockerFiles.length > 0) {
      sections.push(`Docker: ${dockerFiles.map(f => f.split('/').pop()).join(', ')}`);
    }

    if (k8sFiles.length > 0) {
      const k8sNames = k8sFiles.slice(0, 8).map(f => f.split('/').pop()).join(', ');
      sections.push(`Kubernetes/Helm: ${k8sNames}${k8sFiles.length > 8 ? ` (+${k8sFiles.length - 8} more)` : ''}`);
    }

    if (tfFiles.length > 0) {
      const tfNames = tfFiles.slice(0, 6).map(f => f.split('/').pop()).join(', ');
      sections.push(`Terraform: ${tfNames}${tfFiles.length > 6 ? ` (+${tfFiles.length - 6} more)` : ''}`);
    }

    const systemPrompt = `You are a software architecture diagram generator.
Output ONLY valid Mermaid flowchart LR syntax. No explanation, no fences, no markdown.
Keep node labels ≤ 25 chars. Use short IDs (BUILD, TEST, DEPLOY, K8S, etc.).
Emit at most 20 nodes. Use subgraph blocks for logical stages.`;

    const summaryBlock = buildFileSummaryBlock(cig);

    const userPrompt = `Generate a Mermaid flowchart LR showing the deployment and infrastructure topology.
${summaryBlock ? `\n## Key File Summaries\n${summaryBlock}\n` : ''}
Show the complete deployment pipeline from code commit to running infrastructure:
  Source → Build → Test → Containerize → Deploy → Infrastructure

Infrastructure detected in this repo:
${sections.join('\n\n')}

Guidelines:
- Use subgraph blocks for: CI Pipeline, Container Build, Deployment, Infrastructure
- Show flow from left (source/CI) to right (deployed infra)
- Include Kubernetes namespaces/services if k8s files are present
- Include Terraform modules/resources if .tf files are present
- Keep it high-level — no individual file names, just conceptual stages

Output only the Mermaid flowchart LR block (starting with "flowchart LR").`;

    const raw = await llmClient.complete(systemPrompt, userPrompt, {
      maxTokens: 900,
      temperature: 0.1,
    });

    const mermaid = extractMermaid(raw);
    if (!mermaid) return null;

    // Build description
    const parts: string[] = [];
    if (ciFiles.length > 0) parts.push('CI/CD');
    if (dockerFiles.length > 0) parts.push('Docker');
    if (k8sFiles.length > 0) parts.push('Kubernetes');
    if (tfFiles.length > 0) parts.push('Terraform');

    return {
      diagramType: 'flowchart',
      mermaid,
      title: 'Deployment & Infrastructure',
      description: `${parts.join(' + ')} topology — build pipeline through deployed infrastructure`,
      llmUsed: true,
    };
  }
}

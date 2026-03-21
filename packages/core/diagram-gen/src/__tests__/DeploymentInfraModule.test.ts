import type { CIGEdge, CIGNode, LLMClient } from '@codeinsight/types';

import { DeploymentInfraModule } from '../diagrams/universal/DeploymentInfraModule';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO_ID = 'test-repo';

function makeNode(nodeId: string, filePath: string, symbolName?: string): CIGNode {
  return {
    nodeId,
    repoId: REPO_ID,
    filePath,
    symbolName: symbolName ?? nodeId,
    symbolType: 'function',
    startLine: 1,
    endLine: 10,
    exported: false,
    extractedSha: 'sha-abc',
  };
}

function snap(nodes: CIGNode[], edges: CIGEdge[] = []): CIGSnapshot {
  return { nodes, edges };
}

const VALID_MERMAID = 'flowchart LR\n  BUILD --> TEST --> DEPLOY';

function makeMockLLM(returnValue: string = VALID_MERMAID): jest.Mocked<LLMClient> {
  return {
    complete: jest.fn().mockResolvedValue(returnValue),
    stream: jest.fn(),
  } as unknown as jest.Mocked<LLMClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeploymentInfraModule', () => {
  let mod: DeploymentInfraModule;

  beforeEach(() => {
    mod = new DeploymentInfraModule();
  });

  // ── Static properties ─────────────────────────────────────────────────────

  it('has the expected static properties', () => {
    expect(mod.id).toBe('universal/deployment-infra');
    expect(mod.llmNeeded).toBe(true);
    expect(mod.triggersOn).toContain('ci:github-actions');
    expect(mod.triggersOn).toContain('ci:gitlab-ci');
    expect(mod.triggersOn).toContain('ci:circleci');
    expect(mod.triggersOn).toContain('ci:jenkins');
    expect(mod.triggersOn).toContain('ci:azure-devops');
    expect(mod.triggersOn).toContain('infra:docker');
    expect(mod.triggersOn).toContain('infra:kubernetes');
    expect(mod.triggersOn).toContain('infra:terraform');
    expect(mod.triggersOn).toHaveLength(8);
  });

  // ── Null-return conditions ────────────────────────────────────────────────

  it('returns null when llmClient is undefined', async () => {
    const nodes = [makeNode('n1', '.github/workflows/ci.yml', 'build')];
    expect(await mod.generate(snap(nodes), undefined)).toBeNull();
  });

  it('returns null for empty CIG (no infra files)', async () => {
    const llm = makeMockLLM();
    expect(await mod.generate(snap([]), llm)).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when no CI/Docker/k8s/Terraform files are found', async () => {
    const llm = makeMockLLM();
    const nodes = [
      makeNode('n1', 'src/services/UserService.ts', 'UserService'),
      makeNode('n2', 'src/controllers/UserController.ts', 'UserController'),
    ];
    expect(await mod.generate(snap(nodes), llm)).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns null when extractMermaid returns null (LLM gives bad output)', async () => {
    const llm = makeMockLLM('This is not valid mermaid at all.');
    const nodes = [makeNode('n1', '.github/workflows/ci.yml', 'build')];
    expect(await mod.generate(snap(nodes), llm)).toBeNull();
  });

  it('returns null when LLM returns empty string', async () => {
    const llm = makeMockLLM('');
    const nodes = [makeNode('n1', '.github/workflows/ci.yml', 'build')];
    expect(await mod.generate(snap(nodes), llm)).toBeNull();
  });

  // ── CI file detection ─────────────────────────────────────────────────────

  it('detects GitHub Actions files (.github/workflows)', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', '.github/workflows/deploy.yml', 'deploy')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result!.description).toContain('CI/CD');
  });

  it('detects GitLab CI files (.gitlab-ci)', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', '.gitlab-ci.yml', 'stages')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('CI/CD');
  });

  it('detects CircleCI files (.circleci)', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', '.circleci/config.yml', 'jobs')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
  });

  it('detects Jenkinsfile', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'Jenkinsfile', 'pipeline')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
  });

  // ── Docker file detection ─────────────────────────────────────────────────

  it('detects Dockerfile', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'Dockerfile', 'FROM')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Docker');
  });

  it('detects docker-compose.yml', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'docker-compose.yml', 'services')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Docker');
  });

  it('detects docker-compose.yaml', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'docker-compose.yaml', 'services')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Docker');
  });

  // ── Kubernetes file detection ─────────────────────────────────────────────

  it('detects Kubernetes manifests under k8s/', async () => {
    const llm = makeMockLLM();
    const nodes = [
      makeNode('n1', 'k8s/deployment.yaml', 'Deployment'),
      makeNode('n2', 'k8s/service.yaml', 'Service'),
    ];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Kubernetes');
  });

  it('detects Helm Chart.yaml', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'helm/myapp/Chart.yaml', 'apiVersion')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Kubernetes');
  });

  // ── Terraform file detection ──────────────────────────────────────────────

  it('detects Terraform .tf files', async () => {
    const llm = makeMockLLM();
    const nodes = [
      makeNode('n1', 'infra/main.tf', 'resource'),
      makeNode('n2', 'infra/variables.tf', 'variable'),
    ];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Terraform');
  });

  it('detects Terraform .tf.json files', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'infra/main.tf.json', 'resource')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.description).toContain('Terraform');
  });

  // ── LLM call ─────────────────────────────────────────────────────────────

  it('calls llmClient.complete() once with infra context in user prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', '.github/workflows/ci.yml', 'build')];

    await mod.generate(snap(nodes), llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('flowchart LR');
  });

  it('passes maxTokens and temperature in LLM options', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', '.github/workflows/ci.yml', 'build')];

    await mod.generate(snap(nodes), llm);

    const [, , opts] = (llm.complete as jest.Mock).mock.calls[0];
    expect(opts).toMatchObject({ maxTokens: 900, temperature: 0.1 });
  });

  it('includes CI job names from CI nodes in user prompt', async () => {
    const llm = makeMockLLM();
    const nodes = [
      makeNode('n1', '.github/workflows/ci.yml', 'build-and-test'),
      makeNode('n2', '.github/workflows/ci.yml', 'deploy-prod'),
    ];

    await mod.generate(snap(nodes), llm);

    const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0];
    expect(userPrompt).toContain('build-and-test');
    expect(userPrompt).toContain('deploy-prod');
  });

  // ── Output shape ──────────────────────────────────────────────────────────

  it('produces a flowchart diagram with title "Deployment & Infrastructure"', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'Dockerfile', 'FROM')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result!.title).toBe('Deployment & Infrastructure');
    expect(result!.diagramType).toBe('flowchart');
    expect(result!.llmUsed).toBe(true);
    expect(result!.mermaid).toBe(VALID_MERMAID);
  });

  it('description lists all detected infra categories when multiple are present', async () => {
    const llm = makeMockLLM();
    const nodes = [
      makeNode('ci1', '.github/workflows/ci.yml', 'build'),
      makeNode('d1', 'Dockerfile', 'FROM'),
      makeNode('k1', 'k8s/deployment.yaml', 'Deployment'),
      makeNode('tf1', 'infra/main.tf', 'resource'),
    ];

    const result = await mod.generate(snap(nodes), llm);

    expect(result!.description).toContain('CI/CD');
    expect(result!.description).toContain('Docker');
    expect(result!.description).toContain('Kubernetes');
    expect(result!.description).toContain('Terraform');
  });

  it('does not include nodeMap (LLM generates conceptual stages)', async () => {
    const llm = makeMockLLM();
    const nodes = [makeNode('n1', 'Dockerfile', 'FROM')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result!.nodeMap).toBeUndefined();
  });

  it('strips mermaid fences from LLM output', async () => {
    const llm = makeMockLLM('```mermaid\nflowchart LR\n  A --> B\n```');
    const nodes = [makeNode('n1', 'Dockerfile', 'FROM')];

    const result = await mod.generate(snap(nodes), llm);

    expect(result).not.toBeNull();
    expect(result!.mermaid).not.toContain('```');
    expect(result!.mermaid).toContain('flowchart LR');
    expect(result!.llmUsed).toBe(true);
  });
});

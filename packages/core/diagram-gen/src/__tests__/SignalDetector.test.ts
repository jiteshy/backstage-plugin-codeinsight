import type { CIGEdge, CIGNode } from '@codeinsight/types';

import { SignalDetector } from '../SignalDetector';
import type { CIGSnapshot } from '../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(
  nodeId: string,
  filePath: string,
  symbolType: CIGNode['symbolType'] = 'function',
  symbolName?: string,
): CIGNode {
  return {
    nodeId,
    repoId: 'repo',
    filePath,
    symbolName: symbolName ?? nodeId,
    symbolType,
    startLine: 1,
    endLine: 5,
    exported: false,
    extractedSha: 'sha',
  };
}

function snap(nodes: CIGNode[], edges: CIGEdge[] = []): CIGSnapshot {
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignalDetector', () => {
  let detector: SignalDetector;

  beforeEach(() => {
    detector = new SignalDetector();
  });

  it('returns empty array for empty CIG', () => {
    expect(detector.detect(snap([]))).toEqual([]);
  });

  describe('framework detection', () => {
    it('detects framework:react from .tsx files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/App.tsx')]));
      expect(signals).toContain('framework:react');
    });

    it('detects framework:react from .jsx files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/App.jsx')]));
      expect(signals).toContain('framework:react');
    });

    it('detects framework:vue from .vue files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/App.vue')]));
      expect(signals).toContain('framework:vue');
    });

    it('detects framework:svelte from .svelte files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/App.svelte')]));
      expect(signals).toContain('framework:svelte');
    });

    it('detects framework:express from route symbolType nodes', () => {
      const signals = detector.detect(snap([makeNode('r1', 'src/routes/user.ts', 'route')]));
      expect(signals).toContain('framework:express');
    });

    it('does not emit framework signals for plain .ts files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/utils.ts')]));
      expect(signals).not.toContain('framework:react');
      expect(signals).not.toContain('framework:express');
    });
  });

  describe('ORM detection', () => {
    it('detects orm:prisma from .prisma file extension', () => {
      const signals = detector.detect(snap([makeNode('n1', 'prisma/schema.prisma')]));
      expect(signals).toContain('orm:prisma');
    });

    it('detects orm:prisma from prisma/schema path segment', () => {
      const signals = detector.detect(snap([makeNode('n1', 'prisma/schema/main.prisma')]));
      expect(signals).toContain('orm:prisma');
    });
  });

  describe('CI detection', () => {
    it('detects ci:github-actions', () => {
      const signals = detector.detect(snap([makeNode('n1', '.github/workflows/ci.yml')]));
      expect(signals).toContain('ci:github-actions');
    });

    it('detects ci:gitlab-ci from .gitlab-ci.yml', () => {
      const signals = detector.detect(snap([makeNode('n1', '.gitlab-ci.yml')]));
      expect(signals).toContain('ci:gitlab-ci');
    });

    it('detects ci:circleci', () => {
      const signals = detector.detect(snap([makeNode('n1', '.circleci/config.yml')]));
      expect(signals).toContain('ci:circleci');
    });

    it('detects ci:jenkins', () => {
      const signals = detector.detect(snap([makeNode('n1', 'Jenkinsfile')]));
      expect(signals).toContain('ci:jenkins');
    });

    it('detects ci:azure-devops', () => {
      const signals = detector.detect(snap([makeNode('n1', 'azure-pipelines.yml')]));
      expect(signals).toContain('ci:azure-devops');
    });
  });

  describe('state-management detection', () => {
    it('detects state-management:redux from /redux/ path', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/redux/store.ts')]));
      expect(signals).toContain('state-management:redux');
    });

    it('detects state-management:redux from reducer symbolName', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/state.ts', 'function', 'userReducer')]));
      expect(signals).toContain('state-management:redux');
    });

    it('detects state-management:redux from createSlice symbolName', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/slices/auth.ts', 'function', 'createSlice')]));
      expect(signals).toContain('state-management:redux');
    });

    it('detects state-management:zustand from zustand path', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/zustand/store.ts')]));
      expect(signals).toContain('state-management:zustand');
    });

    it('detects state-management:context from createContext symbolName', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/auth.tsx', 'function', 'createContext')]));
      expect(signals).toContain('state-management:context');
    });

    it('detects state-management:context from /contexts/ path', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/contexts/AuthContext.tsx')]));
      expect(signals).toContain('state-management:context');
    });

    it('detects state-management:context from Context.tsx filename', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/ThemeContext.tsx')]));
      expect(signals).toContain('state-management:context');
    });

    it('detects state-management:mobx from makeObservable symbolName', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/store.ts', 'function', 'makeObservable')]));
      expect(signals).toContain('state-management:mobx');
    });

    it('detects state-management:mobx from mobx path', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/mobx/store.ts')]));
      expect(signals).toContain('state-management:mobx');
    });
  });

  describe('infrastructure detection', () => {
    it('detects infra:docker from Dockerfile', () => {
      const signals = detector.detect(snap([makeNode('n1', 'Dockerfile')]));
      expect(signals).toContain('infra:docker');
    });

    it('detects infra:docker from docker-compose.yml', () => {
      const signals = detector.detect(snap([makeNode('n1', 'docker-compose.yml')]));
      expect(signals).toContain('infra:docker');
    });

    it('detects infra:kubernetes from k8s/ directory', () => {
      const signals = detector.detect(snap([makeNode('n1', 'k8s/deployment.yml')]));
      expect(signals).toContain('infra:kubernetes');
    });

    it('detects infra:kubernetes from helm Chart.yaml', () => {
      const signals = detector.detect(snap([makeNode('n1', 'charts/app/Chart.yaml')]));
      expect(signals).toContain('infra:kubernetes');
    });

    it('detects infra:terraform from .tf files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'infra/main.tf')]));
      expect(signals).toContain('infra:terraform');
    });

    it('does not detect infra signals for plain source files', () => {
      const signals = detector.detect(snap([makeNode('n1', 'src/index.ts')]));
      expect(signals).not.toContain('infra:docker');
      expect(signals).not.toContain('infra:kubernetes');
      expect(signals).not.toContain('infra:terraform');
    });
  });

  describe('multiple signals', () => {
    it('can detect multiple signals from the same CIG', () => {
      const nodes = [
        makeNode('n1', 'src/App.tsx'),
        makeNode('n2', 'prisma/schema.prisma'),
        makeNode('n3', '.github/workflows/ci.yml'),
        makeNode('r1', 'src/routes/api.ts', 'route'),
      ];
      const signals = detector.detect(snap(nodes));

      expect(signals).toContain('framework:react');
      expect(signals).toContain('framework:express');
      expect(signals).toContain('orm:prisma');
      expect(signals).toContain('ci:github-actions');
    });

    it('emits no duplicates', () => {
      const nodes = [
        makeNode('n1', 'src/A.tsx'),
        makeNode('n2', 'src/B.tsx'),
      ];
      const signals = detector.detect(snap(nodes));
      const reactSignals = signals.filter(s => s === 'framework:react');
      expect(reactSignals).toHaveLength(1);
    });
  });
});

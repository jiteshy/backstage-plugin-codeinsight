import type { LLMClient, Logger } from '@codeinsight/types';

import { ClassifierService } from '../ClassifierService';
import type { ClassifierInput } from '../types';

// ---------------------------------------------------------------------------
// Mock LLM client factory
// ---------------------------------------------------------------------------

function makeLLMClient(response: string | Error): LLMClient {
  return {
    complete: jest.fn().mockImplementation(() => {
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    }),
    stream: jest.fn(),
  };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixture inputs
// ---------------------------------------------------------------------------

const REACT_EXPRESS_FILES: string[] = [
  'package.json',
  'src/server.ts',
  'src/routes/users.ts',
  'src/routes/posts.ts',
  'src/middleware/auth.ts',
  'src/db/schema.prisma',
  'client/src/App.tsx',
  'client/src/components/UserList.tsx',
  'client/src/store/useStore.ts',
  'client/package.json',
  'Dockerfile',
  '.github/workflows/ci.yml',
  'jest.config.js',
  'src/__tests__/users.test.ts',
];

const REACT_EXPRESS_PKG = JSON.stringify({
  name: 'my-fullstack-app',
  dependencies: {
    express: '^4.18.0',
    '@prisma/client': '^5.0.0',
    react: '^18.0.0',
    zustand: '^4.0.0',
  },
  devDependencies: {
    typescript: '^5.0.0',
    jest: '^29.0.0',
  },
});

const FASTAPI_FILES: string[] = [
  'main.py',
  'requirements.txt',
  'app/routes/users.py',
  'app/routes/auth.py',
  'app/models/user.py',
  'app/db/session.py',
  'tests/test_users.py',
  'Dockerfile',
  '.github/workflows/ci.yml',
];

const NEXTJS_FILES: string[] = [
  'package.json',
  'next.config.ts',
  'app/page.tsx',
  'app/layout.tsx',
  'app/dashboard/page.tsx',
  'components/Button.tsx',
  'components/Nav.tsx',
  'store/useAppStore.ts',
  '.github/workflows/ci.yml',
];

const NEXTJS_PKG = JSON.stringify({
  name: 'my-next-app',
  dependencies: {
    next: '^14.0.0',
    react: '^18.0.0',
    'react-dom': '^18.0.0',
    zustand: '^4.0.0',
  },
  devDependencies: {
    typescript: '^5.0.0',
    vitest: '^1.0.0',
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(filePaths: string[], packageJsonContents: string[] = []): ClassifierInput {
  return { filePaths, packageJsonContents };
}

function makeSuccessResponse(overrides: object = {}): string {
  return JSON.stringify({
    repo_type: ['frontend', 'backend'],
    language: 'typescript',
    frameworks: ['react', 'express'],
    detected_signals: {
      state_management: 'zustand',
      database: 'prisma',
      test_framework: 'jest',
    },
    prompt_modules: [
      'core/overview',
      'core/project-structure',
      'core/getting-started',
      'core/configuration',
      'core/dependencies',
      'core/testing',
      'core/deployment',
      'frontend/component-hierarchy',
      'frontend/state-management',
      'backend/api-reference',
      'backend/database',
      'backend/auth',
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClassifierService', () => {
  describe('successful classification', () => {
    it('classifies a React + Express fullstack repo', async () => {
      const llm = makeLLMClient(makeSuccessResponse());
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(REACT_EXPRESS_FILES, [REACT_EXPRESS_PKG]));

      expect(result.repoType).toContain('frontend');
      expect(result.repoType).toContain('backend');
      expect(result.language).toBe('typescript');
      expect(result.frameworks).toContain('react');
      expect(result.frameworks).toContain('express');
      expect(result.detectedSignals.database).toBe('prisma');
      expect(result.detectedSignals.state_management).toBe('zustand');
      expect(result.promptModules).toContain('core/overview');
      expect(result.promptModules).toContain('frontend/component-hierarchy');
      expect(result.promptModules).toContain('backend/api-reference');
    });

    it('classifies a Python FastAPI service', async () => {
      const fastapiResponse = JSON.stringify({
        repo_type: ['backend'],
        language: 'python',
        frameworks: ['fastapi'],
        detected_signals: { test_framework: 'pytest', database: 'sqlalchemy' },
        prompt_modules: [
          'core/overview',
          'core/project-structure',
          'core/getting-started',
          'core/configuration',
          'core/dependencies',
          'core/testing',
          'core/deployment',
          'backend/api-reference',
          'backend/database',
          'backend/auth',
        ],
      });
      const llm = makeLLMClient(fastapiResponse);
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(FASTAPI_FILES));

      expect(result.repoType).toEqual(['backend']);
      expect(result.language).toBe('python');
      expect(result.frameworks).toContain('fastapi');
      expect(result.detectedSignals.test_framework).toBe('pytest');
      expect(result.promptModules).toContain('backend/api-reference');
      expect(result.promptModules).not.toContain('frontend/component-hierarchy');
    });

    it('classifies a Next.js app', async () => {
      const nextResponse = JSON.stringify({
        repo_type: ['frontend', 'fullstack'],
        language: 'typescript',
        frameworks: ['next', 'react'],
        detected_signals: { state_management: 'zustand', build_tool: 'turbo' },
        prompt_modules: [
          'core/overview',
          'core/project-structure',
          'core/getting-started',
          'core/dependencies',
          'core/deployment',
          'frontend/component-hierarchy',
          'frontend/state-management',
          'frontend/routing',
        ],
      });
      const llm = makeLLMClient(nextResponse);
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(NEXTJS_FILES, [NEXTJS_PKG]));

      expect(result.repoType).toContain('frontend');
      expect(result.frameworks).toContain('next');
      expect(result.frameworks).toContain('react');
      expect(result.promptModules).toContain('frontend/component-hierarchy');
      expect(result.promptModules).toContain('frontend/routing');
    });

    it('always includes core/overview and core/project-structure', async () => {
      // LLM response omits core modules — service should add them
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['backend'],
          language: 'go',
          frameworks: [],
          detected_signals: {},
          prompt_modules: ['backend/api-reference'],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['main.go', 'go.mod']));

      expect(result.promptModules).toContain('core/overview');
      expect(result.promptModules).toContain('core/project-structure');
      expect(result.promptModules).toContain('backend/api-reference');
    });

    it('filters out invalid/hallucinated module IDs from LLM response', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['backend'],
          language: 'typescript',
          frameworks: ['express'],
          detected_signals: {},
          prompt_modules: [
            'core/overview',
            'core/project-structure',
            'backend/api-reference',
            'invented/module',    // invalid — should be filtered
            'fake/section',       // invalid — should be filtered
          ],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['src/index.ts', 'package.json']));

      expect(result.promptModules).not.toContain('invented/module');
      expect(result.promptModules).not.toContain('fake/section');
      expect(result.promptModules).toContain('backend/api-reference');
    });

    it('strips null values from detected_signals', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['frontend'],
          language: 'javascript',
          frameworks: ['react'],
          detected_signals: {
            state_management: 'redux',
            database: 'null',   // string 'null' — should be excluded
            test_framework: null, // JSON null — should be excluded
          },
          prompt_modules: ['core/overview', 'core/project-structure', 'frontend/component-hierarchy'],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['src/App.jsx', 'package.json']));

      expect(result.detectedSignals.state_management).toBe('redux');
      expect(result.detectedSignals).not.toHaveProperty('database');
      expect(result.detectedSignals).not.toHaveProperty('test_framework');
    });

    it('handles LLM response wrapped in markdown code block', async () => {
      const jsonPayload = makeSuccessResponse({ repo_type: ['library'] });
      const wrappedResponse = `Here is the classification:\n\`\`\`json\n${jsonPayload}\n\`\`\`\nDone.`;
      const llm = makeLLMClient(wrappedResponse);
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['src/index.ts', 'package.json']));

      expect(result.repoType).toContain('library');
    });

    it('extracts correct fields when LLM returns extra unknown fields', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['backend'],
          language: 'typescript',
          frameworks: ['nestjs'],
          detected_signals: { database: 'typeorm', auth: 'jwt' },
          prompt_modules: [
            'core/overview',
            'core/project-structure',
            'backend/api-reference',
            'backend/database',
            'backend/auth',
          ],
          extra_field: 'should be ignored',
          another_extra: 42,
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['src/main.ts', 'package.json']));

      expect(result.repoType).toEqual(['backend']);
      expect(result.language).toBe('typescript');
      expect(result.frameworks).toContain('nestjs');
      expect(result.detectedSignals.auth).toBe('jwt');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to core modules when LLM client throws', async () => {
      const llm = makeLLMClient(new Error('Network error'));
      const logger = makeLogger();
      const service = new ClassifierService(llm, logger);

      const result = await service.classify(makeInput(['src/index.ts']));

      expect(result.repoType).toEqual(['unknown']);
      expect(result.language).toBe('unknown');
      expect(result.frameworks).toEqual([]);
      expect(result.promptModules).toContain('core/overview');
      expect(result.promptModules).toContain('core/project-structure');
      expect(result.promptModules).toContain('core/getting-started');
      expect(result.promptModules).toContain('core/testing');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('LLM call failed'),
        expect.objectContaining({ error: 'Network error' }),
      );
    });

    it('falls back when LLM returns no JSON object', async () => {
      const llm = makeLLMClient('I cannot classify this repository.');
      const logger = makeLogger();
      const service = new ClassifierService(llm, logger);

      const result = await service.classify(makeInput(['src/index.ts']));

      expect(result.repoType).toEqual(['unknown']);
      expect(result.promptModules).toEqual(expect.arrayContaining(['core/overview']));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No JSON object found'),
      );
    });

    it('falls back when LLM returns malformed JSON', async () => {
      const llm = makeLLMClient('{ "repo_type": ["backend", malformed }');
      const logger = makeLogger();
      const service = new ClassifierService(llm, logger);

      const result = await service.classify(makeInput(['src/index.ts']));

      expect(result.repoType).toEqual(['unknown']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('JSON parse failed'),
      );
    });

    it('falls back when LLM returns a JSON array instead of object', async () => {
      const llm = makeLLMClient('[1, 2, 3]');
      const logger = makeLogger();
      const service = new ClassifierService(llm, logger);

      const result = await service.classify(makeInput(['src/index.ts']));

      expect(result.repoType).toEqual(['unknown']);
    });

    it('falls back gracefully without a logger', async () => {
      const llm = makeLLMClient(new Error('timeout'));
      const service = new ClassifierService(llm); // no logger

      // Should not throw
      const result = await service.classify(makeInput(['src/index.ts']));
      expect(result.repoType).toEqual(['unknown']);
    });
  });

  describe('user prompt construction', () => {
    it('calls llmClient.complete with system prompt and user prompt', async () => {
      const llm = makeLLMClient(makeSuccessResponse());
      const service = new ClassifierService(llm);

      await service.classify(makeInput(['src/index.ts', 'package.json'], ['{"name":"test"}']));

      expect(llm.complete).toHaveBeenCalledTimes(1);
      const [systemPrompt, userPrompt] = (llm.complete as jest.Mock).mock.calls[0] as [string, string];
      expect(systemPrompt).toContain('repository analyzer');
      expect(systemPrompt).toContain('prompt_modules');
      expect(userPrompt).toContain('src/index.ts');
      expect(userPrompt).toContain('package.json');
      expect(userPrompt).toContain('{"name":"test"}');
    });

    it('caps file paths at 200 in the user prompt', async () => {
      const manyFiles = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts`);
      const llm = makeLLMClient(makeSuccessResponse());
      const service = new ClassifierService(llm);

      await service.classify(makeInput(manyFiles));

      const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0] as [string, string];
      // The 201st file should not appear in the prompt
      expect(userPrompt).not.toContain('src/file200.ts');
      expect(userPrompt).toContain('src/file199.ts');
    });

    it('includes only first 2 package.json files', async () => {
      const manifests = [
        '{"name":"root"}',
        '{"name":"sub1"}',
        '{"name":"sub2"}', // should be excluded
      ];
      const llm = makeLLMClient(makeSuccessResponse());
      const service = new ClassifierService(llm);

      await service.classify(makeInput(['package.json'], manifests));

      const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0] as [string, string];
      expect(userPrompt).toContain('"root"');
      expect(userPrompt).toContain('"sub1"');
      expect(userPrompt).not.toContain('"sub2"');
    });

    it('handles empty package.json list gracefully', async () => {
      const llm = makeLLMClient(makeSuccessResponse());
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['main.go', 'go.mod'], []));

      expect(result).toBeDefined();
      const [, userPrompt] = (llm.complete as jest.Mock).mock.calls[0] as [string, string];
      expect(userPrompt).toContain('main.go');
    });
  });

  describe('missing or malformed fields in LLM response', () => {
    it('defaults language to "unknown" when field is missing', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['backend'],
          frameworks: [],
          detected_signals: {},
          prompt_modules: ['core/overview', 'core/project-structure'],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['main.py']));

      expect(result.language).toBe('unknown');
    });

    it('defaults repo_type to [] when field is missing', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          language: 'python',
          frameworks: [],
          detected_signals: {},
          prompt_modules: ['core/overview', 'core/project-structure'],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['main.py']));

      expect(result.repoType).toEqual([]);
    });

    it('ignores non-string entries in frameworks array', async () => {
      const llm = makeLLMClient(
        JSON.stringify({
          repo_type: ['backend'],
          language: 'typescript',
          frameworks: ['express', 42, null, 'fastify'],
          detected_signals: {},
          prompt_modules: ['core/overview', 'core/project-structure', 'backend/api-reference'],
        }),
      );
      const service = new ClassifierService(llm);

      const result = await service.classify(makeInput(['src/index.ts']));

      expect(result.frameworks).toEqual(['express', 'fastify']);
    });
  });
});

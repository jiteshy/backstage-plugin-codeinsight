import { FileFilter } from '../FileFilter';

describe('FileFilter', () => {
  let filter: FileFilter;

  beforeAll(() => {
    filter = new FileFilter();
  });

  // -----------------------------------------------------------------------
  // shouldExclude — directory exclusions
  // -----------------------------------------------------------------------

  describe('shouldExclude — directory exclusions', () => {
    it.each([
      'node_modules/express/index.js',
      'src/node_modules/helper.ts',
      'deep/nested/node_modules/pkg/main.js',
      'vendor/autoload.php',
      '.git/config',
      'dist/bundle.js',
      'build/index.html',
      '.next/server/pages/index.js',
      '.nuxt/components/index.js',
      '__pycache__/module.cpython-39.pyc',
      '.tox/py39/lib/python3.9/site.py',
      'target/release/binary',
      'coverage/lcov.info',
      '.cache/babel/cache.json',
      '.vscode/settings.json',
      '.idea/workspace.xml',
      'venv/lib/python3.9/site-packages/pip.py',
      '.venv/bin/activate',
    ])('excludes %s', (path) => {
      expect(filter.shouldExclude(path)).toBe(true);
    });

    it('excludes node_modules at any depth', () => {
      expect(filter.shouldExclude('a/b/c/node_modules/d/e.js')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // shouldExclude — file exclusions
  // -----------------------------------------------------------------------

  describe('shouldExclude — file exclusions', () => {
    it.each([
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'composer.lock',
      'Gemfile.lock',
      'Pipfile.lock',
      'poetry.lock',
      'go.sum',
      'Cargo.lock',
      '.DS_Store',
      '.gitattributes',
    ])('excludes lock/meta file %s', (path) => {
      expect(filter.shouldExclude(path)).toBe(true);
    });

    it.each([
      'logo.png',
      'icon.jpg',
      'photo.jpeg',
      'animation.gif',
      'favicon.ico',
      'diagram.svg',
      'image.webp',
      'audio.mp3',
      'video.mp4',
      'font.woff2',
      'font.ttf',
      'archive.zip',
      'data.tar.gz',
      'lib.so',
      'app.exe',
      'module.wasm',
      'data.sqlite',
      'output.tsbuildinfo',
      'bundle.js.map',
      'report.pdf',
    ])('excludes binary/media file %s', (path) => {
      expect(filter.shouldExclude(path)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // shouldExclude — should NOT exclude
  // -----------------------------------------------------------------------

  describe('shouldExclude — should NOT exclude', () => {
    it.each([
      'src/index.ts',
      'src/components/App.tsx',
      'lib/utils.py',
      'main.go',
      'Cargo.toml',
      'package.json',
      'README.md',
      'Dockerfile',
      '.github/workflows/ci.yml',
      'tsconfig.json',
      'src/schema.prisma',
      'docker-compose.yml',
      'jest.config.js',
      '.eslintrc.json',
      '.env.example',
      'src/deep/nested/file.ts',
    ])('does NOT exclude %s', (path) => {
      expect(filter.shouldExclude(path)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // shouldExclude — custom config
  // -----------------------------------------------------------------------

  describe('shouldExclude — custom config', () => {
    it('respects custom excluded directories', () => {
      const custom = new FileFilter({ excludeDirs: ['generated', 'tmp'] });
      expect(custom.shouldExclude('generated/types.ts')).toBe(true);
      expect(custom.shouldExclude('src/tmp/cache.ts')).toBe(true);
      expect(custom.shouldExclude('src/index.ts')).toBe(false);
    });

    it('respects custom excluded extensions', () => {
      const custom = new FileFilter({ excludeExtensions: ['.log', '.bak'] });
      expect(custom.shouldExclude('app.log')).toBe(true);
      expect(custom.shouldExclude('data.bak')).toBe(true);
      expect(custom.shouldExclude('app.ts')).toBe(false);
    });

    it('respects custom exclude patterns', () => {
      const custom = new FileFilter({ excludePatterns: ['^vendor/', '\\.min\\.js$'] });
      expect(custom.shouldExclude('vendor/lib.js')).toBe(true);
      expect(custom.shouldExclude('dist/app.min.js')).toBe(true);
      expect(custom.shouldExclude('src/app.js')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // shouldExclude — edge cases
  // -----------------------------------------------------------------------

  describe('shouldExclude — edge cases', () => {
    it('handles files with no extension', () => {
      expect(filter.shouldExclude('Makefile')).toBe(false);
      expect(filter.shouldExclude('Dockerfile')).toBe(false);
      expect(filter.shouldExclude('LICENSE')).toBe(false);
    });

    it('handles dotfiles', () => {
      expect(filter.shouldExclude('.eslintrc')).toBe(false);
      expect(filter.shouldExclude('.prettierrc')).toBe(false);
      expect(filter.shouldExclude('.DS_Store')).toBe(true);
    });

    it('handles very long paths', () => {
      const longPath = 'a/'.repeat(50) + 'file.ts';
      expect(filter.shouldExclude(longPath)).toBe(false);
    });

    it('handles paths with special characters', () => {
      expect(filter.shouldExclude('src/my-component.tsx')).toBe(false);
      expect(filter.shouldExclude('src/my_util.ts')).toBe(false);
      expect(filter.shouldExclude('src/@types/custom.d.ts')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isHeaderGenerated
  // -----------------------------------------------------------------------

  describe('isHeaderGenerated', () => {
    it.each([
      '// Generated by protocol buffer compiler',
      '/* Generated file - do not edit */',
      '# Generated by Django',
      '// DO NOT EDIT - auto generated',
      '// Auto-generated by codegen',
      '// This file is generated by the build system',
      '// Code generated by protoc-gen-go',
      '// Automatically generated. Do not modify.',
    ])('detects generated marker: %s', (header) => {
      expect(filter.isHeaderGenerated(header)).toBe(true);
    });

    it('does not flag normal file headers', () => {
      expect(filter.isHeaderGenerated('// Copyright 2024 Acme Inc.')).toBe(false);
      expect(filter.isHeaderGenerated('import express from "express";')).toBe(false);
      expect(filter.isHeaderGenerated('# My Python module')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // classifyFile
  // -----------------------------------------------------------------------

  describe('classifyFile — source files', () => {
    it.each([
      'src/index.ts',
      'src/components/App.tsx',
      'lib/utils.py',
      'main.go',
      'src/server.rs',
      'app/Main.java',
      'src/auth/login.rb',
      'src/handler.php',
      'src/App.vue',
      'src/Page.svelte',
      'README.md',
      'docs/guide.mdx',
      'styles/main.css',
      'styles/theme.scss',
      'templates/index.html',
    ])('classifies %s as source', (path) => {
      expect(filter.classifyFile(path)).toBe('source');
    });
  });

  describe('classifyFile — config files', () => {
    it.each([
      'package.json',
      'tsconfig.json',
      '.eslintrc.json',
      '.prettierrc',
      'jest.config.js',
      'vite.config.ts',
      'webpack.config.js',
      '.env.example',
      '.editorconfig',
      '.gitignore',
      '.npmrc',
      '.nvmrc',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'Gemfile',
      'Makefile',
      'setup.cfg',
      'pnpm-workspace.yaml',
      'nx.json',
      'turbo.json',
    ])('classifies %s as config', (path) => {
      expect(filter.classifyFile(path)).toBe('config');
    });
  });

  describe('classifyFile — schema files', () => {
    it.each([
      'prisma/schema.prisma',
      'schema.graphql',
      'src/api.gql',
      'db/migrations/001_create_users.ts',
      'migrations/20240101_init.sql',
      'db/init.sql',
      'database/seed.sql',
      'schema/models.ts',
      'schemas/user.ts',
    ])('classifies %s as schema', (path) => {
      expect(filter.classifyFile(path)).toBe('schema');
    });
  });

  describe('classifyFile — infra files', () => {
    it.each([
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'docker-compose.override.yml',
      '.dockerignore',
      'infra/main.tf',
      'terraform/variables.tf',
      'k8s/deployment.yaml',
      'kubernetes/service.yaml',
      'helm/Chart.yaml',
      'deploy/app.yaml',
      'Procfile',
      'fly.toml',
      'vercel.json',
      'netlify.toml',
    ])('classifies %s as infra', (path) => {
      expect(filter.classifyFile(path)).toBe('infra');
    });
  });

  describe('classifyFile — CI files', () => {
    it.each([
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yaml',
      '.github/dependabot.yml',
      '.gitlab-ci.yml',
      '.travis.yml',
      'Jenkinsfile',
      'azure-pipelines.yml',
      'bitbucket-pipelines.yml',
      '.circleci/config.yml',
    ])('classifies %s as ci', (path) => {
      expect(filter.classifyFile(path)).toBe('ci');
    });

    it('does NOT classify files with CI dir substring in unrelated paths', () => {
      // Regression: "src/my-.gitlab-theme/colors.ts" should not be CI
      expect(filter.classifyFile('src/my-.gitlab-theme/colors.ts')).toBe('source');
      expect(filter.classifyFile('src/.github-utils/helper.ts')).toBe('source');
    });
  });

  describe('classifyFile — root YAML/JSON heuristic', () => {
    it('classifies root-level YAML/JSON as config', () => {
      expect(filter.classifyFile('settings.yml')).toBe('config');
      expect(filter.classifyFile('config.yaml')).toBe('config');
    });

    it('does NOT classify nested YAML as root config', () => {
      // Regression: "config/settings.yml" should not match root heuristic
      // It falls through to the deeper YAML/JSON → config rule anyway,
      // but the root heuristic specifically should not match
      expect(filter.classifyFile('config/settings.yml')).toBe('config');
      expect(filter.classifyFile('src/data/items.json')).toBe('config');
    });
  });

  describe('classifyFile — test files', () => {
    it.each([
      'src/utils.test.ts',
      'src/App.spec.tsx',
      'src/handler.test.js',
      'login.e2e.ts',
      'handler_test.go',
      'test_handler.py',
      '__tests__/App.test.tsx',
      'tests/unit/auth.test.ts',
      'spec/models/user.spec.ts',
      'e2e/login.test.ts',
      'cypress/integration/login.js',
      'playwright/tests/home.spec.ts',
      'src/__mocks__/api.ts',
      'test/fixtures/sample.json',
      'src/Component.stories.tsx',
    ])('classifies %s as test', (path) => {
      expect(filter.classifyFile(path)).toBe('test');
    });
  });

  // -----------------------------------------------------------------------
  // detectLanguage
  // -----------------------------------------------------------------------

  describe('detectLanguage', () => {
    it.each([
      ['src/index.ts', 'typescript'],
      ['src/App.tsx', 'typescript'],
      ['lib/utils.js', 'javascript'],
      ['lib/utils.mjs', 'javascript'],
      ['script.py', 'python'],
      ['main.go', 'go'],
      ['lib.rs', 'rust'],
      ['App.java', 'java'],
      ['styles.css', 'css'],
      ['styles.scss', 'scss'],
      ['page.html', 'html'],
      ['data.json', 'json'],
      ['config.yaml', 'yaml'],
      ['config.yml', 'yaml'],
      ['schema.prisma', 'prisma'],
      ['query.graphql', 'graphql'],
      ['deploy.tf', 'terraform'],
      ['script.sh', 'shell'],
      ['README.md', 'markdown'],
      ['App.vue', 'vue'],
      ['Page.svelte', 'svelte'],
    ] as [string, string][])('detects %s as %s', (path, expected) => {
      expect(filter.detectLanguage(path)).toBe(expected);
    });

    it('returns null for unknown extensions', () => {
      expect(filter.detectLanguage('data.xyz')).toBeNull();
      expect(filter.detectLanguage('Makefile')).toBeNull();
      expect(filter.detectLanguage('LICENSE')).toBeNull();
    });
  });
});

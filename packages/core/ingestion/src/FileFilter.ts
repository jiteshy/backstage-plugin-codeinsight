import { basename, dirname, extname } from 'path';

import type { FileType } from '@codeinsight/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FileFilterConfig {
  excludeDirs?: string[];
  excludeExtensions?: string[];
  excludePatterns?: string[];
}

// ---------------------------------------------------------------------------
// Default exclusion lists
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'vendor',
  '.git',
  '.yarn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.tox',
  'target',
  '.cache',
  '.parcel-cache',
  '.turbo',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
  'venv',
  '.venv',
  'env',
  '.env',
  'bower_components',
]);

const DEFAULT_EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set([
  // Lock files
  '.lock',
  // Binaries / media
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.bmp',
  '.webp',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.wav',
  '.ogg',
  '.webm',
  // Fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  // Compiled / object files
  '.o',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.class',
  '.pyc',
  '.pyo',
  '.wasm',
  // Database
  '.sqlite',
  '.sqlite3',
  '.db',
  // IDE / build artifacts
  '.tsbuildinfo',
  '.map',
  // PDF / docs
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

const EXCLUDED_FILENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'poetry.lock',
  'go.sum',
  'cargo.lock',
  'Cargo.lock',
  '.DS_Store',
  'Thumbs.db',
  '.gitattributes',
]);

// Matches filenames like bundle.min.js, vendor.min.css, app.min.mjs
const MINIFIED_FILENAME_RE = /\.min\.[a-z]+$/i;

// Average line length above this threshold strongly suggests minified content
const MINIFIED_AVG_LINE_LENGTH = 500;

const GENERATED_MARKERS: readonly string[] = [
  '// generated',
  '/* generated',
  '# generated',
  '// do not edit',
  '/* do not edit',
  '# do not edit',
  '// auto-generated',
  '/* auto-generated',
  '# auto-generated',
  '// this file is generated',
  '// code generated',
  '// automatically generated',
];

// ---------------------------------------------------------------------------
// File classification rules
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.rb',
  '.php',
  '.c',
  '.cpp',
  '.cc',
  '.h',
  '.hpp',
  '.cs',
  '.swift',
  '.m',
  '.mm',
  '.r',
  '.R',
  '.lua',
  '.pl',
  '.pm',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.dart',
  '.elm',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.vue',
  '.svelte',
]);

const CONFIG_FILENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  '.babelrc',
  '.babelrc.js',
  'babel.config.js',
  'babel.config.json',
  'webpack.config.js',
  'webpack.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'rollup.config.js',
  'rollup.config.ts',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.editorconfig',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
  'Makefile',
  'CMakeLists.txt',
  'setup.py',
  'setup.cfg',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'Rakefile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'nx.json',
  'turbo.json',
  'lerna.json',
  'pnpm-workspace.yaml',
  'rush.json',
]);

const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set([
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
]);

const SCHEMA_EXTENSIONS: ReadonlySet<string> = new Set([
  '.prisma',
  '.graphql',
  '.gql',
]);

const SCHEMA_DIR_PATTERNS: readonly string[] = [
  'migrations',
  'migrate',
  'schema',
  'schemas',
  'db',
  'database',
];

const INFRA_FILENAMES: ReadonlySet<string> = new Set([
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'docker-compose.override.yml',
  '.dockerignore',
  'Vagrantfile',
  'Procfile',
  'fly.toml',
  'render.yaml',
  'app.yaml',
  'vercel.json',
  'netlify.toml',
  'now.json',
]);

const INFRA_EXTENSIONS: ReadonlySet<string> = new Set([
  '.tf',
  '.hcl',
]);

const CI_PATTERNS: readonly { dir: string; file?: string }[] = [
  { dir: '.github/workflows' },
  { dir: '.github', file: 'dependabot.yml' },
  { dir: '.github', file: 'dependabot.yaml' },
  { dir: '.circleci' },
  { dir: '.gitlab' },
];

const CI_FILENAMES: ReadonlySet<string> = new Set([
  '.gitlab-ci.yml',
  '.travis.yml',
  'Jenkinsfile',
  'azure-pipelines.yml',
  'cloudbuild.yaml',
  'cloudbuild.yml',
  'bitbucket-pipelines.yml',
  '.github-ci.yml',
  'buildspec.yml',
  'appveyor.yml',
  'codecov.yml',
]);

const TEST_DIR_PATTERNS: readonly string[] = [
  '__tests__',
  '__test__',
  'test',
  'tests',
  'spec',
  'specs',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  'e2e',
  'cypress',
  'playwright',
];

const TEST_FILE_PATTERNS: readonly RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.e2e\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /test_.*\.py$/,
  /\.stories\.[jt]sx?$/,
];

// K8s patterns
const K8S_DIR_PATTERNS: readonly string[] = [
  'k8s',
  'kubernetes',
  'helm',
  'charts',
  'kustomize',
  'deploy',
  'deployment',
  'manifests',
];

// ---------------------------------------------------------------------------
// Extension → language mapping
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-cpp',
  '.r': 'r',
  '.R': 'r',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.dart': 'dart',
  '.elm': 'elm',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.clj': 'clojure',
  '.cljs': 'clojurescript',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.styl': 'stylus',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.rst': 'restructuredtext',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.prisma': 'prisma',
  '.proto': 'protobuf',
  '.tf': 'terraform',
  '.hcl': 'hcl',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.json': 'json',
  '.xml': 'xml',
  '.toml': 'toml',
  '.ini': 'ini',
};

// ---------------------------------------------------------------------------
// FileFilter class
// ---------------------------------------------------------------------------

export class FileFilter {
  private readonly excludedDirs: Set<string>;
  private readonly excludedExtensions: Set<string>;
  private readonly excludePatterns: RegExp[];

  constructor(config?: FileFilterConfig) {
    this.excludedDirs = new Set([
      ...DEFAULT_EXCLUDED_DIRS,
      ...(config?.excludeDirs ?? []),
    ]);
    this.excludedExtensions = new Set([
      ...DEFAULT_EXCLUDED_EXTENSIONS,
      ...(config?.excludeExtensions ?? []),
    ]);
    this.excludePatterns = (config?.excludePatterns ?? []).map(p => new RegExp(p));
  }

  /**
   * Returns true if the file should be excluded from processing.
   * Does NOT perform header-based checks (use `isHeaderGenerated` separately
   * when file content is available).
   */
  shouldExclude(filePath: string): boolean {
    const fileName = basename(filePath);

    // Excluded filenames
    if (EXCLUDED_FILENAMES.has(fileName)) {
      return true;
    }

    // Minified filename pattern (e.g. bundle.min.js, vendor.min.css)
    if (MINIFIED_FILENAME_RE.test(fileName)) {
      return true;
    }

    // Excluded extensions
    const ext = extname(fileName).toLowerCase();
    if (this.excludedExtensions.has(ext)) {
      return true;
    }

    // Excluded directory at any depth
    const parts = filePath.split('/');
    for (const part of parts) {
      if (this.excludedDirs.has(part)) {
        return true;
      }
    }

    // Custom exclude patterns
    for (const pattern of this.excludePatterns) {
      if (pattern.test(filePath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if the first few lines of file content contain generated-file markers.
   * Pass the first 5 lines of the file (or the full content for small files).
   */
  isHeaderGenerated(headerLines: string): boolean {
    const lower = headerLines.toLowerCase();
    return GENERATED_MARKERS.some(marker => lower.includes(marker));
  }

  /**
   * Returns true if the file content looks minified (very long average line length).
   * Call this after reading file content to catch bundled/minified files that
   * slip through path-based filters (e.g. a .cjs bundle in a non-standard dir).
   */
  isMinified(content: string): boolean {
    const lines = content.split('\n');
    const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
    const avgLineLength = totalChars / (lines.length || 1);
    return avgLineLength > MINIFIED_AVG_LINE_LENGTH;
  }

  /**
   * Classifies a file path into a FileType category.
   */
  classifyFile(filePath: string): FileType {
    const fileName = basename(filePath);
    const ext = extname(fileName).toLowerCase();
    const dir = dirname(filePath);
    const parts = filePath.split('/');

    // CI detection — check first (directory-based patterns)
    for (const pattern of CI_PATTERNS) {
      if (filePath.startsWith(pattern.dir + '/') || filePath === pattern.dir) {
        if (!pattern.file || fileName === pattern.file) {
          return 'ci';
        }
      }
    }
    if (CI_FILENAMES.has(fileName)) {
      return 'ci';
    }

    // Test detection — check before source
    for (const pattern of TEST_FILE_PATTERNS) {
      if (pattern.test(fileName)) {
        return 'test';
      }
    }
    for (const dirPattern of TEST_DIR_PATTERNS) {
      if (parts.includes(dirPattern)) {
        return 'test';
      }
    }

    // Schema detection
    if (SCHEMA_EXTENSIONS.has(ext)) {
      return 'schema';
    }
    for (const schemaDir of SCHEMA_DIR_PATTERNS) {
      if (parts.includes(schemaDir)) {
        return 'schema';
      }
    }

    // Infrastructure detection
    if (INFRA_FILENAMES.has(fileName)) {
      return 'infra';
    }
    if (INFRA_EXTENSIONS.has(ext)) {
      return 'infra';
    }
    for (const k8sDir of K8S_DIR_PATTERNS) {
      if (parts.includes(k8sDir)) {
        return 'infra';
      }
    }

    // Config detection
    if (CONFIG_FILENAMES.has(fileName)) {
      return 'config';
    }
    if (CONFIG_EXTENSIONS.has(ext)) {
      return 'config';
    }
    // YAML/JSON in root are usually config
    if ((ext === '.yml' || ext === '.yaml' || ext === '.json') && (dir === '.' || dir === '')) {
      return 'config';
    }

    // Source detection
    if (SOURCE_EXTENSIONS.has(ext)) {
      return 'source';
    }

    // Markdown / docs treated as source (they contain documentation-relevant content)
    if (ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.txt') {
      return 'source';
    }

    // HTML / CSS / SCSS / LESS — source
    if (ext === '.html' || ext === '.htm' || ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less' || ext === '.styl') {
      return 'source';
    }

    // YAML/JSON deeper in tree — likely config
    if (ext === '.yml' || ext === '.yaml' || ext === '.json') {
      return 'config';
    }

    // Unknown — default to source
    return 'source';
  }

  /**
   * Determines the programming language from file extension.
   * Returns null if language cannot be determined.
   */
  detectLanguage(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] ?? null;
  }
}

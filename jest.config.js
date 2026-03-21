/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
  moduleNameMapper: {
    '^@codeinsight/types$': '<rootDir>/packages/core/types/src',
    '^@codeinsight/cig$': '<rootDir>/packages/core/cig/src',
    '^@codeinsight/ingestion$': '<rootDir>/packages/core/ingestion/src',
    '^@codeinsight/doc-generator$': '<rootDir>/packages/core/doc-generator/src',
    '^@codeinsight/diagram-gen$': '<rootDir>/packages/core/diagram-gen/src',
    '^@codeinsight/qna$': '<rootDir>/packages/core/qna/src',
    '^@codeinsight/storage$': '<rootDir>/packages/adapters/storage/src',
    '^@codeinsight/repo$': '<rootDir>/packages/adapters/repo/src',
    '^@codeinsight/llm$': '<rootDir>/packages/adapters/llm/src',
    '^@codeinsight/embeddings$': '<rootDir>/packages/adapters/embeddings/src',
    '^@codeinsight/vector-store$': '<rootDir>/packages/adapters/vector-store/src',
  },
  collectCoverageFrom: [
    'packages/**/src/**/*.ts',
    'packages/**/src/**/*.tsx',
    '!packages/**/src/**/index.ts',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Extend from the root tsconfig but add JSX and DOM lib support needed
          // for React component tests in packages/backstage/plugin/
          jsx: 'react-jsx',
          lib: ['ES2021', 'DOM', 'DOM.Iterable'],
          // Relax strictness for test files where unused vars are common
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
      },
    ],
  },
};

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
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
    '!packages/**/src/**/index.ts',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
};

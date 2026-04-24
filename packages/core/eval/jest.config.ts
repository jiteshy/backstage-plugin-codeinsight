import path from 'path';

import type { Config } from 'jest';

const root = path.resolve(__dirname, '../../..');

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@codeinsight/types$': `${root}/packages/core/types/src`,
    '^@codeinsight/llm$': `${root}/packages/adapters/llm/src`,
    '^@codeinsight/composition$': `${root}/packages/composition/src`,
    '^@codeinsight/chunking$': `${root}/packages/core/chunking/src`,
    '^@codeinsight/cig$': `${root}/packages/core/cig/src`,
    '^@codeinsight/diagram-gen$': `${root}/packages/core/diagram-gen/src`,
    '^@codeinsight/doc-generator$': `${root}/packages/core/doc-generator/src`,
    '^@codeinsight/embeddings$': `${root}/packages/adapters/embeddings/src`,
    '^@codeinsight/indexing$': `${root}/packages/core/indexing/src`,
    '^@codeinsight/ingestion$': `${root}/packages/core/ingestion/src`,
    '^@codeinsight/qna$': `${root}/packages/core/qna/src`,
    '^@codeinsight/repo$': `${root}/packages/adapters/repo/src`,
    '^@codeinsight/storage$': `${root}/packages/adapters/storage/src`,
    '^@codeinsight/vector-store$': `${root}/packages/adapters/vector-store/src`,
  },
};

export default config;

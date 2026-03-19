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
  },
};

export default config;

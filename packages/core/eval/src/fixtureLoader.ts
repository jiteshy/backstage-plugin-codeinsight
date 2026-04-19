import { readFile } from 'fs/promises';
import { basename, join } from 'path';

import type {
  ExpectedArchitecture,
  ExpectedDiagrams,
  ExpectedOverview,
  QaPair,
  RepoFixture,
  RepoFixtureMeta,
} from './types';

const REQUIRED_FILES = [
  'repo.json',
  'expected-overview.json',
  'expected-architecture.json',
  'expected-diagrams.json',
  'qa-pairs.json',
] as const;

export async function loadFixture(fixtureDir: string): Promise<RepoFixture> {
  const slug = basename(fixtureDir);

  const contents: Record<string, unknown> = {};
  for (const file of REQUIRED_FILES) {
    const path = join(fixtureDir, file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      throw new Error(
        `Fixture ${slug}: missing required file ${file} at ${path}`,
      );
    }
    try {
      contents[file] = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Fixture ${slug}: ${file} is not valid JSON: ${String(err)}`);
    }
  }

  const metaRaw = contents['repo.json'] as Partial<RepoFixtureMeta>;
  requireString(slug, 'repo.json', 'gitUrl', metaRaw.gitUrl);
  requireString(slug, 'repo.json', 'commitSha', metaRaw.commitSha);
  requireString(slug, 'repo.json', 'description', metaRaw.description);
  requireString(slug, 'repo.json', 'sizeCategory', metaRaw.sizeCategory);
  if (typeof metaRaw.fileCountApprox !== 'number') {
    throw new Error(`Fixture ${slug}: repo.json: fileCountApprox must be a number`);
  }

  const meta: RepoFixtureMeta = {
    slug,
    gitUrl: metaRaw.gitUrl!,
    commitSha: metaRaw.commitSha!,
    description: metaRaw.description!,
    sizeCategory: metaRaw.sizeCategory as RepoFixtureMeta['sizeCategory'],
    fileCountApprox: metaRaw.fileCountApprox,
  };

  return {
    meta,
    expectedOverview: contents['expected-overview.json'] as ExpectedOverview,
    expectedArchitecture: contents['expected-architecture.json'] as ExpectedArchitecture,
    expectedDiagrams: contents['expected-diagrams.json'] as ExpectedDiagrams,
    qaPairs: contents['qa-pairs.json'] as QaPair[],
  };
}

function requireString(slug: string, file: string, field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Fixture ${slug}: ${file}: ${field} is required and must be a non-empty string`);
  }
}

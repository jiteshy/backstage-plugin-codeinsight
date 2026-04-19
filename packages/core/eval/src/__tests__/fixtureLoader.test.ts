import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadFixture } from '../fixtureLoader';

async function writeJson(path: string, obj: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
}

describe('loadFixture', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eval-fixture-'));
    await mkdir(join(tmp, 'small'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads a well-formed fixture', async () => {
    const dir = join(tmp, 'small');
    await writeJson(join(dir, 'repo.json'), {
      gitUrl: 'https://github.com/example/small.git',
      commitSha: 'abc123',
      description: 'A tiny service',
      sizeCategory: 'small',
      fileCountApprox: 40,
    });
    await writeJson(join(dir, 'expected-overview.json'), {
      bullets: ['Does thing A', 'Uses lib B'],
    });
    await writeJson(join(dir, 'expected-architecture.json'), {
      subsystems: [{ name: 'Core', mustMentionFiles: ['src/index.ts'] }],
      externalDependencies: ['express'],
    });
    await writeJson(join(dir, 'expected-diagrams.json'), {
      systemArchitecture: { mustContainLabels: ['API'], mustContainEdges: [] },
      dataModel: null,
      keyFlows: [],
    });
    await writeJson(join(dir, 'qa-pairs.json'), [
      {
        question: 'What is this?',
        expectedFiles: ['src/index.ts'],
        mustIncludeFacts: ['it does thing A'],
        shouldNotHallucinate: [],
      },
    ]);

    const fixture = await loadFixture(dir);

    expect(fixture.meta.slug).toBe('small');
    expect(fixture.meta.gitUrl).toBe('https://github.com/example/small.git');
    expect(fixture.expectedOverview.bullets).toHaveLength(2);
    expect(fixture.qaPairs).toHaveLength(1);
  });

  it('throws a clear error when a required file is missing', async () => {
    const dir = join(tmp, 'small');
    await writeJson(join(dir, 'repo.json'), {
      gitUrl: 'https://x', commitSha: 's', description: 'd',
      sizeCategory: 'small', fileCountApprox: 1,
    });

    await expect(loadFixture(dir)).rejects.toThrow(
      /expected-overview\.json/,
    );
  });

  it('throws when repo.json fields are missing', async () => {
    const dir = join(tmp, 'small');
    await writeJson(join(dir, 'repo.json'), { gitUrl: 'x' });
    await writeJson(join(dir, 'expected-overview.json'), { bullets: [] });
    await writeJson(join(dir, 'expected-architecture.json'), { subsystems: [], externalDependencies: [] });
    await writeJson(join(dir, 'expected-diagrams.json'), {
      systemArchitecture: { mustContainLabels: [], mustContainEdges: [] },
      dataModel: null, keyFlows: [],
    });
    await writeJson(join(dir, 'qa-pairs.json'), []);

    await expect(loadFixture(dir)).rejects.toThrow(/commitSha/);
  });
});

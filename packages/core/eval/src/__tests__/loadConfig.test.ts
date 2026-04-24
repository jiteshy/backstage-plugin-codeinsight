import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { loadEvalConfig } from '../adapters/loadConfig';

describe('loadEvalConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loadcfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses a minimal eval.config.yaml into composition + db', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(
      yamlPath,
      [
        'db:',
        '  host: localhost',
        '  port: 5433',
        '  user: codeinsight',
        '  password: codeinsight',
        '  database: backstage_plugin_codeinsight',
        'llm:',
        '  provider: anthropic',
        '  apiKey: sk-ant-test',
        '  model: claude-opus-4-7',
        'embeddings:',
        '  provider: openai',
        '  apiKey: sk-openai-test',
        '  model: text-embedding-3-small',
        'cloneTempDir: /tmp/eval',
        '',
      ].join('\n'),
    );

    const { composition, db } = loadEvalConfig(yamlPath);

    expect(db.host).toBe('localhost');
    expect(db.port).toBe(5433);
    expect(db.database).toBe('backstage_plugin_codeinsight');
    expect(composition.repoClone.tempDir).toBe('/tmp/eval');
    expect(composition.llm?.provider).toBe('anthropic');
    expect(composition.llm?.model).toBe('claude-opus-4-7');
    expect(composition.embedding?.model).toBe('text-embedding-3-small');
    expect(composition.qna.maxHistoryTurns).toBe(6);
    expect(composition.docGen.maxConcurrency).toBe(20);
  });

  it('throws a clear error when db block is missing', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(
      yamlPath,
      'llm:\n  provider: anthropic\n  apiKey: x\n  model: y\n',
    );
    expect(() => loadEvalConfig(yamlPath)).toThrow(/db/);
  });

  it('throws when the file is empty', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(yamlPath, '');
    expect(() => loadEvalConfig(yamlPath)).toThrow(/Empty|db/);
  });

  it('leaves llm/embedding undefined if either block is incomplete', () => {
    const yamlPath = join(dir, 'eval.config.yaml');
    writeFileSync(
      yamlPath,
      [
        'db:',
        '  host: localhost',
        '  database: mydb',
        'llm:',
        '  provider: anthropic',
        '  apiKey: x',
        // model missing
        '',
      ].join('\n'),
    );

    const { composition } = loadEvalConfig(yamlPath);
    expect(composition.llm).toBeUndefined();
    expect(composition.embedding).toBeUndefined();
  });
});

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { scanForMergeOperations } from '../../src/core/file-scanner';
import { performMerge, performAllMerges } from '../../src/core/merger';
import { getMachineName } from '../../src/core/machine-detector';

describe('merge integration', () => {
  let repo: TestRepo;
  const machineName = getMachineName();

  beforeEach(async () => {
    repo = new TestRepo('merge-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  test('should merge JSON files when both base and machine exist', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1, b: 2 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 3, c: 4 }, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);

    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ a: 1, b: 3, c: 4 });
  });

  test('should use machine file when base missing', async () => {
    await createTestFiles(repo, {
      [`config.${machineName}.json`]: JSON.stringify({ x: 1 }, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    const result = await performMerge(operations[0]);

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);

    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ x: 1 });
  });

  test('should use base file when machine missing', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ y: 2 }, null, 2),
    });

    // Scanner now finds base-only files
    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);
    expect(operations[0].basePath).toContain('config.base.json');
    expect(operations[0].outputPath).toContain('config.json');
    
    // Perform the merge
    const results = await performAllMerges(operations);
    expect(results[0].success).toBe(true);
    
    // Verify output
    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ y: 2 });
  });

  test('should skip when both files missing', async () => {
    const operation = {
      basePath: repo.path + '/config.base.json',
      machinePath: repo.path + `/config.${machineName}.json`,
      outputPath: repo.path + '/config.json',
      type: 'json' as const,
    };

    const result = await performMerge(operation);
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);

    const exists = await repo.fileExists('config.json');
    expect(exists).toBe(false);
  });

  test('should merge ENV files', async () => {
    await createTestFiles(repo, {
      '.env.base': 'KEY1=base1\nKEY2=base2\n',
      [`.env.${machineName}`]: 'KEY2=machine2\nKEY3=machine3\n',
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);

    const output = await repo.readFile('.env');
    expect(output).toContain('KEY1=base1');
    expect(output).toContain('KEY2=machine2'); // Machine overrides
    expect(output).toContain('KEY3=machine3');
  });

  test('should not write if output unchanged', async () => {
    const expectedOutput = JSON.stringify({ a: 1, b: 3, c: 4 }, null, 2) + '\n';

    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1, b: 2 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 3, c: 4 }, null, 2),
      'config.json': expectedOutput,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    const result = await performMerge(operations[0]);

    expect(result.success).toBe(true);
    expect(result.changed).toBe(false); // No change
  });

  test('should handle multiple files', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ a: 2 }, null, 2),
      '.env.base': 'KEY1=value1\n',
      [`.env.${machineName}`]: 'KEY2=value2\n',
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(2);

    const results = await performAllMerges(operations);
    expect(results.every(r => r.success)).toBe(true);

    expect(await repo.fileExists('config.json')).toBe(true);
    expect(await repo.fileExists('.env')).toBe(true);
  });

  test('should handle deep nested merges', async () => {
    const base = {
      server: { host: 'localhost', port: 3000 },
      database: { host: 'localhost', user: 'admin' },
    };
    const machine = {
      server: { port: 8080 },
      database: { password: 'secret' },
    };

    await createTestFiles(repo, {
      'config.base.json': JSON.stringify(base, null, 2),
      [`config.${machineName}.json`]: JSON.stringify(machine, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    await performMerge(operations[0]);

    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);

    expect(parsed).toEqual({
      server: { host: 'localhost', port: 8080 },
      database: { host: 'localhost', user: 'admin', password: 'secret' },
    });
  });

  test('should handle files in subdirectories', async () => {
    await createTestFiles(repo, {
      'configs/app.base.json': JSON.stringify({ app: 'base' }, null, 2),
      [`configs/app.${machineName}.json`]: JSON.stringify({ app: 'machine' }, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    await performMerge(operations[0]);
    expect(await repo.fileExists('configs/app.json')).toBe(true);
  });

  test('should merge primitive arrays with deduplication', async () => {
    const base = {
      plugins: ['plugin-a', 'plugin-b'],
      ports: [3000, 3001],
    };
    const machine = {
      plugins: ['plugin-c', 'plugin-a'], // 'plugin-a' is duplicate
      ports: [3002],
    };

    await createTestFiles(repo, {
      'config.base.json': JSON.stringify(base, null, 2),
      [`config.${machineName}.json`]: JSON.stringify(machine, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    await performMerge(operations[0]);

    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);

    expect(parsed).toEqual({
      plugins: ['plugin-a', 'plugin-b', 'plugin-c'], // Merged, deduped, base order preserved
      ports: [3000, 3001, 3002],
    });
  });

  test('should merge nested object arrays', async () => {
    const base = {
      config: {
        mcp: { servers: ['server-a', 'server-b'] },
      },
    };
    const machine = {
      config: {
        mcp: { servers: ['server-c', 'server-a'] },
      },
    };

    await createTestFiles(repo, {
      'settings.base.json': JSON.stringify(base, null, 2),
      [`settings.${machineName}.json`]: JSON.stringify(machine, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    await performMerge(operations[0]);

    const output = await repo.readFile('settings.json');
    const parsed = JSON.parse(output);

    expect(parsed).toEqual({
      config: {
        mcp: { servers: ['server-a', 'server-b', 'server-c'] },
      },
    });
  });

  test('should error when merging arrays with non-primitive values', async () => {
    const base = {
      items: [{ name: 'a' }],
    };
    const machine = {
      items: [{ name: 'b' }],
    };

    await createTestFiles(repo, {
      'config.base.json': JSON.stringify(base, null, 2),
      [`config.${machineName}.json`]: JSON.stringify(machine, null, 2),
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    const result = await performMerge(operations[0]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Cannot merge arrays containing non-primitive values');
  });

  test('should merge JSONC files and output JSON', async () => {
    const basejsonc = `{
      // Base configuration
      "port": 3000,
      "host": "localhost"
    }`;
    
    const machineJsonc = `{
      // Machine override
      "port": 8080,
    }`;
    
    await createTestFiles(repo, {
      'config.base.jsonc': basejsonc,
      [`config.{machine=${machineName}}.jsonc`]: machineJsonc,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);
    expect(operations[0].outputPath).toContain('config.json'); // Should output .json, not .jsonc

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);

    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ port: 8080, host: 'localhost' });
    
    // Verify it's clean JSON without comments
    expect(output).not.toContain('//');
    expect(output).not.toContain('Base configuration');
  });
});

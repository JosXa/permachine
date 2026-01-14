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

  test('should merge markdown files by appending content', async () => {
    const baseContent = '# README\n\nShared documentation.';
    const machineContent = '## Local Setup\n\nRun locally.';

    await createTestFiles(repo, {
      'README.base.md': baseContent,
      [`README.${machineName}.md`]: machineContent,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);

    const output = await repo.readFile('README.md');
    expect(output).toContain(baseContent);
    expect(output).toContain(machineContent);
    expect(output).toMatch(/Shared documentation\.\n\n## Local Setup/);
  });

  test('should use base markdown when machine missing', async () => {
    const baseContent = '# README\n\nOnly base content.';

    await createTestFiles(repo, {
      'README.base.md': baseContent,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);

    const output = await repo.readFile('README.md');
    expect(output).toContain(baseContent);
  });

  test('should use machine markdown when base missing', async () => {
    const machineContent = '# README\n\nOnly machine content.';

    await createTestFiles(repo, {
      [`README.${machineName}.md`]: machineContent,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);

    const output = await repo.readFile('README.md');
    expect(output).toContain(machineContent);
  });

  test('should handle markdown with new filter syntax', async () => {
    const baseContent = '# README\n\nBase content.';
    const machineContent = '## Machine Specific\n\nLocal config.';

    await createTestFiles(repo, {
      'README.base.md': baseContent,
      [`README.{machine=${machineName}}.md`]: machineContent,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    expect(operations.length).toBe(1);

    const result = await performMerge(operations[0]);
    expect(result.success).toBe(true);

    const output = await repo.readFile('README.md');
    expect(output).toContain(baseContent);
    expect(output).toContain(machineContent);
  });

  test('should handle markdown with complex formatting', async () => {
    const baseContent = `# Project Documentation

## Features
- Feature 1
- Feature 2

\`\`\`js
const code = true;
\`\`\`
`;

    const machineContent = `## Local Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

## Notes
- Local development notes
`;

    await createTestFiles(repo, {
      'README.base.md': baseContent,
      [`README.${machineName}.md`]: machineContent,
    });

    const operations = await scanForMergeOperations(machineName, repo.path);
    await performMerge(operations[0]);

    const output = await repo.readFile('README.md');
    expect(output).toContain('# Project Documentation');
    expect(output).toContain('- Feature 1\n- Feature 2');
    expect(output).toContain('const code = true');
    expect(output).toContain('## Local Setup');
    expect(output).toContain('npm install');
    expect(output).toContain('Local development notes');
  });
});

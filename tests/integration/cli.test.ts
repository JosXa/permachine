import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { getMachineName } from '../../src/core/machine-detector';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execAsync = promisify(exec);

describe('CLI --yes flag', () => {
  let repo: TestRepo;
  const machineName = getMachineName();
  const cliPath = path.resolve(__dirname, '../../dist/cli.js');

  beforeEach(async () => {
    repo = new TestRepo('cli-yes-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  test('merge --yes should skip confirmation for tracked files', async () => {
    // Create output file first and track it
    await createTestFiles(repo, {
      'test.json': JSON.stringify({ old: true }, null, 2),
    });
    await repo.commit('Add test.json');

    // Now create machine-specific files
    await createTestFiles(repo, {
      'test.base.json': JSON.stringify({ base: true }, null, 2),
      [`test.${machineName}.json`]: JSON.stringify({ machine: true }, null, 2),
    });

    // Run merge with --yes flag
    const { stdout, stderr } = await execAsync(`node "${cliPath}" merge --yes`, { cwd: repo.path });

    // Should not contain prompt text (this is the key test)
    expect(stdout).not.toContain('(y/N)');
    expect(stderr).not.toContain('(y/N)');

    // Should have merged successfully
    expect(stdout).toContain('Merged 1 file(s)');

    // Should have untracked the file since it was tracked
    expect(stdout).toContain('Removed test.json from git tracking');

    // Verify output file was updated
    const output = await repo.readFile('test.json');
    const parsed = JSON.parse(output);
    expect(parsed.machine).toBe(true);
  });

  test('merge -y should work as short flag', async () => {
    // Create machine-specific files
    await createTestFiles(repo, {
      'test.base.json': JSON.stringify({ base: true }, null, 2),
      [`test.${machineName}.json`]: JSON.stringify({ machine: true }, null, 2),
      'test.json': JSON.stringify({ old: true }, null, 2),
    });

    // Track the output file in git
    await repo.commit('Add test.json');

    // Run merge with -y flag
    const { stdout } = await execAsync(`node "${cliPath}" merge -y`, { cwd: repo.path });

    // Should not contain prompt text
    expect(stdout).not.toContain('(y/N)');

    // Should have merged successfully
    expect(stdout).toContain('Merged 1 file(s)');
  });

  test('merge without --yes should work for non-tracked files', async () => {
    // Create machine-specific files (output file not tracked)
    await createTestFiles(repo, {
      'test.base.json': JSON.stringify({ base: true }, null, 2),
      [`test.${machineName}.json`]: JSON.stringify({ machine: true }, null, 2),
    });

    await repo.commit('Add base and machine files');

    // Run merge without --yes flag
    const { stdout } = await execAsync(`node "${cliPath}" merge`, { cwd: repo.path });

    // Should not show warning or prompt (file not tracked)
    expect(stdout).not.toContain('Warning');
    expect(stdout).not.toContain('(y/N)');

    // Should have merged successfully
    expect(stdout).toContain('Merged 1 file(s)');
  });

  test('merge should create output from base file only when no machine-specific override exists', async () => {
    // Create only a base file, no machine-specific override
    const baseContent = { base: true, value: 42, name: 'test' };
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify(baseContent, null, 2),
    });

    await repo.commit('Add base file only');

    // Run merge
    const { stdout } = await execAsync(`node "${cliPath}" merge`, { cwd: repo.path });

    // Should have merged successfully
    expect(stdout).toContain('Merged 1 file(s)');

    // Should not show warning or prompt (file not tracked)
    expect(stdout).not.toContain('Warning');
    expect(stdout).not.toContain('(y/N)');

    // Verify output file was created with same content as base
    const output = await repo.readFile('config.json');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(baseContent);
    expect(parsed.base).toBe(true);
    expect(parsed.value).toBe(42);
    expect(parsed.name).toBe('test');
  });
});

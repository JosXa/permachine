import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { manageGitignore } from '../../src/core/gitignore-manager';
import path from 'node:path';

describe('gitignore manager', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = new TestRepo('gitignore-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  test('should create .gitignore if it does not exist', async () => {
    const outputPaths = [
      path.join(repo.path, 'config.json'),
      path.join(repo.path, '.env'),
    ];

    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual(['config.json', '.env']);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);

    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('config.json');
    expect(gitignore).toContain('.env');
  });

  test('should append to existing .gitignore', async () => {
    await createTestFiles(repo, {
      '.gitignore': 'node_modules/\n*.log\n',
    });

    const outputPaths = [path.join(repo.path, 'config.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual(['config.json']);

    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('*.log');
    expect(gitignore).toContain('config.json');
  });

  test('should not add duplicates to .gitignore', async () => {
    await createTestFiles(repo, {
      '.gitignore': 'config.json\n',
    });

    const outputPaths = [path.join(repo.path, 'config.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual([]);

    const gitignore = await repo.readFile('.gitignore');
    const lines = gitignore.split('\n');
    const configLines = lines.filter(l => l.trim() === 'config.json');
    expect(configLines.length).toBe(1); // Only one occurrence
  });

  test('should remove tracked files from git index', async () => {
    // Create and commit a file that will become ignored
    await createTestFiles(repo, {
      'config.json': JSON.stringify({ test: true }),
    });
    await repo.commit('Add config.json');

    // Verify it's tracked
    const { stdout: beforeStatus } = await repo.exec('git ls-files config.json');
    expect(beforeStatus.trim()).toBe('config.json');

    // Manage gitignore
    const outputPaths = [path.join(repo.path, 'config.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.removed).toEqual(['config.json']);

    // Verify it's no longer tracked
    try {
      await repo.exec('git ls-files --error-unmatch config.json');
      throw new Error('File should not be tracked');
    } catch (error: any) {
      expect(error.message).toContain('did not match any file');
    }

    // Verify .gitignore was created
    expect(result.added).toEqual(['config.json']);
  });

  test('should handle multiple files with mixed tracking states', async () => {
    // Create one tracked file and one untracked
    await createTestFiles(repo, {
      'config.json': JSON.stringify({ a: 1 }),
    });
    await repo.commit('Add config.json');

    await createTestFiles(repo, {
      '.env': 'API_KEY=secret',
    });

    // Manage both files
    const outputPaths = [
      path.join(repo.path, 'config.json'),
      path.join(repo.path, '.env'),
    ];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual(['config.json', '.env']);
    expect(result.removed).toEqual(['config.json']);

    // Verify .gitignore contains both
    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('config.json');
    expect(gitignore).toContain('.env');

    // Verify config.json is untracked
    try {
      await repo.exec('git ls-files --error-unmatch config.json');
      throw new Error('config.json should not be tracked');
    } catch (error: any) {
      expect(error.message).toContain('did not match any file');
    }
  });

  test('should handle nested paths correctly', async () => {
    // Create nested structure
    await createTestFiles(repo, {
      'config/settings.json': JSON.stringify({ nested: true }),
    });
    await repo.commit('Add nested config');

    const outputPaths = [path.join(repo.path, 'config/settings.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual(['config/settings.json']);
    expect(result.removed).toEqual(['config/settings.json']);

    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('config/settings.json');
  });

  test('should respect --no-gitignore flag', async () => {
    await createTestFiles(repo, {
      'config.json': JSON.stringify({ test: true }),
    });
    await repo.commit('Add config.json');

    const outputPaths = [path.join(repo.path, 'config.json')];
    const result = await manageGitignore(outputPaths, { noGitignore: true });

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);

    // Verify .gitignore was not created
    const exists = await repo.fileExists('.gitignore');
    expect(exists).toBe(false);

    // Verify file is still tracked
    const { stdout } = await repo.exec('git ls-files config.json');
    expect(stdout.trim()).toBe('config.json');
  });

  test('should handle files with spaces in names', async () => {
    await createTestFiles(repo, {
      'my config.json': JSON.stringify({ spaces: true }),
    });
    await repo.commit('Add config with spaces');

    const outputPaths = [path.join(repo.path, 'my config.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    expect(result.added).toEqual(['my config.json']);
    expect(result.removed).toEqual(['my config.json']);

    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('my config.json');
  });

  test('should normalize Windows paths to forward slashes', async () => {
    await createTestFiles(repo, {
      'config/app.json': JSON.stringify({ test: true }),
    });

    const outputPaths = [path.join(repo.path, 'config', 'app.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    const gitignore = await repo.readFile('.gitignore');
    // Should use forward slashes regardless of platform
    expect(gitignore).toContain('config/app.json');
  });

  test('should handle edge case: empty output paths array', async () => {
    const result = await manageGitignore([]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('should handle edge case: file deleted after tracking check', async () => {
    // This tests the race condition where a file exists during tracking check
    // but is deleted before git rm is called
    await createTestFiles(repo, {
      'config.json': JSON.stringify({ test: true }),
    });
    await repo.commit('Add config.json');
    
    // Delete the file using Node.js fs
    const fs = await import('node:fs/promises');
    await fs.unlink(path.join(repo.path, 'config.json'));

    const outputPaths = [path.join(repo.path, 'config.json')];
    const result = await manageGitignore(outputPaths, { cwd: repo.path });

    // Should still add to gitignore and attempt removal
    expect(result.added).toEqual(['config.json']);
    // May or may not succeed in removing (race condition)
    expect(result.errors.length).toBeLessThanOrEqual(1);
  });

  test('should preserve gitignore comments and formatting', async () => {
    const originalContent = `# Project ignores
node_modules/

# Build artifacts
dist/
*.log
`;
    await createTestFiles(repo, {
      '.gitignore': originalContent,
    });

    const outputPaths = [path.join(repo.path, 'config.json')];
    await manageGitignore(outputPaths, { cwd: repo.path });

    const gitignore = await repo.readFile('.gitignore');
    expect(gitignore).toContain('# Project ignores');
    expect(gitignore).toContain('# Build artifacts');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('config.json');
  });

  test('should handle multiple calls idempotently', async () => {
    const outputPaths = [path.join(repo.path, 'config.json')];

    // First call
    const result1 = await manageGitignore(outputPaths, { cwd: repo.path });
    expect(result1.added).toEqual(['config.json']);

    // Second call
    const result2 = await manageGitignore(outputPaths, { cwd: repo.path });
    expect(result2.added).toEqual([]); // Already added

    const gitignore = await repo.readFile('.gitignore');
    const lines = gitignore.split('\n');
    const configLines = lines.filter(l => l.trim() === 'config.json');
    expect(configLines.length).toBe(1); // Only one occurrence
  });
});

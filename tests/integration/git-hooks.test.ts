import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo } from '../helpers/test-repo';
import { installHooks, uninstallHooks } from '../../src/core/git-hooks';

describe('git-hooks integration', () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = new TestRepo('hooks-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  test('should install hooks via core.hooksPath', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      const result = await installHooks();

      expect(result.method).toBe('hooksPath');
      expect(result.hooksInstalled).toContain('post-checkout');
      expect(result.hooksInstalled).toContain('post-merge');
      expect(result.hooksInstalled).toContain('post-commit');

      // Check git config
      const hooksPath = await repo.getGitConfig('core.hooksPath');
      expect(hooksPath).toBe('.permachine/hooks');

      // Check hook files exist
      expect(await repo.fileExists('.permachine/hooks/post-checkout')).toBe(true);
      expect(await repo.fileExists('.permachine/hooks/post-merge')).toBe(true);
      expect(await repo.fileExists('.permachine/hooks/post-commit')).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  test('should install hooks in legacy mode', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      const result = await installHooks({ legacy: true });

      expect(result.method).toBe('legacy');
      expect(result.hooksInstalled.length).toBe(3);

      // Check hooks exist in .git/hooks
      expect(await repo.fileExists('.git/hooks/post-checkout')).toBe(true);
      expect(await repo.fileExists('.git/hooks/post-merge')).toBe(true);
      expect(await repo.fileExists('.git/hooks/post-commit')).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  test('should backup existing hooks in legacy mode', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      // Create a pre-existing hook
      await repo.writeFile('.git/hooks/post-commit', '#!/bin/sh\necho "original hook"\n');

      await installHooks({ legacy: true });

      // Original hook should be backed up
      expect(await repo.fileExists('.git/hooks/post-commit.pre-mcs')).toBe(true);
      
      // New hook should exist
      expect(await repo.fileExists('.git/hooks/post-commit')).toBe(true);

      // New hook should contain reference to backup
      const content = await repo.readFile('.git/hooks/post-commit');
      expect(content).toContain('post-commit.pre-mcs');
    } finally {
      process.chdir(cwd);
    }
  });

  test('should uninstall hooks (hooksPath method)', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      await installHooks();
      await uninstallHooks();

      // Config should be removed
      const hooksPath = await repo.getGitConfig('core.hooksPath');
      expect(hooksPath).toBeNull();

      // Hooks directory should be removed
      expect(await repo.fileExists('.permachine/hooks')).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });

  test('should uninstall and restore hooks (legacy method)', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      // Create original hook
      await repo.writeFile('.git/hooks/post-commit', '#!/bin/sh\necho "original"\n');
      
      // Install hooks
      await installHooks({ legacy: true });

      // Uninstall
      await uninstallHooks();

      // Original hook should be restored
      expect(await repo.fileExists('.git/hooks/post-commit')).toBe(true);
      const content = await repo.readFile('.git/hooks/post-commit');
      expect(content).toContain('original');

      // Backup should be removed
      expect(await repo.fileExists('.git/hooks/post-commit.pre-mcs')).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });

  test('should warn if core.hooksPath already set to different path', async () => {
    const cwd = process.cwd();
    process.chdir(repo.path);

    try {
      // Set a different hooksPath
      await repo.exec('git config core.hooksPath .husky');

      const result = await installHooks();

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('already set');
    } finally {
      process.chdir(cwd);
    }
  });
});

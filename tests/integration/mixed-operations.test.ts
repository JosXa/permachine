import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { scanAllOperations, scanForMergeOperations, scanForDirectoryOperations } from '../../src/core/file-scanner';
import { performMerge, performAllMerges } from '../../src/core/merger';
import { performDirectoryCopy, performAllDirectoryCopies } from '../../src/core/directory-copier';
import { getMachineName } from '../../src/core/machine-detector';
import { FileDirectoryConflictError } from '../../src/core/errors';

describe('mixed file and directory operations integration', () => {
  let repo: TestRepo;
  const machineName = getMachineName();

  beforeEach(async () => {
    repo = new TestRepo('mixed-operations-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  describe('scanAllOperations unified scanning', () => {
    test('should return both file and directory operations', async () => {
      await createTestFiles(repo, {
        // File merge operations
        'config.base.json': JSON.stringify({ a: 1 }),
        [`config.{machine=${machineName}}.json`]: JSON.stringify({ b: 2 }),
        '.env.base': 'KEY=value',
        // Directory copy operation
        [`myconfigs.{machine=${machineName}}/app.json`]: '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(2); // config.json and .env
      expect(result.directoryOperations.length).toBe(1); // myconfigs/
    });

    test('should handle only file operations', async () => {
      await createTestFiles(repo, {
        'config.base.json': JSON.stringify({ a: 1 }),
        [`config.{machine=${machineName}}.json`]: JSON.stringify({ b: 2 }),
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(1);
      expect(result.directoryOperations.length).toBe(0);
    });

    test('should handle only directory operations', async () => {
      await createTestFiles(repo, {
        [`mydir.{machine=${machineName}}/file.txt`]: 'content',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(0);
      expect(result.directoryOperations.length).toBe(1);
    });

    test('should return empty when nothing matches', async () => {
      await createTestFiles(repo, {
        'regular-file.json': '{}',
        'another/nested/file.txt': 'text',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(0);
      expect(result.directoryOperations.length).toBe(0);
    });
  });

  describe('file exclusion from filtered directories', () => {
    test('should not create merge operations for files inside filtered directories', async () => {
      await createTestFiles(repo, {
        // Files inside filtered directory - should NOT be treated as merge operations
        [`configs.{machine=${machineName}}/settings.{machine=${machineName}}.json`]: '{}',
        [`configs.{machine=${machineName}}/data.base.json`]: '{}',
        // Regular file merge operation
        [`app.{machine=${machineName}}.json`]: '{}',
        'app.base.json': '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      // Only the top-level app.json should be a merge operation
      expect(result.mergeOperations.length).toBe(1);
      expect(result.mergeOperations[0].outputPath).toContain('app.json');
      
      // The directory should be a copy operation
      expect(result.directoryOperations.length).toBe(1);
    });

    test('should copy files inside directories as-is without processing', async () => {
      await createTestFiles(repo, {
        // These files have filter syntax but should be copied verbatim
        [`mydir.{machine=${machineName}}/nested.{machine=other}.json`]: '{"unchanged":true}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      expect(result.directoryOperations.length).toBe(1);
      
      // Copy the directory
      await performDirectoryCopy(result.directoryOperations[0]);
      
      // The file should be copied with its exact name, not processed
      const content = await repo.readFile('mydir/nested.{machine=other}.json');
      expect(JSON.parse(content)).toEqual({ unchanged: true });
    });
  });

  describe('conflict detection', () => {
    test('should detect file-directory output conflicts', async () => {
      await createTestFiles(repo, {
        // File merge operation targeting configs/app.json
        'configs/app.base.json': '{}',
        [`configs/app.{machine=${machineName}}.json`]: '{}',
        // Directory operation also targeting configs/
        [`configs.{machine=${machineName}}/app.json`]: '{}',
      });

      await expect(
        scanAllOperations(machineName, repo.path)
      ).rejects.toThrow(FileDirectoryConflictError);
    });
  });

  describe('combined execution', () => {
    test('should execute both file and directory operations correctly', async () => {
      await createTestFiles(repo, {
        // File operations
        'settings.base.json': JSON.stringify({ base: true, value: 1 }),
        [`settings.{machine=${machineName}}.json`]: JSON.stringify({ value: 2, machine: true }),
        '.env.base': 'BASE_KEY=base\n',
        [`.env.{machine=${machineName}}`]: 'MACHINE_KEY=machine\n',
        // Directory operations
        [`scripts.{machine=${machineName}}/build.sh`]: '#!/bin/bash\necho build',
        [`scripts.{machine=${machineName}}/test.sh`]: '#!/bin/bash\necho test',
        [`configs.{machine=${machineName}}/db.json`]: '{"host":"localhost"}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      // Execute file merges
      const mergeResults = await performAllMerges(result.mergeOperations);
      expect(mergeResults.every(r => r.success)).toBe(true);
      
      // Execute directory copies
      const dirResults = await performAllDirectoryCopies(result.directoryOperations);
      expect(dirResults.every(r => r.success)).toBe(true);

      // Verify file merge results
      const settingsOutput = JSON.parse(await repo.readFile('settings.json'));
      expect(settingsOutput).toEqual({ base: true, value: 2, machine: true });

      const envOutput = await repo.readFile('.env');
      expect(envOutput).toContain('BASE_KEY=base');
      expect(envOutput).toContain('MACHINE_KEY=machine');

      // Verify directory copy results
      expect(await repo.fileExists('scripts/build.sh')).toBe(true);
      expect(await repo.fileExists('scripts/test.sh')).toBe(true);
      expect(await repo.fileExists('configs/db.json')).toBe(true);
      
      const dbConfig = JSON.parse(await repo.readFile('configs/db.json'));
      expect(dbConfig).toEqual({ host: 'localhost' });
    });

    test('should handle complex nested structure with mixed operations', async () => {
      await createTestFiles(repo, {
        // Root level file merge
        'app.base.json': '{"root":true}',
        [`app.{machine=${machineName}}.json`]: '{"app":true}',
        // Subdirectory file merge
        'packages/core/config.base.json': '{"core":true}',
        [`packages/core/config.{machine=${machineName}}.json`]: '{"local":true}',
        // Directory operation in another location
        [`packages/ui/theme.{machine=${machineName}}/colors.json`]: '{"primary":"blue"}',
        [`packages/ui/theme.{machine=${machineName}}/fonts.json`]: '{"family":"sans"}',
        // Another directory operation at root
        [`scripts.{machine=${machineName}}/setup.sh`]: 'echo setup',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(2);
      expect(result.directoryOperations.length).toBe(2);

      // Execute all operations
      await performAllMerges(result.mergeOperations);
      await performAllDirectoryCopies(result.directoryOperations);

      // Verify structure
      expect(await repo.fileExists('app.json')).toBe(true);
      expect(await repo.fileExists('packages/core/config.json')).toBe(true);
      expect(await repo.fileExists('packages/ui/theme/colors.json')).toBe(true);
      expect(await repo.fileExists('packages/ui/theme/fonts.json')).toBe(true);
      expect(await repo.fileExists('scripts/setup.sh')).toBe(true);
    });
  });

  describe('idempotency', () => {
    test('should be idempotent when running multiple times', async () => {
      await createTestFiles(repo, {
        'config.base.json': JSON.stringify({ a: 1 }),
        [`config.{machine=${machineName}}.json`]: JSON.stringify({ b: 2 }),
        [`mydir.{machine=${machineName}}/data.txt`]: 'data',
      });

      // First run
      const result1 = await scanAllOperations(machineName, repo.path);
      const mergeResults1 = await performAllMerges(result1.mergeOperations);
      const dirResults1 = await performAllDirectoryCopies(result1.directoryOperations);
      
      expect(mergeResults1[0].changed).toBe(true);
      expect(dirResults1[0].changed).toBe(true);

      // Second run - should detect no changes
      const result2 = await scanAllOperations(machineName, repo.path);
      const mergeResults2 = await performAllMerges(result2.mergeOperations);
      const dirResults2 = await performAllDirectoryCopies(result2.directoryOperations);
      
      expect(mergeResults2[0].changed).toBe(false);
      expect(dirResults2[0].changed).toBe(false);
    });
  });

  describe('different filter types together', () => {
    test('should handle machine and OS filters in same project', async () => {
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        // Machine-specific file
        [`app.{machine=${machineName}}.json`]: '{"machine":true}',
        'app.base.json': '{}',
        // OS-specific directory
        [`shell.{os=${currentOS}}/profile.sh`]: 'export PATH=...',
        // Combined filters on directory
        [`env.{machine=${machineName}}{os=${currentOS}}/vars.txt`]: 'VAR=value',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(1);
      expect(result.directoryOperations.length).toBe(2);

      // Execute and verify
      await performAllMerges(result.mergeOperations);
      await performAllDirectoryCopies(result.directoryOperations);

      expect(await repo.fileExists('app.json')).toBe(true);
      expect(await repo.fileExists('shell/profile.sh')).toBe(true);
      expect(await repo.fileExists('env/vars.txt')).toBe(true);
    });

    test('should respect non-matching filters', async () => {
      await createTestFiles(repo, {
        // Matching file
        [`app.{machine=${machineName}}.json`]: '{}',
        'app.base.json': '{}',
        // Non-matching directory (different machine)
        [`scripts.{machine=other-machine}/run.sh`]: 'echo run',
        // Non-matching file (different machine)
        [`db.{machine=other-machine}.json`]: '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      // Only the matching file should be included
      expect(result.mergeOperations.length).toBe(1);
      expect(result.directoryOperations.length).toBe(0);
    });
  });

  describe('legacy and new syntax together', () => {
    test('should handle both legacy and new filter syntax files', async () => {
      await createTestFiles(repo, {
        // Legacy syntax file
        [`legacy.${machineName}.json`]: '{"legacy":true}',
        'legacy.base.json': '{"base":true}',
        // New syntax file
        [`modern.{machine=${machineName}}.json`]: '{"modern":true}',
        'modern.base.json': '{"base":true}',
        // New syntax directory
        [`configs.{machine=${machineName}}/app.json`]: '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      expect(result.mergeOperations.length).toBe(2);
      expect(result.directoryOperations.length).toBe(1);

      await performAllMerges(result.mergeOperations);
      await performAllDirectoryCopies(result.directoryOperations);

      // Both file syntaxes should work
      expect(await repo.fileExists('legacy.json')).toBe(true);
      expect(await repo.fileExists('modern.json')).toBe(true);
      expect(await repo.fileExists('configs/app.json')).toBe(true);
    });
  });

  describe('output path correctness', () => {
    test('should produce correct output paths for various scenarios', async () => {
      await createTestFiles(repo, {
        // Root level
        [`root.{machine=${machineName}}.json`]: '{}',
        // Nested path
        [`a/b/c/deep.{machine=${machineName}}.json`]: '{}',
        // Directory in nested path
        [`x/y/z/dir.{machine=${machineName}}/file.txt`]: 'text',
      });

      const result = await scanAllOperations(machineName, repo.path);

      // Check file merge output paths
      const rootOp = result.mergeOperations.find(op => op.outputPath.includes('root.json'));
      expect(rootOp).toBeDefined();
      expect(rootOp?.outputPath).toBe(path.join(repo.path, 'root.json'));

      const deepOp = result.mergeOperations.find(op => op.outputPath.includes('deep.json'));
      expect(deepOp).toBeDefined();
      expect(deepOp?.outputPath).toBe(path.join(repo.path, 'a', 'b', 'c', 'deep.json'));

      // Check directory output path
      expect(result.directoryOperations[0].outputPath).toBe(
        path.join(repo.path, 'x', 'y', 'z', 'dir')
      );
    });
  });
});

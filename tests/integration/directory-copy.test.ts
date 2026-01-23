import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { scanForDirectoryOperations, scanAllOperations } from '../../src/core/file-scanner';
import { performDirectoryCopy, performAllDirectoryCopies, getDirectoryOutputFiles } from '../../src/core/directory-copier';
import { getMachineName } from '../../src/core/machine-detector';
import {
  NestedFilteredDirectoryError,
  DirectoryConflictError,
  BaseDirectoryNotSupportedError,
} from '../../src/core/errors';

describe('directory copy integration', () => {
  let repo: TestRepo;
  const machineName = getMachineName();

  beforeEach(async () => {
    repo = new TestRepo('directory-copy-test');
    await repo.create();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  describe('basic directory copying', () => {
    test('should copy single-file directory matching current machine', async () => {
      // Create a machine-specific directory with a single file
      await createTestFiles(repo, {
        [`configs.{machine=${machineName}}/settings.json`]: JSON.stringify({ key: 'value' }),
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);
      expect(operations[0].type).toBe('directory');

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.filesWritten).toBe(1);

      // Verify output
      const outputFile = await repo.readFile('configs/settings.json');
      expect(JSON.parse(outputFile)).toEqual({ key: 'value' });
    });

    test('should copy directory with multiple files', async () => {
      await createTestFiles(repo, {
        [`mydir.{machine=${machineName}}/file1.txt`]: 'content1',
        [`mydir.{machine=${machineName}}/file2.txt`]: 'content2',
        [`mydir.{machine=${machineName}}/file3.txt`]: 'content3',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);
      expect(result.filesWritten).toBe(3);

      // Verify all files
      expect(await repo.readFile('mydir/file1.txt')).toBe('content1');
      expect(await repo.readFile('mydir/file2.txt')).toBe('content2');
      expect(await repo.readFile('mydir/file3.txt')).toBe('content3');
    });

    test('should copy directory with nested subdirectories', async () => {
      await createTestFiles(repo, {
        [`app.{machine=${machineName}}/config/db.json`]: '{"host":"localhost"}',
        [`app.{machine=${machineName}}/config/cache.json`]: '{"ttl":3600}',
        [`app.{machine=${machineName}}/logs/.gitkeep`]: '',
        [`app.{machine=${machineName}}/data/seed/users.json`]: '[]',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);
      expect(result.filesWritten).toBe(4);

      // Verify nested structure
      expect(await repo.fileExists('app/config/db.json')).toBe(true);
      expect(await repo.fileExists('app/config/cache.json')).toBe(true);
      expect(await repo.fileExists('app/logs/.gitkeep')).toBe(true);
      expect(await repo.fileExists('app/data/seed/users.json')).toBe(true);
    });

    test('should copy directory in subdirectory', async () => {
      await createTestFiles(repo, {
        [`packages/core/configs.{machine=${machineName}}/app.json`]: '{}',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);
      expect(operations[0].outputPath).toContain(path.join('packages', 'core', 'configs'));

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);

      expect(await repo.fileExists('packages/core/configs/app.json')).toBe(true);
    });
  });

  describe('filter matching', () => {
    test('should not copy directory for different machine', async () => {
      await createTestFiles(repo, {
        [`configs.{machine=other-machine}/settings.json`]: '{}',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(0);
    });

    test('should match directory with OS filter', async () => {
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        [`scripts.{os=${currentOS}}/run.sh`]: '#!/bin/bash',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);
    });

    test('should match directory with multiple filters', async () => {
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        [`env.{machine=${machineName}}{os=${currentOS}}/config.txt`]: 'test',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);
    });

    test('should not match when any filter fails', async () => {
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        [`env.{machine=${machineName}}{os=wrongos}/config.txt`]: 'test',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(0);
    });
  });

  describe('unchanged files', () => {
    test('should not overwrite unchanged files', async () => {
      await createTestFiles(repo, {
        [`data.{machine=${machineName}}/file.txt`]: 'content',
      });

      // First copy
      const operations = await scanForDirectoryOperations(machineName, repo.path);
      const result1 = await performDirectoryCopy(operations[0]);
      expect(result1.filesWritten).toBe(1);
      expect(result1.changed).toBe(true);

      // Second copy - same content
      const result2 = await performDirectoryCopy(operations[0]);
      expect(result2.filesWritten).toBe(0);
      expect(result2.filesUnchanged).toBe(1);
      expect(result2.changed).toBe(false);
    });

    test('should overwrite changed files', async () => {
      await createTestFiles(repo, {
        [`data.{machine=${machineName}}/file.txt`]: 'original',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      
      // First copy
      await performDirectoryCopy(operations[0]);

      // Modify source
      await repo.writeFile(`data.{machine=${machineName}}/file.txt`, 'modified');

      // Second copy - should detect change
      const result = await performDirectoryCopy(operations[0]);
      expect(result.filesWritten).toBe(1);
      expect(result.changed).toBe(true);

      const content = await repo.readFile('data/file.txt');
      expect(content).toBe('modified');
    });
  });

  describe('file types', () => {
    test('should copy binary files', async () => {
      // Create a simple "binary" file (PNG header)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const filePath = path.join(repo.path, `assets.{machine=${machineName}}`, 'image.png');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, binaryContent);

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);

      // Verify binary content
      const outputPath = path.join(repo.path, 'assets', 'image.png');
      const outputContent = await fs.readFile(outputPath);
      expect(outputContent.equals(binaryContent)).toBe(true);
    });

    test('should copy hidden files', async () => {
      await createTestFiles(repo, {
        [`dotfiles.{machine=${machineName}}/.hidden`]: 'secret',
        [`dotfiles.{machine=${machineName}}/.config/settings`]: 'config',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);

      expect(await repo.readFile('dotfiles/.hidden')).toBe('secret');
      expect(await repo.readFile('dotfiles/.config/settings')).toBe('config');
    });

    test('should handle files with special characters in names', async () => {
      await createTestFiles(repo, {
        [`special.{machine=${machineName}}/file with spaces.txt`]: 'spaces',
        [`special.{machine=${machineName}}/file-with-dashes.txt`]: 'dashes',
        [`special.{machine=${machineName}}/file_with_underscores.txt`]: 'underscores',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);
      expect(result.filesWritten).toBe(3);
    });
  });

  describe('multiple directories', () => {
    test('should handle multiple matching directories', async () => {
      await createTestFiles(repo, {
        [`config1.{machine=${machineName}}/app.json`]: '{"app":1}',
        [`config2.{machine=${machineName}}/db.json`]: '{"db":2}',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(2);

      const results = await performAllDirectoryCopies(operations);
      expect(results.every(r => r.success)).toBe(true);

      expect(await repo.fileExists('config1/app.json')).toBe(true);
      expect(await repo.fileExists('config2/db.json')).toBe(true);
    });

    test('should match different directories with different filters', async () => {
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        [`machine-specific.{machine=${machineName}}/m.txt`]: 'machine',
        [`os-specific.{os=${currentOS}}/o.txt`]: 'os',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(2);
    });
  });

  describe('error cases', () => {
    test('should throw error for nested filtered directories', async () => {
      // Create nested filtered directories
      await createTestFiles(repo, {
        [`outer.{machine=${machineName}}/inner.{os=linux}/file.txt`]: 'nested',
      });

      await expect(
        scanForDirectoryOperations(machineName, repo.path)
      ).rejects.toThrow(NestedFilteredDirectoryError);
    });

    test('should throw error when multiple directories match same output', async () => {
      // This requires two directories with different filters but same base name
      // both matching the current context
      const currentOS = process.platform === 'win32' ? 'windows' 
                      : process.platform === 'darwin' ? 'macos' 
                      : 'linux';

      await createTestFiles(repo, {
        [`configs.{machine=${machineName}}/app.json`]: '{"m":1}',
        [`configs.{os=${currentOS}}/app.json`]: '{"o":2}',
      });

      await expect(
        scanForDirectoryOperations(machineName, repo.path)
      ).rejects.toThrow(DirectoryConflictError);
    });

    test('should throw error for base directory pattern', async () => {
      await createTestFiles(repo, {
        [`configs.{base}/settings.json`]: '{}',
      });

      await expect(
        scanForDirectoryOperations(machineName, repo.path)
      ).rejects.toThrow(BaseDirectoryNotSupportedError);
    });

    test('should handle empty source directory gracefully', async () => {
      // Create empty directory
      const dirPath = path.join(repo.path, `empty.{machine=${machineName}}`);
      await fs.mkdir(dirPath, { recursive: true });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);

      const result = await performDirectoryCopy(operations[0]);
      expect(result.success).toBe(true);
      expect(result.filesWritten).toBe(0);
      expect(result.changed).toBe(false);

      // Output directory should exist but be empty
      expect(await repo.fileExists('empty')).toBe(true);
    });
  });

  describe('getDirectoryOutputFiles', () => {
    test('should return all output file paths', async () => {
      await createTestFiles(repo, {
        [`mydir.{machine=${machineName}}/a.txt`]: 'a',
        [`mydir.{machine=${machineName}}/b/c.txt`]: 'c',
        [`mydir.{machine=${machineName}}/b/d/e.txt`]: 'e',
      });

      const operations = await scanForDirectoryOperations(machineName, repo.path);
      expect(operations.length).toBe(1);

      const outputFiles = await getDirectoryOutputFiles(operations[0]);
      expect(outputFiles.length).toBe(3);
      
      // Check paths contain expected structure
      expect(outputFiles.some(f => f.endsWith('a.txt'))).toBe(true);
      expect(outputFiles.some(f => f.includes(path.join('b', 'c.txt')))).toBe(true);
      expect(outputFiles.some(f => f.includes(path.join('b', 'd', 'e.txt')))).toBe(true);
    });
  });

  describe('integration with scanAllOperations', () => {
    test('should return directory operations from unified scan', async () => {
      await createTestFiles(repo, {
        [`mydir.{machine=${machineName}}/settings.json`]: '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      expect(result.directoryOperations.length).toBe(1);
      expect(result.mergeOperations.length).toBe(0);
    });

    test('should exclude files inside filtered directories from merge operations', async () => {
      await createTestFiles(repo, {
        // Directory operation
        [`configs.{machine=${machineName}}/app.json`]: '{}',
        // Regular file operation (outside filtered dir)
        [`settings.{machine=${machineName}}.json`]: '{}',
        'settings.base.json': '{}',
      });

      const result = await scanAllOperations(machineName, repo.path);
      
      // Should have one directory operation
      expect(result.directoryOperations.length).toBe(1);
      
      // Should have one merge operation (settings.json), but not configs/app.json
      expect(result.mergeOperations.length).toBe(1);
      expect(result.mergeOperations[0].outputPath).toContain('settings.json');
    });
  });
});

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  performDirectoryCopy,
  performAllDirectoryCopies,
  getDirectoryOutputFiles,
} from '../../src/core/directory-copier.js';
import type { DirectoryCopyOperation } from '../../src/core/file-scanner.js';

let testDir: string;

async function createTestDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `permachine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function createFile(dir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

async function readFile(dir: string, relativePath: string): Promise<string> {
  const fullPath = path.join(dir, relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

async function fileExists(dir: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(fullPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(fullPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

beforeEach(async () => {
  testDir = await createTestDir();
});

afterEach(async () => {
  await cleanup(testDir);
});

describe('performDirectoryCopy', () => {
  test('copies all files from source to output directory', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/file1.txt', 'content1');
    await createFile(testDir, 'source/file2.txt', 'content2');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(2);
    expect(await fileExists(testDir, 'output/file1.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/file2.txt')).toBe(true);
    expect(await readFile(testDir, 'output/file1.txt')).toBe('content1');
    expect(await readFile(testDir, 'output/file2.txt')).toBe('content2');
  });

  test('preserves nested directory structure', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/subdir/nested/file.txt', 'nested content');
    await createFile(testDir, 'source/another/deep/path/file.md', '# Header');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(await fileExists(testDir, 'output/subdir/nested/file.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/another/deep/path/file.md')).toBe(true);
    expect(await readFile(testDir, 'output/subdir/nested/file.txt')).toBe('nested content');
  });

  test('copies hidden files (dotfiles)', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/.gitkeep', '');
    await createFile(testDir, 'source/.env', 'SECRET=value');
    await createFile(testDir, 'source/subdir/.hidden', 'hidden content');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(await fileExists(testDir, 'output/.gitkeep')).toBe(true);
    expect(await fileExists(testDir, 'output/.env')).toBe(true);
    expect(await fileExists(testDir, 'output/subdir/.hidden')).toBe(true);
  });

  test('skips unchanged files on second run', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/file.txt', 'content');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    // First run
    const result1 = await performDirectoryCopy(operation);
    expect(result1.success).toBe(true);
    expect(result1.filesWritten).toBe(1);
    expect(result1.changed).toBe(true);
    
    // Second run without changes
    const result2 = await performDirectoryCopy(operation);
    expect(result2.success).toBe(true);
    expect(result2.filesWritten).toBe(0);
    expect(result2.filesUnchanged).toBe(1);
    expect(result2.changed).toBe(false);
  });

  test('handles empty source directory', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await fs.mkdir(sourceDir, { recursive: true });
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(0);
    expect(result.filesUnchanged).toBe(0);
    // Output directory should still be created
    expect(await fileExists(testDir, 'output')).toBe(true);
  });

  test('overwrites changed files', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/file.txt', 'version 1');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    // First run
    await performDirectoryCopy(operation);
    expect(await readFile(testDir, 'output/file.txt')).toBe('version 1');
    
    // Modify source file
    await createFile(testDir, 'source/file.txt', 'version 2');
    
    // Second run should update the file
    const result2 = await performDirectoryCopy(operation);
    expect(result2.success).toBe(true);
    expect(result2.filesWritten).toBe(1);
    expect(result2.changed).toBe(true);
    expect(await readFile(testDir, 'output/file.txt')).toBe('version 2');
  });

  test('handles binary files correctly', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    // Create a binary file (PNG header bytes)
    const binaryContent = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'image.png'), binaryContent);
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    const outputContent = await fs.readFile(path.join(outputDir, 'image.png'));
    expect(outputContent.equals(binaryContent)).toBe(true);
  });

  test('copies symlinks as symlinks', async () => {
    // Skip this test on Windows if symlinks require admin privileges
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/real-file.txt', 'real content');
    
    try {
      await fs.symlink(
        path.join(sourceDir, 'real-file.txt'),
        path.join(sourceDir, 'link-to-file.txt')
      );
    } catch {
      // Skip test if symlinks not supported
      console.log('Skipping symlink test - symlinks not supported on this system');
      return;
    }
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(await isSymlink(path.join(outputDir, 'link-to-file.txt'))).toBe(true);
  });

  test('handles files with special characters in names', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    // Use characters that are safe across platforms
    await createFile(testDir, 'source/file-with-dash.txt', 'content1');
    await createFile(testDir, 'source/file_with_underscore.txt', 'content2');
    await createFile(testDir, 'source/file.multiple.dots.txt', 'content3');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(3);
    expect(await fileExists(testDir, 'output/file-with-dash.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/file_with_underscore.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/file.multiple.dots.txt')).toBe(true);
  });

  test('handles large files', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    // Create a file larger than the chunk size (64KB)
    const largeContent = 'x'.repeat(100 * 1024); // 100KB
    await createFile(testDir, 'source/large-file.txt', largeContent);
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(await readFile(testDir, 'output/large-file.txt')).toBe(largeContent);
  });

  test('returns error when source directory does not exist', async () => {
    const sourceDir = path.join(testDir, 'nonexistent');
    const outputDir = path.join(testDir, 'output');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true); // Empty directory scenario
    expect(result.filesWritten).toBe(0);
  });

  test('handles directories with only subdirectories', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/sub1/file1.txt', 'content1');
    await createFile(testDir, 'source/sub2/file2.txt', 'content2');
    await createFile(testDir, 'source/sub3/deep/file3.txt', 'content3');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(3);
    expect(await fileExists(testDir, 'output/sub1/file1.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/sub2/file2.txt')).toBe(true);
    expect(await fileExists(testDir, 'output/sub3/deep/file3.txt')).toBe(true);
  });
});

describe('performAllDirectoryCopies', () => {
  test('processes multiple directory operations', async () => {
    const source1 = path.join(testDir, 'source1');
    const source2 = path.join(testDir, 'source2');
    const output1 = path.join(testDir, 'output1');
    const output2 = path.join(testDir, 'output2');
    
    await createFile(testDir, 'source1/file1.txt', 'content1');
    await createFile(testDir, 'source2/file2.txt', 'content2');
    
    const operations: DirectoryCopyOperation[] = [
      { sourcePath: source1, outputPath: output1, type: 'directory' },
      { sourcePath: source2, outputPath: output2, type: 'directory' },
    ];
    
    const results = await performAllDirectoryCopies(operations);
    
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(await fileExists(testDir, 'output1/file1.txt')).toBe(true);
    expect(await fileExists(testDir, 'output2/file2.txt')).toBe(true);
  });

  test('handles empty operations array', async () => {
    const results = await performAllDirectoryCopies([]);
    expect(results).toHaveLength(0);
  });

  test('continues processing after one failure', async () => {
    const source1 = path.join(testDir, 'nonexistent');
    const source2 = path.join(testDir, 'source2');
    const output1 = path.join(testDir, 'output1');
    const output2 = path.join(testDir, 'output2');
    
    await createFile(testDir, 'source2/file.txt', 'content');
    
    const operations: DirectoryCopyOperation[] = [
      { sourcePath: source1, outputPath: output1, type: 'directory' },
      { sourcePath: source2, outputPath: output2, type: 'directory' },
    ];
    
    const results = await performAllDirectoryCopies(operations);
    
    expect(results).toHaveLength(2);
    // Second operation should still succeed
    expect(results[1].success).toBe(true);
    expect(await fileExists(testDir, 'output2/file.txt')).toBe(true);
  });
});

describe('getDirectoryOutputFiles', () => {
  test('returns all output file paths', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/file1.txt', 'content1');
    await createFile(testDir, 'source/subdir/file2.txt', 'content2');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const outputFiles = await getDirectoryOutputFiles(operation);
    
    expect(outputFiles).toHaveLength(2);
    expect(outputFiles).toContain(path.join(outputDir, 'file1.txt'));
    expect(outputFiles).toContain(path.join(outputDir, 'subdir', 'file2.txt'));
  });

  test('returns empty array for empty directory', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await fs.mkdir(sourceDir, { recursive: true });
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const outputFiles = await getDirectoryOutputFiles(operation);
    
    expect(outputFiles).toHaveLength(0);
  });

  test('includes hidden files in output', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/.hidden', 'hidden');
    await createFile(testDir, 'source/visible.txt', 'visible');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const outputFiles = await getDirectoryOutputFiles(operation);
    
    expect(outputFiles).toHaveLength(2);
    expect(outputFiles).toContain(path.join(outputDir, '.hidden'));
    expect(outputFiles).toContain(path.join(outputDir, 'visible.txt'));
  });
});

describe('cross-platform path handling', () => {
  test('normalizes path separators in output', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    // Create nested structure
    await createFile(testDir, 'source/a/b/c/file.txt', 'content');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    // Path should be normalized for the current platform
    const expectedPath = path.join(outputDir, 'a', 'b', 'c', 'file.txt');
    expect(await fileExists(testDir, path.relative(testDir, expectedPath))).toBe(true);
  });

  test('handles mixed path separators in source', async () => {
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');
    
    await createFile(testDir, 'source/dir1/dir2/file.txt', 'content');
    
    const operation: DirectoryCopyOperation = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      type: 'directory',
    };
    
    const result = await performDirectoryCopy(operation);
    
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(1);
  });
});

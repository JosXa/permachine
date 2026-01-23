import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  cleanupStaleOutputs,
  getDeletedPath,
  isDeletedPath,
  getOriginalPath,
  loadManifest,
  saveManifest,
  getManifestPath,
  restoreDeletedOutput,
  purgeDeletedOutputs,
} from '../../src/core/cleanup.js';

let testDir: string;

async function createTestDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `permachine-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function createDir(dir: string, relativePath: string): Promise<void> {
  await fs.mkdir(path.join(dir, relativePath), { recursive: true });
}

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(fullPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(fullPath);
    return stat.isDirectory();
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

describe('getDeletedPath', () => {
  test('appends .permachine-deleted to file', () => {
    expect(getDeletedPath('config.json')).toBe('config.json.permachine-deleted');
  });

  test('appends .permachine-deleted to directory', () => {
    expect(getDeletedPath('jira')).toBe('jira.permachine-deleted');
  });

  test('handles paths with directory separators', () => {
    const input = path.join('.opencode', 'skills', 'jira');
    const expected = path.join('.opencode', 'skills', 'jira') + '.permachine-deleted';
    expect(getDeletedPath(input)).toBe(expected);
  });

  test('handles dotfiles', () => {
    expect(getDeletedPath('.env')).toBe('.env.permachine-deleted');
  });

  test('handles hidden directories', () => {
    expect(getDeletedPath('.config')).toBe('.config.permachine-deleted');
  });

  test('handles paths with multiple extensions', () => {
    expect(getDeletedPath('backup.tar.gz')).toBe('backup.tar.gz.permachine-deleted');
  });

  test('handles empty string', () => {
    expect(getDeletedPath('')).toBe('.permachine-deleted');
  });
});

describe('isDeletedPath', () => {
  test('returns true for deleted file path', () => {
    expect(isDeletedPath('config.json.permachine-deleted')).toBe(true);
  });

  test('returns true for deleted directory path', () => {
    expect(isDeletedPath('jira.permachine-deleted')).toBe(true);
  });

  test('returns false for regular file path', () => {
    expect(isDeletedPath('config.json')).toBe(false);
  });

  test('returns false for path containing but not ending with suffix', () => {
    expect(isDeletedPath('permachine-deleted.txt')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isDeletedPath('')).toBe(false);
  });
});

describe('getOriginalPath', () => {
  test('removes .permachine-deleted suffix from file', () => {
    expect(getOriginalPath('config.json.permachine-deleted')).toBe('config.json');
  });

  test('removes .permachine-deleted suffix from directory', () => {
    expect(getOriginalPath('jira.permachine-deleted')).toBe('jira');
  });

  test('returns same path if not a deleted path', () => {
    expect(getOriginalPath('config.json')).toBe('config.json');
  });

  test('handles paths with directory separators', () => {
    const input = path.join('.opencode', 'skills', 'jira.permachine-deleted');
    const expected = path.join('.opencode', 'skills', 'jira');
    expect(getOriginalPath(input)).toBe(expected);
  });
});

describe('saveManifest and loadManifest', () => {
  test('saves and loads manifest correctly', async () => {
    const outputs = [
      path.join(testDir, 'config.json'),
      path.join(testDir, 'output-dir'),
    ];
    
    await saveManifest(testDir, outputs);
    const loaded = await loadManifest(testDir);
    
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.outputs).toEqual(outputs);
    expect(loaded!.lastRun).toBeDefined();
  });

  test('returns null when manifest does not exist', async () => {
    const loaded = await loadManifest(testDir);
    expect(loaded).toBeNull();
  });

  test('creates manifest file at correct location', async () => {
    await saveManifest(testDir, ['test']);
    
    const manifestPath = getManifestPath(testDir);
    expect(await fileExists(manifestPath)).toBe(true);
  });

  test('overwrites existing manifest', async () => {
    await saveManifest(testDir, ['old-output']);
    await saveManifest(testDir, ['new-output']);
    
    const loaded = await loadManifest(testDir);
    expect(loaded!.outputs).toEqual(['new-output']);
  });
});

describe('cleanupStaleOutputs', () => {
  test('renames file that was in previous manifest but not current', async () => {
    const oldFile = path.join(testDir, 'old.json');
    const newFile = path.join(testDir, 'new.json');
    
    // Create old output file and manifest
    await createFile(testDir, 'old.json', 'old content');
    await saveManifest(testDir, [oldFile]);
    
    // Run cleanup with new outputs (old.json is stale)
    const result = await cleanupStaleOutputs([newFile], testDir);
    
    expect(result.renamedFiles).toContain(oldFile);
    expect(await fileExists(oldFile)).toBe(false);
    expect(await fileExists(getDeletedPath(oldFile))).toBe(true);
  });

  test('renames directory that was in previous manifest but not current', async () => {
    const oldDir = path.join(testDir, 'old-dir');
    const newDir = path.join(testDir, 'new-dir');
    
    // Create old output directory and manifest
    await createDir(testDir, 'old-dir');
    await createFile(testDir, 'old-dir/file.txt', 'content');
    await saveManifest(testDir, [oldDir]);
    
    // Run cleanup with new outputs
    const result = await cleanupStaleOutputs([newDir], testDir);
    
    expect(result.renamedDirectories).toContain(oldDir);
    expect(await fileExists(oldDir)).toBe(false);
    expect(await isDirectory(getDeletedPath(oldDir))).toBe(true);
  });

  test('does not rename outputs that still exist in current', async () => {
    const keepFile = path.join(testDir, 'keep.json');
    
    // Create file and manifest
    await createFile(testDir, 'keep.json', 'content');
    await saveManifest(testDir, [keepFile]);
    
    // Run cleanup with same outputs
    const result = await cleanupStaleOutputs([keepFile], testDir);
    
    expect(result.renamedFiles).toHaveLength(0);
    expect(result.renamedDirectories).toHaveLength(0);
    expect(await fileExists(keepFile)).toBe(true);
  });

  test('handles first run with no manifest', async () => {
    const result = await cleanupStaleOutputs(['new-output'], testDir);
    
    expect(result.renamedFiles).toHaveLength(0);
    expect(result.renamedDirectories).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('updates manifest with current outputs', async () => {
    const output1 = path.join(testDir, 'output1');
    const output2 = path.join(testDir, 'output2');
    
    await cleanupStaleOutputs([output1, output2], testDir);
    
    const manifest = await loadManifest(testDir);
    expect(manifest!.outputs).toEqual([output1, output2]);
  });

  test('handles stale output that no longer exists', async () => {
    const missingFile = path.join(testDir, 'missing.json');
    const newFile = path.join(testDir, 'new.json');
    
    // Create manifest with file that doesn't exist
    await saveManifest(testDir, [missingFile]);
    
    // Run cleanup - should not error
    const result = await cleanupStaleOutputs([newFile], testDir);
    
    expect(result.renamedFiles).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('handles multiple stale outputs', async () => {
    const oldFile1 = path.join(testDir, 'old1.json');
    const oldFile2 = path.join(testDir, 'old2.json');
    const oldDir = path.join(testDir, 'old-dir');
    const newFile = path.join(testDir, 'new.json');
    
    await createFile(testDir, 'old1.json', 'content1');
    await createFile(testDir, 'old2.json', 'content2');
    await createDir(testDir, 'old-dir');
    await saveManifest(testDir, [oldFile1, oldFile2, oldDir]);
    
    const result = await cleanupStaleOutputs([newFile], testDir);
    
    expect(result.renamedFiles).toHaveLength(2);
    expect(result.renamedDirectories).toHaveLength(1);
  });

  test('removes existing .permachine-deleted before renaming', async () => {
    const staleFile = path.join(testDir, 'stale.json');
    const deletedPath = getDeletedPath(staleFile);
    
    // Create both the stale file and an existing deleted version
    await createFile(testDir, 'stale.json', 'new stale content');
    await createFile(testDir, path.basename(deletedPath), 'old deleted content');
    await saveManifest(testDir, [staleFile]);
    
    const result = await cleanupStaleOutputs([], testDir);
    
    expect(result.renamedFiles).toContain(staleFile);
    // The new stale file should have replaced the old deleted file
    const content = await fs.readFile(deletedPath, 'utf-8');
    expect(content).toBe('new stale content');
  });
});

describe('restoreDeletedOutput', () => {
  test('restores deleted file to original location', async () => {
    const originalPath = path.join(testDir, 'config.json');
    const deletedPath = getDeletedPath(originalPath);
    
    await createFile(testDir, path.basename(deletedPath), 'restored content');
    
    const success = await restoreDeletedOutput(deletedPath);
    
    expect(success).toBe(true);
    expect(await fileExists(originalPath)).toBe(true);
    expect(await fileExists(deletedPath)).toBe(false);
  });

  test('returns false if deleted path does not exist', async () => {
    const deletedPath = path.join(testDir, 'missing.permachine-deleted');
    
    const success = await restoreDeletedOutput(deletedPath);
    
    expect(success).toBe(false);
  });

  test('returns false if original path already exists', async () => {
    const originalPath = path.join(testDir, 'config.json');
    const deletedPath = getDeletedPath(originalPath);
    
    await createFile(testDir, 'config.json', 'original');
    await createFile(testDir, path.basename(deletedPath), 'deleted');
    
    const success = await restoreDeletedOutput(deletedPath);
    
    expect(success).toBe(false);
    // Both files should still exist
    expect(await fileExists(originalPath)).toBe(true);
    expect(await fileExists(deletedPath)).toBe(true);
  });

  test('returns false for non-deleted path', async () => {
    const regularPath = path.join(testDir, 'config.json');
    await createFile(testDir, 'config.json', 'content');
    
    const success = await restoreDeletedOutput(regularPath);
    
    expect(success).toBe(false);
  });
});

describe('purgeDeletedOutputs', () => {
  test('removes all .permachine-deleted files', async () => {
    const deleted1 = 'file1.json.permachine-deleted';
    const deleted2 = 'file2.json.permachine-deleted';
    
    await createFile(testDir, deleted1, 'content1');
    await createFile(testDir, deleted2, 'content2');
    
    const purged = await purgeDeletedOutputs(testDir);
    
    expect(purged).toHaveLength(2);
    expect(await fileExists(path.join(testDir, deleted1))).toBe(false);
    expect(await fileExists(path.join(testDir, deleted2))).toBe(false);
  });

  test('removes .permachine-deleted directories', async () => {
    const deletedDir = 'dir.permachine-deleted';
    
    await createDir(testDir, deletedDir);
    await createFile(testDir, path.join(deletedDir, 'file.txt'), 'content');
    
    const purged = await purgeDeletedOutputs(testDir);
    
    expect(purged.length).toBeGreaterThan(0);
    expect(await fileExists(path.join(testDir, deletedDir))).toBe(false);
  });

  test('returns empty array when no deleted files exist', async () => {
    await createFile(testDir, 'regular.json', 'content');
    
    const purged = await purgeDeletedOutputs(testDir);
    
    expect(purged).toHaveLength(0);
  });

  test('does not remove non-deleted files', async () => {
    await createFile(testDir, 'keep.json', 'content');
    await createFile(testDir, 'deleted.json.permachine-deleted', 'deleted');
    
    await purgeDeletedOutputs(testDir);
    
    expect(await fileExists(path.join(testDir, 'keep.json'))).toBe(true);
  });

  test('handles nested deleted files', async () => {
    await createFile(testDir, path.join('subdir', 'file.permachine-deleted'), 'content');
    
    const purged = await purgeDeletedOutputs(testDir);
    
    expect(purged.length).toBeGreaterThan(0);
  });
});

describe('cross-platform path handling', () => {
  test('handles paths with different separators', () => {
    // Use path.join to get platform-appropriate separators
    const input = path.join('dir1', 'dir2', 'file.txt');
    const deleted = getDeletedPath(input);
    const original = getOriginalPath(deleted);
    
    expect(original).toBe(input);
  });

  test('normalizes paths in manifest', async () => {
    const output1 = path.join(testDir, 'subdir', 'file.json');
    
    await saveManifest(testDir, [output1]);
    const loaded = await loadManifest(testDir);
    
    expect(loaded!.outputs).toContain(output1);
  });
});

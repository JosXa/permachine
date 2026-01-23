/**
 * Directory Copier - Copies entire machine-specific directories to their output locations
 * 
 * Unlike file merging, directories are copied as-is without any processing.
 * All files inside maintain their exact names and contents.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DirectoryCopyOperation } from './file-scanner.js';
import { DirectoryCopyError } from './errors.js';

/**
 * Result of a directory copy operation
 */
export interface DirectoryCopyResult {
  success: boolean;
  operation: DirectoryCopyOperation;
  filesWritten: number;
  filesUnchanged: number;
  changed: boolean;
  error?: Error;
}

/**
 * Options for directory copy operations
 */
export interface DirectoryCopyOptions {
  /** Whether to show verbose output */
  verbose?: boolean;
}

/**
 * Compare two files for equality
 */
async function filesAreEqual(path1: string, path2: string): Promise<boolean> {
  try {
    const [stat1, stat2] = await Promise.all([
      fs.stat(path1),
      fs.stat(path2),
    ]);
    
    // Quick check: different sizes means different content
    if (stat1.size !== stat2.size) {
      return false;
    }
    
    // For small files, compare content directly
    if (stat1.size < 1024 * 1024) { // 1MB
      const [content1, content2] = await Promise.all([
        fs.readFile(path1),
        fs.readFile(path2),
      ]);
      return content1.equals(content2);
    }
    
    // For larger files, compare in chunks
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const fd1 = await fs.open(path1, 'r');
    const fd2 = await fs.open(path2, 'r');
    
    try {
      const buffer1 = Buffer.alloc(CHUNK_SIZE);
      const buffer2 = Buffer.alloc(CHUNK_SIZE);
      let position = 0;
      
      while (position < stat1.size) {
        const [read1, read2] = await Promise.all([
          fd1.read(buffer1, 0, CHUNK_SIZE, position),
          fd2.read(buffer2, 0, CHUNK_SIZE, position),
        ]);
        
        if (read1.bytesRead !== read2.bytesRead) {
          return false;
        }
        
        if (!buffer1.subarray(0, read1.bytesRead).equals(buffer2.subarray(0, read2.bytesRead))) {
          return false;
        }
        
        position += read1.bytesRead;
      }
      
      return true;
    } finally {
      await fd1.close();
      await fd2.close();
    }
  } catch {
    return false;
  }
}

/**
 * Copy a single file, preserving symlinks
 */
async function copyFile(
  sourcePath: string,
  destPath: string
): Promise<{ written: boolean }> {
  // Check if source is a symlink
  const stat = await fs.lstat(sourcePath);
  
  if (stat.isSymbolicLink()) {
    // Copy symlink as symlink
    const target = await fs.readlink(sourcePath);
    
    // Check if destination already exists
    try {
      const destStat = await fs.lstat(destPath);
      if (destStat.isSymbolicLink()) {
        const destTarget = await fs.readlink(destPath);
        if (destTarget === target) {
          return { written: false }; // Unchanged
        }
      }
      // Remove existing file/symlink
      await fs.unlink(destPath);
    } catch {
      // Destination doesn't exist, that's fine
    }
    
    await fs.symlink(target, destPath);
    return { written: true };
  }
  
  // Regular file - check if content is the same
  try {
    if (await filesAreEqual(sourcePath, destPath)) {
      return { written: false }; // Unchanged
    }
  } catch {
    // Destination doesn't exist or can't be read
  }
  
  // Copy the file
  await fs.copyFile(sourcePath, destPath);
  return { written: true };
}

/**
 * Recursively walk a directory and return all files
 */
async function* walkDirectory(dir: string): AsyncGenerator<{ path: string; relativePath: string }> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath);
    } else {
      yield { path: fullPath, relativePath: entry.name };
    }
  }
}

/**
 * Recursively get all files with their relative paths
 */
async function getAllFiles(
  dir: string,
  baseDir: string = dir
): Promise<{ absolutePath: string; relativePath: string }[]> {
  const files: { absolutePath: string; relativePath: string }[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        const subFiles = await getAllFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push({ absolutePath: fullPath, relativePath });
      }
    }
  } catch {
    // Directory might not exist or be unreadable
  }
  
  return files;
}

/**
 * Copy an entire directory, preserving structure
 */
export async function performDirectoryCopy(
  operation: DirectoryCopyOperation,
  options: DirectoryCopyOptions = {}
): Promise<DirectoryCopyResult> {
  const { sourcePath, outputPath } = operation;
  
  try {
    // Get all files from source directory
    const files = await getAllFiles(sourcePath);
    
    let filesWritten = 0;
    let filesUnchanged = 0;
    
    // Create output directory
    await fs.mkdir(outputPath, { recursive: true });
    
    // Copy each file
    for (const file of files) {
      const destPath = path.join(outputPath, file.relativePath);
      const destDir = path.dirname(destPath);
      
      // Ensure destination directory exists
      await fs.mkdir(destDir, { recursive: true });
      
      // Copy the file
      const result = await copyFile(file.absolutePath, destPath);
      
      if (result.written) {
        filesWritten++;
      } else {
        filesUnchanged++;
      }
    }
    
    return {
      success: true,
      operation,
      filesWritten,
      filesUnchanged,
      changed: filesWritten > 0,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      success: false,
      operation,
      filesWritten: 0,
      filesUnchanged: 0,
      changed: false,
      error: new DirectoryCopyError(sourcePath, outputPath, err),
    };
  }
}

/**
 * Perform multiple directory copy operations
 */
export async function performAllDirectoryCopies(
  operations: DirectoryCopyOperation[],
  options: DirectoryCopyOptions = {}
): Promise<DirectoryCopyResult[]> {
  const results: DirectoryCopyResult[] = [];
  
  for (const operation of operations) {
    const result = await performDirectoryCopy(operation, options);
    results.push(result);
  }
  
  return results;
}

/**
 * Get the list of output file paths that would be created by a directory operation
 * Used for gitignore management and conflict detection
 */
export async function getDirectoryOutputFiles(
  operation: DirectoryCopyOperation
): Promise<string[]> {
  const files = await getAllFiles(operation.sourcePath);
  return files.map(f => path.join(operation.outputPath, f.relativePath));
}

/**
 * Cleanup Module - Handles stale output detection and removal
 * 
 * Tracks outputs from previous runs and renames stale outputs with
 * a .permachine-deleted suffix for easy recovery.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CleanupError } from './errors.js';

/**
 * Manifest file format for tracking outputs
 */
export interface OutputManifest {
  version: number;
  outputs: string[];
  lastRun: string;
}

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  renamedFiles: string[];
  renamedDirectories: string[];
  errors: CleanupError[];
}

/**
 * The current manifest version
 */
const MANIFEST_VERSION = 1;

/**
 * The manifest filename
 */
const MANIFEST_FILENAME = '.permachine-outputs.json';

/**
 * The suffix added to stale outputs
 */
const DELETED_SUFFIX = '.permachine-deleted';

/**
 * Get the path to the manifest file
 */
export function getManifestPath(cwd: string): string {
  return path.join(cwd, MANIFEST_FILENAME);
}

/**
 * Get the deleted path for a stale output
 * 
 * Example:
 *   getDeletedPath('config.json') -> 'config.json.permachine-deleted'
 *   getDeletedPath('jira') -> 'jira.permachine-deleted'
 */
export function getDeletedPath(originalPath: string): string {
  return originalPath + DELETED_SUFFIX;
}

/**
 * Check if a path is a permachine-deleted path
 */
export function isDeletedPath(pathStr: string): boolean {
  return pathStr.endsWith(DELETED_SUFFIX);
}

/**
 * Get the original path from a deleted path
 */
export function getOriginalPath(deletedPath: string): string {
  if (!isDeletedPath(deletedPath)) {
    return deletedPath;
  }
  return deletedPath.slice(0, -DELETED_SUFFIX.length);
}

/**
 * Load the output manifest from disk
 */
export async function loadManifest(cwd: string): Promise<OutputManifest | null> {
  const manifestPath = getManifestPath(cwd);
  
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as OutputManifest;
    
    // Version check
    if (manifest.version !== MANIFEST_VERSION) {
      // Future: handle version migrations
      return null;
    }
    
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Save the output manifest to disk
 */
export async function saveManifest(
  cwd: string,
  outputs: string[]
): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  
  const manifest: OutputManifest = {
    version: MANIFEST_VERSION,
    outputs,
    lastRun: new Date().toISOString(),
  };
  
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Update the output manifest with the current outputs
 */
export async function updateOutputManifest(
  outputs: string[],
  cwd: string
): Promise<void> {
  await saveManifest(cwd, outputs);
}

/**
 * Rename a file or directory to mark it as deleted
 */
async function renameToDeleted(
  originalPath: string
): Promise<{ success: boolean; isDirectory: boolean; error?: Error }> {
  const deletedPath = getDeletedPath(originalPath);
  
  try {
    // Check if the path exists
    const stat = await fs.stat(originalPath);
    const isDirectory = stat.isDirectory();
    
    // Check if deleted path already exists - if so, remove it first
    try {
      const deletedStat = await fs.stat(deletedPath);
      if (deletedStat.isDirectory()) {
        await fs.rm(deletedPath, { recursive: true });
      } else {
        await fs.unlink(deletedPath);
      }
    } catch {
      // Deleted path doesn't exist, that's fine
    }
    
    // Rename the original to deleted
    await fs.rename(originalPath, deletedPath);
    
    return { success: true, isDirectory };
  } catch (error) {
    return { 
      success: false, 
      isDirectory: false, 
      error: error instanceof Error ? error : new Error(String(error)) 
    };
  }
}

/**
 * Check if a path exists (file or directory)
 */
async function pathExists(pathStr: string): Promise<boolean> {
  try {
    await fs.access(pathStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find and rename stale outputs
 * 
 * Compares current outputs with previous manifest and renames any
 * outputs that no longer exist in the current set.
 */
export async function cleanupStaleOutputs(
  currentOutputs: string[],
  cwd: string
): Promise<CleanupResult> {
  const result: CleanupResult = {
    renamedFiles: [],
    renamedDirectories: [],
    errors: [],
  };
  
  // Load previous manifest
  const previousManifest = await loadManifest(cwd);
  
  if (!previousManifest) {
    // No previous manifest - nothing to clean up
    // Just save the current outputs
    await saveManifest(cwd, currentOutputs);
    return result;
  }
  
  // Normalize paths for comparison
  const currentSet = new Set(currentOutputs.map(p => path.normalize(p)));
  const previousOutputs = previousManifest.outputs.map(p => path.normalize(p));
  
  // Find stale outputs
  const staleOutputs = previousOutputs.filter(p => !currentSet.has(p));
  
  // Rename stale outputs
  for (const stalePath of staleOutputs) {
    // Check if the stale output still exists
    if (!await pathExists(stalePath)) {
      continue; // Already gone, skip
    }
    
    const renameResult = await renameToDeleted(stalePath);
    
    if (renameResult.success) {
      if (renameResult.isDirectory) {
        result.renamedDirectories.push(stalePath);
      } else {
        result.renamedFiles.push(stalePath);
      }
    } else if (renameResult.error) {
      result.errors.push(new CleanupError(stalePath, renameResult.error));
    }
  }
  
  // Save the current manifest
  await saveManifest(cwd, currentOutputs);
  
  return result;
}

/**
 * Restore a deleted output back to its original location
 */
export async function restoreDeletedOutput(deletedPath: string): Promise<boolean> {
  if (!isDeletedPath(deletedPath)) {
    return false;
  }
  
  const originalPath = getOriginalPath(deletedPath);
  
  try {
    // Check if deleted path exists
    await fs.access(deletedPath);
    
    // Check if original path already exists
    try {
      await fs.access(originalPath);
      // Original exists, can't restore
      return false;
    } catch {
      // Original doesn't exist, safe to restore
    }
    
    await fs.rename(deletedPath, originalPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Permanently remove all .permachine-deleted files/directories in a directory
 */
export async function purgeDeletedOutputs(cwd: string): Promise<string[]> {
  const purged: string[] = [];
  
  const { glob } = await import('glob');
  
  try {
    const deletedPaths = await glob(`**/*${DELETED_SUFFIX}`, {
      cwd,
      ignore: ['node_modules/**', '.git/**'],
      dot: true,
    });
    
    for (const deletedPath of deletedPaths) {
      const fullPath = path.join(cwd, deletedPath);
      
      try {
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true });
        } else {
          await fs.unlink(fullPath);
        }
        
        purged.push(deletedPath);
      } catch {
        // Ignore errors during purge
      }
    }
  } catch {
    // Ignore glob errors
  }
  
  return purged;
}

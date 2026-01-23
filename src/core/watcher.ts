import chokidar from 'chokidar';
import path from 'node:path';
import type { MergeOperation, DirectoryCopyOperation } from './file-scanner.js';
import { scanForMergeOperations, scanAllOperations, getFilteredDirectoryPaths } from './file-scanner.js';
import { performMerge } from './merger.js';
import { performDirectoryCopy } from './directory-copier.js';
import { logger } from '../utils/logger.js';

export interface WatchOptions {
  debounce?: number;
  verbose?: boolean;
  cwd?: string;
}

interface WatcherState {
  operations: MergeOperation[];
  directoryOperations: DirectoryCopyOperation[];
  debounceTimers: Map<string, NodeJS.Timeout>;
  operationsByPath: Map<string, MergeOperation[]>;
  directorySourcePaths: Set<string>;  // Paths to machine-specific directories
}

/**
 * Format timestamp for log messages
 */
function formatTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Build a map of file paths to their associated operations
 */
function buildOperationMap(operations: MergeOperation[]): Map<string, MergeOperation[]> {
  const map = new Map<string, MergeOperation[]>();
  
  for (const op of operations) {
    // Map base file -> operation
    if (op.basePath) {
      const existing = map.get(op.basePath) || [];
      existing.push(op);
      map.set(op.basePath, existing);
    }
    
    // Map machine file -> operation
    const existing = map.get(op.machinePath) || [];
    existing.push(op);
    map.set(op.machinePath, existing);
  }
  
  return map;
}

/**
 * Get all files to watch from operations
 */
function getWatchPaths(operations: MergeOperation[]): string[] {
  const paths = new Set<string>();
  
  for (const op of operations) {
    if (op.basePath) {
      paths.add(op.basePath);
    }
    paths.add(op.machinePath);
  }
  
  return Array.from(paths);
}

/**
 * Get all directory paths to watch (contents of machine-specific directories)
 */
function getDirectoryWatchPatterns(directoryOperations: DirectoryCopyOperation[]): string[] {
  const patterns: string[] = [];
  
  for (const op of directoryOperations) {
    // Watch all files inside the source directory
    patterns.push(path.join(op.sourcePath, '**', '*'));
  }
  
  return patterns;
}

/**
 * Find which directory operation is affected by a file change
 */
function findAffectedDirectoryOperation(
  changedPath: string,
  directoryOperations: DirectoryCopyOperation[]
): DirectoryCopyOperation | null {
  const normalizedPath = path.normalize(changedPath);
  
  for (const op of directoryOperations) {
    const normalizedSource = path.normalize(op.sourcePath);
    if (normalizedPath.startsWith(normalizedSource + path.sep) ||
        normalizedPath === normalizedSource) {
      return op;
    }
  }
  
  return null;
}

/**
 * Perform merge for a specific changed file
 */
async function handleFileChange(
  changedPath: string,
  state: WatcherState,
  options: WatchOptions
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const relPath = path.relative(cwd, changedPath);
  
  if (!logger.isSilent() && !options.verbose) {
    console.log(`[${formatTime()}] Changed: ${relPath}`);
  }
  
  // Check if this is inside a machine-specific directory
  const affectedDirOp = findAffectedDirectoryOperation(changedPath, state.directoryOperations);
  
  if (affectedDirOp) {
    // This file is inside a machine-specific directory - re-copy the whole directory
    const result = await performDirectoryCopy(affectedDirOp);
    
    if (result.success && result.changed) {
      const srcName = path.basename(affectedDirOp.sourcePath);
      const outName = path.basename(affectedDirOp.outputPath);
      
      if (!logger.isSilent()) {
        console.log(`[${formatTime()}] Copied ${srcName}/ -> ${outName}/ (${result.filesWritten} file(s))`);
      }
    } else if (!result.success && result.error) {
      logger.error(`Failed to copy directory: ${result.error.message}`);
    } else if (options.verbose && !result.changed) {
      logger.info(`No changes needed for ${path.basename(affectedDirOp.outputPath)}/`);
    }
    
    if (!logger.isSilent() && !options.verbose) {
      console.log('Ready\n');
    }
    return;
  }
  
  // Find all operations affected by this file
  const affectedOps = state.operationsByPath.get(changedPath) || [];
  
  if (affectedOps.length === 0) {
    if (options.verbose) {
      logger.warn(`No operations found for ${relPath}`);
    }
    return;
  }
  
  // Perform merges for all affected operations
  for (const op of affectedOps) {
    const result = await performMerge(op);
    
    if (result.success && result.changed) {
      const baseFile = op.basePath ? path.basename(op.basePath) : '';
      const machineFile = path.basename(op.machinePath);
      const outputFile = path.basename(op.outputPath);
      
      if (!logger.isSilent()) {
        if (baseFile) {
          console.log(`[${formatTime()}] Merged ${baseFile} + ${machineFile} -> ${outputFile}`);
        } else {
          console.log(`[${formatTime()}] Copied ${machineFile} -> ${outputFile}`);
        }
      }
    } else if (!result.success && result.error) {
      logger.error(`Failed to merge: ${result.error.message}`);
    } else if (options.verbose && !result.changed) {
      logger.info(`No changes needed for ${path.basename(op.outputPath)}`);
    }
  }
  
  if (!logger.isSilent() && !options.verbose) {
    console.log('Ready\n');
  }
}

/**
 * Start watching files for changes
 */
export async function startWatcher(
  machineName: string,
  options: WatchOptions = {}
): Promise<() => void> {
  const cwd = options.cwd || process.cwd();
  const debounceMs = options.debounce ?? 300;
  
  // Use unified scanning to get both file and directory operations
  const { mergeOperations, directoryOperations } = await scanAllOperations(machineName, cwd);
  
  if (mergeOperations.length === 0 && directoryOperations.length === 0) {
    logger.warn('No machine-specific files or directories found to watch');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Create base config files (e.g., config.base.json)');
    logger.info(`2. Create machine-specific configs (e.g., config.{machine=${machineName}}.json)`);
    logger.info('3. Or create machine-specific directories (e.g., mydir.{machine=' + machineName + '}/)');
    logger.info('4. Run: permachine watch');
    return () => {};
  }
  
  // Build state
  const state: WatcherState = {
    operations: mergeOperations,
    directoryOperations,
    debounceTimers: new Map(),
    operationsByPath: buildOperationMap(mergeOperations),
    directorySourcePaths: new Set(directoryOperations.map(op => op.sourcePath)),
  };
  
  // Get all paths to watch
  const fileWatchPaths = getWatchPaths(mergeOperations);
  const dirWatchPatterns = getDirectoryWatchPatterns(directoryOperations);
  const allWatchPaths = [...fileWatchPaths, ...dirWatchPatterns];
  
  // Show what we're watching
  logger.success(`Machine detected: ${machineName}`);
  if (!logger.isSilent()) {
    console.log(`Watching ${fileWatchPaths.length} file(s) and ${directoryOperations.length} directory(ies) for changes...`);
    for (const watchPath of fileWatchPaths) {
      console.log(`  - ${path.relative(cwd, watchPath)}`);
    }
    for (const op of directoryOperations) {
      console.log(`  - ${path.relative(cwd, op.sourcePath)}${path.sep}**`);
    }
    console.log('');
  }
  
  // Create watcher
  const watcher = chokidar.watch(allWatchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  
  // Handle file changes with debouncing
  watcher.on('change', (changedPath: string) => {
    const absolutePath = path.resolve(cwd, changedPath);
    
    if (options.verbose) {
      logger.info(`File changed: ${path.relative(cwd, absolutePath)}`);
    }
    
    // Clear existing debounce timer for this file
    const existingTimer = state.debounceTimers.get(absolutePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounce timer
    const timer = setTimeout(async () => {
      state.debounceTimers.delete(absolutePath);
      await handleFileChange(absolutePath, state, options);
    }, debounceMs);
    
    state.debounceTimers.set(absolutePath, timer);
  });
  
  // Handle new files being added
  watcher.on('add', async (addedPath: string) => {
    const absolutePath = path.resolve(cwd, addedPath);
    
    if (options.verbose) {
      logger.info(`File added: ${path.relative(cwd, absolutePath)}`);
    }
    
    // Re-scan for operations in case a new base/machine file was added
    const { mergeOperations: newMergeOps, directoryOperations: newDirOps } = 
      await scanAllOperations(machineName, cwd);
    state.operations = newMergeOps;
    state.directoryOperations = newDirOps;
    state.operationsByPath = buildOperationMap(newMergeOps);
    state.directorySourcePaths = new Set(newDirOps.map(op => op.sourcePath));
    
    // Trigger merge for the new file
    await handleFileChange(absolutePath, state, options);
  });
  
  // Handle file deletion
  watcher.on('unlink', (deletedPath: string) => {
    if (options.verbose) {
      const relPath = path.relative(cwd, deletedPath);
      logger.warn(`File deleted: ${relPath}`);
      logger.info('Run merge manually or restart watch to update operations');
    }
  });
  
  // Handle errors
  watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Watcher error: ${message}`);
  });
  
  // Return cleanup function
  return async () => {
    // Clear all debounce timers
    for (const timer of state.debounceTimers.values()) {
      clearTimeout(timer);
    }
    state.debounceTimers.clear();
    
    // Close watcher
    await watcher.close();
    
    if (!logger.isSilent()) {
      console.log('Stopped watching');
    }
  };
}

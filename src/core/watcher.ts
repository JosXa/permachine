import chokidar from 'chokidar';
import path from 'node:path';
import type { MergeOperation } from './file-scanner.js';
import { scanForMergeOperations } from './file-scanner.js';
import { performMerge } from './merger.js';
import { logger } from '../utils/logger.js';

export interface WatchOptions {
  debounce?: number;
  verbose?: boolean;
  cwd?: string;
}

interface WatcherState {
  operations: MergeOperation[];
  debounceTimers: Map<string, NodeJS.Timeout>;
  operationsByPath: Map<string, MergeOperation[]>;
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
 * Perform merge for a specific changed file
 */
async function handleFileChange(
  changedPath: string,
  state: WatcherState,
  options: WatchOptions
): Promise<void> {
  const relPath = path.relative(options.cwd || process.cwd(), changedPath);
  
  if (!logger.isSilent() && !options.verbose) {
    console.log(`[${formatTime()}] Changed: ${relPath}`);
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
          console.log(`[${formatTime()}] Merged ${baseFile} + ${machineFile} → ${outputFile}`);
        } else {
          console.log(`[${formatTime()}] Copied ${machineFile} → ${outputFile}`);
        }
      }
    } else if (!result.success && result.error) {
      logger.error(`Failed to merge: ${result.error.message}`);
    } else if (options.verbose && !result.changed) {
      logger.info(`No changes needed for ${path.basename(op.outputPath)}`);
    }
  }
  
  if (!logger.isSilent() && !options.verbose) {
    console.log('✓ Ready\n');
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
  
  // Initial scan for operations
  const operations = await scanForMergeOperations(machineName, cwd);
  
  if (operations.length === 0) {
    logger.warn('No machine-specific files found to watch');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Create base config files (e.g., config.base.json)');
    logger.info(`2. Create machine-specific configs (e.g., config.${machineName}.json)`);
    logger.info('3. Run: permachine watch');
    return () => {};
  }
  
  // Build state
  const state: WatcherState = {
    operations,
    debounceTimers: new Map(),
    operationsByPath: buildOperationMap(operations),
  };
  
  const watchPaths = getWatchPaths(operations);
  
  // Show what we're watching
  logger.success(`Machine detected: ${machineName}`);
  if (!logger.isSilent()) {
    console.log(`✓ Watching ${watchPaths.length} file(s) for changes...`);
    for (const watchPath of watchPaths) {
      console.log(`  - ${path.relative(cwd, watchPath)}`);
    }
    console.log('');
  }
  
  // Create watcher
  const watcher = chokidar.watch(watchPaths, {
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
    const newOperations = await scanForMergeOperations(machineName, cwd);
    state.operations = newOperations;
    state.operationsByPath = buildOperationMap(newOperations);
    
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
  watcher.on('error', (error: Error) => {
    logger.error(`Watcher error: ${error.message}`);
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
      console.log('✓ Stopped watching');
    }
  };
}

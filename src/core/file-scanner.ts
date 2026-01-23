import { glob } from 'glob';
import path from 'node:path';
import fs from 'node:fs/promises';
import { 
  hasFilters, 
  parseFilters, 
  isMatch, 
  getBaseFilename,
  isLegacyFilename,
  convertLegacyFilename,
  createCustomContext,
  matchFilters,
  isBaseFile,
  isFilteredDirectory,
  matchDirectoryFilters,
  getBaseDirectoryName,
  isBaseDirectory,
  type FilterContext,
} from './file-filters.js';
import { getMachineName } from './machine-detector.js';
import { getFileType } from '../adapters/adapter-factory.js';
import {
  NestedFilteredDirectoryError,
  DirectoryConflictError,
  BaseDirectoryNotSupportedError,
  FileDirectoryConflictError,
} from './errors.js';

export interface MergeOperation {
  basePath: string | null;      // May not exist
  machinePath: string;           // Always exists (we found it)
  outputPath: string;
  type: 'json' | 'env' | 'unknown';
}

/**
 * A directory copy operation - copies entire directory contents as-is
 */
export interface DirectoryCopyOperation {
  sourcePath: string;        // Absolute path to machine-specific directory
  outputPath: string;        // Absolute path to output directory
  type: 'directory';
}

/**
 * Combined scan result containing both file merge and directory copy operations
 */
export interface ScanResult {
  mergeOperations: MergeOperation[];
  directoryOperations: DirectoryCopyOperation[];
}

/**
 * Scan for all files matching the machine-specific pattern
 * Returns array of merge operations needed
 * 
 * Supports both:
 * - Legacy: filename.{machine}.ext
 * - New: filename.{os=windows}.ext, filename.{machine=name}{user=josxa}.ext
 */
export async function scanForMergeOperations(
  machineName: string,
  cwd: string = process.cwd()
): Promise<MergeOperation[]> {
  const operations: MergeOperation[] = [];
  const processedOutputs = new Set<string>(); // Track outputs to avoid duplicates
  const baseFilesWithMachineFiles = new Set<string>(); // Track base files that have machine-specific versions
  
  // Patterns to find machine-specific files:
  // 1. New filter syntax: **/*{*}*
  // 2. Legacy syntax: **/*.{machine}.*
  const patterns = [
    '**/*{*}*',                    // New syntax with filters
    `**/*.${machineName}.*`,       // Legacy: config.homezone.json
    `**/.*.${machineName}`,        // Legacy: .env.homezone
    `**/.*.${machineName}.*`,      // Legacy: .gitconfig.homezone
  ];

  const foundFiles: string[] = [];
  
  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        cwd,
        ignore: ['node_modules/**', '.git/**', 'dist/**', '**/*.base.*', '**/.*base*'],
        dot: true,
        nodir: true,
      });
      foundFiles.push(...files);
    } catch (error) {
      // Ignore glob errors, continue with other patterns
    }
  }

  // Remove duplicates
  const uniqueFiles = [...new Set(foundFiles)];

  // Create custom context with the provided machine name
  const context = createCustomContext({ machine: machineName });

  // Filter files that match current context
  for (const file of uniqueFiles) {
    // Check if this file uses new filter syntax and matches current context
    const basename = path.basename(file);
    
    // Skip base files
    if (isBaseFile(basename)) {
      continue;
    }
    
    let shouldProcess = false;
    
    if (hasFilters(basename)) {
      // New syntax - check if it matches current context with custom machine name
      const result = matchFilters(basename, context);
      shouldProcess = result.matches;
      
      // Even if it doesn't match, track that this base file has machine-specific versions
      const operation = createMergeOperation(file, machineName, cwd);
      if (operation && operation.basePath) {
        baseFilesWithMachineFiles.add(operation.basePath);
      }
    } else if (isLegacyFilename(basename, machineName)) {
      // Legacy syntax - always process if it matches machine name
      shouldProcess = true;
      
      // Track that this base file has machine-specific versions
      const operation = createMergeOperation(file, machineName, cwd);
      if (operation && operation.basePath) {
        baseFilesWithMachineFiles.add(operation.basePath);
      }
    }
    
    if (shouldProcess) {
      const operation = createMergeOperation(file, machineName, cwd);
      if (operation) {
        operations.push(operation);
        processedOutputs.add(operation.outputPath);
      }
    }
  }

  // Also scan for base files that don't have a corresponding machine-specific file
  const basePatterns = [
    '**/*.base.json',
    '**/*.base.jsonc',
    '**/.*.base',
    '**/.*.base.*',
  ];
  
  for (const pattern of basePatterns) {
    try {
      const baseFiles = await glob(pattern, {
        cwd,
        ignore: ['node_modules/**', '.git/**', 'dist/**'],
        dot: true,
        nodir: true,
      });
      
      for (const baseFile of baseFiles) {
        const fullPath = path.join(cwd, baseFile);
        
        // Skip if this base file has machine-specific versions
        if (baseFilesWithMachineFiles.has(fullPath)) {
          continue;
        }
        
        const operation = createBaseOnlyMergeOperation(baseFile, cwd);
        if (operation && !processedOutputs.has(operation.outputPath)) {
          operations.push(operation);
          processedOutputs.add(operation.outputPath);
        }
      }
    } catch (error) {
      // Ignore glob errors
    }
  }

  return operations;
}

/**
 * Create a merge operation from a base file when no machine-specific file exists
 */
function createBaseOnlyMergeOperation(
  baseFile: string,
  cwd: string
): MergeOperation | null {
  const dir = path.dirname(baseFile);
  const fullBasename = path.basename(baseFile);

  // Determine file type using centralized logic
  const type = getFileType(fullBasename);

  // Only handle supported types
  if (type === 'unknown') {
    return null;
  }

  // Derive output name from base name
  let outputName: string;
  
  if (type === 'env') {
    // .env.base -> .env
    // .env.{base} -> .env
    outputName = fullBasename.replace('.base', '').replace('.{base}', '');
  } else {
    // config.base.json -> config.json
    // config.base.jsonc -> config.json (always output .json, not .jsonc)
    outputName = fullBasename.replace('.base', '').replace('.{base}', '');
    // Normalize .jsonc to .json for output
    if (outputName.endsWith('.jsonc')) {
      outputName = outputName.replace(/\.jsonc$/, '.json');
    }
  }

  // Construct full paths
  const basePath = path.join(cwd, baseFile);
  const outputPath = path.join(cwd, dir, outputName);

  return {
    basePath,
    machinePath: '', // No machine-specific file exists
    outputPath,
    type,
  };
}

/**
 * Create a merge operation from a machine-specific file
 * Handles both legacy (.machine.) and new ({filter}) syntax
 */
function createMergeOperation(
  machineFile: string,
  machineName: string,
  cwd: string
): MergeOperation | null {
  const dir = path.dirname(machineFile);
  const fullBasename = path.basename(machineFile);

  // Determine file type using centralized logic
  const type = getFileType(fullBasename);
  const ext = path.extname(machineFile);

  // Only handle supported types
  if (type === 'unknown') {
    return null;
  }

  // Use the new file-filters system to determine base and output names
  let baseName: string;
  let outputName: string;

  if (hasFilters(fullBasename)) {
    // New syntax: config.{os=windows}.json -> config.json
    // New syntax: config.{os=windows}.jsonc -> config.json
    outputName = getBaseFilename(fullBasename);
    
    // Normalize .jsonc to .json for output
    if (type === 'json' && outputName.endsWith('.jsonc')) {
      outputName = outputName.replace(/\.jsonc$/, '.json');
    }
    
    // For new syntax, the base file is the output name with .base inserted before extension
    if (type === 'env') {
      // .env.{machine=homezone} -> .env.base
      const nameWithoutExt = outputName;
      baseName = nameWithoutExt + '.base';
    } else {
      // config.json -> config.base.json
      // config.jsonc -> config.base.jsonc (base keeps .jsonc, output is .json)
      const nameWithoutExt = outputName.replace(/\.(json|jsonc)$/, '');
      baseName = nameWithoutExt + '.base' + ext;
    }
  } else {
    // Legacy syntax: config.homezone.json
    const basename = type === 'env' ? fullBasename : path.basename(machineFile, ext);
    const machinePattern = `.${machineName}`;
    
    if (basename.endsWith(machinePattern)) {
      // Remove .{machine} from basename
      const withoutMachine = basename.substring(0, basename.length - machinePattern.length);
      baseName = withoutMachine + '.base';
      outputName = withoutMachine;
      
      // Add extension back for non-env files
      if (type !== 'env') {
        baseName = baseName + ext;
        // Normalize .jsonc to .json for output
        const outputExt = ext === '.jsonc' ? '.json' : ext;
        outputName = outputName + outputExt;
      }
    } else {
      // Shouldn't happen if filtering is correct
      return null;
    }
  }

  // Construct full paths
  const basePath = path.join(cwd, dir, baseName);
  const machinePath = path.join(cwd, machineFile);
  const outputPath = path.join(cwd, dir, outputName);

  return {
    basePath,
    machinePath,
    outputPath,
    type,
  };
}

// ============================================================================
// Directory Scanning
// ============================================================================

/**
 * Scan for machine-specific directories
 * Returns array of directory copy operations for matching directories
 */
export async function scanForDirectoryOperations(
  machineName: string,
  cwd: string = process.cwd()
): Promise<DirectoryCopyOperation[]> {
  const operations: DirectoryCopyOperation[] = [];
  const context = createCustomContext({ machine: machineName });
  
  // Find all directories with filter syntax
  const pattern = '**/*{*}*';
  
  try {
    // Note: onlyDirectories is a valid glob option but not in @types/glob
    const potentialDirs = await glob(pattern, {
      cwd,
      ignore: ['node_modules/**', '.git/**', 'dist/**'],
      onlyDirectories: true,
      dot: true,
    } as Parameters<typeof glob>[1]);
    
    // Filter to only actual directories (workaround for glob bug on Windows
    // where files with {*} in name are incorrectly returned with onlyDirectories)
    const dirs: string[] = [];
    for (const entry of potentialDirs) {
      const entryStr = String(entry);
      const fullPath = path.join(cwd, entryStr);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          dirs.push(entryStr);
        }
      } catch {
        // Skip entries that can't be stat'd
      }
    }
    
    for (const dir of dirs) {
      const dirname = path.basename(dir);
      const parentDir = path.dirname(dir);
      
      // Check if this is a filtered directory
      if (!isFilteredDirectory(dirname)) {
        continue;
      }
      
      // Check for base directory pattern (not supported)
      if (isBaseDirectory(dirname)) {
        throw new BaseDirectoryNotSupportedError(dir);
      }
      
      // Check for nested filtered directories
      await validateNoNestedFilters(dir, cwd);
      
      // Check if this directory matches the current context
      const result = matchDirectoryFilters(dirname, context);
      if (!result.matches) {
        continue;
      }
      
      // Create the operation
      const baseDir = getBaseDirectoryName(dirname);
      const sourcePath = path.join(cwd, dir);
      const outputPath = path.join(cwd, parentDir, baseDir);
      
      operations.push({
        sourcePath,
        outputPath,
        type: 'directory',
      });
    }
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof NestedFilteredDirectoryError ||
        error instanceof BaseDirectoryNotSupportedError) {
      throw error;
    }
    // Ignore other glob errors
  }
  
  // Validate no conflicts between matching directories
  validateNoDirectoryConflicts(operations);
  
  return operations;
}

/**
 * Validate that a directory path doesn't contain nested filtered directories
 */
async function validateNoNestedFilters(dirPath: string, cwd: string): Promise<void> {
  const parts = dirPath.split(/[/\\]/);
  let filteredAncestor: string | null = null;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (isFilteredDirectory(part)) {
      if (filteredAncestor !== null) {
        // Found a nested filtered directory
        const outerPath = parts.slice(0, parts.indexOf(filteredAncestor) + 1).join('/');
        throw new NestedFilteredDirectoryError(outerPath, dirPath);
      }
      filteredAncestor = part;
    }
  }
}

/**
 * Validate that no two directory operations would output to the same path
 */
function validateNoDirectoryConflicts(operations: DirectoryCopyOperation[]): void {
  const outputMap = new Map<string, string[]>();
  
  for (const op of operations) {
    const existing = outputMap.get(op.outputPath) || [];
    existing.push(op.sourcePath);
    outputMap.set(op.outputPath, existing);
  }
  
  for (const [output, sources] of outputMap.entries()) {
    if (sources.length > 1) {
      throw new DirectoryConflictError(output, sources);
    }
  }
}

/**
 * Get the set of directories that are machine-specific (have filters)
 * Used to exclude files inside these directories from regular file scanning
 */
export async function getFilteredDirectoryPaths(
  cwd: string = process.cwd()
): Promise<Set<string>> {
  const filteredDirs = new Set<string>();
  
  const pattern = '**/*{*}*';
  
  try {
    // Note: onlyDirectories is a valid glob option but not in @types/glob
    const potentialDirs = await glob(pattern, {
      cwd,
      ignore: ['node_modules/**', '.git/**', 'dist/**'],
      onlyDirectories: true,
      dot: true,
    } as Parameters<typeof glob>[1]);
    
    // Filter to only actual directories (workaround for glob bug on Windows)
    for (const entry of potentialDirs) {
      const entryStr = String(entry);
      const fullPath = path.join(cwd, entryStr);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const dirname = path.basename(entryStr);
          if (isFilteredDirectory(dirname)) {
            filteredDirs.add(fullPath);
          }
        }
      } catch {
        // Skip entries that can't be stat'd
      }
    }
  } catch {
    // Ignore glob errors
  }
  
  return filteredDirs;
}

/**
 * Check if a file path is inside a filtered directory
 */
export function isInsideFilteredDirectory(
  filePath: string,
  filteredDirs: Set<string>
): boolean {
  const normalizedPath = path.normalize(filePath);
  
  for (const dir of filteredDirs) {
    const normalizedDir = path.normalize(dir);
    if (normalizedPath.startsWith(normalizedDir + path.sep) || 
        normalizedPath === normalizedDir) {
      return true;
    }
  }
  
  return false;
}

/**
 * Validate no conflicts between file merge operations and directory copy operations
 */
export function validateNoFileDirectoryConflicts(
  mergeOperations: MergeOperation[],
  directoryOperations: DirectoryCopyOperation[]
): void {
  // Build a set of all file output paths
  const fileOutputs = new Map<string, string>();
  for (const op of mergeOperations) {
    fileOutputs.set(op.outputPath, op.machinePath);
  }
  
  // Check each directory operation for conflicts
  // A directory operation at path X would produce files at X/*
  // If any file output starts with X/, there's a conflict
  for (const dirOp of directoryOperations) {
    const dirOutputPath = dirOp.outputPath;
    
    for (const [fileOutput, fileSource] of fileOutputs.entries()) {
      // Check if file output is inside or equal to directory output
      const normalizedDir = path.normalize(dirOutputPath);
      const normalizedFile = path.normalize(fileOutput);
      
      if (normalizedFile.startsWith(normalizedDir + path.sep)) {
        throw new FileDirectoryConflictError(
          fileOutput,
          fileSource,
          dirOp.sourcePath
        );
      }
    }
  }
}

/**
 * Unified scan function that returns both file and directory operations
 */
export async function scanAllOperations(
  machineName: string,
  cwd: string = process.cwd()
): Promise<ScanResult> {
  // First, get all filtered directories so we can exclude files inside them
  const filteredDirs = await getFilteredDirectoryPaths(cwd);
  
  // Scan for directory operations
  const directoryOperations = await scanForDirectoryOperations(machineName, cwd);
  
  // Scan for file merge operations (excluding files inside filtered directories)
  const allMergeOperations = await scanForMergeOperations(machineName, cwd);
  
  // Filter out any merge operations for files inside filtered directories
  const mergeOperations = allMergeOperations.filter(op => {
    // Check both machinePath and basePath - if either is inside a filtered directory, exclude
    const machinePath = op.machinePath;
    const basePath = op.basePath;
    
    if (machinePath && isInsideFilteredDirectory(machinePath, filteredDirs)) {
      return false;
    }
    if (basePath && isInsideFilteredDirectory(basePath, filteredDirs)) {
      return false;
    }
    return true;
  });
  
  // Validate no conflicts between file and directory operations
  validateNoFileDirectoryConflicts(mergeOperations, directoryOperations);
  
  return {
    mergeOperations,
    directoryOperations,
  };
}


import { glob } from 'glob';
import path from 'node:path';
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
} from './file-filters.js';
import { getMachineName } from './machine-detector.js';

export interface MergeOperation {
  basePath: string | null;      // May not exist
  machinePath: string;           // Always exists (we found it)
  outputPath: string;
  type: 'json' | 'env' | 'md' | 'unknown';
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
    const basename = path.basename(file);
    
    // Skip base files (both legacy .base and new {base} syntax)
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
    '**/*.base.md',
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

  // Determine file type
  let type: 'json' | 'env' | 'md' | 'unknown';
  let ext: string;
  
  if (fullBasename.endsWith('.base.json')) {
    type = 'json';
    ext = '.json';
  } else if (fullBasename.startsWith('.') && fullBasename.includes('.base')) {
    type = 'env';
    ext = '';
  } else if (fullBasename.endsWith('.base.md')) {
    type = 'md';
    ext = '.md';
  } else {
    type = 'unknown';
    ext = path.extname(baseFile);
  }

  // Only handle supported types
  if (type === 'unknown') {
    return null;
  }

  // Derive output name from base name
  let outputName: string;
  
  if (type === 'env') {
    // .env.base -> .env
    outputName = fullBasename.replace('.base', '');
  } else {
    // config.base.json -> config.json
    outputName = fullBasename.replace('.base', '');
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

  // Determine file type by looking at the full filename pattern
  let type: 'json' | 'env' | 'md' | 'unknown';
  let ext: string;
  
  if (fullBasename.endsWith('.json')) {
    type = 'json';
    ext = '.json';
  } else if (fullBasename.startsWith('.env')) {
    type = 'env';
    ext = ''; // .env files don't have a traditional extension
  } else if (fullBasename.endsWith('.md')) {
    type = 'md';
    ext = '.md';
  } else {
    type = 'unknown';
    ext = path.extname(machineFile);
  }

  // Only handle supported types
  if (type === 'unknown') {
    return null;
  }

  // Use the new file-filters system to determine base and output names
  let baseName: string;
  let outputName: string;

  if (hasFilters(fullBasename)) {
    // New syntax: config.{os=windows}.json -> config.json
    outputName = getBaseFilename(fullBasename);
    
    // For new syntax, the base file is the output name with .base inserted before extension
    if (type === 'env') {
      // .env.{machine=homezone} -> .env.base
      const nameWithoutExt = outputName;
      baseName = nameWithoutExt + '.base';
    } else {
      // config.json -> config.base.json
      const nameWithoutExt = outputName.replace(ext, '');
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
        outputName = outputName + ext;
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

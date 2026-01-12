import { glob } from 'glob';
import path from 'node:path';

export interface MergeOperation {
  basePath: string | null;      // May not exist
  machinePath: string;           // Always exists (we found it)
  outputPath: string;
  type: 'json' | 'env' | 'unknown';
}

/**
 * Scan for all files matching the machine-specific pattern
 * Returns array of merge operations needed
 */
export async function scanForMergeOperations(
  machineName: string,
  cwd: string = process.cwd()
): Promise<MergeOperation[]> {
  const operations: MergeOperation[] = [];
  
  // Patterns to match:
  // - filename.{machine}.ext (e.g., config.homezone.json)
  // - .filename.{machine} (e.g., .env.homezone)
  const patterns = [
    `**/*.${machineName}.*`,
    `**/.*.${machineName}`,
    `**/.*.${machineName}.*`,
  ];

  const foundFiles: string[] = [];
  
  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        cwd,
        ignore: ['node_modules/**', '.git/**', 'dist/**'],
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

  for (const file of uniqueFiles) {
    const operation = createMergeOperation(file, machineName, cwd);
    if (operation) {
      operations.push(operation);
    }
  }

  return operations;
}

/**
 * Create a merge operation from a machine-specific file
 */
function createMergeOperation(
  machineFile: string,
  machineName: string,
  cwd: string
): MergeOperation | null {
  const dir = path.dirname(machineFile);
  const fullBasename = path.basename(machineFile);

  // Determine file type by looking at the full filename pattern
  // For .env.homezone, we need to check if it starts with .env
  let type: 'json' | 'env' | 'unknown';
  let ext: string;
  
  if (fullBasename.endsWith('.json')) {
    type = 'json';
    ext = '.json';
  } else if (fullBasename.startsWith('.env')) {
    type = 'env';
    ext = ''; // .env files don't have a traditional extension
  } else {
    type = 'unknown';
    ext = path.extname(machineFile);
  }

  // Only handle supported types
  if (type === 'unknown') {
    return null;
  }

  const basename = type === 'env' ? fullBasename : path.basename(machineFile, ext);

  // Derive base and output file names
  // Examples:
  //   config.homezone.json -> config.base.json, config.json
  //   .env.homezone -> .env.base, .env
  
  const machinePattern = `.${machineName}`;
  const basePattern = '.base';

  let baseName: string;
  let outputName: string;

  if (basename.endsWith(machinePattern)) {
    // Remove .{machine} from basename
    const withoutMachine = basename.substring(0, basename.length - machinePattern.length);
    baseName = withoutMachine + basePattern;
    outputName = withoutMachine;
  } else {
    // Shouldn't happen if glob pattern is correct, but handle it
    return null;
  }

  // Construct full paths
  const basePath = path.join(cwd, dir, baseName + ext);
  const machinePath = path.join(cwd, machineFile);
  const outputPath = path.join(cwd, dir, outputName + ext);

  return {
    basePath,
    machinePath,
    outputPath,
    type,
  };
}

/**
 * Custom error classes for permachine
 * 
 * These provide clear, actionable error messages for common issues.
 */

/**
 * Base class for all permachine errors
 */
export class PermachineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermachineError';
  }
}

/**
 * Error thrown when nested machine-specific directories are detected
 * 
 * Example: parent.{machine=X}/child.{machine=Y}/
 * This is not supported because it creates ambiguity in matching.
 */
export class NestedFilteredDirectoryError extends PermachineError {
  readonly outerDir: string;
  readonly innerDir: string;

  constructor(outerDir: string, innerDir: string) {
    super(
      `Nested machine-specific directories are not supported.\n` +
      `Found: ${innerDir} inside ${outerDir}\n` +
      `Only one level of directory filtering is allowed.`
    );
    this.name = 'NestedFilteredDirectoryError';
    this.outerDir = outerDir;
    this.innerDir = innerDir;
  }
}

/**
 * Error thrown when multiple directories would output to the same path
 * 
 * Example: config.{machine=laptop}/ and config.{os=windows}/ both matching
 * and trying to output to config/
 */
export class DirectoryConflictError extends PermachineError {
  readonly outputPath: string;
  readonly sources: string[];

  constructor(outputPath: string, sources: string[]) {
    super(
      `Multiple directories would output to the same path: ${outputPath}\n` +
      `Sources: ${sources.join(', ')}\n` +
      `Only one machine-specific directory can match per output path.`
    );
    this.name = 'DirectoryConflictError';
    this.outputPath = outputPath;
    this.sources = sources;
  }
}

/**
 * Error thrown when a file merge and directory copy would produce the same output
 * 
 * Example: 
 * - config.{machine=X}/settings.json would output to config/settings.json
 * - config/settings.{machine=X}.json would also output to config/settings.json
 */
export class FileDirectoryConflictError extends PermachineError {
  readonly outputPath: string;
  readonly fileSource: string;
  readonly dirSource: string;

  constructor(outputPath: string, fileSource: string, dirSource: string) {
    super(
      `Both a file merge and directory copy would output to: ${outputPath}\n` +
      `File source: ${fileSource}\n` +
      `Directory source: ${dirSource}\n` +
      `Remove one of these to resolve the conflict.`
    );
    this.name = 'FileDirectoryConflictError';
    this.outputPath = outputPath;
    this.fileSource = fileSource;
    this.dirSource = dirSource;
  }
}

/**
 * Error thrown when a base directory pattern is detected
 * 
 * Example: jira.base/
 * Unlike files, directories do not support .base fallback.
 */
export class BaseDirectoryNotSupportedError extends PermachineError {
  readonly dirPath: string;

  constructor(dirPath: string) {
    super(
      `Base directories are not supported: ${dirPath}\n` +
      `Unlike files, directories do not support .base fallback.\n` +
      `Use machine-specific directories only (e.g., mydir.{machine=X}/).`
    );
    this.name = 'BaseDirectoryNotSupportedError';
    this.dirPath = dirPath;
  }
}

/**
 * Error thrown when a directory copy operation fails
 */
export class DirectoryCopyError extends PermachineError {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly cause?: Error;

  constructor(sourcePath: string, outputPath: string, cause?: Error) {
    super(
      `Failed to copy directory: ${sourcePath} → ${outputPath}\n` +
      (cause ? `Cause: ${cause.message}` : '')
    );
    this.name = 'DirectoryCopyError';
    this.sourcePath = sourcePath;
    this.outputPath = outputPath;
    this.cause = cause;
  }
}

/**
 * Error thrown when cleanup fails
 */
export class CleanupError extends PermachineError {
  readonly path: string;
  readonly cause?: Error;

  constructor(path: string, cause?: Error) {
    super(
      `Failed to cleanup stale output: ${path}\n` +
      (cause ? `Cause: ${cause.message}` : '')
    );
    this.name = 'CleanupError';
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Error thrown when trying to merge arrays containing non-primitive values
 * 
 * Array merging only supports primitive values (string, number, boolean, null).
 * Arrays containing objects or nested arrays cannot be merged.
 */
export class ArrayMergeError extends PermachineError {
  readonly key: string;

  constructor(key: string) {
    super(
      `Cannot merge arrays containing non-primitive values at key "${key}".\n` +
      `Array merging only supports primitive values (string, number, boolean, null).\n` +
      `Arrays containing objects or nested arrays cannot be merged.`
    );
    this.name = 'ArrayMergeError';
    this.key = key;
  }
}

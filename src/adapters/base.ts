/**
 * Base interface for file adapters
 * Each adapter handles a specific file format (JSON, ENV, etc.)
 */
export interface FileAdapter {
  /**
   * Check if this adapter can handle the given file extension
   */
  canHandle(extension: string): boolean;

  /**
   * Parse file content into an internal representation
   */
  parse(content: string): any;

  /**
   * Merge base and machine configurations
   * Machine config overrides base config
   */
  merge(base: any, machine: any): any;

  /**
   * Serialize the merged data back to string format
   */
  serialize(data: any): string;
}

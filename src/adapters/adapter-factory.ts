import path from 'node:path';
import type { FileAdapter } from './base.js';
import { JsonAdapter } from './json-adapter.js';
import { EnvAdapter } from './env-adapter.js';

const adapters: FileAdapter[] = [
  new JsonAdapter(),
  new EnvAdapter(),
];

/**
 * Get the appropriate adapter for a given file path
 * Returns null if no adapter can handle the file
 */
export function getAdapter(filePath: string): FileAdapter | null {
  const basename = path.basename(filePath);
  
  // Special handling for .env files which may have various extensions
  if (basename.startsWith('.env')) {
    return new EnvAdapter();
  }
  
  const ext = path.extname(filePath);
  
  for (const adapter of adapters) {
    if (adapter.canHandle(ext)) {
      return adapter;
    }
  }

  return null;
}

/**
 * Determine the file type from a filename or path
 * Returns the type that corresponds to an adapter
 */
export function getFileType(filename: string): 'json' | 'env' | 'unknown' {
  const basename = path.basename(filename);
  
  // Check if .env file
  if (basename.startsWith('.env')) {
    return 'env';
  }
  
  const ext = path.extname(filename);
  
  // Check if JSON/JSONC file
  if (ext === '.json' || ext === '.jsonc') {
    return 'json';
  }
  
  return 'unknown';
}

import path from 'node:path';
import type { FileAdapter } from './base.js';
import { JsonAdapter } from './json-adapter.js';
import { EnvAdapter } from './env-adapter.js';
import { MarkdownAdapter } from './markdown-adapter.js';

const adapters: FileAdapter[] = [
  new JsonAdapter(),
  new EnvAdapter(),
  new MarkdownAdapter(),
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

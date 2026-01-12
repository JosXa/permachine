import type { FileAdapter } from './base.js';

export class EnvAdapter implements FileAdapter {
  canHandle(extension: string): boolean {
    return extension === '.env' || extension === '';
  }

  parse(content: string): Map<string, string> {
    const entries = new Map<string, string>();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Find first = sign
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        continue; // Skip malformed lines
      }

      const key = trimmed.substring(0, equalIndex).trim();
      let value = trimmed.substring(equalIndex + 1).trim();

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }

      entries.set(key, value);
    }

    return entries;
  }

  merge(base: Map<string, string>, machine: Map<string, string>): Map<string, string> {
    const result = new Map(base);
    
    // Machine values override base values
    for (const [key, value] of machine) {
      result.set(key, value);
    }

    return result;
  }

  serialize(data: Map<string, string>): string {
    const lines: string[] = [];

    for (const [key, value] of data) {
      // Quote values if they contain spaces or special characters
      const needsQuotes = /[\s#]/.test(value);
      const formattedValue = needsQuotes ? `"${value}"` : value;
      lines.push(`${key}=${formattedValue}`);
    }

    return lines.join('\n') + '\n';
  }
}

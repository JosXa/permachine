import type { FileAdapter } from './base.js';

export class MarkdownAdapter implements FileAdapter {
  canHandle(extension: string): boolean {
    return extension === '.md';
  }

  parse(content: string): string {
    return content;
  }

  merge(base: string, machine: string): string {
    const trimmedBase = base.trimEnd();
    const trimmedMachine = machine.trimStart().trimEnd();
    
    if (!trimmedBase) {
      return trimmedMachine + '\n';
    }
    
    if (!trimmedMachine) {
      return trimmedBase + '\n';
    }
    
    return trimmedBase + '\n\n' + trimmedMachine + '\n';
  }

  serialize(data: string): string {
    return data;
  }
}

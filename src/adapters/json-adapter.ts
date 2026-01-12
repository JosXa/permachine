import type { FileAdapter } from './base.js';

export class JsonAdapter implements FileAdapter {
  canHandle(extension: string): boolean {
    return extension === '.json';
  }

  parse(content: string): any {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  merge(base: any, machine: any): any {
    return this.deepMerge(base, machine);
  }

  serialize(data: any): string {
    return JSON.stringify(data, null, 2) + '\n';
  }

  /**
   * Deep merge two objects
   * - Machine values override base values
   * - Arrays are replaced entirely (not merged by index)
   * - Objects are merged recursively
   */
  private deepMerge(base: any, machine: any): any {
    // If machine is not an object or is null, use machine value
    if (machine === null || typeof machine !== 'object' || Array.isArray(machine)) {
      return machine;
    }

    // If base is not an object or is null, use machine value
    if (base === null || typeof base !== 'object' || Array.isArray(base)) {
      return machine;
    }

    // Both are objects - merge recursively
    const result: any = { ...base };

    for (const key in machine) {
      if (Object.prototype.hasOwnProperty.call(machine, key)) {
        if (key in result) {
          result[key] = this.deepMerge(result[key], machine[key]);
        } else {
          result[key] = machine[key];
        }
      }
    }

    return result;
  }
}

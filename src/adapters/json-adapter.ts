import type { FileAdapter } from './base.js';
import stripJsonComments from 'strip-json-comments';
import { ArrayMergeError } from '../core/errors.js';

export class JsonAdapter implements FileAdapter {
  canHandle(extension: string): boolean {
    return extension === '.json' || extension === '.jsonc';
  }

  parse(content: string): any {
    try {
      // Strip comments first
      let stripped = stripJsonComments(content);
      
      // Remove trailing commas before closing brackets/braces
      // This regex handles: ,\s*] and ,\s*}
      stripped = stripped.replace(/,(\s*[}\]])/g, '$1');
      
      return JSON.parse(stripped);
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
   * - Arrays of primitives are merged with deduplication (base first, machine appended)
   * - Arrays containing non-primitives throw an error
   * - Objects are merged recursively
   */
  private deepMerge(base: any, machine: any, path: string = ''): any {
    // Handle arrays - merge if both are primitive arrays
    if (Array.isArray(base) && Array.isArray(machine)) {
      return this.mergeArrays(base, machine, path);
    }

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
        const newPath = path ? `${path}.${key}` : key;
        if (key in result) {
          result[key] = this.deepMerge(result[key], machine[key], newPath);
        } else {
          result[key] = machine[key];
        }
      }
    }

    return result;
  }

  /**
   * Check if a value is a primitive (string, number, boolean, null)
   */
  private isPrimitive(value: any): boolean {
    return value === null || 
           typeof value === 'string' || 
           typeof value === 'number' || 
           typeof value === 'boolean';
  }

  /**
   * Check if all elements in an array are primitives
   */
  private isArrayOfPrimitives(arr: any[]): boolean {
    return arr.every(item => this.isPrimitive(item));
  }

  /**
   * Merge two arrays of primitives with deduplication
   * Base array order is preserved, machine values appended (minus duplicates)
   */
  private mergeArrays(base: any[], machine: any[], path: string): any[] {
    // Check if both arrays contain only primitives
    if (!this.isArrayOfPrimitives(base) || !this.isArrayOfPrimitives(machine)) {
      throw new ArrayMergeError(path || 'root');
    }

    // Use a Set-like approach but preserve order
    // Start with base values, then add machine values that aren't already present
    const seen = new Set<any>();
    const result: any[] = [];

    // Add all base values first
    for (const item of base) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }

    // Add machine values that aren't duplicates
    for (const item of machine) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }

    return result;
  }
}

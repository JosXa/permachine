import { describe, test, expect } from 'bun:test';
import { JsonAdapter } from '../../src/adapters/json-adapter';

describe('JsonAdapter', () => {
  const adapter = new JsonAdapter();

  describe('canHandle', () => {
    test('should handle .json extension', () => {
      expect(adapter.canHandle('.json')).toBe(true);
    });

    test('should handle .jsonc extension', () => {
      expect(adapter.canHandle('.jsonc')).toBe(true);
    });

    test('should not handle other extensions', () => {
      expect(adapter.canHandle('.env')).toBe(false);
      expect(adapter.canHandle('.txt')).toBe(false);
      expect(adapter.canHandle('')).toBe(false);
    });
  });

  describe('parse', () => {
    test('should parse valid JSON', () => {
      const result = adapter.parse('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    test('should throw on invalid JSON', () => {
      expect(() => adapter.parse('invalid json')).toThrow();
    });

    test('should parse nested objects', () => {
      const json = '{"a": {"b": {"c": 1}}}';
      const result = adapter.parse(json);
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });

    test('should parse arrays', () => {
      const json = '{"items": [1, 2, 3]}';
      const result = adapter.parse(json);
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    test('should parse JSONC with comments', () => {
      const jsonc = `{
        // This is a comment
        "key": "value",
        /* Block comment */
        "number": 42
      }`;
      const result = adapter.parse(jsonc);
      expect(result).toEqual({ key: 'value', number: 42 });
    });

    test('should parse JSONC with trailing commas', () => {
      const jsonc = `{
        "key": "value",
        "items": [1, 2, 3,],
      }`;
      const result = adapter.parse(jsonc);
      expect(result).toEqual({ key: 'value', items: [1, 2, 3] });
    });
  });

  describe('merge', () => {
    test('should merge two objects', () => {
      const base = { a: 1, b: 2 };
      const machine = { b: 3, c: 4 };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    test('should deep merge nested objects', () => {
      const base = {
        server: { host: 'localhost', port: 3000 },
        logging: { level: 'info' },
      };
      const machine = {
        server: { port: 8080 },
        logging: { file: '/var/log/app.log' },
      };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({
        server: { host: 'localhost', port: 8080 },
        logging: { level: 'info', file: '/var/log/app.log' },
      });
    });

    test('should merge arrays of primitive strings with deduplication', () => {
      const base = { plugins: ['a', 'b', 'c'] };
      const machine = { plugins: ['c', 'd'] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ plugins: ['a', 'b', 'c', 'd'] });
    });

    test('should merge arrays of primitive numbers with deduplication', () => {
      const base = { ports: [3000, 3001, 3002] };
      const machine = { ports: [3002, 8080] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ ports: [3000, 3001, 3002, 8080] });
    });

    test('should merge arrays of mixed primitives with deduplication', () => {
      const base = { values: [1, 'a', true] };
      const machine = { values: ['a', false, 2] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ values: [1, 'a', true, false, 2] });
    });

    test('should preserve base array order when merging', () => {
      const base = { items: ['first', 'second'] };
      const machine = { items: ['third', 'first'] }; // 'first' is duplicate
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ items: ['first', 'second', 'third'] });
    });

    test('should merge empty base array with machine array', () => {
      const base = { plugins: [] };
      const machine = { plugins: ['a', 'b'] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ plugins: ['a', 'b'] });
    });

    test('should merge base array with empty machine array', () => {
      const base = { plugins: ['a', 'b'] };
      const machine = { plugins: [] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ plugins: ['a', 'b'] });
    });

    test('should throw error when base array contains objects', () => {
      const base = { items: [{ a: 1 }, { b: 2 }] };
      const machine = { items: [{ c: 3 }] };
      expect(() => adapter.merge(base, machine)).toThrow('Cannot merge arrays containing non-primitive values');
    });

    test('should throw error when machine array contains objects', () => {
      const base = { items: ['a', 'b'] };
      const machine = { items: [{ c: 3 }] };
      expect(() => adapter.merge(base, machine)).toThrow('Cannot merge arrays containing non-primitive values');
    });

    test('should throw error when base array contains nested arrays', () => {
      const base = { items: [[1, 2], [3, 4]] };
      const machine = { items: [[5, 6]] };
      expect(() => adapter.merge(base, machine)).toThrow('Cannot merge arrays containing non-primitive values');
    });

    test('should throw error when machine array contains nested arrays', () => {
      const base = { items: ['a'] };
      const machine = { items: [['nested']] };
      expect(() => adapter.merge(base, machine)).toThrow('Cannot merge arrays containing non-primitive values');
    });

    test('should throw error for mixed primitive and object arrays', () => {
      const base = { items: ['a', 'b'] };
      const machine = { items: ['c', { d: 1 }] };
      expect(() => adapter.merge(base, machine)).toThrow('Cannot merge arrays containing non-primitive values');
    });

    test('should handle null values in primitive arrays', () => {
      const base = { items: ['a', null, 'b'] };
      const machine = { items: ['c', null] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ items: ['a', null, 'b', 'c'] });
    });

    test('should merge nested object arrays correctly', () => {
      const base = {
        config: {
          plugins: ['plugin-a', 'plugin-b'],
        },
      };
      const machine = {
        config: {
          plugins: ['plugin-c', 'plugin-a'],
        },
      };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({
        config: {
          plugins: ['plugin-a', 'plugin-b', 'plugin-c'],
        },
      });
    });

    test('should handle null values', () => {
      const base = { a: 1, b: null };
      const machine = { a: null, c: 3 };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ a: null, b: null, c: 3 });
    });

    test('should override base with machine values', () => {
      const base = { enabled: true, name: 'base' };
      const machine = { enabled: false };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ enabled: false, name: 'base' });
    });

    test('should handle complex nested merges', () => {
      const base = {
        mcp: {
          'server1': { enabled: true, port: 3000 },
          'server2': { enabled: false, port: 3001 },
        },
      };
      const machine = {
        mcp: {
          'server1': { port: 8000 },
          'server3': { enabled: true, port: 3002 },
        },
      };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({
        mcp: {
          'server1': { enabled: true, port: 8000 },
          'server2': { enabled: false, port: 3001 },
          'server3': { enabled: true, port: 3002 },
        },
      });
    });
  });

  describe('serialize', () => {
    test('should serialize to JSON with 2-space indentation', () => {
      const data = { key: 'value' };
      const result = adapter.serialize(data);
      expect(result).toBe('{\n  "key": "value"\n}\n');
    });

    test('should serialize nested objects', () => {
      const data = { a: { b: 1 } };
      const result = adapter.serialize(data);
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
    });

    test('should end with newline', () => {
      const data = { key: 'value' };
      const result = adapter.serialize(data);
      expect(result.endsWith('\n')).toBe(true);
    });
  });
});

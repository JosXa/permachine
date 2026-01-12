import { describe, test, expect } from 'bun:test';
import { JsonAdapter } from '../../src/adapters/json-adapter';

describe('JsonAdapter', () => {
  const adapter = new JsonAdapter();

  describe('canHandle', () => {
    test('should handle .json extension', () => {
      expect(adapter.canHandle('.json')).toBe(true);
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

    test('should replace arrays entirely', () => {
      const base = { items: [1, 2, 3] };
      const machine = { items: [4, 5] };
      const result = adapter.merge(base, machine);
      expect(result).toEqual({ items: [4, 5] });
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

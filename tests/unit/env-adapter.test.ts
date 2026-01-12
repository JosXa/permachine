import { describe, test, expect } from 'bun:test';
import { EnvAdapter } from '../../src/adapters/env-adapter';

describe('EnvAdapter', () => {
  const adapter = new EnvAdapter();

  describe('canHandle', () => {
    test('should handle .env extension', () => {
      expect(adapter.canHandle('.env')).toBe(true);
    });

    test('should handle empty extension (for dotfiles)', () => {
      expect(adapter.canHandle('')).toBe(true);
    });

    test('should not handle other extensions', () => {
      expect(adapter.canHandle('.json')).toBe(false);
      expect(adapter.canHandle('.txt')).toBe(false);
    });
  });

  describe('parse', () => {
    test('should parse simple key=value pairs', () => {
      const content = 'KEY1=value1\nKEY2=value2';
      const result = adapter.parse(content);
      expect(result.get('KEY1')).toBe('value1');
      expect(result.get('KEY2')).toBe('value2');
    });

    test('should skip empty lines', () => {
      const content = 'KEY1=value1\n\n\nKEY2=value2';
      const result = adapter.parse(content);
      expect(result.size).toBe(2);
    });

    test('should skip comment lines', () => {
      const content = '# This is a comment\nKEY1=value1\n# Another comment\nKEY2=value2';
      const result = adapter.parse(content);
      expect(result.size).toBe(2);
    });

    test('should handle quoted values', () => {
      const content = 'KEY1="value with spaces"\nKEY2=\'single quotes\'';
      const result = adapter.parse(content);
      expect(result.get('KEY1')).toBe('value with spaces');
      expect(result.get('KEY2')).toBe('single quotes');
    });

    test('should handle empty values', () => {
      const content = 'KEY1=\nKEY2=value';
      const result = adapter.parse(content);
      expect(result.get('KEY1')).toBe('');
      expect(result.get('KEY2')).toBe('value');
    });

    test('should handle values with equals signs', () => {
      const content = 'KEY1=value=with=equals';
      const result = adapter.parse(content);
      expect(result.get('KEY1')).toBe('value=with=equals');
    });

    test('should skip malformed lines', () => {
      const content = 'KEY1=value1\nmalformed line\nKEY2=value2';
      const result = adapter.parse(content);
      expect(result.size).toBe(2);
      expect(result.get('KEY1')).toBe('value1');
      expect(result.get('KEY2')).toBe('value2');
    });

    test('should handle whitespace around keys and values', () => {
      const content = '  KEY1  =  value1  \n  KEY2=value2';
      const result = adapter.parse(content);
      expect(result.get('KEY1')).toBe('value1');
      expect(result.get('KEY2')).toBe('value2');
    });
  });

  describe('merge', () => {
    test('should merge two env maps', () => {
      const base = new Map([['KEY1', 'base1'], ['KEY2', 'base2']]);
      const machine = new Map([['KEY2', 'machine2'], ['KEY3', 'machine3']]);
      const result = adapter.merge(base, machine);
      
      expect(result.get('KEY1')).toBe('base1');
      expect(result.get('KEY2')).toBe('machine2');
      expect(result.get('KEY3')).toBe('machine3');
    });

    test('should preserve base values not in machine', () => {
      const base = new Map([['KEY1', 'value1'], ['KEY2', 'value2']]);
      const machine = new Map([['KEY1', 'override']]);
      const result = adapter.merge(base, machine);
      
      expect(result.get('KEY1')).toBe('override');
      expect(result.get('KEY2')).toBe('value2');
    });

    test('should handle empty base', () => {
      const base = new Map();
      const machine = new Map([['KEY1', 'value1']]);
      const result = adapter.merge(base, machine);
      
      expect(result.get('KEY1')).toBe('value1');
    });

    test('should handle empty machine', () => {
      const base = new Map([['KEY1', 'value1']]);
      const machine = new Map();
      const result = adapter.merge(base, machine);
      
      expect(result.get('KEY1')).toBe('value1');
    });
  });

  describe('serialize', () => {
    test('should serialize to key=value format', () => {
      const data = new Map([['KEY1', 'value1'], ['KEY2', 'value2']]);
      const result = adapter.serialize(data);
      expect(result).toContain('KEY1=value1');
      expect(result).toContain('KEY2=value2');
    });

    test('should quote values with spaces', () => {
      const data = new Map([['KEY1', 'value with spaces']]);
      const result = adapter.serialize(data);
      expect(result).toContain('KEY1="value with spaces"');
    });

    test('should quote values with hash signs', () => {
      const data = new Map([['KEY1', 'value#comment']]);
      const result = adapter.serialize(data);
      expect(result).toContain('KEY1="value#comment"');
    });

    test('should not quote simple values', () => {
      const data = new Map([['KEY1', 'simplevalue']]);
      const result = adapter.serialize(data);
      expect(result).toBe('KEY1=simplevalue\n');
    });

    test('should end with newline', () => {
      const data = new Map([['KEY1', 'value1']]);
      const result = adapter.serialize(data);
      expect(result.endsWith('\n')).toBe(true);
    });
  });
});

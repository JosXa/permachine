import { describe, test, expect } from 'bun:test';
import { getAdapter } from '../../src/adapters/adapter-factory';
import { JsonAdapter } from '../../src/adapters/json-adapter';
import { EnvAdapter } from '../../src/adapters/env-adapter';

describe('adapter-factory', () => {
  describe('getAdapter', () => {
    test('should return JsonAdapter for .json files', () => {
      const adapter = getAdapter('config.json');
      expect(adapter).toBeInstanceOf(JsonAdapter);
    });

    test('should return JsonAdapter for nested .json files', () => {
      const adapter = getAdapter('/path/to/config.base.json');
      expect(adapter).toBeInstanceOf(JsonAdapter);
    });

    test('should return EnvAdapter for .env files', () => {
      const adapter = getAdapter('.env');
      expect(adapter).toBeInstanceOf(EnvAdapter);
    });

    test('should return EnvAdapter for .env.base files', () => {
      const adapter = getAdapter('.env.base');
      expect(adapter).toBeInstanceOf(EnvAdapter);
    });

    test('should return null for unsupported file types', () => {
      expect(getAdapter('file.txt')).toBeNull();
      expect(getAdapter('file.yaml')).toBeNull();
      expect(getAdapter('file.xml')).toBeNull();
    });

    test('should handle Windows paths', () => {
      const adapter = getAdapter('C:\\Users\\test\\config.json');
      expect(adapter).toBeInstanceOf(JsonAdapter);
    });

    test('should handle Unix paths', () => {
      const adapter = getAdapter('/home/user/config.json');
      expect(adapter).toBeInstanceOf(JsonAdapter);
    });
  });
});

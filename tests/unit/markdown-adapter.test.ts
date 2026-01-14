import { describe, test, expect } from 'bun:test';
import { MarkdownAdapter } from '../../src/adapters/markdown-adapter';

describe('MarkdownAdapter', () => {
  const adapter = new MarkdownAdapter();

  describe('canHandle', () => {
    test('should handle .md extension', () => {
      expect(adapter.canHandle('.md')).toBe(true);
    });

    test('should not handle other extensions', () => {
      expect(adapter.canHandle('.json')).toBe(false);
      expect(adapter.canHandle('.txt')).toBe(false);
      expect(adapter.canHandle('.env')).toBe(false);
    });
  });

  describe('parse', () => {
    test('should return content as-is', () => {
      const content = '# Title\n\nSome content';
      const result = adapter.parse(content);
      expect(result).toBe(content);
    });

    test('should preserve whitespace', () => {
      const content = '# Title\n\n\nMultiple newlines\n\n';
      const result = adapter.parse(content);
      expect(result).toBe(content);
    });
  });

  describe('merge', () => {
    test('should append base and machine content with double newline', () => {
      const base = '# Base Content\n\nThis is shared documentation.';
      const machine = '## Local Setup\n\nRun locally.';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Base Content\n\nThis is shared documentation.\n\n## Local Setup\n\nRun locally.\n');
    });

    test('should handle empty base', () => {
      const base = '';
      const machine = '# Machine Content';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Machine Content\n');
    });

    test('should handle empty machine', () => {
      const base = '# Base Content';
      const machine = '';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Base Content\n');
    });

    test('should handle both empty', () => {
      const base = '';
      const machine = '';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('\n');
    });

    test('should trim trailing whitespace from base', () => {
      const base = '# Title\n\nBase content  \n  ';
      const machine = '## Machine\n\nContent';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Title\n\nBase content\n\n## Machine\n\nContent\n');
    });

    test('should trim leading whitespace from machine', () => {
      const base = '# Base\n\nContent';
      const machine = '  \n  ## Machine\n\nContent  ';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Base\n\nContent\n\n## Machine\n\nContent\n');
    });

    test('should preserve internal whitespace', () => {
      const base = '# Title\n\n    Code block\n    Indented';
      const machine = '## Machine\n\n    More code';
      const result = adapter.merge(base, machine);
      
      expect(result).toBe('# Title\n\n    Code block\n    Indented\n\n## Machine\n\n    More code\n');
    });

    test('should handle complex markdown with formatting', () => {
      const base = '# README\n\n**Bold** and *italic*.\n\n```js\ncode\n```';
      const machine = '## Setup\n\n- Step 1\n- Step 2\n\n[Link](url)';
      const result = adapter.merge(base, machine);
      
      expect(result).toContain('# README');
      expect(result).toContain('**Bold** and *italic*');
      expect(result).toContain('```js\ncode\n```');
      expect(result).toContain('## Setup');
      expect(result).toContain('- Step 1\n- Step 2');
      expect(result).toContain('[Link](url)');
    });
  });

  describe('serialize', () => {
    test('should return data as-is', () => {
      const data = '# Title\n\nContent';
      const result = adapter.serialize(data);
      expect(result).toBe(data);
    });
  });
});

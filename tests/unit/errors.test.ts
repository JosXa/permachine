import { describe, test, expect } from 'bun:test';
import {
  PermachineError,
  NestedFilteredDirectoryError,
  DirectoryConflictError,
  FileDirectoryConflictError,
  BaseDirectoryNotSupportedError,
  DirectoryCopyError,
  CleanupError,
} from '../../src/core/errors.js';

describe('PermachineError', () => {
  test('is an instance of Error', () => {
    const error = new PermachineError('test message');
    expect(error instanceof Error).toBe(true);
  });

  test('has correct name', () => {
    const error = new PermachineError('test message');
    expect(error.name).toBe('PermachineError');
  });

  test('has correct message', () => {
    const error = new PermachineError('test message');
    expect(error.message).toBe('test message');
  });
});

describe('NestedFilteredDirectoryError', () => {
  test('is an instance of PermachineError', () => {
    const error = new NestedFilteredDirectoryError('outer', 'inner');
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new NestedFilteredDirectoryError('outer', 'inner');
    expect(error.name).toBe('NestedFilteredDirectoryError');
  });

  test('includes both directory names in message', () => {
    const error = new NestedFilteredDirectoryError(
      'parent.{machine=X}',
      'parent.{machine=X}/child.{machine=Y}'
    );
    expect(error.message).toContain('parent.{machine=X}');
    expect(error.message).toContain('child.{machine=Y}');
    expect(error.message).toContain('not supported');
  });

  test('stores directory names as properties', () => {
    const error = new NestedFilteredDirectoryError('outer-dir', 'inner-dir');
    expect(error.outerDir).toBe('outer-dir');
    expect(error.innerDir).toBe('inner-dir');
  });

  test('message explains the limitation', () => {
    const error = new NestedFilteredDirectoryError('a', 'b');
    expect(error.message).toContain('one level');
  });
});

describe('DirectoryConflictError', () => {
  test('is an instance of PermachineError', () => {
    const error = new DirectoryConflictError('output/', ['src1/', 'src2/']);
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new DirectoryConflictError('output/', ['src1/']);
    expect(error.name).toBe('DirectoryConflictError');
  });

  test('includes output path in message', () => {
    const error = new DirectoryConflictError('config/', ['a/', 'b/']);
    expect(error.message).toContain('config/');
  });

  test('lists all conflicting sources', () => {
    const error = new DirectoryConflictError('output/', ['src1/', 'src2/', 'src3/']);
    expect(error.message).toContain('src1/');
    expect(error.message).toContain('src2/');
    expect(error.message).toContain('src3/');
  });

  test('stores properties correctly', () => {
    const sources = ['a/', 'b/'];
    const error = new DirectoryConflictError('out/', sources);
    expect(error.outputPath).toBe('out/');
    expect(error.sources).toEqual(sources);
  });

  test('message explains only one can match', () => {
    const error = new DirectoryConflictError('out/', ['a/', 'b/']);
    expect(error.message).toContain('one');
  });
});

describe('FileDirectoryConflictError', () => {
  test('is an instance of PermachineError', () => {
    const error = new FileDirectoryConflictError('out.json', 'file.json', 'dir/');
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new FileDirectoryConflictError('out.json', 'file.json', 'dir/');
    expect(error.name).toBe('FileDirectoryConflictError');
  });

  test('shows output path, file source, and directory source', () => {
    const error = new FileDirectoryConflictError(
      'config/settings.json',
      'config/settings.{machine=X}.json',
      'config.{machine=X}/'
    );
    expect(error.message).toContain('config/settings.json');
    expect(error.message).toContain('config/settings.{machine=X}.json');
    expect(error.message).toContain('config.{machine=X}/');
  });

  test('stores properties correctly', () => {
    const error = new FileDirectoryConflictError('out', 'file', 'dir');
    expect(error.outputPath).toBe('out');
    expect(error.fileSource).toBe('file');
    expect(error.dirSource).toBe('dir');
  });

  test('message suggests resolution', () => {
    const error = new FileDirectoryConflictError('out', 'file', 'dir');
    expect(error.message).toContain('Remove');
  });
});

describe('BaseDirectoryNotSupportedError', () => {
  test('is an instance of PermachineError', () => {
    const error = new BaseDirectoryNotSupportedError('config.base/');
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new BaseDirectoryNotSupportedError('config.base/');
    expect(error.name).toBe('BaseDirectoryNotSupportedError');
  });

  test('includes directory path in message', () => {
    const error = new BaseDirectoryNotSupportedError('jira.base/');
    expect(error.message).toContain('jira.base/');
  });

  test('stores directory path as property', () => {
    const error = new BaseDirectoryNotSupportedError('my-dir.base/');
    expect(error.dirPath).toBe('my-dir.base/');
  });

  test('message explains base directories are not supported', () => {
    const error = new BaseDirectoryNotSupportedError('x');
    expect(error.message).toContain('not support');
    expect(error.message).toContain('.base');
  });

  test('message suggests using machine-specific directories', () => {
    const error = new BaseDirectoryNotSupportedError('x');
    expect(error.message).toContain('{machine=');
  });
});

describe('DirectoryCopyError', () => {
  test('is an instance of PermachineError', () => {
    const error = new DirectoryCopyError('src/', 'out/');
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new DirectoryCopyError('src/', 'out/');
    expect(error.name).toBe('DirectoryCopyError');
  });

  test('includes source and output paths in message', () => {
    const error = new DirectoryCopyError('/path/to/source/', '/path/to/output/');
    expect(error.message).toContain('/path/to/source/');
    expect(error.message).toContain('/path/to/output/');
  });

  test('includes cause message if provided', () => {
    const cause = new Error('Permission denied');
    const error = new DirectoryCopyError('src/', 'out/', cause);
    expect(error.message).toContain('Permission denied');
  });

  test('stores properties correctly', () => {
    const cause = new Error('test');
    const error = new DirectoryCopyError('src/', 'out/', cause);
    expect(error.sourcePath).toBe('src/');
    expect(error.outputPath).toBe('out/');
    expect(error.cause).toBe(cause);
  });

  test('works without cause', () => {
    const error = new DirectoryCopyError('src/', 'out/');
    expect(error.cause).toBeUndefined();
  });
});

describe('CleanupError', () => {
  test('is an instance of PermachineError', () => {
    const error = new CleanupError('/path/to/file');
    expect(error instanceof PermachineError).toBe(true);
  });

  test('has correct name', () => {
    const error = new CleanupError('/path/to/file');
    expect(error.name).toBe('CleanupError');
  });

  test('includes path in message', () => {
    const error = new CleanupError('/some/stale/output');
    expect(error.message).toContain('/some/stale/output');
  });

  test('includes cause message if provided', () => {
    const cause = new Error('EACCES: permission denied');
    const error = new CleanupError('/path', cause);
    expect(error.message).toContain('EACCES');
  });

  test('stores properties correctly', () => {
    const cause = new Error('test');
    const error = new CleanupError('/path', cause);
    expect(error.path).toBe('/path');
    expect(error.cause).toBe(cause);
  });

  test('works without cause', () => {
    const error = new CleanupError('/path');
    expect(error.cause).toBeUndefined();
  });
});

describe('error inheritance chain', () => {
  test('all errors are instances of Error', () => {
    expect(new NestedFilteredDirectoryError('a', 'b') instanceof Error).toBe(true);
    expect(new DirectoryConflictError('a', ['b']) instanceof Error).toBe(true);
    expect(new FileDirectoryConflictError('a', 'b', 'c') instanceof Error).toBe(true);
    expect(new BaseDirectoryNotSupportedError('a') instanceof Error).toBe(true);
    expect(new DirectoryCopyError('a', 'b') instanceof Error).toBe(true);
    expect(new CleanupError('a') instanceof Error).toBe(true);
  });

  test('all errors can be caught as PermachineError', () => {
    const errors = [
      new NestedFilteredDirectoryError('a', 'b'),
      new DirectoryConflictError('a', ['b']),
      new FileDirectoryConflictError('a', 'b', 'c'),
      new BaseDirectoryNotSupportedError('a'),
      new DirectoryCopyError('a', 'b'),
      new CleanupError('a'),
    ];

    for (const error of errors) {
      expect(error instanceof PermachineError).toBe(true);
    }
  });

  test('errors have stack traces', () => {
    const error = new NestedFilteredDirectoryError('a', 'b');
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });
});

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo } from '../helpers/test-repo.js';
import { scanForMergeOperations } from '../../src/core/file-scanner.js';
import { getFilterContext } from '../../src/core/file-filters.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('file-filters integration', () => {
  let testRepo: TestRepo;
  let context = getFilterContext();

  beforeEach(async () => {
    testRepo = new TestRepo('file-filters-test');
    await testRepo.create();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  test('scans and finds files with new filter syntax matching current OS', async () => {
    // Create a file with OS filter matching current platform
    await testRepo.writeFile(
      `config.{os=${context.os}}.json`,
      '{"platform": "specific"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
    expect(operations[0].outputPath).toContain('config.json');
  });

  test('uses base file when machine-specific file does not match current OS', async () => {
    // Create a file with OS filter NOT matching current platform
    const nonMatchingOS = context.os === 'windows' ? 'macos' : 'windows';
    await testRepo.writeFile(
      `config.{os=${nonMatchingOS}}.json`,
      '{"platform": "specific"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Base file should be used as fallback when no machine-specific file matches
    expect(operations).toHaveLength(1);
    expect(operations[0].basePath).toContain('config.base.json');
    expect(operations[0].machinePath).toBe(''); // No matching machine file
  });

  test('finds files with multiple filters (AND logic)', async () => {
    // Create a file with multiple filters all matching
    await testRepo.writeFile(
      `secrets.{machine=homezone}{os=${context.os}}.json`,
      '{"secret": "value"}'
    );
    await testRepo.writeFile('secrets.base.json', '{"shared": "secret"}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
    expect(operations[0].outputPath).toContain('secrets.json');
  });

  test('uses base file when AND chain filter does not match', async () => {
    const nonMatchingOS = context.os === 'windows' ? 'macos' : 'windows';
    
    await testRepo.writeFile(
      `secrets.{machine=homezone}{os=${nonMatchingOS}}.json`,
      '{"secret": "value"}'
    );
    await testRepo.writeFile('secrets.base.json', '{"shared": "secret"}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Base file should be used as fallback when no machine-specific file matches
    expect(operations).toHaveLength(1);
    expect(operations[0].basePath).toContain('secrets.base.json');
    expect(operations[0].machinePath).toBe(''); // No matching machine file
  });

  test('supports OR logic with comma-separated values', async () => {
    // Create a file that matches current OS via OR
    await testRepo.writeFile(
      'config.{os=windows,macos,linux}.json',
      '{"multi": "platform"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
  });

  test('handles env files with new filter syntax', async () => {
    await testRepo.writeFile(
      `.env.{machine=homezone}`,
      'SPECIFIC=value'
    );
    await testRepo.writeFile('.env.base', 'SHARED=value');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
    expect(operations[0].type).toBe('env');
    expect(path.basename(operations[0].outputPath)).toBe('.env');
  });

  test('backward compatibility: still finds legacy .machine. files', async () => {
    await testRepo.writeFile('config.homezone.json', '{"legacy": true}');
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
    expect(operations[0].outputPath).toContain('config.json');
  });

  test('can mix legacy and new syntax files', async () => {
    // Legacy file
    await testRepo.writeFile('old.homezone.json', '{"legacy": true}');
    await testRepo.writeFile('old.base.json', '{"shared": true}');
    
    // New syntax file matching current OS
    await testRepo.writeFile(`new.{os=${context.os}}.json`, '{"modern": true}');
    await testRepo.writeFile('new.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(2);
    expect(operations.some(op => op.outputPath.includes('old.json'))).toBe(true);
    expect(operations.some(op => op.outputPath.includes('new.json'))).toBe(true);
  });

  test('processes base-only files when no machine-specific file exists', async () => {
    await testRepo.writeFile('config.base.json', '{"shared": true}');
    await testRepo.writeFile('.env.base', 'SHARED=value');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Should now find base-only files and create merge operations for them
    expect(operations).toHaveLength(2);
    expect(operations.some(op => op.outputPath.includes('config.json'))).toBe(true);
    expect(operations.some(op => op.outputPath.includes('.env'))).toBe(true);
  });

  test('complex example: secrets per machine and user', async () => {
    // Change to JSON format since .env might have issues with filters in filename
    await testRepo.writeFile(
      `secrets.{machine=homezone}{user=${context.user}}.json`,
      JSON.stringify({ API_KEY: 'secret123' })
    );
    await testRepo.writeFile('secrets.base.json', JSON.stringify({ PUBLIC_KEY: 'public' }));

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(1);
    expect(operations[0].type).toBe('json');
    expect(path.basename(operations[0].outputPath)).toBe('secrets.json');
  });

  test('supports {base} placeholder in filenames', async () => {
    // Create a file using {base} placeholder
    await testRepo.writeFile(
      'config.{base}.json',
      '{"placeholder": "test"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Should find config.{base}.json which becomes config.config.json
    expect(operations).toHaveLength(1);
    expect(operations[0].machinePath).toContain('config.{base}.json');
    expect(operations[0].outputPath).toContain('config.json');
  });

  test('{base} placeholder with filters', async () => {
    // Create a file using {base} with filters
    await testRepo.writeFile(
      `config.{os=${context.os}}.{base}.json`,
      '{"filtered": "value"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Should find the file with matching OS filter
    expect(operations).toHaveLength(1);
    expect(operations[0].machinePath).toContain(`config.{os=${context.os}}.{base}.json`);
  });

  test('{base} placeholder is case-insensitive', async () => {
    // Create files with different case variations
    await testRepo.writeFile(
      'file1.{BASE}.json',
      '{"case": "upper"}'
    );
    await testRepo.writeFile(
      'file2.{Base}.json',
      '{"case": "mixed"}'
    );
    await testRepo.writeFile('file1.base.json', '{"shared": "1"}');
    await testRepo.writeFile('file2.base.json', '{"shared": "2"}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    // Should find both files regardless of case
    expect(operations).toHaveLength(2);
  });

  // Wildcard test skipped: tilde character not allowed in Windows filenames
  // Wildcard matching logic is thoroughly tested in unit tests

  test('base file should be used when machine-specific files exist for OTHER machines only', async () => {
    // This is the bug: when machine-specific files exist for other machines,
    // but NOT for the current machine, the base file should still be processed.
    // 
    // Scenario: You're on machine "wsl-nixos" but only have:
    // - opencode.base.jsonc
    // - opencode.{machine=homezone}.jsonc
    // - opencode.{machine=tvdem00laax}.jsonc
    //
    // Expected: opencode.json should be created from base file
    // Actual (bug): opencode.json is NOT created because base file is skipped
    
    await testRepo.writeFile('config.base.json', '{"shared": true}');
    await testRepo.writeFile('config.{machine=other-machine}.json', '{"specific": "other"}');
    await testRepo.writeFile('config.{machine=another-machine}.json', '{"specific": "another"}');

    // Scan as a machine that has NO matching machine-specific file
    const operations = await scanForMergeOperations('my-machine', testRepo.path);

    // Should find the base file and create a merge operation for it
    expect(operations).toHaveLength(1);
    expect(operations[0].outputPath).toContain('config.json');
    expect(operations[0].basePath).toContain('config.base.json');
    expect(operations[0].machinePath).toBe(''); // No machine file matches
  });
});

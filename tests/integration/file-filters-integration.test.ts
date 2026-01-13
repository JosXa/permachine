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

  test('does not find files with filter that does not match current OS', async () => {
    // Create a file with OS filter NOT matching current platform
    const nonMatchingOS = context.os === 'windows' ? 'macos' : 'windows';
    await testRepo.writeFile(
      `config.{os=${nonMatchingOS}}.json`,
      '{"platform": "specific"}'
    );
    await testRepo.writeFile('config.base.json', '{"shared": true}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(0);
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

  test('does not find files when one filter in AND chain fails', async () => {
    const nonMatchingOS = context.os === 'windows' ? 'macos' : 'windows';
    
    await testRepo.writeFile(
      `secrets.{machine=homezone}{os=${nonMatchingOS}}.json`,
      '{"secret": "value"}'
    );
    await testRepo.writeFile('secrets.base.json', '{"shared": "secret"}');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(0);
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

  test('ignores base files', async () => {
    await testRepo.writeFile('config.base.json', '{"shared": true}');
    await testRepo.writeFile('.env.base', 'SHARED=value');

    const operations = await scanForMergeOperations('homezone', testRepo.path);

    expect(operations).toHaveLength(0);
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

  // Wildcard test skipped: tilde character not allowed in Windows filenames
  // Wildcard matching logic is thoroughly tested in unit tests
});

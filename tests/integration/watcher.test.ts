import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestRepo, createTestFiles } from '../helpers/test-repo';
import { startWatcher } from '../../src/core/watcher';
import { getMachineName } from '../../src/core/machine-detector';
import { logger } from '../../src/utils/logger';

describe('watcher integration', () => {
  let repo: TestRepo;
  const machineName = getMachineName();
  
  beforeEach(async () => {
    repo = new TestRepo('watcher-test');
    await repo.create();
    logger.setSilent(true);
  });

  afterEach(async () => {
    logger.setSilent(false);
    await repo.cleanup();
  });

  test('should watch and merge files on change', async () => {
    // Create initial files
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1, b: 2 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 3, c: 4 }, null, 2),
    });

    // Start watcher
    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      // Wait for watcher to initialize
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify machine file
      await repo.writeFile(
        `config.${machineName}.json`,
        JSON.stringify({ b: 5, c: 6 }, null, 2)
      );

      // Wait for debounce + merge
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check output was updated
      const output = await repo.readFile('config.json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ a: 1, b: 5, c: 6 });
    } finally {
      await stopWatcher();
    }
  });

  test('should handle base file changes', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ x: 1 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ y: 2 }, null, 2),
    });

    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify base file
      await repo.writeFile(
        'config.base.json',
        JSON.stringify({ x: 10 }, null, 2)
      );

      await new Promise(resolve => setTimeout(resolve, 300));

      const output = await repo.readFile('config.json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ x: 10, y: 2 });
    } finally {
      await stopWatcher();
    }
  });

  test('should handle ENV file changes', async () => {
    await createTestFiles(repo, {
      '.env.base': 'KEY1=base1\nKEY2=base2\n',
      [`.env.${machineName}`]: 'KEY2=machine2\nKEY3=machine3\n',
    });

    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify ENV file
      await repo.writeFile(
        `.env.${machineName}`,
        'KEY2=updated2\nKEY3=machine3\nKEY4=new4\n'
      );

      await new Promise(resolve => setTimeout(resolve, 300));

      const output = await repo.readFile('.env');
      expect(output).toContain('KEY1=base1');
      expect(output).toContain('KEY2=updated2');
      expect(output).toContain('KEY4=new4');
    } finally {
      await stopWatcher();
    }
  });

  test('should debounce rapid changes', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ counter: 0 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ value: 1 }, null, 2),
    });

    const stopWatcher = await startWatcher(machineName, {
      debounce: 200,
      cwd: repo.path,
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      // Rapid consecutive writes
      for (let i = 1; i <= 5; i++) {
        await repo.writeFile(
          `config.${machineName}.json`,
          JSON.stringify({ value: i }, null, 2)
        );
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait for debounce to settle
      await new Promise(resolve => setTimeout(resolve, 400));

      // Should have merged only the last value
      const output = await repo.readFile('config.json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ counter: 0, value: 5 });
    } finally {
      await stopWatcher();
    }
  });

  test('should watch multiple files', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 2 }, null, 2),
      '.env.base': 'KEY1=value1\n',
      [`.env.${machineName}`]: 'KEY2=value2\n',
    });

    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify JSON file
      await repo.writeFile(
        `config.${machineName}.json`,
        JSON.stringify({ b: 20 }, null, 2)
      );

      // Modify ENV file
      await repo.writeFile(
        `.env.${machineName}`,
        'KEY2=updated\n'
      );

      await new Promise(resolve => setTimeout(resolve, 400));

      // Check both outputs updated
      const jsonOutput = await repo.readFile('config.json');
      const jsonParsed = JSON.parse(jsonOutput);
      expect(jsonParsed).toEqual({ a: 1, b: 20 });

      const envOutput = await repo.readFile('.env');
      expect(envOutput).toContain('KEY2=updated');
    } finally {
      await stopWatcher();
    }
  });

  test('should handle no files to watch', async () => {
    // Empty repo - no machine-specific files
    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      // Should not crash, just return empty cleanup
      expect(typeof stopWatcher).toBe('function');
    } finally {
      await stopWatcher();
    }
  });

  test('should perform initial merge before watching', async () => {
    // Create files that need merging
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1, b: 2 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 3, c: 4 }, null, 2),
    });

    // Output file should NOT exist yet
    const existsBefore = await repo.fileExists('config.json');
    expect(existsBefore).toBe(false);

    // Start watcher - should perform initial merge
    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      // Wait briefly for initial merge to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Output file SHOULD exist now (initial merge happened)
      const existsAfter = await repo.fileExists('config.json');
      expect(existsAfter).toBe(true);

      // Verify the content is correct
      const output = await repo.readFile('config.json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ a: 1, b: 3, c: 4 });
    } finally {
      await stopWatcher();
    }
  });

  test('should detect changes to existing watched files', async () => {
    await createTestFiles(repo, {
      'config.base.json': JSON.stringify({ a: 1 }, null, 2),
      [`config.${machineName}.json`]: JSON.stringify({ b: 2 }, null, 2),
    });

    const stopWatcher = await startWatcher(machineName, {
      debounce: 100,
      cwd: repo.path,
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify the base file
      await repo.writeFile(
        'config.base.json',
        JSON.stringify({ a: 100, z: 200 }, null, 2)
      );

      await new Promise(resolve => setTimeout(resolve, 400));

      // Should have merged with the updated base
      const output = await repo.readFile('config.json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ a: 100, z: 200, b: 2 });
    } finally {
      await stopWatcher();
    }
  });
});

#!/usr/bin/env node

import minimist from 'minimist';
import { getMachineName } from './core/machine-detector.js';
import { scanForMergeOperations } from './core/file-scanner.js';
import { performAllMerges } from './core/merger.js';
import { manageGitignore, isFileTrackedByGit } from './core/gitignore-manager.js';
import { startWatcher } from './core/watcher.js';
import { logger } from './utils/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check which output files already exist
 */
async function checkExistingOutputFiles(operations: MergeOperation[]): Promise<string[]> {
  const existing: string[] = [];
  for (const op of operations) {
    try {
      await fs.access(op.outputPath);
      existing.push(op.outputPath);
    } catch {
      // File doesn't exist
    }
  }
  return existing;
}

/**
 * Check which output files are tracked by git
 */
async function checkTrackedOutputFiles(operations: MergeOperation[]): Promise<string[]> {
  const tracked: string[] = [];
  const cwd = process.cwd();
  
  for (const op of operations) {
    try {
      await fs.access(op.outputPath);
      const relativePath = path.relative(cwd, op.outputPath);
      const isTracked = await isFileTrackedByGit(relativePath, cwd);
      if (isTracked) {
        tracked.push(op.outputPath);
      }
    } catch {
      // File doesn't exist, so it can't be tracked
    }
  }
  return tracked;
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['help', 'version', 'silent', 'legacy', 'auto', 'with-package-json', 'no-gitignore', 'verbose'],
    string: ['debounce'],
    alias: {
      h: 'help',
      v: 'version',
      s: 'silent',
    },
  });

  const command = argv._[0];

  // Handle --help
  if (argv.help || (!command && Object.keys(argv).length === 1)) {
    showHelp();
    return;
  }

  // Handle --version
  if (argv.version) {
    await showVersion();
    return;
  }

  // Handle --silent flag
  if (argv.silent) {
    logger.setSilent(true);
  }

  // Route to command handlers
  switch (command) {
    case 'init':
      await handleInit(argv);
      break;
    case 'merge':
      await handleMerge(argv);
      break;
    case 'info':
      await handleInfo(argv);
      break;
    case 'uninstall':
      await handleUninstall(argv);
      break;
    case 'watch':
      await handleWatch(argv);
      break;
    default:
      if (!command) {
        logger.error('No command specified. Use --help for usage information.');
      } else {
        logger.error(`Unknown command: ${command}`);
      }
      process.exit(1);
  }
}

async function handleInit(argv: any) {
  try {
    const machineName = getMachineName();
    logger.success(`Machine detected: ${machineName}`);

    // Scan for existing machine-specific files
    const operations = await scanForMergeOperations(machineName);
    
    if (operations.length > 0) {
      logger.info(`Found ${operations.length} machine-specific file(s)`);
      
      // Check which output files are tracked by git
      const trackedFiles = await checkTrackedOutputFiles(operations);
      
      if (trackedFiles.length > 0 && !argv['no-gitignore']) {
        // Show warning about files that will be affected
        logger.warn('⚠️  Warning: The following files will be overwritten and untracked from git:');
        for (const file of trackedFiles) {
          logger.warn(`  - ${path.relative(process.cwd(), file)}`);
        }
        logger.info('');
        
        // Prompt for confirmation
        const confirmed = await promptConfirmation('Do you want to continue?');
        
        if (!confirmed) {
          logger.info('Aborted.');
          process.exit(0);
        }
        logger.info('');
      }
    }

    // Install git hooks
    const installResult = await installHooks({
      legacy: argv.legacy,
    });

    if (installResult.warnings.length > 0) {
      for (const warning of installResult.warnings) {
        logger.warn(warning);
      }
    }
    
    if (operations.length > 0) {
      // Perform initial merge
      const results = await performAllMerges(operations);
      const changed = results.filter(r => r.changed).length;
      
      if (changed > 0) {
        logger.success(`Merged ${changed} file(s)`);
      }

      // Manage gitignore
      const outputPaths = operations.map(op => op.outputPath);
      const gitignoreResult = await manageGitignore(outputPaths, { noGitignore: argv['no-gitignore'] });
      
      if (gitignoreResult.added.length > 0) {
        logger.success(`Added ${gitignoreResult.added.length} file(s) to .gitignore`);
      }
      if (gitignoreResult.removed.length > 0) {
        logger.success(`Removed ${gitignoreResult.removed.length} file(s) from git tracking`);
      }
      if (gitignoreResult.errors.length > 0) {
        for (const error of gitignoreResult.errors) {
          logger.warn(error);
        }
      }
    } else {
      logger.info('No machine-specific files found');
      logger.info('');
      logger.info('Next steps:');
      logger.info('1. Create base config files (e.g., config.base.json)');
      logger.info(`2. Create machine-specific configs (e.g., config.${machineName}.json)`);
      logger.info('3. Run: permachine merge');
    }

    logger.info('');
    logger.info('Git hooks will auto-merge on:');
    logger.info('  - checkout (switching branches)');
    logger.info('  - merge (git pull/merge)');
    logger.info('  - commit');
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleMerge(argv: any) {
  try {
    const machineName = getMachineName();
    const operations = await scanForMergeOperations(machineName);

    if (operations.length === 0) {
      // Silent exit if no operations found
      return;
    }

    // Check which output files are tracked by git (only prompt if not silent)
    if (!argv.silent && !argv['no-gitignore']) {
      const trackedFiles = await checkTrackedOutputFiles(operations);
      
      if (trackedFiles.length > 0) {
        // Show warning about files that will be affected
        logger.warn('⚠️  Warning: The following files will be overwritten and untracked from git:');
        for (const file of trackedFiles) {
          logger.warn(`  - ${path.relative(process.cwd(), file)}`);
        }
        logger.info('');
        
        // Prompt for confirmation
        const confirmed = await promptConfirmation('Do you want to continue?');
        
        if (!confirmed) {
          logger.info('Aborted.');
          process.exit(0);
        }
        logger.info('');
      }
    }

    const results = await performAllMerges(operations);
    
    // Manage gitignore
    const outputPaths = operations.map(op => op.outputPath);
    await manageGitignore(outputPaths, { noGitignore: argv['no-gitignore'] });
    
    // Count successful changes
    const changed = results.filter(r => r.changed).length;
    const failed = results.filter(r => !r.success && r.error).length;

    if (!logger.isSilent()) {
      if (changed > 0) {
        logger.success(`Merged ${changed} file(s)`);
      }
      if (failed > 0) {
        logger.error(`Failed to merge ${failed} file(s)`);
      }
    }

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleInfo(argv: any) {
  try {
    const machineName = getMachineName();
    const operations = await scanForMergeOperations(machineName);

    console.log(`Machine name: ${machineName}`);
    console.log(`Repository: ${process.cwd()}`);
    
    // Check hooks method
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout } = await execAsync('git config --get core.hooksPath');
      const hooksPath = stdout.trim();
      if (hooksPath) {
        console.log(`Hooks method: core.hooksPath`);
        console.log(`Hooks path: ${hooksPath}`);
      } else {
        console.log(`Hooks method: legacy (.git/hooks)`);
      }
    } catch {
      console.log(`Hooks method: not installed`);
    }

    console.log(`Tracked patterns: ${operations.length}`);
    for (const op of operations) {
      const baseName = op.basePath ? path.basename(op.basePath) : '(none)';
      const machineName = path.basename(op.machinePath);
      const outputName = path.basename(op.outputPath);
      console.log(`  - ${baseName} + ${machineName} → ${outputName}`);
    }
    
    // Show which output files currently exist
    if (operations.length > 0) {
      const existingFiles = await checkExistingOutputFiles(operations);
      console.log('');
      console.log(`Output files: ${operations.length} total, ${existingFiles.length} existing`);
      if (existingFiles.length > 0) {
        console.log('Existing output files:');
        for (const file of existingFiles) {
          console.log(`  - ${path.relative(process.cwd(), file)}`);
        }
      }
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleUninstall(argv: any) {
  try {
    await uninstallHooks();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function handleWatch(argv: any) {
  try {
    const machineName = getMachineName();
    
    // Parse debounce option
    const debounce = argv.debounce ? parseInt(argv.debounce, 10) : 300;
    if (isNaN(debounce) || debounce < 0) {
      logger.error('Invalid debounce value. Must be a positive number.');
      process.exit(1);
    }
    
    // Start watcher
    const stopWatcher = await startWatcher(machineName, {
      debounce,
      verbose: argv.verbose || false,
      cwd: process.cwd(),
    });
    
    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await stopWatcher();
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
permachine - Automatically merge machine-specific config files

USAGE:
  permachine <command> [options]

COMMANDS:
  init                Initialize permachine in current repository
  merge               Manually trigger merge operation
  info                Show information about current setup
  uninstall           Uninstall git hooks
  watch               Watch for file changes and auto-merge

OPTIONS:
  --help, -h          Show this help message
  --version, -v       Show version number
  --silent, -s        Suppress all output except errors (for merge command)
  --legacy            Use legacy .git/hooks wrapping (for init command)
  --auto              Auto-detect best installation method (for init command)
  --no-gitignore      Don't manage .gitignore or git tracking (for init/merge commands)
  --debounce <ms>     Debounce delay in milliseconds (for watch command, default: 300)
  --verbose           Show detailed file change events (for watch command)

EXAMPLES:
  permachine init
  permachine merge --silent
  permachine info
  permachine uninstall
  permachine watch
  permachine watch --debounce 500 --verbose

DOCUMENTATION:
  https://github.com/JosXa/permachine
  `);
}

async function showVersion() {
  try {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    console.log(packageJson.version);
  } catch {
    console.log('unknown');
  }
}

// Run main
main().catch(error => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

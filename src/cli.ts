#!/usr/bin/env node

import minimist from 'minimist';
import { getMachineName } from './core/machine-detector.js';
import { scanForMergeOperations } from './core/file-scanner.js';
import { performAllMerges } from './core/merger.js';
import { installHooks, uninstallHooks } from './core/git-hooks.js';
import { logger } from './utils/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['help', 'version', 'silent', 'legacy', 'auto', 'with-package-json'],
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

    // Install git hooks
    const installResult = await installHooks({
      legacy: argv.legacy,
    });

    if (installResult.warnings.length > 0) {
      for (const warning of installResult.warnings) {
        logger.warn(warning);
      }
    }

    // Scan for existing machine-specific files
    const operations = await scanForMergeOperations(machineName);
    
    if (operations.length > 0) {
      logger.info(`Found ${operations.length} machine-specific file(s)`);
      
      // Perform initial merge
      const results = await performAllMerges(operations);
      const changed = results.filter(r => r.changed).length;
      
      if (changed > 0) {
        logger.success(`Merged ${changed} file(s)`);
      }

      // Update .gitignore
      await updateGitignore(operations);
    } else {
      logger.info('No machine-specific files found');
      logger.info('');
      logger.info('Next steps:');
      logger.info('1. Create base config files (e.g., config.base.json)');
      logger.info(`2. Create machine-specific configs (e.g., config.${machineName}.json)`);
      logger.info('3. Run: machine-config-sync merge');
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

    const results = await performAllMerges(operations);
    
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

async function updateGitignore(operations: any[]) {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const marker = '# Added by machine-config-sync';
  
  let content = '';
  try {
    content = await fs.readFile(gitignorePath, 'utf-8');
  } catch {
    // File doesn't exist, create new
  }

  // Extract output files to ignore
  const filesToIgnore = operations.map(op => path.relative(process.cwd(), op.outputPath));
  
  // Check if marker already exists
  if (content.includes(marker)) {
    // Already set up, don't add duplicates
    return;
  }

  // Add marker and files
  const additions = [
    '',
    marker,
    ...filesToIgnore,
  ].join('\n');

  await fs.writeFile(gitignorePath, content + additions + '\n', 'utf-8');
  logger.success(`Updated .gitignore with ${filesToIgnore.length} file(s)`);
}

function showHelp() {
  console.log(`
machine-config-sync - Automatically merge machine-specific config files

USAGE:
  machine-config-sync <command> [options]

COMMANDS:
  init                Initialize machine-config-sync in current repository
  merge               Manually trigger merge operation
  info                Show information about current setup
  uninstall           Uninstall git hooks

OPTIONS:
  --help, -h          Show this help message
  --version, -v       Show version number
  --silent, -s        Suppress all output except errors (for merge command)
  --legacy            Use legacy .git/hooks wrapping (for init command)
  --auto              Auto-detect best installation method (for init command)

EXAMPLES:
  machine-config-sync init
  machine-config-sync merge --silent
  machine-config-sync info
  machine-config-sync uninstall

DOCUMENTATION:
  https://github.com/JosXa/machine-config-sync
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

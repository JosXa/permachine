import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export interface GitignoreResult {
  added: string[];
  removed: string[];
  errors: string[];
}

/**
 * Manage gitignore entries for output files
 */
export async function manageGitignore(
  outputPaths: string[],
  options: { noGitignore?: boolean; cwd?: string } = {}
): Promise<GitignoreResult> {
  const result: GitignoreResult = {
    added: [],
    removed: [],
    errors: [],
  };

  if (options.noGitignore) {
    return result;
  }

  const cwd = options.cwd || process.cwd();
  const gitignorePath = path.join(cwd, '.gitignore');

  try {
    // Get relative paths from repo root
    const relativePaths = outputPaths.map(p => path.relative(cwd, p).replace(/\\/g, '/'));

    // Read or create .gitignore
    let gitignoreContent = '';
    let gitignoreExists = false;

    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      gitignoreExists = true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Parse existing entries
    const lines = gitignoreContent.split('\n');
    const existingEntries = new Set(lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')));

    // Add missing entries
    let modified = false;
    const newEntries: string[] = [];

    for (const relPath of relativePaths) {
      if (!existingEntries.has(relPath)) {
        newEntries.push(relPath);
        modified = true;
        result.added.push(relPath);
      }
    }

    // Write updated .gitignore if needed
    if (modified) {
      const updatedContent = gitignoreExists
        ? gitignoreContent + (gitignoreContent.endsWith('\n') ? '' : '\n') + newEntries.join('\n') + '\n'
        : newEntries.join('\n') + '\n';

      await fs.writeFile(gitignorePath, updatedContent, 'utf-8');
      
      if (!gitignoreExists) {
        logger.info('Created .gitignore');
      }
    }

    // Remove files from git index if they're tracked
    for (const relPath of relativePaths) {
      try {
        const isTracked = await isFileTrackedByGit(relPath, cwd);
        if (isTracked) {
          await execAsync(`git rm --cached "${relPath}"`, { cwd });
          result.removed.push(relPath);
          logger.info(`Removed ${relPath} from git tracking`);
        }
      } catch (error: any) {
        // Ignore errors for files that don't exist or aren't tracked
        if (!error.message.includes('did not match any files')) {
          result.errors.push(`Failed to untrack ${relPath}: ${error.message}`);
        }
      }
    }

  } catch (error: any) {
    result.errors.push(`Failed to manage .gitignore: ${error.message}`);
  }

  return result;
}

/**
 * Check if a file is tracked by git
 */
export async function isFileTrackedByGit(filePath: string, cwd: string): Promise<boolean> {
  try {
    await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd });
    return true;
  } catch {
    return false;
  }
}

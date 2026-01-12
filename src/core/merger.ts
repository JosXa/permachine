import fs from 'node:fs/promises';
import path from 'node:path';
import type { MergeOperation } from './file-scanner.js';
import { getAdapter } from '../adapters/adapter-factory.js';
import { logger } from '../utils/logger.js';

export interface MergeResult {
  success: boolean;
  operation: MergeOperation;
  changed: boolean;      // Was output file modified?
  skipped: boolean;      // Was operation skipped?
  error?: Error;
}

/**
 * Perform a merge operation
 */
export async function performMerge(
  operation: MergeOperation,
): Promise<MergeResult> {
  try {
    // Get appropriate adapter
    const adapter = getAdapter(operation.outputPath);
    if (!adapter) {
      return {
        success: false,
        operation,
        changed: false,
        skipped: true,
        error: new Error(`No adapter found for file type: ${path.extname(operation.outputPath)}`),
      };
    }

    // Check which files exist
    const [baseExists, machineExists] = await Promise.all([
      fileExists(operation.basePath),
      fileExists(operation.machinePath),
    ]);

    // If neither exists, skip
    if (!baseExists && !machineExists) {
      return {
        success: false,
        operation,
        changed: false,
        skipped: true,
      };
    }

    let mergedContent: string;

    // Determine merge strategy based on what exists
    if (baseExists && machineExists) {
      // Both exist - merge them
      const [baseContent, machineContent] = await Promise.all([
        fs.readFile(operation.basePath!, 'utf-8'),
        fs.readFile(operation.machinePath, 'utf-8'),
      ]);

      const baseParsed = adapter.parse(baseContent);
      const machineParsed = adapter.parse(machineContent);
      const merged = adapter.merge(baseParsed, machineParsed);
      mergedContent = adapter.serialize(merged);
    } else if (machineExists) {
      // Only machine exists - use it
      mergedContent = await fs.readFile(operation.machinePath, 'utf-8');
    } else {
      // Only base exists - use it
      mergedContent = await fs.readFile(operation.basePath!, 'utf-8');
    }

    // Check if output file already has the same content
    const outputExists = await fileExists(operation.outputPath);
    if (outputExists) {
      const existingContent = await fs.readFile(operation.outputPath, 'utf-8');
      if (existingContent === mergedContent) {
        // No change needed
        return {
          success: true,
          operation,
          changed: false,
          skipped: false,
        };
      }
    }

    // Write the merged content
    await fs.writeFile(operation.outputPath, mergedContent, 'utf-8');

    // Log the operation
    const baseFile = operation.basePath ? path.basename(operation.basePath) : '';
    const machineFile = path.basename(operation.machinePath);
    const outputFile = path.basename(operation.outputPath);

    if (baseExists && machineExists) {
      logger.info(`Merged ${baseFile} + ${machineFile} → ${outputFile}`);
    } else if (machineExists) {
      logger.info(`Copied ${machineFile} → ${outputFile}`);
    } else {
      logger.info(`Copied ${baseFile} → ${outputFile}`);
    }

    return {
      success: true,
      operation,
      changed: true,
      skipped: false,
    };
  } catch (error) {
    return {
      success: false,
      operation,
      changed: false,
      skipped: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform all merge operations
 */
export async function performAllMerges(
  operations: MergeOperation[],
): Promise<MergeResult[]> {
  const results: MergeResult[] = [];

  for (const operation of operations) {
    const result = await performMerge(operation);
    results.push(result);

    // Log errors
    if (!result.success && result.error) {
      logger.error(`Failed to merge ${path.basename(operation.machinePath)}: ${result.error.message}`);
    }
  }

  return results;
}

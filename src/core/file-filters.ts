/**
 * File Filters - Extensible system for matching files based on context
 * 
 * Supports syntax like:
 *   config.{os=windows}.json
 *   secrets.{machine=work-laptop}{user=josxa}.env
 *   app.{env=prod}{arch=x64}.json
 *   file.{base}.json  (placeholder that references the base filename)
 * 
 * Future enhancements:
 *   - Negation: {os!=windows}
 *   - OR conditions: {os=windows,linux}
 *   - Wildcards: {machine=laptop*}
 *   - Ranges: {version=1.2-1.5}
 */

import os from 'node:os';
import { getMachineName } from './machine-detector.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A single filter extracted from a filename
 * Example: {os=windows} -> { key: 'os', operator: '=', value: 'windows' }
 */
export interface Filter {
  key: string;
  operator: FilterOperator;
  value: string;
  raw: string; // Original filter string including braces
}

/**
 * Supported filter operators
 */
export type FilterOperator = 
  | '='   // Equals (currently supported)
  | '!='  // Not equals (future)
  | '~'   // Wildcard match (future)
  | '^'   // Range (future)
  ;

/**
 * Context information used to evaluate filters
 */
export interface FilterContext {
  os: string;           // 'windows', 'macos', 'linux', 'freebsd', etc.
  arch: string;         // 'x64', 'arm64', 'ia32', 'arm', etc.
  machine: string;      // Hostname/machine name
  user: string;         // Username
  env: string | null;   // NODE_ENV or custom environment
  platform: string;     // Node.js platform identifier
  [key: string]: string | null; // Allow custom keys
}

/**
 * Result of parsing filters from a filename
 */
export interface ParseResult {
  filters: Filter[];
  baseFilename: string; // Filename with all filters and placeholders removed
  hasBasePlaceholder: boolean; // Whether the filename contains {base} placeholder
}

/**
 * Match result indicating whether filters match context
 */
export interface MatchResult {
  matches: boolean;
  failedFilters: Filter[]; // Filters that didn't match
  context: FilterContext;
}

// ============================================================================
// Context Detection
// ============================================================================

let cachedContext: FilterContext | null = null;

/**
 * Get the current system context for filter evaluation
 */
export function getFilterContext(): FilterContext {
  if (cachedContext) {
    return cachedContext;
  }

  const platform = os.platform();
  
  // Normalize OS names to user-friendly values
  let osName: string;
  switch (platform) {
    case 'win32':
      osName = 'windows';
      break;
    case 'darwin':
      osName = 'macos';
      break;
    case 'linux':
      osName = 'linux';
      break;
    case 'freebsd':
      osName = 'freebsd';
      break;
    case 'openbsd':
      osName = 'openbsd';
      break;
    default:
      osName = platform;
  }

  cachedContext = {
    os: osName,
    arch: os.arch(),
    machine: getMachineName(),
    user: os.userInfo().username.toLowerCase(),
    env: process.env.NODE_ENV?.toLowerCase() || null,
    platform,
  };

  return cachedContext;
}

/**
 * Reset cached context (useful for testing)
 */
export function resetFilterContext(): void {
  cachedContext = null;
}

/**
 * Create a custom context (useful for testing or custom scenarios)
 */
export function createCustomContext(overrides: Partial<FilterContext>): FilterContext {
  const base = getFilterContext();
  return { ...base, ...overrides };
}

// ============================================================================
// Filter Parsing
// ============================================================================

/**
 * Regular expression to match filter syntax: {key=value} or {key!=value}
 * Captures: {key, operator, value}
 */
const FILTER_REGEX = /\{([a-zA-Z0-9_-]+)(=|!=|~|\^)([a-zA-Z0-9_*.,\-]+)\}/g;

/**
 * Regular expression to match {base} placeholder
 */
const BASE_PLACEHOLDER_REGEX = /\{base\}/gi;

/**
 * Parse filters from a filename
 * 
 * Example:
 *   parseFilters('config.{os=windows}{arch=x64}.json')
 *   -> {
 *        filters: [
 *          { key: 'os', operator: '=', value: 'windows', raw: '{os=windows}' },
 *          { key: 'arch', operator: '=', value: 'x64', raw: '{arch=x64}' }
 *        ],
 *        baseFilename: 'config.json',
 *        hasBasePlaceholder: false
 *      }
 * 
 *   parseFilters('file.{base}.json')
 *   -> {
 *        filters: [],
 *        baseFilename: 'file.json',
 *        hasBasePlaceholder: true
 *      }
 */
export function parseFilters(filename: string): ParseResult {
  const filters: Filter[] = [];
  let match: RegExpExecArray | null;

  // Check for {base} placeholder (reset regex state first)
  BASE_PLACEHOLDER_REGEX.lastIndex = 0;
  const hasBasePlaceholder = BASE_PLACEHOLDER_REGEX.test(filename);

  // Reset regex state
  FILTER_REGEX.lastIndex = 0;

  while ((match = FILTER_REGEX.exec(filename)) !== null) {
    const [raw, key, operator, value] = match;
    
    filters.push({
      key: key.toLowerCase(),
      operator: operator as FilterOperator,
      value: value.toLowerCase(),
      raw,
    });
  }

  // Remove all filters and {base} placeholders from filename to get base
  // Also remove the dot before the filter if it exists
  let baseFilename = filename
    .replace(/\.?\{[^}]+\}/g, '');
  
  // Clean up any double dots that may result
  baseFilename = baseFilename.replace(/\.{2,}/g, '.');

  return { filters, baseFilename, hasBasePlaceholder };
}

/**
 * Check if a filename contains any filters or placeholders
 */
export function hasFilters(filename: string): boolean {
  // Check for filter syntax
  FILTER_REGEX.lastIndex = 0;
  const hasFilterSyntax = FILTER_REGEX.test(filename);
  
  // Check for {base} placeholder
  BASE_PLACEHOLDER_REGEX.lastIndex = 0;
  const hasBasePlaceholder = BASE_PLACEHOLDER_REGEX.test(filename);
  
  return hasFilterSyntax || hasBasePlaceholder;
}

/**
 * Extract just the filter strings from a filename
 */
export function extractFilterStrings(filename: string): string[] {
  const { filters } = parseFilters(filename);
  return filters.map(f => f.raw);
}

/**
 * Expand {base} placeholder in a filename with the actual base filename
 * 
 * The {base} placeholder is replaced with the filename part before the first placeholder/filter.
 * This allows referencing the base filename within the filename itself.
 * 
 * Example:
 *   expandBasePlaceholder('file.{base}.json') -> 'file.file.json'
 *   expandBasePlaceholder('config.{os=windows}.{base}.json') -> 'config.{os=windows}.config.json'
 */
export function expandBasePlaceholder(filename: string): string {
  const { hasBasePlaceholder } = parseFilters(filename);
  
  if (!hasBasePlaceholder) {
    return filename;
  }
  
  // Extract the part before the first { character - this is our base name
  const firstBraceIndex = filename.indexOf('{');
  if (firstBraceIndex === -1) {
    return filename;
  }
  
  // Get the base part (everything before the first '{'), removing trailing dot if present
  let basePart = filename.substring(0, firstBraceIndex);
  if (basePart.endsWith('.')) {
    basePart = basePart.substring(0, basePart.length - 1);
  }
  
  // Replace all {base} placeholders with this base part
  BASE_PLACEHOLDER_REGEX.lastIndex = 0;
  return filename.replace(BASE_PLACEHOLDER_REGEX, basePart);
}

// ============================================================================
// Filter Matching
// ============================================================================

/**
 * Evaluate a single filter against a context
 */
export function evaluateFilter(filter: Filter, context: FilterContext): boolean {
  const contextValue = context[filter.key];
  
  // If the context doesn't have this key, the filter fails
  if (contextValue === null || contextValue === undefined) {
    return false;
  }

  switch (filter.operator) {
    case '=':
      return evaluateEquals(filter.value, contextValue);
    
    case '!=':
      return !evaluateEquals(filter.value, contextValue);
    
    case '~':
      return evaluateWildcard(filter.value, contextValue);
    
    case '^':
      return evaluateRange(filter.value, contextValue);
    
    default:
      // Unknown operator
      return false;
  }
}

/**
 * Evaluate equals operator (with support for OR via comma)
 * Examples:
 *   'windows' = 'windows' -> true
 *   'windows,linux' = 'windows' -> true (OR)
 *   'windows,linux' = 'macos' -> false
 */
function evaluateEquals(filterValue: string, contextValue: string): boolean {
  const options = filterValue.split(',').map(v => v.trim().toLowerCase());
  return options.includes(contextValue.toLowerCase());
}

/**
 * Evaluate wildcard operator (future enhancement)
 * Examples:
 *   'laptop*' ~ 'laptop-work' -> true
 *   'prod-*' ~ 'prod-us-east' -> true
 */
function evaluateWildcard(filterValue: string, contextValue: string): boolean {
  // Convert wildcard pattern to regex
  const regexPattern = filterValue
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\*/g, '.*'); // Replace * with .*
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(contextValue);
}

/**
 * Evaluate range operator (future enhancement)
 * Examples:
 *   '1.0-2.0' ^ '1.5' -> true
 *   '10-20' ^ '15' -> true
 */
function evaluateRange(filterValue: string, contextValue: string): boolean {
  const [min, max] = filterValue.split('-').map(v => v.trim());
  
  // Try numeric comparison
  const numContext = parseFloat(contextValue);
  const numMin = parseFloat(min);
  const numMax = parseFloat(max);
  
  if (!isNaN(numContext) && !isNaN(numMin) && !isNaN(numMax)) {
    return numContext >= numMin && numContext <= numMax;
  }
  
  // Fallback to string comparison
  return contextValue >= min && contextValue <= max;
}

/**
 * Match a filename against a context
 * Returns match result with details
 */
export function matchFilters(
  filename: string,
  context?: FilterContext
): MatchResult {
  const ctx = context || getFilterContext();
  const { filters } = parseFilters(filename);

  // If no filters, it always matches
  if (filters.length === 0) {
    return {
      matches: true,
      failedFilters: [],
      context: ctx,
    };
  }

  // Evaluate all filters (AND logic)
  const failedFilters: Filter[] = [];
  
  for (const filter of filters) {
    if (!evaluateFilter(filter, ctx)) {
      failedFilters.push(filter);
    }
  }

  return {
    matches: failedFilters.length === 0,
    failedFilters,
    context: ctx,
  };
}

/**
 * Check if a filename matches the current context (convenience wrapper)
 */
export function isMatch(filename: string, context?: FilterContext): boolean {
  return matchFilters(filename, context).matches;
}

// ============================================================================
// File Discovery Helpers
// ============================================================================

/**
 * Given a filename with filters, generate the base filename
 * Example: 'config.{os=windows}.json' -> 'config.json'
 */
export function getBaseFilename(filename: string): string {
  return parseFilters(filename).baseFilename;
}

/**
 * Given a base filename, check if a machine-specific version exists that matches current context
 * This is useful for discovering which machine-specific files apply to this machine
 */
export function matchesCurrentContext(filename: string): boolean {
  return isMatch(filename);
}

// ============================================================================
// Backward Compatibility Layer
// ============================================================================

/**
 * Convert old `.machine-name.` syntax to new `{machine=name}` syntax
 * Example: 'config.my-laptop.json' -> 'config.{machine=my-laptop}.json'
 * Example: '.env.homezone' -> '.env.{machine=homezone}'
 */
export function convertLegacyFilename(filename: string, machineName: string): string {
  // Handle two patterns:
  // 1. .machineName. (middle of filename) -> .{machine=machineName}.
  // 2. .machineName (end of filename) -> .{machine=machineName}
  
  const middlePattern = new RegExp(`\\.${machineName}\\.`, 'gi');
  const endPattern = new RegExp(`\\.${machineName}$`, 'gi');
  
  let result = filename.replace(middlePattern, `.{machine=${machineName}}.`);
  result = result.replace(endPattern, `.{machine=${machineName}}`);
  
  return result;
}

/**
 * Check if filename uses old `.machine-name.` syntax
 */
export function isLegacyFilename(filename: string, machineName: string): boolean {
  const middlePattern = new RegExp(`\\.${machineName}\\.`, 'i');
  const endPattern = new RegExp(`\\.${machineName}$`, 'i');
  return (middlePattern.test(filename) || endPattern.test(filename)) && !hasFilters(filename);
}

/**
 * Parse old-style or new-style filenames uniformly
 * Returns filters array (converts legacy to new format internally)
 */
export function parseAnyFormat(filename: string, machineName?: string): ParseResult {
  const machine = machineName || getMachineName();
  
  if (isLegacyFilename(filename, machine)) {
    const converted = convertLegacyFilename(filename, machine);
    return parseFilters(converted);
  }
  
  return parseFilters(filename);
}

/**
 * Check if a filename represents a base file
 * 
 * Base files can be:
 * - Legacy: config.base.json, .env.base
 * - New: file.{base}.json, file.{base}.{os=windows}.json
 * 
 * @param filename - The filename to check
 * @returns true if the filename represents a base file
 */
export function isBaseFile(filename: string): boolean {
  // Check for legacy .base pattern (e.g., config.base.json, .env.base)
  const hasLegacyBase = filename.includes('.base.') || 
                        filename.endsWith('.base');
  
  // Check for new {base} placeholder syntax (e.g., file.{base}.json)
  const parseResult = parseFilters(filename);
  const hasNewBase = parseResult.hasBasePlaceholder;
  
  return hasLegacyBase || hasNewBase;
}

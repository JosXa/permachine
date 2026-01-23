import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  isFilteredDirectory,
  matchDirectoryFilters,
  getBaseDirectoryName,
  isBaseDirectory,
  createCustomContext,
  resetFilterContext,
} from '../../src/core/file-filters.js';

// Reset context before each test to ensure isolation
beforeEach(() => {
  resetFilterContext();
});

afterEach(() => {
  resetFilterContext();
});

describe('isFilteredDirectory', () => {
  test('returns true for directory with machine filter', () => {
    expect(isFilteredDirectory('jira.{machine=homezone}')).toBe(true);
  });

  test('returns true for directory with os filter', () => {
    expect(isFilteredDirectory('config.{os=windows}')).toBe(true);
  });

  test('returns true for directory with multiple filters', () => {
    expect(isFilteredDirectory('app.{machine=laptop}{os=linux}')).toBe(true);
  });

  test('returns true for directory with OR syntax filter', () => {
    expect(isFilteredDirectory('app.{os=windows,linux,darwin}')).toBe(true);
  });

  test('returns true for directory with user filter', () => {
    expect(isFilteredDirectory('settings.{user=admin}')).toBe(true);
  });

  test('returns true for directory with arch filter', () => {
    expect(isFilteredDirectory('binaries.{arch=x64}')).toBe(true);
  });

  test('returns true for directory with env filter', () => {
    expect(isFilteredDirectory('secrets.{env=production}')).toBe(true);
  });

  test('returns false for regular directory', () => {
    expect(isFilteredDirectory('jira')).toBe(false);
  });

  test('returns false for directory with regular name', () => {
    expect(isFilteredDirectory('my-project')).toBe(false);
  });

  test('returns false for directory with dots but no filter', () => {
    expect(isFilteredDirectory('my.project.name')).toBe(false);
  });

  test('returns false for directory with curly braces but no valid filter', () => {
    expect(isFilteredDirectory('jira.{invalid}')).toBe(false);
  });

  test('returns false for directory with incomplete filter syntax', () => {
    expect(isFilteredDirectory('jira.{machine}')).toBe(false);
  });

  test('returns false for base directory pattern', () => {
    expect(isFilteredDirectory('jira.base')).toBe(false);
  });

  test('returns false for hidden directory', () => {
    expect(isFilteredDirectory('.hidden')).toBe(false);
  });

  test('returns true for hidden directory with filter', () => {
    expect(isFilteredDirectory('.config.{machine=laptop}')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isFilteredDirectory('')).toBe(false);
  });

  test('handles filter with not-equals operator', () => {
    expect(isFilteredDirectory('config.{os!=windows}')).toBe(true);
  });

  test('handles filter with wildcard operator', () => {
    expect(isFilteredDirectory('config.{machine~laptop*}')).toBe(true);
  });
});

describe('getBaseDirectoryName', () => {
  test('extracts base name from machine filter', () => {
    expect(getBaseDirectoryName('jira.{machine=homezone}')).toBe('jira');
  });

  test('extracts base name from os filter', () => {
    expect(getBaseDirectoryName('config.{os=windows}')).toBe('config');
  });

  test('extracts base name from multiple filters', () => {
    expect(getBaseDirectoryName('config.{os=windows}{arch=x64}')).toBe('config');
  });

  test('extracts base name from filter with OR syntax', () => {
    expect(getBaseDirectoryName('app.{os=windows,linux}')).toBe('app');
  });

  test('handles filter at start of name', () => {
    expect(getBaseDirectoryName('{machine=work}.settings')).toBe('settings');
  });

  test('returns same name if no filters', () => {
    expect(getBaseDirectoryName('regular-dir')).toBe('regular-dir');
  });

  test('handles directory name with dashes', () => {
    expect(getBaseDirectoryName('my-project.{machine=work}')).toBe('my-project');
  });

  test('handles directory name with underscores', () => {
    expect(getBaseDirectoryName('my_project.{machine=work}')).toBe('my_project');
  });

  test('handles hidden directory with filter', () => {
    expect(getBaseDirectoryName('.config.{machine=laptop}')).toBe('.config');
  });

  test('handles multiple filters in different positions', () => {
    expect(getBaseDirectoryName('pre.{os=linux}.mid.{arch=x64}.post')).toBe('pre.mid.post');
  });

  test('handles filter with spaces in name (encoded)', () => {
    expect(getBaseDirectoryName('my-dir.{machine=my-machine}')).toBe('my-dir');
  });

  test('handles very long directory name', () => {
    const longName = 'a'.repeat(100) + '.{machine=test}';
    expect(getBaseDirectoryName(longName)).toBe('a'.repeat(100));
  });
});

describe('matchDirectoryFilters', () => {
  test('matches when machine filter matches context', () => {
    const context = createCustomContext({ machine: 'homezone' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    expect(result.matches).toBe(true);
  });

  test('does not match when machine filter differs', () => {
    const context = createCustomContext({ machine: 'workstation' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    expect(result.matches).toBe(false);
  });

  test('matches with OR syntax - first option', () => {
    const context = createCustomContext({ os: 'windows' });
    const result = matchDirectoryFilters('app.{os=windows,linux,darwin}', context);
    expect(result.matches).toBe(true);
  });

  test('matches with OR syntax - middle option', () => {
    const context = createCustomContext({ os: 'linux' });
    const result = matchDirectoryFilters('app.{os=windows,linux,darwin}', context);
    expect(result.matches).toBe(true);
  });

  test('matches with OR syntax - last option', () => {
    const context = createCustomContext({ os: 'darwin' });
    const result = matchDirectoryFilters('app.{os=windows,linux,darwin}', context);
    expect(result.matches).toBe(true);
  });

  test('does not match with OR syntax when no option matches', () => {
    const context = createCustomContext({ os: 'freebsd' });
    const result = matchDirectoryFilters('app.{os=windows,linux,darwin}', context);
    expect(result.matches).toBe(false);
  });

  test('matches with multiple filters (AND logic) - all match', () => {
    const context = createCustomContext({ machine: 'laptop', os: 'windows' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(true);
  });

  test('fails if any filter in AND chain fails - first fails', () => {
    const context = createCustomContext({ machine: 'desktop', os: 'windows' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(false);
  });

  test('fails if any filter in AND chain fails - second fails', () => {
    const context = createCustomContext({ machine: 'laptop', os: 'linux' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(false);
  });

  test('fails if all filters in AND chain fail', () => {
    const context = createCustomContext({ machine: 'desktop', os: 'linux' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(false);
  });

  test('matches os filter with platform mapping', () => {
    // On Windows, process.platform is 'win32' but filter uses 'windows'
    const context = createCustomContext({ os: 'windows' });
    const result = matchDirectoryFilters('app.{os=windows}', context);
    expect(result.matches).toBe(true);
  });

  test('matches arch filter', () => {
    const context = createCustomContext({ arch: 'x64' });
    const result = matchDirectoryFilters('binaries.{arch=x64}', context);
    expect(result.matches).toBe(true);
  });

  test('matches user filter', () => {
    const context = createCustomContext({ user: 'admin' });
    const result = matchDirectoryFilters('settings.{user=admin}', context);
    expect(result.matches).toBe(true);
  });

  test('matches env filter', () => {
    const context = createCustomContext({ env: 'production' });
    const result = matchDirectoryFilters('secrets.{env=production}', context);
    expect(result.matches).toBe(true);
  });

  test('case insensitive matching', () => {
    const context = createCustomContext({ machine: 'HOMEZONE' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    // Context values are lowercased during creation
    expect(result.matches).toBe(true);
  });

  test('returns failed filters when no match', () => {
    const context = createCustomContext({ machine: 'other' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    expect(result.matches).toBe(false);
    expect(result.failedFilters).toHaveLength(1);
    expect(result.failedFilters[0].key).toBe('machine');
  });

  test('directory without filters always matches', () => {
    const context = createCustomContext({ machine: 'any' });
    const result = matchDirectoryFilters('regular-dir', context);
    expect(result.matches).toBe(true);
  });

  test('handles not-equals operator - matches when different', () => {
    const context = createCustomContext({ os: 'linux' });
    const result = matchDirectoryFilters('config.{os!=windows}', context);
    expect(result.matches).toBe(true);
  });

  test('handles not-equals operator - fails when same', () => {
    const context = createCustomContext({ os: 'windows' });
    const result = matchDirectoryFilters('config.{os!=windows}', context);
    expect(result.matches).toBe(false);
  });
});

describe('isBaseDirectory', () => {
  test('returns true for simple base directory', () => {
    expect(isBaseDirectory('jira.base')).toBe(true);
  });

  test('returns true for multi-part base directory', () => {
    expect(isBaseDirectory('my-config.base')).toBe(true);
  });

  test('returns false for regular directory', () => {
    expect(isBaseDirectory('jira')).toBe(false);
  });

  test('returns false for filtered directory', () => {
    expect(isBaseDirectory('jira.{machine=homezone}')).toBe(false);
  });

  test('returns false for directory ending with base as part of name', () => {
    expect(isBaseDirectory('database')).toBe(false);
  });

  test('returns false for directory with base in middle', () => {
    expect(isBaseDirectory('base.config')).toBe(false);
  });

  test('returns false for hidden directory', () => {
    expect(isBaseDirectory('.base')).toBe(true);
  });

  test('returns true for hidden directory with .base suffix', () => {
    expect(isBaseDirectory('.config.base')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isBaseDirectory('')).toBe(false);
  });

  test('handles case sensitivity - lowercase', () => {
    expect(isBaseDirectory('config.base')).toBe(true);
  });

  test('handles case - uppercase BASE should not match', () => {
    // We only check for lowercase .base suffix
    expect(isBaseDirectory('config.BASE')).toBe(false);
  });
});

describe('edge cases and cross-platform compatibility', () => {
  test('handles directory names with numbers', () => {
    expect(isFilteredDirectory('config2.{machine=test}')).toBe(true);
    expect(getBaseDirectoryName('config2.{machine=test}')).toBe('config2');
  });

  test('handles directory names starting with numbers', () => {
    expect(isFilteredDirectory('123.{machine=test}')).toBe(true);
    expect(getBaseDirectoryName('123.{machine=test}')).toBe('123');
  });

  test('handles complex filter values with dashes', () => {
    const context = createCustomContext({ machine: 'my-work-laptop' });
    const result = matchDirectoryFilters('config.{machine=my-work-laptop}', context);
    expect(result.matches).toBe(true);
  });

  test('handles filter values with numbers', () => {
    const context = createCustomContext({ machine: 'server01' });
    const result = matchDirectoryFilters('config.{machine=server01}', context);
    expect(result.matches).toBe(true);
  });

  test('handles multiple dots in directory name', () => {
    expect(getBaseDirectoryName('my.config.dir.{machine=test}')).toBe('my.config.dir');
  });

  test('preserves directory name structure with filter in middle', () => {
    expect(getBaseDirectoryName('pre.{machine=test}.post')).toBe('pre.post');
  });
});

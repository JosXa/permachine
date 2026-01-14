import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  parseFilters,
  hasFilters,
  extractFilterStrings,
  expandBasePlaceholder,
  getFilterContext,
  resetFilterContext,
  createCustomContext,
  matchFilters,
  isMatch,
  getBaseFilename,
  evaluateFilter,
  convertLegacyFilename,
  isLegacyFilename,
  parseAnyFormat,
  isBaseFile,
  type Filter,
  type FilterContext,
} from '../../src/core/file-filters.js';

describe('parseFilters', () => {
  test('parses single filter', () => {
    const result = parseFilters('config.{os=windows}.json');
    
    expect(result.filters).toHaveLength(1);
    expect(result.filters[0]).toEqual({
      key: 'os',
      operator: '=',
      value: 'windows',
      raw: '{os=windows}',
    });
    expect(result.baseFilename).toBe('config.json');
  });

  test('parses multiple filters', () => {
    const result = parseFilters('app.{os=windows}{arch=x64}.json');
    
    expect(result.filters).toHaveLength(2);
    expect(result.filters[0].key).toBe('os');
    expect(result.filters[1].key).toBe('arch');
    expect(result.baseFilename).toBe('app.json');
  });

  test('parses complex multi-filter filename', () => {
    const result = parseFilters('secrets.{machine=work-laptop}{user=josxa}{env=prod}.env');
    
    expect(result.filters).toHaveLength(3);
    expect(result.baseFilename).toBe('secrets.env');
  });

  test('handles filename with no filters', () => {
    const result = parseFilters('config.json');
    
    expect(result.filters).toHaveLength(0);
    expect(result.baseFilename).toBe('config.json');
  });

  test('normalizes keys and values to lowercase', () => {
    const result = parseFilters('config.{OS=Windows}.json');
    
    expect(result.filters[0].key).toBe('os');
    expect(result.filters[0].value).toBe('windows');
  });

  test('supports different operators', () => {
    const result = parseFilters('file.{os!=windows}{machine~laptop*}.json');
    
    expect(result.filters[0].operator).toBe('!=');
    expect(result.filters[1].operator).toBe('~');
  });

  test('handles dotfiles', () => {
    const result = parseFilters('.env.{machine=homezone}');
    
    expect(result.filters).toHaveLength(1);
    expect(result.baseFilename).toBe('.env');
  });

  test('handles multiple extensions', () => {
    const result = parseFilters('backup.{env=prod}.tar.gz');
    
    expect(result.filters).toHaveLength(1);
    expect(result.baseFilename).toBe('backup.tar.gz');
  });

  test('detects {base} placeholder', () => {
    const result = parseFilters('file.{base}.json');
    
    expect(result.hasBasePlaceholder).toBe(true);
    expect(result.baseFilename).toBe('file.json');
    expect(result.filters).toHaveLength(0);
  });

  test('handles {base} with filters', () => {
    const result = parseFilters('config.{os=windows}.{base}.json');
    
    expect(result.hasBasePlaceholder).toBe(true);
    expect(result.baseFilename).toBe('config.json');
    expect(result.filters).toHaveLength(1);
  });

  test('{base} placeholder is case-insensitive', () => {
    const result1 = parseFilters('file.{BASE}.json');
    const result2 = parseFilters('file.{Base}.json');
    
    expect(result1.hasBasePlaceholder).toBe(true);
    expect(result2.hasBasePlaceholder).toBe(true);
  });
});

describe('hasFilters', () => {
  test('returns true for files with filters', () => {
    expect(hasFilters('config.{os=windows}.json')).toBe(true);
    expect(hasFilters('app.{os=windows}{arch=x64}.json')).toBe(true);
  });

  test('returns false for files without filters', () => {
    expect(hasFilters('config.json')).toBe(false);
    expect(hasFilters('config.base.json')).toBe(false);
  });
});

describe('extractFilterStrings', () => {
  test('extracts filter strings', () => {
    const filters = extractFilterStrings('app.{os=windows}{arch=x64}.json');
    
    expect(filters).toEqual(['{os=windows}', '{arch=x64}']);
  });

  test('returns empty array for no filters', () => {
    const filters = extractFilterStrings('config.json');
    
    expect(filters).toEqual([]);
  });
});

describe('expandBasePlaceholder', () => {
  test('expands {base} placeholder to base filename', () => {
    const result = expandBasePlaceholder('file.{base}.json');
    
    expect(result).toBe('file.file.json');
  });

  test('expands {base} with filters present', () => {
    const result = expandBasePlaceholder('config.{os=windows}.{base}.json');
    
    expect(result).toBe('config.{os=windows}.config.json');
  });

  test('returns original filename if no {base} placeholder', () => {
    const result = expandBasePlaceholder('config.{os=windows}.json');
    
    expect(result).toBe('config.{os=windows}.json');
  });

  test('handles multiple {base} placeholders', () => {
    const result = expandBasePlaceholder('file.{base}.{base}.json');
    
    expect(result).toBe('file.file.file.json');
  });

  test('handles {BASE} case-insensitive', () => {
    const result1 = expandBasePlaceholder('file.{BASE}.json');
    const result2 = expandBasePlaceholder('file.{Base}.json');
    
    expect(result1).toBe('file.file.json');
    expect(result2).toBe('file.file.json');
  });

  test('expands {base} in dotfiles', () => {
    const result = expandBasePlaceholder('.env.{base}');
    
    expect(result).toBe('.env..env');
  });

  test('complex scenario with filters before and after {base}', () => {
    const result = expandBasePlaceholder('app.{env=prod}.{base}.{machine=laptop}.json');
    
    expect(result).toBe('app.{env=prod}.app.{machine=laptop}.json');
  });
});

describe('getFilterContext', () => {
  beforeEach(() => {
    resetFilterContext();
  });

  test('returns context with required fields', () => {
    const context = getFilterContext();
    
    expect(context).toHaveProperty('os');
    expect(context).toHaveProperty('arch');
    expect(context).toHaveProperty('machine');
    expect(context).toHaveProperty('user');
    expect(context).toHaveProperty('platform');
    expect(typeof context.os).toBe('string');
    expect(typeof context.arch).toBe('string');
    expect(typeof context.machine).toBe('string');
    expect(typeof context.user).toBe('string');
  });

  test('normalizes Windows platform to "windows"', () => {
    const context = getFilterContext();
    
    // On Windows, should be 'windows', not 'win32'
    if (process.platform === 'win32') {
      expect(context.os).toBe('windows');
      expect(context.platform).toBe('win32');
    }
  });

  test('caches context', () => {
    const context1 = getFilterContext();
    const context2 = getFilterContext();
    
    expect(context1).toBe(context2); // Same object reference
  });

  test('can reset cache', () => {
    const context1 = getFilterContext();
    resetFilterContext();
    const context2 = getFilterContext();
    
    expect(context1).not.toBe(context2); // Different object references
    expect(context1).toEqual(context2);  // But same values
  });
});

describe('createCustomContext', () => {
  test('creates custom context with overrides', () => {
    const custom = createCustomContext({
      os: 'linux',
      machine: 'test-machine',
    });
    
    expect(custom.os).toBe('linux');
    expect(custom.machine).toBe('test-machine');
    expect(custom).toHaveProperty('arch');
    expect(custom).toHaveProperty('user');
  });
});

describe('evaluateFilter', () => {
  const context: FilterContext = {
    os: 'windows',
    arch: 'x64',
    machine: 'laptop-work',
    user: 'josxa',
    env: 'prod',
    platform: 'win32',
  };

  test('evaluates equals operator', () => {
    const filter: Filter = {
      key: 'os',
      operator: '=',
      value: 'windows',
      raw: '{os=windows}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(true);
  });

  test('evaluates equals with OR (comma-separated)', () => {
    const filter: Filter = {
      key: 'os',
      operator: '=',
      value: 'windows,linux',
      raw: '{os=windows,linux}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(true);
  });

  test('fails when value does not match', () => {
    const filter: Filter = {
      key: 'os',
      operator: '=',
      value: 'macos',
      raw: '{os=macos}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(false);
  });

  test('evaluates not-equals operator', () => {
    const filter: Filter = {
      key: 'os',
      operator: '!=',
      value: 'macos',
      raw: '{os!=macos}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(true);
  });

  test('evaluates wildcard operator', () => {
    const filter: Filter = {
      key: 'machine',
      operator: '~',
      value: 'laptop*',
      raw: '{machine~laptop*}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(true);
  });

  test('fails for missing context key', () => {
    const filter: Filter = {
      key: 'nonexistent',
      operator: '=',
      value: 'value',
      raw: '{nonexistent=value}',
    };
    
    expect(evaluateFilter(filter, context)).toBe(false);
  });

  test('evaluates range operator with numbers', () => {
    const customContext = { ...context, version: '1.5' };
    const filter: Filter = {
      key: 'version',
      operator: '^',
      value: '1.0-2.0',
      raw: '{version^1.0-2.0}',
    };
    
    expect(evaluateFilter(filter, customContext)).toBe(true);
  });
});

describe('matchFilters', () => {
  const context: FilterContext = {
    os: 'windows',
    arch: 'x64',
    machine: 'laptop-work',
    user: 'josxa',
    env: 'prod',
    platform: 'win32',
  };

  test('matches when all filters pass', () => {
    const result = matchFilters('config.{os=windows}{arch=x64}.json', context);
    
    expect(result.matches).toBe(true);
    expect(result.failedFilters).toHaveLength(0);
  });

  test('does not match when any filter fails', () => {
    const result = matchFilters('config.{os=macos}{arch=x64}.json', context);
    
    expect(result.matches).toBe(false);
    expect(result.failedFilters).toHaveLength(1);
    expect(result.failedFilters[0].key).toBe('os');
  });

  test('matches files without filters', () => {
    const result = matchFilters('config.json', context);
    
    expect(result.matches).toBe(true);
  });

  test('AND logic: all filters must pass', () => {
    const result = matchFilters(
      'secrets.{machine=laptop-work}{user=josxa}{env=prod}.env',
      context
    );
    
    expect(result.matches).toBe(true);
  });

  test('AND logic: fails if one filter fails', () => {
    const result = matchFilters(
      'secrets.{machine=laptop-work}{user=different}{env=prod}.env',
      context
    );
    
    expect(result.matches).toBe(false);
    expect(result.failedFilters).toHaveLength(1);
    expect(result.failedFilters[0].key).toBe('user');
  });

  test('uses global context when none provided', () => {
    const result = matchFilters('config.json');
    
    expect(result.matches).toBe(true);
    expect(result.context).toBeDefined();
  });
});

describe('isMatch', () => {
  const context: FilterContext = {
    os: 'windows',
    arch: 'x64',
    machine: 'laptop-work',
    user: 'josxa',
    env: 'prod',
    platform: 'win32',
  };

  test('returns true when filters match', () => {
    expect(isMatch('config.{os=windows}.json', context)).toBe(true);
  });

  test('returns false when filters do not match', () => {
    expect(isMatch('config.{os=macos}.json', context)).toBe(false);
  });
});

describe('getBaseFilename', () => {
  test('removes all filters', () => {
    expect(getBaseFilename('config.{os=windows}.json')).toBe('config.json');
    expect(getBaseFilename('app.{os=windows}{arch=x64}.json')).toBe('app.json');
    expect(getBaseFilename('secrets.{machine=work}{user=josxa}.env')).toBe('secrets.env');
  });

  test('returns same filename if no filters', () => {
    expect(getBaseFilename('config.json')).toBe('config.json');
  });
});

describe('backward compatibility', () => {
  test('convertLegacyFilename converts old syntax', () => {
    const result = convertLegacyFilename('config.homezone.json', 'homezone');
    
    expect(result).toBe('config.{machine=homezone}.json');
  });

  test('convertLegacyFilename handles dotfiles', () => {
    const result = convertLegacyFilename('.env.homezone', 'homezone');
    
    expect(result).toBe('.env.{machine=homezone}');
  });

  test('isLegacyFilename detects old syntax', () => {
    expect(isLegacyFilename('config.homezone.json', 'homezone')).toBe(true);
    expect(isLegacyFilename('config.{machine=homezone}.json', 'homezone')).toBe(false);
    expect(isLegacyFilename('config.base.json', 'homezone')).toBe(false);
  });

  test('parseAnyFormat handles both old and new syntax', () => {
    const legacy = parseAnyFormat('config.homezone.json', 'homezone');
    const modern = parseAnyFormat('config.{machine=homezone}.json', 'homezone');
    
    expect(legacy.filters).toHaveLength(1);
    expect(modern.filters).toHaveLength(1);
    expect(legacy.filters[0].key).toBe('machine');
    expect(modern.filters[0].key).toBe('machine');
  });
});

describe('edge cases', () => {
  test('handles filters with hyphens and underscores', () => {
    const result = parseFilters('file.{my-key=my-value}{other_key=other_value}.json');
    
    expect(result.filters).toHaveLength(2);
    expect(result.filters[0].key).toBe('my-key');
    expect(result.filters[1].key).toBe('other_key');
  });

  test('handles filters with numbers', () => {
    const result = parseFilters('file.{version=1.2.3}.json');
    
    expect(result.filters[0].value).toBe('1.2.3');
  });

  test('handles multiple dots in filename', () => {
    const result = parseFilters('backup.{env=prod}.2024.01.15.tar.gz');
    
    expect(result.baseFilename).toBe('backup.2024.01.15.tar.gz');
  });

  test('handles empty environment variable', () => {
    const context = createCustomContext({ env: null });
    const result = matchFilters('config.{env=dev}.json', context);
    
    expect(result.matches).toBe(false);
  });
});

describe('OR logic (comma-separated values)', () => {
  const context: FilterContext = {
    os: 'linux',
    arch: 'arm64',
    machine: 'pi',
    user: 'josxa',
    env: 'dev',
    platform: 'linux',
  };

  test('matches with OR values', () => {
    expect(isMatch('config.{os=windows,linux,macos}.json', context)).toBe(true);
    expect(isMatch('config.{os=windows,macos}.json', context)).toBe(false);
  });

  test('OR works with multiple filters (AND between filters)', () => {
    const result = matchFilters(
      'app.{os=windows,linux}{arch=arm64,x64}.json',
      context
    );
    
    expect(result.matches).toBe(true);
  });
});

describe('wildcard matching', () => {
  const context: FilterContext = {
    os: 'windows',
    arch: 'x64',
    machine: 'laptop-work-123',
    user: 'josxa',
    env: 'prod-us-east',
    platform: 'win32',
  };

  test('matches with wildcards', () => {
    expect(isMatch('config.{machine~laptop*}.json', context)).toBe(true);
    expect(isMatch('config.{machine~*work*}.json', context)).toBe(true);
    expect(isMatch('config.{env~prod-*}.json', context)).toBe(true);
  });

  test('does not match incorrect wildcard', () => {
    expect(isMatch('config.{machine~desktop*}.json', context)).toBe(false);
  });
});

describe('range matching', () => {
  test('matches numeric ranges', () => {
    const context = createCustomContext({ version: '1.5' });
    
    expect(isMatch('app.{version^1.0-2.0}.json', context)).toBe(true);
    expect(isMatch('app.{version^2.0-3.0}.json', context)).toBe(false);
  });

  test('matches string ranges', () => {
    const context = createCustomContext({ name: 'm' });
    
    expect(isMatch('file.{name^a-z}.json', context)).toBe(true);
  });
});

describe('isBaseFile', () => {
  test('detects legacy .base pattern (middle of filename)', () => {
    expect(isBaseFile('config.base.json')).toBe(true);
    expect(isBaseFile('file.base.md')).toBe(true);
  });

  test('detects legacy .base at end (dotfiles)', () => {
    expect(isBaseFile('.env.base')).toBe(true);
  });

  test('detects new {base} placeholder syntax', () => {
    expect(isBaseFile('file.{base}.json')).toBe(true);
    expect(isBaseFile('config.{base}.md')).toBe(true);
  });

  test('detects {base} with filters', () => {
    expect(isBaseFile('file.{base}.{os=windows}.json')).toBe(true);
    expect(isBaseFile('config.{machine=laptop}.{base}.json')).toBe(true);
  });

  test('does not detect regular machine files as base', () => {
    expect(isBaseFile('config.{os=windows}.json')).toBe(false);
    expect(isBaseFile('file.{machine=laptop}.md')).toBe(false);
    expect(isBaseFile('config.homezone.json')).toBe(false);
  });

  test('does not detect files that just happen to contain "base" as keyword', () => {
    expect(isBaseFile('database.json')).toBe(false);
    expect(isBaseFile('based.json')).toBe(false);
    expect(isBaseFile('base.json')).toBe(false);
  });

  test('handles multiple extensions correctly', () => {
    expect(isBaseFile('backup.base.tar.gz')).toBe(true);
    expect(isBaseFile('backup.{base}.tar.gz')).toBe(true);
  });

  test('is case-insensitive for {base} placeholder', () => {
    expect(isBaseFile('file.{BASE}.json')).toBe(true);
    expect(isBaseFile('file.{Base}.json')).toBe(true);
  });
});

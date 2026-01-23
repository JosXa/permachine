# Feature Plan: Directory-Level Machine-Specific Matching

## Summary

Add support for marking entire **directories** as machine-specific using the same filter syntax as files (e.g., `jira.{machine=homezone}/`). When a directory matches the current context, all files within it are copied as-is to the output directory without any further filter processing or merging.

## Example

**Source structure:**
```
.opencode/skills/
├── jira.{machine=homezone}/
│   ├── skill.md
│   └── templates/
│       └── issue.md
└── other-skill/
    └── skill.md
```

**On machine `homezone`, output becomes:**
```
.opencode/skills/
├── jira/                          ← Created from jira.{machine=homezone}/
│   ├── skill.md
│   └── templates/
│       └── issue.md
└── other-skill/
    └── skill.md
```

**On any other machine:** `jira/` directory is NOT created.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Base directory fallback | **No** | No `jira.base/` fallback; all-or-nothing matching |
| Multiple matching directories | **Error** | If multiple directories would match same output, raise error |
| Files inside directories | **Copy as-is** | No recursive filter processing; files inside are NOT parsed for `{machine=X}` |
| Nested filtered directories | **Error** | `parent.{machine=X}/child.{machine=Y}/` is not allowed |
| File vs directory conflict | **Error** | If a file merge and directory copy produce same output, error (same as nested filter error) |
| Stale output cleanup | **Yes** | Rename stale outputs with `.permachine-deleted` suffix |
| Cleanup visibility | **Show in UI** | Always log when files are marked as deleted |

---

## Implementation Plan

### Phase 1: Core Filter Logic (`src/core/file-filters.ts`)

**Add directory-specific functions:**

```typescript
// Check if a path component represents a machine-specific directory
export function isFilteredDirectory(dirname: string): boolean;

// Parse and match directory filters (reuses existing matchFilters logic)
export function matchDirectoryFilters(dirname: string, context?: FilterContext): MatchResult;

// Get base directory name from filtered directory
// Example: "jira.{machine=homezone}" → "jira"
export function getBaseDirectoryName(dirname: string): string;
```

**Implementation notes:**
- `isFilteredDirectory()` → delegates to existing `hasFilters()`
- `matchDirectoryFilters()` → delegates to existing `matchFilters()`
- `getBaseDirectoryName()` → delegates to existing `getBaseFilename()`

These are thin wrappers for semantic clarity when working with directories vs files.

---

### Phase 2: New Operation Type (`src/core/file-scanner.ts`)

**1. Add new interface:**

```typescript
export interface DirectoryCopyOperation {
  sourcePath: string;        // Absolute path to machine-specific directory
  outputPath: string;        // Absolute path to output directory
  type: 'directory';
}

// Unified return type
export interface ScanResult {
  mergeOperations: MergeOperation[];
  directoryOperations: DirectoryCopyOperation[];
}
```

**2. Add directory scanning function:**

```typescript
export async function scanForDirectoryOperations(
  machineName: string,
  cwd: string,
  context: FilterContext
): Promise<DirectoryCopyOperation[]>;
```

**Logic:**
1. Glob for directories with filter patterns using fast-glob with `onlyDirectories: true`
2. Pattern: `**/*{*}*` (directories containing `{...}`)
3. For each found directory:
   - Parse directory name with `parseFilters()`
   - Evaluate against context with `matchFilters()`
   - If matches, create `DirectoryCopyOperation`
4. Group by output path to detect conflicts
5. Return validated operations

**3. Add conflict detection:**

```typescript
async function validateDirectoryOperations(
  operations: DirectoryCopyOperation[],
  cwd: string
): Promise<void>;  // Throws on invalid patterns
```

**Validates:**
- No multiple directories matching same output path
- No base directory patterns (e.g., `jira.base/`)
- No nested filtered directories (e.g., `parent.{machine=X}/child.{machine=Y}/`)

**4. Update file scanner to exclude files inside machine-specific directories:**

When scanning for merge operations, skip files whose path contains a filtered directory component. This prevents treating `jira.{machine=homezone}/skill.md` as a file with filters.

**5. Add unified scan function:**

```typescript
export async function scanAllOperations(
  machineName: string,
  cwd?: string
): Promise<ScanResult>;
```

---

### Phase 3: Directory Copy Logic (NEW: `src/core/directory-copier.ts`)

**New module for copying directory contents:**

```typescript
export interface DirectoryCopyResult {
  success: boolean;
  operation: DirectoryCopyOperation;
  filesWritten: number;
  filesUnchanged: number;
  changed: boolean;
  error?: Error;
}

// Copy all files from source directory to output directory
export async function performDirectoryCopy(
  operation: DirectoryCopyOperation
): Promise<DirectoryCopyResult>;

// Process multiple directory operations
export async function performAllDirectoryCopies(
  operations: DirectoryCopyOperation[]
): Promise<DirectoryCopyResult[]>;
```

**Implementation notes:**
- Use `fs.cp()` with `recursive: true` for Node 16.7+ (or recursive walk for older)
- Compare file contents before writing (skip if identical)
- Create output directory with `mkdir -p` semantics
- Handle symlinks: copy symlink itself (not target)
- Handle binary files: copy without modification
- Handle hidden files (dotfiles): include them

---

### Phase 4: Stale Output Cleanup (`src/core/cleanup.ts`)

**New module for tracking and cleaning stale outputs:**

```typescript
export interface CleanupResult {
  renamedFiles: string[];      // Files renamed to .permachine-deleted
  renamedDirectories: string[]; // Directories renamed
}

// Track current operation outputs in a manifest
export async function updateOutputManifest(
  outputs: string[],
  cwd: string
): Promise<void>;

// Find and rename stale outputs
export async function cleanupStaleOutputs(
  currentOutputs: string[],
  cwd: string
): Promise<CleanupResult>;

// Rename a path with .permachine-deleted suffix
export function getDeletedPath(originalPath: string): string;
// Example: "jira/" → "jira.permachine-deleted/"
// Example: "config.json" → "config.json.permachine-deleted"
```

**Manifest file:** `.permachine-outputs.json` (gitignored)
```json
{
  "version": 1,
  "outputs": [
    ".opencode/skills/jira",
    "config.json",
    ".env"
  ],
  "lastRun": "2026-01-23T12:00:00Z"
}
```

**Cleanup logic:**
1. Load previous manifest (if exists)
2. Compare with current outputs
3. For each path in previous but not in current:
   - Rename to `{path}.permachine-deleted`
   - Log action to console
4. Save updated manifest

---

### Phase 5: CLI Updates (`src/cli.ts`)

**1. Update `handleMerge`:**

```typescript
// Replace scanForMergeOperations with scanAllOperations
const { mergeOperations, directoryOperations } = await scanAllOperations(machineName);

// Validate no conflicts between file and directory operations
validateNoConflicts(mergeOperations, directoryOperations);

// Process directories
if (directoryOperations.length > 0) {
  const dirResults = await performAllDirectoryCopies(directoryOperations);
  // Report results
}

// Process files (existing logic)
const mergeResults = await performAllMerges(mergeOperations);

// Cleanup stale outputs
const allOutputs = [
  ...mergeResults.map(r => r.operation.outputPath),
  ...dirResults.map(r => r.operation.outputPath)
];
const cleanupResult = await cleanupStaleOutputs(allOutputs, cwd);
if (cleanupResult.renamedFiles.length > 0 || cleanupResult.renamedDirectories.length > 0) {
  console.log(`Cleaned up ${cleanupResult.renamedFiles.length} stale file(s)`);
  for (const f of cleanupResult.renamedFiles) {
    console.log(`  Renamed: ${f} → ${getDeletedPath(f)}`);
  }
}
```

**2. Update `handleInfo`:**

```typescript
// Add section for directory operations
if (directoryOperations.length > 0) {
  console.log(`\nMachine-specific directories (${directoryOperations.length}):`);
  for (const op of directoryOperations) {
    const srcName = path.basename(op.sourcePath);
    const outName = path.basename(op.outputPath);
    console.log(`  ${srcName}/ → ${outName}/`);
  }
}
```

**3. Update gitignore management:**

Add output directories from directory operations to `.gitignore`:
```
# Generated by permachine
config.json
.env
jira/          ← NEW: directory outputs
```

---

### Phase 6: Watcher Updates (`src/core/watcher.ts`)

**Update file watching to handle directory changes:**

1. Watch for changes inside machine-specific directories
2. On any file change inside → re-run full directory copy (debounced)
3. On directory creation/deletion → re-scan and update

**Implementation:**
- Add glob pattern for directory contents: `**/*{*}*/**/*`
- Debounce like existing file changes
- Re-run `performDirectoryCopy` for affected directory

---

### Phase 7: Error Messages

**New error types to add:**

```typescript
// Nested filtered directories detected
class NestedFilteredDirectoryError extends Error {
  constructor(outerDir: string, innerDir: string) {
    super(
      `Nested machine-specific directories are not supported.\n` +
      `Found: ${innerDir} inside ${outerDir}\n` +
      `Only one level of directory filtering is allowed.`
    );
  }
}

// Multiple directories match same output
class DirectoryConflictError extends Error {
  constructor(outputPath: string, sources: string[]) {
    super(
      `Multiple directories would output to the same path: ${outputPath}\n` +
      `Sources: ${sources.join(', ')}\n` +
      `Only one machine-specific directory can match per output path.`
    );
  }
}

// File and directory conflict
class FileDirectoryConflictError extends Error {
  constructor(outputPath: string, fileSource: string, dirSource: string) {
    super(
      `Both a file merge and directory copy would output to: ${outputPath}\n` +
      `File source: ${fileSource}\n` +
      `Directory source: ${dirSource}\n` +
      `Machine-specific directories cannot contain files with filter patterns.`
    );
  }
}

// Base directory not supported
class BaseDirectoryNotSupportedError extends Error {
  constructor(dirPath: string) {
    super(
      `Base directories are not supported: ${dirPath}\n` +
      `Unlike files, directories do not support .base fallback.\n` +
      `Use machine-specific directories only (e.g., mydir.{machine=X}/).`
    );
  }
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/file-filters.ts` | Modify | Add `isFilteredDirectory`, `matchDirectoryFilters`, `getBaseDirectoryName` wrapper functions |
| `src/core/file-scanner.ts` | Modify | Add `DirectoryCopyOperation`, `ScanResult`, `scanForDirectoryOperations`, `scanAllOperations`, conflict detection |
| `src/core/directory-copier.ts` | **Create** | New module for copying directory contents |
| `src/core/cleanup.ts` | **Create** | New module for stale output tracking and cleanup |
| `src/core/errors.ts` | **Create** | Centralized error classes for better error handling |
| `src/cli.ts` | Modify | Integrate directory operations, cleanup, and updated info display |
| `src/core/watcher.ts` | Modify | Watch for changes in machine-specific directories |
| `src/core/gitignore-manager.ts` | Modify | Handle directory paths in `.gitignore` |
| `README.md` | Modify | Document directory matching feature |
| `docs/FILE_FILTERS.md` | Modify | Add directory filter documentation |

---

## Testing Plan

### Unit Tests

#### `tests/unit/directory-filters.test.ts` (NEW)

```typescript
describe('isFilteredDirectory', () => {
  it('returns true for directory with machine filter', () => {
    expect(isFilteredDirectory('jira.{machine=homezone}')).toBe(true);
  });

  it('returns true for directory with os filter', () => {
    expect(isFilteredDirectory('config.{os=windows}')).toBe(true);
  });

  it('returns true for directory with multiple filters', () => {
    expect(isFilteredDirectory('app.{machine=laptop}{os=linux}')).toBe(true);
  });

  it('returns false for regular directory', () => {
    expect(isFilteredDirectory('jira')).toBe(false);
  });

  it('returns false for directory with curly braces but no valid filter', () => {
    expect(isFilteredDirectory('jira.{invalid}')).toBe(false);
  });

  it('returns false for base directory pattern', () => {
    expect(isFilteredDirectory('jira.base')).toBe(false);
  });
});

describe('getBaseDirectoryName', () => {
  it('extracts base name from machine filter', () => {
    expect(getBaseDirectoryName('jira.{machine=homezone}')).toBe('jira');
  });

  it('extracts base name from multiple filters', () => {
    expect(getBaseDirectoryName('config.{os=windows}{arch=x64}')).toBe('config');
  });

  it('handles filter at start of name', () => {
    expect(getBaseDirectoryName('{machine=work}.settings')).toBe('settings');
  });

  it('returns same name if no filters', () => {
    expect(getBaseDirectoryName('regular-dir')).toBe('regular-dir');
  });

  it('handles OR syntax in filter', () => {
    expect(getBaseDirectoryName('app.{os=windows,linux}')).toBe('app');
  });
});

describe('matchDirectoryFilters', () => {
  it('matches when machine filter matches context', () => {
    const context = createCustomContext({ machine: 'homezone' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    expect(result.matches).toBe(true);
  });

  it('does not match when machine filter differs', () => {
    const context = createCustomContext({ machine: 'workstation' });
    const result = matchDirectoryFilters('jira.{machine=homezone}', context);
    expect(result.matches).toBe(false);
  });

  it('matches with OR syntax', () => {
    const context = createCustomContext({ os: 'linux' });
    const result = matchDirectoryFilters('app.{os=windows,linux,darwin}', context);
    expect(result.matches).toBe(true);
  });

  it('matches with multiple filters (AND logic)', () => {
    const context = createCustomContext({ machine: 'laptop', os: 'windows' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(true);
  });

  it('fails if any filter in AND chain fails', () => {
    const context = createCustomContext({ machine: 'laptop', os: 'linux' });
    const result = matchDirectoryFilters('cfg.{machine=laptop}{os=windows}', context);
    expect(result.matches).toBe(false);
  });
});
```

#### `tests/unit/directory-copier.test.ts` (NEW)

```typescript
describe('performDirectoryCopy', () => {
  it('copies all files from source to output directory', async () => {
    // Setup: create temp directory with files
    // Execute: performDirectoryCopy
    // Assert: all files exist in output
  });

  it('preserves nested directory structure', async () => {
    // Setup: source/subdir/file.txt
    // Execute: performDirectoryCopy
    // Assert: output/subdir/file.txt exists
  });

  it('copies hidden files (dotfiles)', async () => {
    // Setup: source/.gitkeep
    // Execute: performDirectoryCopy
    // Assert: output/.gitkeep exists
  });

  it('copies symlinks as symlinks', async () => {
    // Setup: source/link -> target
    // Execute: performDirectoryCopy
    // Assert: output/link is symlink pointing to same target
  });

  it('skips unchanged files', async () => {
    // Setup: run once, then run again without changes
    // Execute: performDirectoryCopy twice
    // Assert: second run reports filesUnchanged > 0
  });

  it('handles empty source directory', async () => {
    // Setup: empty source directory
    // Execute: performDirectoryCopy
    // Assert: empty output directory created
  });

  it('overwrites changed files', async () => {
    // Setup: run once, modify source file, run again
    // Execute: performDirectoryCopy after modification
    // Assert: output file has new content
  });

  it('handles binary files correctly', async () => {
    // Setup: source/image.png (binary)
    // Execute: performDirectoryCopy
    // Assert: output/image.png is identical binary
  });
});
```

#### `tests/unit/cleanup.test.ts` (NEW)

```typescript
describe('cleanupStaleOutputs', () => {
  it('renames file that was in previous manifest but not current', async () => {
    // Setup: manifest with ["old.json"], current outputs ["new.json"]
    // Execute: cleanupStaleOutputs
    // Assert: old.json renamed to old.json.permachine-deleted
  });

  it('renames directory that was in previous manifest but not current', async () => {
    // Setup: manifest with ["old-dir/"], current outputs []
    // Execute: cleanupStaleOutputs
    // Assert: old-dir/ renamed to old-dir.permachine-deleted/
  });

  it('does not rename outputs that still exist', async () => {
    // Setup: manifest with ["keep.json"], current outputs ["keep.json"]
    // Execute: cleanupStaleOutputs
    // Assert: keep.json unchanged
  });

  it('handles first run with no manifest', async () => {
    // Setup: no manifest file exists
    // Execute: cleanupStaleOutputs
    // Assert: returns empty result, no errors
  });

  it('updates manifest with current outputs', async () => {
    // Setup: old manifest
    // Execute: cleanupStaleOutputs with new outputs
    // Assert: manifest file updated with new outputs
  });
});

describe('getDeletedPath', () => {
  it('appends .permachine-deleted to file', () => {
    expect(getDeletedPath('config.json')).toBe('config.json.permachine-deleted');
  });

  it('appends .permachine-deleted to directory', () => {
    expect(getDeletedPath('jira')).toBe('jira.permachine-deleted');
  });

  it('handles paths with directory separators', () => {
    expect(getDeletedPath('.opencode/skills/jira')).toBe('.opencode/skills/jira.permachine-deleted');
  });
});
```

#### `tests/unit/errors.test.ts` (NEW)

```typescript
describe('NestedFilteredDirectoryError', () => {
  it('includes both directory names in message', () => {
    const err = new NestedFilteredDirectoryError(
      'parent.{machine=X}',
      'parent.{machine=X}/child.{machine=Y}'
    );
    expect(err.message).toContain('parent.{machine=X}');
    expect(err.message).toContain('child.{machine=Y}');
    expect(err.message).toContain('not supported');
  });
});

describe('DirectoryConflictError', () => {
  it('lists all conflicting sources', () => {
    const err = new DirectoryConflictError('output/', ['src1/', 'src2/']);
    expect(err.message).toContain('output/');
    expect(err.message).toContain('src1/');
    expect(err.message).toContain('src2/');
  });
});

describe('FileDirectoryConflictError', () => {
  it('shows both file and directory sources', () => {
    const err = new FileDirectoryConflictError(
      'config.json',
      'config.{machine=X}.json',
      'configs.{machine=X}/'
    );
    expect(err.message).toContain('config.json');
    expect(err.message).toContain('config.{machine=X}.json');
    expect(err.message).toContain('configs.{machine=X}/');
  });
});
```

---

### Integration Tests

#### `tests/integration/directory-copy.test.ts` (NEW)

```typescript
describe('Directory Copy Integration', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = await createTempDirectory();
  });
  
  afterEach(async () => {
    await removeTempDirectory(testDir);
  });

  describe('basic directory matching', () => {
    it('copies directory when machine filter matches', async () => {
      // Setup
      await createDirectory(testDir, 'skills/jira.{machine=testmachine}');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/skill.md', '# Jira');
      
      // Execute
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      // Assert
      expect(result.exitCode).toBe(0);
      expect(await fileExists(testDir, 'skills/jira/skill.md')).toBe(true);
      expect(await readFile(testDir, 'skills/jira/skill.md')).toBe('# Jira');
    });

    it('does NOT copy directory when machine filter does not match', async () => {
      // Setup
      await createDirectory(testDir, 'skills/jira.{machine=othermachine}');
      await createFile(testDir, 'skills/jira.{machine=othermachine}/skill.md', '# Jira');
      
      // Execute
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      // Assert
      expect(result.exitCode).toBe(0);
      expect(await fileExists(testDir, 'skills/jira/skill.md')).toBe(false);
    });

    it('copies entire nested structure', async () => {
      // Setup
      await createDirectory(testDir, 'skills/jira.{machine=testmachine}/templates');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/skill.md', '# Skill');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/templates/issue.md', '# Issue');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/templates/bug.md', '# Bug');
      
      // Execute
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      // Assert
      expect(result.exitCode).toBe(0);
      expect(await fileExists(testDir, 'skills/jira/skill.md')).toBe(true);
      expect(await fileExists(testDir, 'skills/jira/templates/issue.md')).toBe(true);
      expect(await fileExists(testDir, 'skills/jira/templates/bug.md')).toBe(true);
    });
  });

  describe('filter types', () => {
    it('matches os filter', async () => {
      await createDirectory(testDir, `config.{os=${process.platform === 'win32' ? 'windows' : process.platform}}`);
      await createFile(testDir, `config.{os=${process.platform === 'win32' ? 'windows' : process.platform}}/app.ini`, 'test');
      
      const result = await runCLI(['merge'], { cwd: testDir });
      
      expect(await fileExists(testDir, 'config/app.ini')).toBe(true);
    });

    it('matches multiple filters (AND logic)', async () => {
      await createDirectory(testDir, 'settings.{machine=testmachine}{os=windows}');
      await createFile(testDir, 'settings.{machine=testmachine}{os=windows}/cfg.txt', 'test');
      
      // Only matches if BOTH machine AND os match
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine', os: 'windows' });
      
      expect(await fileExists(testDir, 'settings/cfg.txt')).toBe(true);
    });

    it('matches OR filter syntax', async () => {
      await createDirectory(testDir, 'app.{os=windows,linux,darwin}');
      await createFile(testDir, 'app.{os=windows,linux,darwin}/run.sh', 'test');
      
      const result = await runCLI(['merge'], { cwd: testDir });
      
      expect(await fileExists(testDir, 'app/run.sh')).toBe(true);
    });
  });

  describe('files not processed for filters', () => {
    it('copies files with filter-like names as-is (no processing)', async () => {
      // File inside directory has filter syntax but should NOT be processed
      await createDirectory(testDir, 'config.{machine=testmachine}');
      await createFile(testDir, 'config.{machine=testmachine}/app.{os=windows}.json', '{"test": true}');
      
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      // File should be copied with its literal name, NOT processed as a filter
      expect(await fileExists(testDir, 'config/app.{os=windows}.json')).toBe(true);
    });
  });

  describe('error cases', () => {
    it('errors on nested filtered directories', async () => {
      await createDirectory(testDir, 'parent.{machine=testmachine}/child.{machine=other}');
      
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Nested');
    });

    it('errors when multiple directories match same output', async () => {
      await createDirectory(testDir, 'config.{machine=testmachine}');
      await createDirectory(testDir, 'config.{os=windows}');
      // If both match, they'd both output to 'config/'
      
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine', os: 'windows' });
      
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('conflict');
    });

    it('errors when file merge conflicts with directory copy', async () => {
      // Directory would output config/settings.json
      await createDirectory(testDir, 'config.{machine=testmachine}');
      await createFile(testDir, 'config.{machine=testmachine}/settings.json', '{}');
      // File would also output config/settings.json
      await createDirectory(testDir, 'config');
      await createFile(testDir, 'config/settings.{machine=testmachine}.json', '{}');
      
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('conflict');
    });

    it('warns about base directory pattern', async () => {
      await createDirectory(testDir, 'config.base');
      
      const result = await runCLI(['merge'], { cwd: testDir });
      
      // Should warn or error about unsupported base directory
      expect(result.output).toMatch(/base.*not supported|not supported.*base/i);
    });
  });

  describe('stale output cleanup', () => {
    it('renames stale output files with .permachine-deleted suffix', async () => {
      // First run: create output
      await createDirectory(testDir, 'old.{machine=testmachine}');
      await createFile(testDir, 'old.{machine=testmachine}/file.txt', 'old');
      await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      expect(await fileExists(testDir, 'old/file.txt')).toBe(true);
      
      // Rename source to different machine (simulating "no longer matches")
      await rename(testDir, 'old.{machine=testmachine}', 'old.{machine=othermachine}');
      
      // Second run: should cleanup stale output
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      expect(await fileExists(testDir, 'old/file.txt')).toBe(false);
      expect(await fileExists(testDir, 'old.permachine-deleted/file.txt')).toBe(true);
      expect(result.output).toContain('permachine-deleted');
    });

    it('shows cleanup in output', async () => {
      // Similar setup as above
      await createDirectory(testDir, 'data.{machine=testmachine}');
      await createFile(testDir, 'data.{machine=testmachine}/info.txt', 'data');
      await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      await rename(testDir, 'data.{machine=testmachine}', 'data.{machine=other}');
      
      const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      expect(result.output).toContain('Renamed');
      expect(result.output).toContain('data');
    });
  });

  describe('gitignore management', () => {
    it('adds output directory to .gitignore', async () => {
      await createDirectory(testDir, 'skills/jira.{machine=testmachine}');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/skill.md', '# Jira');
      
      await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
      
      const gitignore = await readFile(testDir, '.gitignore');
      expect(gitignore).toContain('skills/jira');
    });
  });

  describe('info command', () => {
    it('shows directory operations in info output', async () => {
      await createDirectory(testDir, 'skills/jira.{machine=testmachine}');
      await createFile(testDir, 'skills/jira.{machine=testmachine}/skill.md', '# Jira');
      
      const result = await runCLI(['info'], { cwd: testDir, machine: 'testmachine' });
      
      expect(result.output).toContain('jira.{machine=testmachine}');
      expect(result.output).toContain('jira/');
    });
  });

  describe('watch mode', () => {
    it('re-copies directory when file inside changes', async () => {
      await createDirectory(testDir, 'app.{machine=testmachine}');
      await createFile(testDir, 'app.{machine=testmachine}/config.txt', 'v1');
      
      // Start watcher
      const watcher = await startWatcher({ cwd: testDir, machine: 'testmachine' });
      
      // Wait for initial copy
      await waitForFile(testDir, 'app/config.txt');
      expect(await readFile(testDir, 'app/config.txt')).toBe('v1');
      
      // Modify source file
      await writeFile(testDir, 'app.{machine=testmachine}/config.txt', 'v2');
      
      // Wait for watcher to update
      await waitForContent(testDir, 'app/config.txt', 'v2');
      
      await watcher.stop();
    });
  });
});
```

#### `tests/integration/directory-file-mixed.test.ts` (NEW)

```typescript
describe('Mixed Directory and File Operations', () => {
  it('processes both directory and file operations in same run', async () => {
    // Setup: directory operation + file operation
    await createDirectory(testDir, 'skills/jira.{machine=testmachine}');
    await createFile(testDir, 'skills/jira.{machine=testmachine}/skill.md', '# Jira');
    await createFile(testDir, 'config.base.json', '{"base": true}');
    await createFile(testDir, 'config.{machine=testmachine}.json', '{"machine": true}');
    
    const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
    
    // Both should be processed
    expect(await fileExists(testDir, 'skills/jira/skill.md')).toBe(true);
    expect(await fileExists(testDir, 'config.json')).toBe(true);
    const config = JSON.parse(await readFile(testDir, 'config.json'));
    expect(config.base).toBe(true);
    expect(config.machine).toBe(true);
  });

  it('directory operation and file operation to different paths work together', async () => {
    await createDirectory(testDir, 'dir.{machine=testmachine}');
    await createFile(testDir, 'dir.{machine=testmachine}/a.txt', 'a');
    await createFile(testDir, 'other.{machine=testmachine}.json', '{}');
    
    const result = await runCLI(['merge'], { cwd: testDir, machine: 'testmachine' });
    
    expect(await fileExists(testDir, 'dir/a.txt')).toBe(true);
    expect(await fileExists(testDir, 'other.json')).toBe(true);
  });
});
```

---

## README.md Updates

### Add to "File Naming Convention" section:

```markdown
### Directory Matching

You can also mark entire **directories** as machine-specific. When a directory matches, all its contents are copied as-is without any further processing.

**Syntax:** `dirname.{filter}/`

**Example:**
```
.opencode/skills/
├── jira.{machine=homezone}/      # Only used on 'homezone' machine
│   ├── skill.md
│   └── templates/
│       └── issue.md
└── github.{machine=work}/        # Only used on 'work' machine
    └── skill.md
```

**On `homezone` machine:**
```
.opencode/skills/
├── jira/                         # ✅ Copied from jira.{machine=homezone}/
│   ├── skill.md
│   └── templates/
│       └── issue.md
└── github.{machine=work}/        # ❌ Source stays, no output (doesn't match)
    └── skill.md
```

#### Directory Matching Rules

| Rule | Description |
|------|-------------|
| No base fallback | Unlike files, there's no `dirname.base/` fallback mechanism |
| No nested filters | `parent.{machine=X}/child.{machine=Y}/` is an error |
| Files copied as-is | Files inside are NOT processed for `{machine=X}` patterns |
| No merging | Multiple directories cannot merge to same output |
| Auto-cleanup | Stale outputs are renamed with `.permachine-deleted` suffix |

#### Stale Output Cleanup

When a directory no longer matches (e.g., you renamed a machine or changed filters), permachine renames the old output with a `.permachine-deleted` suffix for easy recovery:

```
jira/                    → jira.permachine-deleted/
config.json              → config.json.permachine-deleted
```

This keeps your working directory clean while allowing recovery if needed.
```

### Add to "Cookbook / Recipes" section:

```markdown
### Recipe 7: Machine-specific tool configurations

Store entire configuration directories per machine:

```
.config/
├── neovim.{machine=desktop}/     # Full config for desktop
│   ├── init.lua
│   └── lua/
│       └── plugins.lua
├── neovim.{machine=laptop}/      # Lighter config for laptop
│   ├── init.lua
│   └── lua/
│       └── plugins.lua
└── neovim.{machine=server}/      # Minimal config for server
    └── init.lua
```

On each machine, you get a clean `neovim/` directory with the appropriate configuration.
```

---

## Edge Cases Summary

| Edge Case | Handling |
|-----------|----------|
| Empty directories | Create empty output directory |
| Symlinks inside | Copy symlink itself (not target) |
| Hidden files (dotfiles) | Copy them |
| Binary files | Copy without modification |
| Deeply nested structure | Preserve full structure |
| Directory with only subdirs | Copy entire tree |
| Filter syntax in filename inside dir | Treat as literal filename |
| Multiple matching directories | Error with clear message |
| Nested filtered directories | Error with clear message |
| File/directory output conflict | Error with clear message |
| Base directory pattern | Error with clear message |
| Stale outputs | Rename with `.permachine-deleted` |

---

## Implementation Order

1. **Phase 1: Core filter functions** - Small, testable additions
2. **Phase 2: Error classes** - Define before using
3. **Phase 3: Directory scanning** - New scanner with validation
4. **Phase 4: Directory copier** - Core copy logic
5. **Phase 5: Cleanup module** - Manifest and stale detection
6. **Phase 6: CLI integration** - Wire everything together
7. **Phase 7: Watcher updates** - Watch directory contents
8. **Phase 8: Tests** - Can be written alongside each phase
9. **Phase 9: Documentation** - README and FILE_FILTERS.md updates

---

## Open Questions (None remaining)

All design decisions have been finalized through discussion.

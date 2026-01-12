# machine-config-sync - Implementation Plan

## Overview

A tool for automatically merging machine-specific configuration files with base configurations in git repositories. Similar to Husky's convenience for git hooks, but for config file management.

## Problem Statement

When working across multiple machines, you often need:
- Shared configuration (base settings)
- Machine-specific overrides (paths, API keys, local settings)
- Automatic merging on git operations (checkout, merge, commit)
- No manual merge steps

## Solution

`machine-config-sync` automatically:
1. Detects the current machine name
2. Scans for machine-specific config files (e.g., `config.homezone.json`)
3. Merges them with base config files (e.g., `config.base.json`)
4. Outputs the final config (e.g., `config.json`)
5. Runs automatically via git hooks

## File Naming Convention

Given machine name `homezone`:
- **Base config**: `config.base.json`, `.env.base`
- **Machine-specific**: `config.homezone.json`, `.env.homezone`
- **Output (gitignored)**: `config.json`, `.env`

Pattern: `filename.base.ext` + `filename.<machine>.ext` → `filename.ext`

## Architecture

```
machine-config-sync/
├── src/
│   ├── cli.ts                      # CLI entry point
│   ├── core/
│   │   ├── machine-detector.ts     # Detect machine name (Windows/Linux/Mac)
│   │   ├── file-scanner.ts         # Find files matching .<machine>. pattern
│   │   ├── merger.ts               # Orchestrate merge operations
│   │   └── git-hooks.ts            # Git hook installation/management
│   ├── adapters/
│   │   ├── base.ts                 # Adapter interface
│   │   ├── json-adapter.ts         # Deep merge for JSON files
│   │   ├── env-adapter.ts          # Key-value merge for .env files
│   │   └── adapter-factory.ts      # Create appropriate adapter
│   └── utils/
│       ├── logger.ts               # Logging (silent by default)
│       └── error-handler.ts        # Error handling strategies
├── templates/
│   └── hooks/
│       ├── post-checkout           # Git hook template
│       ├── post-merge              # Git hook template
│       └── post-commit             # Git hook template
├── tests/
│   ├── unit/
│   │   ├── machine-detector.test.ts
│   │   ├── file-scanner.test.ts
│   │   ├── json-adapter.test.ts
│   │   ├── env-adapter.test.ts
│   │   └── merger.test.ts
│   └── integration/
│       ├── init.test.ts
│       ├── merge.test.ts
│       └── git-hooks.test.ts
├── package.json
├── tsconfig.json
├── bun.lockb
└── README.md
```

## Core Components

### 1. Machine Detector (`machine-detector.ts`)

**Responsibility**: Detect current machine name across platforms

**Implementation**:
- Windows: `process.env.COMPUTERNAME` or `os.hostname()`
- Linux/Mac: `os.hostname()`
- Normalize to lowercase for consistency
- Cache result for performance

**Interface**:
```typescript
export function getMachineName(): string;
```

**Tests**:
- ✅ Detects machine name on Windows
- ✅ Detects machine name on Linux
- ✅ Detects machine name on macOS
- ✅ Normalizes to lowercase
- ✅ Caches result

### 2. File Scanner (`file-scanner.ts`)

**Responsibility**: Find all files matching the machine-specific pattern

**Implementation**:
- Glob pattern: `**/*.<machine>.*` and `**/.*.<machine>`
- Supported extensions: `.json`, `.env` (initially)
- For each found file:
  - Extract base name: `config.homezone.json` → `config.base.json`
  - Determine output name: `config.homezone.json` → `config.json`
- Return array of `MergeOperation` objects

**Interface**:
```typescript
interface MergeOperation {
  basePath: string | null;      // May not exist
  machinePath: string;           // Always exists (we found it)
  outputPath: string;
  type: 'json' | 'env';
}

export async function scanForMergeOperations(
  machineName: string,
  cwd?: string
): Promise<MergeOperation[]>;
```

**Tests**:
- ✅ Finds .json files with machine pattern
- ✅ Finds .env files with machine pattern
- ✅ Correctly derives base file path
- ✅ Correctly derives output file path
- ✅ Handles nested directories
- ✅ Ignores unsupported file types
- ✅ Returns empty array when no files found

### 3. Adapter Pattern (`adapters/`)

**Responsibility**: Handle different file format merging strategies

**Base Interface** (`base.ts`):
```typescript
export interface FileAdapter {
  canHandle(extension: string): boolean;
  parse(content: string): any;
  merge(base: any, machine: any): any;
  serialize(data: any): string;
}
```

**JSON Adapter** (`json-adapter.ts`):
- Parse JSON with error handling
- Deep merge: machine overrides base recursively
- Arrays: replace entirely (not merge by index)
- Preserve 2-space indentation
- Handle JSON parse errors gracefully

**Tests**:
- ✅ Parses valid JSON
- ✅ Handles JSON parse errors
- ✅ Deep merges objects
- ✅ Machine values override base values
- ✅ Arrays are replaced, not merged
- ✅ Preserves nested structure
- ✅ Serializes with 2-space indentation

**ENV Adapter** (`env-adapter.ts`):
- Parse key=value format
- Handle comments (lines starting with #)
- Handle quoted values (`KEY="value"`)
- Handle multi-line values (if needed)
- Machine values override base values
- Preserve comments from base file

**Tests**:
- ✅ Parses simple key=value pairs
- ✅ Preserves comments
- ✅ Handles quoted values
- ✅ Handles empty values
- ✅ Machine values override base
- ✅ Preserves base comments
- ✅ Handles malformed lines gracefully

**Adapter Factory** (`adapter-factory.ts`):
```typescript
export function getAdapter(filePath: string): FileAdapter | null;
```

**Tests**:
- ✅ Returns JSON adapter for .json files
- ✅ Returns ENV adapter for .env files
- ✅ Returns null for unsupported types

### 4. Merger (`merger.ts`)

**Responsibility**: Orchestrate the merge operation

**Implementation**:
```typescript
export async function performMerge(
  operation: MergeOperation,
  options?: { silent?: boolean }
): Promise<MergeResult>;

interface MergeResult {
  success: boolean;
  operation: MergeOperation;
  changed: boolean;      // Was output file modified?
  error?: Error;
}
```

**Merge Logic**:
1. Check if base file exists
2. Check if machine file exists
3. Get appropriate adapter
4. Perform merge based on what exists:
   - Both exist: Merge base + machine
   - Only base: Copy base
   - Only machine: Copy machine
   - Neither: Skip (return success=false)
5. Compare with existing output (if exists)
6. Write output file only if changed
7. Log operation (only if changed and not silent)

**Tests**:
- ✅ Merges when both base and machine exist
- ✅ Uses only base when machine missing
- ✅ Uses only machine when base missing
- ✅ Skips when both missing
- ✅ Doesn't write if output unchanged
- ✅ Logs only when changed
- ✅ Silent mode suppresses logs
- ✅ Handles parse errors gracefully
- ✅ Handles write errors gracefully

### 5. Git Hooks Management (`git-hooks.ts`)

**Responsibility**: Install/uninstall git hooks for auto-merging

**Primary Strategy**: Use `git config core.hooksPath`

**Implementation**:
```typescript
export async function installHooks(
  options?: { legacy?: boolean }
): Promise<InstallResult>;

export async function uninstallHooks(): Promise<void>;

interface InstallResult {
  method: 'hooksPath' | 'legacy';
  hooksInstalled: string[];  // ['post-checkout', 'post-merge', 'post-commit']
  warnings: string[];
}
```

**Hook Installation Flow**:
1. Check if in git repository
2. Check if `core.hooksPath` already set
   - If set to different path: warn user, offer legacy mode
   - If not set: use hooksPath method (preferred)
3. Create `.machine-config-sync/hooks/` directory
4. Create hook files: `post-checkout`, `post-merge`, `post-commit`
5. Make hooks executable (Unix: chmod +x)
6. Set `git config core.hooksPath .machine-config-sync/hooks`

**Legacy Mode** (if core.hooksPath conflicts):
1. Back up existing hooks to `.git/hooks/*.pre-mcs`
2. Create new hooks that:
   - Run `machine-config-sync merge`
   - Call original hook if it existed
3. Make hooks executable

**Hook Template**:
```bash
#!/bin/sh
# Auto-generated by machine-config-sync

machine-config-sync merge --silent

# Call original hook if exists (legacy mode only)
if [ -f .git/hooks/post-checkout.pre-mcs ]; then
  .git/hooks/post-checkout.pre-mcs "$@"
fi
```

**Tests**:
- ✅ Detects git repository
- ✅ Installs hooks via core.hooksPath
- ✅ Creates all three hook files
- ✅ Makes hooks executable on Unix
- ✅ Sets git config correctly
- ✅ Warns if core.hooksPath already set
- ✅ Legacy mode backs up existing hooks
- ✅ Legacy mode calls original hooks
- ✅ Uninstall removes hooks and config
- ✅ Handles non-git directory gracefully

### 6. CLI (`cli.ts`)

**Responsibility**: Command-line interface

**Commands**:

```bash
# Initialize in current repository
machine-config-sync init [options]

Options:
  --hooks-path         Use core.hooksPath method (default)
  --legacy             Use legacy .git/hooks wrapping
  --auto               Auto-detect best method
  --with-package-json  Add prepare script to package.json

# Manually trigger merge
machine-config-sync merge [options]

Options:
  --silent, -s         Suppress all output except errors

# Show information
machine-config-sync info

# Uninstall hooks
machine-config-sync uninstall

# Show help
machine-config-sync --help
machine-config-sync -h

# Show version
machine-config-sync --version
machine-config-sync -v
```

**Init Command Flow**:
1. Detect if in git repository
2. Detect machine name
3. Scan for existing `.<machine>.` files
4. Install git hooks (method based on options)
5. Update `.gitignore` with output files
6. Perform initial merge
7. Print helpful summary:
   ```
   ✓ Machine detected: homezone
   ✓ Git hooks installed via core.hooksPath
   ✓ Added 1 file to .gitignore: config.json
   ✓ Merged 1 file: config.base.json + config.homezone.json → config.json
   
   Git hooks will auto-merge on:
   - checkout (switching branches)
   - merge (git pull/merge)
   - commit
   ```

**Merge Command Flow**:
1. Detect machine name
2. Scan for merge operations
3. Perform each merge
4. Print summary (unless --silent)

**Info Command Output**:
```
Machine name: homezone
Repository: /path/to/repo
Hooks method: core.hooksPath
Hooks path: .machine-config-sync/hooks
Tracked patterns: 2
  - config.base.json + config.homezone.json → config.json
  - .env.base + .env.homezone → .env
```

**Tests**:
- ✅ `init` command works
- ✅ `merge` command works
- ✅ `info` command shows correct data
- ✅ `uninstall` command works
- ✅ `--help` shows usage
- ✅ `--version` shows version
- ✅ Handles errors gracefully

### 7. Logger (`utils/logger.ts`)

**Responsibility**: Consistent logging with silent mode support

**Implementation**:
```typescript
export const logger = {
  info(message: string): void,
  success(message: string): void,
  warn(message: string): void,
  error(message: string): void,
  setSilent(silent: boolean): void,
};
```

**Behavior**:
- `info`, `success`, `warn`: Respect silent mode
- `error`: Always output to stderr (even in silent mode)
- Format: `[machine-config-sync] <message>`
- Use colors if terminal supports it

### 8. Error Handler (`utils/error-handler.ts`)

**Responsibility**: Centralized error handling strategies

**Error Scenarios**:

1. **Base file missing, machine exists**: Use machine file only
2. **Machine file missing, base exists**: Use base file only
3. **Both files missing**: Skip silently, return success=false
4. **Parse error (JSON/ENV)**: Log error with file path, skip merge
5. **Write error (permissions)**: Log error, don't crash
6. **Not in git repo**: Error and exit
7. **Git command fails**: Log error, provide remediation steps

**Implementation**:
```typescript
export function handleMergeError(
  error: Error,
  operation: MergeOperation
): MergeResult;

export function handleGitError(error: Error): never;
```

## GitIgnore Strategy

Auto-add output files to `.gitignore`:

```gitignore
# Added by machine-config-sync
config.json
.env
```

**Implementation**:
1. Read existing `.gitignore` (create if missing)
2. Add marker comment if not present
3. Add output files under marker (avoid duplicates)
4. Write back to `.gitignore`

## Testing Strategy

### Unit Tests

Each component tested in isolation:
- `machine-detector.test.ts`: Machine name detection
- `file-scanner.test.ts`: File pattern matching
- `json-adapter.test.ts`: JSON parsing and merging
- `env-adapter.test.ts`: ENV parsing and merging
- `merger.test.ts`: Merge orchestration logic
- `git-hooks.test.ts`: Hook installation/uninstallation

### Integration Tests

End-to-end workflows:
- `init.test.ts`: Full initialization flow
- `merge.test.ts`: Full merge flow with real files
- `git-hooks.test.ts`: Hooks actually trigger merges

### Test Utilities

Create helpers for common test scenarios:
```typescript
// Test fixture creation
function createTestRepo(): TestRepo;
function createTestFiles(files: Record<string, string>): void;
function cleanupTestRepo(): void;

// Assertions
function assertFileExists(path: string): void;
function assertFileContent(path: string, expected: string): void;
function assertGitConfig(key: string, value: string): void;
```

### Test Coverage Goals

- Minimum 80% code coverage
- All error paths tested
- All file format combinations tested
- Cross-platform compatibility verified

## Package Structure

### package.json

```json
{
  "name": "machine-config-sync",
  "version": "0.1.0",
  "description": "Automatically merge machine-specific config files with base configs",
  "type": "module",
  "bin": {
    "machine-config-sync": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build src/cli.ts --outdir dist --target node",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "dev": "bun run src/cli.ts",
    "prepublishOnly": "bun run build"
  },
  "keywords": [
    "git",
    "config",
    "merge",
    "machine-specific",
    "dotenv",
    "json",
    "git-hooks"
  ],
  "author": "JosXa",
  "license": "MIT",
  "devDependencies": {
    "@types/bun": "latest",
    "bun-types": "latest"
  },
  "dependencies": {
    "minimist": "^1.2.8"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

## Installation & Usage

### Development Setup

```bash
cd D:/projects/machine-config-sync
bun install
bun link

# In target repo
cd C:\Users\josch\.config\opencode
bun link machine-config-sync
machine-config-sync init
```

### Production Usage

```bash
# Global install (future)
npm install -g machine-config-sync

# In your repo
machine-config-sync init

# Manual merge (if needed)
machine-config-sync merge
```

## Example Workflow

### Initial Setup (OpenCode Config Repo)

```bash
cd C:\Users\josch\.config\opencode

# Install tool
machine-config-sync init

# Output:
# ✓ Machine detected: homezone
# ✓ Git hooks installed via core.hooksPath
# ✓ No machine-specific files found
# 
# Next steps:
# 1. Create base config: config.base.json
# 2. Create machine config: config.homezone.json
# 3. Run: machine-config-sync merge

# Reorganize existing config
mv config.json config.homezone.json

# Extract shared settings to base
# ... edit config.base.json manually ...

# Merge
machine-config-sync merge

# Output:
# [machine-config-sync] Merged config.base.json + config.homezone.json → config.json

# config.json is now auto-generated and gitignored
# Future git operations will auto-merge
```

### Daily Workflow

```bash
# Switch branches - auto-merge happens
git checkout feature-branch
# [machine-config-sync] Merged config.base.json + config.homezone.json → config.json

# Pull changes - auto-merge happens
git pull
# [machine-config-sync] Merged config.base.json + config.homezone.json → config.json

# Commit changes - auto-merge happens
git commit -m "Update config"
# [machine-config-sync] Merged config.base.json + config.homezone.json → config.json
```

## Implementation Phases

### Phase 1: Core Functionality (MVP)
- ✅ Machine detection
- ✅ File scanner
- ✅ JSON adapter
- ✅ ENV adapter
- ✅ Merger
- ✅ Basic CLI (init, merge, info)
- ✅ Git hooks (hooksPath method)
- ✅ Unit tests
- ✅ Integration tests

### Phase 2: Polish & Robustness
- Error handling edge cases
- Legacy hook wrapping mode
- Better logging/output
- GitIgnore auto-update
- Cross-platform testing (Windows/Linux/Mac)

### Phase 3: Future Enhancements (Post-MVP)
- YAML support
- TOML support
- Custom merge strategies
- Config file for patterns
- Watch mode for development
- Dry-run mode
- Diff preview
- Package.json integration helpers

## Success Criteria

- ✅ Tool initializes in < 5 seconds
- ✅ Merges happen silently in git hooks
- ✅ No manual intervention needed after init
- ✅ Works on Windows, Linux, macOS
- ✅ Handles errors gracefully (no crashes)
- ✅ 80%+ test coverage
- ✅ Clear error messages for users
- ✅ Works with existing git hooks (legacy mode)

## Open Questions & Decisions

### Decided:
1. ✅ Machine name casing: Normalize to lowercase
2. ✅ JSON formatting: 2-space indentation
3. ✅ Array merging: Replace entirely (not merge by index)
4. ✅ Hook method: core.hooksPath (primary), legacy (fallback)
5. ✅ Implementation: Bun + TypeScript
6. ✅ Distribution: NPM package, global install

### To Decide:
1. Should we auto-rename existing files during init? (e.g., config.json → config.homezone.json)
2. Should we support custom patterns via config file?
3. How to handle very large JSON files (performance)?
4. Should we support nested machine names (e.g., config.homezone.dev.json)?

## Documentation Plan

### README.md Sections:
1. Quick start (30 seconds to value)
2. Installation
3. Usage (init, merge, info, uninstall)
4. File naming convention
5. How it works
6. Examples
7. Troubleshooting
8. Contributing
9. License

### Additional Docs:
- CONTRIBUTING.md (for future contributors)
- CHANGELOG.md (version history)
- examples/ directory with sample configs

## Timeline Estimate

- Phase 1 (Core): ~6-8 hours
  - Project setup: 30 min
  - Core components: 3-4 hours
  - Adapters: 1-2 hours
  - CLI: 1 hour
  - Tests: 2-3 hours

- Phase 2 (Polish): ~2-3 hours
- Phase 3 (Future): TBD

**Total MVP: ~8-11 hours**

---

## Next Steps

1. ✅ Create repository
2. ✅ Write plan.md
3. ✅ Commit plan
4. Set up TypeScript project structure
5. Implement core components
6. Write tests
7. Test with real opencode config repo
8. Iterate and polish
9. Publish to npm

Let's build this! 🚀

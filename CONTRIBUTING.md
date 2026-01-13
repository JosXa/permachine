# Contributing to permachine

Thank you for your interest in contributing to `permachine`! This guide covers everything you need to know about the project's architecture, development setup, and contribution process.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Implementation Details](#implementation-details)
- [Testing](#testing)
- [Building](#building)
- [Publishing](#publishing)
- [Code Standards](#code-standards)
- [Submitting Pull Requests](#submitting-pull-requests)

## Development Setup

### Prerequisites

- **Bun** (recommended) or Node.js >= 18.0.0
- Git

### Local Development

```bash
# Clone the repository
git clone https://github.com/JosXa/permachine.git
cd permachine

# Install dependencies
bun install

# Link for local testing
bun link

# In your target repository
cd /path/to/your/test/repo
bun link permachine
```

### Running Locally

```bash
# Run without building
bun run dev init
bun run dev merge
bun run dev info

# Build and run
bun run build
node dist/cli.js merge
```

## Project Structure

```
permachine/
├── src/
│   ├── cli.ts                      # CLI entry point, argument parsing
│   ├── core/
│   │   ├── machine-detector.ts     # Machine name detection
│   │   ├── file-scanner.ts         # Find *.{machine}.* files
│   │   ├── merger.ts               # Orchestrate merge operations
│   │   ├── git-hooks.ts            # Install/uninstall hooks
│   │   └── gitignore-manager.ts    # Manage .gitignore & git tracking
│   ├── adapters/
│   │   ├── base.ts                 # Base adapter interface
│   │   ├── json-adapter.ts         # JSON/JSONC merge logic
│   │   ├── env-adapter.ts          # ENV merge logic
│   │   └── adapter-factory.ts      # Select adapter by file type
│   └── utils/
│       └── logger.ts               # Logging utilities
├── tests/
│   ├── integration/
│   │   ├── git-hooks.test.ts       # Hook installation tests
│   │   ├── merge.test.ts           # End-to-end merge tests
│   │   └── gitignore-manager.test.ts # Gitignore management tests
│   └── unit/
│       ├── json-adapter.test.ts
│       ├── env-adapter.test.ts
│       ├── adapter-factory.test.ts
│       └── machine-detector.test.ts
├── templates/hooks/
│   ├── post-checkout               # Git hook template
│   ├── post-commit                 # Git hook template
│   └── post-merge                  # Git hook template
├── dist/                           # Build output (gitignored)
│   └── cli.js                      # Bundled executable
├── package.json
├── tsconfig.json
├── README.md
└── CONTRIBUTING.md                 # This file
```

## Architecture Overview

### Core Components

#### 1. Machine Detector (`machine-detector.ts`)

Detects the current machine's name across platforms:

```typescript
export function detectMachineName(): string {
  // Windows: COMPUTERNAME environment variable
  // Linux/Mac: hostname() system call
  // Normalized to lowercase for consistency
}
```

**Platform Support:**
- Windows: Uses `process.env.COMPUTERNAME`
- Linux/Mac: Uses `os.hostname()`
- Always normalized to lowercase

#### 2. File Scanner (`file-scanner.ts`)

Discovers machine-specific files in the repository:

```typescript
export async function scanForMachineFiles(
  machineName: string,
  cwd: string = process.cwd()
): Promise<MachineFilePair[]>
```

**Algorithm:**
1. Use `glob` to find all `*.{machineName}.*` files
2. Ignore common directories: `node_modules/`, `.git/`, `dist/`, `build/`
3. For each machine file, derive base and output paths:
   - Machine: `config.laptop.json`
   - Base: `config.base.json`
   - Output: `config.json`
4. Return array of file triplets

**Edge Cases:**
- Nested directories: `settings/app.laptop.json` → `settings/app.json`
- Multiple extensions: `.env.laptop` → `.env`
- No base file: Uses machine file only

#### 3. Adapter System (`adapters/`)

Extensible file format handling:

```typescript
interface FileAdapter {
  canHandle(filePath: string): boolean;
  merge(basePath: string, machinePath: string): Promise<string>;
}
```

**JSON Adapter (`json-adapter.ts`):**
- Deep recursive merge using custom algorithm
- Arrays are replaced entirely (not merged by index)
- Supports JSONC (JSON with comments and trailing commas) via `strip-json-comments`
- Output: 2-space indentation, newline at end

**Merge Algorithm:**
```typescript
function deepMerge(base: any, override: any): any {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) {
    return override; // Primitive or array: replace
  }
  
  const result = { ...base };
  for (const key in override) {
    if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]); // Recurse
    } else {
      result[key] = override[key]; // Replace
    }
  }
  return result;
}
```

**ENV Adapter (`env-adapter.ts`):**
- Simple key-value override (machine values replace base)
- Preserves comments from base file
- Auto-quotes values with spaces or special characters
- Handles edge cases: empty values, multiline values (not supported)

**Example ENV Merge:**
```bash
# Input: .env.base
DATABASE_HOST=localhost  # Default host
API_KEY=default

# Input: .env.laptop
DATABASE_HOST=192.168.1.100
API_KEY=secret_key_123

# Output: .env
DATABASE_HOST=192.168.1.100  # Default host
API_KEY=secret_key_123
```

#### 4. Gitignore Manager (`gitignore-manager.ts`)

Manages `.gitignore` and git tracking automatically:

```typescript
export async function manageGitignore(
  outputPaths: string[],
  options: { noGitignore?: boolean; cwd?: string } = {}
): Promise<GitignoreResult>
```

**What it does:**
1. Normalize paths (Windows `\` → `/`)
2. Check if `.gitignore` exists
3. Read existing `.gitignore` (or start empty)
4. Check which files are already tracked: `git ls-files <path>`
5. Add missing entries to `.gitignore`
6. Remove tracked files: `git rm --cached <path>`
7. Write updated `.gitignore`

**Edge Cases Handled:**
- Files with spaces in names: `"config file.json"`
- Nested directories: `config/app.json`
- Mixed tracking states (some tracked, some not)
- `.gitignore` doesn't exist: creates it
- Duplicate entries: skips
- Idempotent: safe to run multiple times
- Empty paths array: no-op

**Algorithm:**
```typescript
// 1. Normalize paths
const normalized = outputPaths.map(p => p.replace(/\\/g, '/'));

// 2. Read .gitignore
const gitignorePath = path.join(cwd, '.gitignore');
let content = await fs.readFile(gitignorePath, 'utf8').catch(() => '');
const existing = new Set(content.split('\n').map(l => l.trim()));

// 3. Add missing entries
const toAdd = normalized.filter(p => !existing.has(p));
if (toAdd.length > 0) {
  content += (content.endsWith('\n') ? '' : '\n') + toAdd.join('\n') + '\n';
  await fs.writeFile(gitignorePath, content);
}

// 4. Remove from git tracking
for (const path of normalized) {
  const isTracked = await checkIfTracked(path, cwd);
  if (isTracked) {
    await execCommand(`git rm --cached "${path}"`, cwd);
  }
}
```

#### 5. Git Hooks (`git-hooks.ts`)

Installs hooks to auto-merge on git operations:

**Two Installation Methods:**

**1. Preferred: `core.hooksPath`**
```bash
git config core.hooksPath .permachine/hooks
```
- Modern, clean approach
- Doesn't modify `.git/hooks/`
- Easy uninstall: `git config --unset core.hooksPath`

**2. Legacy: `.git/hooks/` Wrapping**
- Backs up existing hooks: `.git/hooks/post-merge` → `.git/hooks/post-merge.pre-permachine`
- Wraps existing hooks (calls original after merge)
- Compatible with other hook tools

**Hook Template:**
```bash
#!/usr/bin/env sh
# Auto-generated by permachine

# Run permachine merge silently
permachine merge --silent 2>&1 | grep -v "^\[permachine\]" || true

# If legacy mode, call original hook
if [ -f ".git/hooks/post-merge.pre-permachine" ]; then
  .git/hooks/post-merge.pre-permachine "$@"
fi
```

**Hooks Installed:**
- `post-checkout` - After switching branches
- `post-merge` - After `git pull` or `git merge`
- `post-commit` - After committing

## Implementation Details

### Merge Process Flow

```
1. CLI Entry (cli.ts)
   ↓
2. Detect Machine Name (machine-detector.ts)
   ↓
3. Scan for Files (file-scanner.ts)
   ↓
4. For each file pair:
   ├─ Select Adapter (adapter-factory.ts)
   ├─ Merge Files (json-adapter.ts or env-adapter.ts)
   ├─ Write Output
   └─ Collect output paths
   ↓
5. Manage Gitignore (gitignore-manager.ts)
   ├─ Add to .gitignore
   └─ Remove from git tracking
   ↓
6. Report Results
```

### Error Handling

**Philosophy:** Fail gracefully, log errors, continue processing other files.

**Scenarios:**

| Scenario | Behavior |
|----------|----------|
| Base missing, machine exists | Use machine file only |
| Machine missing, base exists | Use base file only (rare) |
| Both missing | Skip silently |
| Parse error (invalid JSON) | Log error with file path, skip merge |
| Write error (permissions) | Log error, continue with other files |
| Git command fails | Log error, continue |

**Example Error Handling:**
```typescript
try {
  const baseContent = await fs.readFile(basePath, 'utf8');
  const machineContent = await fs.readFile(machinePath, 'utf8');
  const merged = await adapter.merge(baseContent, machineContent);
  await fs.writeFile(outputPath, merged);
} catch (error) {
  logger.error(`Failed to merge ${basePath} + ${machinePath}: ${error.message}`);
  // Continue with next file
}
```

### JSONC Support

JSON with Comments (JSONC) is supported via `strip-json-comments`:

```typescript
import stripJsonComments from 'strip-json-comments';

const content = await fs.readFile(path, 'utf8');
const stripped = stripJsonComments(content);
const parsed = JSON.parse(stripped); // Now parses successfully
```

**Supported:**
- Single-line comments: `// comment`
- Multi-line comments: `/* comment */`
- Trailing commas: `{ "key": "value", }`

**Note:** Comments are NOT preserved in output (JSON spec doesn't support them).

## Testing

### Test Structure

```
tests/
├── integration/           # End-to-end tests
│   ├── git-hooks.test.ts
│   ├── merge.test.ts
│   └── gitignore-manager.test.ts
└── unit/                  # Component tests
    ├── json-adapter.test.ts
    ├── env-adapter.test.ts
    ├── adapter-factory.test.ts
    └── machine-detector.test.ts
```

### Running Tests

```bash
# All tests
bun test

# Watch mode
bun test --watch

# Specific file
bun test tests/unit/json-adapter.test.ts

# With coverage
bun test --coverage
```

### Test Guidelines

1. **Unit tests** - Test individual components in isolation
2. **Integration tests** - Test full workflows with real file I/O
3. **Use temp directories** - Never modify actual files
4. **Clean up** - Remove temp files in `afterEach`
5. **Test edge cases** - Empty files, missing files, invalid content
6. **Mock sparingly** - Prefer real implementations when possible

### Example Test

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { manageGitignore } from '../src/core/gitignore-manager';

describe('gitignore-manager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'permachine-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create .gitignore if missing', async () => {
    const result = await manageGitignore(['config.json'], { cwd: tempDir });
    
    expect(result.added).toEqual(['config.json']);
    const content = await fs.readFile(path.join(tempDir, '.gitignore'), 'utf8');
    expect(content).toContain('config.json');
  });

  // More tests...
});
```

### Current Test Coverage

- **Total tests:** 74
- **Pass rate:** 100%
- **Areas covered:**
  - JSON deep merge (10 tests)
  - JSONC parsing (3 tests)
  - ENV merge (8 tests)
  - Adapter selection (5 tests)
  - Machine detection (4 tests)
  - Git hooks installation (12 tests)
  - Gitignore management (13 tests)
  - End-to-end workflows (19 tests)

## Building

### Build Process

```bash
# Build for production
bun run build

# Output: dist/cli.js (single bundled file)
```

**Build Configuration (`package.json`):**
```json
{
  "scripts": {
    "build": "bun build src/cli.ts --outdir dist --target node --format esm"
  }
}
```

**What gets bundled:**
- All TypeScript source files
- Dependencies (minimist, glob, strip-json-comments)
- Templates are NOT bundled (included via `files` in package.json)

**Template Resolution:**

Templates must be resolved relative to the package installation, not the bundle:

```typescript
// WRONG: Resolves relative to dist/cli.js
const templatePath = path.join(__dirname, '../templates/hooks/post-merge');

// CORRECT: Resolves relative to package root
import { fileURLToPath } from 'url';
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templatePath = path.join(packageRoot, 'templates/hooks/post-merge');
```

## Publishing

### Pre-publish Checklist

1. ✅ All tests passing (`bun test`)
2. ✅ Version bumped in `package.json`
3. ✅ README.md updated
4. ✅ CHANGELOG.md updated (if exists)
5. ✅ Built successfully (`bun run build`)
6. ✅ Changes committed and pushed

### Publish Steps

```bash
# 1. Ensure you're on main branch
git checkout main
git pull

# 2. Version bump (automatically runs prepublishOnly hook)
npm version patch  # or minor, major

# 3. Publish to npm (requires 2FA)
npm publish --access public --otp=XXXXXX

# 4. Push tags
git push --tags

# 5. Update global installation (for testing)
npm uninstall -g permachine
npm install -g permachine
```

### Versioning

Follow [Semantic Versioning](https://semver.org/):
- **Patch (0.1.x)** - Bug fixes, no breaking changes
- **Minor (0.x.0)** - New features, backward compatible
- **Major (x.0.0)** - Breaking changes

## Code Standards

### TypeScript

- Use explicit types where helpful
- Avoid `any` (use `unknown` if needed)
- Prefer interfaces for public APIs
- Use async/await over raw Promises

### Style

- 2-space indentation
- Single quotes for strings
- Semicolons required
- No trailing whitespace

### Naming

- **Files:** kebab-case (`machine-detector.ts`)
- **Functions:** camelCase (`detectMachineName()`)
- **Classes:** PascalCase (`JsonAdapter`)
- **Constants:** UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`)

### Comments

- Use JSDoc for public APIs
- Explain "why", not "what"
- Keep comments up-to-date

### Example

```typescript
/**
 * Detects the current machine's name from the system hostname.
 * 
 * @returns Machine name in lowercase (e.g., "laptop", "desktop")
 */
export function detectMachineName(): string {
  // Windows uses COMPUTERNAME env var
  if (process.platform === 'win32') {
    return (process.env.COMPUTERNAME || 'unknown').toLowerCase();
  }
  
  // Unix systems use hostname
  return os.hostname().toLowerCase();
}
```

## Submitting Pull Requests

### Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. **Make your changes**
   - Add tests for new functionality
   - Update documentation
   - Follow code standards
4. **Run tests**
   ```bash
   bun test
   ```
5. **Commit with clear messages**
   ```bash
   git commit -m "feat: add YAML support"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/my-new-feature
   ```
7. **Open a Pull Request**
   - Describe what changed and why
   - Link any related issues
   - Request review

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

**Examples:**
```
feat(adapters): add YAML support

Implements YamlAdapter with deep merge support.
Includes tests and documentation.

Closes #42
```

```
fix(gitignore): handle Windows paths correctly

Normalizes backslashes to forward slashes before
adding to .gitignore to ensure cross-platform compatibility.
```

### Review Process

1. Maintainer reviews PR
2. Feedback/changes requested (if needed)
3. You address feedback
4. Maintainer approves and merges

## Future Features & Open Questions

See the [GitHub issues](https://github.com/JosXa/permachine/issues) for planned features and open design questions:

- [#1 - YAML Support](https://github.com/JosXa/permachine/issues/1)
- [#2 - TOML Support](https://github.com/JosXa/permachine/issues/2)
- [#3 - Markdown File Support](https://github.com/JosXa/permachine/issues/3)
- [#4 - Patch File Support (RFC)](https://github.com/JosXa/permachine/issues/4) - Request for Comments on design decisions
- [#5 - Custom Merge Strategies](https://github.com/JosXa/permachine/issues/5)
- [#6 - Configuration File for Patterns](https://github.com/JosXa/permachine/issues/6)
- [#7 - Dry-Run Mode](https://github.com/JosXa/permachine/issues/7)

If you're interested in implementing any of these features, please comment on the corresponding issue to discuss the approach before submitting a PR.

## Questions?

- **Issues:** https://github.com/JosXa/permachine/issues
- **Discussions:** https://github.com/JosXa/permachine/discussions
- **Email:** [Create an issue instead]

Thank you for contributing! 🎉

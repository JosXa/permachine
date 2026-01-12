# permachine

Automatically merge machine-specific configuration files with base configurations in git repositories. Like Husky for git hooks, but for config file management.

## Problem

When working across multiple machines, you often need:
- **Shared configuration** - Settings that work across all machines
- **Machine-specific overrides** - Local paths, API keys, ports, etc.
- **Automatic merging** - No manual copy-paste or merge steps
- **Git-friendly** - Base and machine configs in version control, output gitignored

## Solution

`permachine` automatically:
1. Detects your machine name
2. Finds machine-specific config files (e.g., `config.homezone.json`)
3. Merges them with base configs (e.g., `config.base.json`)
4. Outputs the final config (e.g., `config.json`) - gitignored
5. Runs automatically on git operations via hooks

## Quick Start

```bash
# In your repository
cd /path/to/your/repo

# Initialize (one-time setup)
npx permachine init

# That's it! Your configs will now auto-merge on git operations
```

## Installation

### Development (Local)

```bash
cd D:/projects/git-permachine
bun install
bun link

# In your target repo
cd /path/to/your/repo
bun link git-permachine
```

### Production

```bash
npm install -g git-permachine
# or
bun add -g git-permachine
```

## Usage

### File Naming Convention

Given machine name `homezone` (auto-detected):

| Purpose | Filename | In Git? |
|---------|----------|---------|
| Base config (shared) | `config.base.json` | ✅ Yes |
| Machine-specific | `config.homezone.json` | ✅ Yes |
| Final output (merged) | `config.json` | ❌ No (gitignored) |

Same pattern works for `.env` files:

| Purpose | Filename | In Git? |
|---------|----------|---------|
| Base config | `.env.base` | ✅ Yes |
| Machine-specific | `.env.homezone` | ✅ Yes |
| Final output | `.env` | ❌ No (gitignored) |

### Commands

#### `init` - Initialize in repository

```bash
permachine init [options]

Options:
  --legacy            Use .git/hooks wrapping instead of core.hooksPath
  --auto              Auto-detect best installation method
```

**What it does:**
1. Detects machine name (e.g., `homezone`)
2. Installs git hooks (post-checkout, post-merge, post-commit)
3. Scans for existing `*.{machine}.*` files
4. Performs initial merge
5. Updates `.gitignore` with output files

**Example output:**
```
✓ Machine detected: homezone
✓ Git hooks installed via core.hooksPath
✓ Updated .gitignore with 2 file(s)
✓ Merged 2 file(s)

Git hooks will auto-merge on:
  - checkout (switching branches)
  - merge (git pull/merge)
  - commit
```

#### `merge` - Manually trigger merge

```bash
permachine merge [--silent]
```

Useful for:
- Testing merge logic
- Running manually without git hooks
- CI/CD pipelines

#### `info` - Show current setup

```bash
permachine info
```

**Example output:**
```
Machine name: homezone
Repository: /path/to/repo
Hooks method: core.hooksPath
Hooks path: .permachine/hooks
Tracked patterns: 2
  - config.base.json + config.homezone.json → config.json
  - .env.base + .env.homezone → .env
```

#### `uninstall` - Remove git hooks

```bash
permachine uninstall
```

Removes git hooks and restores original hooks (if using legacy mode).

## How It Works

### 1. Machine Detection

Automatically detects machine name across platforms:
- **Windows**: `COMPUTERNAME` environment variable
- **Linux/Mac**: `hostname()`
- Normalized to lowercase for consistency

### 2. File Discovery

Scans repository for files matching `*.{machine}.*` pattern:
- `config.homezone.json` ✅
- `.env.homezone` ✅
- `settings.homezone.json` ✅
- Ignores `node_modules/`, `.git/`, `dist/`

### 3. Merging Strategy

#### JSON Files
- **Deep merge**: Machine config recursively overrides base
- **Arrays**: Replaced entirely (not merged by index)
- **Output**: 2-space indentation, ends with newline

Example:
```json
// config.base.json
{
  "server": { "host": "localhost", "port": 3000 },
  "logging": { "level": "info" }
}

// config.homezone.json
{
  "server": { "port": 8080 },
  "database": { "password": "secret" }
}

// config.json (merged output)
{
  "server": { "host": "localhost", "port": 8080 },
  "logging": { "level": "info" },
  "database": { "password": "secret" }
}
```

#### ENV Files
- **Simple key-value merge**: Machine values override base
- **Preserves comments**: From base file
- **Quoted values**: Auto-quotes values with spaces or special chars

Example:
```bash
# .env.base
DATABASE_HOST=localhost
DATABASE_PORT=5432
API_KEY=default

# .env.homezone
DATABASE_PORT=3306
API_KEY=secret_key_123

# .env (merged output)
DATABASE_HOST=localhost
DATABASE_PORT=3306
API_KEY=secret_key_123
```

### 4. Git Hooks

Two installation methods:

#### Preferred: `core.hooksPath`
```bash
git config core.hooksPath .permachine/hooks
```
- Clean, modern approach
- No modification of `.git/hooks`
- Easy to uninstall

#### Legacy: `.git/hooks` wrapping
- Backs up existing hooks to `.git/hooks/*.pre-mcs`
- Wraps existing hooks (calls them after merge)
- Compatible with other git hook tools

### 5. Automation

Hooks run on:
- **post-checkout**: After switching branches
- **post-merge**: After `git pull` or `git merge`
- **post-commit**: After committing

Merge happens silently in background (only logs errors).

## Examples

### Example 1: OpenCode Configuration

```bash
cd C:\Users\josch\.config\opencode

# Initialize
permachine init

# Machine detected: homezone

# Reorganize existing config
mv config.json config.homezone.json

# Create base config with shared settings
cat > config.base.json << EOF
{
  "theme": "nightowl-transparent",
  "autoupdate": true
}
EOF

# Add machine-specific settings to config.homezone.json
# ...edit file...

# Merge
permachine merge

# Output: config.json (gitignored)
# Future git operations auto-merge!
```

### Example 2: Multi-Environment Project

```bash
# Different machines, different settings
# Machine: "workstation"
config.workstation.json → Development settings, localhost
.env.workstation → Local database credentials

# Machine: "server"
config.server.json → Production settings, real domains
.env.server → Production database credentials

# Shared base
config.base.json → Common app settings
.env.base → Default environment variables

# Each machine gets its own merged config automatically!
```

### Example 3: Multiple Config Files

```bash
# Project structure
project/
├── config.base.json
├── config.homezone.json
├── settings/
│   ├── app.base.json
│   ├── app.homezone.json
│   ├── database.base.json
│   └── database.homezone.json
└── .env.base
    .env.homezone

# All files auto-merge on git operations:
# - config.json
# - settings/app.json
# - settings/database.json
# - .env
```

## Supported File Types

- ✅ **JSON** (`.json`)
- ✅ **ENV** (`.env`, `.env.*`)
- 🔜 **YAML** (future)
- 🔜 **TOML** (future)

## Error Handling

### Base missing, machine exists
→ Uses machine file only

### Machine missing, base exists
→ Uses base file only (rare, scanner looks for machine files)

### Both missing
→ Skips silently

### Parse error
→ Logs error with file path, skips merge

### Write error
→ Logs error, doesn't crash

## Development

### Setup

```bash
git clone <repo>
cd permachine
bun install
```

### Run Tests

```bash
# All tests
bun test

# Watch mode
bun test --watch

# Specific test file
bun test tests/unit/json-adapter.test.ts
```

### Build

```bash
bun run build
```

### Run Locally

```bash
bun run dev init
bun run dev merge
bun run dev info
```

## Troubleshooting

### Hooks not running

**Check hook installation:**
```bash
permachine info
```

**Verify git config:**
```bash
git config --get core.hooksPath
# Should output: .permachine/hooks
```

**Check hook files exist:**
```bash
ls .permachine/hooks/
```

### Merge not happening

**Run manually to see errors:**
```bash
permachine merge
```

**Check machine name:**
```bash
permachine info
# Verify "Machine name" matches your file pattern
```

### Conflicts with other git hook tools

**Use legacy mode:**
```bash
permachine uninstall
permachine init --legacy
```

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`bun test`)
5. Submit a pull request

## License

MIT © JosXa

## Roadmap

- [x] JSON support
- [x] ENV support
- [x] Git hooks (hooksPath & legacy)
- [x] CLI interface
- [x] Comprehensive tests
- [ ] YAML support
- [ ] TOML support
- [ ] Custom merge strategies
- [ ] Config file for patterns
- [ ] Watch mode for development
- [ ] Dry-run mode
- [ ] npm package publication

## Credits

Inspired by:
- [Husky](https://github.com/typicode/husky) - Git hooks made easy
- The need for machine-specific configurations across development environments

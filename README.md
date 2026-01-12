# permachine

Per-machine config management with git for tools that don't support it natively. Automatically merge machine-specific configurations with a base config.

[![npm version](https://img.shields.io/npm/v/permachine.svg)](https://www.npmjs.com/package/permachine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Problem

When syncing dotfiles across multiple machines, you often need:

- **Shared configuration** - Settings that work across all machines
- **Machine-specific overrides** - Local paths, API keys, ports, etc.
- **Automatic merging** - No manual copy-paste or merge steps

## Solution

`permachine` automatically:

1. Detects your machine name
2. Finds machine-specific config files (e.g. `config.my-laptop.json`, `config.workstation.json`)
3. Merges them with base configs (e.g., `config.base.json`)
4. Outputs the final config (e.g., `config.json`)
5. **Manages .gitignore** - Adds output files and removes from git tracking
6. Runs automatically on git operations via hooks

## Quick Start

```bash
# Install globally
npm install -g permachine

# In your repository
cd /path/to/your/repo

# Initialize (one-time setup)
permachine init

# That's it! Your configs will now auto-merge on git operations when a file ends with `.<machine-name>.<ext>`
```

## CLI Reference

```
permachine - Automatically merge machine-specific config files

USAGE:
  permachine <command> [options]

COMMANDS:
  init                Initialize permachine in current repository
  merge               Manually trigger merge operation
  info                Show information about current setup
  uninstall           Uninstall git hooks
  watch               Watch for file changes and auto-merge

OPTIONS:
  --help, -h          Show this help message
  --version, -v       Show version number
  --silent, -s        Suppress all output except errors (for merge command)
  --legacy            Use legacy .git/hooks wrapping (for init command)
  --auto              Auto-detect best installation method (for init command)
  --no-gitignore      Don't manage .gitignore or git tracking (for init/merge commands)
  --debounce <ms>     Debounce delay in milliseconds (for watch command, default: 300)
  --verbose           Show detailed file change events (for watch command)

EXAMPLES:
  permachine init
  permachine merge --silent
  permachine info
  permachine uninstall
  permachine watch
  permachine watch --debounce 500 --verbose
```

## Usage

### File Naming Convention

Given machine name `my-laptop` (auto-detected from hostname):

| Purpose               | Filename                | In Git?            |
| --------------------- | ----------------------- | ------------------ |
| Base config (shared)  | `config.base.json`      | ✅ Yes             |
| Machine-specific      | `config.my-laptop.json` | ✅ Yes             |
| Final output (merged) | `config.json`           | ❌ No (gitignored) |

Same pattern works for `.env` files:

| Purpose          | Filename         | In Git?            |
| ---------------- | ---------------- | ------------------ |
| Base config      | `.env.base`      | ✅ Yes             |
| Machine-specific | `.env.my-laptop` | ✅ Yes             |
| Final output     | `.env`           | ❌ No (gitignored) |

### Basic Commands

#### Initialize in Repository

```bash
permachine init
```

**What it does:**

- Detects your machine name (e.g., `laptop`, `desktop`, `workstation`)
- Installs git hooks for automatic merging
- Scans for existing machine-specific files
- **Prompts for confirmation** if existing files will be overwritten
- Performs initial merge
- Adds output files to `.gitignore` and removes them from git tracking

**Example output:**

```
✓ Machine detected: laptop
✓ Git hooks installed via core.hooksPath
✓ Merged 2 file(s)
✓ Added 2 file(s) to .gitignore
✓ Removed 1 file(s) from git tracking

Git hooks will auto-merge on:
  - checkout (switching branches)
  - merge (git pull/merge)
  - commit
```

#### Manual Merge

```bash
permachine merge
```

**Prompts for confirmation** if existing files will be overwritten. Useful for testing or running without git hooks.

#### Watch Mode

```bash
permachine watch
```

**What it does:**

- Watches all base and machine-specific files for changes
- Automatically merges when you save any watched file

#### Check Setup

```bash
permachine info
```

**Example output:**

```
Machine name: laptop
Repository: /path/to/repo
Hooks method: core.hooksPath
Hooks path: .permachine/hooks
Tracked patterns: 2
  - config.base.json + config.laptop.json → config.json
  - .env.base + .env.laptop → .env

Output files: 2 total, 1 existing
Existing output files:
  - config.json
```

## Cookbook / Recipes

### Recipe 1: VSCode Settings Per Machine

Different settings for work laptop vs home desktop:

```bash
# On work laptop (machine: "worklaptop")
.vscode/
  ├── settings.base.json         # Shared: theme, font size
  ├── settings.worklaptop.json   # Work paths, proxy settings
  └── settings.json              # ← Merged output (gitignored)

# On home desktop (machine: "desktop")
.vscode/
  ├── settings.base.json         # Shared: theme, font size
  ├── settings.desktop.json      # Home paths, no proxy
  └── settings.json              # ← Merged output (gitignored)
```

**setup.base.json:**

```json
{
  "editor.fontSize": 14,
  "workbench.colorTheme": "Dark+"
}
```

**settings.worklaptop.json:**

```json
{
  "http.proxy": "http://proxy.company.com:8080",
  "terminal.integrated.cwd": "C:/Projects"
}
```

### Recipe 2: Environment Variables

Different database credentials per environment:

```bash
# .env.base (shared defaults)
NODE_ENV=development
LOG_LEVEL=info
API_PORT=3000

# .env.laptop (local dev)
DATABASE_URL=postgresql://localhost:5432/myapp_dev
API_KEY=dev_key_123

# .env.prodserver (production)
DATABASE_URL=postgresql://prod.db.com:5432/myapp
API_KEY=prod_key_xyz

# .env ← Merged output (gitignored)
```

### Recipe 3: Package.json Scripts

Different build scripts for different machines:

```bash
# package.base.json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}

# package.laptop.json (local development)
{
  "scripts": {
    "dev": "nodemon src/index.js",
    "build": "webpack --mode development"
  }
}

# package.buildserver.json (CI/CD)
{
  "scripts": {
    "build": "webpack --mode production",
    "deploy": "aws s3 sync dist/ s3://my-bucket"
  }
}

# package.json ← Merged output
# Each machine gets appropriate scripts!
```

### Recipe 4: Database Configuration

Multi-environment database setup:

```bash
# config/database.base.json
{
  "pool": {
    "min": 2,
    "max": 10
  },
  "migrations": {
    "directory": "./migrations"
  }
}

# config/database.laptop.json
{
  "connection": {
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "user": "dev",
    "password": "dev123"
  }
}

# config/database.prodserver.json
{
  "connection": {
    "host": "db.production.com",
    "port": 5432,
    "database": "myapp_production",
    "user": "produser",
    "password": "secure_password_from_vault"
  },
  "pool": {
    "min": 10,
    "max": 50
  }
}
```

### Recipe 5: Multi-File Projects

Complex projects with multiple config files:

```bash
project/
├── config.base.json
├── config.laptop.json
├── settings/
│   ├── app.base.json
│   ├── app.laptop.json
│   ├── database.base.json
│   └── database.laptop.json
├── .env.base
└── .env.laptop

# After `permachine init`, all files auto-merge:
# - config.json
# - settings/app.json
# - settings/database.json
# - .env
```

## How It Works

`permachine` uses a simple three-step process:

1. **Machine Detection** - Automatically detects your machine name from hostname (Windows: `COMPUTERNAME`, Linux/Mac: `hostname()`)

2. **File Discovery** - Scans your repository for files matching the pattern `*.{machine}.*` (e.g., `config.laptop.json`, `.env.desktop`)

3. **Smart Merging** - Merges base and machine-specific configs:

   - **JSON**: Deep recursive merge (machine values override base)
   - **ENV**: Key-value merge with comment preservation

4. **Gitignore Management** - Automatically adds output files to `.gitignore` and removes already-tracked files from git

5. **Git Hooks** - Installs hooks to auto-merge on checkout, merge, and commit operations

For detailed implementation information, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Supported File Types

| Type  | Extensions            | Merge Strategy                    | Status       |
| ----- | --------------------- | --------------------------------- | ------------ |
| JSON  | `.json`               | Deep recursive merge              | ✅ Supported |
| JSONC | `.json` with comments | Deep merge + comment preservation | ✅ Supported |
| ENV   | `.env`, `.env.*`      | Key-value override                | ✅ Supported |
| YAML  | `.yaml`, `.yml`       | Deep recursive merge              | 🔜 Planned   |
| TOML  | `.toml`               | Deep recursive merge              | 🔜 Planned   |

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

**Check machine name matches your files:**

```bash
permachine info
# Verify "Machine name" matches your file pattern
```

### Wrong machine name detected

Machine names are auto-detected from your system hostname. To verify:

```bash
# Windows
echo %COMPUTERNAME%

# Linux/Mac
hostname
```

Files must match this name (case-insensitive).

### Conflicts with other git hook tools

If you use Husky or other hook managers, use legacy mode:

```bash
permachine uninstall
permachine init --legacy
```

This wraps existing hooks instead of replacing them.

### Output file not being gitignored

By default, `permachine init` and `permachine merge` automatically add output files to `.gitignore`. If this isn't working:

1. Check if `.gitignore` exists and contains your output files
2. Verify the file was removed from git tracking: `git ls-files config.json` (should return nothing)
3. If you used `--no-gitignore`, re-run without that flag

To manually fix:

```bash
echo "config.json" >> .gitignore
git rm --cached config.json
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Architecture overview
- Testing guidelines
- Code standards
- How to submit PRs

## License

MIT © [JosXa](https://github.com/JosXa)

## Roadmap

- [x] JSON support
- [x] ENV support
- [x] JSONC support (comments & trailing commas)
- [x] Git hooks (hooksPath & legacy)
- [x] Automatic .gitignore management
- [x] CLI interface
- [x] Comprehensive tests (81 tests)
- [x] npm package publication
- [x] Watch mode for development
- [ ] YAML support
- [ ] TOML support
- [ ] Custom merge strategies
- [ ] Config file for patterns
- [ ] Dry-run mode

## Credits

Inspired by:

- [Husky](https://github.com/typicode/husky) - Git hooks made easy
- The need for machine-specific configurations across development environments

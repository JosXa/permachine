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

**settings.base.json:**

```json
{
  "editor.fontSize": 14,
  "workbench.colorTheme": "Dark+",
  "terminal.integrated.shell.windows": "powershell.exe"
}
```

**settings.worklaptop.json:**

```json
{
  "http.proxy": "http://proxy.company.com:8080",
  "terminal.integrated.cwd": "C:/Projects/Work"
}
```

**settings.desktop.json:**

```json
{
  "terminal.integrated.cwd": "C:/Code/Personal",
  "git.path": "C:/Program Files/Git/bin/git.exe"
}
```

### Recipe 2: OpenCode Config (AI Assistant)

[OpenCode](https://opencode.ai) supports machine-specific MCP servers and model preferences:

```bash
~/.config/opencode/
  ├── config.base.json         # Shared: agents, themes, keybinds
  ├── config.worklaptop.json   # Work: Google Sheets MCP
  ├── config.homezone.json     # Home: Telegram MCP, local paths
  └── config.json              # ← Merged output (gitignored)
```

**config.base.json:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "nightowl-transparent",
  "keybinds": {
    "input_newline": "shift+return"
  },
  "mcp": {
    "perplexity-mcp": {
      "enabled": true,
      "type": "local",
      "command": ["uvx", "perplexity-mcp"]
    }
  }
}
```

**config.homezone.json:**

```json
{
  "mcp": {
    "telegram-mcp": {
      "enabled": true,
      "type": "local",
      "command": ["uv", "--directory", "D:\\git\\telegram-mcp", "run", "main.py"]
    },
    "google-sheets": {
      "enabled": true,
      "environment": {
        "SERVICE_ACCOUNT_PATH": "C:/Users/josch/.config/opencode/secrets/service-account.json"
      }
    }
  }
}
```

**config.worklaptop.json:**

```json
{
  "mcp": {
    "telegram-mcp": {
      "enabled": false
    },
    "google-sheets": {
      "enabled": true,
      "environment": {
        "SERVICE_ACCOUNT_PATH": "/work/credentials/google-service-account.json",
        "DRIVE_FOLDER_ID": "work-folder-id-123"
      }
    }
  }
}
```

### Recipe 3: Package.json Scripts (Platform-Specific)

Different scripts for macOS vs Windows development:

```bash
# package.base.json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "test": "jest",
    "lint": "eslint src/"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}

# package.macos.json
{
  "scripts": {
    "dev": "NODE_ENV=development nodemon src/index.js",
    "build": "rm -rf dist && webpack",
    "open": "open http://localhost:3000"
  }
}

# package.windows.json
{
  "scripts": {
    "dev": "set NODE_ENV=development && nodemon src/index.js",
    "build": "rmdir /s /q dist && webpack",
    "open": "start http://localhost:3000"
  }
}

# package.json ← Merged output
# Each OS gets appropriate shell commands!
```

### Recipe 4: Git Config

Personal vs work Git settings:

```bash
# .gitconfig.base
[core]
  editor = code --wait
  autocrlf = true
[pull]
  rebase = true
[init]
  defaultBranch = main

# .gitconfig.worklaptop
[user]
  name = John Doe
  email = john.doe@company.com
[url "https://"]
  insteadOf = git://
[http]
  proxy = http://proxy.company.com:8080

# .gitconfig.homezone
[user]
  name = JohnD
  email = johndoe@personal.com
[github]
  user = johnd-personal
```

### Recipe 5: Multi-File Dotfiles

Complete dotfiles setup across machines:

```bash
~/.config/
├── nvim/
│   ├── init.base.vim        # Shared vim config
│   ├── init.worklaptop.vim  # Work-specific plugins
│   ├── init.homezone.vim    # Personal plugins
│   └── init.vim             # ← Merged
├── alacritty/
│   ├── alacritty.base.yml   # Shared terminal config
│   ├── alacritty.macos.yml  # macOS font paths
│   ├── alacritty.windows.yml # Windows font paths
│   └── alacritty.yml        # ← Merged
├── opencode/
│   ├── config.base.json
│   ├── config.worklaptop.json
│   └── config.json          # ← Merged
└── .env.base
    .env.worklaptop
    .env                     # ← Merged

# After `permachine init`, sync your dotfiles repo across machines!
# Each machine automatically gets the right config.
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

| Type     | Extensions            | Merge Strategy                    | Status                                         |
| -------- | --------------------- | --------------------------------- | ---------------------------------------------- |
| JSON     | `.json`               | Deep recursive merge              | ✅ Supported                                   |
| JSONC    | `.json` with comments | Deep merge + comment preservation | ✅ Supported                                   |
| ENV      | `.env`, `.env.*`      | Key-value upsert                  | ✅ Supported                                   |
| Markdown | `.md`                 | Append (base + machine)           | 🔜 [Planned](#3)                               |
| YAML     | `.yaml`, `.yml`       | Deep recursive merge              | 🔜 [Planned](#1)                               |
| TOML     | `.toml`               | Deep recursive merge              | 🔜 [Planned](#2)                               |
| Patch    | `.patch`              | Apply git-style patch to base     | 💡 [Proposed](#4) |

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
- [ ] YAML support ([#1](https://github.com/JosXa/permachine/issues/1))
- [ ] TOML support ([#2](https://github.com/JosXa/permachine/issues/2))
- [ ] Markdown support ([#3](https://github.com/JosXa/permachine/issues/3))
- [ ] Patch file support ([#4](https://github.com/JosXa/permachine/issues/4))
- [ ] Custom merge strategies ([#5](https://github.com/JosXa/permachine/issues/5))
- [ ] Config file for patterns ([#6](https://github.com/JosXa/permachine/issues/6))
- [ ] Dry-run mode ([#7](https://github.com/JosXa/permachine/issues/7))

## Credits

Inspired by:

- [Husky](https://github.com/typicode/husky) - Git hooks made easy
- The need for machine-specific configurations across development environments

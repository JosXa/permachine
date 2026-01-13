# File Filters

Advanced file filtering system for `permachine` that allows you to specify conditions for when config files should be merged.

## Overview

The new `{key=value}` syntax allows you to create config files that apply only when specific conditions are met, such as operating system, architecture, machine name, username, or environment.

## Syntax

```
filename.{key=value}.extension
filename.{key1=value1}{key2=value2}.extension
```

### Supported Filters

| Filter | Description | Example Values |
|--------|-------------|----------------|
| `os` | Operating system | `windows`, `macos`, `linux`, `freebsd` |
| `arch` | CPU architecture | `x64`, `arm64`, `ia32`, `arm` |
| `machine` | Machine/hostname | `laptop-work`, `desktop-home`, `server-prod` |
| `user` | Username | `josxa`, `john`, `admin` |
| `env` | Environment variable (`NODE_ENV`) | `prod`, `dev`, `staging`, `test` |

## Examples

### Operating System

Different configs for different operating systems:

```bash
# Windows only
config.{os=windows}.json

# macOS only
config.{os=macos}.json

# Linux only
config.{os=linux}.json
```

### Machine-Specific

Same as the legacy syntax, but more explicit:

```bash
# Old syntax (still supported)
config.homezone.json

# New syntax (recommended)
config.{machine=homezone}.json
```

### Multiple Filters (AND Logic)

All filters must match:

```bash
# Only on Windows x64
binary.{os=windows}{arch=x64}.exe

# Only on this machine running in production
secrets.{machine=laptop-work}{env=prod}.env

# User and machine specific
settings.{user=josxa}{machine=homezone}.json
```

### OR Logic (Comma-Separated Values)

Match any of the specified values:

```bash
# Windows OR macOS
config.{os=windows,macos}.json

# Development OR staging environment
config.{env=dev,staging}.json

# Multiple machines
config.{machine=laptop1,laptop2,laptop3}.json
```

## Operators

### Equals (`=`)

Match exact value or any value in comma-separated list:

```bash
config.{os=windows}.json           # Matches Windows only
config.{os=windows,linux}.json     # Matches Windows OR Linux
```

### Not Equals (`!=`) - Future

Exclude specific values:

```bash
config.{os!=windows}.json          # All except Windows
```

### Wildcard (`~`) - Future

Pattern matching with `*`:

```bash
config.{machine~laptop*}.json      # laptop-work, laptop-home, etc.
config.{env~prod-*}.json           # prod-us, prod-eu, etc.
```

### Range (`^`) - Future

Match values in a range:

```bash
app.{version^1.0-2.0}.json         # Versions 1.0 through 2.0
```

## Real-World Examples

### Example 1: Cross-Platform Development

```bash
# Shared settings
package.base.json

# Platform-specific build scripts
package.{os=windows}.json    # Windows: PowerShell, .bat
package.{os=macos}.json      # macOS: bash, .sh
package.{os=linux}.json      # Linux: bash, .sh
```

### Example 2: Secrets Management

```bash
# Base configuration (no secrets)
config.base.json

# Production secrets (only on production machines)
config.{env=prod}{machine=prod-server}.json

# Development secrets (only for specific developers)
config.{env=dev}{user=josxa}.json
```

### Example 3: Multi-User Development Machine

```bash
# Shared team settings
.vscode/settings.base.json

# Per-user customizations
.vscode/settings.{user=alice}.json
.vscode/settings.{user=bob}.json
.vscode/settings.{user=charlie}.json
```

### Example 4: Architecture-Specific Binaries

```bash
# Base configuration
app.base.json

# Windows x64
app.{os=windows}{arch=x64}.json

# Windows ARM
app.{os=windows}{arch=arm64}.json

# macOS Apple Silicon
app.{os=macos}{arch=arm64}.json

# macOS Intel
app.{os=macos}{arch=x64}.json
```

## Backward Compatibility

The legacy `.machine.` syntax still works:

```bash
# Legacy (still supported)
config.homezone.json       → config.json
.env.homezone              → .env

# Modern equivalent
config.{machine=homezone}.json
.env.{machine=homezone}
```

Both syntaxes can coexist in the same repository.

## How It Works

1. **File Discovery**: `permachine` scans for files with `{filter}` syntax
2. **Context Detection**: Automatically detects current OS, arch, machine, user, env
3. **Filter Matching**: Evaluates each filter against current context
4. **AND Logic**: ALL filters in a filename must match
5. **OR Logic**: Any value in comma-separated list matches
6. **Merge**: If filters match, the file participates in the merge

## API Reference

For programmatic use:

```typescript
import {
  parseFilters,
  matchFilters,
  getFilterContext,
} from 'permachine/core/file-filters';

// Parse filters from filename
const { filters, baseFilename } = parseFilters('config.{os=windows}.json');
// filters: [{ key: 'os', operator: '=', value: 'windows', raw: '{os=windows}' }]
// baseFilename: 'config.json'

// Get current system context
const context = getFilterContext();
// { os: 'windows', arch: 'x64', machine: 'laptop', user: 'josxa', env: 'dev' }

// Check if file matches current context
const result = matchFilters('config.{os=windows}{arch=x64}.json');
// { matches: true/false, failedFilters: [], context: {...} }
```

## Future Enhancements

The filter system is designed to support future enhancements:

- **Negation**: `{os!=windows}` - Match all except Windows
- **Wildcards**: `{machine~laptop*}` - Pattern matching
- **Ranges**: `{version^1.0-2.0}` - Version ranges
- **Custom Filters**: User-defined filter keys
- **Complex Logic**: `{(os=windows,linux)&(arch=x64)}` - Nested conditions

## Troubleshooting

### Filters not matching

Run `permachine info` to see your current context:

```bash
$ permachine info
Machine name: laptop-work
OS: windows
Arch: x64
User: josxa
Environment: dev (from NODE_ENV)
```

### File not found

Make sure filter characters are allowed on your filesystem. Some characters like `:` and `~` are forbidden on Windows.

Safe characters in filenames:
- `{}` - Curly braces (required for filters)
- `=` - Equals sign (recommended separator)
- `-` - Hyphen
- `_` - Underscore
- `,` - Comma (for OR logic)

Avoid:
- `:` - Forbidden on Windows
- `~` - May cause issues on some systems
- `*` - Forbidden on Windows (use in filter values, not filenames)

## Migration Guide

### From Legacy Syntax

```bash
# Old
config.homezone.json

# New
config.{machine=homezone}.json
```

### From Environment Variables

Before:
```bash
# .env.development
# .env.production
```

After:
```bash
# .env.base (shared)
# .env.{env=dev}
# .env.{env=prod}
```

### From Platform-Specific Directories

Before:
```bash
config/
  ├── windows/
  │   └── settings.json
  └── macos/
      └── settings.json
```

After:
```bash
config/
  ├── settings.base.json
  ├── settings.{os=windows}.json
  └── settings.{os=macos}.json
```

## Best Practices

1. **Start with `.base` files**: Always have a base configuration
2. **Use specific filters**: `{os=windows}` is better than relying on machine name
3. **Document your filters**: Add comments in base files explaining which filters exist
4. **Test locally**: Use `permachine info` and `permachine merge` to test before committing
5. **Combine filters wisely**: More filters = more specific = less likely to match
6. **Use OR for variants**: `{os=windows,macos}` for cross-platform configs

## See Also

- [Main README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [API Documentation](./API.md) (if it exists)

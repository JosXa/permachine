## What's New

### Directory-Level Machine-Specific Matching

You can now apply filters to **entire directories**. When a directory matches your machine/OS/user context, all its contents are copied as-is to the output directory.

**Example:**
```
.opencode/skills/
├── jira.{machine=work}/       # Only on "work" machine
│   ├── skill.md
│   └── templates/
├── home-tools.{machine=home}/ # Only on "home" machine
└── shared/                    # Always present
```

On machine `work`, you get:
```
.opencode/skills/
├── jira/                      # ← Copied from jira.{machine=work}/
│   ├── skill.md
│   └── templates/
└── shared/
```

**Supported filters on directories:**
- `{machine=hostname}` - Machine-specific
- `{os=windows}`, `{os=macos}`, `{os=linux}` - OS-specific
- `{user=username}` - User-specific
- Multiple filters: `dir.{machine=laptop}{os=windows}/`

**Key behaviors:**
- Files inside matched directories are copied verbatim (no recursive filter processing)
- Nested filtered directories are not allowed
- Stale outputs are renamed with `.permachine-deleted` suffix for safety

### Bug Fixes

- Fixed watcher error handling for directory changes
- Improved cross-platform path handling

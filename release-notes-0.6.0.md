## Features

- **JSONC Support**: Added support for `.jsonc` file extension (JSON with Comments)
  - Handles single-line comments (`//`) and block comments (`/* */`)
  - Handles trailing commas
  - Works with all permachine features (base files, machine-specific files, filters)

## Technical Improvements

- Centralized file type detection logic in `adapter-factory.ts`
- Refactored file-scanner to use centralized `getFileType()` function
- Added comprehensive tests for JSONC parsing

## Testing

Successfully tested with OpenCode configuration files containing JSONC format.

Example usage:
```
opencode.base.jsonc + opencode.{machine=homezone}.jsonc → opencode.jsonc
```

## Breaking Change

- **JSONC files now output to `.json` extension**: When merging `.jsonc` source files, the output will be a `.json` file (not `.jsonc`)
  - Example: `config.base.jsonc` + `config.{machine=foo}.jsonc` → `config.json`
  - This makes it explicit that comments are stripped during the merge process
  - JSONC is for authoring (with documentation comments), JSON is for runtime (clean output)

## Why This Change?

This clarifies the behavior and intent:
- Source files can use `.jsonc` to include helpful comments for developers
- Merged output is always clean `.json` for consumption by tools/applications
- No confusion about whether comments are preserved (they're not)

## Migration

If you were using `.jsonc` files and expecting `.jsonc` output:
- The output will now be `.json` instead
- Update any scripts/configs that reference the output file to use `.json` extension
- The merged content is identical - only the extension changes

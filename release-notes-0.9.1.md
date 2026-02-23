## Summary

- **Bug fix**: Watch command now performs an initial merge when started, ensuring configs are up-to-date before watching for changes

## Details

Previously, running `permachine watch` would only detect and merge changes made *after* the watcher started. This meant if files hadn't been merged yet, you'd need to run `permachine merge` first or make a change to trigger the initial merge.

Now, `permachine watch` automatically:
1. Scans for all pending merge operations
2. Performs initial merges/copies for any files that need updating
3. Then starts watching for future changes

This ensures your config files are always in sync when the watcher starts.

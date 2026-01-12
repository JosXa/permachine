---
alwaysApply: true
---

# Release Process

When creating releases for this npm package:

1. **Update version**: Edit `package.json` version field OR run `bun version patch|minor|major`
2. **Commit version bump**: `git commit -am "chore: bump version to X.Y.Z"`
3. **Create git tag**: `git tag vX.Y.Z` (MUST include "v" prefix)
4. **Push tag**: `git push origin vX.Y.Z` or `git push origin --tags`

GitHub Actions automatically handles:
- Building & testing
- Changelog generation from commits
- GitHub Release creation
- npm publishing with provenance

DO NOT manually run `npm publish` - the workflow handles it.

## Prerequisites

NPM_TOKEN secret MUST be configured in GitHub repository settings before first release.

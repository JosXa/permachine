---
alwaysApply: true
---

# Package Manager

**ALWAYS use Bun, NEVER npm:**
- `bun install` not `npm install`
- `bun add <package>` not `npm install <package>`
- `bun remove <package>` not `npm uninstall <package>`
- `bun run <script>` not `npm run <script>`
- `bun test` not `npm test`

# Release Process

When creating releases for this npm package:

1. **Commit changes**: Commit all fixes/features with descriptive commit messages
2. **Update version**: Edit `package.json` version field
3. **Commit version bump**: `git commit -am "chore: bump version to X.Y.Z"`
4. **Push commits**: `git push`
5. **CRITICAL - Wait for CI to pass**: Run `gh run list --limit 3` and verify the latest CI workflow shows "completed success". If CI fails, fix the issues before proceeding.
6. **Create git tag**: `git tag vX.Y.Z` (MUST include "v" prefix)
7. **Push tag**: `git push origin vX.Y.Z`
8. **Write release notes**: Create a `release-notes-X.Y.Z.md` file
9. **Create GitHub release**: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file release-notes-X.Y.Z.md`
10. **IMPORTANT - Watch the GitHub Action**: Get the latest run ID with `gh run list --limit 1`, then watch it with `gh run watch <run-id>` OR simply check status with `gh run list --limit 5`
11. **IMPORTANT - Open changelog**: After release completes, open `https://github.com/JosXa/permachine/releases/tag/vX.Y.Z` in browser using `start` command

GitHub Actions automatically handles:
- Building & testing
- npm publishing with provenance

**DO NOT manually run `npm publish`** - the workflow handles it automatically.

## Post-Release Checklist

After creating the release:
1. MUST verify the publish workflow succeeds with `gh run list --limit 5` (check for "completed success" status)
2. MUST open the release page in browser: `start https://github.com/JosXa/permachine/releases/tag/vX.Y.Z`

## Important Safeguards

- The release workflow will automatically fail if CI hasn't passed on the commit being tagged
- Always verify CI passes BEFORE creating and pushing tags
- If you accidentally push a tag while CI is failing, delete the tag immediately: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`

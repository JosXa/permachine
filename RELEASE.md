# Release Process

This project uses GitHub Actions for automated releases and npm publishing.

## How to Create a Release

1. **Update version in package.json**:
   ```bash
   # Edit package.json to bump the version
   # Then commit the change
   git add package.json
   git commit -m "chore: bump version to X.Y.Z"
   ```

2. **Create and push a git tag**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Automated workflow**:
   The GitHub Action will automatically:
   - Build and test the package
   - Generate a changelog from commits
   - Create a GitHub Release with the changelog
   - Publish the package to npm with provenance

## Setup Requirements

### NPM_TOKEN Secret

Before the workflow can publish to npm, you need to add an `NPM_TOKEN` secret to your GitHub repository:

1. **Create an npm access token**:
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Click "Generate New Token" → "Classic Token"
   - Select "Automation" type
   - Copy the generated token

2. **Add secret to GitHub**:
   - Go to https://github.com/JosXa/permachine/settings/secrets/actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm token
   - Click "Add secret"

## Workflow Features

- **Automatic changelog**: Generated from commits between tags
- **Provenance**: npm package includes build provenance for security
- **Testing**: Runs tests before publishing
- **GitHub Release**: Creates a proper release with installation instructions
- **Public access**: Package published as public on npm

## Example Release Command Sequence

```bash
# Update version
bun version patch  # or minor, major

# Push changes and tag
git push origin main
git push origin --tags
```

The workflow will trigger automatically when the tag is pushed.

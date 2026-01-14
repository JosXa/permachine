# v0.5.2

## 🎯 Improvements

### Consistent Base File Detection

Added a centralized `isBaseFile()` utility function to `file-filters.ts` that provides consistent base file detection throughout the codebase.

**Key Changes:**
- Replaced ad-hoc base file checks in `file-scanner.ts` with the new shared utility
- Enhanced type detection in `createBaseOnlyMergeOperation()` to properly handle `{base}` placeholder syntax
- Fixed inconsistent `.endsWith()` and `.includes()` checks that were missing edge cases

**Important Distinction:**
- Files with literal `.base.` (e.g., `config.base.json`, `.env.base`) are **base files**
- Files with `{base}` placeholder (e.g., `config.{base}.json`) are **machine-specific files** that reference the base filename during expansion

**Testing:**
- Added comprehensive test suite with 50+ test cases covering:
  - Literal `.base.` files
  - `{base}` placeholder files (correctly identified as machine-specific)
  - Files with paths (relative, absolute Unix/Windows, nested)
  - Edge cases (empty strings, substring matches, multiple occurrences)
  - Mixed formats (multiple extensions, hyphens, underscores, numbers)

This ensures more maintainable and consistent base file detection across the entire codebase.

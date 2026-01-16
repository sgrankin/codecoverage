# Multiple Coverage Files

## Overview

The action supports reading coverage data from multiple files, which is useful for:
- Monorepos with multiple packages generating separate coverage files
- Projects that run tests in parallel and produce multiple coverage outputs
- Combining coverage from different test suites

## Input Formats

### Single File
```yaml
COVERAGE_FILE_PATH: "coverage/lcov.info"
```

### Glob Pattern
```yaml
COVERAGE_FILE_PATH: "**/coverage.out"
COVERAGE_FILE_PATH: "packages/*/coverage/lcov.info"
COVERAGE_FILE_PATH: "coverage/*.info"
```

### Multiple Paths (newline-separated)
```yaml
COVERAGE_FILE_PATH: |
  packages/frontend/coverage/lcov.info
  packages/backend/coverage/lcov.info
  packages/shared/coverage/lcov.info
```

### Mixed Paths and Globs
```yaml
COVERAGE_FILE_PATH: |
  coverage/lcov.info
  packages/**/coverage.out
```

## Implementation Details

### Path Expansion (`src/utils/files.ts`)

1. Split input on newlines
2. Trim whitespace and filter empty lines
3. For each line:
   - If contains `*`, `?`, or `[` → treat as glob pattern
   - Otherwise → treat as literal path
4. Deduplicate results
5. Sort for consistent ordering

### Merging Coverage Data

Coverage entries from all files are concatenated into a single `CoverageParsed` array.

**Note**: If the same source file appears in multiple coverage files, it will be counted multiple times. This is intentional for cases where different test suites cover different parts of the same file. However, users should be aware this can affect percentage calculations.

### Error Handling

- If no files match the pattern(s), an error is thrown
- If a specified literal path doesn't exist, the parser will fail when trying to read it

## Dependencies

- `glob` package (v10+) for pattern matching
- Supports `**` for recursive directory matching
- Follows `.gitignore`-style patterns

## Constraints

- All files must be in the same format (specified by `COVERAGE_FORMAT`)
- Cannot mix lcov and cobertura files in one run

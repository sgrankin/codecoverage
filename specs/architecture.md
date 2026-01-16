# Architecture

## Project Structure

```
codecoverage/
├── src/
│   ├── main.ts           # Entry point (calls play())
│   ├── action.ts         # Main logic, summary generation
│   ├── types/            # Type declarations for npm packages
│   └── utils/
│       ├── cobertura.ts  # Cobertura XML parser
│       ├── lcov.ts       # LCOV parser
│       ├── gocoverage.ts # Go coverage parser
│       ├── general.ts    # Shared types and utilities
│       ├── github.ts     # GitHub API interactions
│       └── diff.ts       # PR diff parsing
├── __tests__/            # Test files (mirrors src/)
│   └── fixtures/         # Test data files
├── dist/                 # Compiled output (committed)
├── specs/                # Design specifications
└── .github/workflows/    # CI configuration
```

## Data Flow

```
┌─────────────────┐
│ Coverage File   │
│ (lcov/cobertura/go)│
└────────┬────────┘
        │
        ▼
┌─────────────────┐
│ Parser          │
│ (format-specific)│
└────────┬────────┘
        │
        ▼
┌─────────────────┐
│ CoverageParsed  │  (normalized internal format)
└────────┬────────┘
        │
        ├─────────────────────┐
        │                     │
        ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│ PR Diff         │   │ Step Summary    │
│ (GitHub API)    │   │ (grouped by pkg)│
└────────┬────────┘   └─────────────────┘
        │
        ▼
┌─────────────────┐
│ Intersection    │
│ (diff ∩ uncovered)│
└────────┬────────┘
        │
        ▼
┌─────────────────┐
│ Coalesce Ranges │
│ (bridge gaps)   │
└────────┬────────┘
        │
        ▼
┌─────────────────┐
│ Workflow        │
│ Commands        │
│ (::warning::)   │
└─────────────────┘
```

## Key Dependencies

### Runtime
- `@actions/core` - GitHub Actions toolkit (inputs, outputs, logging)
- `@actions/github` - GitHub context (repo, PR info)
- `octokit` - GitHub REST API client
- `lcov-parse` - LCOV format parser
- `golang-cover-parse` - Go coverage parser
- `xml2js` - XML parsing for Cobertura

### Development
- `typescript` - Type checking and compilation
- `vitest` - Test runner
- `@vercel/ncc` - Bundle into single file for dist/
- `eslint` + `prettier` - Linting and formatting

## Build Process

1. `npm run build` - TypeScript compilation to `lib/`
2. `npm run package` - Bundle with ncc to `dist/index.js`
3. `dist/` is committed to the repo (required for GitHub Actions)

## Testing Strategy

- **Unit tests** for each utility module
- **Integration tests** for the main `play()` function with mocked GitHub API
- **Fixture files** for each coverage format
- **Table-driven tests** for `generateSummary()` with various inputs
- Target: ~100% code coverage

## Fork History

```
shravan097/codecoverage (original, unmaintained)
        │
        ▼
ggilder/codecoverage (maintained fork)
        │
        ▼
sgrankin/codecoverage (this fork)
```

### Changes in this fork
- Updated all dependencies to latest versions
- Added Cobertura XML support
- Added GitHub step summary with package grouping
- Added action outputs (coverage_percentage, files_analyzed, annotation_count)
- Improved annotation coalescing to bridge non-executable gaps
- Removed Clover support (ESM compatibility issues)
- Upgraded to Node.js 20 runtime
- Replaced Check Runs API with workflow commands for simpler annotations

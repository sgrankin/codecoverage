# Architecture

## Project Structure

```
codecoverage/
├── src/
│   ├── main.ts           # Entry point (calls play())
│   ├── action.ts         # Main logic, orchestration
│   ├── types/            # Type declarations for npm packages
│   └── utils/
│       ├── baseline.ts   # Baseline storage and delta calculation
│       ├── cobertura.ts  # Cobertura XML parser
│       ├── diff.ts       # PR diff parsing
│       ├── files.ts      # File path expansion (globs)
│       ├── general.ts    # Shared types and utilities
│       ├── github.ts     # GitHub API interactions (diff, comments)
│       ├── gitnotes.ts   # Git notes operations
│       ├── gocoverage.ts # Go coverage parser
│       ├── lcov.ts       # LCOV parser
│       ├── mode.ts       # Mode detection (pr-check/store-baseline)
│       └── summary.ts    # Summary generation (markdown)
├── __tests__/            # Test files (mirrors src/)
│   └── fixtures/         # Test data files
├── dist/                 # Bundled output (committed)
├── docs/                 # Documentation
│   └── examples.md       # Workflow examples
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
         ├──────────────────┬──────────────────┬──────────────────┐
         │                  │                  │                  │
         ▼                  ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ PR Diff         │ │ Step Summary    │ │ PR Comment      │ │ Git Notes       │
│ (GitHub API)    │ │ (collapsible)   │ │ (upsert)        │ │ (baseline)      │
└────────┬────────┘ └─────────────────┘ └─────────────────┘ └────────┬────────┘
         │                                                          │
         ▼                                                          ▼
┌─────────────────┐                                      ┌─────────────────┐
│ Intersection    │                                      │ Delta Calc      │
│ (diff ∩ uncovered)│                                      │ (current-base)  │
└────────┬────────┘                                      └─────────────────┘
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
│ (::notice::)    │
└─────────────────┘
```

## Key Dependencies

### Runtime
- `@actions/core` - GitHub Actions toolkit (inputs, outputs, logging)
- `@actions/github` - GitHub API client and context
- `@actions/glob` - File path expansion
- `fast-xml-parser` - XML parsing for Cobertura

### Development
- `typescript` / `tsgo` - Type checking
- `vitest` - Test runner with in-source testing support
- `esbuild` - Bundle into single file for dist/
- `biome` - Linting and formatting

## Build Process

1. `npm run typecheck` - TypeScript type checking (no emit)
2. `npm run package` - Bundle with esbuild to `dist/index.cjs`
3. `npm run all` - typecheck, format, package, test with coverage

`dist/` is committed to the repo (required for GitHub Actions).

## Testing Strategy

- **In-source tests** for private functions (via `import.meta.vitest`)
- **External tests** for public APIs and integration
- **Fakes over mocks** - Inject fake implementations, not mock expectations
- **Table-driven tests** with `test.each()` for comprehensive coverage
- **Fixture files** for each coverage format
- Target: ~95% code coverage

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
- Node.js 24 runtime
- Coverage delta tracking via git notes
- PR comment support with upsert
- Compact summary format (horizontal table, collapsible details)
- Configurable max annotations
- Cobertura XML support
- Multiple coverage files via globs
- Replaced dependencies: esbuild (was ncc), biome (was eslint+prettier), fast-xml-parser (was xml2js)
- Inlined parsers (lcov, go coverage)

# Development Guidelines

This is a GitHub Action for annotating PRs with lines missing test coverage.

## Testing Requirements

- **All tests must pass** before completing a commit
- **Code coverage must be maintained** at or near 100%
- Run `npm run test:cov` to run tests with coverage report

## Commands

- `npm test` - Run tests in watch mode
- `npm run test:cov` - Run tests with coverage report
- `npm run build` - Compile TypeScript
- `npm run package` - Build for distribution (creates dist/)
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run all` - Build, format, lint, package, and test

## Project Structure

- `src/` - TypeScript source files
  - `action.ts` - Main action logic (`play()` function)
  - `main.ts` - Entry point
  - `utils/` - Utility modules (coverage parsers, GitHub API, diff parsing)
- `__tests__/` - Test files (mirroring src/ structure)
  - `fixtures/` - Test fixture files
- `dist/` - Compiled output (committed to repo)

## Supported Coverage Formats

- `lcov` (default)
- `clover`
- `go`

# Development Guidelines

This is a GitHub Action for annotating PRs with lines missing test coverage.

## Version Control (jj)

Use `jj` (Jujutsu) for version control. Key workflow:

1. **Start**: `jj describe -m "WIP: task"` then make changes
2. **Finish**: `jj describe -m "final message"` then `jj new` to leave empty change on top
3. **Always** leave tree with empty, undescribed change on top when done

## Code Style

- **Inject functions, not single-method interfaces** - If a dependency only has one method called on it, inject a function instead of a class/interface. Simpler to test, simpler to understand.
- **Prefer pure functions** - Keep side effects at the edges; core logic should be pure and easy to test.

## Testing Requirements

- **All tests must pass** before completing a commit
- **Code coverage must be maintained** at or near 100%
- Run `npm run test:cov` to run tests with coverage report
- **Prefer table-driven tests** using `test.each()` for better readability and easier extension

### Fakes, Not Mocks

Prefer **fakes** (simplified working implementations) over **mocks** (programmed expectations):

- **Mocks**: Verify specific calls were made with specific arguments. Tightly coupled to implementation.
- **Fakes**: Actual lightweight implementations (e.g., in-memory store). Test behavior, not implementation.

Benefits of fakes:
- Tests are less brittle—refactoring doesn't break them
- Tests verify outcomes, not how you got there
- Fakes can be reused across tests
- Encourages better interface/abstraction design

Example: Instead of mocking `fs.readFile` to return specific data, use a fake filesystem that stores files in memory.

## Commands

- `npm test` - Run tests in watch mode
- `npm run test:cov` - Run tests with coverage report
- `npm run build` - Compile TypeScript
- `npm run package` - Build for distribution (creates dist/)
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run all` - Build, format, lint, package, and test

**Always run `npm run all` before committing** - this ensures dist/ is rebuilt and included in the commit.

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
- `cobertura`
- `go`

## Specifications

The `specs/` directory contains design documentation. When making significant changes:

- **Update existing specs** if modifying related functionality
- **Create new specs** for major features or architectural decisions
- Keep specs as living documentation that explains *why* decisions were made

## Versioning and Releases

This action uses semantic versioning with floating major version tags:

- **Patch releases**: `v1.3.1`, `v1.3.2`, etc. for bug fixes and minor changes
- **Floating tag**: `v1` always points to the latest `v1.x.x` release

When releasing a new version:

```bash
# Tag the specific version
git tag v1.3.2
git push origin v1.3.2

# Update the floating v1 tag
git tag -f v1
git push -f origin v1
```

Users can reference `@v1` to always get the latest v1.x release.

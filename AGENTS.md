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
- **Doc comments** - Full sentences, starting with the identifier name, ending with a period.
  ```typescript
  // FetchPullDiff retrieves the raw diff for a pull request.
  type FetchPullDiff = () => Promise<string>
  ```
- **Interfaces belong to consumers** - Define interfaces in the code that uses them, not the code that implements them. Don't define interfaces before they're needed.
- **Happy path at minimum indent** - Handle errors/edge cases first and return early; keep the main logic at the lowest nesting level.
- **Variable names** - Short for local scope (`i`, `err`), descriptive for wider scope or exports.
- **Initialisms** - Use consistent capitalization for initialisms (URL, XML, HTTP, ID, API): all caps in PascalCase (`baseURL`, `XMLParser`), all lowercase if starting a camelCase name (`urlString`). See [Go style guide](https://google.github.io/styleguide/go/decisions#initialisms).
- **Zero values over undefined/null** - Prefer type-appropriate zero values (`''`, `0`, `[]`) over `undefined` or `null`. Normalize at boundaries. This eliminates optional properties, simplifies types, and follows Go's "zero value is usable" philosophy. Example: `baseBranch: string` (empty = none) instead of `baseBranch?: string`.
- **The bigger the interface, the weaker the abstraction** - Small, focused interfaces (or just functions).
- **Clear is better than clever** - Prefer readable code over clever one-liners.
- **A little copying is better than a little dependency** - Don't add a dependency for trivial code.
- **`any` says nothing** - Avoid `any`; use precise types.
- **Avoid repetition/stutter** - Don't repeat context clear from the module name. Use namespace imports (`import * as baseline from './baseline'`) so functions can have short names (`baseline.store()` not `storeBaseline()`).
- **Namespace imports** - Prefer `import * as foo from './foo'` over named imports. This provides clear context at call sites while allowing shorter export names.

## Testing

- **All tests must pass** before completing a commit
- **Code coverage must be maintained** at or near 95%
- Run `npm run test:cov` to run tests with coverage report
- **Prefer table-driven tests** using `test.each()` for better readability and easier extension

### In-Source Tests

Use `import.meta.vitest` for testing private/internal functions:

```typescript
// At the end of a source file
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest
  test('helper does X', () => {
    expect(privateHelper('input')).toBe('output')
  })
}
```

This keeps tests close to the code they test and avoids exporting internals.

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
- `npm run typecheck` - Type check with tsgo
- `npm run check` - Lint and format with Biome
- `npm run package` - Bundle for distribution (creates dist/)
- `npm run all` - Typecheck, format, package, and test with coverage

**Always run `npm run all` before committing** - this ensures dist/ is rebuilt and included in the commit.

## Project Structure

```
src/
  action.ts         # Main action logic (play() function)
  main.ts           # Entry point
  utils/            # Utility modules
__tests__/          # External test files (mirrors src/)
  fixtures/         # Test data files
dist/               # Bundled output (committed to repo)
docs/               # User documentation
  examples.md       # Workflow examples
specs/              # Design specifications (see below)
```

## Specifications

The `specs/` directory contains design documentation:

| Spec | Covers |
|------|--------|
| `architecture.md` | Project structure, data flow, dependencies |
| `coverage-formats.md` | LCOV, Cobertura, Go coverage parsing |
| `multiple-files.md` | Glob patterns, file merging |
| `annotations.md` | PR annotation generation, coalescing |
| `step-summary.md` | Summary format, package grouping |
| `pr-comment.md` | PR comment posting, upsert logic |
| `coverage-delta.md` | Git notes, baseline storage, delta calculation |

### Keeping Specs Updated

When making changes:

1. **Before starting**: Check if a relevant spec exists
2. **While working**: Note any design decisions that should be documented
3. **Before committing**: Update or create specs for significant changes

**Rule of thumb**: If you're adding a new input/output, changing data format, or modifying core behavior, update the relevant spec.

## Checklist Before Committing

- [ ] `npm run all` passes
- [ ] New/changed functionality has tests
- [ ] Specs updated if behavior changed
- [ ] README updated if inputs/outputs changed

## Versioning and Releases

This action uses semantic versioning with floating major version tags:

- **Patch releases**: `v1.3.1`, `v1.3.2`, etc. for bug fixes and minor changes
- **Minor releases**: `v1.4.0`, `v1.5.0`, etc. for new features
- **Floating tag**: `v1` always points to the latest `v1.x.x` release

When releasing a new version (using raw git, as jj doesn't handle tags):

```bash
# Tag the specific version
jj git export  # ensure commits are in git
git tag v1.6.0
git push origin v1.6.0

# Update the floating v1 tag
git tag -f v1
git push -f origin v1

# Create GitHub release
gh release create v1.6.0 --title "v1.6.0" --notes "..."
```

Users can reference `@v1` to always get the latest v1.x release.

## Updating README Screenshots

The README includes screenshots showing annotations and the coverage summary comment. To update them:

1. **Create a demo PR** with intentionally uncovered code:
   ```bash
   jj new main -m "Demo: uncovered code for screenshots"
   ```
   Add a new file (e.g., `src/utils/demo.ts`) with some functions and partial test coverage. Push and create a PR.

2. **Wait for CI** to complete - it will create annotations and post a coverage comment.

3. **Take screenshots** using a browser:
   - Navigate to the PR's Files tab, find an annotation inline in the diff
   - Navigate to the PR's Conversation tab, find the coverage comment

4. **Crop the screenshots** to focus on the important parts:
   ```bash
   # Annotation: crop to show code context + annotation box
   convert annotation-full.png -crop 900x280+355+450 +repage docs/images/annotation.png
   
   # Summary comment: crop to show just the coverage table
   convert summary-full.png -crop 800x250+95+305 +repage docs/images/summary-comment.png
   ```
   Adjust coordinates based on actual screenshot dimensions.

5. **Update README** if image paths changed, commit, and push.

6. **Close the demo PR** without merging:
   ```bash
   gh pr close <PR_NUMBER> --delete-branch
   ```

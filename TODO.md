# TODO

Code review findings from consistency/simplification audit.

## High Priority (inconsistency with guidance)

- [ ] **Unused type-only import** - `action.ts` line 10 imports `type * as gitnotes` but only uses `gitnotes.Options`. Change to `import type {Options as GitNotesOptions} from './utils/gitnotes.ts'`.

- [ ] **Missing doc comments** - Several key types/functions lack doc comments per "full sentences starting with identifier" guidance:
  - `Client` class in `github.ts`
  - `calculateDiffStats` in `action.ts`
  - `DiffStats` interface in `action.ts`
  - Coverage parsing functions (`lcov.parse`, `cobertura.parse`, etc.)

- [ ] **Unusual DI pattern in baseline.ts** - Uses `Partial<typeof gitnotes>` for dependency injection. Since we use 4+ gitnotes functions, an explicit interface is appropriate, but it should be defined explicitly rather than using module type magic.

## Medium Priority (simplification)

- [ ] **Async functions doing sync I/O** - `lcov.ts`, `cobertura.ts`, `gocoverage.ts`, `simplecov.ts` all have `async function parse()` but use `fs.readFileSync`. Either make them sync or use `fs.promises.readFile`.

- [ ] **Extract helper functions from play()** - `action.ts` `play()` is ~350 lines. Consider extracting:
  - Input parsing into a separate function
  - PR comment posting logic
  - Step summary writing logic

- [ ] **Simplify Client constructor** - `github.ts` constructor has complex inline default creation. Could use a static factory method or extract defaults into helper functions.

## Low Priority (cleanup)

- [ ] **Generalize error-checking functions** - `isCommentError` and `isDiffTooLarge` in `github.ts` share structure. Could generalize to `isApiError(error, statuses, messagePatterns?)`.

- [ ] **Type definitions at bottom of file** - `general.ts` defines types at the bottom. More conventional to define types near the top or in a separate types file.

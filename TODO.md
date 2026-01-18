# TODO

Future improvements for the codecoverage action.

## Code Quality

- [x] Improve test coverage in baseline.ts
- [x] Review tests for opportunities to use "fakes, not mocks" (action tests use fakes via createFakeDeps; boundary mocks for @actions/* are appropriate)
- [x] Use @actions/github instead of direct octokit where possible (already using it)

## Features

- [x] Support 'master' branch for mode detection (mainBranch parameter is configurable)
- [x] Limit annotations to 10 per run (GitHub's reported limit)
- [x] Add switch to disable debug output (debug_output input)
- [x] Suppress debug output for large diffs (limit to 10 files, 1KB per line, compact ranges)
- [x] Optionally post summary as PR comment
  - Update existing comment on future runs
  - Handle PR being closed while action is running

## Bugs

- [x] Git notes push silently fails in CI (fixed: use fetch-write-push cycle)

# TODO

Future improvements for the codecoverage action.

## Code Quality

- [x] Improve test coverage in baseline.ts
- [ ] Review tests for opportunities to use "fakes, not mocks"
- [ ] Use @actions/github instead of direct octokit where possible

## Features

- [ ] Support 'master' branch for mode detection (wherever 'main' is supported)
- [ ] Limit annotations to 10 per run (GitHub's reported limit)
- [ ] Add switch to disable debug output
- [ ] Suppress debug output for large diffs (action isn't relevant for large merges)
- [ ] Optionally post summary as PR comment
  - Update existing comment on future runs
  - Handle PR being closed while action is running

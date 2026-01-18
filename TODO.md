# TODO

Future improvements for the codecoverage action.

## Code Quality

- [x] Improve test coverage in baseline.ts
- [x] Review tests for opportunities to use "fakes, not mocks" (action tests use fakes via createFakeDeps; boundary mocks for @actions/* are appropriate)
- [x] Use @actions/github instead of direct octokit where possible (already using it)

## Features

- [x] Support 'master' branch for mode detection (mainBranch parameter is configurable)
- [x] Limit annotations to 10 per run (GitHub's reported limit)
- [ ] Add switch to disable debug output
- [ ] Suppress debug output for large diffs (action isn't relevant for large merges)
- [ ] Optionally post summary as PR comment
  - Update existing comment on future runs
  - Handle PR being closed while action is running

## Bugs

- [ ] Git notes push silently fails in CI
  - Symptom: `baseline.store()` reports "Coverage baseline stored successfully" but the note doesn't appear on the remote
  - The `gitnotes.push()` function returns `true` (success) but the remote ref isn't updated
  - Observed: CI run 21104993097 on commit 5f00e2cc claimed success but note wasn't pushed; CI run 21105546644 on 600b8616 also failed silently
  - Working: Manual `git push origin refs/notes/coverage/main` from local machine works fine
  - Working: Earlier CI run 21104651220 on c693cee did successfully push
  - Hypothesis: Race condition, auth token issue, or git command not executing in correct directory
  - Potential fixes:
    1. Add logging of git push stdout/stderr
    2. Verify push by fetching and checking note exists after push
    3. Use `git push --force` for notes ref

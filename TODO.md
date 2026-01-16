# TODO

Future improvements for the codecoverage action.

## Graceful handling of large diffs

The GitHub API refuses to return diffs for very large PRs. Currently this causes the job to fail. We should catch this error and fail gracefully with a helpful message instead of crashing.

## Use notice instead of warning

Switch from `core.warning()` to `core.notice()` for annotations. Warnings imply something is wrong; notices are more appropriate for informational annotations about missing coverage.

## Handle completely uncovered files

If a file in the diff has zero coverage (no lines covered at all), instead of annotating every changed line:
- Leave a single notice on line 1 that the file isn't covered
- Skip annotating individual diff chunks

This reduces noise for files that clearly need tests written from scratch.

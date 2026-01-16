# TODO

Future improvements for the codecoverage action.

## ~~Graceful handling of large diffs~~ ✅

Done. The action now catches 403/406/422 errors from the diff API and warns gracefully instead of failing.

## ~~Use notice instead of warning~~ ✅

Done. Switched to `core.notice()` for annotations.

## ~~Handle completely uncovered files~~ ✅

Done. Files with zero coverage now get a single "This file has no test coverage" notice on line 1 instead of annotating every uncovered line.

## Use @actions/glob for file globbing

Replace the current globbing implementation with `@actions/glob` from the GitHub Actions toolkit. This is the standard library for glob patterns in Actions and would reduce dependencies.

See: https://github.com/actions/toolkit/tree/main/packages/glob

## Use @actions/core.summary for step summaries

Replace direct file writes to `GITHUB_STEP_SUMMARY` with `@actions/core.summary`. This provides a cleaner API for building markdown summaries with proper escaping and formatting helpers.

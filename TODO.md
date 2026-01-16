# TODO

Future improvements for the codecoverage action.

## ~~Graceful handling of large diffs~~ ✅

Done. The action now catches 403/406/422 errors from the diff API and warns gracefully instead of failing.

## ~~Use notice instead of warning~~ ✅

Done. Switched to `core.notice()` for annotations.

## ~~Handle completely uncovered files~~ ✅

Done. Files with zero coverage now get a single "This file has no test coverage" notice on line 1 instead of annotating every uncovered line.

## ~~Use @actions/glob for file globbing~~ ✅

Done. Replaced `glob` package with `@actions/glob` from the GitHub Actions toolkit.

## ~~Use @actions/core.summary for step summaries~~ ✅

Done. Replaced direct file writes with `core.summary.addRaw().write()`.

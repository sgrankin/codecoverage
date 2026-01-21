# TODO

Feature ideas from brainstorming session.

## ~~Baseline Lookback~~ ✅ DONE

Implemented in baseline.ts with `max_lookback` input (default 50).

## ~~SimpleCov JSON Support~~ ✅ DONE

Implemented in simplecov.ts. Supports both `coverage.json` and `.resultset.json` formats,
including merging multiple test suites and handling `"ignored"` lines.

## ~~Sparklines (Historical Trends)~~ ✅ DONE

Implemented in sparkline.ts. Shows coverage trend in summary:
```
Coverage: 85.5% (↑2.1%) ▂▃▅▄▆█
```

Configurable via `sparkline_count` input (default 10, set to 0 to disable).
Uses relative scaling with 5% minimum range to prevent tiny fluctuations from appearing dramatic.

## Not Doing

**Coverage thresholds/gates**: Prefer outputting numbers (`coverage_percentage`, `coverage_delta`, etc.) and letting separate policy tools (policybot, etc.) decide whether they meet quality gates. Separation of concerns.

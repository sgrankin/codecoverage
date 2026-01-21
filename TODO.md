# TODO

Feature ideas from brainstorming session.

## ~~Baseline Lookback~~ ✅ DONE

Implemented in baseline.ts with `max_lookback` input (default 50).

## ~~SimpleCov JSON Support~~ ✅ DONE

Implemented in simplecov.ts. Supports both `coverage.json` and `.resultset.json` formats,
including merging multiple test suites and handling `"ignored"` lines.

## Sparklines (Historical Trends)

Show coverage trend over recent commits in the summary.

```
Coverage: 85.5% (↑2.1%) ▂▃▅▄▆█
```

**Implementation:**
- Walk back through ancestor commits on the base branch
- Collect coverage percentages from commits that have notes
- Render as sparkline characters: ▁▂▃▄▅▆▇█
- Data already exists if storing baselines on push to main

**Data model:**
```
main:  A ← B ← C ← D ← E (each may have notes)
            ↑
       merge-base

Currently: read notes from C only
Sparkline: read notes from A, B, C, D, E → [82%, 83%, 85%, 84%, 86%] → ▂▃▅▄▆
```

## Shared Infrastructure

Both lookback and sparklines need the same underlying operation: walking ancestors and checking for notes. Lookback stops at first hit; sparklines collect N hits.

## Not Doing

**Coverage thresholds/gates**: Prefer outputting numbers (`coverage_percentage`, `coverage_delta`, etc.) and letting separate policy tools (policybot, etc.) decide whether they meet quality gates. Separation of concerns.

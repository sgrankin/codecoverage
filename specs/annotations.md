# PR Annotations

## Overview

The action creates GitHub PR annotations for uncovered lines that were added or modified in the pull request. This focuses developer attention on new code lacking tests, rather than overwhelming them with all uncovered code in the repository.

## Annotation Flow

1. **Parse coverage data** → Get list of uncovered lines per file
2. **Get PR diff** → Identify which lines were added/modified
3. **Intersect** → Find uncovered lines that are also in the PR diff
4. **Coalesce** → Group consecutive line ranges
5. **Annotate** → Create GitHub check run annotations

## Line Range Coalescing

Uncovered lines are coalesced into ranges to reduce annotation noise.

### Basic Coalescing

Consecutive uncovered lines become a single range:
- Lines `[10, 11, 12, 15, 16]` → Ranges `[{10-12}, {15-16}]`

### Gap Bridging

Small gaps containing only non-executable lines (comments, blank lines) are bridged:

```typescript
// Uncovered lines: [10, 11, 14, 15]
// Line 12 is a comment (not in executableLines)
// Line 13 is blank (not in executableLines)
// Result: Single range {10-15} instead of [{10-11}, {14-15}]
```

**Rules for gap bridging:**
- Maximum gap size: 5 lines (`MAX_BRIDGE_GAP`)
- All lines in the gap must be non-executable
- If any line in the gap is executable and covered, don't bridge

### Why Bridge Gaps?

Without bridging, annotations would fragment around comments:

```typescript
function example() {
  doSomething()     // uncovered - annotation 1
  // This is a comment explaining the next line
  doSomethingElse() // uncovered - annotation 2
}
```

With bridging, this becomes a single annotation covering the logical block.

## GitHub API Integration

Annotations are created via the GitHub Check Runs API:
- Endpoint: `POST /repos/{owner}/{repo}/check-runs`
- Annotation level: `warning`
- Maximum 50 annotations per API call (GitHub limit)

## Filtering by PR Diff

Only lines that appear in the PR diff are annotated:
- Uses GitHub's compare API to get the diff
- Parses unified diff format to extract added line ranges
- Intersects with uncovered lines to find relevant annotations

This ensures developers only see coverage issues for code they've touched.

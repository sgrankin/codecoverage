# Sparklines Feature Design

## Overview

Add a visual coverage history sparkline to PR summaries:

```
Coverage: 85.5% (↑2.1%) ▂▃▅▄▆█
```

The sparkline shows recent coverage trends at a glance, helping reviewers understand
if coverage is generally improving, declining, or stable.

---

## Design Decisions

### 1. Where should sparklines appear?

**Recommendation: Both step summary and PR comment**

Both use `summary.generate()`, so this is unified by default. The sparkline is
part of the coverage display string, keeping it consistent everywhere coverage
is shown.

### 2. How many data points?

**Recommendation: Default 10, configurable via `sparkline_count` input**

- 10 data points is enough to show meaningful trends without visual clutter
- Set to 0 to disable sparklines entirely
- Maximum reasonable value: ~30 (beyond that, individual blocks get hard to distinguish)

```yaml
- uses: your-action
  with:
    sparkline_count: 15  # Show last 15 coverage values
```

### 3. Scaling the sparkline

**Recommendation: Relative scale with minimum 5% range**

Relative scaling (min-max of data) better shows trends:
- If coverage is always 95-96%, relative scaling shows the 1% fluctuation clearly
- Absolute 0-100% scale would make this look flat and hide meaningful trends

**Minimum range rule:**
- If actual data range < 5%, expand the scale to 5% centered on the data
- This prevents tiny fluctuations from appearing as wild swings
- Example: data [95.0, 95.2, 95.1] → scale from 92.5 to 97.5

### 4. Edge cases

| Scenario | Behavior |
|----------|----------|
| Fewer data points than requested | Show what we have (even 2-3 points is useful) |
| Only 1 data point | Show single block, no sparkline trend |
| 0 data points | No sparkline displayed |
| Gaps in data (commits without notes) | Skip commits without notes, collect N actual data points |
| All same value | Show flat line at minimum height |
| Very small range (<0.1%) | Consider "stable" - show flat line |

---

## Architecture

### New Module: `src/utils/sparkline.ts`

Pure functions for sparkline rendering:

```typescript
// Sparkline characters: 8 levels of block height
export const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export interface RenderOptions {
  // Minimum range for scaling (prevents tiny fluctuations from appearing dramatic)
  // Default: 5.0
  minRange?: number
}

// render converts an array of values to a sparkline string.
// Values should be in chronological order (oldest first).
// Returns empty string if fewer than 2 values.
export function render(values: number[], options?: RenderOptions): string

// Example:
// render([80, 82, 85, 84, 86, 88]) → "▁▂▅▄▆█"
```

### Extension to `src/utils/baseline.ts`

New function to collect coverage history:

```typescript
export interface HistoryEntry {
  commit: string
  coveragePercentage: string
  timestamp: string
}

// collectHistory walks ancestors from startCommit and collects coverage data.
// Returns entries in chronological order (oldest first) for sparkline rendering.
// Stops when maxCount entries are found or no more ancestors exist.
export async function collectHistory(
  startCommit: string,
  maxCount: number,
  options: Partial<gitnotes.Options> = {}
): Promise<HistoryEntry[]>
```

**Algorithm:**
1. Use `listAncestors(startCommit, maxCount * 3)` to get candidate commits
   - Over-fetch because not all commits will have notes
2. For each commit, try to read and parse notes
3. Collect until we have `maxCount` entries or run out of ancestors
4. Reverse to chronological order (listAncestors returns newest-first)

### Changes to `src/utils/summary.ts`

Add optional sparkline to `Params`:

```typescript
export interface Params {
  // ... existing fields ...
  
  // coverageHistory is an array of historical coverage percentages.
  // Used to render a sparkline. Empty array = no sparkline.
  coverageHistory: number[]
}
```

Integrate sparkline into coverage display:

```typescript
let coverageDisplay = `${coveragePercentage}%`
if (coverageDelta) {
  coverageDisplay = baseline.formatWithDelta(coveragePercentage, coverageDelta)
}
if (params.coverageHistory.length >= 2) {
  coverageDisplay += ' ' + sparkline.render(params.coverageHistory)
}
```

### Changes to `src/action.ts`

New input and wiring:

```typescript
// New input
const sparklineCount = parseInt(core.getInput('sparkline_count') || '10', 10)

// After loading baseline, collect history if sparkline is enabled
let coverageHistory: number[] = []
if (sparklineCount > 0 && baselineResult.baseline) {
  const history = await baseline.collectHistory(
    baselineResult.commit!,
    sparklineCount,
    {cwd: workspacePath, namespace}
  )
  coverageHistory = history.map(h => parseFloat(h.coveragePercentage))
  // Add current coverage as the final (newest) point
  coverageHistory.push(parseFloat(coveragePercentage))
}

// Pass to summary generation
summary.generate({
  // ... existing params ...
  coverageHistory
})
```

---

## Visual Examples

### Normal trend (relative scaling)

Data: [82.5, 83.0, 83.2, 84.1, 84.0, 85.5]
```
Coverage: 85.5% (↑2.5%) ▁▂▃▅▅█
```

### Stable coverage (flat line)

Data: [95.2, 95.1, 95.2, 95.3, 95.2, 95.2]
```
Coverage: 95.2% (+0.0%) ▄▃▄▅▄▄
```

### Declining coverage

Data: [90.0, 89.5, 88.2, 87.0, 86.5, 85.0]
```
Coverage: 85.0% (↓5.0%) █▇▅▃▂▁
```

### Few data points (new repo)

Data: [80.0, 82.5]
```
Coverage: 82.5% (↑2.5%) ▁█
```

---

## Summary Table Rendering

The sparkline appears in the Coverage column:

```markdown
| Coverage | Baseline | Diff Only | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 85.5% (↑2.1%) ▂▃▅▄▆█ | 83.4% | 90.5% | 855 | 145 | 1000 | 50 |
```

This keeps the display compact while providing visual context.

---

## Test Plan

### Unit Tests: `sparkline.test.ts`

```typescript
describe('sparkline', () => {
  describe('render', () => {
    test('renders increasing values', () => {
      expect(render([0, 25, 50, 75, 100])).toBe('▁▃▄▆█')
    })
    
    test('renders decreasing values', () => {
      expect(render([100, 75, 50, 25, 0])).toBe('█▆▄▃▁')
    })
    
    test('renders flat values at minimum height', () => {
      expect(render([50, 50, 50])).toBe('▁▁▁')
    })
    
    test('returns empty string for single value', () => {
      expect(render([50])).toBe('')
    })
    
    test('returns empty string for empty array', () => {
      expect(render([])).toBe('')
    })
    
    test('applies minimum range', () => {
      // Data range is 0.5%, minRange is 5%
      // Should not fill entire height
      const result = render([95.0, 95.5], {minRange: 5})
      expect(result).not.toBe('▁█')  // Would be ▁█ without minRange
    })
    
    test('handles negative values gracefully', () => {
      // Edge case: shouldn't happen but handle gracefully
      expect(render([-10, 0, 10])).toBe('▁▄█')
    })
  })
})
```

### Unit Tests: `baseline.test.ts` (additions)

```typescript
describe('collectHistory', () => {
  test('collects coverage from multiple commits', async () => {
    // Create repo with multiple commits, each with coverage notes
    // Verify history is returned in chronological order
  })
  
  test('skips commits without notes', async () => {
    // Create repo where some commits have notes and some don't
    // Verify only commits with notes are included
  })
  
  test('returns empty array when no history exists', async () => {
    // Create repo with no notes
    // Verify empty array returned
  })
  
  test('limits to maxCount entries', async () => {
    // Create repo with more commits than requested
    // Verify only maxCount entries returned
  })
})
```

### Integration Test: `summary.test.ts` (additions)

```typescript
test('includes sparkline when history provided', () => {
  const result = summary.generate({
    // ... standard params ...
    coverageHistory: [80, 82, 85, 84, 86]
  })
  
  expect(result).toContain('▁▂█▆█')  // Or similar pattern
  expect(result).toContain('86%')     // Current coverage
})

test('omits sparkline when history is empty', () => {
  const result = summary.generate({
    // ... standard params ...
    coverageHistory: []
  })
  
  // Should not contain any sparkline characters
  expect(result).not.toMatch(/[▁▂▃▄▅▆▇█]/)
})
```

---

## Configuration Options

```yaml
inputs:
  sparkline_count:
    description: 'Number of historical data points to show in sparkline (0 to disable)'
    required: false
    default: '10'
```

---

## Implementation Order

1. **sparkline.ts** - Pure functions, easy to test in isolation
2. **sparkline.test.ts** - Comprehensive unit tests
3. **baseline.ts** - Add `collectHistory` function
4. **baseline.test.ts** - Add integration tests for history collection
5. **summary.ts** - Add sparkline to params and rendering
6. **summary.test.ts** - Add tests with history
7. **action.ts** - Wire up new input and pass history to summary
8. **action.yml** - Add new input documentation

---

## Open Questions

1. **Trend direction indicator?** Could add a small trend arrow before/after sparkline:
   ```
   85.5% (↑2.1%) ▂▃▅▄▆█ 📈
   ```
   But this might be redundant with the delta arrow. **Recommendation: No extra indicator.**

2. **Color?** GitHub markdown doesn't support colored text in tables. The emoji status
   (📈📉➖) already provides this signal. **Recommendation: No change needed.**

3. **Tooltip/title?** HTML title attributes don't work in GitHub markdown tables.
   Could add a details section with the raw numbers. **Recommendation: Keep it simple
   for now, add details section later if users request it.**

# Step Summary

## Overview

The action writes a summary to GitHub Actions step summary (`GITHUB_STEP_SUMMARY`), providing an overview of coverage metrics visible in the Actions UI.

## Configuration

- **Input**: `step_summary` (default: `true`)
- Set to `false` to disable summary output

## Summary Format

The summary is Markdown formatted with:

### 1. Status Emoji

When a baseline exists (delta available):
- 📈 Chart up: Coverage improved (delta > 0)
- ➖ Minus: Coverage unchanged (delta = 0)
- 📉 Chart down: Coverage decreased (delta < 0)

Without baseline (no delta):
- 🟢 Green: Coverage ≥ 80%
- 🟡 Yellow: Coverage ≥ 60%
- 🔴 Red: Coverage < 60%

### 2. Metrics Table (Horizontal)

A single-row table with all key metrics:

| Coverage | Baseline | Diff | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 85.50% (↑2.50%) | 83.00% | 92.5% | 855 | 145 | 1,000 | 10 |

- **Baseline**: Omitted when no baseline is available
- **Diff**: Coverage of lines changed in the PR (omitted on non-PR events)

### 3. Coverage by Package (Collapsible)

Wrapped in `<details>` for a compact display:

```html
<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 5 | 500 | 425 | 85.0% |
| src/utils | 3 | 300 | 270 | 90.0% |

</details>
```

## Package Grouping

Files are grouped by package for the summary table:

### Cobertura Format
Package name comes from the XML `<package name="...">` attribute.

### LCOV / Go Format
Package is derived from the file's directory path:
- `src/utils/foo.ts` → package `src/utils`
- `lib/bar.ts` → package `lib`
- `root.ts` → package `.`

## Example Output

```markdown
## 📈 Code Coverage Report

| Coverage | Baseline | Diff | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 85.50% (↑2.50%) | 83.00% | 92.5% | 855 | 145 | 1,000 | 10 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 5 | 500 | 425 | 85.0% |
| src/utils | 3 | 300 | 270 | 90.0% |
| lib | 2 | 200 | 160 | 80.0% |

</details>
```

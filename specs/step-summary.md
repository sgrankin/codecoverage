# Step Summary

## Overview

The action writes a summary to GitHub Actions step summary (`GITHUB_STEP_SUMMARY`), providing an overview of coverage metrics visible in the Actions UI.

## Configuration

- **Input**: `STEP_SUMMARY` (default: `true`)
- Set to `false` to disable summary output
- Summary is written by appending to the file at `$GITHUB_STEP_SUMMARY`

## Summary Format

The summary is Markdown formatted with:

### 1. Status Emoji

- 🟢 Green: Coverage ≥ 80%
- 🟡 Yellow: Coverage ≥ 60%
- 🔴 Red: Coverage < 60%

### 2. Metrics Table

| Metric | Value |
| ------ | ----- |
| **Coverage** | 85.50% |
| **Covered Lines** | 855 |
| **Uncovered Lines** | 145 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 10 |

### 3. Annotation Status

One of:
- "✅ No new uncovered lines detected in this PR."
- "⚠️ **N annotation(s)** added for uncovered lines in this PR."

### 4. Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| src | 5 | 500 | 425 | 85.0% |
| src/utils | 3 | 300 | 270 | 90.0% |
| lib | 2 | 200 | 160 | 80.0% |

## Package Grouping

Files are grouped by package for the summary table:

### Cobertura Format
Package name comes from the XML `<package name="...">` attribute.

### LCOV / Go Format
Package is derived from the file's directory path:
- `src/utils/foo.ts` → package `src/utils`
- `lib/bar.ts` → package `lib`
- `root.ts` → package `.`

This uses the **full directory path**, not just the first segment, to avoid grouping unrelated files from different nested directories.

## Example Output

```markdown
## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 85.50% |
| **Covered Lines** | 855 |
| **Uncovered Lines** | 145 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 10 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| src | 5 | 500 | 425 | 85.0% |
| src/utils | 3 | 300 | 270 | 90.0% |
| lib | 2 | 200 | 160 | 80.0% |
```

import {expect, test} from 'vitest'
import * as summary from '../../src/utils/summary'

const testCases = [
  {
    name: 'high coverage with no annotations',
    input: {
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      filesAnalyzed: 2,
      annotationCount: 0,
      files: [
        {file: 'src/utils.ts', totalLines: 500, coveredLines: 450},
        {file: 'src/main.ts', totalLines: 500, coveredLines: 405}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 85.50% |
| **Covered Lines** | 855 |
| **Uncovered Lines** | 145 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 2 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 2 | 1,000 | 855 | 85.5% |
`
  },
  {
    name: 'medium coverage with multiple annotations',
    input: {
      coveragePercentage: '65.00',
      totalLines: 100,
      coveredLines: 65,
      filesAnalyzed: 1,
      annotationCount: 3,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 65}]
    },
    expected: `## 🟡 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 65.00% |
| **Covered Lines** | 65 |
| **Uncovered Lines** | 35 |
| **Total Lines** | 100 |
| **Files Analyzed** | 1 |

⚠️ **3 annotations** added for uncovered lines in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 100 | 65 | 65.0% |
`
  },
  {
    name: 'low coverage with single annotation',
    input: {
      coveragePercentage: '45.00',
      totalLines: 100,
      coveredLines: 45,
      filesAnalyzed: 1,
      annotationCount: 1,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 45}]
    },
    expected: `## 🔴 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 45.00% |
| **Covered Lines** | 45 |
| **Uncovered Lines** | 55 |
| **Total Lines** | 100 |
| **Files Analyzed** | 1 |

⚠️ **1 annotation** added for uncovered lines in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 100 | 45 | 45.0% |
`
  },
  {
    name: 'files grouped by package and sorted',
    input: {
      coveragePercentage: '80.00',
      totalLines: 300,
      coveredLines: 240,
      filesAnalyzed: 3,
      annotationCount: 0,
      files: [
        {file: 'src/utils/zebra.ts', totalLines: 100, coveredLines: 80},
        {file: 'src/alpha.ts', totalLines: 100, coveredLines: 80},
        {file: 'lib/beta.ts', totalLines: 100, coveredLines: 80}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 80.00% |
| **Covered Lines** | 240 |
| **Uncovered Lines** | 60 |
| **Total Lines** | 300 |
| **Files Analyzed** | 3 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| lib | 1 | 100 | 80 | 80.0% |
| src | 1 | 100 | 80 | 80.0% |
| src/utils | 1 | 100 | 80 | 80.0% |
`
  },
  {
    name: 'uses explicit package when provided (cobertura)',
    input: {
      coveragePercentage: '75.00',
      totalLines: 200,
      coveredLines: 150,
      filesAnalyzed: 2,
      annotationCount: 0,
      files: [
        {file: 'src/foo.ts', totalLines: 100, coveredLines: 80, package: 'com.example.foo'},
        {file: 'src/bar.ts', totalLines: 100, coveredLines: 70, package: 'com.example.bar'}
      ]
    },
    expected: `## 🟡 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 75.00% |
| **Covered Lines** | 150 |
| **Uncovered Lines** | 50 |
| **Total Lines** | 200 |
| **Files Analyzed** | 2 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| com.example.bar | 1 | 100 | 70 | 70.0% |
| com.example.foo | 1 | 100 | 80 | 80.0% |
`
  },
  {
    name: 'coverage with positive delta',
    input: {
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      filesAnalyzed: 1,
      annotationCount: 0,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 855}],
      coverageDelta: '+2.50',
      baselinePercentage: '83.00'
    },
    expected: `## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 85.50% (↑2.50%) |
| **Baseline** | 83.00% |
| **Covered Lines** | 855 |
| **Uncovered Lines** | 145 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 1 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 855 | 85.5% |
`
  },
  {
    name: 'coverage with negative delta',
    input: {
      coveragePercentage: '78.00',
      totalLines: 1000,
      coveredLines: 780,
      filesAnalyzed: 1,
      annotationCount: 3,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 780}],
      coverageDelta: '-2.00',
      baselinePercentage: '80.00'
    },
    expected: `## 🟡 Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | 78.00% (↓2.00%) |
| **Baseline** | 80.00% |
| **Covered Lines** | 780 |
| **Uncovered Lines** | 220 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 1 |

⚠️ **3 annotations** added for uncovered lines in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 780 | 78.0% |
`
  }
]

test.each(testCases)('generate: $name', ({input, expected}) => {
  const result = summary.generate(input)
  expect(result).toBe(expected)
})

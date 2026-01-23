import {expect, test} from 'vitest'
import * as summary from '../../src/utils/summary.ts'

// Default values for optional fields
const defaults = {
  coverageDelta: '',
  baselinePercentage: '',
  diffCoveredLines: 0,
  diffTotalLines: 0,
  coverageHistory: [],
  headerText: ''
}

const testCases = [
  {
    name: 'high coverage',
    input: {
      ...defaults,
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      filesAnalyzed: 2,
      files: [
        {file: 'src/utils.ts', totalLines: 500, coveredLines: 450},
        {file: 'src/main.ts', totalLines: 500, coveredLines: 405}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 85.50% | 855 | 145 | 1,000 | 2 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 2 | 1,000 | 855 | 85.5% |

</details>
`
  },
  {
    name: 'medium coverage',
    input: {
      ...defaults,
      coveragePercentage: '65.00',
      totalLines: 100,
      coveredLines: 65,
      filesAnalyzed: 1,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 65}]
    },
    expected: `## 🟡 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 65.00% | 65 | 35 | 100 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 100 | 65 | 65.0% |

</details>
`
  },
  {
    name: 'low coverage',
    input: {
      ...defaults,
      coveragePercentage: '45.00',
      totalLines: 100,
      coveredLines: 45,
      filesAnalyzed: 1,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 45}]
    },
    expected: `## 🔴 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 45.00% | 45 | 55 | 100 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 100 | 45 | 45.0% |

</details>
`
  },
  {
    name: 'files grouped by package and sorted',
    input: {
      ...defaults,
      coveragePercentage: '80.00',
      totalLines: 300,
      coveredLines: 240,
      filesAnalyzed: 3,
      files: [
        {file: 'src/utils/zebra.ts', totalLines: 100, coveredLines: 80},
        {file: 'src/alpha.ts', totalLines: 100, coveredLines: 80},
        {file: 'lib/beta.ts', totalLines: 100, coveredLines: 80}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 80.00% | 240 | 60 | 300 | 3 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| lib | 1 | 100 | 80 | 80.0% |
| src | 1 | 100 | 80 | 80.0% |
| src/utils | 1 | 100 | 80 | 80.0% |

</details>
`
  },
  {
    name: 'uses explicit package when provided (cobertura)',
    input: {
      ...defaults,
      coveragePercentage: '75.00',
      totalLines: 200,
      coveredLines: 150,
      filesAnalyzed: 2,
      files: [
        {file: 'src/foo.ts', totalLines: 100, coveredLines: 80, package: 'com.example.foo'},
        {file: 'src/bar.ts', totalLines: 100, coveredLines: 70, package: 'com.example.bar'}
      ]
    },
    expected: `## 🟡 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 75.00% | 150 | 50 | 200 | 2 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| com.example.bar | 1 | 100 | 70 | 70.0% |
| com.example.foo | 1 | 100 | 80 | 80.0% |

</details>
`
  },
  {
    name: 'coverage with positive delta',
    input: {
      ...defaults,
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 855}],
      coverageDelta: '+2.50',
      baselinePercentage: '83.00'
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 85.50% (↑2.50%) | 83.00% | 855 | 145 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 855 | 85.5% |

</details>
`
  },
  {
    name: 'coverage with negative delta',
    input: {
      ...defaults,
      coveragePercentage: '78.00',
      totalLines: 1000,
      coveredLines: 780,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 780}],
      coverageDelta: '-2.00',
      baselinePercentage: '80.00'
    },
    expected: `## 📉 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 78.00% (↓2.00%) | 80.00% | 780 | 220 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 780 | 78.0% |

</details>
`
  },
  {
    name: 'coverage with zero delta',
    input: {
      ...defaults,
      coveragePercentage: '75.00',
      totalLines: 1000,
      coveredLines: 750,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 750}],
      coverageDelta: '+0.00',
      baselinePercentage: '75.00'
    },
    expected: `## ➖ Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 75.00% (0.00%) | 75.00% | 750 | 250 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 750 | 75.0% |

</details>
`
  },
  {
    name: 'low coverage but improving (chart up)',
    input: {
      ...defaults,
      coveragePercentage: '45.00',
      totalLines: 1000,
      coveredLines: 450,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 450}],
      coverageDelta: '+5.00',
      baselinePercentage: '40.00'
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 45.00% (↑5.00%) | 40.00% | 450 | 550 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 450 | 45.0% |

</details>
`
  },
  {
    name: 'with diff coverage',
    input: {
      ...defaults,
      coveragePercentage: '80.00',
      totalLines: 1000,
      coveredLines: 800,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 800}],
      diffCoveredLines: 45,
      diffTotalLines: 50
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Diff Only | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 80.00% | 90.0% | 800 | 200 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 800 | 80.0% |

</details>
`
  },
  {
    name: 'with baseline and diff coverage',
    input: {
      ...defaults,
      coveragePercentage: '85.00',
      totalLines: 1000,
      coveredLines: 850,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 850}],
      coverageDelta: '+5.00',
      baselinePercentage: '80.00',
      diffCoveredLines: 100,
      diffTotalLines: 100
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Diff Only | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 85.00% (↑5.00%) | 80.00% | 100.0% | 850 | 150 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 850 | 85.0% |

</details>
`
  },
  {
    name: 'custom header text',
    input: {
      ...defaults,
      coveragePercentage: '85.00',
      totalLines: 1000,
      coveredLines: 850,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 850}],
      headerText: 'Test Coverage Summary'
    },
    expected: `## 🟢 Test Coverage Summary

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 85.00% | 850 | 150 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
| src | 1 | 1,000 | 850 | 85.0% |

</details>
`
  }
]

test.each(testCases)('generate: $name', ({input, expected}) => {
  const result = summary.generate(input)
  expect(result).toBe(expected)
})

const sparklineTestCases = [
  {
    name: 'increasing coverage',
    coverageHistory: [80, 82, 83, 84, 85],
    expectedSparkline: '▁▄▅▇█'
  },
  {
    name: 'decreasing coverage',
    coverageHistory: [90, 88, 86, 84, 82],
    expectedSparkline: '█▆▄▂▁'
  },
  {
    name: 'stable coverage (flat)',
    coverageHistory: [85, 85, 85],
    expectedSparkline: '▄▄▄'
  },
  {
    name: 'empty history',
    coverageHistory: [],
    expectedSparkline: ''
  },
  {
    name: 'single point (no sparkline)',
    coverageHistory: [85],
    expectedSparkline: ''
  },
  {
    name: 'undefined history',
    coverageHistory: undefined,
    expectedSparkline: ''
  }
]

test.each(sparklineTestCases)('sparkline: $name', ({coverageHistory, expectedSparkline}) => {
  const result = summary.generate({
    coveragePercentage: '85.00',
    totalLines: 1000,
    coveredLines: 850,
    filesAnalyzed: 1,
    files: [{file: 'src/main.ts', totalLines: 1000, coveredLines: 850, package: ''}],
    coverageDelta: '+5.00',
    baselinePercentage: '80.00',
    diffCoveredLines: 0,
    diffTotalLines: 0,
    coverageHistory: coverageHistory as number[],
    headerText: ''
  })

  if (expectedSparkline) {
    expect(result).toContain(expectedSparkline)
  } else {
    expect(result).not.toMatch(/[\u2800-\u28FF]/)
  }
  expect(result).toContain('85.00%')
})

import {expect, test} from 'vitest'
import type {BaselineInfo, CoverageStats, DiffStats, FileCoverage} from '../../src/utils/summary.ts'
import * as summary from '../../src/utils/summary.ts'

// Helper to build Params from flat test data
function makeParams(opts: {
  coveragePercentage: string
  total: number
  covered: number
  filesAnalyzed: number
  files: Omit<FileCoverage, 'package'>[]
  coverageDelta?: string
  baselinePercentage?: string
  diffCoveredLines?: number
  diffTotalLines?: number
  coverageHistory?: number[]
  headerText?: string
  footnote?: string
}): summary.Params {
  const coverage: CoverageStats = {
    percentage: opts.coveragePercentage,
    total: opts.total,
    covered: opts.covered,
    filesAnalyzed: opts.filesAnalyzed,
    files: opts.files.map(f => ({...f, package: (f as FileCoverage).package ?? ''})),
    footnote: opts.footnote ?? ''
  }
  const baseline: BaselineInfo = {
    delta: opts.coverageDelta ?? '',
    percentage: opts.baselinePercentage ?? '',
    history: opts.coverageHistory ?? []
  }
  const diff: DiffStats = {
    coveredLines: opts.diffCoveredLines ?? 0,
    totalLines: opts.diffTotalLines ?? 0
  }
  return {coverage, baseline, diff, headerText: opts.headerText ?? ''}
}

const testCases = [
  {
    name: 'high coverage',
    input: {
      coveragePercentage: '85.50',
      total: 1000,
      covered: 855,
      filesAnalyzed: 2,
      files: [
        {file: 'src/utils.ts', total: 500, covered: 450},
        {file: 'src/main.ts', total: 500, covered: 405}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 85.50% | 855 | 145 | 1,000 | 2 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (145)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 2 | 1,000 | 855 | \`█████████████████████░░░\` 85.5% |

</details>
`
  },
  {
    name: 'medium coverage',
    input: {
      coveragePercentage: '65.00',
      total: 100,
      covered: 65,
      filesAnalyzed: 1,
      files: [{file: 'src/app.ts', total: 100, covered: 65}]
    },
    expected: `## 🟡 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 65.00% | 65 | 35 | 100 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (35)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 100 | 65 | \`████████████████░░░░░░░░\` 65.0% |

</details>
`
  },
  {
    name: 'low coverage',
    input: {
      coveragePercentage: '45.00',
      total: 100,
      covered: 45,
      filesAnalyzed: 1,
      files: [{file: 'src/app.ts', total: 100, covered: 45}]
    },
    expected: `## 🔴 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 45.00% | 45 | 55 | 100 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (55)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 100 | 45 | \`███████████░░░░░░░░░░░░░\` 45.0% |

</details>
`
  },
  {
    name: 'files grouped by package and sorted',
    input: {
      coveragePercentage: '80.00',
      total: 300,
      covered: 240,
      filesAnalyzed: 3,
      files: [
        {file: 'src/utils/zebra.ts', total: 100, covered: 80},
        {file: 'src/alpha.ts', total: 100, covered: 80},
        {file: 'lib/beta.ts', total: 100, covered: 80}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 80.00% | 240 | 60 | 300 | 3 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** lib (20) · src (20) · src/utils (20)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| lib | 1 | 100 | 80 | \`███████████████████░░░░░\` 80.0% |
| src | 1 | 100 | 80 | \`███████████████████░░░░░\` 80.0% |
| src/utils | 1 | 100 | 80 | \`███████████████████░░░░░\` 80.0% |

</details>
`
  },
  {
    name: 'uses explicit package when provided (cobertura)',
    input: {
      coveragePercentage: '75.00',
      total: 200,
      covered: 150,
      filesAnalyzed: 2,
      files: [
        {file: 'src/foo.ts', total: 100, covered: 80, package: 'com.example.foo'},
        {file: 'src/bar.ts', total: 100, covered: 70, package: 'com.example.bar'}
      ]
    },
    expected: `## 🟡 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 75.00% | 150 | 50 | 200 | 2 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** com.example.bar (30) · com.example.foo (20)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| com.example.bar | 1 | 100 | 70 | \`█████████████████░░░░░░░\` 70.0% |
| com.example.foo | 1 | 100 | 80 | \`███████████████████░░░░░\` 80.0% |

</details>
`
  },
  {
    name: 'coverage with positive delta',
    input: {
      coveragePercentage: '85.50',
      total: 1000,
      covered: 855,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 855}],
      coverageDelta: '+2.50',
      baselinePercentage: '83.00'
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 85.50% (↑2.50%) | 83.00% | 855 | 145 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (145)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 855 | \`█████████████████████░░░\` 85.5% |

</details>
`
  },
  {
    name: 'coverage with negative delta',
    input: {
      coveragePercentage: '78.00',
      total: 1000,
      covered: 780,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 780}],
      coverageDelta: '-2.00',
      baselinePercentage: '80.00'
    },
    expected: `## 📉 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 78.00% (↓2.00%) | 80.00% | 780 | 220 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (220)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 780 | \`███████████████████░░░░░\` 78.0% |

</details>
`
  },
  {
    name: 'coverage with zero delta',
    input: {
      coveragePercentage: '75.00',
      total: 1000,
      covered: 750,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 750}],
      coverageDelta: '+0.00',
      baselinePercentage: '75.00'
    },
    expected: `## ➖ Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 75.00% (0.00%) | 75.00% | 750 | 250 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (250)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 750 | \`██████████████████░░░░░░\` 75.0% |

</details>
`
  },
  {
    name: 'low coverage but improving (chart up)',
    input: {
      coveragePercentage: '45.00',
      total: 1000,
      covered: 450,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 450}],
      coverageDelta: '+5.00',
      baselinePercentage: '40.00'
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 45.00% (↑5.00%) | 40.00% | 450 | 550 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (550)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 450 | \`███████████░░░░░░░░░░░░░\` 45.0% |

</details>
`
  },
  {
    name: 'with diff coverage',
    input: {
      coveragePercentage: '80.00',
      total: 1000,
      covered: 800,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 800}],
      diffCoveredLines: 45,
      diffTotalLines: 50
    },
    expected: `## 🟢 Code Coverage Report

| Coverage | Diff Only | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| 80.00% | 90.0% | 800 | 200 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (200)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 800 | \`███████████████████░░░░░\` 80.0% |

</details>
`
  },
  {
    name: 'with baseline and diff coverage',
    input: {
      coveragePercentage: '85.00',
      total: 1000,
      covered: 850,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 850}],
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

**Most uncovered:** src (150)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 850 | \`████████████████████░░░░\` 85.0% |

</details>
`
  },
  {
    name: 'custom header text',
    input: {
      coveragePercentage: '85.00',
      total: 1000,
      covered: 850,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 850}],
      headerText: 'Test Coverage Summary'
    },
    expected: `## 🟢 Test Coverage Summary

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 85.00% | 850 | 150 | 1,000 | 1 |

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** src (150)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| src | 1 | 1,000 | 850 | \`████████████████████░░░░\` 85.0% |

</details>
`
  },
  {
    name: 'footnote without baseline (Go statement coverage)',
    input: {
      coveragePercentage: '45.00',
      total: 20,
      covered: 9,
      filesAnalyzed: 1,
      files: [{file: 'pkg/main.go', total: 20, covered: 9}],
      footnote: 'Statement coverage; line coverage is 43.33%.'
    },
    expected: `## 🔴 Code Coverage Report

| Coverage | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: |
| 45.00% | 9 | 11 | 20 | 1 |

<sub>Statement coverage; line coverage is 43.33%.</sub>

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** pkg (11)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| pkg | 1 | 20 | 9 | \`███████████░░░░░░░░░░░░░\` 45.0% |

</details>
`
  },
  {
    name: 'footnote with delta and sparkline (Go statement coverage)',
    input: {
      coveragePercentage: '72.26',
      total: 1000,
      covered: 723,
      filesAnalyzed: 1,
      files: [{file: 'pkg/main.go', total: 1000, covered: 723}],
      coverageDelta: '+1.26',
      baselinePercentage: '71.00',
      coverageHistory: [70, 71, 72.26],
      footnote: 'Statement coverage; line coverage is 72.97%.'
    },
    expected: `## 📈 Code Coverage Report

| Coverage | Baseline | Covered | Uncovered | Total | Files |
| ----: | ----: | ----: | ----: | ----: | ----: |
| \`▃▄▆\` 72.26% (↑1.26%) | 71.00% | 723 | 277 | 1,000 | 1 |

<sub>Statement coverage; line coverage is 72.97%.</sub>

<details>
<summary>Coverage by Package</summary>

**Most uncovered:** pkg (277)

| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
| pkg | 1 | 1,000 | 723 | \`█████████████████░░░░░░░\` 72.3% |

</details>
`
  }
]

test.each(testCases)('generate: $name', ({input, expected}) => {
  const result = summary.generate(makeParams(input))
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

test('package bar: tiny nonzero segments never round away', () => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '99.90',
      total: 1000,
      covered: 999,
      filesAnalyzed: 2,
      files: [
        {file: 'big/a.ts', total: 999, covered: 999},
        {file: 'tiny/b.ts', total: 1, covered: 0}
      ]
    })
  )
  // 1 uncovered statement in tiny/ rounds to a visible 1-char hole; its 0
  // covered statements produce no solid segment.
  expect(result).toContain('| tiny | 1 | 1 | 0 | `░` 0.0% |')
  // big/ is fully covered: no light run.
  expect(result).toContain('| big | 1 | 999 | 999 | `████████████████████████` 100.0% |')
  expect(result).toContain('**Most uncovered:** tiny (1)')
})

test.each([
  // Both segments landing on .5 boundaries must not round up past the width.
  {total: 16, covered: 1, bar: `${'█'.repeat(2)}${'░'.repeat(22)}`},
  {total: 48, covered: 25, bar: `${'█'.repeat(13)}${'░'.repeat(11)}`}
])('package bar: largest package is exactly 24 chars (total=$total covered=$covered)', ({
  total,
  covered,
  bar
}) => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '50.00',
      total,
      covered,
      filesAnalyzed: 1,
      files: [{file: 'src/a.ts', total, covered}]
    })
  )
  expect(result).toContain(`\`${bar}\``)
})

test('package bar: covered exceeding total renders a full bar instead of crashing', () => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '150.00',
      total: 100,
      covered: 150,
      filesAnalyzed: 1,
      files: [{file: 'src/a.ts', total: 100, covered: 150}]
    })
  )
  expect(result).toContain(`\`${'█'.repeat(24)}\` 150.0%`)
})

test('package bar: zero-total package renders percent only', () => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '100.00',
      total: 10,
      covered: 10,
      filesAnalyzed: 2,
      files: [
        {file: 'src/a.ts', total: 10, covered: 10},
        {file: 'empty/b.ts', total: 0, covered: 0}
      ]
    })
  )
  expect(result).toContain('| empty | 1 | 0 | 0 | 0.0% |')
})

test('most-uncovered strip: caps at five packages, ordered by hole size', () => {
  const files = [1, 2, 3, 4, 5, 6, 7].map(n => ({
    file: `p${n}/a.ts`,
    total: 100,
    covered: 100 - n * 10
  }))
  const result = summary.generate(
    makeParams({
      coveragePercentage: '60.00',
      total: 700,
      covered: 420,
      filesAnalyzed: 7,
      files
    })
  )
  expect(result).toContain('**Most uncovered:** p7 (70) · p6 (60) · p5 (50) · p4 (40) · p3 (30)')
  expect(result).not.toContain('p2 (20)')
})

test('most-uncovered strip: absent when everything is covered', () => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '100.00',
      total: 100,
      covered: 100,
      filesAnalyzed: 1,
      files: [{file: 'src/a.ts', total: 100, covered: 100}]
    })
  )
  expect(result).not.toContain('Most uncovered')
})

test.each(sparklineTestCases)('sparkline: $name', ({coverageHistory, expectedSparkline}) => {
  const result = summary.generate(
    makeParams({
      coveragePercentage: '85.00',
      total: 1000,
      covered: 850,
      filesAnalyzed: 1,
      files: [{file: 'src/main.ts', total: 1000, covered: 850}],
      coverageDelta: '+5.00',
      baselinePercentage: '80.00',
      coverageHistory: coverageHistory as number[]
    })
  )

  if (expectedSparkline) {
    expect(result).toContain(expectedSparkline)
  } else {
    expect(result).not.toMatch(/[\u2800-\u28FF]/)
  }
  expect(result).toContain('85.00%')
})

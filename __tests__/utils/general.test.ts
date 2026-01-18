import {test, expect} from 'vitest'
import {getFixturePath} from '../fixtures/util'
import * as lcov from '../../src/utils/lcov'
import * as coverage from '../../src/utils/general'

test('filterByFile', async function () {
  const path = getFixturePath('lcov.info')
  const parsedLcov = await lcov.parse(path, '')
  const output = coverage.filterByFile(parsedLcov)
  expect(output).toMatchSnapshot()
})

const coalesceTestCases = [
  {
    name: 'basic coalescing without executable info',
    lines: [1, 3, 4, 5, 10, 12, 13],
    executableLines: undefined,
    expected: [
      {start_line: 1, end_line: 1},
      {start_line: 3, end_line: 5},
      {start_line: 10, end_line: 10},
      {start_line: 12, end_line: 13}
    ]
  },
  {
    name: 'empty input',
    lines: [],
    executableLines: undefined,
    expected: []
  },
  {
    name: 'bridges non-executable lines',
    lines: [10, 11, 13, 14], // line 12 is a comment
    executableLines: new Set([10, 11, 13, 14]),
    expected: [{start_line: 10, end_line: 14}]
  },
  {
    name: 'does not bridge covered lines',
    lines: [10, 11, 13, 14], // line 12 is covered
    executableLines: new Set([10, 11, 12, 13, 14]),
    expected: [
      {start_line: 10, end_line: 11},
      {start_line: 13, end_line: 14}
    ]
  },
  {
    name: 'handles multiple small gaps',
    lines: [5, 6, 8, 9, 11, 12], // lines 7, 10 are comments
    executableLines: new Set([5, 6, 8, 9, 11, 12]),
    expected: [{start_line: 5, end_line: 12}]
  },
  {
    name: 'handles mixed gaps (some bridgeable, some not)',
    lines: [1, 2, 4, 5, 8, 9], // line 3 non-exec, lines 6-7 covered
    executableLines: new Set([1, 2, 4, 5, 6, 7, 8, 9]),
    expected: [
      {start_line: 1, end_line: 5},
      {start_line: 8, end_line: 9}
    ]
  },
  {
    name: 'does not bridge large gaps (> MAX_BRIDGE_GAP)',
    lines: [1, 2, 10, 11], // lines 3-9 are non-executable but gap too large
    executableLines: new Set([1, 2, 10, 11]),
    expected: [
      {start_line: 1, end_line: 2},
      {start_line: 10, end_line: 11}
    ]
  }
]

test.each(coalesceTestCases)('coalesce: $name', ({lines, executableLines, expected}) => {
  const result = executableLines
    ? coverage.coalesceWithGaps(lines, executableLines)
    : coverage.coalesce(lines)
  expect(result).toEqual(expected)
})

test('range intersections', function () {
  const a = [
    {start_line: 1, end_line: 4},
    {start_line: 7, end_line: 9},
    {start_line: 132, end_line: 132},
    {start_line: 134, end_line: 136}
  ]
  const b = [
    {start_line: 2, end_line: 3},
    {start_line: 5, end_line: 7},
    {start_line: 9, end_line: 11},
    {start_line: 132, end_line: 139}
  ]
  const expected = [
    {start_line: 2, end_line: 3},
    {start_line: 7, end_line: 7},
    {start_line: 9, end_line: 9},
    {start_line: 132, end_line: 132},
    {start_line: 134, end_line: 136}
  ]

  expect(coverage.intersectRanges(a, b)).toEqual(expected)
})

test('mergeByFile merges multiple entries for same file', function () {
  const cov = [
    {
      file: 'src/foo.ts',
      title: 'foo',
      lines: {
        found: 3,
        hit: 1,
        details: [
          {line: 10, hit: 1},
          {line: 20, hit: 0},
          {line: 30, hit: 0}
        ]
      }
    },
    {
      file: 'src/foo.ts', // Same file, different coverage
      title: 'foo',
      lines: {
        found: 3,
        hit: 2,
        details: [
          {line: 10, hit: 0},
          {line: 20, hit: 1},
          {line: 40, hit: 1} // New line not in first entry
        ]
      }
    },
    {
      file: 'src/bar.ts', // Different file
      title: 'bar',
      lines: {
        found: 1,
        hit: 0,
        details: [{line: 5, hit: 0}]
      }
    }
  ]

  const merged = coverage.mergeByFile(cov)

  expect(merged).toHaveLength(2)

  const foo = merged.find(e => e.file === 'src/foo.ts')!
  expect(foo).toBeDefined()
  // Line 10: max(1, 0) = 1
  // Line 20: max(0, 1) = 1
  // Line 30: max(0, undefined) = 0
  // Line 40: max(undefined, 1) = 1
  expect(foo.lines.details).toEqual([
    {line: 10, hit: 1},
    {line: 20, hit: 1},
    {line: 30, hit: 0},
    {line: 40, hit: 1}
  ])

  const bar = merged.find(e => e.file === 'src/bar.ts')!
  expect(bar).toBeDefined()
  expect(bar.lines.details).toEqual([{line: 5, hit: 0}])
})

test('mergeByFile handles partial coverage correctly', function () {
  // Simulates the real bug: one test run has coverage, another has zero
  const cov = [
    {
      file: 'src/helper.cs',
      title: 'helper',
      lines: {
        found: 5,
        hit: 5,
        details: [
          {line: 266, hit: 1},
          {line: 267, hit: 1},
          {line: 268, hit: 1},
          {line: 269, hit: 1},
          {line: 270, hit: 1}
        ]
      }
    },
    {
      file: 'src/helper.cs',
      title: 'helper',
      lines: {
        found: 5,
        hit: 0, // Zero coverage in this run
        details: [
          {line: 266, hit: 0},
          {line: 267, hit: 0},
          {line: 268, hit: 0},
          {line: 269, hit: 0},
          {line: 270, hit: 0}
        ]
      }
    }
  ]

  const merged = coverage.mergeByFile(cov)

  expect(merged).toHaveLength(1)
  const helper = merged[0]
  // All lines should show as covered (max of 1 and 0 = 1)
  expect(helper.lines.details.every(d => d.hit === 1)).toBe(true)
})

test('correctTotals', function () {
  const mockCoverage = [
    {
      file: 'test.ts',
      title: 'Test File',
      lines: {
        found: 0, // Incorrect initial value
        hit: 0, // Incorrect initial value
        details: [
          {line: 1, hit: 1, name: 'line1'},
          {line: 2, hit: 0, name: 'line2'},
          {line: 3, hit: 2, name: 'line3'},
          {line: 4, hit: 0, name: 'line4'}
        ]
      }
    }
  ]

  const result = coverage.correctTotals(mockCoverage)
  expect(result[0].lines.found).toBe(4)
  expect(result[0].lines.hit).toBe(2)
  expect(result[0].file).toBe('test.ts')
  expect(result[0].title).toBe('Test File')

  // Test with multiple files
  const multiFileMock = [
    {
      file: 'file1.ts',
      title: 'File 1',
      lines: {
        found: 0,
        hit: 0,
        details: [
          {line: 1, hit: 1, name: 'line1'},
          {line: 2, hit: 1, name: 'line2'}
        ]
      }
    },
    {
      file: 'file2.ts',
      title: 'File 2',
      lines: {
        found: 0,
        hit: 0,
        details: [
          {line: 1, hit: 0, name: 'line1'},
          {line: 2, hit: 0, name: 'line2'},
          {line: 3, hit: 1, name: 'line3'}
        ]
      }
    }
  ]

  const multiResult = coverage.correctTotals(multiFileMock)
  expect(multiResult[0].lines.found).toBe(2)
  expect(multiResult[0].lines.hit).toBe(2)
  expect(multiResult[1].lines.found).toBe(3)
  expect(multiResult[1].lines.hit).toBe(1)
})

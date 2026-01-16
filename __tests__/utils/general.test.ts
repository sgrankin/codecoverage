import {test, expect} from 'vitest'
import {getFixturePath} from '../fixtures/util'
import {parseLCov} from '../../src/utils/lcov'
import {
  filterCoverageByFile,
  coalesceLineNumbers,
  coalesceLineNumbersWithGaps,
  intersectLineRanges,
  correctLineTotals
} from '../../src/utils/general'

test('filterCoverageByFile', async function () {
  const path = getFixturePath('lcov.info')
  const parsedLcov = await parseLCov(path, '')
  const output = filterCoverageByFile(parsedLcov)
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

test.each(coalesceTestCases)(
  'coalesceLineNumbers: $name',
  ({lines, executableLines, expected}) => {
    const result = executableLines
      ? coalesceLineNumbersWithGaps(lines, executableLines)
      : coalesceLineNumbers(lines)
    expect(result).toEqual(expected)
  }
)

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

  expect(intersectLineRanges(a, b)).toEqual(expected)
})

test('correctLineTotals', function () {
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

  const result = correctLineTotals(mockCoverage)
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

  const multiResult = correctLineTotals(multiFileMock)
  expect(multiResult[0].lines.found).toBe(2)
  expect(multiResult[0].lines.hit).toBe(2)
  expect(multiResult[1].lines.found).toBe(3)
  expect(multiResult[1].lines.hit).toBe(1)
})

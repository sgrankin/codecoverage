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

test('coalesceLineNumbers', function () {
  const lines = [1, 3, 4, 5, 10, 12, 13]
  const ranges = coalesceLineNumbers(lines)
  expect(ranges).toEqual([
    {start_line: 1, end_line: 1},
    {start_line: 3, end_line: 5},
    {start_line: 10, end_line: 10},
    {start_line: 12, end_line: 13}
  ])
})

test('coalesceLineNumbers returns empty array for empty input', function () {
  expect(coalesceLineNumbers([])).toEqual([])
})

test('coalesceLineNumbersWithGaps bridges non-executable lines', function () {
  // Uncovered lines: 10, 11, 13, 14 (line 12 is a comment, not executable)
  const uncoveredLines = [10, 11, 13, 14]
  // Executable lines are 10, 11, 13, 14 (line 12 not included - it's a comment)
  const executableLines = new Set([10, 11, 13, 14])

  const ranges = coalesceLineNumbersWithGaps(uncoveredLines, executableLines)

  // Should produce single range since line 12 is not executable
  expect(ranges).toEqual([{start_line: 10, end_line: 14}])
})

test('coalesceLineNumbersWithGaps does not bridge covered lines', function () {
  // Uncovered lines: 10, 11, 13, 14 (line 12 is covered)
  const uncoveredLines = [10, 11, 13, 14]
  // All lines 10-14 are executable (line 12 is covered, not in uncovered list)
  const executableLines = new Set([10, 11, 12, 13, 14])

  const ranges = coalesceLineNumbersWithGaps(uncoveredLines, executableLines)

  // Should produce two ranges since line 12 is covered (executable but not uncovered)
  expect(ranges).toEqual([
    {start_line: 10, end_line: 11},
    {start_line: 13, end_line: 14}
  ])
})

test('coalesceLineNumbersWithGaps handles multiple small gaps', function () {
  // Lines 5, 6, 8, 9, 11, 12 are uncovered
  // Lines 7 and 10 are comments (non-executable)
  const uncoveredLines = [5, 6, 8, 9, 11, 12]
  const executableLines = new Set([5, 6, 8, 9, 11, 12])

  const ranges = coalesceLineNumbersWithGaps(uncoveredLines, executableLines)

  // Should coalesce into single range (gaps are small)
  expect(ranges).toEqual([{start_line: 5, end_line: 12}])
})

test('coalesceLineNumbersWithGaps handles mixed gaps', function () {
  // Lines 1, 2, 4, 5, 8, 9 are uncovered
  // Line 3 is non-executable, lines 6, 7 are covered
  const uncoveredLines = [1, 2, 4, 5, 8, 9]
  const executableLines = new Set([1, 2, 4, 5, 6, 7, 8, 9])

  const ranges = coalesceLineNumbersWithGaps(uncoveredLines, executableLines)

  // Should produce two ranges: [1-5] (bridging non-exec line 3) and [8-9] (can't bridge covered 6,7)
  expect(ranges).toEqual([
    {start_line: 1, end_line: 5},
    {start_line: 8, end_line: 9}
  ])
})

test('coalesceLineNumbersWithGaps does not bridge large gaps', function () {
  // Lines 1, 2 and 10, 11 are uncovered
  // Lines 3-9 are all non-executable (e.g., large comment block)
  const uncoveredLines = [1, 2, 10, 11]
  const executableLines = new Set([1, 2, 10, 11])

  const ranges = coalesceLineNumbersWithGaps(uncoveredLines, executableLines)

  // Gap of 7 lines is too large (> MAX_BRIDGE_GAP of 5), should not bridge
  expect(ranges).toEqual([
    {start_line: 1, end_line: 2},
    {start_line: 10, end_line: 11}
  ])
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

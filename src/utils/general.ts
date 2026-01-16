export function filterCoverageByFile(coverage: CoverageParsed): CoverageFile[] {
  return coverage.map(item => {
    const allExecutableLines = new Set(
      item?.lines?.details.map(line => line.line) || []
    )
    const missingLineNumbers = item?.lines?.details
      .filter(line => line.hit === 0)
      .map(line => line.line) || []

    return {
      fileName: item.file,
      missingLineNumbers,
      executableLines: allExecutableLines
    }
  })
}

export function coalesceLineNumbers(lineNumbers: number[]): LineRange[] {
  return coalesceLineNumbersWithGaps(lineNumbers)
}

// Maximum gap size to bridge (prevents bridging across unrelated code sections)
const MAX_BRIDGE_GAP = 5

/**
 * Coalesce line numbers into ranges, optionally bridging gaps where
 * the gap lines are non-executable (not in the executableLines set).
 *
 * For example, if uncovered lines are [10, 11, 13, 14] and line 12
 * is not executable (a comment), this will produce [{10, 14}] instead
 * of [{10, 11}, {13, 14}].
 *
 * Gaps larger than MAX_BRIDGE_GAP lines are never bridged, even if
 * all lines in the gap are non-executable.
 */
export function coalesceLineNumbersWithGaps(
  lineNumbers: number[],
  executableLines?: Set<number>
): LineRange[] {
  const ranges: LineRange[] = []
  if (lineNumbers.length === 0) return ranges

  let rstart = lineNumbers[0]
  let rend = rstart

  for (let i = 1; i < lineNumbers.length; i++) {
    const current = lineNumbers[i]
    const previous = lineNumbers[i - 1]
    const gap = current - previous

    if (gap === 1) {
      // Consecutive lines
      rend = current
    } else if (
      executableLines &&
      gap <= MAX_BRIDGE_GAP + 1 &&
      canBridgeGap(previous, current, executableLines)
    ) {
      // Gap contains only non-executable lines and is small enough, bridge it
      rend = current
    } else {
      // Gap is too large or contains executable (covered) lines, start new range
      ranges.push({start_line: rstart, end_line: rend})
      rstart = current
      rend = current
    }
  }

  ranges.push({start_line: rstart, end_line: rend})
  return ranges
}

/**
 * Check if the gap between two lines contains only non-executable lines.
 * Returns true if all lines in the gap (exclusive) are not in executableLines.
 */
function canBridgeGap(
  from: number,
  to: number,
  executableLines: Set<number>
): boolean {
  for (let line = from + 1; line < to; line++) {
    if (executableLines.has(line)) {
      // There's an executable line in the gap (which must be covered,
      // since it's not in our uncovered list), so don't bridge
      return false
    }
  }
  return true
}

export function intersectLineRanges(
  a: LineRange[],
  b: LineRange[]
): LineRange[] {
  const result: LineRange[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    const rangeA = a[i]
    const rangeB = b[j]

    if (rangeA.end_line < rangeB.start_line) {
      i++
    } else if (rangeB.end_line < rangeA.start_line) {
      j++
    } else {
      const start = Math.max(rangeA.start_line, rangeB.start_line)
      const end = Math.min(rangeA.end_line, rangeB.end_line)
      result.push({start_line: start, end_line: end})

      if (rangeA.end_line < rangeB.end_line) {
        i++
      } else {
        j++
      }
    }
  }

  return result
}

export function correctLineTotals(coverage: CoverageParsed): CoverageParsed {
  return coverage.map(item => ({
    ...item,
    lines: {
      ...item.lines,
      found: item.lines.details.length,
      hit: item.lines.details.filter(line => line.hit > 0).length
    }
  }))
}

export type CoverageParsed = {
  file: string
  title: string
  lines: {
    found: number
    hit: number
    details: {
      line: number
      hit: number
      name: string
    }[]
  }
}[]

export type CoverageFile = {
  fileName: string
  missingLineNumbers: number[]
  executableLines: Set<number>
}

export type LineRange = {
  start_line: number
  end_line: number
}

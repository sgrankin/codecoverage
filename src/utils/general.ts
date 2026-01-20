// FileAccumulator holds coverage data during merging, using a Map for efficient updates.
interface FileAccumulator {
  file: string
  title: string
  package: string
  lineHits: Map<number, number>
  // found/hit are preserved from input when details are empty (detailsFor optimization)
  preservedFound: number
  preservedHit: number
}

// mergeByFile merges coverage entries for the same file from multiple test runs.
// A line is considered covered if it was hit in any test run.
// When entries have empty details but valid found/hit (detailsFor optimization),
// those values are preserved.
export function mergeByFile(coverage: Parsed): Parsed {
  const byFile = new Map<string, FileAccumulator>()

  for (const entry of coverage) {
    const existing = byFile.get(entry.file)
    if (existing) {
      // Merge line details: take max hit count for each line
      for (const detail of entry.lines.details) {
        const currentHit = existing.lineHits.get(detail.line) ?? 0
        existing.lineHits.set(detail.line, Math.max(currentHit, detail.hit))
      }
      // If this entry has no details but has found/hit, accumulate them
      if (entry.lines.details.length === 0) {
        existing.preservedFound += entry.lines.found
        existing.preservedHit += entry.lines.hit
      }
    } else {
      const acc: FileAccumulator = {
        file: entry.file,
        title: entry.title,
        package: entry.package ?? '',
        lineHits: new Map(),
        // Preserve found/hit when details are empty (detailsFor optimization)
        preservedFound: entry.lines.details.length === 0 ? entry.lines.found : 0,
        preservedHit: entry.lines.details.length === 0 ? entry.lines.hit : 0
      }
      for (const detail of entry.lines.details) {
        acc.lineHits.set(detail.line, detail.hit)
      }
      byFile.set(entry.file, acc)
    }
  }

  // Convert accumulators to Entry format
  const result: Parsed = []
  for (const acc of byFile.values()) {
    const details = Array.from(acc.lineHits.entries())
      .map(([line, hit]) => ({line, hit}))
      .sort((a, b) => a.line - b.line)
    // Use details-based counts if we have details, otherwise use preserved values
    const found = details.length > 0 ? details.length : acc.preservedFound
    const entry: Entry = {
      file: acc.file,
      title: acc.title,
      lines: {
        found,
        hit: acc.preservedHit, // Will be corrected by correctTotals if we have details
        details
      }
    }
    if (acc.package) {
      entry.package = acc.package
    }
    result.push(entry)
  }
  return result
}

export function filterByFile(coverage: Parsed): File[] {
  return coverage.map(item => {
    const details = item?.lines?.details || []
    const executableLines = new Set<number>()
    const missingLineNumbers: number[] = []
    let coveredLineCount = 0

    for (const detail of details) {
      executableLines.add(detail.line)
      if (detail.hit > 0) {
        coveredLineCount++
      } else {
        missingLineNumbers.push(detail.line)
      }
    }

    return {
      fileName: item.file,
      missingLineNumbers,
      executableLines,
      coveredLineCount
    }
  })
}

export function coalesce(lineNumbers: number[]): Range[] {
  return coalesceWithGaps(lineNumbers)
}

// MAX_BRIDGE_GAP is the maximum gap size to bridge (prevents bridging across unrelated code sections).
const MAX_BRIDGE_GAP = 5

// coalesceWithGaps coalesces line numbers into ranges, optionally bridging gaps
// where the gap lines are non-executable. For example, if uncovered lines are [10, 11, 13, 14]
// and line 12 is not executable (a comment), this produces [{10, 14}] instead of [{10, 11}, {13, 14}].
// Gaps larger than MAX_BRIDGE_GAP lines are never bridged.
export function coalesceWithGaps(lineNumbers: number[], executableLines?: Set<number>): Range[] {
  const ranges: Range[] = []
  const first = lineNumbers[0]
  if (first === undefined) return ranges

  let rstart = first
  let rend = rstart

  for (let i = 1; i < lineNumbers.length; i++) {
    const current = lineNumbers[i] as number
    const previous = lineNumbers[i - 1] as number
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

// canBridgeGap checks if the gap between two lines contains only non-executable lines.
// Returns true if all lines in the gap (exclusive) are not in executableLines.
function canBridgeGap(from: number, to: number, executableLines: Set<number>): boolean {
  for (let line = from + 1; line < to; line++) {
    if (executableLines.has(line)) {
      // There's an executable line in the gap (which must be covered,
      // since it's not in our uncovered list), so don't bridge
      return false
    }
  }
  return true
}

export function intersectRanges(a: Range[], b: Range[]): Range[] {
  const result: Range[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    const rangeA = a[i] as Range
    const rangeB = b[j] as Range

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

// correctTotals recalculates found/hit from details when details are present.
// When details are empty (detailsFor optimization), preserves the existing found/hit values.
export function correctTotals(coverage: Parsed): Parsed {
  return coverage.map(item => {
    // If no details, preserve the existing found/hit values
    if (item.lines.details.length === 0) {
      return item
    }
    // Recalculate from details
    let hit = 0
    for (const detail of item.lines.details) {
      if (detail.hit > 0) hit++
    }
    return {
      ...item,
      lines: {
        ...item.lines,
        found: item.lines.details.length,
        hit
      }
    }
  })
}

export type Entry = {
  file: string
  title: string
  package?: string
  lines: {
    found: number
    hit: number
    details: {
      line: number
      hit: number
      name?: string
    }[]
  }
}

export type Parsed = Entry[]

export type File = {
  fileName: string
  missingLineNumbers: number[]
  executableLines: Set<number>
  coveredLineCount: number
}

export type Range = {
  start_line: number
  end_line: number
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test.each([
    {from: 2, to: 5, exec: [1, 2, 5, 6], expected: true}, // gap has no executable lines
    {from: 2, to: 5, exec: [1, 2, 3, 4, 5], expected: false}, // gap contains executable lines
    {from: 2, to: 3, exec: [1, 2, 3], expected: true} // adjacent, no gap
  ])('canBridgeGap($from, $to) = $expected', ({from, to, exec, expected}) => {
    expect(canBridgeGap(from, to, new Set(exec))).toBe(expected)
  })
}

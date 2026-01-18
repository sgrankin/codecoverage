// mergeByFile merges coverage entries for the same file from multiple test runs.
// A line is considered covered if it was hit in any test run.
export function mergeByFile(coverage: Parsed): Parsed {
  const byFile = new Map<string, Entry>()

  for (const entry of coverage) {
    const existing = byFile.get(entry.file)
    if (!existing) {
      // Clone the entry to avoid mutating the original
      byFile.set(entry.file, {
        ...entry,
        lines: {
          ...entry.lines,
          details: entry.lines.details.map(d => ({...d}))
        }
      })
    } else {
      // Merge line details: take max hit count for each line
      const lineHits = new Map<number, number>()
      for (const detail of existing.lines.details) {
        lineHits.set(detail.line, detail.hit)
      }
      for (const detail of entry.lines.details) {
        const currentHit = lineHits.get(detail.line) ?? 0
        lineHits.set(detail.line, Math.max(currentHit, detail.hit))
      }
      // Rebuild details array
      existing.lines.details = Array.from(lineHits.entries())
        .map(([line, hit]) => ({line, hit}))
        .sort((a, b) => a.line - b.line)
    }
  }

  return Array.from(byFile.values())
}

export function filterByFile(coverage: Parsed): File[] {
  return coverage.map(item => {
    const allExecutableLines = new Set(item?.lines?.details.map(line => line.line) || [])
    const missingLineNumbers =
      item?.lines?.details.filter(line => line.hit === 0).map(line => line.line) || []
    const coveredLineCount = item?.lines?.details.filter(line => line.hit > 0).length || 0

    return {
      fileName: item.file,
      missingLineNumbers,
      executableLines: allExecutableLines,
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

export function correctTotals(coverage: Parsed): Parsed {
  return coverage.map(item => ({
    ...item,
    lines: {
      ...item.lines,
      found: item.lines.details.length,
      hit: item.lines.details.filter(line => line.hit > 0).length
    }
  }))
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

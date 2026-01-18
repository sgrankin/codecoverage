import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as coverage from './general.js'

// ParseOptions controls memory usage during parsing.
export interface ParseOptions {
  // detailsFor limits which files get full line details. If provided, only
  // files in this set will have details populated; others get summary stats only.
  detailsFor?: Set<string>
}

// Accumulator collects data during parsing, deferring decision about details.
interface Accumulator {
  title: string
  file: string
  found: number
  hit: number
  details: {line: number; hit: number}[]
}

// parseContent parses LCOV format coverage data.
// When detailsFor is provided, only those files get full line details.
function parseContent(
  str: string,
  workspacePath: string,
  detailsFor?: Set<string>
): coverage.Parsed {
  const data: coverage.Entry[] = []
  let acc: Accumulator = emptyAccumulator()
  let needDetails = false

  const finishEntry = (): void => {
    if (!acc.file) return
    const relativeFile = path.relative(workspacePath, acc.file)
    data.push({
      title: acc.title,
      file: relativeFile,
      lines: {
        found: acc.found || acc.details.length,
        hit: acc.hit || acc.details.filter(d => d.hit > 0).length,
        details: needDetails ? acc.details : []
      }
    })
    acc = emptyAccumulator()
    needDetails = false
  }

  for (const line of str.split('\n')) {
    const trimmed = line.trim()
    const allparts = trimmed.split(':')
    const key = allparts.shift()?.toUpperCase() ?? ''
    const value = allparts.join(':')

    switch (key) {
      case 'TN':
        acc.title = value.trim()
        break
      case 'SF': {
        acc.file = value.trim()
        // Determine if we need details for this file
        const relativeFile = path.relative(workspacePath, acc.file)
        needDetails = !detailsFor || detailsFor.has(relativeFile)
        break
      }
      case 'LF':
        acc.found = Number(value.trim())
        break
      case 'LH':
        acc.hit = Number(value.trim())
        break
      case 'DA': {
        const [lineNum, hitCount] = value.split(',')
        if (needDetails) {
          acc.details.push({
            line: Number(lineNum),
            hit: Number(hitCount)
          })
        } else {
          // Still need to count for files without LF/LH
          acc.found++
          if (Number(hitCount) > 0) acc.hit++
        }
        break
      }
      case 'END_OF_RECORD':
        finishEntry()
        break
    }
  }

  // Handle file without trailing end_of_record
  finishEntry()

  if (!data.length) {
    throw new Error('Failed to parse lcov string')
  }

  return data
}

function emptyAccumulator(): Accumulator {
  return {title: '', file: '', found: 0, hit: 0, details: []}
}

// parse parses an LCOV file and returns coverage data.
// When options.detailsFor is provided, only those files will have line details.
export async function parse(
  lcovPath: string,
  workspacePath: string,
  options: ParseOptions = {}
): Promise<coverage.Parsed> {
  if (!lcovPath) {
    throw Error('No LCov path provided')
  }

  const fileRaw = fs.readFileSync(lcovPath, 'utf8')
  return parseContent(fileRaw, workspacePath, options.detailsFor)
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('parseContent parses basic lcov format', () => {
    const input = `TN:Test
SF:/path/to/file.ts
DA:1,1
DA:2,0
DA:3,5
LF:3
LH:2
end_of_record`

    const result = parseContent(input, '/path/to')
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe('Test')
    expect(result[0]!.file).toBe('file.ts')
    expect(result[0]!.lines.found).toBe(3)
    expect(result[0]!.lines.hit).toBe(2)
    expect(result[0]!.lines.details).toEqual([
      {line: 1, hit: 1},
      {line: 2, hit: 0},
      {line: 3, hit: 5}
    ])
  })

  test('parseContent handles multiple files', () => {
    const input = `SF:file1.ts
DA:1,1
end_of_record
SF:file2.ts
DA:1,0
end_of_record`

    const result = parseContent(input, '')
    expect(result).toHaveLength(2)
    expect(result[0]!.file).toBe('file1.ts')
    expect(result[1]!.file).toBe('file2.ts')
  })

  test('parseContent throws on empty input', () => {
    expect(() => parseContent('', '')).toThrow('Failed to parse lcov string')
  })

  test('parseContent with detailsFor only keeps details for specified files', () => {
    const input = `SF:a.ts
DA:1,1
DA:2,0
end_of_record
SF:b.ts
DA:1,1
DA:2,1
end_of_record`

    const result = parseContent(input, '', new Set(['a.ts']))
    expect(result).toHaveLength(2)
    // a.ts should have details
    expect(result[0]!.file).toBe('a.ts')
    expect(result[0]!.lines.details).toHaveLength(2)
    // b.ts should have summary only
    expect(result[1]!.file).toBe('b.ts')
    expect(result[1]!.lines.details).toHaveLength(0)
    expect(result[1]!.lines.found).toBe(2)
    expect(result[1]!.lines.hit).toBe(2)
  })
}

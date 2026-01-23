import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as coverage from './general.ts'

// LineValue represents a single line's coverage.
// null = non-executable, 0 = uncovered, >0 = hit count, "ignored" = skipped.
type LineValue = number | null | 'ignored'

// SimpleCovCoverage is the coverage data for a single file.
interface SimpleCovCoverage {
  lines: LineValue[]
  branches?: Record<string, unknown> | unknown[]
}

// SimpleCovJSON is the format from simplecov_json_formatter.
interface SimpleCovJSON {
  meta?: {simplecov_version?: string}
  coverage: Record<string, SimpleCovCoverage>
  groups?: Record<string, unknown>
}

// ResultSetEntry is a single test suite's coverage in .resultset.json.
interface ResultSetEntry {
  coverage: Record<string, SimpleCovCoverage | LineValue[]>
  timestamp?: number
}

// ResultSetJSON is the .resultset.json format (keyed by test suite name).
type ResultSetJSON = Record<string, ResultSetEntry>

// isSimpleCovJSON checks if the parsed JSON is SimpleCov JSON format.
function isSimpleCovJSON(data: unknown): data is SimpleCovJSON {
  return (
    typeof data === 'object' &&
    data !== null &&
    'coverage' in data &&
    typeof (data as SimpleCovJSON).coverage === 'object'
  )
}

// isResultSetJSON checks if the parsed JSON is .resultset.json format.
function isResultSetJSON(data: unknown): data is ResultSetJSON {
  if (typeof data !== 'object' || data === null) return false
  // ResultSet has test suite names as keys, each with a coverage property
  for (const value of Object.values(data)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'coverage' in value &&
      typeof (value as ResultSetEntry).coverage === 'object'
    ) {
      return true
    }
  }
  return false
}

// normalizeCoverage converts either coverage format to a consistent structure.
function normalizeCoverage(cov: SimpleCovCoverage | LineValue[]): SimpleCovCoverage {
  if (Array.isArray(cov)) {
    return {lines: cov}
  }
  return cov
}

// parseLines converts SimpleCov lines array to coverage details.
function parseLines(lines: LineValue[]): coverage.Entry['lines']['details'] {
  const details: coverage.Entry['lines']['details'] = []
  for (let i = 0; i < lines.length; i++) {
    const hit = lines[i]
    // Skip non-executable lines: null, undefined, or "ignored"
    if (typeof hit === 'number') {
      details.push({line: i + 1, hit}) // SimpleCov uses 0-indexed arrays
    }
  }
  return details
}

// parseContent parses SimpleCov JSON content.
function parseContent(content: string, workspacePath: string): coverage.Parsed {
  const data: unknown = JSON.parse(content)
  const entries: coverage.Parsed = []

  let fileCoverage: Record<string, SimpleCovCoverage | LineValue[]>

  if (isSimpleCovJSON(data)) {
    fileCoverage = data.coverage
  } else if (isResultSetJSON(data)) {
    // Merge coverage from all test suites
    fileCoverage = {}
    for (const suite of Object.values(data)) {
      for (const [file, cov] of Object.entries(suite.coverage)) {
        const normalized = normalizeCoverage(cov)
        const existing = fileCoverage[file]
        if (existing) {
          // Merge: take max hit count for each line
          const existingNorm = normalizeCoverage(existing)
          const mergedLines: LineValue[] = existingNorm.lines.map((hit, i) => {
            const newHit = normalized.lines[i] ?? null
            // Treat "ignored" as null for merging
            const hitNum = typeof hit === 'number' ? hit : null
            const newHitNum = typeof newHit === 'number' ? newHit : null
            if (hitNum === null) return newHitNum
            if (newHitNum === null) return hitNum
            return Math.max(hitNum, newHitNum)
          })
          fileCoverage[file] = {lines: mergedLines}
        } else {
          fileCoverage[file] = normalized
        }
      }
    }
  } else {
    throw new Error('Invalid SimpleCov JSON format')
  }

  for (const [filePath, cov] of Object.entries(fileCoverage)) {
    const normalized = normalizeCoverage(cov)
    const details = parseLines(normalized.lines)
    const found = details.length
    const hit = details.filter(d => d.hit > 0).length

    entries.push({
      file: path.relative(workspacePath, filePath),
      title: path.basename(filePath),
      lines: {found, hit, details}
    })
  }

  if (entries.length === 0) {
    throw new Error('No coverage data found in SimpleCov JSON')
  }

  return entries
}

// parse parses a SimpleCov JSON file and returns coverage data.
export async function parse(jsonPath: string, workspacePath: string): Promise<coverage.Parsed> {
  if (!jsonPath) {
    throw new Error('No SimpleCov JSON path provided')
  }

  const content = fs.readFileSync(jsonPath, 'utf8')
  return parseContent(content, workspacePath)
}

// In-source tests
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('parseContent parses simplecov_json_formatter output', () => {
    const input = JSON.stringify({
      meta: {simplecov_version: '0.21.2'},
      coverage: {
        '/app/lib/foo.rb': {
          lines: [null, 1, 1, 0, null, 2]
        }
      }
    })

    const result = parseContent(input, '/app')
    expect(result).toHaveLength(1)
    expect(result[0]!.file).toBe('lib/foo.rb')
    expect(result[0]!.title).toBe('foo.rb')
    expect(result[0]!.lines.found).toBe(4) // 4 executable lines (non-null)
    expect(result[0]!.lines.hit).toBe(3) // 3 covered (hit > 0)
    expect(result[0]!.lines.details).toEqual([
      {line: 2, hit: 1},
      {line: 3, hit: 1},
      {line: 4, hit: 0},
      {line: 6, hit: 2}
    ])
  })

  test('parseContent parses .resultset.json format', () => {
    const input = JSON.stringify({
      RSpec: {
        coverage: {
          '/app/lib/bar.rb': [null, 1, 0, null]
        },
        timestamp: 1234567890
      }
    })

    const result = parseContent(input, '/app')
    expect(result).toHaveLength(1)
    expect(result[0]!.file).toBe('lib/bar.rb')
    expect(result[0]!.lines.found).toBe(2)
    expect(result[0]!.lines.hit).toBe(1)
  })

  test('parseContent merges multiple test suites in resultset', () => {
    const input = JSON.stringify({
      RSpec: {
        coverage: {
          '/app/lib/foo.rb': [null, 1, 0, 0]
        }
      },
      Minitest: {
        coverage: {
          '/app/lib/foo.rb': [null, 0, 1, 0]
        }
      }
    })

    const result = parseContent(input, '/app')
    expect(result).toHaveLength(1)
    // Should merge: max(1,0)=1, max(0,1)=1, max(0,0)=0
    expect(result[0]!.lines.hit).toBe(2)
    expect(result[0]!.lines.details).toEqual([
      {line: 2, hit: 1},
      {line: 3, hit: 1},
      {line: 4, hit: 0}
    ])
  })

  test('parseContent throws on invalid JSON format', () => {
    expect(() => parseContent('{}', '')).toThrow('Invalid SimpleCov JSON format')
    expect(() => parseContent('{"foo": "bar"}', '')).toThrow('Invalid SimpleCov JSON format')
  })

  test('parseContent throws on empty coverage', () => {
    const input = JSON.stringify({coverage: {}})
    expect(() => parseContent(input, '')).toThrow('No coverage data found')
  })

  test('parseContent handles "ignored" lines', () => {
    const input = JSON.stringify({
      coverage: {
        '/app/file.rb': {
          lines: [null, 1, 'ignored', 0, null]
        }
      }
    })

    const result = parseContent(input, '/app')
    expect(result).toHaveLength(1)
    // Only numeric values are executable: 1 (hit), 0 (miss) = 2 lines
    expect(result[0]!.lines.found).toBe(2)
    expect(result[0]!.lines.hit).toBe(1)
    expect(result[0]!.lines.details).toEqual([
      {line: 2, hit: 1},
      {line: 4, hit: 0}
    ])
  })
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as coverage from './general.js'

// parseContent parses LCOV format coverage data.
function parseContent(str: string, workspacePath: string): coverage.Parsed {
  const data: coverage.Entry[] = []
  let item: coverage.Entry = emptyEntry()

  for (const line of str.split('\n')) {
    const trimmed = line.trim()
    const allparts = trimmed.split(':')
    const key = allparts.shift()?.toUpperCase() ?? ''
    const value = allparts.join(':')

    switch (key) {
      case 'TN':
        item.title = value.trim()
        break
      case 'SF':
        item.file = path.relative(workspacePath, value.trim())
        break
      case 'LF':
        item.lines.found = Number(value.trim())
        break
      case 'LH':
        item.lines.hit = Number(value.trim())
        break
      case 'DA': {
        const [lineNum, hitCount] = value.split(',')
        item.lines.details.push({
          line: Number(lineNum),
          hit: Number(hitCount)
        })
        break
      }
      case 'END_OF_RECORD': {
        if (item.file) {
          data.push(item)
        }
        item = emptyEntry()
        break
      }
    }
  }

  // Handle file without trailing end_of_record
  if (item.file) {
    data.push(item)
  }

  if (!data.length) {
    throw new Error('Failed to parse lcov string')
  }

  return data
}

function emptyEntry(): coverage.Entry {
  return {
    title: '',
    file: '',
    lines: {found: 0, hit: 0, details: []}
  }
}

// parse parses an LCOV file and returns coverage data.
export async function parse(lcovPath: string, workspacePath: string): Promise<coverage.Parsed> {
  if (!lcovPath) {
    throw Error('No LCov path provided')
  }

  const fileRaw = fs.readFileSync(lcovPath, 'utf8')
  return parseContent(fileRaw, workspacePath)
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
}

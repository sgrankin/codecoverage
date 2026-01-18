import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import type * as coverage from './general.js'

// parseContent parses Go coverage file content.
// Inlined from golang-cover-parse to avoid its problematic mocha dependency.
function parseContent(text: string): coverage.Parsed {
  const files: coverage.Entry[] = []
  const modes = text.split('mode:')

  if (!modes.length) {
    throw new Error('No coverage found')
  }

  for (const mode of modes) {
    if (!mode.length) continue

    const lines = mode.replace('\r\n', '\n').split(/[\n\r]/g)
    const dataLines = lines.slice(1) // first line is mode type

    for (const line of dataLines) {
      const parts = line.split(':')
      if (!parts.length) continue

      const filePath = parts[0]
      const values = parts[1]
      if (!filePath || !values) continue

      // Get or create file entry
      let file = files[files.length - 1]
      if (!file || file.file !== filePath) {
        const nameParts = filePath.split('/')
        file = {
          title: nameParts.at(-1) ?? filePath,
          file: filePath,
          lines: {found: 0, hit: 0, details: []}
        }
        files.push(file)
      }

      // Parse line range and hit count: "startLine.col,endLine.col numStatements hitCount"
      const startLine = Number(values.split(',')[0]?.split('.')[0])
      const endLine = Number(values.split(',')[1]?.split('.')[0])
      const hit = Number(values.split(' ')[2])

      file.lines.found += endLine - startLine + 1

      for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
        const existing = file.lines.details.find(d => d.line === lineNumber)
        if (existing) {
          existing.hit += hit
        } else {
          file.lines.details.push({line: lineNumber, hit})
        }
      }
    }
  }

  // Calculate hit counts
  for (const file of files) {
    file.lines.hit = file.lines.details.reduce((acc, val) => acc + (val.hit > 0 ? 1 : 0), 0)
  }

  return files
}

// parse parses a Go coverage file and returns coverage data.
export async function parse(coveragePath: string, goModPath: string): Promise<coverage.Parsed> {
  if (!coveragePath) {
    throw Error('No Go coverage path provided')
  }

  if (!goModPath) {
    throw Error('No Go module path provided')
  }

  const goModule = await parseGoModFile(goModPath)
  const fileRaw = fs.readFileSync(coveragePath, 'utf8')
  const result = parseContent(fileRaw)
  filterModulePaths(result, goModule)
  return result
}

function filterModulePaths(entries: coverage.Parsed, moduleName: string): void {
  for (const entry of entries) {
    entry.file = path.relative(moduleName, entry.file)
  }
}

async function parseGoModFile(filePath: string): Promise<string> {
  const fileStream = fs.createReadStream(filePath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    if (line.startsWith('module ')) {
      return line.slice(7)
    }
  }

  /* istanbul ignore next */
  return ''
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('parseContent parses basic go coverage format', () => {
    const input = `mode: set
example.com/pkg/file.go:10.1,12.1 3 1
example.com/pkg/file.go:15.1,15.1 1 0`

    const result = parseContent(input)
    expect(result).toHaveLength(1)
    expect(result[0]!.file).toBe('example.com/pkg/file.go')
    expect(result[0]!.lines.details).toContainEqual({line: 10, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 11, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 12, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 15, hit: 0})
  })

  test('parseContent handles multiple files', () => {
    const input = `mode: count
example.com/a.go:1.1,1.1 1 1
example.com/b.go:1.1,1.1 1 0`

    const result = parseContent(input)
    expect(result).toHaveLength(2)
    expect(result[0]!.file).toBe('example.com/a.go')
    expect(result[1]!.file).toBe('example.com/b.go')
  })

  test('parseContent accumulates hits for same line', () => {
    const input = `mode: count
example.com/file.go:5.1,5.1 1 2
example.com/file.go:5.1,5.1 1 3`

    const result = parseContent(input)
    expect(result[0]!.lines.details.find(d => d.line === 5)?.hit).toBe(5)
  })

  test('parseContent returns empty for empty input', () => {
    // Note: the throw in parseContent is dead code - split always returns at least ['']
    expect(parseContent('')).toEqual([])
  })

  test('filterModulePaths strips module prefix', () => {
    const entries = [
      {file: 'example.com/pkg/file.go', title: '', lines: {found: 0, hit: 0, details: []}}
    ]
    filterModulePaths(entries, 'example.com')
    expect(entries[0]!.file).toBe('pkg/file.go')
  })
}

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type * as coverage from './general.ts'

// FileAccumulator collects line coverage data efficiently using a Map.
interface FileAccumulator {
  title: string
  file: string
  lineHits: Map<number, number>
  // stmtBlocks holds per-block statement coverage, keyed by the block's coordinate string
  // (e.g. "57.54,59.16").
  stmtBlocks: Map<string, {count: number; hit: number}>
}

// parseContent parses Go coverage file content.
// pathPrefix is prepended to each entry's stripped path so results are
// relative to the workspace, not the module root.
function parseContent(text: string, moduleName: string, pathPrefix = ''): coverage.Parsed {
  const files: FileAccumulator[] = []
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

      // Get or create file accumulator
      let file = files[files.length - 1]
      if (!file || file.file !== filePath) {
        const nameParts = filePath.split('/')
        file = {
          title: nameParts.at(-1) ?? filePath,
          file: filePath,
          lineHits: new Map(),
          stmtBlocks: new Map()
        }
        files.push(file)
      }

      // Parse line range and hit count: "startLine.col,endLine.col numStatements hitCount"
      const startLine = Number(values.split(',')[0]?.split('.')[0])
      const endLine = Number(values.split(',')[1]?.split('.')[0])
      const coords = values.split(' ')[0] ?? ''
      const numStmts = Number(values.split(' ')[1])
      const hitCount = Number(values.split(' ')[2])

      // Accumulate hits using Map for O(1) lookup
      for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
        const existing = file.lineHits.get(lineNumber) ?? 0
        file.lineHits.set(lineNumber, existing + hitCount)
      }

      // Accumulate per-block statement counts, taking the max hit count seen for a block.
      if (coords && Number.isFinite(numStmts)) {
        const prev = file.stmtBlocks.get(coords)
        if (prev) {
          prev.hit = Math.max(prev.hit, hitCount)
        } else {
          file.stmtBlocks.set(coords, {count: numStmts, hit: hitCount})
        }
      }
    }
  }

  // Convert accumulators to Entry format
  return files.map(file => {
    const stripped = path.relative(moduleName, file.file)
    const relativeFile = pathPrefix ? path.join(pathPrefix, stripped) : stripped
    const details = Array.from(file.lineHits.entries())
      .map(([line, hit]) => ({line, hit}))
      .sort((a, b) => a.line - b.line)
    const entry: coverage.Entry = {
      title: file.title,
      file: relativeFile,
      lines: {
        found: details.length,
        hit: details.filter(d => d.hit > 0).length,
        details
      }
    }
    if (file.stmtBlocks.size > 0) {
      const blocks = Array.from(file.stmtBlocks.entries())
        .map(([key, {count, hit}]) => ({key, count, hit}))
        .sort((a, b) => a.key.localeCompare(b.key))
      entry.statements = {
        found: blocks.reduce((acc, b) => acc + b.count, 0),
        hit: blocks.reduce((acc, b) => acc + (b.hit > 0 ? b.count : 0), 0),
        blocks
      }
    }
    return entry
  })
}

// parse parses a Go coverage file and returns coverage data.
// pathPrefix (typically the directory containing go.mod relative to the
// workspace) is prepended to each entry's path so results are
// workspace-relative.
export async function parse(
  coveragePath: string,
  goModPath: string,
  pathPrefix = ''
): Promise<coverage.Parsed> {
  if (!coveragePath) {
    throw Error('No Go coverage path provided')
  }

  if (!goModPath) {
    throw Error('No Go module path provided')
  }

  const goModule = await parseGoModFile(goModPath)
  const fileRaw = await fs.readFile(coveragePath, 'utf8')
  return parseContent(fileRaw, goModule, pathPrefix)
}

// parseGoModFile extracts the module name from a go.mod file.
async function parseGoModFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8')
  const match = content.match(/^module\s+(\S+)/m)
  return match?.[1] ?? ''
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('parseContent parses basic go coverage format', () => {
    const input = `mode: set
example.com/pkg/file.go:10.1,12.1 3 1
example.com/pkg/file.go:15.1,15.1 1 0`

    const result = parseContent(input, 'example.com')
    expect(result).toHaveLength(1)
    expect(result[0]!.file).toBe('pkg/file.go')
    expect(result[0]!.lines.details).toContainEqual({line: 10, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 11, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 12, hit: 1})
    expect(result[0]!.lines.details).toContainEqual({line: 15, hit: 0})
  })

  test('parseContent handles multiple files', () => {
    const input = `mode: count
example.com/a.go:1.1,1.1 1 1
example.com/b.go:1.1,1.1 1 0`

    const result = parseContent(input, 'example.com')
    expect(result).toHaveLength(2)
    expect(result[0]!.file).toBe('a.go')
    expect(result[1]!.file).toBe('b.go')
  })

  test('parseContent accumulates hits for same line', () => {
    const input = `mode: count
example.com/file.go:5.1,5.1 1 2
example.com/file.go:5.1,5.1 1 3`

    const result = parseContent(input, 'example.com')
    expect(result[0]!.lines.details.find(d => d.line === 5)?.hit).toBe(5)
  })

  test('parseContent returns empty for empty input', () => {
    expect(parseContent('', '')).toEqual([])
  })

  test('parseContent prepends pathPrefix when module is in a subdirectory', () => {
    const input = `mode: set
example.com/fulcrum/internal/foo.go:1.1,2.1 1 1`

    const result = parseContent(input, 'example.com/fulcrum', 'fulcrum')
    expect(result[0]!.file).toBe('fulcrum/internal/foo.go')
  })

  test('parseContent treats "." pathPrefix as no prefix', () => {
    const input = `mode: set
example.com/pkg/file.go:1.1,1.1 1 1`

    const result = parseContent(input, 'example.com', '.')
    expect(result[0]!.file).toBe('pkg/file.go')
  })

  test('parseContent parses statement counts into a statements field', () => {
    const input = `mode: set
example.com/pkg/file.go:10.1,12.1 3 1
example.com/pkg/file.go:15.1,15.1 1 0`

    const result = parseContent(input, 'example.com')
    expect(result[0]!.statements).toEqual({
      found: 4,
      hit: 3,
      blocks: [
        {key: '10.1,12.1', count: 3, hit: 1},
        {key: '15.1,15.1', count: 1, hit: 0}
      ]
    })
  })
}

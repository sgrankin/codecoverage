import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import {CoverageParsed, CoverageEntry} from './general.js'

// parseGoCoverageContent parses Go coverage file content.
// Inlined from golang-cover-parse to avoid its problematic mocha dependency.
function parseGoCoverageContent(text: string): CoverageParsed {
  const files: CoverageEntry[] = []
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
          title: nameParts[nameParts.length - 1],
          file: filePath,
          lines: {found: 0, hit: 0, details: []}
        }
        files.push(file)
      }

      // Parse line range and hit count: "startLine.col,endLine.col numStatements hitCount"
      const startLine = Number(values.split(',')[0].split('.')[0])
      const endLine = Number(values.split(',')[1].split('.')[0])
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

export async function parseGoCoverage(
  coveragePath: string,
  goModPath: string
): Promise<CoverageParsed> {
  if (!coveragePath) {
    throw Error('No Go coverage path provided')
  }

  if (!goModPath) {
    throw Error('No Go module path provided')
  }

  const goModule = await parseGoModFile(goModPath)
  const fileRaw = fs.readFileSync(coveragePath, 'utf8')
  const result = parseGoCoverageContent(fileRaw)
  filterModulePaths(result, goModule)
  return result
}

function filterModulePaths(entries: CoverageParsed, moduleName: string): void {
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

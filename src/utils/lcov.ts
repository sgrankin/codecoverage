import * as fs from 'fs'
import * as path from 'path'
import {CoverageParsed, CoverageEntry} from './general.js'

/**
 * Parse LCOV format coverage data.
 * Inlined from lcov-parse to reduce dependencies.
 */
function parseLcovContent(str: string): CoverageParsed {
  const data: CoverageEntry[] = []
  let item: CoverageEntry = makeEmptyEntry()

  for (const line of ['end_of_record', ...str.split('\n')]) {
    const trimmed = line.trim()
    const allparts = trimmed.split(':')
    const key = allparts.shift()?.toUpperCase() ?? ''
    const value = allparts.join(':')

    switch (key) {
      case 'TN':
        item.title = value.trim()
        break
      case 'SF':
        item.file = value.trim()
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
    }

    if (trimmed.includes('end_of_record')) {
      data.push(item)
      item = makeEmptyEntry()
    }
  }

  // Remove the first empty entry (from prepended end_of_record)
  data.shift()

  if (!data.length) {
    throw new Error('Failed to parse lcov string')
  }

  return data
}

function makeEmptyEntry(): CoverageEntry {
  return {
    title: '',
    file: '',
    lines: {found: 0, hit: 0, details: []}
  }
}

export async function parseLCov(
  lcovPath: string,
  workspacePath: string
): Promise<CoverageParsed> {
  if (!lcovPath) {
    throw Error('No LCov path provided')
  }

  const fileRaw = fs.readFileSync(lcovPath, 'utf8')
  const parsed = parseLcovContent(fileRaw)

  for (const entry of parsed) {
    entry.file = path.relative(workspacePath, entry.file)
  }

  return parsed
}

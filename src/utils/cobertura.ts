import * as fs from 'node:fs'
import * as path from 'node:path'
import {XMLParser} from 'fast-xml-parser'
import type * as coverage from './general.js'

interface CoberturaLine {
  '@_number': string
  '@_hits': string
}

interface CoberturaClass {
  '@_name': string
  '@_filename': string
  '@_line-rate': string
  lines?: {line?: CoberturaLine | CoberturaLine[]}
}

interface CoberturaPackage {
  '@_name': string
  '@_line-rate': string
  classes?: {class?: CoberturaClass | CoberturaClass[]}
}

interface CoberturaXML {
  coverage: {
    packages?: {package?: CoberturaPackage | CoberturaPackage[]}
  }
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// ParseOptions controls memory usage during parsing.
export interface ParseOptions {
  // detailsFor limits which files get full line details. If provided, only
  // files in this set will have details populated; others get summary stats only.
  // This significantly reduces memory for large coverage files when only
  // a subset of files (e.g., PR diff files) need annotation details.
  detailsFor?: Set<string>
}

// parse parses a Cobertura XML file and returns coverage data.
// When options.detailsFor is provided, only those files will have line details;
// other files will have empty details arrays but correct found/hit counts.
export async function parse(
  coberturaPath: string,
  workspacePath: string,
  options: ParseOptions = {}
): Promise<coverage.Parsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const fileRaw = fs.readFileSync(coberturaPath, 'utf8')
  const parser = new XMLParser({ignoreAttributes: false})
  const parsed = parser.parse(fileRaw) as CoberturaXML

  const result: coverage.Parsed = []
  const {detailsFor} = options

  const packages = toArray(parsed.coverage.packages?.package)
  for (const pkg of packages) {
    const packageName = pkg['@_name']
    const classes = toArray(pkg.classes?.class)

    for (const cls of classes) {
      const filename = cls['@_filename']
      const relativeFile = path.relative(workspacePath, filename)
      const lines = toArray(cls.lines?.line)

      // Only keep full details for files we need to annotate
      const needDetails = !detailsFor || detailsFor.has(relativeFile)

      let found = 0
      let hit = 0
      const details: coverage.Entry['lines']['details'] = []

      for (const line of lines) {
        const lineNum = parseInt(line['@_number'], 10)
        const hitCount = parseInt(line['@_hits'], 10)
        found++
        if (hitCount > 0) hit++
        if (needDetails) {
          details.push({line: lineNum, hit: hitCount})
        }
      }

      const entry: coverage.Entry = {
        title: cls['@_name'],
        file: relativeFile,
        package: packageName,
        lines: {found, hit, details}
      }
      result.push(entry)
    }
  }

  return result
}

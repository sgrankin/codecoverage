import * as fs from 'fs'
import * as path from 'path'
import {XMLParser} from 'fast-xml-parser'
import {CoverageParsed, CoverageEntry} from './general.js'

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

interface CoberturaXml {
  coverage: {
    packages?: {package?: CoberturaPackage | CoberturaPackage[]}
  }
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

export async function parseCobertura(
  coberturaPath: string,
  workspacePath: string
): Promise<CoverageParsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const fileRaw = fs.readFileSync(coberturaPath, 'utf8')
  const parser = new XMLParser({ignoreAttributes: false})
  const parsed = parser.parse(fileRaw) as CoberturaXml

  const result: CoverageParsed = []

  const packages = toArray(parsed.coverage.packages?.package)
  for (const pkg of packages) {
    const packageName = pkg['@_name']
    const classes = toArray(pkg.classes?.class)

    for (const cls of classes) {
      const filename = cls['@_filename']
      const lines = toArray(cls.lines?.line)

      const details = lines.map(line => ({
        line: parseInt(line['@_number'], 10),
        hit: parseInt(line['@_hits'], 10)
      }))

      const entry: CoverageEntry = {
        title: cls['@_name'],
        file: path.relative(workspacePath, filename),
        package: packageName,
        lines: {
          found: details.length,
          hit: details.filter(d => d.hit > 0).length,
          details
        }
      }
      result.push(entry)
    }
  }

  return result
}

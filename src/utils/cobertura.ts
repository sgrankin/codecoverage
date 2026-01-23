import * as fs from 'node:fs'
import * as path from 'node:path'
import {XMLParser} from 'fast-xml-parser'
import type * as coverage from './general.ts'

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

// parse parses a Cobertura XML file and returns coverage data.
export async function parse(
  coberturaPath: string,
  workspacePath: string
): Promise<coverage.Parsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const fileRaw = fs.readFileSync(coberturaPath, 'utf8')
  const parser = new XMLParser({ignoreAttributes: false})
  const parsed = parser.parse(fileRaw) as CoberturaXML

  const result: coverage.Parsed = []

  const packages = toArray(parsed.coverage.packages?.package)
  for (const pkg of packages) {
    const packageName = pkg['@_name']
    const classes = toArray(pkg.classes?.class)

    for (const cls of classes) {
      const filename = cls['@_filename']
      const relativeFile = path.relative(workspacePath, filename)
      const lines = toArray(cls.lines?.line)

      const details = lines.map(line => ({
        line: parseInt(line['@_number'], 10),
        hit: parseInt(line['@_hits'], 10)
      }))

      const entry: coverage.Entry = {
        title: cls['@_name'],
        file: relativeFile,
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

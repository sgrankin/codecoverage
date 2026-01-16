import * as fs from 'fs'
import * as path from 'path'
import * as util from 'util'
import {CoverageParsed, CoverageEntry} from './general.js'
import {parseString} from 'xml2js'

interface CoberturaLine {
  $: {
    number: string
    hits: string
  }
}

interface CoberturaClass {
  $: {
    name: string
    filename: string
    'line-rate': string
  }
  lines?: {line?: CoberturaLine[]}[]
}

interface CoberturaPackage {
  $: {
    name: string
    'line-rate': string
  }
  classes?: {class?: CoberturaClass[]}[]
}

interface CoberturaXml {
  coverage: {
    packages?: {package?: CoberturaPackage[]}[]
  }
}

export async function parseCobertura(
  coberturaPath: string,
  workspacePath: string
): Promise<CoverageParsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const fileRaw = fs.readFileSync(coberturaPath, 'utf8')
  const parseXml = util.promisify(parseString)
  const parsed = (await parseXml(fileRaw)) as CoberturaXml

  const result: CoverageParsed = []

  const packages = parsed.coverage.packages?.[0]?.package || []
  for (const pkg of packages) {
    const packageName = pkg.$.name
    const classes = pkg.classes?.[0]?.class || []

    for (const cls of classes) {
      const filename = cls.$.filename
      const lines = cls.lines?.[0]?.line || []

      const details = lines.map(line => ({
        line: parseInt(line.$.number, 10),
        hit: parseInt(line.$.hits, 10)
      }))

      const entry: CoverageEntry = {
        title: cls.$.name,
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

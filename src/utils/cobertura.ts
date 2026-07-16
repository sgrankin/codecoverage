import * as fs from 'node:fs/promises'
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

// escapeAttr escapes a string for use in an XML attribute value.
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// lineRate formats covered/total as a Cobertura line-rate attribute value.
function lineRate(covered: number, total: number): string {
  if (total === 0) return '0'
  return (covered / total).toFixed(4)
}

// generate serializes parsed coverage as Cobertura XML, the format accepted
// by GitHub's code coverage API. Entries are grouped into packages by their
// package name, falling back to the file's directory. Output is deterministic
// (timestamp fixed at 0, packages and files in input order).
export function generate(parsed: coverage.Parsed): string {
  const packages = new Map<string, coverage.Entry[]>()
  for (const entry of parsed) {
    const pkg = entry.package || path.dirname(entry.file)
    const entries = packages.get(pkg) ?? []
    entries.push(entry)
    packages.set(pkg, entries)
  }

  const covered = (e: coverage.Entry) => e.lines.details.filter(d => d.hit > 0).length
  const totalValid = parsed.reduce((acc, e) => acc + e.lines.details.length, 0)
  const totalCovered = parsed.reduce((acc, e) => acc + covered(e), 0)

  const xml: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<coverage line-rate="${lineRate(totalCovered, totalValid)}" branch-rate="0" lines-valid="${totalValid}" lines-covered="${totalCovered}" branches-valid="0" branches-covered="0" complexity="0" version="0" timestamp="0">`,
    '  <sources><source>.</source></sources>',
    '  <packages>'
  ]
  for (const [pkg, entries] of packages) {
    const pkgValid = entries.reduce((acc, e) => acc + e.lines.details.length, 0)
    const pkgCovered = entries.reduce((acc, e) => acc + covered(e), 0)
    xml.push(
      `    <package name="${escapeAttr(pkg)}" line-rate="${lineRate(pkgCovered, pkgValid)}" branch-rate="0" complexity="0">`,
      '      <classes>'
    )
    for (const entry of entries) {
      const name = entry.title || path.basename(entry.file)
      xml.push(
        `        <class name="${escapeAttr(name)}" filename="${escapeAttr(entry.file)}" line-rate="${lineRate(covered(entry), entry.lines.details.length)}" branch-rate="0" complexity="0">`,
        '          <methods/>',
        '          <lines>'
      )
      for (const detail of entry.lines.details) {
        xml.push(`            <line number="${detail.line}" hits="${detail.hit}" branch="false"/>`)
      }
      xml.push('          </lines>', '        </class>')
    }
    xml.push('      </classes>', '    </package>')
  }
  xml.push('  </packages>', '</coverage>', '')
  return xml.join('\n')
}

// parse parses a Cobertura XML file and returns coverage data.
export async function parse(
  coberturaPath: string,
  workspacePath: string
): Promise<coverage.Parsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const fileRaw = await fs.readFile(coberturaPath, 'utf8')
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

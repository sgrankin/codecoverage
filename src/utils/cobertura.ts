import * as NodeUtil from 'util'
import * as fs from 'fs'
import * as path from 'path'
import {CoverageParsed} from './general.js'
import * as cobertura from 'cobertura-parse'

export async function parseCobertura(
  coberturaPath: string,
  workspacePath: string
): Promise<CoverageParsed> {
  if (!coberturaPath) {
    throw Error('No Cobertura XML path provided')
  }

  const parseContent = NodeUtil.promisify(cobertura.parseContent)
  const fileRaw = fs.readFileSync(coberturaPath, 'utf8')
  const parsed = (await parseContent(fileRaw)) as CoverageParsed

  for (const entry of parsed) {
    entry.file = path.relative(workspacePath, entry.file)
  }

  return parsed
}

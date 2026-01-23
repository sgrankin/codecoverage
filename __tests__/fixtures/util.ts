import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

export function getFixturePath(fileName: string): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  return join(dir, fileName)
}

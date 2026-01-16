declare module 'cobertura-parse' {
  interface CoverageEntry {
    title: string
    file: string
    functions: {
      found: number
      hit: number
      details: {name: string; line: number; hit: number}[]
    }
    lines: {
      found: number
      hit: number
      details: {line: number; hit: number}[]
    }
    branches: {
      found: number
      hit: number
      details: {line: number; branch: number; taken: number}[]
    }
  }

  type Callback = (err: Error | null, result: CoverageEntry[]) => void

  export function parseContent(content: string, callback: Callback): void
  export function parseFile(filePath: string, callback: Callback): void
}

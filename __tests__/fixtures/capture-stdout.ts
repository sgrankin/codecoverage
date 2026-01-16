/**
 * Capture stdout during test execution.
 * @actions/core writes workflow commands to stdout.
 */
export function captureStdout(): {
  output: () => string
  restore: () => void
} {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(chunk.toString())
    return true
  }

  return {
    output: () => chunks.join(''),
    restore: () => {
      process.stdout.write = originalWrite
    }
  }
}

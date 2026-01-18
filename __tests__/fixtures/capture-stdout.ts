import {onTestFinished} from 'vitest'

// StdoutCapture captures stdout and auto-restores after the test.
export interface StdoutCapture {
  // output returns all captured stdout as a string.
  output: () => string
}

// captureStdout captures stdout for the current test.
// Automatically restores stdout when the test finishes.
export function captureStdout(): StdoutCapture {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)

  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(chunk.toString())
    return true
  }

  onTestFinished(() => {
    process.stdout.write = originalWrite
  })

  return {
    output: () => chunks.join('')
  }
}

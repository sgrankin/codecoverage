// Global test setup - suppress stdout during tests.
// @actions/core and @actions/glob write workflow commands to stdout.
// Tests that need to verify output use captureStdout() which collects it.
import {beforeEach, afterEach} from 'vitest'

let originalWrite: typeof process.stdout.write

beforeEach(() => {
  originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
})

afterEach(() => {
  process.stdout.write = originalWrite
})

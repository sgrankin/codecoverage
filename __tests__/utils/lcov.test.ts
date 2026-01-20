import {expect, test} from 'vitest'
import * as lcov from '../../src/utils/lcov'
import {getFixturePath} from '../fixtures/util'

test('parse reads file and relativizes paths', async () => {
  const path = getFixturePath('lcov.info')
  const output = await lcov.parse(path, '')

  expect(output.length).toBeGreaterThan(0)
  // Paths should be relative (not absolute)
  for (const entry of output) {
    expect(entry.file).not.toMatch(/^\//)
  }
})

test('parse throws if path not provided', async () => {
  await expect(lcov.parse('', '')).rejects.toThrow('No LCov path provided')
})

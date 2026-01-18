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

test('parse with detailsFor only keeps details for specified files', async () => {
  const path = getFixturePath('lcov.info')
  // The fixture has src/utils/general.ts, src/utils/github.ts, src/utils/baseline.ts
  const output = await lcov.parse(path, '', {detailsFor: new Set(['src/utils/general.ts'])})

  expect(output.length).toBeGreaterThan(1)

  // src/utils/general.ts should have full details
  const general = output.find(e => e.file === 'src/utils/general.ts')!
  expect(general).toBeDefined()
  expect(general.lines.details.length).toBeGreaterThan(0)
  expect(general.lines.found).toBe(general.lines.details.length)

  // Other files should have summary only (empty details but correct counts)
  const others = output.filter(e => e.file !== 'src/utils/general.ts')
  expect(others.length).toBeGreaterThan(0)
  for (const entry of others) {
    expect(entry.lines.details).toHaveLength(0)
    expect(entry.lines.found).toBeGreaterThan(0) // Should still have counts
  }
})

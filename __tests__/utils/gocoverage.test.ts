import {expect, test} from 'vitest'
import * as gocov from '../../src/utils/gocoverage'
import {getFixturePath} from '../fixtures/util'

test('parse reads file and strips module prefix from paths', async () => {
  const path = getFixturePath('gocoverage.out')
  const goModPath = getFixturePath('go.mod')
  const output = await gocov.parse(path, goModPath)

  expect(output.length).toBeGreaterThan(0)
  // Module prefix (github.com/sgrankin/bitrot) should be stripped
  for (const entry of output) {
    expect(entry.file).not.toContain('github.com')
  }
})

test('parse throws if coverage path not provided', async () => {
  await expect(gocov.parse('', '')).rejects.toThrow('No Go coverage path provided')
})

test('parse throws if go.mod path not provided', async () => {
  await expect(gocov.parse('foo', '')).rejects.toThrow('No Go module path provided')
})

test('parse with empty go.mod keeps full paths', async () => {
  const path = getFixturePath('gocoverage.out')
  const goModPath = getFixturePath('go_empty.mod')
  const output = await gocov.parse(path, goModPath)

  expect(output.length).toBeGreaterThan(0)
  // Without module name, paths keep the full module prefix
  expect(output[0]!.file).toContain('github.com')
})

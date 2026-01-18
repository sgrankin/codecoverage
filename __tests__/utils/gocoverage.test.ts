import {test, expect} from 'vitest'
import * as gocov from '../../src/utils/gocoverage'
import {getFixturePath} from '../fixtures/util'

test('should parse Go coverage file', async function () {
  const path = getFixturePath('gocoverage.out')
  const goModPath = getFixturePath('go.mod')
  const output = await gocov.parse(path, goModPath)
  expect(output).toMatchSnapshot()
})

test('should throw err if file path is not given', async function () {
  await expect(gocov.parse('', '')).rejects.toThrow('No Go coverage path provided')
})

test('should throw err if go.mod path is not given', async function () {
  await expect(gocov.parse('foo', '')).rejects.toThrow('No Go module path provided')
})

test('should return empty module name for go.mod without module line', async function () {
  const path = getFixturePath('gocoverage.out')
  const goModPath = getFixturePath('go_empty.mod')
  const output = await gocov.parse(path, goModPath)
  // When module name is empty, paths won't be filtered
  expect(output).toMatchSnapshot()
})

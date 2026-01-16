import {test, expect, vi, beforeEach} from 'vitest'
import {expandCoverageFilePaths} from '../../src/utils/files'
import {getFixturePath} from '../fixtures/util'
import * as path from 'path'

test('expands single file path', async () => {
  const lcovPath = getFixturePath('lcov.info')
  const result = await expandCoverageFilePaths(lcovPath)
  expect(result).toEqual([lcovPath])
})

test('expands glob pattern', async () => {
  const fixturesDir = path.dirname(getFixturePath('lcov.info'))
  const pattern = path.join(fixturesDir, '*.info')
  const result = await expandCoverageFilePaths(pattern)
  expect(result).toContain(getFixturePath('lcov.info'))
})

test('expands ** glob pattern', async () => {
  const fixturesDir = path.dirname(getFixturePath('lcov.info'))
  const pattern = path.join(fixturesDir, '**/*.xml')
  const result = await expandCoverageFilePaths(pattern)
  expect(result).toContain(getFixturePath('cobertura.xml'))
})

test('handles multiple paths separated by newlines', async () => {
  const lcovPath = getFixturePath('lcov.info')
  const coberturaPath = getFixturePath('cobertura.xml')
  const input = `${lcovPath}\n${coberturaPath}`
  const result = await expandCoverageFilePaths(input)
  expect(result).toContain(lcovPath)
  expect(result).toContain(coberturaPath)
  expect(result).toHaveLength(2)
})

test('handles mixed paths and globs', async () => {
  const fixturesDir = path.dirname(getFixturePath('lcov.info'))
  const lcovPath = getFixturePath('lcov.info')
  const pattern = path.join(fixturesDir, '*.xml')
  const input = `${lcovPath}\n${pattern}`
  const result = await expandCoverageFilePaths(input)
  expect(result).toContain(lcovPath)
  expect(result).toContain(getFixturePath('cobertura.xml'))
})

test('removes duplicates', async () => {
  const lcovPath = getFixturePath('lcov.info')
  const input = `${lcovPath}\n${lcovPath}`
  const result = await expandCoverageFilePaths(input)
  expect(result).toEqual([lcovPath])
})

test('ignores empty lines', async () => {
  const lcovPath = getFixturePath('lcov.info')
  const input = `\n${lcovPath}\n\n`
  const result = await expandCoverageFilePaths(input)
  expect(result).toEqual([lcovPath])
})

test('returns empty array for non-matching glob', async () => {
  const result = await expandCoverageFilePaths('/nonexistent/**/*.xyz')
  expect(result).toEqual([])
})

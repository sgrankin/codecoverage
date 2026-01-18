import {expect, test} from 'vitest'
import * as lcov from '../../src/utils/lcov'
import {getFixturePath} from '../fixtures/util'

test('should parse lCov file', async () => {
  const path = getFixturePath('lcov.info')
  const output = await lcov.parse(path, process.cwd())
  expect(output).toMatchSnapshot()
})

test('should throw err if lCov file path is not given', async () => {
  await expect(lcov.parse('', '')).rejects.toThrow('No LCov path provided')
})

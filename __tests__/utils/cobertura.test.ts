import {test, expect} from 'vitest'
import {parseCobertura} from '../../src/utils/cobertura'
import {getFixturePath} from '../fixtures/util'

test('should parse Cobertura XML file', async function () {
  const path = getFixturePath('cobertura.xml')
  // Use empty workspace so paths stay relative
  const output = await parseCobertura(path, '')

  expect(output).toHaveLength(2)
  expect(output[0].file).toBe('src/example.ts')
  expect(output[0].lines.found).toBe(5)
  expect(output[0].lines.hit).toBe(3)
  expect(output[0].lines.details).toHaveLength(5)
  expect(output[0].lines.details[2]).toEqual({line: 3, hit: 0})

  expect(output[1].file).toBe('src/utils/utils.ts')
  expect(output[1].lines.found).toBe(4)
  expect(output[1].lines.hit).toBe(3)
})

test('should throw error if path is not provided', async function () {
  await expect(parseCobertura('', '/workspace')).rejects.toThrow(
    'No Cobertura XML path provided'
  )
})

test('should strip workspace prefix from paths', async function () {
  const path = getFixturePath('cobertura.xml')
  // Use 'src' as workspace to strip it from paths
  const output = await parseCobertura(path, 'src')

  // With 'src' workspace, 'src/example.ts' becomes 'example.ts'
  expect(output[0].file).toBe('example.ts')
  expect(output[1].file).toBe('utils/utils.ts')
})

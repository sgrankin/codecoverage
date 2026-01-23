import {expect, test} from 'vitest'
import * as cobertura from '../../src/utils/cobertura.ts'
import {getFixturePath} from '../fixtures/util.ts'

test('should throw error if path is not provided', async () => {
  await expect(cobertura.parse('', '/workspace')).rejects.toThrow('No Cobertura XML path provided')
})

const parseCoberturaTestCases = [
  {
    name: 'parses standard cobertura file',
    fixture: 'cobertura.xml',
    workspace: '',
    expected: [
      {
        file: 'src/example.ts',
        package: 'src',
        linesFound: 5,
        linesHit: 3,
        detailsLength: 5
      },
      {
        file: 'src/utils/utils.ts',
        package: 'src',
        linesFound: 4,
        linesHit: 3,
        detailsLength: 4
      }
    ]
  },
  {
    name: 'strips workspace prefix from paths',
    fixture: 'cobertura.xml',
    workspace: 'src',
    expected: [
      {
        file: 'example.ts',
        package: 'src',
        linesFound: 5,
        linesHit: 3,
        detailsLength: 5
      },
      {
        file: 'utils/utils.ts',
        package: 'src',
        linesFound: 4,
        linesHit: 3,
        detailsLength: 4
      }
    ]
  },
  {
    name: 'handles empty packages',
    fixture: 'cobertura-empty.xml',
    workspace: '',
    expected: []
  },
  {
    name: 'handles package with no classes',
    fixture: 'cobertura-no-classes.xml',
    workspace: '',
    expected: []
  },
  {
    name: 'handles class with no lines',
    fixture: 'cobertura-no-lines.xml',
    workspace: '',
    expected: [
      {
        file: 'src/empty.ts',
        package: 'src',
        linesFound: 0,
        linesHit: 0,
        detailsLength: 0
      }
    ]
  }
]

test.each(parseCoberturaTestCases)('parse: $name', async ({fixture, workspace, expected}) => {
  const path = getFixturePath(fixture)
  const output = await cobertura.parse(path, workspace)

  expect(output).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(output[i].file).toBe(expected[i].file)
    expect(output[i].package).toBe(expected[i].package)
    expect(output[i].lines.found).toBe(expected[i].linesFound)
    expect(output[i].lines.hit).toBe(expected[i].linesHit)
    expect(output[i].lines.details).toHaveLength(expected[i].detailsLength)
  }
})

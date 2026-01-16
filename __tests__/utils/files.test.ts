import {test, expect} from 'vitest'
import {expandCoverageFilePaths} from '../../src/utils/files'
import {getFixturePath} from '../fixtures/util'
import * as path from 'path'

const fixturesDir = path.dirname(getFixturePath('lcov.info'))

const expandTestCases = [
  {
    name: 'expands single file path',
    input: getFixturePath('lcov.info'),
    expectedContains: [getFixturePath('lcov.info')],
    expectedLength: 1
  },
  {
    name: 'expands glob pattern with *',
    input: path.join(fixturesDir, '*.info'),
    expectedContains: [getFixturePath('lcov.info')]
  },
  {
    name: 'expands ** glob pattern',
    input: path.join(fixturesDir, '**/*.xml'),
    expectedContains: [getFixturePath('cobertura.xml')]
  },
  {
    name: 'handles multiple paths separated by newlines',
    input: `${getFixturePath('lcov.info')}\n${getFixturePath('cobertura.xml')}`,
    expectedContains: [
      getFixturePath('lcov.info'),
      getFixturePath('cobertura.xml')
    ],
    expectedLength: 2
  },
  {
    name: 'handles mixed paths and globs',
    input: `${getFixturePath('lcov.info')}\n${path.join(fixturesDir, '*.xml')}`,
    expectedContains: [
      getFixturePath('lcov.info'),
      getFixturePath('cobertura.xml')
    ]
  },
  {
    name: 'removes duplicates',
    input: `${getFixturePath('lcov.info')}\n${getFixturePath('lcov.info')}`,
    expectedContains: [getFixturePath('lcov.info')],
    expectedLength: 1
  },
  {
    name: 'ignores empty lines',
    input: `\n${getFixturePath('lcov.info')}\n\n`,
    expectedContains: [getFixturePath('lcov.info')],
    expectedLength: 1
  },
  {
    name: 'returns empty array for non-matching glob',
    input: '/nonexistent/**/*.xyz',
    expectedContains: [],
    expectedLength: 0
  }
]

test.each(expandTestCases)(
  '$name',
  async ({input, expectedContains, expectedLength}) => {
    const result = await expandCoverageFilePaths(input)

    for (const expected of expectedContains) {
      expect(result).toContain(expected)
    }

    if (expectedLength !== undefined) {
      expect(result).toHaveLength(expectedLength)
    }
  }
)

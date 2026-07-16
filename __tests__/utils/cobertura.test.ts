import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {expect, test} from 'vitest'
import * as cobertura from '../../src/utils/cobertura.ts'
import type * as coverage from '../../src/utils/general.ts'
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

test('generate output round-trips through parse', async () => {
  const parsed: coverage.Parsed = [
    {
      file: 'src/example.ts',
      title: 'example.ts',
      package: 'src',
      lines: {
        found: 3,
        hit: 2,
        details: [
          {line: 1, hit: 1},
          {line: 2, hit: 0},
          {line: 5, hit: 3}
        ]
      }
    },
    {
      file: 'src/utils/utils.ts',
      title: 'utils.ts',
      package: 'src/utils',
      lines: {found: 1, hit: 1, details: [{line: 10, hit: 1}]}
    }
  ]

  const xml = cobertura.generate(parsed)
  const tmpFile = path.join(os.tmpdir(), `generated-cobertura-${Date.now()}.xml`)
  fs.writeFileSync(tmpFile, xml)
  try {
    const roundTripped = await cobertura.parse(tmpFile, '')
    expect(roundTripped).toEqual(parsed)
  } finally {
    fs.unlinkSync(tmpFile)
  }
})

test('generate derives package and class name when absent', () => {
  const parsed: coverage.Parsed = [
    {
      file: 'src/utils/helper.ts',
      title: '',
      lines: {found: 1, hit: 1, details: [{line: 1, hit: 1}]}
    }
  ]

  const xml = cobertura.generate(parsed)
  expect(xml).toContain('<package name="src/utils"')
  expect(xml).toContain('<class name="helper.ts" filename="src/utils/helper.ts"')
})

test('generate escapes XML special characters', () => {
  const parsed: coverage.Parsed = [
    {
      file: 'src/a&b<c>"d".ts',
      title: 'a&b<c>"d".ts',
      package: 'p&q',
      lines: {found: 1, hit: 0, details: [{line: 1, hit: 0}]}
    }
  ]

  const xml = cobertura.generate(parsed)
  expect(xml).toContain('filename="src/a&amp;b&lt;c&gt;&quot;d&quot;.ts"')
  expect(xml).toContain('<package name="p&amp;q"')
})

test('generate computes coverage rates', () => {
  const parsed: coverage.Parsed = [
    {
      file: 'src/a.ts',
      title: 'a.ts',
      package: 'src',
      lines: {
        found: 4,
        hit: 3,
        details: [
          {line: 1, hit: 1},
          {line: 2, hit: 1},
          {line: 3, hit: 1},
          {line: 4, hit: 0}
        ]
      }
    }
  ]

  const xml = cobertura.generate(parsed)
  expect(xml).toContain('lines-valid="4"')
  expect(xml).toContain('lines-covered="3"')
  expect(xml).toContain('line-rate="0.7500"')
})

test('generate handles empty coverage', () => {
  const xml = cobertura.generate([])
  expect(xml).toContain('lines-valid="0"')
  expect(xml).toContain('line-rate="0"')
  expect(xml).toContain('<packages>')
})

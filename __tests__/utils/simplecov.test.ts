import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, test} from 'vitest'
import * as simplecov from '../../src/utils/simplecov.ts'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

describe('simplecov.parse', () => {
  test('parses simplecov_json_formatter file', async () => {
    const result = await simplecov.parse(path.join(fixturesDir, 'simplecov.json'), '/workspace')
    expect(result).toHaveLength(3)
    expect(result.map(e => e.file).sort()).toEqual([
      'app/models/post.rb',
      'app/models/user.rb',
      'lib/utils.rb'
    ])
  })

  test('parses .resultset.json file with merged suites', async () => {
    const result = await simplecov.parse(
      path.join(fixturesDir, 'simplecov-resultset.json'),
      '/workspace'
    )
    expect(result).toHaveLength(3)
    // user.rb appears in both suites - verify merging worked
    const user = result.find(e => e.file === 'app/models/user.rb')
    expect(user!.lines.hit).toBe(4) // All 4 lines covered after merge
  })

  test.each([
    ['missing file', '/nonexistent/coverage.json', ''],
    ['empty path', '', '']
  ])('throws on %s', async (_, jsonPath, workspace) => {
    await expect(simplecov.parse(jsonPath, workspace)).rejects.toThrow()
  })
})

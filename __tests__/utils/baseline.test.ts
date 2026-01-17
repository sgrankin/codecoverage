import {test, expect, vi, beforeEach, afterEach, describe} from 'vitest'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  parseBaseline,
  formatBaseline,
  storeBaseline,
  loadBaseline,
  calculateDelta,
  formatCoverageWithDelta,
  BaselineData
} from '../../src/utils/baseline'
import {gitExec, getHeadCommit, pushNotes} from '../../src/utils/gitnotes'

describe('baseline', () => {
  describe('parseBaseline', () => {
    const validData: BaselineData = {
      timestamp: '2024-01-01T10:00:00Z',
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      commit: 'abc123'
    }

    test('parses valid JSONL content', () => {
      const content = JSON.stringify(validData)
      const result = parseBaseline(content)
      expect(result).toEqual(validData)
    })

    test('parses first line of multi-line content', () => {
      const line1 = JSON.stringify(validData)
      const line2 = JSON.stringify({...validData, coveragePercentage: '90.00'})
      const content = `${line1}\n${line2}`

      const result = parseBaseline(content)
      expect(result?.coveragePercentage).toBe('85.50')
    })

    test('returns null for empty content', () => {
      expect(parseBaseline('')).toBeNull()
      expect(parseBaseline('   ')).toBeNull()
    })

    test('returns null for invalid JSON', () => {
      expect(parseBaseline('not json')).toBeNull()
      expect(parseBaseline('{invalid')).toBeNull()
    })

    test('returns null for missing required fields', () => {
      expect(parseBaseline('{}')).toBeNull()
      expect(parseBaseline('{"coveragePercentage": 85}')).toBeNull() // wrong type
      expect(
        parseBaseline('{"coveragePercentage": "85", "totalLines": "100"}')
      ).toBeNull() // wrong type
    })
  })

  describe('formatBaseline', () => {
    test('formats baseline as JSON', () => {
      const data: BaselineData = {
        timestamp: '2024-01-01T10:00:00Z',
        coveragePercentage: '85.50',
        totalLines: 1000,
        coveredLines: 855,
        commit: 'abc123'
      }

      const result = formatBaseline(data)
      expect(JSON.parse(result)).toEqual(data)
    })
  })

  describe('calculateDelta', () => {
    const testCases = [
      {current: '85.50', baseline: '83.00', precision: 2, expected: '+2.50'},
      {current: '80.00', baseline: '85.00', precision: 2, expected: '-5.00'},
      {current: '85.00', baseline: '85.00', precision: 2, expected: '+0.00'},
      {
        current: '85.555',
        baseline: '83.333',
        precision: 3,
        expected: '+2.222'
      },
      {current: '100.00', baseline: '0.00', precision: 2, expected: '+100.00'}
    ]

    test.each(testCases)(
      'current=$current baseline=$baseline -> $expected',
      ({current, baseline, precision, expected}) => {
        expect(calculateDelta(current, baseline, precision)).toBe(expected)
      }
    )
  })

  describe('formatCoverageWithDelta', () => {
    const testCases = [
      {current: '85.50', delta: '+2.50', expected: '85.50% (↑2.50%)'},
      {current: '80.00', delta: '-5.00', expected: '80.00% (↓5.00%)'},
      {current: '85.00', delta: '+0.00', expected: '85.00% (↑0.00%)'}
    ]

    test.each(testCases)(
      'current=$current delta=$delta -> $expected',
      ({current, delta, expected}) => {
        expect(formatCoverageWithDelta(current, delta)).toBe(expected)
      }
    )
  })

  describe('storeBaseline and loadBaseline integration', () => {
    let tempDir: string
    let repoDir: string
    let bareRepoDir: string

    /** Create a git commit with a file */
    async function createCommit(
      cwd: string,
      message: string,
      filename?: string
    ): Promise<string> {
      const file = filename || `file-${Date.now()}.txt`
      await writeFile(join(cwd, file), `content for ${message}`)
      await gitExec(['add', file], cwd)
      await gitExec(['commit', '-m', message], cwd)
      const result = await gitExec(['rev-parse', 'HEAD'], cwd)
      return result.stdout.trim()
    }

    beforeEach(async () => {
      // Create temp directory for test repos
      tempDir = await mkdtemp(join(tmpdir(), 'baseline-test-'))

      // Create bare repo to act as "origin"
      bareRepoDir = join(tempDir, 'origin.git')
      await gitExec(['init', '--bare', bareRepoDir])

      // Create working repo
      repoDir = join(tempDir, 'repo')
      await gitExec(['clone', bareRepoDir, repoDir])

      // Configure git user for commits
      await gitExec(['config', 'user.email', 'test@test.com'], repoDir)
      await gitExec(['config', 'user.name', 'Test User'], repoDir)

      // Create initial commit on main
      await createCommit(repoDir, 'Initial commit', 'README.md')
      await gitExec(['push', 'origin', 'main'], repoDir)
    })

    afterEach(async () => {
      await rm(tempDir, {recursive: true, force: true})
    })

    test('stores and retrieves baseline coverage', async () => {
      // Store baseline on main
      const stored = await storeBaseline(
        {
          coveragePercentage: '85.50',
          totalLines: 1000,
          coveredLines: 855
        },
        {cwd: repoDir}
      )
      expect(stored).toBe(true)

      // Create a feature branch
      await gitExec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Load baseline from feature branch
      const result = await loadBaseline('main', {cwd: repoDir})

      expect(result.baseline).not.toBeNull()
      expect(result.baseline?.coveragePercentage).toBe('85.50')
      expect(result.baseline?.totalLines).toBe(1000)
      expect(result.baseline?.coveredLines).toBe(855)
    })

    test('returns null when no baseline exists', async () => {
      // Create feature branch without storing baseline on main
      await gitExec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      const result = await loadBaseline('main', {cwd: repoDir})

      expect(result.baseline).toBeNull()
    })

    test('handles corrupted baseline data gracefully', async () => {
      // Store invalid JSON as baseline
      const commit = await getHeadCommit({cwd: repoDir})
      await gitExec(
        [
          'notes',
          '--ref',
          'refs/notes/coverage',
          'add',
          '-m',
          'not valid json',
          commit
        ],
        repoDir
      )
      await pushNotes({cwd: repoDir})

      // Create feature branch
      await gitExec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      const result = await loadBaseline('main', {cwd: repoDir})

      expect(result.baseline).toBeNull()
      expect(result.parseError).toBe('Invalid format')
    })

    test('uses custom namespace', async () => {
      // Store baseline with custom namespace
      await storeBaseline(
        {
          coveragePercentage: '90.00',
          totalLines: 500,
          coveredLines: 450
        },
        {cwd: repoDir, namespace: 'coverage/release'}
      )

      // Create feature branch
      await gitExec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Default namespace should have no baseline
      const defaultResult = await loadBaseline('main', {cwd: repoDir})
      expect(defaultResult.baseline).toBeNull()

      // Custom namespace should have baseline
      const customResult = await loadBaseline('main', {
        cwd: repoDir,
        namespace: 'coverage/release'
      })
      expect(customResult.baseline?.coveragePercentage).toBe('90.00')
    })
  })
})

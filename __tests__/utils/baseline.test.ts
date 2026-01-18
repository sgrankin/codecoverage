import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import * as baseline from '../../src/utils/baseline'
import * as gitnotes from '../../src/utils/gitnotes'

describe('baseline', () => {
  describe('parse', () => {
    const validData: baseline.Data = {
      timestamp: '2024-01-01T10:00:00Z',
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      commit: 'abc123'
    }

    test('parses valid JSONL content', () => {
      const content = JSON.stringify(validData)
      const result = baseline.parse(content)
      expect(result).toEqual(validData)
    })

    test('parses first line of multi-line content', () => {
      const line1 = JSON.stringify(validData)
      const line2 = JSON.stringify({...validData, coveragePercentage: '90.00'})
      const content = `${line1}\n${line2}`

      const result = baseline.parse(content)
      expect(result?.coveragePercentage).toBe('85.50')
    })

    test('returns null for empty content', () => {
      expect(baseline.parse('')).toBeNull()
      expect(baseline.parse('   ')).toBeNull()
    })

    test('returns null for invalid JSON', () => {
      expect(baseline.parse('not json')).toBeNull()
      expect(baseline.parse('{invalid')).toBeNull()
    })

    test('returns null for missing required fields', () => {
      expect(baseline.parse('{}')).toBeNull()
      expect(baseline.parse('{"coveragePercentage": 85}')).toBeNull() // wrong type
      expect(baseline.parse('{"coveragePercentage": "85", "totalLines": "100"}')).toBeNull() // wrong type
    })
  })

  describe('format', () => {
    test('formats baseline as JSON', () => {
      const data: baseline.Data = {
        timestamp: '2024-01-01T10:00:00Z',
        coveragePercentage: '85.50',
        totalLines: 1000,
        coveredLines: 855,
        commit: 'abc123'
      }

      const result = baseline.format(data)
      expect(JSON.parse(result)).toEqual(data)
    })
  })

  describe('delta', () => {
    const testCases = [
      {current: '85.50', base: '83.00', precision: 2, expected: '+2.50'},
      {current: '80.00', base: '85.00', precision: 2, expected: '-5.00'},
      {current: '85.00', base: '85.00', precision: 2, expected: '+0.00'},
      {
        current: '85.555',
        base: '83.333',
        precision: 3,
        expected: '+2.222'
      },
      {current: '100.00', base: '0.00', precision: 2, expected: '+100.00'}
    ]

    test.each(testCases)('current=$current base=$base -> $expected', ({
      current,
      base,
      precision,
      expected
    }) => {
      expect(baseline.delta(current, base, precision)).toBe(expected)
    })
  })

  describe('formatWithDelta', () => {
    const testCases = [
      {current: '85.50', deltaVal: '+2.50', expected: '85.50% (↑2.50%)'},
      {current: '80.00', deltaVal: '-5.00', expected: '80.00% (↓5.00%)'},
      {current: '85.00', deltaVal: '+0.00', expected: '85.00% (↑0.00%)'}
    ]

    test.each(testCases)('current=$current deltaVal=$deltaVal -> $expected', ({
      current,
      deltaVal,
      expected
    }) => {
      expect(baseline.formatWithDelta(current, deltaVal)).toBe(expected)
    })
  })

  describe('store and load integration', () => {
    let tempDir: string
    let repoDir: string
    let bareRepoDir: string

    // createCommit creates a git commit with a file.
    async function createCommit(cwd: string, message: string, filename?: string): Promise<string> {
      const file = filename || `file-${Date.now()}.txt`
      await writeFile(join(cwd, file), `content for ${message}`)
      await gitnotes.exec(['add', file], cwd)
      await gitnotes.exec(['commit', '-m', message], cwd)
      const result = await gitnotes.exec(['rev-parse', 'HEAD'], cwd)
      return result.stdout.trim()
    }

    beforeEach(async () => {
      // Create temp directory for test repos
      tempDir = await mkdtemp(join(tmpdir(), 'baseline-test-'))

      // Create bare repo to act as "origin" with main as default branch
      bareRepoDir = join(tempDir, 'origin.git')
      await gitnotes.exec(['init', '--bare', '--initial-branch=main', bareRepoDir])

      // Create working repo
      repoDir = join(tempDir, 'repo')
      await gitnotes.exec(['clone', bareRepoDir, repoDir])

      // Configure git user for commits
      await gitnotes.exec(['config', 'user.email', 'test@test.com'], repoDir)
      await gitnotes.exec(['config', 'user.name', 'Test User'], repoDir)

      // Ensure we're on main branch (in case git defaults to something else)
      await gitnotes.exec(['checkout', '-B', 'main'], repoDir)

      // Create initial commit on main
      await createCommit(repoDir, 'Initial commit', 'README.md')
      await gitnotes.exec(['push', '-u', 'origin', 'main'], repoDir)
    })

    afterEach(async () => {
      await rm(tempDir, {recursive: true, force: true})
    })

    test('stores and retrieves baseline coverage', async () => {
      // Store baseline on main
      const stored = await baseline.store(
        {
          coveragePercentage: '85.50',
          totalLines: 1000,
          coveredLines: 855
        },
        {cwd: repoDir}
      )
      expect(stored).toBe(true)

      // Create a feature branch
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Load baseline from feature branch
      const result = await baseline.load('main', {cwd: repoDir})

      expect(result.baseline).not.toBeNull()
      expect(result.baseline?.coveragePercentage).toBe('85.50')
      expect(result.baseline?.totalLines).toBe(1000)
      expect(result.baseline?.coveredLines).toBe(855)
    })

    test('returns null when no baseline exists', async () => {
      // Create feature branch without storing baseline on main
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      const result = await baseline.load('main', {cwd: repoDir})

      expect(result.baseline).toBeNull()
    })

    test('handles corrupted baseline data gracefully', async () => {
      // Store invalid JSON as baseline
      const commit = await gitnotes.headCommit({cwd: repoDir})
      await gitnotes.writeAndPush({commit, content: 'not valid json', force: true}, {cwd: repoDir})

      // Create feature branch
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      const result = await baseline.load('main', {cwd: repoDir})

      expect(result.baseline).toBeNull()
      expect(result.parseError).toBe('Invalid format')
    })

    test('uses custom namespace', async () => {
      // Store baseline with custom namespace
      await baseline.store(
        {
          coveragePercentage: '90.00',
          totalLines: 500,
          coveredLines: 450
        },
        {cwd: repoDir, namespace: 'coverage/release'}
      )

      // Create feature branch
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Default namespace should have no baseline
      const defaultResult = await baseline.load('main', {cwd: repoDir})
      expect(defaultResult.baseline).toBeNull()

      // Custom namespace should have baseline
      const customResult = await baseline.load('main', {
        cwd: repoDir,
        namespace: 'coverage/release'
      })
      expect(customResult.baseline?.coveragePercentage).toBe('90.00')
    })

    test('returns null when merge-base exists but has no notes', async () => {
      // Store baseline on initial commit
      await baseline.store(
        {
          coveragePercentage: '85.00',
          totalLines: 1000,
          coveredLines: 850
        },
        {cwd: repoDir}
      )

      // Create another commit on main (this commit has no notes)
      await createCommit(repoDir, 'Second main commit')
      await gitnotes.exec(['push', 'origin', 'main'], repoDir)

      // Create feature branch from the second commit
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Load baseline - merge-base is the second main commit which has no notes
      const result = await baseline.load('main', {cwd: repoDir})

      // Should find merge-base but no baseline data for it
      expect(result.baseline).toBeNull()
      expect(result.commit).not.toBeNull()
      expect(result.parseError).toBeUndefined()
    })

    test('store returns false when cwd is invalid', async () => {
      const result = await baseline.store(
        {
          coveragePercentage: '85.00',
          totalLines: 1000,
          coveredLines: 850
        },
        {cwd: '/nonexistent/path'}
      )

      expect(result).toBe(false)
    })

    test('load handles errors gracefully', async () => {
      // Try to load baseline with invalid cwd
      const result = await baseline.load('main', {cwd: '/nonexistent/path'})

      expect(result.baseline).toBeNull()
      expect(result.commit).toBeNull()
    })

    test('load returns null when no merge-base exists', async () => {
      // Store baseline on main so notes exist
      await baseline.store(
        {
          coveragePercentage: '85.00',
          totalLines: 1000,
          coveredLines: 850
        },
        {cwd: repoDir}
      )

      // Create an orphan branch (no common ancestor with main)
      await gitnotes.exec(['checkout', '--orphan', 'orphan-branch'], repoDir)
      // Clear the staging area from the previous branch's files
      await gitnotes.exec(['rm', '-rf', '--cached', 'README.md'], repoDir)
      await writeFile(join(repoDir, 'orphan.txt'), 'orphan content')
      await gitnotes.exec(['add', 'orphan.txt'], repoDir)
      await gitnotes.exec(['commit', '-m', 'Orphan commit'], repoDir)

      // Load baseline - should find no merge-base with main
      const result = await baseline.load('main', {cwd: repoDir})

      expect(result.baseline).toBeNull()
      expect(result.commit).toBeNull()
    })
  })

  describe('store with mocked push', () => {
    let tempDir: string
    let repoDir: string
    let bareRepoDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'baseline-mock-test-'))
      bareRepoDir = join(tempDir, 'origin.git')
      await gitnotes.exec(['init', '--bare', '--initial-branch=main', bareRepoDir])
      repoDir = join(tempDir, 'repo')
      await gitnotes.exec(['clone', bareRepoDir, repoDir])
      await gitnotes.exec(['config', 'user.email', 'test@test.com'], repoDir)
      await gitnotes.exec(['config', 'user.name', 'Test User'], repoDir)
      await gitnotes.exec(['checkout', '-B', 'main'], repoDir)
      await writeFile(join(repoDir, 'README.md'), 'initial')
      await gitnotes.exec(['add', 'README.md'], repoDir)
      await gitnotes.exec(['commit', '-m', 'Initial commit'], repoDir)
      await gitnotes.exec(['push', '-u', 'origin', 'main'], repoDir)
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await rm(tempDir, {recursive: true, force: true})
    })

    test('returns false when push fails', async () => {
      // Mock push to return false
      vi.spyOn(await import('../../src/utils/gitnotes'), 'writeAndPush').mockResolvedValue(false)

      const result = await baseline.store(
        {
          coveragePercentage: '85.00',
          totalLines: 1000,
          coveredLines: 850
        },
        {cwd: repoDir}
      )

      expect(result).toBe(false)
    })
  })
})

import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import * as gitnotes from '../../src/utils/gitnotes'
import {cloneRepo, createTestRepo, type TestRepo} from '../fixtures/git-repo'

describe('gitnotes', () => {
  let repo: TestRepo

  beforeEach(async () => {
    repo = await createTestRepo('gitnotes-test-')
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test('ref returns correct ref path', () => {
    expect(gitnotes.ref('coverage')).toBe('refs/notes/coverage')
    expect(gitnotes.ref('my-notes')).toBe('refs/notes/my-notes')
  })

  test('DEFAULT_NAMESPACE is coverage', () => {
    expect(gitnotes.DEFAULT_NAMESPACE).toBe('coverage')
  })

  describe('exec', () => {
    test('runs git commands successfully', async () => {
      const result = await gitnotes.exec(['status'], repo.repoDir)
      expect(result.stdout).toContain('On branch')
    })

    test('throws on invalid git command', async () => {
      await expect(gitnotes.exec(['invalid-command'], repo.repoDir)).rejects.toThrow(
        'Git command failed'
      )
    })

    test('handles special characters in arguments', async () => {
      const result = await gitnotes.exec(['log', '--oneline', '-1'], repo.repoDir)
      expect(result.stdout).toContain('Initial commit')
    })
  })

  describe('write and read', () => {
    test('writes and reads notes for a commit', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})
      const content = '{"coverage": 85.5}'

      await gitnotes.write(commit, content, {cwd: repo.repoDir})
      const result = await gitnotes.read(commit, {cwd: repo.repoDir})

      expect(result).toBe(content)
    })

    test('read returns null for commit without notes', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})
      const result = await gitnotes.read(commit, {cwd: repo.repoDir})
      expect(result).toBeNull()
    })

    test('write fails on existing note without force', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      await gitnotes.write(commit, 'first', {cwd: repo.repoDir})
      await expect(gitnotes.write(commit, 'second', {cwd: repo.repoDir})).rejects.toThrow()
    })

    test('write overwrites with force flag', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      await gitnotes.write(commit, 'first', {cwd: repo.repoDir})
      await gitnotes.write(commit, 'second', {cwd: repo.repoDir, force: true})

      const result = await gitnotes.read(commit, {cwd: repo.repoDir})
      expect(result).toBe('second')
    })

    test('uses custom namespace', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      await gitnotes.write(commit, 'custom', {cwd: repo.repoDir, namespace: 'my-notes'})

      // Should not be in default namespace
      const defaultResult = await gitnotes.read(commit, {cwd: repo.repoDir})
      expect(defaultResult).toBeNull()

      // Should be in custom namespace
      const customResult = await gitnotes.read(commit, {
        cwd: repo.repoDir,
        namespace: 'my-notes'
      })
      expect(customResult).toBe('custom')
    })
  })

  describe('append', () => {
    test('creates notes if none exist', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      await gitnotes.append(commit, 'line1', {cwd: repo.repoDir})

      const result = await gitnotes.read(commit, {cwd: repo.repoDir})
      expect(result).toBe('line1')
    })

    test('appends to existing notes', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      await gitnotes.append(commit, 'line1', {cwd: repo.repoDir})
      await gitnotes.append(commit, 'line2', {cwd: repo.repoDir})

      const result = await gitnotes.read(commit, {cwd: repo.repoDir})
      expect(result).toBe('line1\nline2')
    })
  })

  describe('fetch', () => {
    test('fetch returns false when notes ref does not exist', async () => {
      const cloneDir = await cloneRepo(repo, 'clone')
      const result = await gitnotes.fetch({cwd: cloneDir})
      expect(result).toBe(false)
    })

    test('fetch returns true when notes exist', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})
      await gitnotes.writeAndPush({commit, content: 'content', force: true}, {cwd: repo.repoDir})

      const cloneDir = await cloneRepo(repo, 'clone')
      const result = await gitnotes.fetch({cwd: cloneDir})
      expect(result).toBe(true)
    })
  })

  describe('findMergeBase', () => {
    test('finds merge base between branches', async () => {
      const baseCommit = await gitnotes.headCommit({cwd: repo.repoDir})

      // Create a new branch and commit
      await gitnotes.exec(['checkout', '-b', 'feature'], repo.repoDir)
      await repo.createCommit('Feature commit')

      // Go back to main and create another commit
      await gitnotes.exec(['checkout', 'main'], repo.repoDir)
      await repo.createCommit('Main commit')

      // From feature branch, find merge base with main
      await gitnotes.exec(['checkout', 'feature'], repo.repoDir)
      const mergeBase = await gitnotes.findMergeBase('main', {cwd: repo.repoDir})

      expect(mergeBase).toBe(baseCommit)
    })

    test('returns null for non-existent ref', async () => {
      const mergeBase = await gitnotes.findMergeBase('nonexistent-branch', {
        cwd: repo.repoDir
      })
      expect(mergeBase).toBeNull()
    })
  })

  describe('headCommit', () => {
    test('returns current HEAD SHA', async () => {
      const result = await gitnotes.headCommit({cwd: repo.repoDir})
      expect(result).toMatch(/^[a-f0-9]{40}$/)
    })
  })

  describe('listAncestors', () => {
    test('returns ancestor commits', async () => {
      // Create a few commits
      await repo.createCommit('commit 2')
      await repo.createCommit('commit 3')
      const head = await gitnotes.headCommit({cwd: repo.repoDir})

      const ancestors = await gitnotes.listAncestors(head, 10, {cwd: repo.repoDir})

      // Should include HEAD and at least the initial commit
      expect(ancestors.length).toBeGreaterThanOrEqual(3) // initial + 2 new commits
      expect(ancestors[0]).toBe(head)
      // All should be valid SHAs
      for (const sha of ancestors) {
        expect(sha).toMatch(/^[a-f0-9]{40}$/)
      }
    })

    test('respects maxCount limit', async () => {
      const head = await gitnotes.headCommit({cwd: repo.repoDir})
      const ancestors = await gitnotes.listAncestors(head, 1, {cwd: repo.repoDir})

      expect(ancestors).toHaveLength(1)
      expect(ancestors[0]).toBe(head)
    })

    test('returns empty array for invalid commit', async () => {
      const ancestors = await gitnotes.listAncestors('invalid-ref', 10, {
        cwd: repo.repoDir
      })
      expect(ancestors).toEqual([])
    })
  })

  describe('writeAndPush', () => {
    test('writes and pushes notes successfully', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})
      const content = 'test note content'

      const success = await gitnotes.writeAndPush(
        {commit, content, force: true},
        {cwd: repo.repoDir}
      )

      expect(success).toBe(true)

      // Verify note was pushed by reading from a fresh clone
      const cloneDir = await cloneRepo(repo, 'verify-clone')
      await gitnotes.fetch({cwd: cloneDir})
      const note = await gitnotes.read(commit, {cwd: cloneDir})
      expect(note).toBe(content)
    })

    test('handles concurrent updates with fetch-write-push cycle', async () => {
      const commit = await gitnotes.headCommit({cwd: repo.repoDir})

      // First, push initial note from repo
      await gitnotes.writeAndPush({commit, content: 'initial', force: true}, {cwd: repo.repoDir})

      // Create two clones that will compete
      const clone1 = await cloneRepo(repo, 'clone1')
      const clone2 = await cloneRepo(repo, 'clone2')

      // Clone1 updates and pushes first
      const success1 = await gitnotes.writeAndPush(
        {commit, content: 'clone1 update', force: true},
        {cwd: clone1}
      )
      expect(success1).toBe(true)

      // Clone2's writeAndPush should succeed because it fetches before writing
      const success2 = await gitnotes.writeAndPush(
        {commit, content: 'clone2 update', force: true},
        {cwd: clone2, maxRetries: 3}
      )
      expect(success2).toBe(true)

      // Verify clone2's content is what ended up on remote
      const verifyClone = await cloneRepo(repo, 'verify-clone2')
      await gitnotes.fetch({cwd: verifyClone})
      const note = await gitnotes.read(commit, {cwd: verifyClone})
      expect(note).toBe('clone2 update')
    })
  })
})

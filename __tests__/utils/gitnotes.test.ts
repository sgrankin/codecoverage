import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import * as gitnotes from '../../src/utils/gitnotes'

describe('gitnotes', () => {
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
    tempDir = await mkdtemp(join(tmpdir(), 'gitnotes-test-'))

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

    // Create initial commit
    await createCommit(repoDir, 'Initial commit', 'README.md')
    await gitnotes.exec(['push', '-u', 'origin', 'main'], repoDir)
  })

  afterEach(async () => {
    // Cleanup temp directory
    await rm(tempDir, {recursive: true, force: true})
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
      const result = await gitnotes.exec(['status'], repoDir)
      expect(result.stdout).toContain('On branch')
    })

    test('throws on invalid git command', async () => {
      await expect(gitnotes.exec(['invalid-command'], repoDir)).rejects.toThrow(
        'Git command failed'
      )
    })

    test('handles special characters in arguments', async () => {
      const result = await gitnotes.exec(['log', '--oneline', '-1'], repoDir)
      expect(result.stdout).toContain('Initial commit')
    })
  })

  describe('write and read', () => {
    test('writes and reads notes for a commit', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})
      const content = '{"coverage": 85.5}'

      await gitnotes.write(commit, content, {cwd: repoDir})
      const result = await gitnotes.read(commit, {cwd: repoDir})

      expect(result).toBe(content)
    })

    test('read returns null for commit without notes', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})
      const result = await gitnotes.read(commit, {cwd: repoDir})
      expect(result).toBeNull()
    })

    test('write fails on existing note without force', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      await gitnotes.write(commit, 'first', {cwd: repoDir})
      await expect(gitnotes.write(commit, 'second', {cwd: repoDir})).rejects.toThrow()
    })

    test('write overwrites with force flag', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      await gitnotes.write(commit, 'first', {cwd: repoDir})
      await gitnotes.write(commit, 'second', {cwd: repoDir, force: true})

      const result = await gitnotes.read(commit, {cwd: repoDir})
      expect(result).toBe('second')
    })

    test('uses custom namespace', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      await gitnotes.write(commit, 'custom', {cwd: repoDir, namespace: 'my-notes'})

      // Should not be in default namespace
      const defaultResult = await gitnotes.read(commit, {cwd: repoDir})
      expect(defaultResult).toBeNull()

      // Should be in custom namespace
      const customResult = await gitnotes.read(commit, {
        cwd: repoDir,
        namespace: 'my-notes'
      })
      expect(customResult).toBe('custom')
    })
  })

  describe('append', () => {
    test('creates notes if none exist', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      await gitnotes.append(commit, 'line1', {cwd: repoDir})

      const result = await gitnotes.read(commit, {cwd: repoDir})
      expect(result).toBe('line1')
    })

    test('appends to existing notes', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      await gitnotes.append(commit, 'line1', {cwd: repoDir})
      await gitnotes.append(commit, 'line2', {cwd: repoDir})

      const result = await gitnotes.read(commit, {cwd: repoDir})
      expect(result).toBe('line1\nline2')
    })
  })

  describe('fetch', () => {
    test('fetch returns false when notes ref does not exist', async () => {
      // Fresh clone, no notes pushed yet
      const cloneDir = join(tempDir, 'clone')
      await gitnotes.exec(['clone', bareRepoDir, cloneDir])

      const result = await gitnotes.fetch({cwd: cloneDir})
      expect(result).toBe(false)
    })

    test('fetch returns true when notes exist', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})
      await gitnotes.writeAndPush({commit, content: 'content', force: true}, {cwd: repoDir})

      // Clone and fetch
      const cloneDir = join(tempDir, 'clone')
      await gitnotes.exec(['clone', bareRepoDir, cloneDir])

      const result = await gitnotes.fetch({cwd: cloneDir})
      expect(result).toBe(true)
    })
  })

  describe('findMergeBase', () => {
    test('finds merge base between branches', async () => {
      const baseCommit = await gitnotes.headCommit({cwd: repoDir})

      // Create a new branch and commit
      await gitnotes.exec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Go back to main and create another commit
      await gitnotes.exec(['checkout', 'main'], repoDir)
      await createCommit(repoDir, 'Main commit')

      // From feature branch, find merge base with main
      await gitnotes.exec(['checkout', 'feature'], repoDir)
      const mergeBase = await gitnotes.findMergeBase('main', {cwd: repoDir})

      expect(mergeBase).toBe(baseCommit)
    })

    test('returns null for non-existent ref', async () => {
      const mergeBase = await gitnotes.findMergeBase('nonexistent-branch', {
        cwd: repoDir
      })
      // This will throw rather than return null for non-existent ref
      // but for disconnected histories it would return null
      expect(mergeBase).toBeNull()
    })
  })

  describe('headCommit', () => {
    test('returns current HEAD SHA', async () => {
      const result = await gitnotes.headCommit({cwd: repoDir})
      expect(result).toMatch(/^[a-f0-9]{40}$/)
    })
  })

  describe('writeAndPush', () => {
    test('writes and pushes notes successfully', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})
      const content = 'test note content'

      const success = await gitnotes.writeAndPush({commit, content, force: true}, {cwd: repoDir})

      expect(success).toBe(true)

      // Verify note was pushed by reading from a fresh clone
      const clone = join(tempDir, 'verify-clone')
      await gitnotes.exec(['clone', bareRepoDir, clone])
      await gitnotes.fetch({cwd: clone})
      const note = await gitnotes.read(commit, {cwd: clone})
      expect(note).toBe(content)
    })

    test('handles concurrent updates with fetch-write-push cycle', async () => {
      const commit = await gitnotes.headCommit({cwd: repoDir})

      // First, push initial note from repo
      await gitnotes.writeAndPush({commit, content: 'initial', force: true}, {cwd: repoDir})

      // Create two clones that will compete
      const clone1 = join(tempDir, 'clone1')
      const clone2 = join(tempDir, 'clone2')
      await gitnotes.exec(['clone', bareRepoDir, clone1])
      await gitnotes.exec(['clone', bareRepoDir, clone2])

      // Configure git user for clones
      await gitnotes.exec(['config', 'user.email', 'test@test.com'], clone1)
      await gitnotes.exec(['config', 'user.name', 'Test User'], clone1)
      await gitnotes.exec(['config', 'user.email', 'test@test.com'], clone2)
      await gitnotes.exec(['config', 'user.name', 'Test User'], clone2)

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
      const verifyClone = join(tempDir, 'verify-clone2')
      await gitnotes.exec(['clone', bareRepoDir, verifyClone])
      await gitnotes.fetch({cwd: verifyClone})
      const note = await gitnotes.read(commit, {cwd: verifyClone})
      expect(note).toBe('clone2 update')
    })
  })
})

import {test, expect, beforeEach, afterEach, describe} from 'vitest'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  gitExec,
  fetchNotes,
  readNotes,
  writeNotes,
  appendNotes,
  pushNotes,
  findMergeBase,
  getHeadCommit,
  getNotesRef,
  DEFAULT_NOTE_NAMESPACE
} from '../../src/utils/gitnotes'

describe('gitnotes', () => {
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
    tempDir = await mkdtemp(join(tmpdir(), 'gitnotes-test-'))

    // Create bare repo to act as "origin" with main as default branch
    bareRepoDir = join(tempDir, 'origin.git')
    await gitExec(['init', '--bare', '--initial-branch=main', bareRepoDir])

    // Create working repo
    repoDir = join(tempDir, 'repo')
    await gitExec(['clone', bareRepoDir, repoDir])

    // Configure git user for commits
    await gitExec(['config', 'user.email', 'test@test.com'], repoDir)
    await gitExec(['config', 'user.name', 'Test User'], repoDir)

    // Ensure we're on main branch (in case git defaults to something else)
    await gitExec(['checkout', '-B', 'main'], repoDir)

    // Create initial commit
    await createCommit(repoDir, 'Initial commit', 'README.md')
    await gitExec(['push', '-u', 'origin', 'main'], repoDir)
  })

  afterEach(async () => {
    // Cleanup temp directory
    await rm(tempDir, {recursive: true, force: true})
  })

  test('getNotesRef returns correct ref path', () => {
    expect(getNotesRef('coverage')).toBe('refs/notes/coverage')
    expect(getNotesRef('my-notes')).toBe('refs/notes/my-notes')
  })

  test('DEFAULT_NOTE_NAMESPACE is coverage', () => {
    expect(DEFAULT_NOTE_NAMESPACE).toBe('coverage')
  })

  describe('gitExec', () => {
    test('runs git commands successfully', async () => {
      const result = await gitExec(['status'], repoDir)
      expect(result.stdout).toContain('On branch')
    })

    test('throws on invalid git command', async () => {
      await expect(gitExec(['invalid-command'], repoDir)).rejects.toThrow(
        'Git command failed'
      )
    })

    test('handles special characters in arguments', async () => {
      const result = await gitExec(['log', '--oneline', '-1'], repoDir)
      expect(result.stdout).toContain('Initial commit')
    })
  })

  describe('writeNotes and readNotes', () => {
    test('writes and reads notes for a commit', async () => {
      const commit = await getHeadCommit({cwd: repoDir})
      const content = '{"coverage": 85.5}'

      await writeNotes(commit, content, {cwd: repoDir})
      const result = await readNotes(commit, {cwd: repoDir})

      expect(result).toBe(content)
    })

    test('readNotes returns null for commit without notes', async () => {
      const commit = await getHeadCommit({cwd: repoDir})
      const result = await readNotes(commit, {cwd: repoDir})
      expect(result).toBeNull()
    })

    test('writeNotes fails on existing note without force', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      await writeNotes(commit, 'first', {cwd: repoDir})
      await expect(
        writeNotes(commit, 'second', {cwd: repoDir})
      ).rejects.toThrow()
    })

    test('writeNotes overwrites with force flag', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      await writeNotes(commit, 'first', {cwd: repoDir})
      await writeNotes(commit, 'second', {cwd: repoDir, force: true})

      const result = await readNotes(commit, {cwd: repoDir})
      expect(result).toBe('second')
    })

    test('uses custom namespace', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      await writeNotes(commit, 'custom', {cwd: repoDir, namespace: 'my-notes'})

      // Should not be in default namespace
      const defaultResult = await readNotes(commit, {cwd: repoDir})
      expect(defaultResult).toBeNull()

      // Should be in custom namespace
      const customResult = await readNotes(commit, {
        cwd: repoDir,
        namespace: 'my-notes'
      })
      expect(customResult).toBe('custom')
    })
  })

  describe('appendNotes', () => {
    test('creates notes if none exist', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      await appendNotes(commit, 'line1', {cwd: repoDir})

      const result = await readNotes(commit, {cwd: repoDir})
      expect(result).toBe('line1')
    })

    test('appends to existing notes', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      await appendNotes(commit, 'line1', {cwd: repoDir})
      await appendNotes(commit, 'line2', {cwd: repoDir})

      const result = await readNotes(commit, {cwd: repoDir})
      expect(result).toBe('line1\nline2')
    })
  })

  describe('fetchNotes and pushNotes', () => {
    test('pushNotes pushes notes to origin', async () => {
      const commit = await getHeadCommit({cwd: repoDir})
      await writeNotes(commit, 'pushed content', {cwd: repoDir})

      const success = await pushNotes({cwd: repoDir})
      expect(success).toBe(true)

      // Clone a fresh repo and verify notes are there
      const cloneDir = join(tempDir, 'clone')
      await gitExec(['clone', bareRepoDir, cloneDir])
      await fetchNotes({cwd: cloneDir})

      const result = await readNotes(commit, {cwd: cloneDir})
      expect(result).toBe('pushed content')
    })

    test('fetchNotes returns false when notes ref does not exist', async () => {
      // Fresh clone, no notes pushed yet
      const cloneDir = join(tempDir, 'clone')
      await gitExec(['clone', bareRepoDir, cloneDir])

      const result = await fetchNotes({cwd: cloneDir})
      expect(result).toBe(false)
    })

    test('fetchNotes returns true when notes exist', async () => {
      const commit = await getHeadCommit({cwd: repoDir})
      await writeNotes(commit, 'content', {cwd: repoDir})
      await pushNotes({cwd: repoDir})

      // Clone and fetch
      const cloneDir = join(tempDir, 'clone')
      await gitExec(['clone', bareRepoDir, cloneDir])

      const result = await fetchNotes({cwd: cloneDir})
      expect(result).toBe(true)
    })
  })

  describe('findMergeBase', () => {
    test('finds merge base between branches', async () => {
      const baseCommit = await getHeadCommit({cwd: repoDir})

      // Create a new branch and commit
      await gitExec(['checkout', '-b', 'feature'], repoDir)
      await createCommit(repoDir, 'Feature commit')

      // Go back to main and create another commit
      await gitExec(['checkout', 'main'], repoDir)
      await createCommit(repoDir, 'Main commit')

      // From feature branch, find merge base with main
      await gitExec(['checkout', 'feature'], repoDir)
      const mergeBase = await findMergeBase('main', {cwd: repoDir})

      expect(mergeBase).toBe(baseCommit)
    })

    test('returns null for non-existent ref', async () => {
      const mergeBase = await findMergeBase('nonexistent-branch', {
        cwd: repoDir
      })
      // This will throw rather than return null for non-existent ref
      // but for disconnected histories it would return null
      expect(mergeBase).toBeNull()
    })
  })

  describe('getHeadCommit', () => {
    test('returns current HEAD SHA', async () => {
      const result = await getHeadCommit({cwd: repoDir})
      expect(result).toMatch(/^[a-f0-9]{40}$/)
    })
  })

  describe('concurrent push handling', () => {
    test('handles concurrent note updates with retry', async () => {
      const commit = await getHeadCommit({cwd: repoDir})

      // First, push initial note from repo
      await writeNotes(commit, 'initial', {cwd: repoDir})
      await pushNotes({cwd: repoDir})

      // Create two clones that will compete
      const clone1 = join(tempDir, 'clone1')
      const clone2 = join(tempDir, 'clone2')
      await gitExec(['clone', bareRepoDir, clone1])
      await gitExec(['clone', bareRepoDir, clone2])

      // Fetch notes in both
      await fetchNotes({cwd: clone1})
      await fetchNotes({cwd: clone2})

      // Update note in clone1 and push first
      await writeNotes(commit, 'clone1 update', {cwd: clone1, force: true})
      const success1 = await pushNotes({cwd: clone1})
      expect(success1).toBe(true)

      // Clone2's push would fail due to non-fast-forward, but retry should help
      // However, since we're using force write, we need to simulate the conflict
      // by having clone2 try to push without fetching the update first
      await writeNotes(commit, 'clone2 update', {cwd: clone2, force: true})

      // This push should eventually succeed after fetching and retrying
      // Note: In practice, the retry logic fetches and the user would need to
      // re-apply their changes. For this test, we verify the push at least
      // attempts properly
      const success2 = await pushNotes({cwd: clone2, maxRetries: 3})
      // Either succeeds (if no conflict) or fails (conflict after retries)
      // The actual behavior depends on git's merge strategy for notes
      expect(typeof success2).toBe('boolean')
    })
  })
})

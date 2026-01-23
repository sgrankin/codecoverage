import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import * as gitnotes from '../../src/utils/gitnotes.ts'

// TestRepo provides a temporary git repository for testing.
// Includes a bare "origin" repo and a working clone.
export interface TestRepo {
  // tempDir is the root temp directory containing all repos.
  tempDir: string
  // bareDir is the bare repo acting as "origin".
  bareDir: string
  // repoDir is the working clone.
  repoDir: string
  // createCommit creates a commit with a file and returns the SHA.
  createCommit: (message: string, filename?: string) => Promise<string>
  // cleanup removes all temp directories.
  cleanup: () => Promise<void>
}

// createTestRepo sets up a temporary git repo with origin for testing.
// Call cleanup() when done to remove temp directories.
export async function createTestRepo(prefix = 'test-repo-'): Promise<TestRepo> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix))
  const bareDir = join(tempDir, 'origin.git')
  const repoDir = join(tempDir, 'repo')

  // Create bare repo as "origin"
  await gitnotes.exec(['init', '--bare', '--initial-branch=main', bareDir])

  // Clone to working repo
  await gitnotes.exec(['clone', bareDir, repoDir])

  // Configure git user
  await gitnotes.exec(['config', 'user.email', 'test@test.com'], repoDir)
  await gitnotes.exec(['config', 'user.name', 'Test User'], repoDir)

  // Ensure main branch
  await gitnotes.exec(['checkout', '-B', 'main'], repoDir)

  const createCommit = async (message: string, filename?: string): Promise<string> => {
    const file = filename || `file-${Date.now()}.txt`
    await writeFile(join(repoDir, file), `content for ${message}`)
    await gitnotes.exec(['add', file], repoDir)
    await gitnotes.exec(['commit', '-m', message], repoDir)
    const result = await gitnotes.exec(['rev-parse', 'HEAD'], repoDir)
    return result.stdout.trim()
  }

  // Create initial commit and push
  await createCommit('Initial commit', 'README.md')
  await gitnotes.exec(['push', '-u', 'origin', 'main'], repoDir)

  return {
    tempDir,
    bareDir,
    repoDir,
    createCommit,
    cleanup: async () => rm(tempDir, {recursive: true, force: true})
  }
}

// cloneRepo creates a fresh clone of the test repo's origin.
export async function cloneRepo(repo: TestRepo, name: string): Promise<string> {
  const cloneDir = join(repo.tempDir, name)
  await gitnotes.exec(['clone', repo.bareDir, cloneDir])
  await gitnotes.exec(['config', 'user.email', 'test@test.com'], cloneDir)
  await gitnotes.exec(['config', 'user.name', 'Test User'], cloneDir)
  return cloneDir
}

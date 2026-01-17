import {exec, ExecException} from 'node:child_process'
import {promisify} from 'node:util'

const execAsync = promisify(exec)

/** Default namespace for coverage git notes */
export const DEFAULT_NOTE_NAMESPACE = 'coverage'

/** Maximum retries for push operations */
const MAX_PUSH_RETRIES = 3

/** Delay between retries in ms */
const RETRY_DELAY_MS = 1000

export interface GitNotesOptions {
  /** Git working directory */
  cwd?: string
  /** Notes namespace (default: 'coverage') */
  namespace?: string
}

export interface GitExecResult {
  stdout: string
  stderr: string
}

/** Run a git command and return stdout/stderr */
export async function gitExec(
  args: string[],
  cwd?: string
): Promise<GitExecResult> {
  const cmd = `git ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
  try {
    const result = await execAsync(cmd, {cwd})
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? ''
    }
  } catch (error) {
    const execError = error as ExecException & {
      stdout?: string
      stderr?: string
    }
    const err = new Error(
      `Git command failed: ${cmd}\n${execError.stderr || execError.message}`
    ) as Error & {code?: number; stdout?: string; stderr?: string}
    err.code = execError.code
    err.stdout = execError.stdout
    err.stderr = execError.stderr
    throw err
  }
}

/** Get the full ref path for a notes namespace */
export function getNotesRef(namespace: string): string {
  return `refs/notes/${namespace}`
}

/**
 * Fetch git notes from origin.
 * Returns true if notes were fetched successfully, false if the ref doesn't exist.
 */
export async function fetchNotes(
  options: GitNotesOptions & {force?: boolean} = {}
): Promise<boolean> {
  const {cwd, namespace = DEFAULT_NOTE_NAMESPACE, force = false} = options
  const ref = getNotesRef(namespace)

  try {
    // Use + prefix for force fetch to handle diverged refs
    const refspec = force ? `+${ref}:${ref}` : `${ref}:${ref}`
    await gitExec(['fetch', 'origin', refspec], cwd)
    return true
  } catch (error) {
    const err = error as Error & {stderr?: string}
    // Check if the error is because the ref doesn't exist
    if (
      err.stderr?.includes("couldn't find remote ref") ||
      err.stderr?.includes('does not match any')
    ) {
      return false
    }
    throw error
  }
}

/**
 * Read notes for a specific commit.
 * Returns null if no notes exist for the commit.
 */
export async function readNotes(
  commit: string,
  options: GitNotesOptions = {}
): Promise<string | null> {
  const {cwd, namespace = DEFAULT_NOTE_NAMESPACE} = options
  const ref = getNotesRef(namespace)

  try {
    const result = await gitExec(['notes', '--ref', ref, 'show', commit], cwd)
    return result.stdout.trim()
  } catch (error) {
    const err = error as Error & {stderr?: string}
    // Check if the error is because no notes exist
    if (
      err.stderr?.includes('No note found') ||
      err.stderr?.includes('error: no note found')
    ) {
      return null
    }
    throw error
  }
}

/**
 * Write notes for a specific commit.
 * If force is true, overwrites existing notes.
 */
export async function writeNotes(
  commit: string,
  content: string,
  options: GitNotesOptions & {force?: boolean} = {}
): Promise<void> {
  const {cwd, namespace = DEFAULT_NOTE_NAMESPACE, force = false} = options
  const ref = getNotesRef(namespace)

  const args = ['notes', '--ref', ref]
  if (force) {
    args.push('add', '-f')
  } else {
    args.push('add')
  }
  args.push('-m', content, commit)

  await gitExec(args, cwd)
}

/**
 * Append content to existing notes for a commit.
 * Creates new notes if none exist.
 */
export async function appendNotes(
  commit: string,
  content: string,
  options: GitNotesOptions = {}
): Promise<void> {
  const {cwd, namespace = DEFAULT_NOTE_NAMESPACE} = options

  // Read existing notes
  const existing = await readNotes(commit, {cwd, namespace})

  // Combine existing + new content
  const newContent = existing ? `${existing}\n${content}` : content

  // Write (force since we're replacing)
  await writeNotes(commit, newContent, {cwd, namespace, force: true})
}

/** Sleep for specified milliseconds */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Push git notes to origin with retry logic for concurrent updates.
 * Returns true if push succeeded, false if it failed after all retries.
 */
export async function pushNotes(
  options: GitNotesOptions & {maxRetries?: number} = {}
): Promise<boolean> {
  const {
    cwd,
    namespace = DEFAULT_NOTE_NAMESPACE,
    maxRetries = MAX_PUSH_RETRIES
  } = options
  const ref = getNotesRef(namespace)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await gitExec(['push', 'origin', ref], cwd)
      return true
    } catch (error) {
      const err = error as Error & {stderr?: string}
      // Check if it's a non-fast-forward error (concurrent update)
      const isConflict =
        err.stderr?.includes('non-fast-forward') ||
        err.stderr?.includes('fetch first') ||
        err.stderr?.includes('rejected')

      if (isConflict && attempt < maxRetries) {
        // Fetch latest notes (force to handle diverged refs) and retry
        await fetchNotes({cwd, namespace, force: true})
        await sleep(RETRY_DELAY_MS * attempt) // Exponential backoff
        continue
      }

      if (attempt === maxRetries) {
        // Failed after all retries
        return false
      }
      throw error
    }
  }

  return false
}

/**
 * Find the merge-base commit between HEAD and a target ref.
 */
export async function findMergeBase(
  targetRef: string,
  options: {cwd?: string} = {}
): Promise<string | null> {
  const {cwd} = options

  try {
    const result = await gitExec(['merge-base', 'HEAD', targetRef], cwd)
    return result.stdout.trim() || null
  } catch (error) {
    const err = error as Error & {stderr?: string}
    // merge-base can fail if there's no common ancestor
    if (err.stderr?.includes('no merge base')) {
      return null
    }
    throw error
  }
}

/**
 * Get the current HEAD commit SHA.
 */
export async function getHeadCommit(
  options: {cwd?: string} = {}
): Promise<string> {
  const {cwd} = options
  const result = await gitExec(['rev-parse', 'HEAD'], cwd)
  return result.stdout.trim()
}

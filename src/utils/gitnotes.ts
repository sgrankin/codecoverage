import {exec as nodeExec, ExecException} from 'node:child_process'
import {promisify} from 'node:util'

const execAsync = promisify(nodeExec)

// DEFAULT_NAMESPACE is the default namespace for coverage git notes.
export const DEFAULT_NAMESPACE = 'coverage'

// MAX_PUSH_RETRIES is the maximum number of retries for push operations.
const MAX_PUSH_RETRIES = 3

// RETRY_DELAY_MS is the delay between retries in milliseconds.
const RETRY_DELAY_MS = 1000

// Options configures git notes operations.
export interface Options {
  // cwd is the git working directory.
  cwd?: string
  // namespace is the notes namespace (default: 'coverage').
  namespace?: string
}

// ExecResult is the result of a git command execution.
export interface ExecResult {
  stdout: string
  stderr: string
}

// exec runs a git command and returns stdout/stderr.
export async function exec(args: string[], cwd?: string): Promise<ExecResult> {
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
    ) as Error & {
      code?: number | undefined
      stdout?: string | undefined
      stderr?: string | undefined
    }
    err.code = execError.code
    err.stdout = execError.stdout
    err.stderr = execError.stderr
    throw err
  }
}

// ref returns the full ref path for a notes namespace.
export function ref(namespace: string): string {
  return `refs/notes/${namespace}`
}

// fetch fetches git notes from origin.
// Returns true if notes were fetched successfully, false if the ref doesn't exist.
export async function fetch(options: Options & {force?: boolean} = {}): Promise<boolean> {
  const {cwd, namespace = DEFAULT_NAMESPACE, force = false} = options
  const notesRef = ref(namespace)

  try {
    // Use + prefix for force fetch to handle diverged refs
    const refspec = force ? `+${notesRef}:${notesRef}` : `${notesRef}:${notesRef}`
    await exec(['fetch', 'origin', refspec], cwd)
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

// read reads notes for a specific commit.
// Returns null if no notes exist for the commit.
export async function read(commit: string, options: Options = {}): Promise<string | null> {
  const {cwd, namespace = DEFAULT_NAMESPACE} = options
  const notesRef = ref(namespace)

  try {
    const result = await exec(['notes', '--ref', notesRef, 'show', commit], cwd)
    return result.stdout.trim()
  } catch (error) {
    const err = error as Error & {stderr?: string}
    // Check if the error is because no notes exist
    if (err.stderr?.includes('No note found') || err.stderr?.includes('error: no note found')) {
      return null
    }
    throw error
  }
}

// write writes notes for a specific commit.
// If force is true, overwrites existing notes.
export async function write(
  commit: string,
  content: string,
  options: Options & {force?: boolean} = {}
): Promise<void> {
  const {cwd, namespace = DEFAULT_NAMESPACE, force = false} = options
  const notesRef = ref(namespace)

  const args = ['notes', '--ref', notesRef]
  if (force) {
    args.push('add', '-f')
  } else {
    args.push('add')
  }
  args.push('-m', content, commit)

  await exec(args, cwd)
}

// append appends content to existing notes for a commit.
// Creates new notes if none exist.
export async function append(
  commit: string,
  content: string,
  options: Options = {}
): Promise<void> {
  // Read existing notes
  const existing = await read(commit, options)

  // Combine existing + new content
  const newContent = existing ? `${existing}\n${content}` : content

  // Write (force since we're replacing)
  await write(commit, newContent, {...options, force: true})
}

// sleep pauses execution for the specified milliseconds.
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// push pushes git notes to origin with retry logic for concurrent updates.
// Returns true if push succeeded, false if it failed after all retries.
export async function push(options: Options & {maxRetries?: number} = {}): Promise<boolean> {
  const {cwd, namespace = DEFAULT_NAMESPACE, maxRetries = MAX_PUSH_RETRIES} = options
  const notesRef = ref(namespace)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await exec(['push', 'origin', notesRef], cwd)
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
        await fetch(cwd ? {cwd, namespace, force: true} : {namespace, force: true})
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

// findMergeBase finds the merge-base commit between HEAD and a target ref.
export async function findMergeBase(
  targetRef: string,
  options: Options = {}
): Promise<string | null> {
  const {cwd} = options

  try {
    const result = await exec(['merge-base', 'HEAD', targetRef], cwd)
    return result.stdout.trim() || null
  } catch (error) {
    const err = error as Error & {stderr?: string; stdout?: string}
    // merge-base can fail if there's no common ancestor or ref doesn't exist
    // Empty output with non-zero exit also indicates no common ancestor (orphan branches)
    const noMergeBase =
      err.stderr?.includes('no merge base') ||
      err.stderr?.includes('Not a valid object name') ||
      err.stderr?.includes('bad revision') ||
      (!err.stderr?.trim() && !err.stdout?.trim())
    if (noMergeBase) {
      return null
    }
    throw error
  }
}

// headCommit returns the current HEAD commit SHA.
export async function headCommit(options: Options = {}): Promise<string> {
  const {cwd} = options
  const result = await exec(['rev-parse', 'HEAD'], cwd)
  return result.stdout.trim()
}

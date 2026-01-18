import {type ExecException, exec as nodeExec} from 'node:child_process'
import {promisify} from 'node:util'

const execAsync = promisify(nodeExec)

// DEFAULT_NAMESPACE is the default namespace for coverage git notes.
export const DEFAULT_NAMESPACE = 'coverage'

// MAX_PUSH_RETRIES is the maximum number of retries for push operations.
const MAX_PUSH_RETRIES = 3

// Options configures git notes operations.
// Empty string values are treated as defaults (cwd=current dir, namespace='coverage').
export interface Options {
  // cwd is the git working directory (empty string = current directory).
  cwd: string
  // namespace is the notes namespace (empty string = 'coverage').
  namespace: string
}

// defaults returns Options with zero values.
export function defaults(): Options {
  return {cwd: '', namespace: ''}
}

// withDefaults fills in zero values with defaults.
function withDefaults(options: Partial<Options>): Options {
  return {
    cwd: options.cwd ?? '',
    namespace: options.namespace || DEFAULT_NAMESPACE
  }
}

// ExecResult is the result of a git command execution.
export interface ExecResult {
  stdout: string
  stderr: string
}

// exec runs a git command and returns stdout/stderr.
export async function exec(args: string[], cwd: string): Promise<ExecResult> {
  const cmd = `git ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
  try {
    const result = await execAsync(cmd, cwd ? {cwd} : undefined)
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? ''
    }
  } catch (error) {
    const execError = error as ExecException & {stdout?: string; stderr?: string}
    const err = new Error(
      `Git command failed: ${cmd}\n${execError.stderr || execError.message}`
    ) as Error & {code?: number; stdout?: string; stderr?: string}
    if (execError.code !== undefined) err.code = execError.code
    if (execError.stdout) err.stdout = execError.stdout
    if (execError.stderr) err.stderr = execError.stderr
    throw err
  }
}

// ref returns the full ref path for a notes namespace.
export function ref(namespace: string): string {
  return `refs/notes/${namespace}`
}

// fetch fetches git notes from origin.
// Returns true if notes were fetched successfully, false if the ref doesn't exist.
export async function fetch(options: Partial<Options> & {force?: boolean} = {}): Promise<boolean> {
  const {cwd, namespace} = withDefaults(options)
  const force = options.force ?? false
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
export async function read(commit: string, options: Partial<Options> = {}): Promise<string | null> {
  const {cwd, namespace} = withDefaults(options)
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

// ensureGitIdentity configures git user identity if not already set.
// This is needed for git notes operations in CI environments.
async function ensureGitIdentity(cwd: string): Promise<void> {
  try {
    await exec(['config', 'user.email'], cwd)
  } catch {
    // Email not set, configure defaults for CI
    await exec(['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], cwd)
    await exec(['config', 'user.name', 'github-actions[bot]'], cwd)
  }
}

// write writes notes for a specific commit.
// If force is true, overwrites existing notes.
export async function write(
  commit: string,
  content: string,
  options: Partial<Options> & {force?: boolean} = {}
): Promise<void> {
  const {cwd, namespace} = withDefaults(options)
  const force = options.force ?? false
  const notesRef = ref(namespace)

  // Ensure git identity is configured (needed in CI)
  await ensureGitIdentity(cwd)

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
  options: Partial<Options> = {}
): Promise<void> {
  // Read existing notes
  const existing = await read(commit, options)

  // Combine existing + new content
  const newContent = existing ? `${existing}\n${content}` : content

  // Write (force since we're replacing)
  await write(commit, newContent, {...options, force: true})
}

// push pushes git notes to origin with retry logic for concurrent updates.
// Returns true if push succeeded, false if it failed after all retries.
export async function push(
  options: Partial<Options> & {maxRetries?: number} = {}
): Promise<boolean> {
  const {cwd, namespace} = withDefaults(options)
  const maxRetries = options.maxRetries ?? MAX_PUSH_RETRIES
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
        await fetch({cwd, namespace, force: true})
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
  options: Partial<Options> = {}
): Promise<string | null> {
  const {cwd} = withDefaults(options)

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
export async function headCommit(options: Partial<Options> = {}): Promise<string> {
  const {cwd} = withDefaults(options)
  const result = await exec(['rev-parse', 'HEAD'], cwd)
  return result.stdout.trim()
}

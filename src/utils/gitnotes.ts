import {type ExecException, exec as nodeExec} from 'node:child_process'
import {promisify} from 'node:util'
import * as core from '@actions/core'

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
  core.debug(`[gitnotes] exec: ${cmd}${cwd ? ` (cwd: ${cwd})` : ''}`)
  try {
    const result = await execAsync(cmd, cwd ? {cwd} : undefined)
    const stdout = result.stdout?.toString() ?? ''
    const stderr = result.stderr?.toString() ?? ''
    if (stdout) core.debug(`[gitnotes] stdout: ${stdout.trim()}`)
    if (stderr) core.debug(`[gitnotes] stderr: ${stderr.trim()}`)
    return {stdout, stderr}
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

// WriteOp describes a note write operation for writeAndPush.
export interface WriteOp {
  commit: string
  content: string
  force?: boolean
}

// writeAndPush atomically writes notes and pushes to origin with retry.
// On conflict, it fetches, re-writes, and retries the push.
// Returns true if the note was successfully pushed.
export async function writeAndPush(
  op: WriteOp,
  options: Partial<Options> & {maxRetries?: number} = {}
): Promise<boolean> {
  const {cwd, namespace} = withDefaults(options)
  const maxRetries = options.maxRetries ?? MAX_PUSH_RETRIES
  const notesRef = ref(namespace)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Fetch latest notes before writing (force to handle diverged refs)
    core.info(`[gitnotes] Attempt ${attempt}/${maxRetries}: fetching ${notesRef}`)
    await fetch({cwd, namespace, force: true})

    // Write the note
    core.debug(`[gitnotes] Writing note for ${op.commit.substring(0, 8)}`)
    await write(op.commit, op.content, {cwd, namespace, force: op.force ?? false})

    // Push
    try {
      core.info(`[gitnotes] Pushing ${notesRef}`)
      const result = await exec(['push', 'origin', notesRef], cwd)
      core.info(
        `[gitnotes] Push succeeded. stdout: ${result.stdout.trim() || '(empty)'}, stderr: ${result.stderr.trim() || '(empty)'}`
      )
      return true
    } catch (error) {
      const err = error as Error & {stderr?: string}
      core.warning(`[gitnotes] Push attempt ${attempt} failed: ${err.message}`)

      const isConflict =
        err.stderr?.includes('non-fast-forward') ||
        err.stderr?.includes('fetch first') ||
        err.stderr?.includes('rejected')

      if (isConflict && attempt < maxRetries) {
        core.info(`[gitnotes] Conflict detected, will retry...`)
        continue
      }

      if (attempt === maxRetries) {
        core.error(`[gitnotes] Push failed after ${maxRetries} attempts`)
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

// listAncestors returns up to maxCount ancestor commits starting from the given commit.
// Returns commits in reverse chronological order (newest first).
export async function listAncestors(
  commit: string,
  maxCount: number,
  options: Partial<Options> = {}
): Promise<string[]> {
  const {cwd} = withDefaults(options)

  try {
    const result = await exec(['rev-list', '--max-count', String(maxCount), commit], cwd)
    return result.stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
  } catch (error) {
    const err = error as Error & {stderr?: string}
    // Handle invalid commit refs gracefully
    if (err.stderr?.includes('bad revision') || err.stderr?.includes('unknown revision')) {
      return []
    }
    throw error
  }
}

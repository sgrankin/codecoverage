import * as core from '@actions/core'
import {
  fetchNotes,
  readNotes,
  writeNotes,
  pushNotes,
  findMergeBase,
  getHeadCommit,
  GitNotesOptions
} from './gitnotes.js'

/** Coverage baseline data stored in git notes */
export interface BaselineData {
  /** ISO timestamp when baseline was recorded */
  timestamp: string
  /** Coverage percentage as string (e.g., "85.50") */
  coveragePercentage: string
  /** Total lines of code */
  totalLines: number
  /** Lines covered by tests */
  coveredLines: number
  /** Commit SHA this baseline was recorded for */
  commit: string
}

/** Result of loading baseline data */
export interface BaselineResult {
  /** The baseline data, or null if not found */
  baseline: BaselineData | null
  /** The commit SHA the baseline was found on */
  commit: string | null
  /** Whether notes exist but couldn't be parsed */
  parseError?: string
}

/**
 * Parse baseline data from JSONL content.
 * Uses the first line for delta calculation.
 */
export function parseBaseline(content: string): BaselineData | null {
  const firstLine = content.split('\n')[0]?.trim()
  if (!firstLine) {
    return null
  }

  try {
    const data = JSON.parse(firstLine) as BaselineData
    // Validate required fields
    if (
      typeof data.coveragePercentage !== 'string' ||
      typeof data.totalLines !== 'number' ||
      typeof data.coveredLines !== 'number'
    ) {
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * Format baseline data as JSONL for storage.
 */
export function formatBaseline(data: BaselineData): string {
  return JSON.stringify(data)
}

/**
 * Store coverage baseline for the current commit.
 */
export async function storeBaseline(
  data: Omit<BaselineData, 'timestamp' | 'commit'>,
  options: GitNotesOptions = {}
): Promise<boolean> {
  const {cwd, namespace} = options

  try {
    const commit = await getHeadCommit({cwd})

    const baseline: BaselineData = {
      ...data,
      timestamp: new Date().toISOString(),
      commit
    }

    const content = formatBaseline(baseline)
    core.info(`Storing baseline coverage: ${data.coveragePercentage}%`)

    // Write notes for current commit
    await writeNotes(commit, content, {cwd, namespace, force: true})

    // Push notes to origin
    const pushSuccess = await pushNotes({cwd, namespace})
    if (!pushSuccess) {
      core.warning('Failed to push coverage baseline to origin after retries')
      return false
    }

    core.info('Coverage baseline stored successfully')
    return true
  } catch (error) {
    const err = error as Error
    core.warning(`Failed to store coverage baseline: ${err.message}`)
    return false
  }
}

/**
 * Load baseline coverage from the merge-base commit with a target branch.
 */
export async function loadBaseline(
  targetBranch: string,
  options: GitNotesOptions = {}
): Promise<BaselineResult> {
  const {cwd, namespace} = options

  try {
    // Fetch latest notes from origin
    const fetched = await fetchNotes({cwd, namespace})
    if (!fetched) {
      core.info('No coverage notes found in origin')
      return {baseline: null, commit: null}
    }

    // Find merge-base with target branch
    const mergeBase = await findMergeBase(`origin/${targetBranch}`, {cwd})
    if (!mergeBase) {
      core.info(`No merge-base found with origin/${targetBranch}`)
      return {baseline: null, commit: null}
    }

    core.info(`Found merge-base: ${mergeBase.substring(0, 8)}`)

    // Read notes from merge-base
    const content = await readNotes(mergeBase, {cwd, namespace})
    if (!content) {
      core.info('No baseline coverage found for merge-base commit')
      return {baseline: null, commit: mergeBase}
    }

    // Parse the baseline data
    const baseline = parseBaseline(content)
    if (!baseline) {
      core.warning('Failed to parse baseline coverage data')
      return {baseline: null, commit: mergeBase, parseError: 'Invalid format'}
    }

    core.info(`Loaded baseline: ${baseline.coveragePercentage}%`)
    return {baseline, commit: mergeBase}
  } catch (error) {
    const err = error as Error
    core.warning(`Failed to load baseline: ${err.message}`)
    return {baseline: null, commit: null}
  }
}

/**
 * Calculate coverage delta between current and baseline.
 * Returns formatted string like "+2.50" or "-1.25"
 */
export function calculateDelta(
  currentPercentage: string,
  baselinePercentage: string,
  precision = 2
): string {
  const current = parseFloat(currentPercentage)
  const baseline = parseFloat(baselinePercentage)
  const delta = current - baseline

  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(precision)}`
}

/**
 * Format coverage with delta for display.
 * Returns string like "85.5% (↑2.1%)" or "83.2% (↓1.8%)"
 */
export function formatCoverageWithDelta(currentPercentage: string, delta: string): string {
  const deltaNum = parseFloat(delta)
  const arrow = deltaNum >= 0 ? '↑' : '↓'
  const absDelta = Math.abs(deltaNum).toFixed(2)
  return `${currentPercentage}% (${arrow}${absDelta}%)`
}

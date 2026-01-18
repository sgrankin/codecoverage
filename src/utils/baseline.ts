import * as core from '@actions/core'
import * as gitnotes from './gitnotes.js'

// Data is the coverage baseline stored in git notes.
export interface Data {
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

// Result is the result of loading baseline data.
export interface Result {
  // baseline is the baseline data, or null if not found.
  baseline: Data | null
  // commit is the commit SHA the baseline was found on.
  commit: string | null
  // parseError indicates notes exist but couldn't be parsed.
  parseError?: string
}

// parse parses baseline data from JSONL content, using the first line.
export function parse(content: string): Data | null {
  const firstLine = content.split('\n')[0]?.trim()
  if (!firstLine) {
    return null
  }

  try {
    const data = JSON.parse(firstLine) as Data
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

// format formats baseline data as JSONL for storage.
export function format(data: Data): string {
  return JSON.stringify(data)
}

// store stores coverage baseline for the current commit.
export async function store(
  data: Omit<Data, 'timestamp' | 'commit'>,
  options: Partial<gitnotes.Options> = {}
): Promise<boolean> {
  try {
    const commit = await gitnotes.headCommit(options)

    const baseline: Data = {
      ...data,
      timestamp: new Date().toISOString(),
      commit
    }

    const content = format(baseline)
    core.info(`Storing baseline coverage: ${data.coveragePercentage}%`)

    // Write notes for current commit
    await gitnotes.write(commit, content, {...options, force: true})

    // Push notes to origin
    const pushSuccess = await gitnotes.push(options)
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

// load loads baseline coverage from the merge-base commit with a target branch.
export async function load(
  targetBranch: string,
  options: Partial<gitnotes.Options> = {}
): Promise<Result> {
  try {
    // Fetch latest notes from origin
    const fetched = await gitnotes.fetch(options)
    if (!fetched) {
      core.info('No coverage notes found in origin')
      return {baseline: null, commit: null}
    }

    // Find merge-base with target branch
    const mergeBase = await gitnotes.findMergeBase(`origin/${targetBranch}`, options)
    if (!mergeBase) {
      core.info(`No merge-base found with origin/${targetBranch}`)
      return {baseline: null, commit: null}
    }

    core.info(`Found merge-base: ${mergeBase.substring(0, 8)}`)

    // Read notes from merge-base
    const content = await gitnotes.read(mergeBase, options)
    if (!content) {
      core.info('No baseline coverage found for merge-base commit')
      return {baseline: null, commit: mergeBase}
    }

    // Parse the baseline data
    const baseline = parse(content)
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

// delta calculates the coverage delta between current and baseline.
// Returns a formatted string like "+2.50" or "-1.25".
export function delta(
  currentPercentage: string,
  baselinePercentage: string,
  precision = 2
): string {
  const current = parseFloat(currentPercentage)
  const base = parseFloat(baselinePercentage)
  const diff = current - base

  const sign = diff >= 0 ? '+' : ''
  return `${sign}${diff.toFixed(precision)}`
}

// formatWithDelta formats coverage with delta for display.
// Returns a string like "85.5% (↑2.1%)" or "83.2% (↓1.8%)".
export function formatWithDelta(currentPercentage: string, deltaValue: string): string {
  const deltaNum = parseFloat(deltaValue)
  const arrow = deltaNum >= 0 ? '↑' : '↓'
  const absDelta = Math.abs(deltaNum).toFixed(2)
  return `${currentPercentage}% (${arrow}${absDelta}%)`
}

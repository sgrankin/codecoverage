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
  // searchedCommits is the number of commits searched during lookback.
  searchedCommits?: number
}

// LoadOptions configures baseline loading behavior.
export interface LoadOptions extends Partial<gitnotes.Options> {
  // maxLookback is the maximum number of ancestor commits to search for a baseline.
  // Default is 50. Set to 0 to disable lookback (only check merge-base).
  maxLookback?: number
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

    // Write and push notes atomically with retry
    const success = await gitnotes.writeAndPush({commit, content, force: true}, options)
    if (!success) {
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

// DEFAULT_MAX_LOOKBACK is the default number of ancestor commits to search.
const DEFAULT_MAX_LOOKBACK = 50

// load loads baseline coverage from the merge-base commit with a target branch.
// If no baseline is found on the merge-base, it searches up to maxLookback ancestors.
export async function load(targetBranch: string, options: LoadOptions = {}): Promise<Result> {
  const maxLookback = options.maxLookback ?? DEFAULT_MAX_LOOKBACK

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

    // Try merge-base first
    const result = await tryReadBaseline(mergeBase, options)
    if (result.baseline) {
      core.info(`Loaded baseline: ${result.baseline.coveragePercentage}%`)
      return {...result, searchedCommits: 1}
    }
    if (result.parseError) {
      return {...result, searchedCommits: 1}
    }

    // No baseline on merge-base, search ancestors if lookback is enabled
    if (maxLookback <= 0) {
      core.info('No baseline coverage found for merge-base commit')
      return {baseline: null, commit: mergeBase, searchedCommits: 1}
    }

    core.info(`Searching up to ${maxLookback} ancestors for baseline...`)
    const ancestors = await gitnotes.listAncestors(mergeBase, maxLookback, options)

    // Skip first commit (it's the merge-base we already checked)
    for (let i = 1; i < ancestors.length; i++) {
      const commit = ancestors[i]!
      const ancestorResult = await tryReadBaseline(commit, options)
      if (ancestorResult.baseline) {
        core.info(
          `Found baseline at ancestor ${commit.substring(0, 8)} (${i} commits back): ${ancestorResult.baseline.coveragePercentage}%`
        )
        return {...ancestorResult, searchedCommits: i + 1}
      }
      if (ancestorResult.parseError) {
        // Found notes but couldn't parse - stop searching
        return {...ancestorResult, searchedCommits: i + 1}
      }
    }

    core.info(`No baseline found in ${ancestors.length} ancestors`)
    return {baseline: null, commit: mergeBase, searchedCommits: ancestors.length}
  } catch (error) {
    const err = error as Error
    core.warning(`Failed to load baseline: ${err.message}`)
    return {baseline: null, commit: null}
  }
}

// tryReadBaseline attempts to read and parse baseline from a commit.
async function tryReadBaseline(
  commit: string,
  options: Partial<gitnotes.Options>
): Promise<Result> {
  const content = await gitnotes.read(commit, options)
  if (!content) {
    return {baseline: null, commit}
  }

  const baseline = parse(content)
  if (!baseline) {
    core.warning(`Failed to parse baseline at ${commit.substring(0, 8)}`)
    return {baseline: null, commit, parseError: 'Invalid format'}
  }

  return {baseline, commit}
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
  const arrow = deltaNum > 0 ? '↑' : deltaNum < 0 ? '↓' : ''
  const absDelta = Math.abs(deltaNum).toFixed(2)
  if (deltaNum === 0) {
    return `${currentPercentage}% (${absDelta}%)`
  }
  return `${currentPercentage}% (${arrow}${absDelta}%)`
}

// HistoryEntry represents a single coverage data point in history.
export interface HistoryEntry {
  commit: string
  coveragePercentage: string
  timestamp: string
}

// collectHistory walks ancestors from startCommit and collects coverage data.
// Returns entries in chronological order (oldest first) for sparkline rendering.
// Stops when maxCount entries are found or no more ancestors exist.
export async function collectHistory(
  startCommit: string,
  maxCount: number,
  options: Partial<gitnotes.Options> = {}
): Promise<HistoryEntry[]> {
  if (maxCount <= 0) {
    return []
  }

  // Over-fetch ancestors since not all commits will have notes
  const ancestors = await gitnotes.listAncestors(startCommit, maxCount * 3, options)
  const entries: HistoryEntry[] = []

  for (const commit of ancestors) {
    if (entries.length >= maxCount) {
      break
    }

    const content = await gitnotes.read(commit, options)
    if (!content) {
      continue
    }

    const data = parse(content)
    if (!data) {
      continue
    }

    entries.push({
      commit,
      coveragePercentage: data.coveragePercentage,
      timestamp: data.timestamp
    })
  }

  // listAncestors returns newest-first, reverse for chronological order
  return entries.reverse()
}

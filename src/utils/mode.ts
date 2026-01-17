import * as github from '@actions/github'

/** Operating modes for the coverage action */
export type ActionMode = 'pr-check' | 'store-baseline'

/** Context information for mode detection */
export interface ModeContext {
  /** The mode the action is running in */
  mode: ActionMode
  /** Target branch for PR mode (e.g., 'main') */
  baseBranch?: string
  /** Whether this is a pull request event */
  isPullRequest: boolean
  /** The event name that triggered the action */
  eventName: string
  /** The ref that triggered the action */
  ref: string
}

/**
 * Minimal GitHub context interface for mode detection.
 * Allows injecting a fake for testing.
 */
export interface GithubContext {
  eventName: string
  ref: string
  payload: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pull_request?: any
  }
}

/**
 * Detect the operating mode based on GitHub context.
 *
 * Mode selection logic:
 * - PR events → 'pr-check' (calculate delta against baseline)
 * - Push to main/default branch → 'store-baseline' (store coverage as baseline)
 * - Other events → 'store-baseline'
 *
 * @param modeOverride Optional manual override for the mode
 * @param mainBranch The main branch name (default: 'main')
 * @param ctx Optional GitHub context (defaults to github.context, injectable for testing)
 */
export function detectMode(
  modeOverride?: string,
  mainBranch = 'main',
  ctx: GithubContext = github.context
): ModeContext {
  const eventName = ctx.eventName
  const ref = ctx.ref

  // Handle manual override
  if (modeOverride) {
    const mode = modeOverride as ActionMode
    if (mode !== 'pr-check' && mode !== 'store-baseline') {
      throw new Error(
        `Invalid mode override: ${modeOverride}. Must be 'pr-check' or 'store-baseline'`
      )
    }

    const isPullRequest = eventName === 'pull_request'
    const baseBranch = isPullRequest
      ? ctx.payload.pull_request?.base?.ref
      : undefined

    return {
      mode,
      baseBranch,
      isPullRequest,
      eventName,
      ref
    }
  }

  // Auto-detect based on event type
  if (eventName === 'pull_request') {
    const baseBranch = ctx.payload.pull_request?.base?.ref

    return {
      mode: 'pr-check',
      baseBranch,
      isPullRequest: true,
      eventName,
      ref
    }
  }

  // For push events or other triggers
  const isPushToMain =
    eventName === 'push' &&
    (ref === `refs/heads/${mainBranch}` || ref === mainBranch)

  return {
    mode: 'store-baseline',
    baseBranch: isPushToMain ? mainBranch : undefined,
    isPullRequest: false,
    eventName,
    ref
  }
}

/**
 * Get the namespace for coverage notes based on the branch.
 * This allows different branches (main, release-v1, etc.) to have
 * separate baseline coverage data.
 *
 * @param branch The branch name
 * @param prefix The namespace prefix (default: 'coverage')
 */
export function getNamespaceForBranch(
  branch: string,
  prefix = 'coverage'
): string {
  // Sanitize branch name for git ref compatibility
  const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${prefix}/${sanitized}`
}

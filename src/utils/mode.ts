import * as github from '@actions/github'

// ActionMode is the operating mode for the coverage action.
export type ActionMode = 'pr-check' | 'store-baseline'

// ModeContext contains context information for mode detection.
export interface ModeContext {
  // mode is the mode the action is running in.
  mode: ActionMode
  // baseBranch is the target branch for PR mode (e.g., 'main').
  baseBranch?: string
  // isPullRequest indicates whether this is a pull request event.
  isPullRequest: boolean
  // eventName is the event name that triggered the action.
  eventName: string
  // ref is the ref that triggered the action.
  ref: string
}

// PullRequestPayload is the relevant subset of a pull request event payload.
export interface PullRequestPayload {
  base?: {
    ref?: string
  }
  [key: string]: unknown
}

// GithubContext is the minimal GitHub context interface for mode detection.
export interface GithubContext {
  eventName: string
  ref: string
  payload: {
    pull_request?: PullRequestPayload
  }
}

// detectMode detects the operating mode based on GitHub context.
// PR events use 'pr-check' mode; push to main uses 'store-baseline' mode.
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
    const baseBranch = isPullRequest ? ctx.payload.pull_request?.base?.ref : undefined

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
    eventName === 'push' && (ref === `refs/heads/${mainBranch}` || ref === mainBranch)

  return {
    mode: 'store-baseline',
    baseBranch: isPushToMain ? mainBranch : undefined,
    isPullRequest: false,
    eventName,
    ref
  }
}

// getNamespaceForBranch returns the namespace for coverage notes based on the branch.
// This allows different branches (main, release-v1, etc.) to have separate baseline coverage data.
export function getNamespaceForBranch(branch: string, prefix = 'coverage'): string {
  // Sanitize branch name for git ref compatibility
  const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${prefix}/${sanitized}`
}

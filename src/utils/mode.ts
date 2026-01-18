import * as github from '@actions/github'

// Mode is the operating mode for the coverage action.
export type Mode = 'pr-check' | 'store-baseline'

// Context contains context information for mode detection.
export interface Context {
  // mode is the mode the action is running in.
  mode: Mode
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

// detect detects the operating mode based on GitHub context.
// PR events use 'pr-check' mode; push to main uses 'store-baseline' mode.
export function detect(
  modeOverride?: string,
  mainBranch = 'main',
  ctx: GithubContext = github.context
): Context {
  const eventName = ctx.eventName
  const ref = ctx.ref

  // Handle manual override
  if (modeOverride) {
    const mode = modeOverride as Mode
    if (mode !== 'pr-check' && mode !== 'store-baseline') {
      throw new Error(
        `Invalid mode override: ${modeOverride}. Must be 'pr-check' or 'store-baseline'`
      )
    }

    const isPullRequest = eventName === 'pull_request'
    const baseBranch = isPullRequest ? ctx.payload.pull_request?.base?.ref : undefined

    return {
      mode,
      ...(baseBranch && {baseBranch}),
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
      ...(baseBranch && {baseBranch}),
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
    ...(isPushToMain && {baseBranch: mainBranch}),
    isPullRequest: false,
    eventName,
    ref
  }
}

// namespaceForBranch returns the namespace for coverage notes based on the branch.
// This allows different branches (main, release-v1, etc.) to have separate baseline coverage data.
export function namespaceForBranch(branch: string, prefix = 'coverage'): string {
  // Sanitize branch name for git ref compatibility
  const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${prefix}/${sanitized}`
}

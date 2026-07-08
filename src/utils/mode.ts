import * as github from '@actions/github'

// Mode is the operating mode for the coverage action.
export type Mode = 'pr-check' | 'store-baseline'

// Context contains context information for mode detection.
export interface Context {
  // mode is the mode the action is running in.
  mode: Mode
  // baseBranch is the target branch for PR mode (empty string = none).
  baseBranch: string
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
// PR events use 'pr-check' mode; other events use 'store-baseline' mode.
// baseBranch — which gates baseline storage and names the notes namespace —
// is the PR's target branch for PR events. Otherwise it is mainBranch when
// the triggering ref is that branch: via a push, or via any event (schedule,
// workflow_dispatch) when store-baseline mode is explicitly forced.
export function detect(
  modeOverride?: string,
  mainBranch = 'main',
  ctx: GithubContext = github.context
): Context {
  const eventName = ctx.eventName
  const ref = ctx.ref
  const isPullRequest = eventName === 'pull_request'

  let mode: Mode
  if (modeOverride) {
    if (modeOverride !== 'pr-check' && modeOverride !== 'store-baseline') {
      throw new Error(
        `Invalid mode override: ${modeOverride}. Must be 'pr-check' or 'store-baseline'`
      )
    }
    mode = modeOverride
  } else {
    mode = isPullRequest ? 'pr-check' : 'store-baseline'
  }

  let baseBranch = ''
  if (isPullRequest) {
    baseBranch = ctx.payload.pull_request?.base?.ref ?? ''
  } else if (mode === 'store-baseline') {
    const isMainRef = ref === `refs/heads/${mainBranch}` || ref === mainBranch
    if (isMainRef && (eventName === 'push' || modeOverride === 'store-baseline')) {
      baseBranch = mainBranch
    }
  }

  return {mode, baseBranch, isPullRequest, eventName, ref}
}

// namespaceForBranch returns the namespace for coverage notes based on the branch.
// This allows different branches (main, release-v1, etc.) to have separate baseline coverage data.
export function namespaceForBranch(branch: string, prefix = 'coverage'): string {
  // Sanitize branch name for git ref compatibility
  const sanitized = branch.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${prefix}/${sanitized}`
}

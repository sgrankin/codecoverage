import * as core from '@actions/core'
import * as github from '@actions/github'
import * as diff from './diff.js'
import * as coverage from './general.js'

// COMMENT_MARKER identifies comments created by this action.
const COMMENT_MARKER = '<!-- codecoverage-action -->'

export type Annotation = {
  path: string
  start_line: number
  end_line: number
  message: string
}

export type PullRequestFiles = {
  [key: string]: number[]
}

// FetchDiff fetches the PR diff from the GitHub API.
// Returns the raw diff string, or throws an error.
export type FetchDiff = () => Promise<string>

// Comment represents a GitHub issue/PR comment.
export type Comment = {
  id: number
  body: string
}

// CommentOps provides operations for managing PR comments.
export interface CommentOps {
  list(): Promise<Comment[]>
  create(body: string): Promise<void>
  update(id: number, body: string): Promise<void>
}

// Client provides GitHub API operations for the coverage action.
export class Client {
  private fetchDiff: FetchDiff
  private commentOps: CommentOps

  constructor(token: string, baseURL: string, fetchDiff?: FetchDiff, commentOps?: CommentOps) {
    if (!token) {
      throw new Error('github_token is missing')
    }
    const client = github.getOctokit(token, {baseUrl: baseURL})
    this.fetchDiff =
      fetchDiff ??
      (async () => {
        const response = await client.rest.pulls.get({
          ...github.context.repo,
          pull_number: github.context.issue.number,
          mediaType: {format: 'diff'}
        })
        return response.data as unknown as string
      })
    this.commentOps = commentOps ?? {
      async list() {
        const response = await client.rest.issues.listComments({
          ...github.context.repo,
          issue_number: github.context.issue.number
        })
        return response.data.map(c => ({id: c.id, body: c.body ?? ''}))
      },
      async create(body: string) {
        await client.rest.issues.createComment({
          ...github.context.repo,
          issue_number: github.context.issue.number,
          body
        })
      },
      async update(id: number, body: string) {
        await client.rest.issues.updateComment({
          ...github.context.repo,
          comment_id: id,
          body
        })
      }
    }
  }

  async getPullRequestDiff(): Promise<PullRequestFiles> {
    let diffText: string
    try {
      diffText = await this.fetchDiff()
    } catch (error) {
      if (isDiffTooLarge(error)) {
        core.warning(
          'PR diff is too large for the GitHub API. Skipping coverage annotations for this PR.'
        )
        return {}
      }
      throw error
    }
    const fileLines = diff.parse(diffText)
    const prFiles: PullRequestFiles = {}
    for (const item of fileLines) {
      // Store raw line numbers - coalescing happens in buildAnnotations
      // where we have access to executable line info
      prFiles[item.filename] = item.addedLines
    }

    return prFiles
  }

  buildAnnotations(
    coverageFiles: coverage.File[],
    pullRequestFiles: PullRequestFiles
  ): Annotation[] {
    // Build lookup for O(1) access to coverage data
    const coverageByFile = new Map(coverageFiles.map(f => [f.fileName, f]))
    const annotations: Annotation[] = []

    // Only iterate files that are in the PR diff
    for (const [fileName, prFileLines] of Object.entries(pullRequestFiles)) {
      const current = coverageByFile.get(fileName)
      if (!current || prFileLines.length === 0) continue
      {
        // If file has zero coverage, just add a single notice on line 1
        if (current.coveredLineCount === 0) {
          annotations.push({
            path: current.fileName,
            start_line: 1,
            end_line: 1,
            message: 'This file has no test coverage'
          })
          continue
        }

        // Filter PR diff lines to only executable lines - whitespace-only
        // changes or comments shouldn't generate coverage annotations
        const executablePrLines = prFileLines.filter(line => current.executableLines.has(line))
        if (executablePrLines.length === 0) {
          continue
        }

        // Coalesce both coverage and PR ranges using executable line info
        // This bridges gaps where non-executable lines (comments, braces)
        // were either not covered or not modified
        const coverageRanges = coverage.coalesceWithGaps(
          current.missingLineNumbers,
          current.executableLines
        )
        const prFileRanges = coverage.coalesceWithGaps(executablePrLines, current.executableLines)
        const uncoveredRanges = coverage.intersectRanges(coverageRanges, prFileRanges)

        // Only annotate relevant line ranges
        for (const uRange of uncoveredRanges) {
          const message =
            uRange.end_line > uRange.start_line
              ? `Changed lines ${uRange.start_line}-${uRange.end_line} are not tested`
              : `Changed line ${uRange.start_line} is not tested`
          annotations.push({
            path: current.fileName,
            start_line: uRange.start_line,
            end_line: uRange.end_line,
            message
          })
        }
      }
    }
    core.info(`Annotation count: ${annotations.length}`)
    return annotations
  }

  // upsertComment creates or updates the coverage comment on the PR.
  // Returns true if successful, false if the comment could not be posted.
  async upsertComment(body: string): Promise<boolean> {
    const markedBody = `${COMMENT_MARKER}\n${body}`
    try {
      const comments = await this.commentOps.list()
      const existing = comments.find(c => c.body.includes(COMMENT_MARKER))
      if (existing) {
        await this.commentOps.update(existing.id, markedBody)
        core.info('Updated existing coverage comment')
      } else {
        await this.commentOps.create(markedBody)
        core.info('Created coverage comment')
      }
      return true
    } catch (error) {
      if (isCommentError(error)) {
        core.warning(`Could not post coverage comment: ${(error as Error).message}`)
        return false
      }
      throw error
    }
  }
}

// isCommentError checks if an error is a recoverable comment API error.
// These include PR closed/merged, no permissions, not found, etc.
function isCommentError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as {status: number}).status
    // 403 = forbidden, 404 = not found (PR closed), 422 = unprocessable
    return status === 403 || status === 404 || status === 422
  }
  return false
}

// isDiffTooLarge checks if an error indicates the PR diff is too large.
// GitHub API returns 403 or 422 with messages about diff size limits.
function isDiffTooLarge(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const apiError = error as {status: number; message?: string}
    const message = apiError.message?.toLowerCase() || ''
    if (apiError.status === 403 || apiError.status === 422 || apiError.status === 406) {
      return (
        message.includes('diff') ||
        message.includes('too large') ||
        message.includes('not available')
      )
    }
  }
  return false
}

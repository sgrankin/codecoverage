import * as core from '@actions/core'
import * as diff from './diff.js'
import * as github from '@actions/github'
import * as coverage from './general.js'

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

// Client provides GitHub API operations for the coverage action.
export class Client {
  private fetchDiff: FetchDiff

  constructor(token: string, baseURL: string, fetchDiff?: FetchDiff) {
    if (!token) {
      throw new Error('github_token is missing')
    }
    this.fetchDiff =
      fetchDiff ??
      (async () => {
        const client = github.getOctokit(token, {baseUrl: baseURL})
        const response = await client.rest.pulls.get({
          ...github.context.repo,
          pull_number: github.context.issue.number,
          mediaType: {format: 'diff'}
        })
        return response.data as unknown as string
      })
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
    const annotations: Annotation[] = []
    for (const current of coverageFiles) {
      // Only annotate relevant files
      const prFileLines = pullRequestFiles[current.fileName]
      if (prFileLines && prFileLines.length > 0) {
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

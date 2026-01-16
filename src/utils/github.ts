import * as core from '@actions/core'
import * as diff from './diff'
import * as github from '@actions/github'
import {
  CoverageFile,
  coalesceLineNumbersWithGaps,
  intersectLineRanges
} from './general'
import {Octokit} from 'octokit'

export class GithubUtil {
  private client: Octokit

  constructor(token: string, baseUrl: string) {
    if (!token) {
      throw new Error('GITHUB_TOKEN is missing')
    }
    this.client = new Octokit({auth: token, baseUrl})
  }

  getPullRequestRef(): string {
    const pullRequest = github.context.payload.pull_request
    return pullRequest
      ? pullRequest.head.ref
      : github.context.ref.replace('refs/heads/', '')
  }

  async getPullRequestDiff(): Promise<PullRequestFiles> {
    const pull_number = github.context.issue.number
    const response = await this.client.rest.pulls.get({
      ...github.context.repo,
      pull_number,
      mediaType: {
        format: 'diff'
      }
    })
    const fileLines = diff.parseGitDiff(response.data as unknown as string)
    const prFiles: PullRequestFiles = {}
    for (const item of fileLines) {
      // Store raw line numbers - coalescing happens in buildAnnotations
      // where we have access to executable line info
      prFiles[item.filename] = item.addedLines
    }

    return prFiles
  }

  /**
   * https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run
   * https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#update-a-check-run
   *
   * Returns: response status code, or -1 if branch was deleted (PR merged)
   */
  async annotate(input: InputAnnotateParams): Promise<number> {
    if (input.annotations.length === 0) {
      return 0
    }
    // github API lets you post 50 annotations at a time
    const chunkSize = 50
    const chunks: Annotations[][] = []
    for (let i = 0; i < input.annotations.length; i += chunkSize) {
      chunks.push(input.annotations.slice(i, i + chunkSize))
    }
    let lastResponseStatus = 0
    let checkId = 0
    for (let i = 0; i < chunks.length; i++) {
      let status: 'in_progress' | 'completed' | 'queued' = 'in_progress'
      let conclusion:
        | 'success'
        | 'action_required'
        | 'cancelled'
        | 'failure'
        | 'neutral'
        | 'skipped'
        | 'stale'
        | 'timed_out'
        | undefined = undefined
      if (i === chunks.length - 1) {
        status = 'completed'
        conclusion = 'success'
      }
      const params = {
        ...github.context.repo,
        name: 'Annotate',
        head_sha: input.referenceCommitHash,
        status,
        ...(conclusion && {conclusion}),
        output: {
          title: 'Coverage Tool',
          summary: 'Missing Coverage',
          annotations: chunks[i]
        }
      }
      try {
        let response
        if (i === 0) {
          response = await this.client.rest.checks.create({
            ...params
          })
          checkId = response.data.id
        } else {
          response = await this.client.rest.checks.update({
            ...params,
            check_run_id: checkId,
            status: 'in_progress' as const
          })
        }
        core.info(response.data.output.annotations_url)
        lastResponseStatus = response.status
      } catch (error) {
        // Check if this is a "branch deleted" error (typically 422 with specific message)
        if (isBranchDeletedError(error)) {
          core.warning(
            'PR branch appears to be deleted (PR may have been merged). ' +
              'Skipping annotations.'
          )
          return -1
        }
        throw error
      }
    }
    return lastResponseStatus
  }

  buildAnnotations(
    coverageFiles: CoverageFile[],
    pullRequestFiles: PullRequestFiles
  ): Annotations[] {
    const annotations: Annotations[] = []
    for (const current of coverageFiles) {
      // Only annotate relevant files
      const prFileLines = pullRequestFiles[current.fileName]
      if (prFileLines && prFileLines.length > 0) {
        // Coalesce both coverage and PR ranges using executable line info
        // This bridges gaps where non-executable lines (comments, braces)
        // were either not covered or not modified
        const coverageRanges = coalesceLineNumbersWithGaps(
          current.missingLineNumbers,
          current.executableLines
        )
        const prFileRanges = coalesceLineNumbersWithGaps(
          prFileLines,
          current.executableLines
        )
        const uncoveredRanges = intersectLineRanges(
          coverageRanges,
          prFileRanges
        )

        // Only annotate relevant line ranges
        for (const uRange of uncoveredRanges) {
          const message =
            uRange.end_line > uRange.start_line
              ? 'These lines are not covered by a test'
              : 'This line is not covered by a test'
          annotations.push({
            path: current.fileName,
            start_line: uRange.start_line,
            end_line: uRange.end_line,
            annotation_level: 'warning',
            message
          })
        }
      }
    }
    core.info(`Annotation count: ${annotations.length}`)
    return annotations
  }
}

/**
 * Check if an error indicates the PR branch was deleted.
 * GitHub API returns 422 with "No commit found for SHA" when the ref is gone.
 */
function isBranchDeletedError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const apiError = error as {status: number; message?: string}
    if (apiError.status === 422) {
      const message = apiError.message?.toLowerCase() || ''
      return (
        message.includes('no commit found') ||
        message.includes('sha') ||
        message.includes('not found')
      )
    }
  }
  return false
}

type InputAnnotateParams = {
  referenceCommitHash: string
  annotations: Annotations[]
}

type Annotations = {
  path: string
  start_line: number
  end_line: number
  start_column?: number
  end_column?: number
  annotation_level: 'notice' | 'warning' | 'failure'
  message: string
}

type PullRequestFiles = {
  [key: string]: number[]
}

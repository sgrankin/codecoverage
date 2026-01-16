import * as core from '@actions/core'
import * as diff from './diff'
import * as github from '@actions/github'
import {
  CoverageFile,
  coalesceLineNumbersWithGaps,
  intersectLineRanges
} from './general'
import {Octokit} from 'octokit'

export type Annotation = {
  path: string
  start_line: number
  end_line: number
  message: string
}

export type PullRequestFiles = {
  [key: string]: number[]
}

export class GithubUtil {
  private client: Octokit

  constructor(token: string, baseUrl: string) {
    if (!token) {
      throw new Error('GITHUB_TOKEN is missing')
    }
    this.client = new Octokit({auth: token, baseUrl})
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

  buildAnnotations(
    coverageFiles: CoverageFile[],
    pullRequestFiles: PullRequestFiles
  ): Annotation[] {
    const annotations: Annotation[] = []
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
            message
          })
        }
      }
    }
    core.info(`Annotation count: ${annotations.length}`)
    return annotations
  }
}

import {env} from 'node:process'
import * as fs from 'node:fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {correctLineTotals, filterCoverageByFile} from './utils/general.js'
import {parseLCov} from './utils/lcov.js'
import {parseCobertura} from './utils/cobertura.js'
import {parseGoCoverage} from './utils/gocoverage.js'
import {GithubUtil} from './utils/github.js'

const SUPPORTED_FORMATS = ['lcov', 'cobertura', 'go']

interface FileCoverage {
  file: string
  totalLines: number
  coveredLines: number
}

interface SummaryParams {
  coveragePercentage: string
  totalLines: number
  coveredLines: number
  filesAnalyzed: number
  annotationCount: number
  files: FileCoverage[]
}

export function generateSummary(params: SummaryParams): string {
  const {
    coveragePercentage,
    totalLines,
    coveredLines,
    filesAnalyzed, //pants
    annotationCount,
    files
  } = params
  const uncoveredLines = totalLines - coveredLines

  let statusEmoji = '🔴'
  if (parseFloat(coveragePercentage) >= 80) {
    statusEmoji = '🟢'
  } else if (parseFloat(coveragePercentage) >= 60) {
    statusEmoji = '🟡'
  }

  // Build file coverage table, sorted by filename
  const sortedFiles = [...files].sort((a, b) => a.file.localeCompare(b.file))
  const fileRows = sortedFiles
    .map(f => {
      const pct =
        f.totalLines > 0
          ? ((f.coveredLines / f.totalLines) * 100).toFixed(1)
          : '0.0'
      return `| ${f.file} | ${f.totalLines.toLocaleString()} | ${f.coveredLines.toLocaleString()} | ${pct}% |`
    })
    .join('\n')

  return `## ${statusEmoji} Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | ${coveragePercentage}% |
| **Covered Lines** | ${coveredLines.toLocaleString()} |
| **Uncovered Lines** | ${uncoveredLines.toLocaleString()} |
| **Total Lines** | ${totalLines.toLocaleString()} |
| **Files Analyzed** | ${filesAnalyzed.toLocaleString()} |

${annotationCount > 0 ? `⚠️ **${annotationCount} annotation${annotationCount === 1 ? '' : 's'}** added for uncovered lines in this PR.` : '✅ No new uncovered lines detected in this PR.'}

### File Coverage

| File | Total Lines | Covered | Coverage |
| ---- | ----------- | ------- | -------- |
${fileRows}
`
}

/** Starting Point of the Github Action*/
export async function play(): Promise<void> {
  try {
    if (github.context.eventName !== 'pull_request') {
      core.info('Pull request not detected. Exiting early.')
      return
    }
    core.info('Performing Code Coverage Analysis')
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN', {required: true})
    const GITHUB_BASE_URL = core.getInput('GITHUB_BASE_URL')
    const COVERAGE_FILE_PATH = core.getInput('COVERAGE_FILE_PATH', {
      required: true
    })

    let COVERAGE_FORMAT = core.getInput('COVERAGE_FORMAT')
    if (!COVERAGE_FORMAT) {
      COVERAGE_FORMAT = 'lcov'
    }
    if (!SUPPORTED_FORMATS.includes(COVERAGE_FORMAT)) {
      throw new Error(
        `COVERAGE_FORMAT must be one of ${SUPPORTED_FORMATS.join(',')}`
      )
    }

    const debugOpts: Record<string, boolean> = {}
    const DEBUG = core.getInput('DEBUG')
    if (DEBUG) {
      const debugParts = DEBUG.split(',')
      for (const part of debugParts) {
        debugOpts[part] = true
      }
    }

    // TODO perhaps make base path configurable in case coverage artifacts are
    // not produced on the Github worker?
    const workspacePath = env.GITHUB_WORKSPACE || ''
    core.info(`Workspace: ${workspacePath}`)

    // 1. Parse coverage file
    let parsedCov
    if (COVERAGE_FORMAT === 'cobertura') {
      parsedCov = await parseCobertura(COVERAGE_FILE_PATH, workspacePath)
    } else if (COVERAGE_FORMAT === 'go') {
      // Assuming that go.mod is available in working directory
      parsedCov = await parseGoCoverage(COVERAGE_FILE_PATH, 'go.mod')
    } else {
      // lcov default
      parsedCov = await parseLCov(COVERAGE_FILE_PATH, workspacePath)
    }
    // Correct line totals
    parsedCov = correctLineTotals(parsedCov)

    // Sum up lines.found for each entry in parsedCov
    const totalLines = parsedCov.reduce(
      (acc, entry) => acc + entry.lines.found,
      0
    )
    const coveredLines = parsedCov.reduce(
      (acc, entry) => acc + entry.lines.hit,
      0
    )
    const coveragePercentage =
      totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(2) : '0.00'
    core.info(
      `Parsing done. ${parsedCov.length} files parsed. Total lines: ${totalLines}. Covered lines: ${coveredLines}. Coverage: ${coveragePercentage}%`
    )

    // Set outputs for coverage stats
    core.setOutput('coverage_percentage', coveragePercentage)
    core.setOutput('files_analyzed', parsedCov.length)

    // 2. Filter Coverage By File Name
    const coverageByFile = filterCoverageByFile(parsedCov)
    core.info('Filter done')
    if (debugOpts['coverage']) {
      core.info(`Coverage:`)
      for (const item of coverageByFile) {
        core.info(JSON.stringify(item))
      }
    }
    const githubUtil = new GithubUtil(GITHUB_TOKEN, GITHUB_BASE_URL)

    // 3. Get current pull request files
    const pullRequestFiles = await githubUtil.getPullRequestDiff()
    if (debugOpts['pr_lines_added']) {
      core.info(`PR lines added: ${JSON.stringify(pullRequestFiles)}`)
    }
    const annotations = githubUtil.buildAnnotations(
      coverageByFile,
      pullRequestFiles
    )
    core.setOutput('annotation_count', annotations.length)

    // 4. Annotate in github
    await githubUtil.annotate({
      referenceCommitHash: githubUtil.getPullRequestRef(),
      annotations
    })
    core.info('Annotation done')

    // 5. Write step summary
    const STEP_SUMMARY = core.getInput('STEP_SUMMARY')
    const summaryPath = env.GITHUB_STEP_SUMMARY
    if (summaryPath && STEP_SUMMARY !== 'false') {
      const files: FileCoverage[] = parsedCov.map(entry => ({
        file: entry.file,
        totalLines: entry.lines.found,
        coveredLines: entry.lines.hit
      }))
      const summary = generateSummary({
        coveragePercentage,
        totalLines,
        coveredLines,
        filesAnalyzed: parsedCov.length,
        annotationCount: annotations.length,
        files
      })
      fs.appendFileSync(summaryPath, summary)
      core.info('Step summary written')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.info(JSON.stringify(error))
  }
}

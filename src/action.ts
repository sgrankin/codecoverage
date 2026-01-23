import {env} from 'node:process'

import * as core from '@actions/core'
import * as baseline from './utils/baseline.ts'
import * as cobertura from './utils/cobertura.ts'
import * as files from './utils/files.ts'
import * as coverage from './utils/general.ts'
import * as github from './utils/github.ts'
import type * as gitnotes from './utils/gitnotes.ts'
import * as gocov from './utils/gocoverage.ts'
import * as lcov from './utils/lcov.ts'
import * as mode from './utils/mode.ts'
import * as simplecov from './utils/simplecov.ts'
import * as summary from './utils/summary.ts'

const SUPPORTED_FORMATS = ['lcov', 'cobertura', 'go', 'simplecov']
const DEBUG_MAX_FILES = 10
const DEBUG_MAX_LINE_LENGTH = 1024

// linesToRanges converts an array of line numbers to a compact range string.
// Example: [1,2,3,5,7,8,9] => "1-3,5,7-9"
function linesToRanges(lines: number[]): string {
  if (lines.length === 0) return ''
  const sorted = [...lines].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]!
  let end = start
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    if (n === end + 1) {
      end = n
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
      start = n
      end = n
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(',')
}

// truncate limits a string to maxLen, appending "..." if truncated.
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen - 3)}...`
}

// GitHubOps defines the GitHub API operations needed by the action.
export interface GitHubOps {
  getPullRequestDiff(): Promise<github.PullRequestFiles>
  buildAnnotations(
    coverageFiles: coverage.File[],
    pullRequestFiles: github.PullRequestFiles
  ): github.Annotation[]
  upsertComment(body: string): Promise<boolean>
}

// BaselineOps defines baseline storage and retrieval operations.
export interface BaselineOps {
  store(
    data: {
      coveragePercentage: string
      totalLines: number
      coveredLines: number
    },
    options: Partial<gitnotes.Options>
  ): Promise<boolean>
  load(baseBranch: string, options: baseline.LoadOptions): Promise<baseline.Result>
  collectHistory(
    startCommit: string,
    maxCount: number,
    options: Partial<gitnotes.Options>
  ): Promise<baseline.HistoryEntry[]>
}

// Dependencies defines injectable dependencies for the action.
export interface Dependencies {
  // createGitHub is a factory to create GitHubOps instance.
  createGitHub: (token: string, baseURL: string) => GitHubOps
  // baseline provides baseline storage/retrieval operations.
  baseline: BaselineOps
}

// defaultDeps returns the production dependencies.
function defaultDeps(): Dependencies {
  return {
    createGitHub: (token, baseURL) => new github.Client(token, baseURL),
    baseline: {
      store: baseline.store,
      load: baseline.load,
      collectHistory: baseline.collectHistory
    }
  }
}

// DiffStats contains coverage statistics for the PR diff.
interface DiffStats {
  coveredLines: number
  totalLines: number
}

// calculateDiffStats computes coverage statistics for lines in the PR diff.
function calculateDiffStats(
  coverageByFile: coverage.File[],
  pullRequestFiles: github.PullRequestFiles
): DiffStats {
  let coveredLines = 0
  let totalLines = 0

  const coverageByFileName = new Map(coverageByFile.map(item => [item.fileName, item]))

  for (const [file, diffLines] of Object.entries(pullRequestFiles)) {
    const cov = coverageByFileName.get(file)
    if (!cov || diffLines.length === 0) continue

    // Only count executable lines in the diff
    const executableDiffLines = diffLines.filter(line => cov.executableLines.has(line))
    totalLines += executableDiffLines.length

    // Count covered lines (executable lines not in missing)
    const missingSet = new Set(cov.missingLineNumbers)
    for (const line of executableDiffLines) {
      if (!missingSet.has(line)) {
        coveredLines++
      }
    }
  }

  return {coveredLines, totalLines}
}

// generateSummary creates the coverage summary markdown.
function generateSummary(
  parsedCov: coverage.Parsed,
  coveragePercentage: string,
  totalLines: number,
  coveredLines: number,
  coverageDelta: string,
  baselinePercentage: string,
  diffStats: DiffStats,
  coverageHistory: number[] = [],
  headerText: string = 'Code Coverage Report'
): string {
  const fileStats: summary.FileCoverage[] = parsedCov.map(entry => ({
    file: entry.file,
    totalLines: entry.lines.found,
    coveredLines: entry.lines.hit,
    package: entry.package ?? ''
  }))
  return summary.generate({
    coveragePercentage,
    totalLines,
    coveredLines,
    filesAnalyzed: parsedCov.length,
    files: fileStats,
    coverageDelta,
    baselinePercentage,
    diffCoveredLines: diffStats.coveredLines,
    diffTotalLines: diffStats.totalLines,
    coverageHistory,
    headerText
  })
}

// parseCoverageFiles parses coverage files and computes aggregate statistics.
async function parseCoverageFiles(
  coverageFilePath: string,
  coverageFormat: string,
  workspacePath: string
): Promise<{
  parsedCov: coverage.Parsed
  totalLines: number
  coveredLines: number
  coveragePercentage: string
}> {
  // Expand file paths (supports globs and multiple paths)
  const coverageFiles = await files.expand(coverageFilePath)
  if (coverageFiles.length === 0) {
    throw new Error(`No coverage files found matching: ${coverageFilePath}`)
  }
  core.info(`Found ${coverageFiles.length} coverage file(s)`)

  // Parse all coverage files and collect entries
  const allEntries: coverage.Entry[] = []
  for (const covFile of coverageFiles) {
    let fileCov: coverage.Parsed
    if (coverageFormat === 'cobertura') {
      fileCov = await cobertura.parse(covFile, workspacePath)
    } else if (coverageFormat === 'go') {
      fileCov = await gocov.parse(covFile, 'go.mod')
    } else if (coverageFormat === 'simplecov') {
      fileCov = await simplecov.parse(covFile, workspacePath)
    } else {
      fileCov = await lcov.parse(covFile, workspacePath)
    }
    for (const entry of fileCov) {
      allEntries.push(entry)
    }
  }
  let parsedCov = allEntries

  // Merge coverage from multiple test runs
  parsedCov = coverage.mergeByFile(parsedCov)
  parsedCov = coverage.correctTotals(parsedCov)

  // Calculate totals
  const totalLines = parsedCov.reduce((acc, entry) => acc + entry.lines.found, 0)
  const coveredLines = parsedCov.reduce((acc, entry) => acc + entry.lines.hit, 0)
  const coveragePercentage =
    totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(2) : '0.00'

  return {parsedCov, totalLines, coveredLines, coveragePercentage}
}

// play is the entry point of the GitHub Action.
export async function play(deps: Dependencies = defaultDeps()): Promise<void> {
  try {
    core.info('Performing Code Coverage Analysis')

    // Get inputs
    const githubToken = core.getInput('github_token', {required: true})
    const githubBaseURL = core.getInput('github_base_url')
    const coverageFilePath = core.getInput('coverage_file_path', {
      required: true
    })
    const modeOverride = core.getInput('mode')
    const calculateDeltaInput = core.getInput('calculate_delta') !== 'false'
    const noteNamespace = core.getInput('note_namespace') || 'coverage'
    const deltaPrecision = parseInt(core.getInput('delta_precision') || '2', 10)
    const maxAnnotations = parseInt(core.getInput('max_annotations') || '10', 10)
    const maxLookback = parseInt(core.getInput('max_lookback') || '50', 10)
    const sparklineCount = parseInt(core.getInput('sparkline_count') || '10', 10)
    const debugOutput = core.getInput('debug_output') !== 'false'
    const prCommentHeader: string = core.getInput('pr_comment_header') || 'Code Coverage Report'

    const coverageFormat = core.getInput('coverage_format') || 'lcov'
    if (!SUPPORTED_FORMATS.includes(coverageFormat)) {
      throw new Error(`coverage_format must be one of ${SUPPORTED_FORMATS.join(',')}`)
    }

    const workspacePath = env.GITHUB_WORKSPACE ?? ''
    core.info(`Workspace: ${workspacePath}`)

    // Detect operating mode
    const ctx = mode.detect(modeOverride)
    core.info(`Mode: ${ctx.mode} (event: ${ctx.eventName})`)
    core.setOutput('mode', ctx.mode)

    // For PR events, get diff first to optimize memory usage during parsing.
    // Only files in the diff need full line details; others just need summary stats.
    let pullRequestFiles: github.PullRequestFiles = {}
    let gh: GitHubOps | undefined
    if (ctx.isPullRequest) {
      gh = deps.createGitHub(githubToken, githubBaseURL)
      pullRequestFiles = await gh.getPullRequestDiff()
      core.info(`Diff contains ${Object.keys(pullRequestFiles).length} files`)
    }

    // Parse coverage data
    const {parsedCov, totalLines, coveredLines, coveragePercentage} = await parseCoverageFiles(
      coverageFilePath,
      coverageFormat,
      workspacePath
    )

    core.info(
      `Parsing done. ${parsedCov.length} files parsed. Total lines: ${totalLines}. Covered lines: ${coveredLines}. Coverage: ${coveragePercentage}%`
    )

    // Set basic outputs
    core.setOutput('coverage_percentage', coveragePercentage)
    core.setOutput('files_analyzed', parsedCov.length)

    // Variables for delta calculation (empty = not computed)
    let coverageDelta = ''
    let baselinePercentage = ''
    let coverageHistory: number[] = []

    // Handle mode-specific logic
    if (ctx.mode === 'store-baseline') {
      // Store baseline mode: save coverage to git notes
      if (ctx.baseBranch) {
        const namespace = mode.namespaceForBranch(ctx.baseBranch, noteNamespace)
        core.info(`Storing baseline with namespace: ${namespace}`)

        await deps.baseline.store(
          {coveragePercentage, totalLines, coveredLines},
          {cwd: workspacePath, namespace}
        )
      } else {
        core.info('Skipping baseline storage (not on main branch)')
      }

      // In store-baseline mode on non-PR events, we're done (no annotations)
      if (!ctx.isPullRequest) {
        // Write summary if enabled
        const stepSummary = core.getInput('step_summary')
        if (stepSummary !== 'false') {
          const fileStats: summary.FileCoverage[] = parsedCov.map(entry => ({
            file: entry.file,
            totalLines: entry.lines.found,
            coveredLines: entry.lines.hit,
            package: entry.package ?? ''
          }))
          const summaryText = summary.generate({
            coveragePercentage,
            totalLines,
            coveredLines,
            filesAnalyzed: parsedCov.length,
            files: fileStats,
            coverageDelta: '',
            baselinePercentage: '',
            diffCoveredLines: 0,
            diffTotalLines: 0,
            coverageHistory: [],
            headerText: prCommentHeader
          })
          await core.summary.addRaw(summaryText).write()
          core.info('Step summary written')
        }
        return
      }
    }

    // PR Check mode (or store-baseline mode on PR event): calculate delta and create annotations
    if (calculateDeltaInput && ctx.baseBranch) {
      const namespace = mode.namespaceForBranch(ctx.baseBranch, noteNamespace)
      core.info(`Loading baseline from namespace: ${namespace}`)

      const baselineResult = await deps.baseline.load(ctx.baseBranch, {
        cwd: workspacePath,
        namespace,
        maxLookback
      })

      if (baselineResult.baseline) {
        baselinePercentage = baselineResult.baseline.coveragePercentage
        coverageDelta = baseline.delta(coveragePercentage, baselinePercentage, deltaPrecision)
        core.info(`Coverage delta: ${coverageDelta}`)
        core.setOutput('coverage_delta', coverageDelta)
        core.setOutput('baseline_percentage', baselinePercentage)

        // Collect coverage history for sparkline
        if (sparklineCount > 0 && baselineResult.commit) {
          // Collect sparklineCount-1 historical entries, then add current = sparklineCount total
          const history = await deps.baseline.collectHistory(
            baselineResult.commit,
            sparklineCount - 1,
            {
              cwd: workspacePath,
              namespace
            }
          )
          coverageHistory = history.map(h => parseFloat(h.coveragePercentage))
          // Add current coverage as the newest point
          coverageHistory.push(parseFloat(coveragePercentage))
          core.info(`Collected ${coverageHistory.length} data points for sparkline`)
        }
      } else {
        core.info('No baseline found, showing absolute coverage only')
      }
    }

    // Only create annotations for PR events
    let annotationCount = 0
    let diffStats: DiffStats = {coveredLines: 0, totalLines: 0}
    if (ctx.isPullRequest && gh) {
      const coverageByFile = coverage.filterByFile(parsedCov)
      core.info('Filter done')

      // pullRequestFiles was already fetched above for parse optimization
      diffStats = calculateDiffStats(coverageByFile, pullRequestFiles)
      core.info(`Diff coverage: ${diffStats.coveredLines}/${diffStats.totalLines}`)

      const annotations = gh.buildAnnotations(coverageByFile, pullRequestFiles)
      annotationCount = annotations.length
      core.setOutput('annotation_count', annotationCount)

      // Debug output: combined per-file dump (diff + coverage + annotations)
      if (debugOutput) {
        // Build coverage lookup by file
        const coverageByFileName = new Map(coverageByFile.map(item => [item.fileName, item]))
        // Build annotations lookup by file
        const annotationsByFile = new Map<string, github.Annotation[]>()
        for (const ann of annotations) {
          const list = annotationsByFile.get(ann.path) || []
          list.push(ann)
          annotationsByFile.set(ann.path, list)
        }

        // Find files that are in both diff and coverage
        const filesInBoth = Object.keys(pullRequestFiles).filter(f => coverageByFileName.has(f))
        const filesToShow = filesInBoth.slice(0, DEBUG_MAX_FILES)
        const skippedCount = filesInBoth.length - filesToShow.length

        core.startGroup('Debug: PR files with coverage data')
        for (const file of filesToShow) {
          const diffLines = pullRequestFiles[file] ?? []
          const cov = coverageByFileName.get(file)!
          const fileAnnotations = annotationsByFile.get(file) || []
          const annotationRanges = fileAnnotations.map(a =>
            a.start_line === a.end_line ? `${a.start_line}` : `${a.start_line}-${a.end_line}`
          )
          const line = truncate(
            `file: ${file}, diff: ${linesToRanges(diffLines)}, missing: ${linesToRanges(cov.missingLineNumbers)}, annotations: ${annotationRanges.join(',')}`,
            DEBUG_MAX_LINE_LENGTH
          )
          core.info(line)
        }
        if (skippedCount > 0) {
          core.info(`... and ${skippedCount} more files`)
        }
        core.endGroup()
      }

      // Emit annotations (limited to maxAnnotations)
      const annotationsToEmit = annotations.slice(0, maxAnnotations)
      for (const annotation of annotationsToEmit) {
        core.notice(annotation.message, {
          file: annotation.path,
          startLine: annotation.start_line,
          endLine: annotation.end_line
        })
      }
      if (annotations.length > maxAnnotations) {
        core.info(
          `Showing ${maxAnnotations} of ${annotations.length} annotations (limited by max_annotations)`
        )
      }
      core.info('Annotations emitted')

      // Post PR comment if enabled
      const prComment = core.getInput('pr_comment')
      if (prComment === 'true') {
        const summaryText = generateSummary(
          parsedCov,
          coveragePercentage,
          totalLines,
          coveredLines,
          coverageDelta,
          baselinePercentage,
          diffStats,
          coverageHistory,
          prCommentHeader
        )
        await gh.upsertComment(summaryText)
      }
    } else {
      core.setOutput('annotation_count', 0)
    }

    // Write step summary
    const stepSummary = core.getInput('step_summary')
    if (stepSummary !== 'false') {
      const summaryText = generateSummary(
        parsedCov,
        coveragePercentage,
        totalLines,
        coveredLines,
        coverageDelta,
        baselinePercentage,
        diffStats,
        coverageHistory,
        prCommentHeader
      )
      await core.summary.addRaw(summaryText).write()
      core.info('Step summary written')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.info(JSON.stringify(error))
  }
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test.each([
    {lines: [], expected: ''},
    {lines: [5], expected: '5'},
    {lines: [1, 2, 3], expected: '1-3'},
    {lines: [1, 2, 3, 5, 7, 8, 9], expected: '1-3,5,7-9'},
    {lines: [10, 20, 30], expected: '10,20,30'},
    {lines: [3, 1, 2], expected: '1-3'} // unsorted input
  ])('linesToRanges($lines) = $expected', ({lines, expected}) => {
    expect(linesToRanges(lines)).toBe(expected)
  })

  test.each([
    {input: 'short', maxLen: 10, expected: 'short'},
    {input: 'exactly10!', maxLen: 10, expected: 'exactly10!'},
    {input: 'this is too long', maxLen: 10, expected: 'this is...'},
    {input: 'abc', maxLen: 3, expected: 'abc'} // at limit, no truncation
  ])('truncate($input, $maxLen) = $expected', ({input, maxLen, expected}) => {
    expect(truncate(input, maxLen)).toBe(expected)
  })
}

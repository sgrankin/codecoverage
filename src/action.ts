import {env} from 'node:process'

import * as core from '@actions/core'
import * as baseline from './utils/baseline.js'
import * as cobertura from './utils/cobertura.js'
import * as files from './utils/files.js'
import * as coverage from './utils/general.js'
import * as github from './utils/github.js'
import type * as gitnotes from './utils/gitnotes.js'
import * as gocov from './utils/gocoverage.js'
import * as lcov from './utils/lcov.js'
import * as mode from './utils/mode.js'
import * as summary from './utils/summary.js'

const SUPPORTED_FORMATS = ['lcov', 'cobertura', 'go']

// GitHubOps defines the GitHub API operations needed by the action.
export interface GitHubOps {
  getPullRequestDiff(): Promise<github.PullRequestFiles>
  buildAnnotations(
    coverageFiles: coverage.File[],
    pullRequestFiles: github.PullRequestFiles
  ): github.Annotation[]
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
  load(
    baseBranch: string,
    options: Partial<gitnotes.Options>
  ): Promise<{baseline: baseline.Data | null; commit: string | null}>
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
      load: baseline.load
    }
  }
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

  // Parse all coverage files and merge results
  let parsedCov: coverage.Parsed = []
  for (const covFile of coverageFiles) {
    let fileCov: coverage.Parsed
    if (coverageFormat === 'cobertura') {
      fileCov = await cobertura.parse(covFile, workspacePath)
    } else if (coverageFormat === 'go') {
      fileCov = await gocov.parse(covFile, 'go.mod')
    } else {
      fileCov = await lcov.parse(covFile, workspacePath)
    }
    parsedCov = parsedCov.concat(fileCov)
  }

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
            annotationCount: 0,
            files: fileStats,
            coverageDelta: '',
            baselinePercentage: ''
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
        namespace
      })

      if (baselineResult.baseline) {
        baselinePercentage = baselineResult.baseline.coveragePercentage
        coverageDelta = baseline.delta(coveragePercentage, baselinePercentage, deltaPrecision)
        core.info(`Coverage delta: ${coverageDelta}`)
        core.setOutput('coverage_delta', coverageDelta)
        core.setOutput('baseline_percentage', baselinePercentage)
      } else {
        core.info('No baseline found, showing absolute coverage only')
      }
    }

    // Only create annotations for PR events
    let annotationCount = 0
    if (ctx.isPullRequest) {
      const coverageByFile = coverage.filterByFile(parsedCov)
      core.info('Filter done')

      const gh = deps.createGitHub(githubToken, githubBaseURL)
      const pullRequestFiles = await gh.getPullRequestDiff()

      // Debug output: scoped to files in the diff
      const prFileSet = new Set(Object.keys(pullRequestFiles))
      core.startGroup('Debug: PR diff and coverage data')
      for (const [file, lines] of Object.entries(pullRequestFiles)) {
        core.info(`::debug-dump::diff::${JSON.stringify({file, lines})}`)
      }
      for (const item of coverageByFile) {
        if (prFileSet.has(item.fileName)) {
          core.info(
            `::debug-dump::coverage::${JSON.stringify({
              file: item.fileName,
              missing: item.missingLineNumbers,
              executable: [...item.executableLines],
              covered: item.coveredLineCount
            })}`
          )
        }
      }
      core.endGroup()

      const annotations = gh.buildAnnotations(coverageByFile, pullRequestFiles)
      annotationCount = annotations.length
      core.setOutput('annotation_count', annotationCount)

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

      // Debug output: annotations
      core.startGroup('Debug: Generated annotations')
      for (const annotation of annotations) {
        core.info(
          `::debug-dump::annotation::${JSON.stringify({
            file: annotation.path,
            start: annotation.start_line,
            end: annotation.end_line
          })}`
        )
      }
      core.endGroup()
    } else {
      core.setOutput('annotation_count', 0)
    }

    // Write step summary
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
        annotationCount,
        files: fileStats,
        coverageDelta,
        baselinePercentage
      })
      await core.summary.addRaw(summaryText).write()
      core.info('Step summary written')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.info(JSON.stringify(error))
  }
}

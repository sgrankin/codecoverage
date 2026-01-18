import {env} from 'node:process'

import * as core from '@actions/core'
import {
  correctLineTotals,
  mergeCoverageByFile,
  filterCoverageByFile,
  CoverageParsed
} from './utils/general.js'
import {parseLCov} from './utils/lcov.js'
import {parseCobertura} from './utils/cobertura.js'
import {parseGoCoverage} from './utils/gocoverage.js'
import {GithubUtil, PullRequestFiles, Annotation} from './utils/github.js'
import {expandCoverageFilePaths} from './utils/files.js'
import {detectMode, getNamespaceForBranch} from './utils/mode.js'
import {storeBaseline, loadBaseline, calculateDelta, BaselineData} from './utils/baseline.js'
import {generateSummary, FileCoverage} from './utils/summary.js'

const SUPPORTED_FORMATS = ['lcov', 'cobertura', 'go']

/**
 * Interface for GithubUtil operations.
 * Allows injecting a fake for testing.
 */
export interface GithubOperations {
  getPullRequestDiff(): Promise<PullRequestFiles>
  buildAnnotations(
    coverageFiles: ReturnType<typeof filterCoverageByFile>,
    pullRequestFiles: PullRequestFiles
  ): Annotation[]
}

/**
 * Interface for baseline operations.
 * Allows injecting fakes for testing.
 */
export interface BaselineOperations {
  store(
    data: {
      coveragePercentage: string
      totalLines: number
      coveredLines: number
    },
    options: {cwd?: string; namespace: string}
  ): Promise<boolean>
  load(
    baseBranch: string,
    options: {cwd?: string; namespace: string}
  ): Promise<{baseline: BaselineData | null; commit: string | null}>
}

/**
 * Dependencies that can be injected for testing.
 * Production code uses real implementations; tests can provide fakes.
 */
export interface ActionDependencies {
  /** Factory to create GithubOperations instance */
  createGithubUtil: (token: string, baseUrl: string) => GithubOperations
  /** Baseline storage/retrieval operations */
  baseline: BaselineOperations
}

/** Default dependencies using real implementations */
function createDefaultDependencies(): ActionDependencies {
  return {
    createGithubUtil: (token, baseUrl) => new GithubUtil(token, baseUrl),
    baseline: {
      store: storeBaseline,
      load: loadBaseline
    }
  }
}

/** Parse and compute coverage data from files */
async function parseCoverage(
  coverageFilePath: string,
  coverageFormat: string,
  workspacePath: string
): Promise<{
  parsedCov: CoverageParsed
  totalLines: number
  coveredLines: number
  coveragePercentage: string
}> {
  // Expand file paths (supports globs and multiple paths)
  const coverageFiles = await expandCoverageFilePaths(coverageFilePath)
  if (coverageFiles.length === 0) {
    throw new Error(`No coverage files found matching: ${coverageFilePath}`)
  }
  core.info(`Found ${coverageFiles.length} coverage file(s)`)

  // Parse all coverage files and merge results
  let parsedCov: CoverageParsed = []
  for (const coverageFile of coverageFiles) {
    let fileCov: CoverageParsed
    if (coverageFormat === 'cobertura') {
      fileCov = await parseCobertura(coverageFile, workspacePath)
    } else if (coverageFormat === 'go') {
      fileCov = await parseGoCoverage(coverageFile, 'go.mod')
    } else {
      fileCov = await parseLCov(coverageFile, workspacePath)
    }
    parsedCov = parsedCov.concat(fileCov)
  }

  // Merge coverage from multiple test runs
  parsedCov = mergeCoverageByFile(parsedCov)
  parsedCov = correctLineTotals(parsedCov)

  // Calculate totals
  const totalLines = parsedCov.reduce((acc, entry) => acc + entry.lines.found, 0)
  const coveredLines = parsedCov.reduce((acc, entry) => acc + entry.lines.hit, 0)
  const coveragePercentage =
    totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(2) : '0.00'

  return {parsedCov, totalLines, coveredLines, coveragePercentage}
}

/** Starting Point of the Github Action*/
export async function play(deps: ActionDependencies = createDefaultDependencies()): Promise<void> {
  try {
    core.info('Performing Code Coverage Analysis')

    // Get inputs
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN', {required: true})
    const GITHUB_BASE_URL = core.getInput('GITHUB_BASE_URL')
    const COVERAGE_FILE_PATH = core.getInput('COVERAGE_FILE_PATH', {
      required: true
    })
    const modeOverride = core.getInput('mode') || undefined
    const calculateDeltaInput = core.getInput('calculate_delta') !== 'false'
    const noteNamespace = core.getInput('note_namespace') || 'coverage'
    const deltaPrecision = parseInt(core.getInput('delta_precision') || '2', 10)

    let COVERAGE_FORMAT = core.getInput('COVERAGE_FORMAT') || 'lcov'
    if (!SUPPORTED_FORMATS.includes(COVERAGE_FORMAT)) {
      throw new Error(`COVERAGE_FORMAT must be one of ${SUPPORTED_FORMATS.join(',')}`)
    }

    const workspacePath = env.GITHUB_WORKSPACE || ''
    core.info(`Workspace: ${workspacePath}`)

    // Detect operating mode
    const modeContext = detectMode(modeOverride)
    core.info(`Mode: ${modeContext.mode} (event: ${modeContext.eventName})`)
    core.setOutput('mode', modeContext.mode)

    // Parse coverage data
    const {parsedCov, totalLines, coveredLines, coveragePercentage} = await parseCoverage(
      COVERAGE_FILE_PATH,
      COVERAGE_FORMAT,
      workspacePath
    )

    core.info(
      `Parsing done. ${parsedCov.length} files parsed. Total lines: ${totalLines}. Covered lines: ${coveredLines}. Coverage: ${coveragePercentage}%`
    )

    // Set basic outputs
    core.setOutput('coverage_percentage', coveragePercentage)
    core.setOutput('files_analyzed', parsedCov.length)

    // Variables for delta calculation
    let coverageDelta: string | undefined
    let baselinePercentage: string | undefined

    // Handle mode-specific logic
    if (modeContext.mode === 'store-baseline') {
      // Store baseline mode: save coverage to git notes
      if (modeContext.baseBranch) {
        const namespace = getNamespaceForBranch(modeContext.baseBranch, noteNamespace)
        core.info(`Storing baseline with namespace: ${namespace}`)

        await deps.baseline.store(
          {
            coveragePercentage,
            totalLines,
            coveredLines
          },
          {cwd: workspacePath || undefined, namespace}
        )
      } else {
        core.info('Skipping baseline storage (not on main branch)')
      }

      // In store-baseline mode on non-PR events, we're done (no annotations)
      if (!modeContext.isPullRequest) {
        // Write summary if enabled
        const STEP_SUMMARY = core.getInput('STEP_SUMMARY')
        if (STEP_SUMMARY !== 'false') {
          const files: FileCoverage[] = parsedCov.map(entry => ({
            file: entry.file,
            totalLines: entry.lines.found,
            coveredLines: entry.lines.hit,
            package: entry.package
          }))
          const summary = generateSummary({
            coveragePercentage,
            totalLines,
            coveredLines,
            filesAnalyzed: parsedCov.length,
            annotationCount: 0,
            files
          })
          await core.summary.addRaw(summary).write()
          core.info('Step summary written')
        }
        return
      }
    }

    // PR Check mode (or store-baseline mode on PR event): calculate delta and create annotations
    if (calculateDeltaInput && modeContext.baseBranch) {
      const namespace = getNamespaceForBranch(modeContext.baseBranch, noteNamespace)
      core.info(`Loading baseline from namespace: ${namespace}`)

      const baselineResult = await deps.baseline.load(modeContext.baseBranch, {
        cwd: workspacePath || undefined,
        namespace
      })

      if (baselineResult.baseline) {
        baselinePercentage = baselineResult.baseline.coveragePercentage
        coverageDelta = calculateDelta(coveragePercentage, baselinePercentage, deltaPrecision)
        core.info(`Coverage delta: ${coverageDelta}`)
        core.setOutput('coverage_delta', coverageDelta)
        core.setOutput('baseline_percentage', baselinePercentage)
      } else {
        core.info('No baseline found, showing absolute coverage only')
      }
    }

    // Only create annotations for PR events
    let annotationCount = 0
    if (modeContext.isPullRequest) {
      const coverageByFile = filterCoverageByFile(parsedCov)
      core.info('Filter done')

      const githubUtil = deps.createGithubUtil(GITHUB_TOKEN, GITHUB_BASE_URL)
      const pullRequestFiles = await githubUtil.getPullRequestDiff()

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

      const annotations = githubUtil.buildAnnotations(coverageByFile, pullRequestFiles)
      annotationCount = annotations.length
      core.setOutput('annotation_count', annotationCount)

      // Emit annotations
      for (const annotation of annotations) {
        core.notice(annotation.message, {
          file: annotation.path,
          startLine: annotation.start_line,
          endLine: annotation.end_line
        })
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
    const STEP_SUMMARY = core.getInput('STEP_SUMMARY')
    if (STEP_SUMMARY !== 'false') {
      const files: FileCoverage[] = parsedCov.map(entry => ({
        file: entry.file,
        totalLines: entry.lines.found,
        coveredLines: entry.lines.hit,
        package: entry.package
      }))
      const summary = generateSummary({
        coveragePercentage,
        totalLines,
        coveredLines,
        filesAnalyzed: parsedCov.length,
        annotationCount,
        files,
        coverageDelta,
        baselinePercentage
      })
      await core.summary.addRaw(summary).write()
      core.info('Step summary written')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.info(JSON.stringify(error))
  }
}

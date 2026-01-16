import {env} from 'node:process'

import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  correctLineTotals,
  mergeCoverageByFile,
  filterCoverageByFile,
  CoverageParsed
} from './utils/general.js'
import {parseLCov} from './utils/lcov.js'
import {parseCobertura} from './utils/cobertura.js'
import {parseGoCoverage} from './utils/gocoverage.js'
import {GithubUtil} from './utils/github.js'
import {expandCoverageFilePaths} from './utils/files.js'

const SUPPORTED_FORMATS = ['lcov', 'cobertura', 'go']

interface FileCoverage {
  file: string
  totalLines: number
  coveredLines: number
  package?: string
}

interface PackageCoverage {
  package: string
  totalLines: number
  coveredLines: number
  files: FileCoverage[]
}

interface SummaryParams {
  coveragePercentage: string
  totalLines: number
  coveredLines: number
  filesAnalyzed: number
  annotationCount: number
  files: FileCoverage[]
}

/** Extract package name from file path (directory path, or '.' for root) */
function getPackageFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash > 0) {
    return filePath.substring(0, lastSlash)
  }
  return '.'
}

/** Group files by package and compute aggregate coverage */
function groupByPackage(files: FileCoverage[]): PackageCoverage[] {
  const packageMap = new Map<string, FileCoverage[]>()

  for (const file of files) {
    // Use explicit package if available, otherwise derive from path
    const pkg = file.package ?? getPackageFromPath(file.file)
    if (!packageMap.has(pkg)) {
      packageMap.set(pkg, [])
    }
    packageMap.get(pkg)!.push(file)
  }

  const packages: PackageCoverage[] = []
  for (const [pkg, pkgFiles] of packageMap) {
    const totalLines = pkgFiles.reduce((acc, f) => acc + f.totalLines, 0)
    const coveredLines = pkgFiles.reduce((acc, f) => acc + f.coveredLines, 0)
    packages.push({
      package: pkg,
      totalLines,
      coveredLines,
      files: pkgFiles.sort((a, b) => a.file.localeCompare(b.file))
    })
  }

  return packages.sort((a, b) => a.package.localeCompare(b.package))
}

export function generateSummary(params: SummaryParams): string {
  const {
    coveragePercentage,
    totalLines,
    coveredLines,
    filesAnalyzed,
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

  // Group files by package
  const packages = groupByPackage(files)

  // Build package coverage table
  const packageRows = packages
    .map(pkg => {
      const pct =
        pkg.totalLines > 0
          ? ((pkg.coveredLines / pkg.totalLines) * 100).toFixed(1)
          : '0.0'
      return `| ${pkg.package} | ${pkg.files.length} | ${pkg.totalLines.toLocaleString()} | ${pkg.coveredLines.toLocaleString()} | ${pct}% |`
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

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
${packageRows}
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

    // TODO perhaps make base path configurable in case coverage artifacts are
    // not produced on the Github worker?
    const workspacePath = env.GITHUB_WORKSPACE || ''
    core.info(`Workspace: ${workspacePath}`)

    // 1. Expand file paths (supports globs and multiple paths)
    const coverageFiles = await expandCoverageFilePaths(COVERAGE_FILE_PATH)
    if (coverageFiles.length === 0) {
      throw new Error(`No coverage files found matching: ${COVERAGE_FILE_PATH}`)
    }
    core.info(`Found ${coverageFiles.length} coverage file(s)`)

    // 2. Parse all coverage files and merge results
    let parsedCov: CoverageParsed = []
    for (const coverageFile of coverageFiles) {
      let fileCov: CoverageParsed
      if (COVERAGE_FORMAT === 'cobertura') {
        fileCov = await parseCobertura(coverageFile, workspacePath)
      } else if (COVERAGE_FORMAT === 'go') {
        // Assuming that go.mod is available in working directory
        fileCov = await parseGoCoverage(coverageFile, 'go.mod')
      } else {
        // lcov default
        fileCov = await parseLCov(coverageFile, workspacePath)
      }
      parsedCov = parsedCov.concat(fileCov)
    }
    // Merge coverage from multiple test runs (same file may appear multiple times)
    parsedCov = mergeCoverageByFile(parsedCov)
    // Correct line totals after merge
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

    const githubUtil = new GithubUtil(GITHUB_TOKEN, GITHUB_BASE_URL)

    // 3. Get current pull request files
    const pullRequestFiles = await githubUtil.getPullRequestDiff()

    // Debug output: scoped to files in the diff
    const prFileSet = new Set(Object.keys(pullRequestFiles))
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

    const annotations = githubUtil.buildAnnotations(
      coverageByFile,
      pullRequestFiles
    )
    core.setOutput('annotation_count', annotations.length)

    // 4. Emit annotations using workflow commands
    for (const annotation of annotations) {
      core.notice(annotation.message, {
        file: annotation.path,
        startLine: annotation.start_line,
        endLine: annotation.end_line
      })
    }
    core.info('Annotations emitted')

    // Debug output: annotations
    for (const annotation of annotations) {
      core.info(
        `::debug-dump::annotation::${JSON.stringify({
          file: annotation.path,
          start: annotation.start_line,
          end: annotation.end_line
        })}`
      )
    }

    // 5. Write step summary
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
        annotationCount: annotations.length,
        files
      })
      await core.summary.addRaw(summary).write()
      core.info('Step summary written')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    core.info(JSON.stringify(error))
  }
}

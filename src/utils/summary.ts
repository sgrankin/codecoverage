import * as baseline from './baseline.ts'
import * as sparkline from './sparkline.ts'

// FileCoverage is the coverage data for a single file.
export interface FileCoverage {
  file: string
  totalLines: number
  coveredLines: number
  // package is the package name (empty string = derive from path).
  package: string
}

// CoverageStats contains aggregate coverage statistics for display.
export interface CoverageStats {
  percentage: string
  totalLines: number
  coveredLines: number
  filesAnalyzed: number
  files: FileCoverage[]
}

// BaselineInfo contains baseline comparison data.
export interface BaselineInfo {
  // delta is the coverage delta string (empty = not computed).
  delta: string
  // percentage is the baseline coverage percentage (empty = no baseline).
  percentage: string
  // history is an array of historical coverage percentages for sparkline.
  history: number[]
}

// DiffStats contains coverage statistics for the PR diff.
export interface DiffStats {
  // coveredLines is the number of covered lines in the PR diff.
  coveredLines: number
  // totalLines is the total executable lines in the PR diff.
  totalLines: number
}

// PackageCoverage is the aggregate coverage data for a package.
interface PackageCoverage {
  package: string
  totalLines: number
  coveredLines: number
  files: FileCoverage[]
}

// Params are the parameters for generating a coverage summary.
export interface Params {
  coverage: CoverageStats
  baseline: BaselineInfo
  diff: DiffStats
  // headerText is the custom header text for the report (empty = default).
  headerText: string
}

// getPackageFromPath extracts the package name from a file path (directory path, or '.' for root).
function getPackageFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash > 0) {
    return filePath.substring(0, lastSlash)
  }
  return '.'
}

// groupByPackage groups files by package and computes aggregate coverage.
function groupByPackage(files: FileCoverage[]): PackageCoverage[] {
  const packageMap = new Map<string, FileCoverage[]>()

  for (const file of files) {
    // Use explicit package if available, otherwise derive from path
    const pkg = file.package || getPackageFromPath(file.file)
    let pkgFiles = packageMap.get(pkg)
    if (!pkgFiles) {
      pkgFiles = []
      packageMap.set(pkg, pkgFiles)
    }
    pkgFiles.push(file)
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

// generate creates a markdown coverage report.
export function generate(params: Params): string {
  const {coverage, baseline: baselineInfo, diff, headerText} = params
  const header = headerText || 'Code Coverage Report'
  const uncoveredLines = coverage.totalLines - coverage.coveredLines

  // Status emoji: if we have a delta, use it to determine color (encourage improvement).
  // Otherwise fall back to absolute coverage thresholds.
  let statusEmoji: string
  if (baselineInfo.delta) {
    const deltaNum = parseFloat(baselineInfo.delta)
    statusEmoji = deltaNum > 0 ? '📈' : deltaNum < 0 ? '📉' : '➖'
  } else if (parseFloat(coverage.percentage) >= 80) {
    statusEmoji = '🟢'
  } else if (parseFloat(coverage.percentage) >= 60) {
    statusEmoji = '🟡'
  } else {
    statusEmoji = '🔴'
  }

  // Format coverage display with delta and sparkline if available
  let coverageDisplay = `${coverage.percentage}%`
  if (baselineInfo.delta) {
    coverageDisplay = baseline.formatWithDelta(coverage.percentage, baselineInfo.delta)
  }
  if (baselineInfo.history && baselineInfo.history.length >= 2) {
    coverageDisplay = `\`${sparkline.render(baselineInfo.history)}\` ${coverageDisplay}`
  }

  // Group files by package
  const packages = groupByPackage(coverage.files)

  // Build package coverage table
  const packageRows = packages
    .map(pkg => {
      const pct =
        pkg.totalLines > 0 ? ((pkg.coveredLines / pkg.totalLines) * 100).toFixed(1) : '0.0'
      return `| ${pkg.package} | ${pkg.files.length} | ${pkg.totalLines.toLocaleString()} | ${pkg.coveredLines.toLocaleString()} | ${pct}% |`
    })
    .join('\n')

  // Compute diff coverage percentage if we have diff data
  const diffCoverageDisplay =
    diff.totalLines > 0 ? `${((diff.coveredLines / diff.totalLines) * 100).toFixed(1)}%` : ''

  // Build horizontal header row with optional columns
  const headerCols = [
    'Coverage',
    ...(baselineInfo.percentage ? ['Baseline'] : []),
    ...(diffCoverageDisplay ? ['Diff Only'] : []),
    'Covered',
    'Uncovered',
    'Total',
    'Files'
  ]
  const dataCols = [
    coverageDisplay,
    ...(baselineInfo.percentage ? [`${baselineInfo.percentage}%`] : []),
    ...(diffCoverageDisplay ? [diffCoverageDisplay] : []),
    coverage.coveredLines.toLocaleString(),
    uncoveredLines.toLocaleString(),
    coverage.totalLines.toLocaleString(),
    coverage.filesAnalyzed.toLocaleString()
  ]
  const alignRow = headerCols.map(() => '----:').join(' | ')

  return `## ${statusEmoji} ${header}

| ${headerCols.join(' | ')} |
| ${alignRow} |
| ${dataCols.join(' | ')} |

<details>
<summary>Coverage by Package</summary>

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
${packageRows}

</details>
`
}

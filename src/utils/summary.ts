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

// PackageCoverage is the aggregate coverage data for a package.
interface PackageCoverage {
  package: string
  totalLines: number
  coveredLines: number
  files: FileCoverage[]
}

// Params are the parameters for generating a coverage summary.
export interface Params {
  coveragePercentage: string
  totalLines: number
  coveredLines: number
  filesAnalyzed: number
  files: FileCoverage[]
  // coverageDelta is the coverage delta string (empty = not computed).
  coverageDelta: string
  // baselinePercentage is the baseline coverage percentage (empty = no baseline).
  baselinePercentage: string
  // diffCoveredLines is the number of covered lines in the PR diff (0 = not computed).
  diffCoveredLines: number
  // diffTotalLines is the total executable lines in the PR diff (0 = not computed).
  diffTotalLines: number
  // coverageHistory is an array of historical coverage percentages for sparkline.
  // Empty array = no sparkline.
  coverageHistory: number[]
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
  const {
    coveragePercentage,
    totalLines,
    coveredLines,
    filesAnalyzed,
    files,
    coverageDelta,
    baselinePercentage,
    diffCoveredLines,
    diffTotalLines,
    coverageHistory
  } = params
  const uncoveredLines = totalLines - coveredLines

  // Status emoji: if we have a delta, use it to determine color (encourage improvement).
  // Otherwise fall back to absolute coverage thresholds.
  let statusEmoji: string
  if (coverageDelta) {
    const deltaNum = parseFloat(coverageDelta)
    statusEmoji = deltaNum > 0 ? '📈' : deltaNum < 0 ? '📉' : '➖'
  } else if (parseFloat(coveragePercentage) >= 80) {
    statusEmoji = '🟢'
  } else if (parseFloat(coveragePercentage) >= 60) {
    statusEmoji = '🟡'
  } else {
    statusEmoji = '🔴'
  }

  // Format coverage display with delta and sparkline if available
  let coverageDisplay = `${coveragePercentage}%`
  if (coverageDelta) {
    coverageDisplay = baseline.formatWithDelta(coveragePercentage, coverageDelta)
  }
  if (coverageHistory && coverageHistory.length >= 2) {
    coverageDisplay = `\`${sparkline.render(coverageHistory)}\` ${coverageDisplay}`
  }

  // Group files by package
  const packages = groupByPackage(files)

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
    diffTotalLines > 0 ? `${((diffCoveredLines / diffTotalLines) * 100).toFixed(1)}%` : ''

  // Build horizontal header row with optional columns
  const headerCols = [
    'Coverage',
    ...(baselinePercentage ? ['Baseline'] : []),
    ...(diffCoverageDisplay ? ['Diff Only'] : []),
    'Covered',
    'Uncovered',
    'Total',
    'Files'
  ]
  const dataCols = [
    coverageDisplay,
    ...(baselinePercentage ? [`${baselinePercentage}%`] : []),
    ...(diffCoverageDisplay ? [diffCoverageDisplay] : []),
    coveredLines.toLocaleString(),
    uncoveredLines.toLocaleString(),
    totalLines.toLocaleString(),
    filesAnalyzed.toLocaleString()
  ]
  const alignRow = headerCols.map(() => '----:').join(' | ')

  return `## ${statusEmoji} Code Coverage Report

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

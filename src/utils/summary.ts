import * as baseline from './baseline.ts'
import * as sparkline from './sparkline.ts'

// FileCoverage is the coverage data for a single file. Counts are in the
// report's primary unit: statements for Go, lines otherwise.
export interface FileCoverage {
  file: string
  total: number
  covered: number
  // package is the package name (empty string = derive from path).
  package: string
}

// CoverageStats contains aggregate coverage statistics for display. Counts are
// in the report's primary unit: statements for Go, lines otherwise.
export interface CoverageStats {
  percentage: string
  total: number
  covered: number
  filesAnalyzed: number
  files: FileCoverage[]
  // footnote is small print rendered under the metrics table ('' = none).
  // Used to name the primary unit when it isn't lines.
  footnote: string
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
  total: number
  covered: number
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

// PACKAGE_BAR_WIDTH is the bar length (in characters) of the largest package
// in the table; every other bar is scaled against it.
const PACKAGE_BAR_WIDTH = 24

// packageBar renders a package's coverage as a stacked bar whose length is
// proportional to its statement count (a 1-D treemap): solid = covered,
// light = uncovered. Light runs are directly comparable across rows — a long
// light run IS a large coverage hole. quantum is statements per character.
function packageBar(covered: number, total: number, quantum: number): string {
  if (total <= 0 || quantum <= 0) {
    return ''
  }
  const uncovered = total - covered
  // Never round a nonzero segment out of existence: a small hole must stay
  // visible, and a sliver of coverage must not render as 0%.
  const minSolid = covered > 0 ? 1 : 0
  const minLight = uncovered > 0 ? 1 : 0
  // Fix the bar width first and derive the light segment from it — rounding
  // both segments independently lets two .5s round up and overshoot the width.
  const width = Math.max(Math.round(total / quantum), minSolid + minLight)
  const solid = Math.min(Math.max(Math.round(covered / quantum), minSolid), width - minLight)
  return `\`${'█'.repeat(solid)}${'░'.repeat(width - solid)}\``
}

// mostUncoveredLine renders a one-line hotspot strip naming the packages with
// the most uncovered statements, or '' when nothing is uncovered.
function mostUncoveredLine(packages: PackageCoverage[]): string {
  const offenders = packages
    .filter(p => p.total - p.covered > 0)
    .sort(
      (a, b) => b.total - b.covered - (a.total - a.covered) || a.package.localeCompare(b.package)
    )
    .slice(0, 5)
  if (offenders.length === 0) {
    return ''
  }
  const items = offenders.map(p => `${p.package} (${(p.total - p.covered).toLocaleString()})`)
  return `**Most uncovered:** ${items.join(' · ')}`
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
    const total = pkgFiles.reduce((acc, f) => acc + f.total, 0)
    const covered = pkgFiles.reduce((acc, f) => acc + f.covered, 0)
    packages.push({
      package: pkg,
      total,
      covered,
      files: pkgFiles.sort((a, b) => a.file.localeCompare(b.file))
    })
  }

  return packages.sort((a, b) => a.package.localeCompare(b.package))
}

// generate creates a markdown coverage report.
export function generate(params: Params): string {
  const {coverage, baseline: baselineInfo, diff, headerText} = params
  const header = headerText || 'Code Coverage Report'
  const uncovered = coverage.total - coverage.covered

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
  const quantum = Math.max(0, ...packages.map(p => p.total)) / PACKAGE_BAR_WIDTH
  const packageRows = packages
    .map(pkg => {
      const pct = pkg.total > 0 ? ((pkg.covered / pkg.total) * 100).toFixed(1) : '0.0'
      const bar = packageBar(pkg.covered, pkg.total, quantum)
      const display = bar ? `${bar} ${pct}%` : `${pct}%`
      return `| ${pkg.package} | ${pkg.files.length} | ${pkg.total.toLocaleString()} | ${pkg.covered.toLocaleString()} | ${display} |`
    })
    .join('\n')
  const hotspots = mostUncoveredLine(packages)
  const hotspotsBlock = hotspots ? `\n${hotspots}\n` : ''

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
    coverage.covered.toLocaleString(),
    uncovered.toLocaleString(),
    coverage.total.toLocaleString(),
    coverage.filesAnalyzed.toLocaleString()
  ]
  const alignRow = headerCols.map(() => '----:').join(' | ')

  const footnote = coverage.footnote ? `\n<sub>${coverage.footnote}</sub>\n` : ''

  return `## ${statusEmoji} ${header}

| ${headerCols.join(' | ')} |
| ${alignRow} |
| ${dataCols.join(' | ')} |
${footnote}
<details>
<summary>Coverage by Package</summary>
${hotspotsBlock}
| Package | Files | Total | Covered | Coverage |
| ------- | ----: | ----: | ------: | -------: |
${packageRows}

</details>
`
}

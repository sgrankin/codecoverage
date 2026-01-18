import * as baseline from './baseline.js'

// FileCoverage is the coverage data for a single file.
export interface FileCoverage {
  file: string
  totalLines: number
  coveredLines: number
  package?: string | undefined
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
  annotationCount: number
  files: FileCoverage[]
  // coverageDelta is the coverage delta string (e.g., "+2.50" or "-1.25").
  coverageDelta?: string | undefined
  // baselinePercentage is the baseline coverage percentage.
  baselinePercentage?: string | undefined
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
    const pkg = file.package ?? getPackageFromPath(file.file)
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
    annotationCount,
    files,
    coverageDelta,
    baselinePercentage
  } = params
  const uncoveredLines = totalLines - coveredLines

  let statusEmoji = '🔴'
  if (parseFloat(coveragePercentage) >= 80) {
    statusEmoji = '🟢'
  } else if (parseFloat(coveragePercentage) >= 60) {
    statusEmoji = '🟡'
  }

  // Format coverage display with delta if available
  let coverageDisplay = `${coveragePercentage}%`
  if (coverageDelta) {
    coverageDisplay = baseline.formatWithDelta(coveragePercentage, coverageDelta)
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

  // Build baseline row if available
  const baselineRow = baselinePercentage ? `| **Baseline** | ${baselinePercentage}% |\n` : ''

  return `## ${statusEmoji} Code Coverage Report

| Metric | Value |
| ------ | ----: |
| **Coverage** | ${coverageDisplay} |
${baselineRow}| **Covered Lines** | ${coveredLines.toLocaleString()} |
| **Uncovered Lines** | ${uncoveredLines.toLocaleString()} |
| **Total Lines** | ${totalLines.toLocaleString()} |
| **Files Analyzed** | ${filesAnalyzed.toLocaleString()} |

${annotationCount > 0 ? `⚠️ **${annotationCount} annotation${annotationCount === 1 ? '' : 's'}** added for uncovered lines in this PR.` : '✅ No new uncovered lines detected in this PR.'}

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----: | ----------: | ------: | -------: |
${packageRows}
`
}

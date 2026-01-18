import * as glob from '@actions/glob'

/**
 * Expand a coverage file path input into a list of files.
 * Supports:
 * - Single file paths
 * - Glob patterns (including **)
 * - Multiple paths/patterns separated by newlines
 */
export async function expandCoverageFilePaths(input: string): Promise<string[]> {
  const globber = await glob.create(input, {
    matchDirectories: false
  })
  const files = await globber.glob()

  // Sort for consistent ordering
  return files.sort()
}

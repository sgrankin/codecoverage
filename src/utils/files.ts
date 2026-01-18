import * as glob from '@actions/glob'

// expandCoverageFilePaths expands a coverage file path input into a list of files.
// Supports single file paths, glob patterns (including **), and multiple paths separated by newlines.
export async function expandCoverageFilePaths(input: string): Promise<string[]> {
  const globber = await glob.create(input, {
    matchDirectories: false
  })
  const files = await globber.glob()

  // Sort for consistent ordering
  return files.sort()
}

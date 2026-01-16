import {glob} from 'glob'

/**
 * Expand a coverage file path input into a list of files.
 * Supports:
 * - Single file paths
 * - Glob patterns (including **)
 * - Multiple paths/patterns separated by newlines
 */
export async function expandCoverageFilePaths(
  input: string
): Promise<string[]> {
  const lines = input
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const allFiles: string[] = []

  for (const pattern of lines) {
    // Check if it's a glob pattern
    if (
      pattern.includes('*') ||
      pattern.includes('?') ||
      pattern.includes('[')
    ) {
      const matches = await glob(pattern, {nodir: true})
      allFiles.push(...matches)
    } else {
      // Treat as literal path
      allFiles.push(pattern)
    }
  }

  // Remove duplicates and sort for consistent ordering
  return [...new Set(allFiles)].sort()
}

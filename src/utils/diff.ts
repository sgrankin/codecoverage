// FileDiff represents the changes in a single file from a git diff.
interface FileDiff {
  filename: string
  addedLines: number[]
  deletedLines: number[]
}

// parse parses unified diff output and extracts file changes.
export function parse(diffOutput: string): FileDiff[] {
  const fileDiffs: FileDiff[] = []
  const lines = diffOutput.split('\n')

  let currentFile = ''
  let addedLines: number[] = []
  let deletedLines: number[] = []
  let seenHeaderLine = false
  let deletionLineNum = 0
  let additionLineNum = 0

  const pushCurrent = (): void => {
    if (currentFile) {
      fileDiffs.push({filename: currentFile, addedLines, deletedLines})
    }
  }

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      pushCurrent()
      currentFile = getFilenameFromDiffHeader(line)
      addedLines = []
      deletedLines = []
      seenHeaderLine = false
    } else if (line.startsWith('@@')) {
      seenHeaderLine = true
      const info = getLineInfoFromHeaderLine(line)
      deletionLineNum = info.deletionStartingLineNumber
      additionLineNum = info.additionStartingLineNumber
    } else if (line.startsWith('+') && seenHeaderLine) {
      addedLines.push(additionLineNum)
      additionLineNum++
    } else if (line.startsWith('-') && seenHeaderLine) {
      deletedLines.push(deletionLineNum)
      deletionLineNum++
    } else if (seenHeaderLine) {
      deletionLineNum++
      additionLineNum++
    }
  }

  pushCurrent()
  return fileDiffs
}

function getFilenameFromDiffHeader(header: string): string {
  const startIndex = header.indexOf(' a/') + 3
  const endIndex = header.indexOf(' b/', startIndex)
  return header.substring(startIndex, endIndex)
}

function getLineInfoFromHeaderLine(line: string): {
  deletionStartingLineNumber: number
  additionStartingLineNumber: number
} {
  const matches = line.match(/-(\d+),?(\d+)? \+(\d+),?(\d+)? @@/)
  const deletion = matches?.[1]
  const addition = matches?.[3]
  if (deletion !== undefined && addition !== undefined) {
    return {
      deletionStartingLineNumber: parseInt(deletion, 10),
      additionStartingLineNumber: parseInt(addition, 10)
    }
  }
  return {deletionStartingLineNumber: 0, additionStartingLineNumber: 0}
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test('getFilenameFromDiffHeader extracts filename', () => {
    expect(getFilenameFromDiffHeader('diff --git a/foo.ts b/foo.ts')).toBe('foo.ts')
    expect(getFilenameFromDiffHeader('diff --git a/path/to/file.txt b/path/to/file.txt')).toBe(
      'path/to/file.txt'
    )
    // Note: filenames with spaces are ambiguous in git diff format
  })

  test('getLineInfoFromHeaderLine parses hunk headers', () => {
    expect(getLineInfoFromHeaderLine('@@ -1,3 +1,5 @@')).toEqual({
      deletionStartingLineNumber: 1,
      additionStartingLineNumber: 1
    })
    expect(getLineInfoFromHeaderLine('@@ -10,2 +15,4 @@ function foo()')).toEqual({
      deletionStartingLineNumber: 10,
      additionStartingLineNumber: 15
    })
    expect(getLineInfoFromHeaderLine('@@ -5 +5 @@')).toEqual({
      deletionStartingLineNumber: 5,
      additionStartingLineNumber: 5
    })
  })

  test('getLineInfoFromHeaderLine returns zeros for malformed input', () => {
    expect(getLineInfoFromHeaderLine('not a header')).toEqual({
      deletionStartingLineNumber: 0,
      additionStartingLineNumber: 0
    })
  })
}

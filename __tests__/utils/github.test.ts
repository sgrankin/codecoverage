import {expect, test, vi} from 'vitest'
import * as github from '../../src/utils/github.ts'
import {captureStdout} from '../fixtures/capture-stdout.ts'

// Mock @actions/github - only for context, not for getOctokit
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(),
  context: {
    payload: {
      pull_request: {
        head: {
          ref: 'feature-branch'
        }
      }
    },
    issue: {
      number: 123
    },
    repo: {
      owner: 'test-owner',
      repo: 'test-repo'
    },
    ref: 'refs/heads/main'
  }
}))

// createFakeFetchDiff creates a fake fetchDiff function for testing.
// Returns configurable responses without mocking internals.
function createFakeFetchDiff(options: {
  diffResponse?: string
  diffError?: {status: number; message: string}
}): github.FetchDiff {
  return async () => {
    if (options.diffError) {
      throw options.diffError
    }
    return options.diffResponse ?? ''
  }
}

// createFakeCommentOps creates a fake CommentOps implementation for testing.
function createFakeCommentOps(
  options: {
    initialComments?: github.Comment[]
    createError?: {status: number; message: string}
    updateError?: {status: number; message: string}
    listError?: {status: number; message: string}
  } = {}
): github.CommentOps & {comments: github.Comment[]} {
  const comments = [...(options.initialComments ?? [])]
  let nextId = comments.reduce((max, c) => Math.max(max, c.id), 0) + 1
  return {
    comments,
    async list() {
      if (options.listError) throw options.listError
      return [...comments]
    },
    async create(body: string) {
      if (options.createError) throw options.createError
      comments.push({id: nextId++, body})
    },
    async update(id: number, body: string) {
      if (options.updateError) throw options.updateError
      const comment = comments.find(c => c.id === id)
      if (comment) comment.body = body
    }
  }
}

test('Client init successfully', async () => {
  const client = new github.Client('1234', 'https://api.github.com')
  expect(client).toBeInstanceOf(github.Client)
})

test('Client init to throw error', () => {
  expect(() => new github.Client('', 'https://api.github.com')).toThrowError(
    'github_token is missing'
  )
})

const buildAnnotationsTestCases = [
  {
    name: 'multiple files with coalescing',
    prFiles: {
      'file1.txt': [
        132, 133, 134, 135, 136, 137, 138, 139, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007
      ],
      'test/dir/file1.txt': [
        22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
        45
      ]
    },
    coverageFiles: [
      {
        fileName: 'unchanged.txt',
        missingLineNumbers: [1, 2, 3],
        executableLines: new Set([1, 2, 3]),
        coveredLineCount: 10
      },
      {
        fileName: 'file1.txt',
        missingLineNumbers: [1, 2, 3, 132, 134, 135, 136, 1007, 1008],
        executableLines: new Set([1, 2, 3, 132, 134, 135, 136, 1007, 1008]),
        coveredLineCount: 50
      },
      {
        fileName: 'test/dir/file1.txt',
        missingLineNumbers: [20, 21, 22],
        executableLines: new Set([20, 21, 22]),
        coveredLineCount: 5
      }
    ],
    expected: [
      {
        path: 'file1.txt',
        start_line: 132,
        end_line: 136,
        message: 'Changed lines 132-136 are not tested'
      },
      {
        path: 'file1.txt',
        start_line: 1007,
        end_line: 1007,
        message: 'Changed line 1007 is not tested'
      },
      {
        path: 'test/dir/file1.txt',
        start_line: 22,
        end_line: 22,
        message: 'Changed line 22 is not tested'
      }
    ]
  },
  {
    name: 'no matching files returns empty array',
    prFiles: {'other-file.txt': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
    coverageFiles: [
      {
        fileName: 'file1.txt',
        missingLineNumbers: [1, 2, 3],
        executableLines: new Set([1, 2, 3]),
        coveredLineCount: 10
      }
    ],
    expected: []
  },
  {
    name: 'bridges gaps for non-executable lines',
    prFiles: {
      'file.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    coverageFiles: [
      {
        fileName: 'file.ts',
        missingLineNumbers: [5, 6, 8, 9],
        executableLines: new Set([5, 6, 8, 9]),
        coveredLineCount: 10
      }
    ], // line 7 is comment
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 9,
        message: 'Changed lines 5-9 are not tested'
      }
    ]
  },
  {
    name: 'does not bridge gaps with covered lines',
    prFiles: {
      'file.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    },
    coverageFiles: [
      {
        fileName: 'file.ts',
        missingLineNumbers: [5, 6, 8, 9],
        executableLines: new Set([5, 6, 7, 8, 9]),
        coveredLineCount: 1 // line 7 is covered
      }
    ],
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 6,
        message: 'Changed lines 5-6 are not tested'
      },
      {
        path: 'file.ts',
        start_line: 8,
        end_line: 9,
        message: 'Changed lines 8-9 are not tested'
      }
    ]
  },
  {
    name: 'bridges gaps in PR diff for non-executable lines',
    prFiles: {'file.ts': [5, 6, 8, 9]}, // user didn't modify line 7
    coverageFiles: [
      {
        fileName: 'file.ts',
        missingLineNumbers: [5, 6, 8, 9],
        executableLines: new Set([5, 6, 8, 9]),
        coveredLineCount: 10
      }
    ],
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 9,
        message: 'Changed lines 5-9 are not tested'
      }
    ]
  },
  {
    name: 'completely uncovered file gets single notice',
    prFiles: {'newfile.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
    coverageFiles: [
      {
        fileName: 'newfile.ts',
        missingLineNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        executableLines: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        coveredLineCount: 0
      }
    ],
    expected: [
      {
        path: 'newfile.ts',
        start_line: 1,
        end_line: 1,
        message: 'This file has no test coverage'
      }
    ]
  },
  {
    name: 'ignores whitespace-only diff lines (non-executable)',
    prFiles: {'file.ts': [10, 15, 20, 25]}, // 15, 25 are whitespace/comments
    coverageFiles: [
      {
        fileName: 'file.ts',
        missingLineNumbers: [10, 20],
        executableLines: new Set([10, 20]), // only 10, 20 are executable
        coveredLineCount: 5
      }
    ],
    expected: [
      {
        path: 'file.ts',
        start_line: 10,
        end_line: 10,
        message: 'Changed line 10 is not tested'
      },
      {
        path: 'file.ts',
        start_line: 20,
        end_line: 20,
        message: 'Changed line 20 is not tested'
      }
    ]
  },
  {
    name: 'skips file when all diff lines are non-executable',
    prFiles: {'file.ts': [5, 10, 15]}, // all whitespace/comments
    coverageFiles: [
      {
        fileName: 'file.ts',
        missingLineNumbers: [1, 2, 3],
        executableLines: new Set([1, 2, 3]), // none of the diff lines are executable
        coveredLineCount: 10
      }
    ],
    expected: []
  }
]

test.each(buildAnnotationsTestCases)('buildAnnotations: $name', ({
  prFiles,
  coverageFiles,
  expected
}) => {
  const capture = captureStdout()
  const client = new github.Client('1234', 'https://api.github.com')
  const annotations = client.buildAnnotations(coverageFiles, prFiles)
  expect(annotations).toEqual(expected)
  // Verify it logged annotation count
  expect(capture.output()).toContain(`Annotation count: ${expected.length}`)
})

test('getPullRequestDiff parses diff response', async () => {
  const mockDiff = `diff --git a/src/test.ts b/src/test.ts
index abcdefg..1234567 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3`

  const fakeFetchDiff = createFakeFetchDiff({diffResponse: mockDiff})
  const client = new github.Client('1234', 'https://api.github.com', fakeFetchDiff)

  const result = await client.getPullRequestDiff()

  // Now returns raw line numbers instead of pre-coalesced ranges
  expect(result).toEqual({
    'src/test.ts': [2]
  })
})

const diffTooLargeTestCases = [
  {
    name: '403 with diff too large message',
    error: {status: 403, message: 'Diff is too large to display'}
  },
  {
    name: '422 with too large message',
    error: {status: 422, message: 'The diff is too large'}
  },
  {
    name: '406 with not available message',
    error: {status: 406, message: 'Diff not available'}
  }
]

test.each(diffTooLargeTestCases)('getPullRequestDiff handles large diff error: $name', async ({
  error
}) => {
  const capture = captureStdout()
  const fakeFetchDiff = createFakeFetchDiff({diffError: error})
  const client = new github.Client('1234', 'https://api.github.com', fakeFetchDiff)

  const result = await client.getPullRequestDiff()

  expect(result).toEqual({})
  // Check that warning was emitted to stdout
  expect(capture.output()).toContain('::warning::PR diff is too large')
})

test('getPullRequestDiff throws for other errors', async () => {
  const fakeFetchDiff = createFakeFetchDiff({
    diffError: {status: 500, message: 'Server error'}
  })
  const client = new github.Client('1234', 'https://api.github.com', fakeFetchDiff)

  await expect(client.getPullRequestDiff()).rejects.toEqual({
    status: 500,
    message: 'Server error'
  })
})

// upsertComment tests
test('upsertComment creates new comment when none exists', async () => {
  const capture = captureStdout()
  const fakeComments = createFakeCommentOps()
  const client = new github.Client(
    '1234',
    'https://api.github.com',
    createFakeFetchDiff({}),
    fakeComments
  )

  const result = await client.upsertComment('## Coverage Report')

  expect(result).toBe(true)
  expect(fakeComments.comments).toHaveLength(1)
  expect(fakeComments.comments[0]!.body).toContain('<!-- codecoverage-action -->')
  expect(fakeComments.comments[0]!.body).toContain('## Coverage Report')
  expect(capture.output()).toContain('Created coverage comment')
})

test('upsertComment updates existing comment', async () => {
  const capture = captureStdout()
  const fakeComments = createFakeCommentOps({
    initialComments: [
      {id: 100, body: 'Some other comment'},
      {id: 200, body: '<!-- codecoverage-action -->\n## Old Report'}
    ]
  })
  const client = new github.Client(
    '1234',
    'https://api.github.com',
    createFakeFetchDiff({}),
    fakeComments
  )

  const result = await client.upsertComment('## New Report')

  expect(result).toBe(true)
  expect(fakeComments.comments).toHaveLength(2)
  expect(fakeComments.comments[1]!.body).toContain('## New Report')
  expect(fakeComments.comments[0]!.body).toBe('Some other comment') // unchanged
  expect(capture.output()).toContain('Updated existing coverage comment')
})

const commentErrorTestCases = [
  {name: '403 forbidden', error: {status: 403, message: 'Forbidden'}},
  {name: '404 not found (PR closed)', error: {status: 404, message: 'Not Found'}},
  {name: '422 unprocessable', error: {status: 422, message: 'Validation failed'}}
]

test.each(commentErrorTestCases)('upsertComment handles error gracefully: $name', async ({
  error
}) => {
  const capture = captureStdout()
  const fakeComments = createFakeCommentOps({createError: error})
  const client = new github.Client(
    '1234',
    'https://api.github.com',
    createFakeFetchDiff({}),
    fakeComments
  )

  const result = await client.upsertComment('## Report')

  expect(result).toBe(false)
  expect(capture.output()).toContain('::warning::Could not post coverage comment')
})

test('upsertComment throws for unexpected errors', async () => {
  const fakeComments = createFakeCommentOps({
    listError: {status: 500, message: 'Server error'}
  })
  const client = new github.Client(
    '1234',
    'https://api.github.com',
    createFakeFetchDiff({}),
    fakeComments
  )

  await expect(client.upsertComment('## Report')).rejects.toEqual({
    status: 500,
    message: 'Server error'
  })
})

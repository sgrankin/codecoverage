import {test, expect, vi, beforeEach, afterEach} from 'vitest'
import {GithubUtil} from '../../src/utils/github'
import {captureStdout} from '../fixtures/capture-stdout'

// Mock client for getOctokit
const mockClient = {
  rest: {
    pulls: {
      get: vi.fn()
    }
  }
}

// Mock @actions/github
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => mockClient),
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

test('github init successfully', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')
  expect(githubUtil).toBeInstanceOf(GithubUtil)
})

test('github init to throw error', function () {
  expect(() => new GithubUtil('', 'https://api.github.com')).toThrowError(
    'GITHUB_TOKEN is missing'
  )
})

const buildAnnotationsTestCases = [
  {
    name: 'multiple files with coalescing',
    prFiles: {
      'file1.txt': [
        132, 133, 134, 135, 136, 137, 138, 139, 1000, 1001, 1002, 1003, 1004,
        1005, 1006, 1007
      ],
      'test/dir/file1.txt': [
        22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
        40, 41, 42, 43, 44, 45
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
      'file.ts': [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20
      ]
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
      'file.ts': [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20
      ]
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

test.each(buildAnnotationsTestCases)(
  'buildAnnotations: $name',
  ({prFiles, coverageFiles, expected}) => {
    const capture = captureStdout()
    try {
      const githubUtil = new GithubUtil('1234', 'https://api.github.com')
      const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)
      expect(annotations).toEqual(expected)
      // Verify it logged annotation count
      expect(capture.output()).toContain(`Annotation count: ${expected.length}`)
    } finally {
      capture.restore()
    }
  }
)

test('getPullRequestDiff parses diff response', async function () {
  const mockDiff = `diff --git a/src/test.ts b/src/test.ts
index abcdefg..1234567 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3`

  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  // Mock the client's pulls.get method
  ;(githubUtil as any).client = {
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: mockDiff
        })
      }
    }
  }

  const result = await githubUtil.getPullRequestDiff()

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

test.each(diffTooLargeTestCases)(
  'getPullRequestDiff handles large diff error: $name',
  async ({error}) => {
    const capture = captureStdout()
    try {
      const githubUtil = new GithubUtil('1234', 'https://api.github.com')

      ;(githubUtil as any).client = {
        rest: {
          pulls: {
            get: vi.fn().mockRejectedValue(error)
          }
        }
      }

      const result = await githubUtil.getPullRequestDiff()

      expect(result).toEqual({})
      // Check that warning was emitted to stdout
      expect(capture.output()).toContain('::warning::PR diff is too large')
    } finally {
      capture.restore()
    }
  }
)

test('getPullRequestDiff throws for other errors', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  ;(githubUtil as any).client = {
    rest: {
      pulls: {
        get: vi.fn().mockRejectedValue({status: 500, message: 'Server error'})
      }
    }
  }

  await expect(githubUtil.getPullRequestDiff()).rejects.toEqual({
    status: 500,
    message: 'Server error'
  })
})

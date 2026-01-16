import {test, expect, vi} from 'vitest'
import {GithubUtil} from '../../src/utils/github'

// Mock @actions/github
vi.mock('@actions/github', () => ({
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

// Mock @actions/core
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn()
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
        executableLines: new Set([1, 2, 3])
      },
      {
        fileName: 'file1.txt',
        missingLineNumbers: [1, 2, 3, 132, 134, 135, 136, 1007, 1008],
        executableLines: new Set([1, 2, 3, 132, 134, 135, 136, 1007, 1008])
      },
      {
        fileName: 'test/dir/file1.txt',
        missingLineNumbers: [20, 21, 22],
        executableLines: new Set([20, 21, 22])
      }
    ],
    expected: [
      {
        path: 'file1.txt',
        start_line: 132,
        end_line: 136,
        message: 'These lines are not covered by a test'
      },
      {
        path: 'file1.txt',
        start_line: 1007,
        end_line: 1007,
        message: 'This line is not covered by a test'
      },
      {
        path: 'test/dir/file1.txt',
        start_line: 22,
        end_line: 22,
        message: 'This line is not covered by a test'
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
        executableLines: new Set([1, 2, 3])
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
        executableLines: new Set([5, 6, 8, 9])
      }
    ], // line 7 is comment
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 9,
        message: 'These lines are not covered by a test'
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
        executableLines: new Set([5, 6, 7, 8, 9])
      }
    ], // line 7 is covered
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 6,
        message: 'These lines are not covered by a test'
      },
      {
        path: 'file.ts',
        start_line: 8,
        end_line: 9,
        message: 'These lines are not covered by a test'
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
        executableLines: new Set([5, 6, 8, 9])
      }
    ],
    expected: [
      {
        path: 'file.ts',
        start_line: 5,
        end_line: 9,
        message: 'These lines are not covered by a test'
      }
    ]
  }
]

test.each(buildAnnotationsTestCases)(
  'buildAnnotations: $name',
  ({prFiles, coverageFiles, expected}) => {
    const githubUtil = new GithubUtil('1234', 'https://api.github.com')
    const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)
    expect(annotations).toEqual(expected)
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

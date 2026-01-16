import {test, expect, vi, beforeEach, afterEach} from 'vitest'
import {GithubUtil} from '../../src/utils/github'
import * as github from '@actions/github'

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
  info: vi.fn()
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

test('build annotations', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  // Raw line numbers - will be coalesced in buildAnnotations
  const prFiles = {
    'file1.txt': [132, 133, 134, 135, 136, 137, 138, 139, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007],
    'test/dir/file1.txt': [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]
  }

  const coverageFiles = [
    {
      fileName: 'unchanged.txt',
      missingLineNumbers: [1, 2, 3],
      executableLines: new Set([1, 2, 3])
    },
    {
      fileName: 'file1.txt',
      missingLineNumbers: [1, 2, 3, 132, 134, 135, 136, 1007, 1008],
      // Line 133 is non-executable (comment), so 132-136 should coalesce
      executableLines: new Set([1, 2, 3, 132, 134, 135, 136, 1007, 1008])
    },
    {
      fileName: 'test/dir/file1.txt',
      missingLineNumbers: [20, 21, 22],
      executableLines: new Set([20, 21, 22])
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)

  expect(annotations).toEqual([
    {
      path: 'file1.txt',
      start_line: 132,
      end_line: 136,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    },
    {
      path: 'file1.txt',
      start_line: 1007,
      end_line: 1007,
      annotation_level: 'warning',
      message: 'This line is not covered by a test'
    },
    {
      path: 'test/dir/file1.txt',
      start_line: 22,
      end_line: 22,
      annotation_level: 'warning',
      message: 'This line is not covered by a test'
    }
  ])
})

test('build annotations returns empty array when no matching files', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  const prFiles = {
    'other-file.txt': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  }

  const coverageFiles = [
    {
      fileName: 'file1.txt',
      missingLineNumbers: [1, 2, 3],
      executableLines: new Set([1, 2, 3])
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)
  expect(annotations).toEqual([])
})

test('build annotations bridges gaps for non-executable lines', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  // All lines 1-20 were modified in PR
  const prFiles = {
    'file.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  }

  // Lines 5, 6, 8, 9 are uncovered
  // Line 7 is a comment (non-executable)
  const coverageFiles = [
    {
      fileName: 'file.ts',
      missingLineNumbers: [5, 6, 8, 9],
      executableLines: new Set([5, 6, 8, 9]) // Line 7 not included
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)

  // Should produce single annotation bridging the comment line
  expect(annotations).toEqual([
    {
      path: 'file.ts',
      start_line: 5,
      end_line: 9,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    }
  ])
})

test('build annotations does not bridge gaps with covered lines', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  // All lines 1-20 were modified in PR
  const prFiles = {
    'file.ts': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  }

  // Lines 5, 6, 8, 9 are uncovered
  // Line 7 is covered (executable but has hits)
  const coverageFiles = [
    {
      fileName: 'file.ts',
      missingLineNumbers: [5, 6, 8, 9],
      executableLines: new Set([5, 6, 7, 8, 9]) // Line 7 is executable (covered)
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)

  // Should produce two annotations since line 7 is covered
  expect(annotations).toEqual([
    {
      path: 'file.ts',
      start_line: 5,
      end_line: 6,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    },
    {
      path: 'file.ts',
      start_line: 8,
      end_line: 9,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    }
  ])
})

test('build annotations bridges gaps in PR diff for non-executable lines', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  // User modified lines 5, 6, 8, 9 but NOT line 7 (a comment they didn't touch)
  const prFiles = {
    'file.ts': [5, 6, 8, 9]
  }

  // All of lines 5, 6, 8, 9 are uncovered
  // Line 7 is non-executable (comment)
  const coverageFiles = [
    {
      fileName: 'file.ts',
      missingLineNumbers: [5, 6, 8, 9],
      executableLines: new Set([5, 6, 8, 9]) // Line 7 not included
    }
  ]

  const annotations = githubUtil.buildAnnotations(coverageFiles, prFiles)

  // Should produce single annotation - PR diff gap is bridged because line 7 is non-executable
  expect(annotations).toEqual([
    {
      path: 'file.ts',
      start_line: 5,
      end_line: 9,
      annotation_level: 'warning',
      message: 'These lines are not covered by a test'
    }
  ])
})

test('getPullRequestRef returns branch from pull request', function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')
  const ref = githubUtil.getPullRequestRef()
  expect(ref).toBe('feature-branch')
})

test('getPullRequestRef returns ref when no pull request', function () {
  // Temporarily modify the context
  const originalPayload = github.context.payload
  github.context.payload = {}

  const githubUtil = new GithubUtil('1234', 'https://api.github.com')
  const ref = githubUtil.getPullRequestRef()
  expect(ref).toBe('main')

  // Restore
  github.context.payload = originalPayload
})

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

test('annotate creates check run with annotations', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  const mockCreate = vi.fn().mockResolvedValue({
    status: 201,
    data: {
      id: 12345,
      output: {
        annotations_url: 'https://api.github.com/annotations/12345'
      }
    }
  })

  ;(githubUtil as any).client = {
    rest: {
      checks: {
        create: mockCreate,
        update: vi.fn()
      }
    }
  }

  const annotations = [
    {
      path: 'file1.txt',
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning' as const,
      message: 'This line is not covered by a test'
    }
  ]

  const result = await githubUtil.annotate({
    referenceCommitHash: 'abc123',
    annotations
  })

  expect(result).toBe(201)
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: 'test-owner',
      repo: 'test-repo',
      name: 'Annotate',
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'success',
      output: expect.objectContaining({
        title: 'Coverage Tool',
        summary: 'Missing Coverage',
        annotations
      })
    })
  )
})

test('annotate returns 0 for empty annotations', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  const result = await githubUtil.annotate({
    referenceCommitHash: 'abc123',
    annotations: []
  })

  expect(result).toBe(0)
})

test('annotate handles multiple chunks of annotations', async function () {
  const githubUtil = new GithubUtil('1234', 'https://api.github.com')

  const mockCreate = vi.fn().mockResolvedValue({
    status: 201,
    data: {
      id: 12345,
      output: {
        annotations_url: 'https://api.github.com/annotations/12345'
      }
    }
  })

  const mockUpdate = vi.fn().mockResolvedValue({
    status: 200,
    data: {
      id: 12345,
      output: {
        annotations_url: 'https://api.github.com/annotations/12345'
      }
    }
  })

  ;(githubUtil as any).client = {
    rest: {
      checks: {
        create: mockCreate,
        update: mockUpdate
      }
    }
  }

  // Create 75 annotations (more than 50 chunk size)
  const annotations = Array.from({length: 75}, (_, i) => ({
    path: `file${i}.txt`,
    start_line: 1,
    end_line: 1,
    annotation_level: 'warning' as const,
    message: 'This line is not covered by a test'
  }))

  const result = await githubUtil.annotate({
    referenceCommitHash: 'abc123',
    annotations
  })

  expect(result).toBe(200)
  expect(mockCreate).toHaveBeenCalledTimes(1)
  expect(mockUpdate).toHaveBeenCalledTimes(1)

  // First call should be 'in_progress' without conclusion
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'in_progress'
    })
  )
  expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('conclusion')

  // Second call should be 'completed' with conclusion
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      check_run_id: 12345,
      status: 'in_progress',
      conclusion: 'success'
    })
  )
})

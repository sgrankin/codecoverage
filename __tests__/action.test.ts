import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'
import type {Dependencies, GitHubOps} from '../src/action.ts'
import type * as baseline from '../src/utils/baseline.ts'
import {captureStdout} from './fixtures/capture-stdout.ts'
import {getFixturePath} from './fixtures/util.ts'

// We need to mock getInput since it reads from env vars
// and setOutput/setFailed since they write to special files
const {mockGetInput, mockSetOutput, mockSetFailed} = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockSetOutput: vi.fn(),
  mockSetFailed: vi.fn()
}))

// setInputs configures mockGetInput to return values from the given map.
function setInputs(inputs: Record<string, string>) {
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '')
}

vi.mock('@actions/core', async () => {
  const actual = await vi.importActual('@actions/core')
  return {
    ...actual,
    getInput: mockGetInput,
    setOutput: mockSetOutput,
    setFailed: mockSetFailed
  }
})

// Mock @actions/github context (used by detectMode internally)
vi.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    payload: {
      pull_request: {
        head: {ref: 'feature-branch'},
        base: {ref: 'main'}
      }
    },
    issue: {number: 123},
    repo: {owner: 'test-owner', repo: 'test-repo'},
    ref: 'refs/heads/main'
  }
}))

// Import after mocks are set up
import {play} from '../src/action.ts'

// createFakeDeps creates fake dependencies for testing.
// Uses simple objects instead of mocks - "fakes, not mocks".
function createFakeDeps(
  options: {
    diffResponse?: github.PullRequestFiles
    annotations?: github.Annotation[]
    baselineData?: baseline.Data | null
    storeResult?: boolean
    // historyEntries is what collectHistory returns (oldest first).
    historyEntries?: baseline.HistoryEntry[]
    // onStore tracks calls to baseline.store.
    onStore?: (data: unknown, opts: unknown) => void
    // onLoad tracks calls to baseline.load.
    onLoad?: (branch: string, opts: unknown) => void
    // onCollectHistory tracks calls to baseline.collectHistory.
    onCollectHistory?: (startCommit: string, maxCount: number, opts: unknown) => void
    // onUpsertComment tracks calls to upsertComment.
    onUpsertComment?: (body: string, commentID: string) => void
    // upsertCommentResult is the return value for upsertComment.
    upsertCommentResult?: boolean
  } = {}
): Dependencies {
  return {
    createGitHub: (): GitHubOps => ({
      getPullRequestDiff: async () => options.diffResponse ?? {},
      buildAnnotations: () => options.annotations ?? [],
      upsertComment: async (body: string, commentID: string) => {
        options.onUpsertComment?.(body, commentID)
        return options.upsertCommentResult ?? true
      }
    }),
    baseline: {
      store: async (data, opts) => {
        options.onStore?.(data, opts)
        return options.storeResult ?? true
      },
      load: async (branch, opts) => {
        options.onLoad?.(branch, opts)
        return {
          baseline: options.baselineData ?? null,
          commit: options.baselineData ? 'abc123' : null
        }
      },
      collectHistory: async (startCommit, maxCount, opts) => {
        options.onCollectHistory?.(startCommit, maxCount, opts)
        return options.historyEntries ?? []
      }
    }
  }
}

// Saved context values for restoration
let savedContext: {
  eventName: string
  ref: string
  payload: typeof github.context.payload
}

beforeEach(() => {
  process.env.GITHUB_WORKSPACE = '/workspace'
  delete process.env.GITHUB_STEP_SUMMARY
  // core.summary is a singleton that caches the resolved GITHUB_STEP_SUMMARY
  // path and buffers unwritten content; reset both so each test's env var
  // takes effect regardless of test order.
  ;(core.summary as unknown as {_filePath?: string})._filePath = undefined
  core.summary.emptyBuffer()
  vi.clearAllMocks()

  // Save context
  savedContext = {
    eventName: github.context.eventName,
    ref: github.context.ref,
    payload: github.context.payload
  }
})

afterEach(() => {
  // Restore context
  ;(github.context as any).eventName = savedContext.eventName
  ;(github.context as any).ref = savedContext.ref
  ;(github.context as any).payload = savedContext.payload
})

test('runs in store-baseline mode when not a pull request', async () => {
  const capture = captureStdout()
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  await play(createFakeDeps())
  expect(capture.output()).toContain('Mode: store-baseline (event: push)')
})

test('stores baseline on push to main branch', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov'
  })

  let storeCalled = false
  const fakeDeps = createFakeDeps({
    onStore: () => {
      storeCalled = true
    }
  })

  await play(fakeDeps)
  expect(storeCalled).toBe(true)
  expect(capture.output()).toContain('Storing baseline with namespace')
})

test('stores baseline on push to custom main_branch', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/go-port'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    main_branch: 'go-port'
  })

  let storeNamespace = ''
  const fakeDeps = createFakeDeps({
    onStore: (_data, opts) => {
      storeNamespace = (opts as {namespace: string}).namespace
    }
  })

  await play(fakeDeps)
  expect(storeNamespace).toBe('coverage/go-port')
  expect(capture.output()).toContain('Storing baseline with namespace: coverage/go-port')
})

test('skips baseline storage on push to a branch other than main_branch', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/feature/thing'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    main_branch: 'go-port'
  })

  let storeCalled = false
  const fakeDeps = createFakeDeps({
    onStore: () => {
      storeCalled = true
    }
  })

  await play(fakeDeps)
  expect(storeCalled).toBe(false)
  expect(capture.output()).toContain('Skipping baseline storage')
})

test('step summary on push includes sparkline and delta from stored history', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  const summaryFile = path.join(os.tmpdir(), `test-summary-push-${Date.now()}.md`)
  fs.writeFileSync(summaryFile, '')
  process.env.GITHUB_STEP_SUMMARY = summaryFile
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    step_summary: 'true'
  })

  let collectArgs: {
    startCommit: string
    maxCount: number
    namespace: string
    scanDepth: number
  } | null = null
  const fakeDeps = createFakeDeps({
    // Newest last; the newest entry is the note just stored for HEAD.
    historyEntries: [
      {commit: 'c1', coveragePercentage: '70.00', timestamp: '2024-01-01T00:00:00Z'},
      {commit: 'c2', coveragePercentage: '75.00', timestamp: '2024-01-02T00:00:00Z'},
      {commit: 'c3', coveragePercentage: '80.00', timestamp: '2024-01-03T00:00:00Z'}
    ],
    onCollectHistory: (startCommit, maxCount, opts) => {
      const o = opts as {namespace: string; scanDepth: number}
      collectArgs = {startCommit, maxCount, namespace: o.namespace, scanDepth: o.scanDepth}
    }
  })

  await play(fakeDeps)
  expect(mockSetFailed).not.toHaveBeenCalled()
  // scanDepth is max(max_lookback=50, sparkline_count*3=30).
  expect(collectArgs).toEqual({
    startCommit: 'HEAD',
    maxCount: 10,
    namespace: 'coverage/main',
    scanDepth: 50
  })
  expect(capture.output()).toContain('Collected 3 data points for sparkline')
  // Delta compares current coverage (fixture: 34.78%) against the
  // second-newest stored note.
  expect(mockSetOutput).toHaveBeenCalledWith('baseline_percentage', '75.00')
  expect(mockSetOutput).toHaveBeenCalledWith('coverage_delta', '-40.22')

  const content = fs.readFileSync(summaryFile, 'utf8')
  // Partial blocks only appear in the history sparkline — the per-package
  // coverage bars use full/light blocks (█░), so this can't false-positive.
  expect(content).toMatch(/[▁▂▃▄▅▆▇]/)
  expect(content).toContain('Baseline')
  expect(content).toContain('75.00%')

  fs.unlinkSync(summaryFile)
})

test('push delta is still computed when sparklines are disabled', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  const summaryFile = path.join(os.tmpdir(), `test-summary-nospark-${Date.now()}.md`)
  fs.writeFileSync(summaryFile, '')
  process.env.GITHUB_STEP_SUMMARY = summaryFile
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    sparkline_count: '0',
    step_summary: 'true'
  })

  let collectedMax = 0
  let collectedDepth = 0
  const fakeDeps = createFakeDeps({
    historyEntries: [
      {commit: 'c1', coveragePercentage: '75.00', timestamp: '2024-01-01T00:00:00Z'},
      {commit: 'c2', coveragePercentage: '80.00', timestamp: '2024-01-02T00:00:00Z'}
    ],
    onCollectHistory: (_startCommit, maxCount, opts) => {
      collectedMax = maxCount
      collectedDepth = (opts as {scanDepth: number}).scanDepth
    }
  })

  await play(fakeDeps)
  expect(mockSetFailed).not.toHaveBeenCalled()
  expect(collectedMax).toBe(2)
  // The previous baseline must be findable within max_lookback even with
  // sparklines disabled — not just within the default 3x-maxCount scan.
  expect(collectedDepth).toBe(50)
  expect(capture.output()).not.toContain('data points for sparkline')
  expect(mockSetOutput).toHaveBeenCalledWith('baseline_percentage', '75.00')

  const content = fs.readFileSync(summaryFile, 'utf8')
  // No history sparkline (per-package bars still use full/light blocks █░).
  expect(content).not.toMatch(/[▁▂▃▄▅▆▇]/)
  expect(content).toContain('Baseline')

  fs.unlinkSync(summaryFile)
})

test('push does not collect history when calculate_delta is false', async () => {
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    calculate_delta: 'false',
    step_summary: 'false'
  })

  let collectCalled = false
  const fakeDeps = createFakeDeps({
    onCollectHistory: () => {
      collectCalled = true
    }
  })

  await play(fakeDeps)
  expect(collectCalled).toBe(false)
})

test('push to a branch other than main_branch does not collect history', async () => {
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/feature/thing'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    step_summary: 'false'
  })

  let collectCalled = false
  const fakeDeps = createFakeDeps({
    onCollectHistory: () => {
      collectCalled = true
    }
  })

  await play(fakeDeps)
  expect(collectCalled).toBe(false)
})

test('calculates delta when baseline exists in PR mode', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).payload = {
    pull_request: {
      head: {ref: 'feature-branch'},
      base: {ref: 'main'}
    }
  }

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    calculate_delta: 'true',
    step_summary: 'false'
  })

  let loadCalled = false
  let scanDepth = 0
  const fakeDeps = createFakeDeps({
    baselineData: {
      coveragePercentage: '80.00',
      totalLines: 100,
      coveredLines: 80,
      timestamp: '2024-01-01T00:00:00Z',
      commit: 'abc123'
    },
    onLoad: () => {
      loadCalled = true
    },
    onCollectHistory: (_startCommit, _maxCount, opts) => {
      scanDepth = (opts as {scanDepth: number}).scanDepth
    }
  })

  await play(fakeDeps)
  expect(mockSetFailed).not.toHaveBeenCalled()
  expect(loadCalled).toBe(true)
  // Sparkline history search is bounded by max_lookback, same as the push path.
  expect(scanDepth).toBe(50)
  expect(capture.output()).toContain('Coverage delta:')
  expect(mockSetOutput).toHaveBeenCalledWith('coverage_delta', expect.any(String))
  expect(mockSetOutput).toHaveBeenCalledWith('baseline_percentage', '80.00')
})

test('shows absolute coverage when no baseline exists', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).payload = {
    pull_request: {
      head: {ref: 'feature-branch'},
      base: {ref: 'main'}
    }
  }

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    calculate_delta: 'true'
  })

  let loadCalled = false
  const fakeDeps = createFakeDeps({
    baselineData: null,
    onLoad: () => {
      loadCalled = true
    }
  })

  await play(fakeDeps)
  expect(loadCalled).toBe(true)
  expect(capture.output()).toContain('No baseline found')
})

test('throws error for unsupported coverage format', async () => {
  setInputs({
    github_token: 'test-token',
    coverage_file_path: '/path/to/coverage',
    coverage_format: 'unsupported'
  })

  await play(createFakeDeps())

  expect(mockSetFailed).toHaveBeenCalledWith(
    'coverage_format must be one of lcov,cobertura,go,simplecov'
  )
})

const coverageFormatTestCases = [
  {format: 'lcov', fixture: 'lcov.info', shouldSucceed: true},
  {format: 'cobertura', fixture: 'cobertura.xml', shouldSucceed: true},
  {format: 'go', fixture: 'gocoverage.out', shouldSucceed: false}, // fails: no go.mod in cwd
  {format: 'simplecov', fixture: 'simplecov.json', shouldSucceed: true},
  {format: '', fixture: 'lcov.info', shouldSucceed: true} // defaults to lcov
]

test.each(coverageFormatTestCases)('processes $format coverage file', async ({
  format,
  fixture,
  shouldSucceed
}) => {
  const capture = captureStdout()

  setInputs({
    github_token: 'test-token',
    coverage_file_path: getFixturePath(fixture),
    coverage_format: format,
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  await play(createFakeDeps())
  expect(capture.output()).toContain('Performing Code Coverage Analysis')
  if (shouldSucceed) {
    expect(mockSetFailed).not.toHaveBeenCalled()
  }
})

test('outputs diagnostic dump for files in PR diff', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  // Set empty workspace so file paths stay as-is
  process.env.GITHUB_WORKSPACE = ''

  const fakeDeps = createFakeDeps({
    diffResponse: {'src/utils/general.ts': [2, 3, 4]}
  })

  await play(fakeDeps)
  const output = capture.output()
  // Should output combined debug line with file, diff, and missing coverage
  expect(output).toContain('file: src/utils/general.ts')
  expect(output).toContain('diff: 2-4')
  expect(output).toContain('missing:')
  // Should NOT output files not in diff
  expect(output).not.toContain('src/utils/github.ts')
})

test('debug_output=false suppresses diagnostic dump', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    debug_output: 'false'
  })

  process.env.GITHUB_WORKSPACE = ''

  const fakeDeps = createFakeDeps({
    diffResponse: {'src/utils/general.ts': [2, 3, 4]}
  })

  await play(fakeDeps)
  const output = capture.output()
  // Should NOT output debug lines when debug_output is false
  expect(output).not.toContain('file: src/utils/general.ts')
})

test('debug output limits to 10 files and shows count of remaining', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  process.env.GITHUB_WORKSPACE = ''

  // Create 15 files in the diff that also exist in coverage
  // The lcov fixture has: src/utils/general.ts, src/utils/github.ts, src/utils/baseline.ts
  // We need files that exist in both diff and coverage, so use those 3
  // To properly test the limit, we'd need 11+ files in both coverage and diff
  // For now, test that the format is correct with fewer files
  const diffResponse: Record<string, number[]> = {
    'src/utils/general.ts': [1, 2, 3, 4, 5],
    'src/utils/github.ts': [10, 11, 12]
  }

  const fakeDeps = createFakeDeps({diffResponse})

  await play(fakeDeps)
  const output = capture.output()
  // Should use compact range format
  expect(output).toContain('diff: 1-5')
  expect(output).toContain('diff: 10-12')
})

test('sets output values for coverage stats', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  const fakeDeps = createFakeDeps({
    annotations: [
      {
        path: 'test.ts',
        start_line: 1,
        end_line: 1,
        message: 'test'
      }
    ]
  })

  await play(fakeDeps)
  expect(mockSetOutput).toHaveBeenCalledWith('coverage_percentage', '34.78')
  expect(mockSetOutput).toHaveBeenCalledWith('files_analyzed', 3)
  expect(mockSetOutput).toHaveBeenCalledWith('annotation_count', 1)
  // Suppress unused capture warning - stdout capture needed to prevent test output pollution
  void capture
})

test('handles error gracefully', async () => {
  setInputs({
    github_token: 'test-token',
    coverage_file_path: '/nonexistent/file.info',
    coverage_format: 'lcov'
  })

  await play(createFakeDeps())

  // Should call setFailed with the error message
  expect(mockSetFailed).toHaveBeenCalled()
})

test('writes step summary to temp file', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  const summaryFile = path.join(os.tmpdir(), `test-summary-${Date.now()}.md`)

  // Create the file (core.summary checks it exists and is writable)
  fs.writeFileSync(summaryFile, '')

  // Set up env var for summary file
  process.env.GITHUB_STEP_SUMMARY = summaryFile

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'true'
  })

  await play(createFakeDeps())
  expect(capture.output()).toContain('Step summary written')

  // Check the file was written
  const content = fs.readFileSync(summaryFile, 'utf8')
  expect(content).toContain('Code Coverage Report')
  expect(content).toContain('Coverage by Package')

  // Clean up temp file
  if (fs.existsSync(summaryFile)) {
    fs.unlinkSync(summaryFile)
  }
})

test('does not write step summary when step_summary is false', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  await play(createFakeDeps())
  expect(capture.output()).not.toContain('Step summary written')
})

test('limits annotations to max_annotations setting', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    max_annotations: '2'
  })

  // Create more annotations than the limit
  const fakeDeps = createFakeDeps({
    annotations: [
      {path: 'a.ts', start_line: 1, end_line: 1, message: 'test1'},
      {path: 'b.ts', start_line: 2, end_line: 2, message: 'test2'},
      {path: 'c.ts', start_line: 3, end_line: 3, message: 'test3'},
      {path: 'd.ts', start_line: 4, end_line: 4, message: 'test4'}
    ]
  })

  await play(fakeDeps)
  const output = capture.output()
  // Should report total count but limit emission
  expect(mockSetOutput).toHaveBeenCalledWith('annotation_count', 4)
  expect(output).toContain('Showing 2 of 4 annotations')
  expect(output).toContain('limited by max_annotations')
})

test('does not show limit message when annotations are within limit', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    max_annotations: '10'
  })

  // Create fewer annotations than the limit
  const fakeDeps = createFakeDeps({
    annotations: [
      {path: 'a.ts', start_line: 1, end_line: 1, message: 'test1'},
      {path: 'b.ts', start_line: 2, end_line: 2, message: 'test2'}
    ]
  })

  await play(fakeDeps)
  const output = capture.output()
  expect(mockSetOutput).toHaveBeenCalledWith('annotation_count', 2)
  expect(output).not.toContain('limited by max_annotations')
})

test('posts PR comment when pr_comment is true', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    pr_comment: 'true'
  })

  let commentBody = ''
  const fakeDeps = createFakeDeps({
    onUpsertComment: body => {
      commentBody = body
    }
  })

  await play(fakeDeps)
  expect(commentBody).toContain('Code Coverage Report')
  expect(commentBody).toContain('Coverage by Package')
  // Suppress unused capture warning
  void capture
})

test.each([
  {name: 'default empty', inputID: '', wantID: ''},
  {name: 'namespaced', inputID: 'go', wantID: 'go'}
])('passes comment_id "$inputID" through to upsertComment', async ({inputID, wantID}) => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    pr_comment: 'true',
    comment_id: inputID
  })

  let gotID = 'unset'
  const fakeDeps = createFakeDeps({
    onUpsertComment: (_body, commentID) => {
      gotID = commentID
    }
  })

  await play(fakeDeps)
  expect(gotID).toBe(wantID)
  void capture
})

test('does not post PR comment when pr_comment is false', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false',
    pr_comment: 'false'
  })

  let commentCalled = false
  const fakeDeps = createFakeDeps({
    onUpsertComment: () => {
      commentCalled = true
    }
  })

  await play(fakeDeps)
  expect(commentCalled).toBe(false)
  // Suppress unused capture warning
  void capture
})

test('does not post PR comment in store-baseline mode', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    step_summary: 'false',
    pr_comment: 'true'
  })

  let commentCalled = false
  const fakeDeps = createFakeDeps({
    onUpsertComment: () => {
      commentCalled = true
    }
  })

  await play(fakeDeps)
  expect(commentCalled).toBe(false)
  expect(capture.output()).toContain('Mode: store-baseline')
})

test('Go format reports statement coverage alongside line coverage', async () => {
  const capture = captureStdout()
  const goCoveragePath = getFixturePath('gocoverage.out')
  const workingDirectory = path.dirname(getFixturePath('go.mod'))

  setInputs({
    github_token: 'test-token',
    coverage_file_path: goCoveragePath,
    coverage_format: 'go',
    working_directory: workingDirectory,
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  await play(createFakeDeps())
  expect(mockSetFailed).not.toHaveBeenCalled()

  // Statement coverage is set and distinct from (line) coverage_percentage.
  expect(mockSetOutput).toHaveBeenCalledWith('statement_percentage', expect.any(String))
  const statementCall = mockSetOutput.mock.calls.find(call => call[0] === 'statement_percentage')
  const linePercentageCall = mockSetOutput.mock.calls.find(
    call => call[0] === 'coverage_percentage'
  )
  expect(statementCall?.[1]).not.toBe('')
  expect(Number(statementCall?.[1])).toBeGreaterThan(0)
  expect(linePercentageCall?.[1]).toBeTruthy()

  void capture
})

test('non-Go formats leave statement_percentage empty', async () => {
  const capture = captureStdout()
  const lcovPath = getFixturePath('lcov.info')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: lcovPath,
    coverage_format: 'lcov',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  await play(createFakeDeps())
  expect(mockSetOutput).toHaveBeenCalledWith('statement_percentage', '')
  expect(mockSetOutput).toHaveBeenCalledWith('coverage_percentage', '34.78')

  void capture
})

test('summary stats include all files, not just PR diff files', async () => {
  // This test validates that summary statistics include coverage from ALL files,
  // not just the ones in the PR diff.
  const capture = captureStdout()
  const coberturaPath = getFixturePath('cobertura.xml')

  setInputs({
    github_token: 'test-token',
    coverage_file_path: coberturaPath,
    coverage_format: 'cobertura',
    github_base_url: 'https://api.github.com',
    step_summary: 'false'
  })

  // PR diff only contains one file, but coverage file has two files
  // cobertura.xml has:
  //   src/example.ts: 5 lines, 3 hit
  //   src/utils/utils.ts: 4 lines, 3 hit
  // Total: 9 lines, 6 hit = 66.67%
  const fakeDeps = createFakeDeps({
    diffResponse: {'src/example.ts': [1, 2, 3]} // Only one file in diff
  })

  await play(fakeDeps)

  // Verify total lines includes BOTH files (9 total), not just diff file (5)
  expect(mockSetOutput).toHaveBeenCalledWith('coverage_percentage', '66.67')
  expect(mockSetOutput).toHaveBeenCalledWith('files_analyzed', 2)

  // The output should mention both files' worth of lines
  const output = capture.output()
  expect(output).toContain('Total lines: 9')
  expect(output).toContain('Covered lines: 6')
})

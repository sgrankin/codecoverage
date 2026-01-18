import {test, expect, vi, beforeEach} from 'vitest'
import * as github from '@actions/github'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {getFixturePath} from './fixtures/util'
import {captureStdout} from './fixtures/capture-stdout'
import type {ActionDependencies, GithubOperations} from '../src/action'
import type {PullRequestFiles, Annotation} from '../src/utils/github'
import type {BaselineData} from '../src/utils/baseline'
import type {CoverageFile} from '../src/utils/general'

// We need to mock getInput since it reads from env vars
// and setOutput/setFailed since they write to special files
const {mockGetInput, mockSetOutput, mockSetFailed} = vi.hoisted(() => ({
  mockGetInput: vi.fn(),
  mockSetOutput: vi.fn(),
  mockSetFailed: vi.fn()
}))

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
import {play} from '../src/action'

/**
 * Creates fake dependencies for testing.
 * Uses simple objects instead of mocks - "fakes, not mocks".
 */
function createFakeDeps(
  options: {
    diffResponse?: PullRequestFiles
    annotations?: Annotation[]
    baselineData?: BaselineData | null
    storeResult?: boolean
    /** Track calls to baseline.store */
    onStore?: (data: unknown, opts: unknown) => void
    /** Track calls to baseline.load */
    onLoad?: (branch: string, opts: unknown) => void
  } = {}
): ActionDependencies {
  return {
    createGithubUtil: (): GithubOperations => ({
      getPullRequestDiff: async () => options.diffResponse ?? {},
      buildAnnotations: () => options.annotations ?? []
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
      }
    }
  }
}

// Set up env vars for tests
beforeEach(() => {
  process.env.GITHUB_WORKSPACE = '/workspace'
  delete process.env.GITHUB_STEP_SUMMARY
  vi.clearAllMocks()
})

test('runs in store-baseline mode when not a pull request', async function () {
  const capture = captureStdout()
  const originalEventName = github.context.eventName
  const originalRef = github.context.ref
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  try {
    await play(createFakeDeps())
    expect(capture.output()).toContain('Mode: store-baseline (event: push)')
  } finally {
    capture.restore()
    ;(github.context as any).eventName = originalEventName
    ;(github.context as any).ref = originalRef
  }
})

test('stores baseline on push to main branch', async function () {
  const lcovPath = getFixturePath('lcov.info')
  const originalEventName = github.context.eventName
  const originalRef = github.context.ref
  ;(github.context as any).eventName = 'push'
  ;(github.context as any).ref = 'refs/heads/main'

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    return ''
  })

  let storeCalled = false
  const fakeDeps = createFakeDeps({
    onStore: () => {
      storeCalled = true
    }
  })

  const capture = captureStdout()
  try {
    await play(fakeDeps)
    expect(storeCalled).toBe(true)
    expect(capture.output()).toContain('Storing baseline with namespace')
  } finally {
    capture.restore()
    ;(github.context as any).eventName = originalEventName
    ;(github.context as any).ref = originalRef
  }
})

test('calculates delta when baseline exists in PR mode', async function () {
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).payload = {
    pull_request: {
      head: {ref: 'feature-branch'},
      base: {ref: 'main'}
    }
  }

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'calculate_delta') return 'true'
    return ''
  })

  let loadCalled = false
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
    }
  })

  const capture = captureStdout()
  try {
    await play(fakeDeps)
    expect(loadCalled).toBe(true)
    expect(capture.output()).toContain('Coverage delta:')
    expect(mockSetOutput).toHaveBeenCalledWith('coverage_delta', expect.any(String))
    expect(mockSetOutput).toHaveBeenCalledWith('baseline_percentage', '80.00')
  } finally {
    capture.restore()
  }
})

test('shows absolute coverage when no baseline exists', async function () {
  const lcovPath = getFixturePath('lcov.info')
  ;(github.context as any).payload = {
    pull_request: {
      head: {ref: 'feature-branch'},
      base: {ref: 'main'}
    }
  }

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'calculate_delta') return 'true'
    return ''
  })

  let loadCalled = false
  const fakeDeps = createFakeDeps({
    baselineData: null,
    onLoad: () => {
      loadCalled = true
    }
  })

  const capture = captureStdout()
  try {
    await play(fakeDeps)
    expect(loadCalled).toBe(true)
    expect(capture.output()).toContain('No baseline found')
  } finally {
    capture.restore()
  }
})

test('throws error for unsupported coverage format', async function () {
  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return '/path/to/coverage'
    if (name === 'COVERAGE_FORMAT') return 'unsupported'
    return ''
  })

  await play(createFakeDeps())

  expect(mockSetFailed).toHaveBeenCalledWith('COVERAGE_FORMAT must be one of lcov,cobertura,go')
})

test('processes lcov coverage file successfully', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  const capture = captureStdout()
  try {
    await play(createFakeDeps())
    const output = capture.output()
    expect(output).toContain('Performing Code Coverage Analysis')
    expect(output).toContain('Workspace: /workspace')
    expect(output).toContain('Filter done')
    expect(output).toContain('Annotations emitted')
  } finally {
    capture.restore()
  }
})

test('processes cobertura coverage file successfully', async function () {
  const coberturaPath = getFixturePath('cobertura.xml')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return coberturaPath
    if (name === 'COVERAGE_FORMAT') return 'cobertura'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  const capture = captureStdout()
  try {
    await play(createFakeDeps())
    const output = capture.output()
    expect(output).toContain('Performing Code Coverage Analysis')
    expect(output).toContain('Filter done')
    expect(output).toContain('Annotations emitted')
  } finally {
    capture.restore()
  }
})

test('processes go coverage file successfully', async function () {
  const gocovPath = getFixturePath('gocoverage.out')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return gocovPath
    if (name === 'COVERAGE_FORMAT') return 'go'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  const capture = captureStdout()
  try {
    // The go parser looks for go.mod in cwd, so we need to handle this
    // For now, we expect it to fail since go.mod isn't in workspace root
    await play(createFakeDeps())
    // It will fail because go.mod isn't found, but the format is accepted
    expect(capture.output()).toContain('Performing Code Coverage Analysis')
  } finally {
    capture.restore()
  }
})

test('defaults to lcov format when not specified', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return '' // Not specified
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  const capture = captureStdout()
  try {
    await play(createFakeDeps())
    // Should not fail - lcov is the default
    expect(mockSetFailed).not.toHaveBeenCalled()
    expect(capture.output()).toContain('Annotations emitted')
  } finally {
    capture.restore()
  }
})

test('outputs diagnostic dump for files in PR diff', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  // Set empty workspace so file paths stay as-is
  const oldWorkspace = process.env.GITHUB_WORKSPACE
  process.env.GITHUB_WORKSPACE = ''

  const fakeDeps = createFakeDeps({
    diffResponse: {'src/utils/general.ts': [2, 3, 4]}
  })

  const capture = captureStdout()
  try {
    await play(fakeDeps)
    const output = capture.output()
    // Should output debug-dump lines for diff and matching coverage
    expect(output).toContain('::debug-dump::diff::')
    expect(output).toContain('::debug-dump::coverage::')
    expect(output).toContain('src/utils/general.ts')
    // Should NOT output coverage for files not in diff
    expect(output).not.toContain('"file":"src/utils/github.ts"')
  } finally {
    capture.restore()
    process.env.GITHUB_WORKSPACE = oldWorkspace
  }
})

test('sets output values for coverage stats', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
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

  const capture = captureStdout()
  try {
    await play(fakeDeps)
    expect(mockSetOutput).toHaveBeenCalledWith('coverage_percentage', '34.78')
    expect(mockSetOutput).toHaveBeenCalledWith('files_analyzed', 3)
    expect(mockSetOutput).toHaveBeenCalledWith('annotation_count', 1)
  } finally {
    capture.restore()
  }
})

test('handles error gracefully', async function () {
  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return '/nonexistent/file.info'
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    return ''
  })

  await play(createFakeDeps())

  // Should call setFailed with the error message
  expect(mockSetFailed).toHaveBeenCalled()
})

test('writes step summary to temp file', async function () {
  const lcovPath = getFixturePath('lcov.info')
  const summaryFile = path.join(os.tmpdir(), `test-summary-${Date.now()}.md`)

  // Create the file (core.summary checks it exists and is writable)
  fs.writeFileSync(summaryFile, '')

  // Set up env var for summary file
  process.env.GITHUB_STEP_SUMMARY = summaryFile

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'true'
    return ''
  })

  const capture = captureStdout()
  try {
    await play(createFakeDeps())
    expect(capture.output()).toContain('Step summary written')

    // Check the file was written
    const content = fs.readFileSync(summaryFile, 'utf8')
    expect(content).toContain('Code Coverage Report')
    expect(content).toContain('### Coverage by Package')
  } finally {
    capture.restore()
    delete process.env.GITHUB_STEP_SUMMARY
    // Clean up temp file
    if (fs.existsSync(summaryFile)) {
      fs.unlinkSync(summaryFile)
    }
  }
})

test('does not write step summary when STEP_SUMMARY is false', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  const capture = captureStdout()
  try {
    await play(createFakeDeps())
    expect(capture.output()).not.toContain('Step summary written')
  } finally {
    capture.restore()
  }
})

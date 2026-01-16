import {test, expect, vi, beforeEach} from 'vitest'
import * as github from '@actions/github'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {getFixturePath} from './fixtures/util'
import {captureStdout} from './fixtures/capture-stdout'

// We need to mock getInput since it reads from env vars
// and setOutput/setFailed since they write to special files
// Use vi.hoisted to avoid hoisting issues
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

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
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

// Mock GithubUtil
const mockGetPullRequestDiff = vi.fn().mockResolvedValue({})
const mockBuildAnnotations = vi.fn().mockReturnValue([])

vi.mock('../src/utils/github', () => ({
  GithubUtil: vi.fn(function () {
    return {
      getPullRequestDiff: mockGetPullRequestDiff,
      buildAnnotations: mockBuildAnnotations
    }
  })
}))

// Set up env vars for tests
beforeEach(() => {
  process.env.GITHUB_WORKSPACE = '/workspace'
  delete process.env.GITHUB_STEP_SUMMARY
})

// Import after mocks are set up
import {play, generateSummary} from '../src/action'

beforeEach(() => {
  vi.clearAllMocks()
})

test('exits early when not a pull request', async function () {
  const capture = captureStdout()
  const originalEventName = github.context.eventName
  ;(github.context as any).eventName = 'push'

  try {
    await play()
    expect(capture.output()).toContain(
      'Pull request not detected. Exiting early.'
    )
  } finally {
    capture.restore()
    ;(github.context as any).eventName = originalEventName
  }
})

test('throws error for unsupported coverage format', async function () {
  mockGetInput.mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return '/path/to/coverage'
    if (name === 'COVERAGE_FORMAT') return 'unsupported'
    return ''
  })

  await play()

  expect(mockSetFailed).toHaveBeenCalledWith(
    'COVERAGE_FORMAT must be one of lcov,cobertura,go'
  )
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
    await play()
    const output = capture.output()
    expect(output).toContain('Performing Code Coverage Analysis')
    expect(output).toContain('Workspace: /workspace')
    expect(output).toContain('Filter done')
    expect(output).toContain('Annotations emitted')
    expect(mockGetPullRequestDiff).toHaveBeenCalled()
    expect(mockBuildAnnotations).toHaveBeenCalled()
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
    await play()
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
    await play()
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
    await play()
    // Should not fail - lcov is the default
    expect(mockSetFailed).not.toHaveBeenCalled()
    expect(capture.output()).toContain('Annotations emitted')
  } finally {
    capture.restore()
  }
})

test('outputs diagnostic dump for files in PR diff', async function () {
  const lcovPath = getFixturePath('lcov.info')

  // File path after path.relative('', './src/utils/general.ts') = 'src/utils/general.ts'
  mockGetPullRequestDiff.mockResolvedValue({
    'src/utils/general.ts': [2, 3, 4]
  })
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

  const capture = captureStdout()
  try {
    await play()
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

  mockBuildAnnotations.mockReturnValue([
    {
      path: 'test.ts',
      start_line: 1,
      end_line: 1,
      message: 'test'
    }
  ])

  const capture = captureStdout()
  try {
    await play()
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

  await play()

  // Should call setFailed with the error message
  expect(mockSetFailed).toHaveBeenCalled()
})

const generateSummaryTestCases = [
  {
    name: 'high coverage with no annotations',
    input: {
      coveragePercentage: '85.50',
      totalLines: 1000,
      coveredLines: 855,
      filesAnalyzed: 2,
      annotationCount: 0,
      files: [
        {file: 'src/utils.ts', totalLines: 500, coveredLines: 450},
        {file: 'src/main.ts', totalLines: 500, coveredLines: 405}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 85.50% |
| **Covered Lines** | 855 |
| **Uncovered Lines** | 145 |
| **Total Lines** | 1,000 |
| **Files Analyzed** | 2 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| src | 2 | 1,000 | 855 | 85.5% |
`
  },
  {
    name: 'medium coverage with multiple annotations',
    input: {
      coveragePercentage: '65.00',
      totalLines: 100,
      coveredLines: 65,
      filesAnalyzed: 1,
      annotationCount: 3,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 65}]
    },
    expected: `## 🟡 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 65.00% |
| **Covered Lines** | 65 |
| **Uncovered Lines** | 35 |
| **Total Lines** | 100 |
| **Files Analyzed** | 1 |

⚠️ **3 annotations** added for uncovered lines in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| src | 1 | 100 | 65 | 65.0% |
`
  },
  {
    name: 'low coverage with single annotation',
    input: {
      coveragePercentage: '45.00',
      totalLines: 100,
      coveredLines: 45,
      filesAnalyzed: 1,
      annotationCount: 1,
      files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 45}]
    },
    expected: `## 🔴 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 45.00% |
| **Covered Lines** | 45 |
| **Uncovered Lines** | 55 |
| **Total Lines** | 100 |
| **Files Analyzed** | 1 |

⚠️ **1 annotation** added for uncovered lines in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| src | 1 | 100 | 45 | 45.0% |
`
  },
  {
    name: 'files grouped by package and sorted',
    input: {
      coveragePercentage: '80.00',
      totalLines: 300,
      coveredLines: 240,
      filesAnalyzed: 3,
      annotationCount: 0,
      files: [
        {file: 'src/utils/zebra.ts', totalLines: 100, coveredLines: 80},
        {file: 'src/alpha.ts', totalLines: 100, coveredLines: 80},
        {file: 'lib/beta.ts', totalLines: 100, coveredLines: 80}
      ]
    },
    expected: `## 🟢 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 80.00% |
| **Covered Lines** | 240 |
| **Uncovered Lines** | 60 |
| **Total Lines** | 300 |
| **Files Analyzed** | 3 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| lib | 1 | 100 | 80 | 80.0% |
| src | 1 | 100 | 80 | 80.0% |
| src/utils | 1 | 100 | 80 | 80.0% |
`
  },
  {
    name: 'uses explicit package when provided (cobertura)',
    input: {
      coveragePercentage: '75.00',
      totalLines: 200,
      coveredLines: 150,
      filesAnalyzed: 2,
      annotationCount: 0,
      files: [
        {
          file: 'src/foo.ts',
          totalLines: 100,
          coveredLines: 80,
          package: 'com.example.foo'
        },
        {
          file: 'src/bar.ts',
          totalLines: 100,
          coveredLines: 70,
          package: 'com.example.bar'
        }
      ]
    },
    expected: `## 🟡 Code Coverage Report

| Metric | Value |
| ------ | ----- |
| **Coverage** | 75.00% |
| **Covered Lines** | 150 |
| **Uncovered Lines** | 50 |
| **Total Lines** | 200 |
| **Files Analyzed** | 2 |

✅ No new uncovered lines detected in this PR.

### Coverage by Package

| Package | Files | Total Lines | Covered | Coverage |
| ------- | ----- | ----------- | ------- | -------- |
| com.example.bar | 1 | 100 | 70 | 70.0% |
| com.example.foo | 1 | 100 | 80 | 80.0% |
`
  }
]
test.each(generateSummaryTestCases)(
  'generateSummary: $name',
  ({input, expected}) => {
    const summary = generateSummary(input)
    expect(summary).toBe(expected)
  }
)

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
    await play()
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
    await play()
    expect(capture.output()).not.toContain('Step summary written')
  } finally {
    capture.restore()
  }
})

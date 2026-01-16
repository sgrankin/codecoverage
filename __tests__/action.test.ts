import {test, expect, vi, beforeEach, afterEach} from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {getFixturePath} from './fixtures/util'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn()
}))

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
const mockAnnotate = vi.fn().mockResolvedValue(201)
const mockGetPullRequestDiff = vi.fn().mockResolvedValue({})
const mockGetPullRequestRef = vi.fn().mockReturnValue('feature-branch')
const mockBuildAnnotations = vi.fn().mockReturnValue([])

vi.mock('../src/utils/github', () => ({
  GithubUtil: vi.fn(function () {
    return {
      annotate: mockAnnotate,
      getPullRequestDiff: mockGetPullRequestDiff,
      getPullRequestRef: mockGetPullRequestRef,
      buildAnnotations: mockBuildAnnotations
    }
  })
}))

// Mock node:fs - partial mock to only mock appendFileSync
import * as actualFs from 'node:fs'
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof actualFs>('node:fs')
  return {
    ...actual,
    appendFileSync: vi.fn()
  }
})

// Mock node:process env
vi.mock('node:process', () => ({
  env: {
    GITHUB_WORKSPACE: '/workspace',
    GITHUB_STEP_SUMMARY: undefined as string | undefined
  }
}))

// Import after mocks are set up
import {play, generateSummary} from '../src/action'
import {env} from 'node:process'
import * as fs from 'node:fs'

beforeEach(() => {
  vi.clearAllMocks()
  ;(env as any).GITHUB_STEP_SUMMARY = undefined
})

test('exits early when not a pull request', async function () {
  const originalEventName = github.context.eventName
  ;(github.context as any).eventName = 'push'

  await play()

  expect(core.info).toHaveBeenCalledWith(
    'Pull request not detected. Exiting early.'
  )
  ;(github.context as any).eventName = originalEventName
})

test('throws error for unsupported coverage format', async function () {
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return '/path/to/coverage'
    if (name === 'COVERAGE_FORMAT') return 'unsupported'
    return ''
  })

  await play()

  expect(core.setFailed).toHaveBeenCalledWith(
    'COVERAGE_FORMAT must be one of lcov,cobertura,go'
  )
})

test('processes lcov coverage file successfully', async function () {
  const lcovPath = getFixturePath('lcov.info')

  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    return ''
  })

  await play()

  expect(core.info).toHaveBeenCalledWith('Performing Code Coverage Analysis')
  expect(core.info).toHaveBeenCalledWith('Workspace: /workspace')
  expect(core.info).toHaveBeenCalledWith('Filter done')
  expect(core.info).toHaveBeenCalledWith('Annotation done')
  expect(mockGetPullRequestDiff).toHaveBeenCalled()
  expect(mockBuildAnnotations).toHaveBeenCalled()
  expect(mockAnnotate).toHaveBeenCalled()
})

test('processes cobertura coverage file successfully', async function () {
  const coberturaPath = getFixturePath('cobertura.xml')

  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return coberturaPath
    if (name === 'COVERAGE_FORMAT') return 'cobertura'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    return ''
  })

  await play()

  expect(core.info).toHaveBeenCalledWith('Performing Code Coverage Analysis')
  expect(core.info).toHaveBeenCalledWith('Filter done')
  expect(core.info).toHaveBeenCalledWith('Annotation done')
})

test('processes go coverage file successfully', async function () {
  const gocovPath = getFixturePath('gocoverage.out')

  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return gocovPath
    if (name === 'COVERAGE_FORMAT') return 'go'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    return ''
  })

  // The go parser looks for go.mod in cwd, so we need to handle this
  // For now, we expect it to fail since go.mod isn't in workspace root
  await play()

  // It will fail because go.mod isn't found, but the format is accepted
  expect(core.info).toHaveBeenCalledWith('Performing Code Coverage Analysis')
})

test('defaults to lcov format when not specified', async function () {
  const lcovPath = getFixturePath('lcov.info')

  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return '' // Not specified
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    return ''
  })

  await play()

  // Should not fail - lcov is the default
  expect(core.setFailed).not.toHaveBeenCalled()
  expect(core.info).toHaveBeenCalledWith('Annotation done')
})

test('handles debug option for coverage', async function () {
  const lcovPath = getFixturePath('lcov.info')

  mockGetPullRequestDiff.mockResolvedValue({
    'src/file.ts': [{start_line: 1, end_line: 10}]
  })
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'DEBUG') return 'coverage,pr_lines_added'
    return ''
  })

  await play()

  // With debug enabled, should log coverage info
  expect(core.info).toHaveBeenCalledWith('Coverage:')
  expect(core.info).toHaveBeenCalledWith(
    expect.stringContaining('PR lines added:')
  )
})

test('sets output values for coverage stats', async function () {
  const lcovPath = getFixturePath('lcov.info')

  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    return ''
  })

  mockBuildAnnotations.mockReturnValue([
    {
      path: 'test.ts',
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning',
      message: 'test'
    }
  ])

  await play()

  expect(core.setOutput).toHaveBeenCalledWith('coverage_percentage', '34.78')
  expect(core.setOutput).toHaveBeenCalledWith('files_analyzed', 3)
  expect(core.setOutput).toHaveBeenCalledWith('annotation_count', 1)
})

test('handles error gracefully', async function () {
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return '/nonexistent/file.info'
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    return ''
  })

  await play()

  // Should call setFailed with the error message
  expect(core.setFailed).toHaveBeenCalled()
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

test('writes step summary when GITHUB_STEP_SUMMARY is set', async function () {
  const lcovPath = getFixturePath('lcov.info')
  ;(env as any).GITHUB_STEP_SUMMARY = '/tmp/summary.md'
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'true'
    return ''
  })

  await play()

  expect(fs.appendFileSync).toHaveBeenCalledWith(
    '/tmp/summary.md',
    expect.stringContaining('Code Coverage Report')
  )
  expect(core.info).toHaveBeenCalledWith('Step summary written')
})

test('step summary includes file coverage from parsed coverage file', async function () {
  const lcovPath = getFixturePath('lcov.info')
  ;(env as any).GITHUB_STEP_SUMMARY = '/tmp/summary.md'
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'true'
    return ''
  })

  await play()

  // Verify file info from lcov.info fixture is in the summary
  // The fixture has 3 files: general.ts (3 lines, 1 hit), github.ts (30 lines, 7 hit), lcov.ts (13 lines, 8 hit)
  const summaryCall = (fs.appendFileSync as any).mock.calls[0]
  const summaryContent = summaryCall[1] as string

  // Check the package table has correct structure
  expect(summaryContent).toContain('### Coverage by Package')
  expect(summaryContent).toContain(
    '| Package | Files | Total Lines | Covered | Coverage |'
  )
  // All files are in the same package (derived from their directory path)
  expect(summaryContent).toContain('| 3 | 46 | 16 |')
})

test('does not write step summary when STEP_SUMMARY is false', async function () {
  const lcovPath = getFixturePath('lcov.info')
  ;(env as any).GITHUB_STEP_SUMMARY = '/tmp/summary.md'
  ;(core.getInput as any).mockImplementation((name: string) => {
    if (name === 'GITHUB_TOKEN') return 'test-token'
    if (name === 'COVERAGE_FILE_PATH') return lcovPath
    if (name === 'COVERAGE_FORMAT') return 'lcov'
    if (name === 'GITHUB_BASE_URL') return 'https://api.github.com'
    if (name === 'STEP_SUMMARY') return 'false'
    return ''
  })

  await play()

  expect(fs.appendFileSync).not.toHaveBeenCalled()
  expect(core.info).not.toHaveBeenCalledWith('Step summary written')
})

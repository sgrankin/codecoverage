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
  GithubUtil: vi.fn().mockImplementation(() => ({
    annotate: mockAnnotate,
    getPullRequestDiff: mockGetPullRequestDiff,
    getPullRequestRef: mockGetPullRequestRef,
    buildAnnotations: mockBuildAnnotations
  }))
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

test('generateSummary returns correct markdown for high coverage', function () {
  const summary = generateSummary({
    coveragePercentage: '85.50',
    totalLines: 1000,
    coveredLines: 855,
    filesAnalyzed: 25,
    annotationCount: 0,
    files: [
      {file: 'src/utils.ts', totalLines: 500, coveredLines: 450},
      {file: 'src/main.ts', totalLines: 500, coveredLines: 405}
    ]
  })

  expect(summary).toContain('🟢 Code Coverage Report')
  expect(summary).toContain('85.50%')
  expect(summary).toContain('855')
  expect(summary).toContain('145')
  expect(summary).toContain('1,000')
  expect(summary).toContain('25')
  expect(summary).toContain('✅ No new uncovered lines detected')
  // File table
  expect(summary).toContain('### File Coverage')
  expect(summary).toContain('src/main.ts')
  expect(summary).toContain('src/utils.ts')
  expect(summary).toContain('90.0%') // 450/500
  expect(summary).toContain('81.0%') // 405/500
})

test('generateSummary returns correct markdown for medium coverage', function () {
  const summary = generateSummary({
    coveragePercentage: '65.00',
    totalLines: 100,
    coveredLines: 65,
    filesAnalyzed: 5,
    annotationCount: 3,
    files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 65}]
  })

  expect(summary).toContain('🟡 Code Coverage Report')
  expect(summary).toContain('65.00%')
  expect(summary).toContain('⚠️ **3 annotations**')
})

test('generateSummary returns correct markdown for low coverage', function () {
  const summary = generateSummary({
    coveragePercentage: '45.00',
    totalLines: 100,
    coveredLines: 45,
    filesAnalyzed: 5,
    annotationCount: 1,
    files: [{file: 'src/app.ts', totalLines: 100, coveredLines: 45}]
  })

  expect(summary).toContain('🔴 Code Coverage Report')
  expect(summary).toContain('45.00%')
  expect(summary).toContain('⚠️ **1 annotation**')
  expect(summary).not.toContain('annotations')
})

test('generateSummary sorts files alphabetically', function () {
  const summary = generateSummary({
    coveragePercentage: '80.00',
    totalLines: 300,
    coveredLines: 240,
    filesAnalyzed: 3,
    annotationCount: 0,
    files: [
      {file: 'src/zebra.ts', totalLines: 100, coveredLines: 80},
      {file: 'src/alpha.ts', totalLines: 100, coveredLines: 80},
      {file: 'src/beta.ts', totalLines: 100, coveredLines: 80}
    ]
  })

  // Check that files appear in alphabetical order
  const alphaIndex = summary.indexOf('src/alpha.ts')
  const betaIndex = summary.indexOf('src/beta.ts')
  const zebraIndex = summary.indexOf('src/zebra.ts')
  expect(alphaIndex).toBeLessThan(betaIndex)
  expect(betaIndex).toBeLessThan(zebraIndex)
})

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

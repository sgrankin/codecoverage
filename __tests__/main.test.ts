import * as core from '@actions/core'
import {expect, test, vi} from 'vitest'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn()
}))

// Mock @actions/github to exit early
vi.mock('@actions/github', () => ({
  context: {
    eventName: 'push', // Not a PR, so exits early
    payload: {},
    issue: {number: 123},
    repo: {owner: 'test-owner', repo: 'test-repo'},
    ref: 'refs/heads/main'
  }
}))

// Mock GithubUtil
vi.mock('../src/utils/github', () => ({
  GithubUtil: vi.fn().mockImplementation(() => ({}))
}))

// Mock node:process env
vi.mock('node:process', () => ({
  env: {
    GITHUB_WORKSPACE: '/workspace'
  }
}))

test('main module exports run function', async () => {
  // Import the main module - this will execute run()
  const _main = await import('../src/main.ts')

  // The module should have executed in store-baseline mode (not a PR)
  expect(core.info).toHaveBeenCalledWith('Mode: store-baseline (event: push)')
})

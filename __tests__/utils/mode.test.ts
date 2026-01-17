import {test, expect, vi, beforeEach, afterEach, describe} from 'vitest'
import * as github from '@actions/github'
import {detectMode, getNamespaceForBranch} from '../../src/utils/mode'

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    eventName: 'push',
    ref: 'refs/heads/main',
    payload: {}
  }
}))

describe('mode detection', () => {
  beforeEach(() => {
    // Reset mock to default values
    vi.mocked(github.context).eventName = 'push'
    vi.mocked(github.context).ref = 'refs/heads/main'
    vi.mocked(github.context).payload = {}
  })

  describe('detectMode', () => {
    const testCases = [
      {
        name: 'pull_request event returns pr-check mode',
        setup: () => {
          vi.mocked(github.context).eventName = 'pull_request'
          vi.mocked(github.context).ref = 'refs/pull/123/merge'
          vi.mocked(github.context).payload = {
            pull_request: {base: {ref: 'main'}}
          }
        },
        expected: {
          mode: 'pr-check',
          baseBranch: 'main',
          isPullRequest: true,
          eventName: 'pull_request'
        }
      },
      {
        name: 'push to main returns store-baseline mode',
        setup: () => {
          vi.mocked(github.context).eventName = 'push'
          vi.mocked(github.context).ref = 'refs/heads/main'
          vi.mocked(github.context).payload = {}
        },
        expected: {
          mode: 'store-baseline',
          baseBranch: 'main',
          isPullRequest: false,
          eventName: 'push'
        }
      },
      {
        name: 'push to feature branch returns store-baseline mode without baseBranch',
        setup: () => {
          vi.mocked(github.context).eventName = 'push'
          vi.mocked(github.context).ref = 'refs/heads/feature/test'
          vi.mocked(github.context).payload = {}
        },
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined,
          isPullRequest: false,
          eventName: 'push'
        }
      },
      {
        name: 'workflow_dispatch returns store-baseline mode (no baseBranch)',
        setup: () => {
          vi.mocked(github.context).eventName = 'workflow_dispatch'
          vi.mocked(github.context).ref = 'refs/heads/main'
          vi.mocked(github.context).payload = {}
        },
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined, // only push events set baseBranch
          isPullRequest: false,
          eventName: 'workflow_dispatch'
        }
      },
      {
        name: 'schedule event returns store-baseline mode (no baseBranch)',
        setup: () => {
          vi.mocked(github.context).eventName = 'schedule'
          vi.mocked(github.context).ref = 'refs/heads/main'
          vi.mocked(github.context).payload = {}
        },
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined, // only push events set baseBranch
          isPullRequest: false,
          eventName: 'schedule'
        }
      }
    ]

    test.each(testCases)('$name', ({setup, expected}) => {
      setup()
      const result = detectMode()
      expect(result.mode).toBe(expected.mode)
      expect(result.baseBranch).toBe(expected.baseBranch)
      expect(result.isPullRequest).toBe(expected.isPullRequest)
      expect(result.eventName).toBe(expected.eventName)
    })

    test('respects custom main branch name', () => {
      vi.mocked(github.context).eventName = 'push'
      vi.mocked(github.context).ref = 'refs/heads/develop'
      vi.mocked(github.context).payload = {}

      const result = detectMode(undefined, 'develop')
      expect(result.mode).toBe('store-baseline')
      expect(result.baseBranch).toBe('develop')
    })

    describe('manual override', () => {
      test('pr-check override forces pr-check mode', () => {
        vi.mocked(github.context).eventName = 'push'
        vi.mocked(github.context).ref = 'refs/heads/main'
        vi.mocked(github.context).payload = {}

        const result = detectMode('pr-check')
        expect(result.mode).toBe('pr-check')
        expect(result.isPullRequest).toBe(false) // Still reflects actual event
      })

      test('store-baseline override forces store-baseline mode', () => {
        vi.mocked(github.context).eventName = 'pull_request'
        vi.mocked(github.context).ref = 'refs/pull/123/merge'
        vi.mocked(github.context).payload = {
          pull_request: {base: {ref: 'main'}}
        }

        const result = detectMode('store-baseline')
        expect(result.mode).toBe('store-baseline')
        expect(result.isPullRequest).toBe(true) // Still reflects actual event
        expect(result.baseBranch).toBe('main') // Still available from payload
      })

      test('invalid override throws error', () => {
        expect(() => detectMode('invalid-mode')).toThrow(
          "Invalid mode override: invalid-mode. Must be 'pr-check' or 'store-baseline'"
        )
      })
    })
  })

  describe('getNamespaceForBranch', () => {
    const testCases = [
      {branch: 'main', prefix: 'coverage', expected: 'coverage/main'},
      {branch: 'develop', prefix: 'coverage', expected: 'coverage/develop'},
      {
        branch: 'release-v1.0',
        prefix: 'coverage',
        expected: 'coverage/release-v1-0'
      },
      {
        branch: 'feature/test-branch',
        prefix: 'coverage',
        expected: 'coverage/feature-test-branch'
      },
      {branch: 'main', prefix: 'cov', expected: 'cov/main'}
    ]

    test.each(testCases)(
      'branch "$branch" with prefix "$prefix" returns "$expected"',
      ({branch, prefix, expected}) => {
        expect(getNamespaceForBranch(branch, prefix)).toBe(expected)
      }
    )

    test('uses default prefix', () => {
      expect(getNamespaceForBranch('main')).toBe('coverage/main')
    })
  })
})

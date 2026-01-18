import {test, expect, describe} from 'vitest'
import {detectMode, getNamespaceForBranch, GithubContext} from '../../src/utils/mode'

/**
 * Creates a fake GitHub context for testing.
 * No mocking required - just pass data.
 */
function createFakeContext(options: {
  eventName: string
  ref: string
  pullRequestBaseRef?: string
}): GithubContext {
  return {
    eventName: options.eventName,
    ref: options.ref,
    payload: options.pullRequestBaseRef
      ? {pull_request: {base: {ref: options.pullRequestBaseRef}}}
      : {}
  }
}

describe('mode detection', () => {
  describe('detectMode', () => {
    const testCases = [
      {
        name: 'pull_request event returns pr-check mode',
        ctx: createFakeContext({
          eventName: 'pull_request',
          ref: 'refs/pull/123/merge',
          pullRequestBaseRef: 'main'
        }),
        expected: {
          mode: 'pr-check',
          baseBranch: 'main',
          isPullRequest: true,
          eventName: 'pull_request'
        }
      },
      {
        name: 'push to main returns store-baseline mode',
        ctx: createFakeContext({
          eventName: 'push',
          ref: 'refs/heads/main'
        }),
        expected: {
          mode: 'store-baseline',
          baseBranch: 'main',
          isPullRequest: false,
          eventName: 'push'
        }
      },
      {
        name: 'push to feature branch returns store-baseline mode without baseBranch',
        ctx: createFakeContext({
          eventName: 'push',
          ref: 'refs/heads/feature/test'
        }),
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined,
          isPullRequest: false,
          eventName: 'push'
        }
      },
      {
        name: 'workflow_dispatch returns store-baseline mode (no baseBranch)',
        ctx: createFakeContext({
          eventName: 'workflow_dispatch',
          ref: 'refs/heads/main'
        }),
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined, // only push events set baseBranch
          isPullRequest: false,
          eventName: 'workflow_dispatch'
        }
      },
      {
        name: 'schedule event returns store-baseline mode (no baseBranch)',
        ctx: createFakeContext({
          eventName: 'schedule',
          ref: 'refs/heads/main'
        }),
        expected: {
          mode: 'store-baseline',
          baseBranch: undefined, // only push events set baseBranch
          isPullRequest: false,
          eventName: 'schedule'
        }
      }
    ]

    test.each(testCases)('$name', ({ctx, expected}) => {
      const result = detectMode(undefined, 'main', ctx)
      expect(result.mode).toBe(expected.mode)
      expect(result.baseBranch).toBe(expected.baseBranch)
      expect(result.isPullRequest).toBe(expected.isPullRequest)
      expect(result.eventName).toBe(expected.eventName)
    })

    test('respects custom main branch name', () => {
      const ctx = createFakeContext({
        eventName: 'push',
        ref: 'refs/heads/develop'
      })

      const result = detectMode(undefined, 'develop', ctx)
      expect(result.mode).toBe('store-baseline')
      expect(result.baseBranch).toBe('develop')
    })

    describe('manual override', () => {
      test('pr-check override forces pr-check mode', () => {
        const ctx = createFakeContext({
          eventName: 'push',
          ref: 'refs/heads/main'
        })

        const result = detectMode('pr-check', 'main', ctx)
        expect(result.mode).toBe('pr-check')
        expect(result.isPullRequest).toBe(false) // Still reflects actual event
      })

      test('store-baseline override forces store-baseline mode', () => {
        const ctx = createFakeContext({
          eventName: 'pull_request',
          ref: 'refs/pull/123/merge',
          pullRequestBaseRef: 'main'
        })

        const result = detectMode('store-baseline', 'main', ctx)
        expect(result.mode).toBe('store-baseline')
        expect(result.isPullRequest).toBe(true) // Still reflects actual event
        expect(result.baseBranch).toBe('main') // Still available from payload
      })

      test('invalid override throws error', () => {
        const ctx = createFakeContext({
          eventName: 'push',
          ref: 'refs/heads/main'
        })
        expect(() => detectMode('invalid-mode', 'main', ctx)).toThrow(
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
